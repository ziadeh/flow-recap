/**
 * Type declarations for node-record-lpcm16
 */

declare module 'node-record-lpcm16' {
  import { Readable } from 'stream'

  interface RecordOptions {
    /** Sample rate in Hz (default: 16000) */
    sampleRate?: number
    /** Number of audio channels (default: 1) */
    channels?: number
    /** Audio type/format (default: 'raw') */
    audioType?: 'raw' | 'wav'
    /** Recording program to use: 'sox', 'rec', 'arecord' */
    recorder?: 'sox' | 'rec' | 'arecord'
    /** Silence detection duration */
    silence?: string
    /** Silence threshold (0-100) */
    threshold?: number
    /** End recording on silence (default: false) */
    endOnSilence?: boolean
    /** Device name for recording */
    device?: string | null
  }

  interface Recording {
    /** Get the audio stream */
    stream(): Readable
    /** Stop recording */
    stop(): void
  }

  interface RecordModule {
    /** Start recording audio */
    record(options?: RecordOptions): Recording
  }

  const record: RecordModule

  export = record
}
