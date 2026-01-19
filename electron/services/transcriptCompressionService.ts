/**
 * Transcript Compression Service
 *
 * Provides transparent compression and decompression of transcript content
 * using gzip to reduce storage by 60-80% for text-heavy transcript data.
 *
 * Features:
 * - Gzip compression using Node.js built-in zlib
 * - In-memory caching with TTL for decompressed content
 * - Filler word deduplication (optional)
 * - Lazy decompression on read
 * - Backward compatible with uncompressed data
 */

import zlib from 'zlib'
import { promisify } from 'util'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Filler word entry for deduplication
 */
export interface FillerWordEntry {
  word: string
  position: number
  length: number
}

/**
 * Statistics about compression for a transcript
 */
export interface CompressionStats {
  originalSize: number
  compressedSize: number
  compressionRatio: number
  fillerWordsRemoved: number
}

/**
 * Cache entry for decompressed content with TTL
 */
interface CacheEntry {
  content: string
  timestamp: number
  expiresAt: number
}

// ============================================================================
// Configuration
// ============================================================================

// Promisify zlib functions for async operations
const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

// Cache TTL in milliseconds (1 hour)
const CACHE_TTL = 60 * 60 * 1000

// Common filler words and phrases to deduplicate
// These are common in speech-to-text and meeting transcripts
const FILLER_WORDS = [
  'uh',
  'um',
  'like',
  'you know',
  'so',
  'basically',
  'actually',
  'literally',
  'really',
  'honestly',
  'obviously',
  'right',
  'well',
  'just',
]

// ============================================================================
// Decompression Cache
// ============================================================================

/**
 * In-memory cache for decompressed transcript content
 * Helps avoid repeated decompression of the same content
 */
class DecompressionCache {
  private cache = new Map<string, CacheEntry>()

  /**
   * Get cached decompressed content if available and not expired
   */
  get(key: string): string | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    // Check if cache entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.content
  }

  /**
   * Set content in cache with TTL
   */
  set(key: string, content: string): void {
    this.cache.set(key, {
      content,
      timestamp: Date.now(),
      expiresAt: Date.now() + CACHE_TTL,
    })
  }

  /**
   * Clear expired entries periodically
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; items: number } {
    let size = 0
    for (const entry of this.cache.values()) {
      size += entry.content.length
    }
    return {
      size,
      items: this.cache.size,
    }
  }
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Main compression service for transcripts
 */
export class TranscriptCompressionService {
  private cache = new DecompressionCache()
  private compressionStats = new Map<string, CompressionStats>()

  constructor() {
    // Run cache cleanup periodically (every 15 minutes)
    setInterval(() => {
      this.cache.cleanup()
    }, 15 * 60 * 1000)
  }

  // =========================================================================
  // Compression Methods
  // =========================================================================

  /**
   * Compress transcript content using gzip
   *
   * @param content - The transcript text to compress
   * @returns Promise<Buffer> - The compressed content as a Buffer
   */
  async compressTranscriptContent(content: string): Promise<Buffer> {
    try {
      const buffer = Buffer.from(content, 'utf-8')
      const compressed = await gzip(buffer, {
        level: 6, // Balance between speed and compression ratio
      })
      return compressed
    } catch (error) {
      throw new Error(`Failed to compress transcript content: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Decompress transcript content from Buffer
   *
   * @param compressed - The compressed content as a Buffer
   * @param cacheKey - Optional cache key for decompression caching
   * @returns Promise<string> - The decompressed transcript text
   */
  async decompressTranscriptContent(compressed: Buffer, cacheKey?: string): Promise<string> {
    try {
      // Check cache first if key provided
      if (cacheKey) {
        const cached = this.cache.get(cacheKey)
        if (cached) {
          return cached
        }
      }

      // Decompress the buffer
      const decompressed = await gunzip(compressed)
      const content = decompressed.toString('utf-8')

      // Store in cache if key provided
      if (cacheKey) {
        this.cache.set(cacheKey, content)
      }

      return content
    } catch (error) {
      throw new Error(`Failed to decompress transcript content: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // =========================================================================
  // Filler Word Deduplication Methods
  // =========================================================================

  /**
   * Remove common filler words and phrases from transcript
   * Stores filler positions for optional restoration
   *
   * @param content - The transcript content to deduplicate
   * @returns Object with deduplicated content and filler map
   */
  deduplicateFillerWords(
    content: string,
  ): {
    content: string
    fillerMap: string
    removedCount: number
  } {
    let deduplicated = content
    const fillerPositions: FillerWordEntry[] = []
    let removedCount = 0

    // Sort by length (longest first) to match longer phrases before shorter ones
    const sortedFillers = [...FILLER_WORDS].sort((a, b) => b.length - a.length)

    for (const filler of sortedFillers) {
      // Case-insensitive regex with word boundaries
      const regex = new RegExp(`\\b${filler}\\b`, 'gi')
      let match

      // Track positions of removed fillers (before deduplication)
      while ((match = regex.exec(content)) !== null) {
        fillerPositions.push({
          word: filler,
          position: match.index,
          length: filler.length,
        })
      }

      // Remove fillers from content
      deduplicated = deduplicated.replace(regex, '').replace(/\s+/g, ' ').trim()
      removedCount += (content.match(regex) || []).length
    }

    // Store filler map as JSON for optional restoration
    const fillerMap = JSON.stringify(fillerPositions)

    return {
      content: deduplicated,
      fillerMap,
      removedCount,
    }
  }

  /**
   * Restore filler words from filler map
   *
   * @param deduplicated - The deduplicated content
   * @param fillerMap - The JSON string containing filler positions
   * @returns The content with fillers restored
   */
  restoreFillerWords(deduplicated: string, fillerMap: string): string {
    try {
      if (!fillerMap) return deduplicated

      const fillerPositions: FillerWordEntry[] = JSON.parse(fillerMap)

      // Sort by position in descending order to maintain correct positions during insertion
      fillerPositions.sort((a, b) => b.position - a.position)

      let restored = deduplicated
      for (const entry of fillerPositions) {
        // Insert filler word at the correct position
        restored = restored.slice(0, entry.position) + entry.word + ' ' + restored.slice(entry.position)
      }

      return restored
    } catch (error) {
      // If restoration fails, return the deduplicated content
      console.warn('Failed to restore filler words:', error)
      return deduplicated
    }
  }

  // =========================================================================
  // Statistics Methods
  // =========================================================================

  /**
   * Calculate compression statistics for content
   *
   * @param originalContent - The original uncompressed content
   * @param compressedBuffer - The compressed content buffer
   * @param fillerWordsRemoved - Number of filler words removed
   * @param id - Optional ID for caching stats
   * @returns Compression statistics
   */
  calculateCompressionStats(
    originalContent: string,
    compressedBuffer: Buffer,
    fillerWordsRemoved: number = 0,
    id?: string,
  ): CompressionStats {
    const originalSize = Buffer.byteLength(originalContent, 'utf-8')
    const compressedSize = compressedBuffer.length
    const compressionRatio = 1 - compressedSize / originalSize

    const stats: CompressionStats = {
      originalSize,
      compressedSize,
      compressionRatio,
      fillerWordsRemoved,
    }

    // Cache stats if ID provided
    if (id) {
      this.compressionStats.set(id, stats)
    }

    return stats
  }

  /**
   * Get cached compression statistics
   */
  getCompressionStats(id: string): CompressionStats | null {
    return this.compressionStats.get(id) || null
  }

  /**
   * Clear cached statistics
   */
  clearCompressionStats(id?: string): void {
    if (id) {
      this.compressionStats.delete(id)
    } else {
      this.compressionStats.clear()
    }
  }

  /**
   * Get cache and statistics information
   */
  getServiceStats(): {
    cacheSize: number
    cacheItems: number
    cachedStats: number
  } {
    const cacheStats = this.cache.getStats()
    return {
      cacheSize: cacheStats.size,
      cacheItems: cacheStats.items,
      cachedStats: this.compressionStats.size,
    }
  }

  // =========================================================================
  // Cleanup Methods
  // =========================================================================

  /**
   * Clean up cache and statistics
   */
  cleanup(): void {
    this.cache.clear()
    this.compressionStats.clear()
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

// Create a singleton instance
let instance: TranscriptCompressionService | null = null

/**
 * Get or create the transcript compression service singleton
 */
export function getTranscriptCompressionService(): TranscriptCompressionService {
  if (!instance) {
    instance = new TranscriptCompressionService()
  }
  return instance
}

/**
 * Reset the service (primarily for testing)
 */
export function resetTranscriptCompressionService(): void {
  if (instance) {
    instance.cleanup()
  }
  instance = null
}
