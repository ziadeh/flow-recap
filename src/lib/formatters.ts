/**
 * Date and time formatting utilities
 */

/**
 * Format ISO string to full date and time
 * @example "January 15, 2024 at 2:30 PM"
 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format ISO string to date only
 * @example "January 15, 2024"
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format ISO string to time only
 * @example "2:30 PM"
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format duration in seconds to readable string
 * @example formatDuration(125) => "2:05"
 * @example formatDuration(3665) => "1:01:05"
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format duration in milliseconds to readable timestamp
 * @example formatDurationMs(125000) => "2:05"
 */
export function formatDurationMs(milliseconds: number): string {
  return formatDuration(milliseconds / 1000);
}

/**
 * Check if a date is overdue (past current date)
 */
export function isOverdue(isoString: string): boolean {
  const date = new Date(isoString);
  const now = new Date();
  return date < now;
}

/**
 * Format relative time (e.g., "2 days ago", "in 3 hours")
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 0) {
    return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  } else if (diffDays < 0) {
    return `${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  } else if (diffHours < 0) {
    return `${Math.abs(diffHours)} hour${Math.abs(diffHours) > 1 ? 's' : ''} ago`;
  } else if (diffMinutes > 0) {
    return `in ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
  } else if (diffMinutes < 0) {
    return `${Math.abs(diffMinutes)} minute${Math.abs(diffMinutes) > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

/**
 * Format file size in bytes to human-readable format
 * @example formatFileSize(1024) => "1.0 KB"
 * @example formatFileSize(1536) => "1.5 KB"
 * @example formatFileSize(1048576) => "1.0 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ============================================================================
// Sentence-Based Line Breaking Utilities
// ============================================================================

/**
 * Title abbreviations - these are ALWAYS followed by names
 * and should NEVER trigger a sentence break
 */
const TITLE_ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'rev', 'hon', 'esq',
  'gen', 'col', 'lt', 'sgt', 'capt', 'cmdr', 'adm', 'gov', 'pres',
  'rep', 'sen', 'amb', 'atty',
]);

/**
 * Common abbreviations that shouldn't trigger sentence breaks
 * UNLESS followed by a capital letter (which indicates a new sentence)
 */
const COMMON_ABBREVIATIONS = new Set([
  // Common abbreviations (can end sentences if followed by capital)
  'vs', 'etc', 'inc', 'ltd', 'corp', 'co', 'dept', 'div',
  'est', 'approx', 'avg', 'min', 'max', 'no', 'nos',
  // Academic/Professional degrees (usually at end of names)
  'ph', 'phd', 'md', 'ba', 'bs', 'ma', 'mba',
  // Time/Date
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'am', 'pm',
  // Units
  'ft', 'in', 'lb', 'lbs', 'oz', 'pt', 'qt', 'gal', 'mi', 'km', 'cm', 'mm',
  // Address
  'st', 'ave', 'blvd', 'rd', 'ln', 'ct', 'apt', 'ste', 'fl',
  // Other common
  'fig', 'figs', 'pp', 'vol', 'vols', 'ch', 'sec', 'para',
  'e', 'g', 'i', 'ie', 'eg', // e.g., i.e.
]);

/**
 * Configuration options for sentence breaking
 */
export interface SentenceBreakOptions {
  /** Whether to preserve existing line breaks in the input */
  preserveExistingBreaks?: boolean;
  /** Minimum sentence length before considering a break (characters) */
  minSentenceLength?: number;
  /** Custom abbreviations to add to the default list */
  customAbbreviations?: string[];
}

/**
 * Check if a word is a title abbreviation (NEVER break after these)
 */
function isTitleAbbreviation(word: string): boolean {
  const normalized = word.toLowerCase().replace(/\.$/, '');
  return TITLE_ABBREVIATIONS.has(normalized);
}

/**
 * Check if a word is a common abbreviation (can break if followed by capital)
 */
function isCommonAbbreviation(word: string, customAbbreviations?: string[]): boolean {
  const normalized = word.toLowerCase().replace(/\.$/, '');

  if (COMMON_ABBREVIATIONS.has(normalized)) {
    return true;
  }

  // Check custom abbreviations
  if (customAbbreviations) {
    const customSet = new Set(customAbbreviations.map(a => a.toLowerCase().replace(/\.$/, '')));
    if (customSet.has(normalized)) {
      return true;
    }
  }

  // Check for single letter abbreviations (e.g., "A.", "B.")
  if (normalized.length === 1 && /[a-z]/i.test(normalized)) {
    return true;
  }

  return false;
}

/**
 * Check if the next word after a position starts with a capital letter
 * This helps determine if an abbreviation is at the end of a sentence
 */
function nextWordStartsWithCapital(text: string, position: number): boolean {
  // Skip whitespace and closing punctuation
  let i = position + 1;
  while (i < text.length && /[\s"'\)\]\}>]/.test(text[i])) {
    i++;
  }

  // Check if the next character is a capital letter
  if (i < text.length) {
    return /[A-Z]/.test(text[i]);
  }

  return false;
}

/**
 * Check if a position in text is a valid sentence boundary
 * A valid boundary is a sentence-ending punctuation followed by whitespace
 * and not part of an abbreviation
 */
function isSentenceBoundary(
  text: string,
  position: number,
  options?: SentenceBreakOptions
): boolean {
  const char = text[position];

  // Must be sentence-ending punctuation
  if (!/[.!?]/.test(char)) {
    return false;
  }

  // Handle multiple punctuation marks (e.g., "?!", "!!", "...")
  // Only the last punctuation in a sequence should be a boundary
  const nextChar = text[position + 1];
  if (nextChar && /[.!?]/.test(nextChar)) {
    return false;
  }

  // Check for ellipsis (...)
  if (char === '.' && position >= 2) {
    if (text[position - 1] === '.' && text[position - 2] === '.') {
      // This is the end of an ellipsis
      // Only break if followed by a capital letter (new sentence) or end of text
      const afterEllipsis = text[position + 1];
      if (!afterEllipsis) {
        return true; // End of text
      }
      // Check if next word starts with capital (new sentence)
      if (nextWordStartsWithCapital(text, position)) {
        return true;
      }
      return false; // Mid-sentence ellipsis, don't break
    }
  }

  // Must be followed by whitespace, end of string, or closing punctuation
  if (nextChar && !/[\s"'\)\]\}>]/.test(nextChar)) {
    return false;
  }

  // For periods, check if this is an abbreviation
  if (char === '.') {
    // Find the word before the period
    let wordStart = position - 1;
    while (wordStart >= 0 && /[a-zA-Z]/.test(text[wordStart])) {
      wordStart--;
    }
    wordStart++;

    const word = text.slice(wordStart, position);

    if (word) {
      // Title abbreviations (Dr., Mr., etc.) - NEVER break after these
      if (isTitleAbbreviation(word)) {
        return false;
      }

      // Common abbreviations (etc., Inc., etc.) - break only if followed by capital letter
      if (isCommonAbbreviation(word, options?.customAbbreviations)) {
        if (nextWordStartsWithCapital(text, position)) {
          return true;
        }
        return false;
      }
    }

    // Check for decimal numbers (e.g., "3.14")
    if (wordStart > 0 && /\d/.test(text[wordStart - 1])) {
      // Check if the word after the period starts with a digit
      let afterPosition = position + 1;
      while (afterPosition < text.length && /\s/.test(text[afterPosition])) {
        afterPosition++;
      }
      // If next non-space char is a digit, this might be a decimal - but usually
      // there's no space in decimals, so if there's a space, it's likely a new sentence
    }
  }

  // Check minimum sentence length if specified
  if (options?.minSentenceLength) {
    // Find the start of the current sentence (last boundary)
    let sentenceStart = position - 1;
    while (sentenceStart >= 0) {
      const c = text[sentenceStart];
      if (/[.!?]/.test(c) && isSentenceBoundary(text, sentenceStart, { ...options, minSentenceLength: undefined })) {
        sentenceStart++;
        break;
      }
      sentenceStart--;
    }
    if (sentenceStart < 0) sentenceStart = 0;

    const sentenceLength = position - sentenceStart;
    if (sentenceLength < options.minSentenceLength) {
      return false;
    }
  }

  return true;
}

/**
 * Format transcript text with sentence-based line breaks
 * Detects sentence boundaries and inserts line breaks for better readability
 *
 * @example
 * formatTranscriptWithSentenceBreaks("Hello world. How are you? I'm fine!")
 * // Returns: "Hello world.\nHow are you?\nI'm fine!"
 *
 * @example
 * formatTranscriptWithSentenceBreaks("Dr. Smith said hello. It was nice.")
 * // Returns: "Dr. Smith said hello.\nIt was nice."
 */
export function formatTranscriptWithSentenceBreaks(
  text: string,
  options?: SentenceBreakOptions
): string {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  const {
    preserveExistingBreaks = true,
    minSentenceLength = 0,
    customAbbreviations,
  } = options || {};

  // Handle existing line breaks
  if (preserveExistingBreaks) {
    // Process each line separately
    const lines = text.split('\n');
    return lines
      .map(line => formatSingleLine(line, { minSentenceLength, customAbbreviations }))
      .join('\n');
  }

  return formatSingleLine(text, { minSentenceLength, customAbbreviations });
}

/**
 * Format a single line of text with sentence breaks
 */
function formatSingleLine(
  text: string,
  options?: { minSentenceLength?: number; customAbbreviations?: string[] }
): string {
  if (!text.trim()) {
    return text;
  }

  const result: string[] = [];
  let currentSentence = '';

  for (let i = 0; i < text.length; i++) {
    currentSentence += text[i];

    if (isSentenceBoundary(text, i, options)) {
      // Include any closing punctuation/quotes that follow
      let j = i + 1;
      while (j < text.length && /["'\)\]\}>]/.test(text[j])) {
        currentSentence += text[j];
        j++;
      }
      i = j - 1;

      result.push(currentSentence.trim());
      currentSentence = '';
    }
  }

  // Add any remaining text
  if (currentSentence.trim()) {
    result.push(currentSentence.trim());
  }

  return result.join('\n');
}

/**
 * Split text into sentences (returns array of sentences)
 * Useful when you need individual sentence control
 */
export function splitIntoSentences(
  text: string,
  options?: SentenceBreakOptions
): string[] {
  const formatted = formatTranscriptWithSentenceBreaks(text, {
    ...options,
    preserveExistingBreaks: false,
  });
  return formatted.split('\n').filter(s => s.trim());
}
