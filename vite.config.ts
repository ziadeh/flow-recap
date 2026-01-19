import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { builtinModules } from 'module'

// ============================================================================
// NATIVE MODULE EXTERNALIZATION STRATEGY
// ============================================================================
//
// This configuration implements a comprehensive strategy for handling native
// Node.js modules and Electron-specific modules during Vite/Rollup bundling.
//
// WHY EXTERNALIZE?
// - Native modules (.node files) cannot be bundled by Rollup
// - Electron modules must be loaded at runtime from the Electron environment
// - Some modules have complex dependency trees that break when bundled
//
// HOW IT WORKS:
// 1. Node.js built-ins (fs, path, etc.) are externalized with node: prefix support
// 2. Electron and electron/* paths are externalized
// 3. Native modules with .node bindings are externalized
// 4. All node_modules are externalized (loaded at runtime)
//
// ADDING NEW NATIVE DEPENDENCIES:
// 1. Add the module name to the `nativeModules` array below
// 2. Add the module to `asarUnpack` in electron-builder.config.cjs if it has .node files
// 3. Test in both dev (npm run dev) and production (installed app) modes
//
// ============================================================================

// Node.js built-in modules that should always be externalized
// Includes both standard names (fs, path) and node: prefixed versions (node:fs)
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
]

// Native modules and modules requiring special handling for Electron
// These modules contain native bindings (.node files) or require special runtime loading
const nativeModules = [
  // Electron core
  'electron',

  // Database - contains native SQLite bindings
  'better-sqlite3',
  'bindings',           // Helper for loading native modules

  // Archive creation - uses native zlib bindings
  'archiver',

  // Audio recording - native audio capture
  'node-record-lpcm16',
  'wav',

  // Electron utilities
  'electron-log',
  'electron-updater',

  // Environment configuration
  'dotenv',

  // UUID generation (uses crypto)
  'uuid'
]

// Electron-specific module patterns that need to be externalized
const electronModulePatterns = [
  /^electron\//,           // electron/renderer, electron/common, etc.
  /^@electron\//,          // @electron/* scoped packages
  /^electron-/,            // electron-log, electron-updater, etc.
]

// All explicitly named modules to externalize
const externalModules = [...nodeBuiltins, ...nativeModules]

/**
 * Check if a module ID should be externalized
 * @param id - The module identifier (import path)
 * @returns true if the module should be externalized (not bundled)
 */
function shouldExternalize(id: string): boolean {
  // 1. Check if it's an explicitly listed external module
  if (externalModules.includes(id)) {
    return true
  }

  // 2. Check for subpath imports of external modules (e.g., 'electron/renderer')
  if (externalModules.some((m) => id.startsWith(`${m}/`))) {
    return true
  }

  // 3. Check for electron-specific patterns
  if (electronModulePatterns.some((pattern) => pattern.test(id))) {
    return true
  }

  // 4. Check for node: protocol (Node.js built-ins)
  if (id.startsWith('node:')) {
    return true
  }

  // 5. Externalize all node_modules
  // Anything that's not a relative path (./) or absolute path (/) is from node_modules
  // This ensures all npm packages are loaded from node_modules at runtime
  if (!id.startsWith('.') && !id.startsWith('/') && !path.isAbsolute(id)) {
    return true
  }

  return false
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry file
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Use our comprehensive externalization function
              external: shouldExternalize,
              output: {
                // Preserve module format for better native module compatibility
                format: 'cjs',
                // Use interop for CommonJS modules
                interop: 'auto',
                // Ensure consistent exports
                exports: 'auto'
              }
            }
          },
          resolve: {
            // Prefer Node.js resolution for main process
            mainFields: ['main', 'module'],
            // Handle .node native modules
            extensions: ['.ts', '.js', '.json', '.node']
          }
        }
      },
      {
        // Preload script
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Preload scripts only need electron externalized
              // They run in a sandboxed context with limited Node.js access
              external: ['electron', ...nodeBuiltins]
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      // Source directory alias for imports
      '@': path.resolve(__dirname, './src'),

      // ========================================================================
      // ELECTRON MODULE PATH ALIASES
      // ========================================================================
      // These aliases help resolve Electron-specific modules correctly in both
      // development and production environments.
      //
      // In production (ASAR), native modules are unpacked to app.asar.unpacked/
      // The electron-builder configuration handles this, but these aliases
      // ensure consistent resolution during development.
      // ========================================================================

      // Electron main module (runtime resolution)
      'electron': 'electron'
    },
    // Supported file extensions for resolution
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Bundle size optimization
    rollupOptions: {
      output: {
        // Code splitting - create separate chunks for vendor code and service modules
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          // React Router
          'router': ['react-router', 'react-router-dom'],
          // UI utilities
          'ui-vendor': ['react-window', 'zustand'],

          // ====================================================================
          // Service Module Chunks (for bundle code splitting)
          // ====================================================================
          // These chunks are lazy-loaded by the Electron main process to reduce
          // initial bundle size from 3-4MB to <500KB

          // Recording services chunk (~800KB)
          // Loaded only when user starts a recording
          'recording-services': [
            './electron/services/recordingServicesBundle',
            './electron/services/liveTranscriptionService',
            './electron/services/audioRecorderService',
            './electron/services/systemAudioCaptureService',
            './electron/services/screenCaptureKitService',
          ],

          // AI/Insights services chunk (~500KB)
          // Loaded only when user views insights or generates notes
          'ai-insights-services': [
            './electron/services/aiInsightsServicesBundle',
            './electron/services/meetingSummaryService',
            './electron/services/actionItemsService',
            './electron/services/decisionsAndTopicsService',
            './electron/services/unifiedInsightsService',
            './electron/services/orchestratedInsightsService',
            './electron/services/liveNoteGenerationService',
            './electron/services/subjectAwareNoteGenerationService',
            './electron/services/llmPostProcessingService',
          ],

          // Diarization services chunk (~1.2MB)
          // Loaded only when diarization is needed
          'diarization-services': [
            './electron/services/diarizationServicesBundle',
            './electron/services/speakerDiarizationService',
            './electron/services/batchDiarizationService',
            './electron/services/coreDiarizationService',
            './electron/services/streamingDiarizationService',
            './electron/services/diarizationFailureService',
            './electron/services/diarizationService',
            './electron/services/temporalAlignmentService',
            './electron/services/diarizationAwareTranscriptPipeline',
            './electron/services/diarizationFirstPipeline',
            './electron/services/diarizationTelemetryService',
            './electron/services/diarizationOutputSchema',
          ],
        }
      }
    },
    // Enable minification
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove console.log in production (keep errors and warnings)
        pure_funcs: ['console.log']
      }
    },
    // Generate source maps for debugging (but smaller)
    sourcemap: true,
    // Report bundle size
    reportCompressedSize: true,
    // Chunk size warning limit - raise for async chunks
    chunkSizeWarningLimit: 2000 // 2MB warning threshold (async chunks can be larger)
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'react-window', 'zustand']
  }
})
