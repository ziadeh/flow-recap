import { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } from 'electron'
import path from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import * as dotenv from 'dotenv'

// ============================================================================
// Environment Variables Loading
// ============================================================================
// Load environment variables from .env file
// In development: loads from project root (default dotenv behavior)
// In production: loads from multiple locations:
//   1. App resources directory (bundled with app)
//   2. User data directory (user-configurable)
//   3. Current working directory (fallback)
//
// This ensures HF_TOKEN and other env vars are available in packaged builds

function loadEnvFile(): void {
  // Paths to check for .env file, in order of priority
  const envPaths: string[] = []

  // Check if we're in a packaged app
  // Note: app.isPackaged might not be available until app is ready,
  // but we can check for resourcesPath which is set in packaged apps
  const isPackaged = !process.defaultApp && process.resourcesPath

  if (isPackaged) {
    // In production/packaged mode:
    // 1. Check user data directory first (allows user customization)
    const userDataPath = app.getPath('userData')
    envPaths.push(path.join(userDataPath, '.env'))

    // 2. Check app resources directory (bundled with app)
    envPaths.push(path.join(process.resourcesPath || '', '.env'))
    envPaths.push(path.join(process.resourcesPath || '', 'resources', '.env'))

    // 3. Check next to the executable (for portable apps)
    const exePath = path.dirname(process.execPath)
    envPaths.push(path.join(exePath, '.env'))
  }

  // Always check current working directory (development mode default)
  envPaths.push(path.join(process.cwd(), '.env'))

  // Also check the __dirname for development mode
  envPaths.push(path.join(__dirname, '..', '.env'))

  // Try each path until we find one that exists
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      console.log('[Main] Loading .env from:', envPath)
      dotenv.config({ path: envPath })
      return
    }
  }

  // No .env file found - just use default behavior
  console.log('[Main] No .env file found, using system environment variables')
  dotenv.config()
}

// Load environment variables
loadEnvFile()

// ============================================================================
// GPU Process Crash Mitigation
// ============================================================================
// Disable GPU hardware acceleration to prevent GPU process crashes on startup.
// This addresses the following errors:
// - "GPU process exited unexpectedly: exit_code=15"
// - "Network service crashed, restarting service"
//
// These errors occur because:
// 1. Electron's Chromium uses GPU acceleration for rendering
// 2. The GPU process can crash due to driver incompatibilities or resource conflicts
// 3. When the GPU process crashes, it can cascade to the network service
//
// Disabling GPU acceleration trades slightly reduced rendering performance for
// improved stability, especially on systems with older or incompatible GPU drivers.
// For a meeting notes app, this is an acceptable tradeoff.
app.disableHardwareAcceleration()

// Additional GPU-related flags to prevent crashes and improve stability
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')

// Ignore GPU-related errors that might still occur during initialization
app.commandLine.appendSwitch('ignore-gpu-blocklist')
import { ensureValidWavHeader } from './services/wavUtils'
import {
  initializeDatabase,
  closeDatabase,
  getDatabaseService,
  meetingService,
  recordingService,
  transcriptService,
  meetingNoteService,
  taskService,
  speakerService,
  meetingSpeakerNameService,
  settingsService,
  defaultSettings,
  audioRecorderService,
  audioDeviceService,
  systemAudioCaptureService,
  screenCaptureKitService,
  binaryManager,
  mlPipelineService,
  liveTranscriptionService,
  batchDiarizationService,
  coreDiarizationService,
  streamingDiarizationService,
  diarizationFailureService,
  llmPostProcessingService,
  postRecordingProcessor,
  speakerDiarizationService,
  resetSpeakerDiarizationState,
  meetingSummaryService,
  actionItemsService,
  decisionsAndTopicsService,
  exportService,
  updateService,
  llmProviderManager,
  initializeLLMProviderManager,
  llmHealthCheckService,
  startHealthChecks,
  liveNoteGenerationService,
  getLiveInsightsPersistenceService,
  subjectAwareNoteGenerationService,
  transcriptCorrectionService,
  confidenceScoringService,
  meetingDeletionService,
  storageManagementService,
  exportDeleteService,
  speakerNameDetectionService,
  pythonEnvironmentValidator,
  pythonSetupService,
  pythonExecutionManager,
  dataMigrationService
} from './services'
import type {
  LLMProviderType,
  ProviderDetectionOptions,
  HealthCheckConfig,
  LegacyPathInfo
} from './services'
import type {
  CoreDiarizationConfig,
  StreamingDiarizationConfig,
  SummaryGenerationConfig,
  ActionItemsExtractionConfig,
  DecisionsAndTopicsConfig,
  LiveNoteGenerationConfig,
  LiveNoteTranscriptInput,
  SubjectAwareConfig,
  SubjectAwareTranscriptInput,
  ExportFormat,
  ExportConfig,
  ScreenCaptureKitConfig,
  CorrectionTrigger,
  CorrectionConfig,
  ConfidenceScoringConfig,
  DeletionOptions,
  CleanupCriteria,
  SpeakerNameDetectionConfig,
  SetupOptions,
  SetupProgress
} from './services'
import type {
  CreateMeetingInput,
  UpdateMeetingInput,
  CreateRecordingInput,
  UpdateRecordingInput,
  CreateTranscriptInput,
  CreateMeetingNoteInput,
  UpdateMeetingNoteInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSpeakerInput,
  UpdateSpeakerInput,
  MeetingStatus,
  TaskStatus,
  TaskPriority,
  NoteType,
  SettingCategory,
  VirtualCableType,
  DualRecordingConfig,
  TranscriptionConfig,
  DiarizationConfig,
  LiveTranscriptionConfig,
  BatchDiarizationOptions
} from './services'

// The built directory structure
//
// ├─┬ dist-electron
// │ ├── main.js
// │ └── preload.js
// ├─┬ dist
// │ └── index.html
// └── ...

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

// Register custom protocol as privileged BEFORE app is ready
// This is required for the protocol to work properly with media elements
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

// ============================================================================
// Global Error Handlers
// ============================================================================
// Handle uncaught exceptions and unhandled promise rejections to prevent
// the app from crashing on non-critical errors (like audio recorder errors)

process.on('uncaughtException', (error: Error) => {
  console.error('[Main] Uncaught exception:', error)

  // Check if this is a sox/recorder error that should be handled gracefully
  const errorMessage = error.message || String(error)
  const isRecorderError = errorMessage.includes('sox has exited') ||
                          errorMessage.includes('rec has exited') ||
                          errorMessage.includes('arecord has exited') ||
                          errorMessage.includes('ERR_UNHANDLED_ERROR')

  if (isRecorderError) {
    console.warn('[Main] Recorder error handled gracefully - app will continue running')
    // Don't crash the app for recorder errors
    return
  }

  // For other errors, log them but don't crash if possible
  // The app might still be usable even with some errors
  console.error('[Main] Non-fatal error, app will continue running')
})

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[Main] Unhandled promise rejection:', reason)
  console.error('[Main] Promise:', promise)

  // Check if this is a sox/recorder error
  const errorMessage = reason instanceof Error ? reason.message : String(reason)
  const isRecorderError = errorMessage.includes('sox has exited') ||
                          errorMessage.includes('rec has exited') ||
                          errorMessage.includes('arecord has exited')

  if (isRecorderError) {
    console.warn('[Main] Recorder promise rejection handled gracefully')
    return
  }

  // Log but don't crash for unhandled rejections
  console.warn('[Main] Unhandled rejection logged, app will continue running')
})

let mainWindow: BrowserWindow | null = null

// URL for development or path to built files
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Note: On macOS, you may see a harmless error in console:
// "SetApplicationIsDaemon: Error Domain=NSOSStatusErrorDomain Code=-50"
// This is a known Electron/macOS issue and can be safely ignored.
// It occurs when Electron tries to set daemon status but the parameter is invalid.
// The app functions normally despite this message.

// Get the app icon path based on platform and environment
function getIconPath(): string | undefined {
  // macOS handles icons through the app bundle, so we don't need to set it explicitly
  // when packaged. The icon is embedded in the .app bundle.
  if (process.platform === 'darwin' && app.isPackaged) {
    return undefined
  }

  // Determine the icons directory path based on environment
  const iconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'icons')
    : path.join(__dirname, '..', 'resources', 'icons')

  // Select platform-specific icon format
  if (process.platform === 'win32') {
    return path.join(iconsDir, 'icon.ico')
  } else if (process.platform === 'linux') {
    // Linux prefers larger PNGs for better quality on high-DPI displays
    return path.join(iconsDir, '512x512.png')
  } else {
    // macOS in development mode - use ICNS
    return path.join(iconsDir, 'icon.icns')
  }
}

function createWindow() {
  const iconPath = getIconPath()

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    // Set window icon for Windows/Linux taskbar and window decorations
    // On macOS, the icon is handled by the app bundle when packaged
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Initialize database on app ready
app.whenReady().then(async () => {
  // Register custom protocol for local file access
  protocol.handle('local-file', async (request) => {
    try {
      // Extract the file path from the URL
      // request.url will be something like "local-file:///path/to/file" or "local-file://path/to/file"
      const urlString = typeof request.url === 'string' ? request.url : request.url.toString()
      let filePath = urlString.replace(/^local-file:\/\//, '')

      // Strip query parameters (e.g., ?t=123456) used for cache busting
      // This allows the audio player to force fresh loads without affecting file lookup
      const queryParamIndex = filePath.indexOf('?')
      if (queryParamIndex !== -1) {
        filePath = filePath.substring(0, queryParamIndex)
      }

      // Decode URI components in the path
      // Split by '/', decode each segment, then rejoin
      const segments = filePath.split('/').map(segment => {
        if (segment === '') {
          return segment // Empty segments from leading/trailing slashes
        }
        try {
          return decodeURIComponent(segment)
        } catch (e) {
          // If decoding fails for a segment, use it as-is
          console.warn('Failed to decode segment:', segment, e)
          return segment
        }
      })

      filePath = segments.join('/')

      // Normalize path for local-file URLs.
      const isWindowsPath = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.match(/^\/[A-Za-z]:/)
      if (!isWindowsPath && !filePath.startsWith('/')) {
        filePath = `/${filePath}`
      } else if (filePath.startsWith('//')) {
        // Handle double slashes
        filePath = filePath.substring(1)
      }

      // Remove any trailing slashes
      filePath = filePath.replace(/\/+$/, '')

      console.log('[Protocol Handler] Loading audio file:', filePath)
      console.log('[Protocol Handler] Original URL:', urlString)
      console.log('[Protocol Handler] Decoded path segments:', segments)

      // Check if file exists before attempting to read
      if (!existsSync(filePath)) {
        console.error('[Protocol Handler] Audio file does not exist:', filePath)
        console.error('[Protocol Handler] Attempted to load from URL:', urlString)
        return new Response(`File not found: ${filePath}`, {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      // For WAV files, ensure the header is correct before serving
      // This fixes a bug where the WAV header may contain an incorrect data size,
      // causing the audio player to loop at the wrong position instead of playing
      // the full audio. The issue occurs when recording is stopped but the header
      // wasn't properly updated with the final file size.
      const lowerFilePath = filePath.toLowerCase()
      if (lowerFilePath.endsWith('.wav')) {
        try {
          const headerFixed = ensureValidWavHeader(filePath)
          if (headerFixed) {
            console.log('[Protocol Handler] WAV header validated/fixed for:', filePath)
          }
        } catch (wavError) {
          // Log but don't fail - the file might still be playable
          console.warn('[Protocol Handler] WAV header validation error:', wavError)
        }
      }

      // Get file stats first to determine size without reading entire file
      const fileStats = statSync(filePath)
      const fileSize = fileStats.size

      // Validate file size
      if (fileSize === 0) {
        console.error('[Protocol Handler] Audio file is empty:', filePath)
        return new Response('File is empty', {
          status: 400,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      // Determine MIME type based on file extension
      let mimeType = 'application/octet-stream'
      const lowerPath = filePath.toLowerCase()
      if (lowerPath.endsWith('.wav')) {
        mimeType = 'audio/wav'
      } else if (lowerPath.endsWith('.mp3')) {
        mimeType = 'audio/mpeg'
      } else if (lowerPath.endsWith('.m4a')) {
        mimeType = 'audio/mp4'
      } else if (lowerPath.endsWith('.ogg')) {
        mimeType = 'audio/ogg'
      } else if (lowerPath.endsWith('.webm')) {
        mimeType = 'audio/webm'
      } else if (lowerPath.endsWith('.aac')) {
        mimeType = 'audio/aac'
      } else if (lowerPath.endsWith('.flac')) {
        mimeType = 'audio/flac'
      }

      // Check for Range header to support partial content requests (seeking/streaming)
      // This is critical for proper audio playback - without Range support, the browser
      // may cache incomplete portions causing audio to loop incorrectly
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        // Parse the Range header (format: "bytes=start-end" or "bytes=start-")
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/)

        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10)
          // If end is not specified, default to end of file
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1

          // Validate range
          if (start >= fileSize) {
            console.error('[Protocol Handler] Range start beyond file size:', start, '>=', fileSize)
            return new Response('Range Not Satisfiable', {
              status: 416,
              headers: {
                'Content-Range': `bytes */${fileSize}`,
                'Access-Control-Allow-Origin': '*'
              }
            })
          }

          // Clamp end to file size
          const actualEnd = Math.min(end, fileSize - 1)
          const contentLength = actualEnd - start + 1

          console.log('[Protocol Handler] Serving partial content:', filePath,
            `Range: ${start}-${actualEnd}/${fileSize}`, 'MIME type:', mimeType)

          // Read only the requested portion of the file
          const fd = openSync(filePath, 'r')
          const buffer = Buffer.alloc(contentLength)
          readSync(fd, buffer, 0, contentLength, start)
          closeSync(fd)

          return new Response(buffer, {
            status: 206, // Partial Content
            headers: {
              'Content-Type': mimeType,
              'Content-Length': contentLength.toString(),
              'Content-Range': `bytes ${start}-${actualEnd}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache, no-store',
              'X-Content-Type-Options': 'nosniff'
            }
          })
        }
      }

      // No Range header - serve the entire file
      const data = await readFile(filePath)

      console.log('[Protocol Handler] Serving full audio file:', filePath, 'MIME type:', mimeType, 'Size:', data.length)

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': data.length.toString(),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch (error) {
      console.error('[Protocol Handler] Error loading audio file:', error)
      console.error('[Protocol Handler] Request URL:', typeof request.url === 'string' ? request.url : request.url.toString())
      if (error instanceof Error) {
        console.error('[Protocol Handler] Error stack:', error.stack)
      }

      // Provide more specific error messages
      let errorMessage = 'Unknown error'
      let statusCode = 500

      if (error instanceof Error) {
        errorMessage = error.message
        if (error.message.includes('ENOENT')) {
          statusCode = 404
          errorMessage = 'File not found'
        } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
          statusCode = 403
          errorMessage = 'Permission denied'
        }
      }

      return new Response(errorMessage, {
        status: statusCode,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })

  // Initialize binary manager (sox, ffmpeg, etc.)
  // This must be done before any service that uses these binaries (e.g., audioRecorderService)
  console.log('[Main] Initializing binary manager...')
  await binaryManager.initialize()
  console.log('[Main] Binary manager initialized')

  // Initialize database
  initializeDatabase()

  // Initialize default settings
  settingsService.initializeDefaults(defaultSettings)

  // One-time migration: Update existing 'balanced' validation level to 'fast'
  // This ensures existing users get the new default behavior
  const currentValidationLevel = settingsService.get<string>('transcription.startupValidationLevel')
  if (currentValidationLevel === 'balanced') {
    settingsService.set('transcription.startupValidationLevel', 'fast', 'transcription')
    console.log('[Main] Migrated startup validation level from balanced to fast')
  }

  // If HF_TOKEN is set in environment but not in settings, save it to settings
  // This allows users to set the token via environment variable on first run
  const envHfToken = process.env.HF_TOKEN
  const savedHfToken = settingsService.get<string>('transcription.hfToken')
  if (envHfToken && !savedHfToken) {
    settingsService.set('transcription.hfToken', envHfToken, 'transcription')
    console.log('[Main] HF_TOKEN imported from environment variable')
  }

  // Set up IPC handlers for database operations
  setupDatabaseIPC()

  // Set up IPC handlers for recording operations
  setupRecordingIPC()

  // Set up IPC handlers for audio device operations
  setupAudioDeviceIPC()

  // Set up IPC handlers for system audio capture operations
  setupSystemAudioCaptureIPC()

  // Set up IPC handlers for ScreenCaptureKit (macOS 13+ native app audio capture)
  setupScreenCaptureKitIPC()

  // Set up IPC handlers for shell operations
  setupShellIPC()

  // Set up IPC handlers for ML pipeline operations
  setupMlPipelineIPC()

  // Set up IPC handlers for live transcription operations
  setupLiveTranscriptionIPC()

  // Set up IPC handlers for batch diarization operations
  setupDiarizationIPC()

  // Set up IPC handlers for core diarization engine (MANDATORY preprocessing stage)
  setupCoreDiarizationIPC()

  // Set up IPC handlers for streaming diarization (real-time speaker detection)
  setupStreamingDiarizationIPC()

  // Set up IPC handlers for diarization failure service (explicit failure detection)
  await setupDiarizationFailureIPC()

  // Set up IPC handlers for Python environment validation
  setupPythonValidationIPC()

  // Set up IPC handlers for tiered validation (progressive startup validation)
  setupTieredValidationIPC()

  // Set up IPC handlers for model manager (download/manage ML models)
  setupModelManagerIPC()

  // Set up IPC handlers for Python environment setup
  setupPythonSetupIPC()

  // Set up IPC handlers for Python Execution Manager (centralized script execution)
  setupPythonExecutionManagerIPC()

  // Set up IPC handlers for automatic updates
  setupUpdateIPC()

  // Set up IPC handlers for LLM provider detection
  setupLLMProviderIPC()

  // Set up IPC handlers for LLM health check
  setupLLMHealthCheckIPC()

  // Set up IPC handlers for live notes generation
  setupLiveNotesIPC()

  // Set up IPC handlers for subject-aware note generation
  setupSubjectAwareNotesIPC()

  // Set up IPC handlers for transcript correction
  setupTranscriptCorrectionIPC()

  // Set up IPC handlers for confidence scoring
  setupConfidenceScoringIPC()

  // Set up IPC handlers for speaker name detection
  setupSpeakerNameDetectionIPC()

  // Set up IPC handlers for data migration (Meeting Notes -> FlowRecap)
  setupDataMigrationIPC()

  // Initialize LLM provider manager
  initializeLLMProviderManager()

  // Start LLM health check service with default interval (30 seconds)
  startHealthChecks({ intervalMs: 30000, autoStart: true })

  // Create the main window
  createWindow()
})

// Clean up database on quit
app.on('before-quit', () => {
  closeDatabase()
})

// ============================================================================
// Database IPC Handlers
// ============================================================================

function setupDatabaseIPC() {
  // ===== Meeting Handlers =====
  ipcMain.handle('db:meetings:create', (_event, input: CreateMeetingInput) => {
    return meetingService.create(input)
  })

  ipcMain.handle('db:meetings:getById', (_event, id: string) => {
    return meetingService.getById(id)
  })

  ipcMain.handle('db:meetings:getAll', () => {
    return meetingService.getAll()
  })

  ipcMain.handle('db:meetings:update', (_event, id: string, input: UpdateMeetingInput) => {
    return meetingService.update(id, input)
  })

  ipcMain.handle('db:meetings:delete', (_event, id: string) => {
    return meetingService.delete(id)
  })

  ipcMain.handle('db:meetings:getByStatus', (_event, status: MeetingStatus) => {
    return meetingService.getByStatus(status)
  })

  ipcMain.handle('db:meetings:getRecent', (_event, limit: number) => {
    return meetingService.getRecent(limit)
  })

  // ===== Recording Handlers =====
  ipcMain.handle('db:recordings:create', (_event, input: CreateRecordingInput) => {
    return recordingService.create(input)
  })

  ipcMain.handle('db:recordings:getById', (_event, id: string) => {
    return recordingService.getById(id)
  })

  ipcMain.handle('db:recordings:getByMeetingId', (_event, meetingId: string) => {
    return recordingService.getByMeetingId(meetingId)
  })

  ipcMain.handle('db:recordings:update', (_event, id: string, input: UpdateRecordingInput) => {
    return recordingService.update(id, input)
  })

  ipcMain.handle('db:recordings:delete', (_event, id: string) => {
    return recordingService.delete(id)
  })

  // ===== Transcript Handlers =====
  ipcMain.handle('db:transcripts:create', (_event, input: CreateTranscriptInput, options?: { requireSpeaker?: boolean }) => {
    return transcriptService.create(input, options)
  })

  ipcMain.handle('db:transcripts:getById', (_event, id: string) => {
    return transcriptService.getById(id)
  })

  ipcMain.handle('db:transcripts:getByMeetingId', (_event, meetingId: string) => {
    return transcriptService.getByMeetingId(meetingId)
  })

  ipcMain.handle('db:transcripts:delete', (_event, id: string) => {
    return transcriptService.delete(id)
  })

  ipcMain.handle('db:transcripts:deleteByMeetingId', (_event, meetingId: string) => {
    return transcriptService.deleteByMeetingId(meetingId)
  })

  ipcMain.handle('db:transcripts:createBatch', (_event, inputs: CreateTranscriptInput[], options?: { requireSpeaker?: boolean }) => {
    return transcriptService.createBatch(inputs, options)
  })

  // Paginated transcript fetching for lazy loading
  ipcMain.handle('db:transcripts:getByMeetingIdPaginated', (_event, meetingId: string, options?: { limit?: number; offset?: number }) => {
    return transcriptService.getByMeetingIdPaginated(meetingId, options)
  })

  ipcMain.handle('db:transcripts:getCountByMeetingId', (_event, meetingId: string) => {
    return transcriptService.getCountByMeetingId(meetingId)
  })

  // ===== Transcript Search Handlers (FTS5) =====
  ipcMain.handle('db:transcripts:searchInMeeting', (_event, meetingId: string, query: string) => {
    return transcriptService.searchInMeeting(meetingId, query)
  })

  ipcMain.handle('db:transcripts:searchAll', (_event, query: string, limit?: number) => {
    return transcriptService.searchAll(query, limit)
  })

  ipcMain.handle('db:transcripts:getSearchCount', (_event, meetingId: string, query: string) => {
    return transcriptService.getSearchCount(meetingId, query)
  })

  ipcMain.handle('db:transcripts:getMatchingTranscriptIds', (_event, meetingId: string, query: string) => {
    return transcriptService.getMatchingTranscriptIds(meetingId, query)
  })

  // ===== Meeting Notes Handlers =====
  ipcMain.handle('db:meetingNotes:create', (_event, input: CreateMeetingNoteInput) => {
    return meetingNoteService.create(input)
  })

  ipcMain.handle('db:meetingNotes:getById', (_event, id: string) => {
    return meetingNoteService.getById(id)
  })

  ipcMain.handle('db:meetingNotes:getByMeetingId', (_event, meetingId: string) => {
    return meetingNoteService.getByMeetingId(meetingId)
  })

  ipcMain.handle('db:meetingNotes:update', (_event, id: string, input: UpdateMeetingNoteInput) => {
    return meetingNoteService.update(id, input)
  })

  ipcMain.handle('db:meetingNotes:delete', (_event, id: string) => {
    return meetingNoteService.delete(id)
  })

  ipcMain.handle('db:meetingNotes:getByType', (_event, meetingId: string, noteType: NoteType) => {
    return meetingNoteService.getByType(meetingId, noteType)
  })

  // ===== Task Handlers =====
  ipcMain.handle('db:tasks:create', (_event, input: CreateTaskInput) => {
    return taskService.create(input)
  })

  ipcMain.handle('db:tasks:getById', (_event, id: string) => {
    return taskService.getById(id)
  })

  ipcMain.handle('db:tasks:getAll', () => {
    return taskService.getAll()
  })

  ipcMain.handle('db:tasks:getByMeetingId', (_event, meetingId: string) => {
    return taskService.getByMeetingId(meetingId)
  })

  ipcMain.handle('db:tasks:update', (_event, id: string, input: UpdateTaskInput) => {
    return taskService.update(id, input)
  })

  ipcMain.handle('db:tasks:delete', (_event, id: string) => {
    return taskService.delete(id)
  })

  ipcMain.handle('db:tasks:getByStatus', (_event, status: TaskStatus) => {
    return taskService.getByStatus(status)
  })

  ipcMain.handle('db:tasks:getPending', () => {
    return taskService.getPending()
  })

  ipcMain.handle('db:tasks:getByPriority', (_event, priority: TaskPriority) => {
    return taskService.getByPriority(priority)
  })

  ipcMain.handle('db:tasks:getByAssignee', (_event, assignee: string) => {
    return taskService.getByAssignee(assignee)
  })

  ipcMain.handle('db:tasks:getOverdue', () => {
    return taskService.getOverdue()
  })

  ipcMain.handle('db:tasks:complete', (_event, id: string) => {
    return taskService.complete(id)
  })

  // ===== Speaker Handlers =====
  ipcMain.handle('db:speakers:create', (_event, input: CreateSpeakerInput) => {
    return speakerService.create(input)
  })

  ipcMain.handle('db:speakers:getById', (_event, id: string) => {
    return speakerService.getById(id)
  })

  ipcMain.handle('db:speakers:getAll', () => {
    return speakerService.getAll()
  })

  ipcMain.handle('db:speakers:getByIds', (_event, ids: string[]) => {
    return speakerService.getByIds(ids)
  })

  ipcMain.handle('db:speakers:getByMeetingId', (_event, meetingId: string) => {
    return speakerService.getByMeetingId(meetingId)
  })

  ipcMain.handle('db:speakers:update', (_event, id: string, input: UpdateSpeakerInput) => {
    return speakerService.update(id, input)
  })

  ipcMain.handle('db:speakers:delete', (_event, id: string) => {
    return speakerService.delete(id)
  })

  ipcMain.handle('db:speakers:getUser', () => {
    return speakerService.getUser()
  })

  // ===== Meeting Speaker Names Handlers =====
  ipcMain.handle('db:meetingSpeakerNames:getByMeetingId', (_event, meetingId: string) => {
    return meetingSpeakerNameService.getByMeetingId(meetingId)
  })

  ipcMain.handle('db:meetingSpeakerNames:setName', (_event, meetingId: string, speakerId: string, displayName: string) => {
    return meetingSpeakerNameService.setName(meetingId, speakerId, displayName)
  })

  ipcMain.handle('db:meetingSpeakerNames:delete', (_event, meetingId: string, speakerId: string) => {
    return meetingSpeakerNameService.delete(meetingId, speakerId)
  })

  ipcMain.handle('db:meetingSpeakerNames:deleteByMeetingId', (_event, meetingId: string) => {
    return meetingSpeakerNameService.deleteByMeetingId(meetingId)
  })

  // ===== Settings Handlers =====
  ipcMain.handle('db:settings:get', (_event, key: string) => {
    return settingsService.get(key)
  })

  ipcMain.handle('db:settings:set', (_event, key: string, value: unknown, category?: SettingCategory) => {
    return settingsService.set(key, value, category)
  })

  ipcMain.handle('db:settings:delete', (_event, key: string) => {
    return settingsService.delete(key)
  })

  ipcMain.handle('db:settings:getByCategory', (_event, category: SettingCategory) => {
    return settingsService.getByCategory(category)
  })

  ipcMain.handle('db:settings:getAll', () => {
    return settingsService.getAll()
  })

  // ===== Database Utility Handlers =====
  ipcMain.handle('db:utils:backup', (_event, backupPath: string) => {
    return getDatabaseService().backup(backupPath)
  })

  ipcMain.handle('db:utils:getStats', () => {
    return getDatabaseService().getStats()
  })

  ipcMain.handle('db:utils:getSchemaVersion', () => {
    return getDatabaseService().getSchemaVersion()
  })

  ipcMain.handle('db:utils:getMigrationHistory', () => {
    return getDatabaseService().getMigrationHistory()
  })
}

// ============================================================================
// Recording IPC Handlers
// ============================================================================

function setupRecordingIPC() {
  // Start recording
  ipcMain.handle('recording:start', async (_event, meetingId?: string) => {
    return audioRecorderService.startRecording(meetingId)
  })

  // Stop recording
  ipcMain.handle('recording:stop', async () => {
    try {
      const result = await audioRecorderService.stopRecording()

      // Automatically trigger diarization after recording stops
      if (result.success && result.meetingId && result.audioFilePath) {
        console.log('[Main] Recording stopped, triggering automatic diarization...')

        // Update the meeting record with the audio file path BEFORE post-processing
        // This ensures the path is persisted in the database for future access (e.g., manual diarization)
        try {
          meetingService.update(result.meetingId, {
            audio_file_path: result.audioFilePath
          })
          console.log(`[Main] Updated meeting ${result.meetingId} with audio file path: ${result.audioFilePath}`)
        } catch (updateError) {
          console.error('[Main] Failed to update meeting with audio file path:', updateError)
          // Continue with post-processing even if update fails - the path is still in memory
        }

        // Persist live insights to database
        try {
          const liveNotes = liveNoteGenerationService.getCurrentSessionNotes()

          if (liveNotes.length > 0) {
            console.log(`[Main] Persisting ${liveNotes.length} live insights for meeting ${result.meetingId}`)
            const persistenceService = getLiveInsightsPersistenceService()
            const persistResult = await persistenceService.persistLiveInsights(
              result.meetingId,
              liveNotes
            )

            if (persistResult.success) {
              console.log(`[Main] Successfully persisted live insights: ${persistResult.tasksCreated} tasks, ${persistResult.notesCreated} notes`)

              // Notify frontend of successful persistence
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('liveInsights:persisted', {
                  success: true,
                  tasksCreated: persistResult.tasksCreated,
                  notesCreated: persistResult.notesCreated,
                  meetingId: result.meetingId
                })
              }
            } else {
              console.error('[Main] Failed to persist live insights:', persistResult.error)

              // Notify frontend of failure
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('liveInsights:persisted', {
                  success: false,
                  tasksCreated: 0,
                  notesCreated: 0,
                  meetingId: result.meetingId,
                  error: persistResult.error?.message
                })
              }
            }
          } else {
            console.log('[Main] No live insights to persist for meeting', result.meetingId)
          }
        } catch (persistError) {
          console.error('[Main] Exception while persisting live insights:', persistError)
          // Don't block recording completion - log error and continue

          // Notify frontend of failure
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('liveInsights:persisted', {
              success: false,
              tasksCreated: 0,
              notesCreated: 0,
              meetingId: result.meetingId,
              error: persistError instanceof Error ? persistError.message : 'Unknown error'
            })
          }
        }

        // Run diarization and action items extraction in the background (don't block the UI)
        postRecordingProcessor.processRecording(result.meetingId, result.audioFilePath, {
          runDiarization: true,
          runTranscription: false // Transcription already done via live transcription
          // autoExtractActionItems will use the setting value by default
        }).then(processingResult => {
          console.log('[Main] Post-recording processing complete:', processingResult)
          if (mainWindow && !mainWindow.isDestroyed()) {
            // Notify frontend that diarization is complete
            mainWindow.webContents.send('recording:diarizationComplete', {
              meetingId: result.meetingId,
              success: processingResult.diarizationCompleted,
              speakersDetected: processingResult.speakersDetected
            })

            // Notify frontend about auto-extracted action items and created tasks
            if (processingResult.actionItemsExtracted) {
              mainWindow.webContents.send('recording:actionItemsExtracted', {
                meetingId: result.meetingId,
                success: true,
                actionItemsCount: processingResult.actionItemsCount || 0,
                tasksCreated: processingResult.tasksCreated || []
              })
            }
          }
        }).catch(err => {
          console.error('[Main] Post-recording processing failed:', err)
        })
      }

      // Ensure we always return a properly structured result
      return {
        success: result.success,
        meetingId: result.meetingId,
        duration: result.duration,
        audioFilePath: result.audioFilePath,
        error: result.success ? undefined : 'Recording stopped but no audio file was saved'
      }
    } catch (error) {
      console.error('Failed to stop recording:', error)
      return {
        success: false,
        meetingId: null,
        duration: 0,
        audioFilePath: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred while stopping recording'
      }
    }
  })

  // Pause recording
  ipcMain.handle('recording:pause', async () => {
    return audioRecorderService.pauseRecording()
  })

  // Resume recording
  ipcMain.handle('recording:resume', async () => {
    return audioRecorderService.resumeRecording()
  })

  // Get recording status
  ipcMain.handle('recording:getStatus', async () => {
    return audioRecorderService.getStatus()
  })

  // Get recordings directory
  ipcMain.handle('recording:getDirectory', async () => {
    return audioRecorderService.getRecordingsDirectory()
  })

  // List all recordings
  ipcMain.handle('recording:listRecordings', async () => {
    return audioRecorderService.listRecordings()
  })

  // Delete a recording
  ipcMain.handle('recording:deleteRecording', async (_event, filePath: string) => {
    return audioRecorderService.deleteRecording(filePath)
  })

  // Migrate recordings to meeting folders
  ipcMain.handle('recording:migrateToMeetingFolders', async () => {
    return audioRecorderService.migrateRecordingsToMeetingFolders()
  })

  // Manually trigger diarization for a meeting
  ipcMain.handle('recording:runDiarization', async (_event, meetingId: string) => {
    try {
      console.log(`[Main] Manual diarization requested for meeting ${meetingId}`)

      // Get meeting to find audio file path
      const meeting = meetingService.getById(meetingId)
      if (!meeting) {
        return {
          success: false,
          error: 'Meeting not found'
        }
      }

      if (!meeting.audio_file_path) {
        return {
          success: false,
          error: 'Meeting has no audio file'
        }
      }

      // Run diarization
      const result = await postRecordingProcessor.processRecording(meetingId, meeting.audio_file_path, {
        runDiarization: true,
        runTranscription: false
      })

      return {
        success: result.diarizationCompleted,
        speakersDetected: result.speakersDetected,
        error: result.error
      }
    } catch (error) {
      console.error('[Main] Diarization failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Clear speakers for a meeting to allow re-identification
  ipcMain.handle('recording:clearSpeakers', async (_event, meetingId: string) => {
    try {
      console.log(`[Main] Clearing speakers for meeting ${meetingId}`)

      const result = speakerService.clearSpeakersForMeeting(meetingId)

      if (result.success) {
        console.log(`[Main] Cleared ${result.deletedCount} speaker(s) for meeting ${meetingId}`)
      } else {
        console.error(`[Main] Failed to clear speakers: ${result.error}`)
      }

      return result
    } catch (error) {
      console.error('[Main] Clear speakers failed:', error)
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Cancel active diarization process
  ipcMain.handle('recording:cancelDiarization', async () => {
    try {
      console.log('[Main] Cancel diarization requested')
      const result = speakerDiarizationService.cancel()
      console.log(`[Main] Cancel diarization result: ${result.success}`)
      return result
    } catch (error) {
      console.error('[Main] Cancel diarization failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Reset diarization state (for recovering from stuck states)
  ipcMain.handle('recording:resetDiarizationState', async () => {
    try {
      console.log('[Main] Reset diarization state requested')
      resetSpeakerDiarizationState()
      console.log('[Main] Diarization state reset successfully')
      return { success: true }
    } catch (error) {
      console.error('[Main] Reset diarization state failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Get current diarization status
  ipcMain.handle('recording:getDiarizationStatus', async () => {
    try {
      const status = speakerDiarizationService.getStatus()
      return { success: true, status }
    } catch (error) {
      console.error('[Main] Get diarization status failed:', error)
      return { success: false, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Forward real-time audio levels to renderer
  audioRecorderService.onAudioLevel((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:audioLevel', data)
    }
  })

  // Forward audio health status to renderer for proactive warnings
  audioRecorderService.onAudioHealth((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:audioHealth', data)
    }
  })
}

// ============================================================================
// Audio Device IPC Handlers
// ============================================================================

function setupAudioDeviceIPC() {
  // Detect virtual audio cables
  ipcMain.handle('audio:devices:detectVirtualCables', async () => {
    return audioDeviceService.detectVirtualCables()
  })

  // Get all audio devices
  ipcMain.handle('audio:devices:getAll', async () => {
    return audioDeviceService.getAudioDevices()
  })

  // Run full diagnostics
  ipcMain.handle('audio:devices:runDiagnostics', async () => {
    return audioDeviceService.runDiagnostics()
  })

  // Check if specific virtual cable is installed
  ipcMain.handle('audio:devices:isVirtualCableInstalled', async (_event, cableType: VirtualCableType) => {
    return audioDeviceService.isVirtualCableInstalled(cableType)
  })

  // Get recommended virtual cable for current platform
  ipcMain.handle('audio:devices:getRecommendedVirtualCable', async () => {
    return audioDeviceService.getRecommendedVirtualCable()
  })

  // Get installation instructions for virtual cable
  ipcMain.handle('audio:devices:getInstallationInstructions', async (_event, cableType?: VirtualCableType) => {
    return audioDeviceService.getInstallationInstructions(cableType)
  })

  // Attempt to auto-fix common audio issues
  ipcMain.handle('audio:devices:attemptAutoFix', async (_event, issue: string) => {
    return audioDeviceService.attemptAutoFix(issue)
  })
}

// ============================================================================
// System Audio Capture IPC Handlers
// ============================================================================

function setupSystemAudioCaptureIPC() {
  // Get system audio capture capabilities
  ipcMain.handle('systemAudio:getCapabilities', async () => {
    return systemAudioCaptureService.getCapabilities()
  })

  // Start dual recording (microphone + system audio)
  ipcMain.handle('systemAudio:startDualRecording', async (_event, meetingId?: string, config?: DualRecordingConfig) => {
    return systemAudioCaptureService.startDualRecording(meetingId, config)
  })

  // Start system audio only recording
  ipcMain.handle('systemAudio:startSystemAudioRecording', async (_event, meetingId?: string, config?: DualRecordingConfig) => {
    return systemAudioCaptureService.startSystemAudioRecording(meetingId, config)
  })

  // Stop dual recording
  ipcMain.handle('systemAudio:stopDualRecording', async () => {
    return systemAudioCaptureService.stopDualRecording()
  })

  // Pause dual recording
  ipcMain.handle('systemAudio:pauseDualRecording', async () => {
    return systemAudioCaptureService.pauseDualRecording()
  })

  // Resume dual recording
  ipcMain.handle('systemAudio:resumeDualRecording', async () => {
    return systemAudioCaptureService.resumeDualRecording()
  })

  // Get dual recording status
  ipcMain.handle('systemAudio:getStatus', async () => {
    return systemAudioCaptureService.getStatus()
  })

  // Get available audio sources
  ipcMain.handle('systemAudio:getAvailableSources', async () => {
    return systemAudioCaptureService.getAvailableSources()
  })

  // ScreenCaptureKit-enhanced methods (integrated into systemAudio namespace)
  // Get ScreenCaptureKit capabilities
  ipcMain.handle('systemAudio:getScreenCaptureKitCapabilities', async () => {
    return systemAudioCaptureService.getScreenCaptureKitCapabilities()
  })

  // Request screen recording permission for ScreenCaptureKit
  ipcMain.handle('systemAudio:requestScreenRecordingPermission', async () => {
    return systemAudioCaptureService.requestScreenRecordingPermission()
  })

  // Get list of running apps that can be captured
  ipcMain.handle('systemAudio:getCapturableApps', async () => {
    return systemAudioCaptureService.getCapturableApps()
  })

  // Get list of running meeting apps
  ipcMain.handle('systemAudio:getRunningMeetingApps', async () => {
    return systemAudioCaptureService.getRunningMeetingApps()
  })

  // Check if ScreenCaptureKit should be used
  ipcMain.handle('systemAudio:shouldUseScreenCaptureKit', async () => {
    return systemAudioCaptureService.shouldUseScreenCaptureKit()
  })

  // Start app audio capture (uses ScreenCaptureKit or falls back to virtual cable)
  ipcMain.handle('systemAudio:startAppAudioCapture', async (_event, meetingId?: string, config?: {
    targetApps?: string[]
    sampleRate?: number
    channels?: number
  }) => {
    return systemAudioCaptureService.startAppAudioCapture(meetingId, config)
  })

  // Stop app audio capture
  ipcMain.handle('systemAudio:stopAppAudioCapture', async () => {
    return systemAudioCaptureService.stopAppAudioCapture()
  })

  // Get app audio capture status
  ipcMain.handle('systemAudio:getAppAudioCaptureStatus', async () => {
    return systemAudioCaptureService.getAppAudioCaptureStatus()
  })

  // Get list of known meeting app bundle identifiers
  ipcMain.handle('systemAudio:getMeetingAppBundles', async () => {
    return systemAudioCaptureService.getMeetingAppBundles()
  })
}

// ============================================================================
// ScreenCaptureKit IPC Handlers (macOS 13+ native app audio capture)
// ============================================================================

function setupScreenCaptureKitIPC() {
  // Get ScreenCaptureKit capabilities directly
  ipcMain.handle('screenCaptureKit:getCapabilities', async () => {
    return screenCaptureKitService.getCapabilities()
  })

  // Request screen recording permission
  ipcMain.handle('screenCaptureKit:requestPermission', async () => {
    return screenCaptureKitService.requestPermission()
  })

  // Get list of capturable apps
  ipcMain.handle('screenCaptureKit:getCapturableApps', async () => {
    return screenCaptureKitService.getCapturableApps()
  })

  // Get running meeting apps
  ipcMain.handle('screenCaptureKit:getRunningMeetingApps', async () => {
    return screenCaptureKitService.getRunningMeetingApps()
  })

  // Start capture
  ipcMain.handle('screenCaptureKit:startCapture', async (_event, meetingId?: string, config?: ScreenCaptureKitConfig) => {
    return screenCaptureKitService.startCapture(meetingId, config)
  })

  // Stop capture
  ipcMain.handle('screenCaptureKit:stopCapture', async () => {
    return screenCaptureKitService.stopCapture()
  })

  // Get capture status
  ipcMain.handle('screenCaptureKit:getStatus', async () => {
    return screenCaptureKitService.getStatus()
  })

  // Check if ScreenCaptureKit should be preferred
  ipcMain.handle('screenCaptureKit:shouldUse', async () => {
    return screenCaptureKitService.shouldUseScreenCaptureKit()
  })

  // Get list of known meeting app bundles
  ipcMain.handle('screenCaptureKit:getMeetingAppBundles', async () => {
    return screenCaptureKitService.getMeetingAppBundles()
  })
}

// ============================================================================
// Shell IPC Handlers
// ============================================================================

function setupShellIPC() {
  // Open external URL
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  // Open file path in system file explorer
  ipcMain.handle('shell:openPath', async (_event, path: string) => {
    return shell.openPath(path)
  })

  // Get file stats
  ipcMain.handle('shell:getFileStats', async (_event, filePath: string) => {
    const fs = require('fs')
    try {
      const stats = fs.statSync(filePath)
      return {
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        ctime: stats.ctime.toISOString()
      }
    } catch (error) {
      throw new Error(`Failed to get file stats: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // Select directory dialog
  ipcMain.handle('shell:selectDirectory', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || app.getPath('documents'),
      title: 'Select Recordings Folder',
      buttonLabel: 'Select Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}

// ============================================================================
// ML Pipeline IPC Handlers
// ============================================================================

function setupMlPipelineIPC() {
  // Transcribe an audio file
  ipcMain.handle('mlPipeline:transcribe', async (_event, audioPath: string, config?: TranscriptionConfig) => {
    // Set up progress forwarding to renderer
    const unsubscribe = mlPipelineService.onProgress((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mlPipeline:progress', progress)
      }
    })

    try {
      return await mlPipelineService.transcribe(audioPath, config)
    } finally {
      unsubscribe()
    }
  })

  // Perform speaker diarization
  ipcMain.handle('mlPipeline:diarize', async (_event, audioPath: string, config?: DiarizationConfig) => {
    // Set up progress forwarding to renderer
    const unsubscribe = mlPipelineService.onProgress((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mlPipeline:progress', progress)
      }
    })

    try {
      return await mlPipelineService.diarize(audioPath, config)
    } finally {
      unsubscribe()
    }
  })

  // Run complete pipeline (transcription + diarization)
  ipcMain.handle('mlPipeline:processComplete', async (
    _event,
    audioPath: string,
    transcriptionConfig?: TranscriptionConfig,
    diarizationConfig?: DiarizationConfig
  ) => {
    // Set up progress forwarding to renderer
    const unsubscribe = mlPipelineService.onProgress((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mlPipeline:progress', progress)
      }
    })

    try {
      return await mlPipelineService.processComplete(audioPath, transcriptionConfig, diarizationConfig)
    } finally {
      unsubscribe()
    }
  })

  // Cancel a running job
  ipcMain.handle('mlPipeline:cancel', async (_event, jobId: string) => {
    return mlPipelineService.cancel(jobId)
  })

  // Get pipeline status
  ipcMain.handle('mlPipeline:getStatus', async () => {
    return mlPipelineService.getStatus()
  })

  // Check Python dependencies
  ipcMain.handle('mlPipeline:checkDependencies', async () => {
    return mlPipelineService.checkDependencies()
  })

  // Get available models
  ipcMain.handle('mlPipeline:getAvailableModels', async () => {
    return mlPipelineService.getAvailableModels()
  })

  // Get supported languages
  ipcMain.handle('mlPipeline:getSupportedLanguages', async () => {
    return mlPipelineService.getSupportedLanguages()
  })
}

// ============================================================================
// Live Transcription IPC Handlers
// ============================================================================

function setupLiveTranscriptionIPC() {
  // Set up progress subscription for the entire app lifecycle
  // This forwards all progress events to the renderer
  liveTranscriptionService.onProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('liveTranscription:progress', progress)
    }
  })

  // Set up segment subscription for the entire app lifecycle
  // This forwards new transcript segments to the renderer in real-time
  liveTranscriptionService.onSegment((segment) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('liveTranscription:segment', segment)
    }
  })

  // Set up diarization status subscription for the entire app lifecycle
  // This forwards diarization availability/error status to the renderer
  // CRITICAL: This enables the UI to show proper error messages when diarization fails
  // (e.g., due to missing HF_TOKEN for pyannote/embedding model)
  liveTranscriptionService.onDiarizationStatus((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('liveTranscription:diarizationStatus', status)

      // Log the status for debugging
      if (status.available) {
        console.log('[Main] Diarization available:', status.capabilities?.embedding_backend)
      } else {
        console.warn('[Main] Diarization unavailable:', status.reason, status.message)
      }
    }
  })

  // Start a live transcription session
  ipcMain.handle('liveTranscription:startSession', async (
    _event,
    meetingId: string,
    audioPath: string,
    config?: LiveTranscriptionConfig
  ) => {
    console.log('[Main] liveTranscription:startSession', { meetingId, audioPath, config })
    const result = await liveTranscriptionService.startSession(meetingId, audioPath, config)
    console.log('[Main] liveTranscription:startSession result:', result)
    return result
  })

  // Transcribe a chunk of audio
  ipcMain.handle('liveTranscription:transcribeChunk', async (
    _event,
    audioPath: string,
    config?: {
      language?: string
      modelSize?: 'tiny' | 'base' | 'small'
      startTimeMs?: number
    }
  ) => {
    console.log('[Main] liveTranscription:transcribeChunk', { audioPath, config })
    const result = await liveTranscriptionService.transcribeChunk(audioPath, config)
    console.log('[Main] liveTranscription:transcribeChunk result:', { success: result.success, segmentCount: result.segments?.length })
    return result
  })

  // Pause live transcription
  ipcMain.handle('liveTranscription:pause', async () => {
    return liveTranscriptionService.pause()
  })

  // Resume live transcription
  ipcMain.handle('liveTranscription:resume', async () => {
    return liveTranscriptionService.resume()
  })

  // Stop live transcription session
  ipcMain.handle('liveTranscription:stopSession', async () => {
    return liveTranscriptionService.stopSession()
  })

  // Get current status
  ipcMain.handle('liveTranscription:getStatus', async () => {
    return liveTranscriptionService.getStatus()
  })

  // Check if live transcription is available
  ipcMain.handle('liveTranscription:isAvailable', async () => {
    return liveTranscriptionService.isAvailable()
  })

  // Force reset transcription state (for recovery from stuck states)
  ipcMain.handle('liveTranscription:forceReset', async () => {
    console.log('[Main] liveTranscription:forceReset')
    return liveTranscriptionService.forceReset()
  })

  // Get audio diagnostics for debugging transcription issues
  ipcMain.handle('liveTranscription:getAudioDiagnostics', async () => {
    return liveTranscriptionService.getAudioDiagnostics()
  })
}

// ============================================================================
// Batch Diarization IPC Handlers
// ============================================================================

function setupDiarizationIPC() {
  // Process a single meeting to add speaker labels
  ipcMain.handle('diarization:processMeeting', async (
    _event,
    meetingId: string,
    options?: BatchDiarizationOptions
  ) => {
    console.log('[Main] diarization:processMeeting', { meetingId, options })

    // Set up progress forwarding if callback is expected
    const optionsWithProgress: BatchDiarizationOptions = {
      ...options,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('diarization:progress', progress)
        }
        options?.onProgress?.(progress)
      }
    }

    const result = await batchDiarizationService.processMeeting(meetingId, optionsWithProgress)
    console.log('[Main] diarization:processMeeting result:', result)
    return result
  })

  // Process multiple meetings in batch
  ipcMain.handle('diarization:processMeetings', async (
    _event,
    meetingIds: string[],
    options?: BatchDiarizationOptions
  ) => {
    console.log('[Main] diarization:processMeetings', { count: meetingIds.length, options })

    // Set up progress forwarding
    const optionsWithProgress: BatchDiarizationOptions = {
      ...options,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('diarization:progress', progress)
        }
        options?.onProgress?.(progress)
      }
    }

    const result = await batchDiarizationService.processMeetings(meetingIds, optionsWithProgress)
    console.log('[Main] diarization:processMeetings result:', result)
    return result
  })
}

// ============================================================================
// Core Diarization Engine IPC Handlers (MANDATORY preprocessing stage)
// ============================================================================

function setupCoreDiarizationIPC() {
  // Initialize the core diarization engine
  // BLOCKING: If required=true and initialization fails, returns error
  ipcMain.handle('coreDiarization:initialize', async (
    _event,
    config?: CoreDiarizationConfig
  ) => {
    console.log('[Main] coreDiarization:initialize', config)
    try {
      const result = await coreDiarizationService.initialize(config)
      console.log('[Main] coreDiarization:initialize result:', result)
      return result
    } catch (error) {
      console.error('[Main] coreDiarization:initialize error:', error)
      // Return error information instead of throwing to prevent IPC issues
      return {
        available: false,
        initialized: false,
        device: 'none',
        pyannoteInstalled: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Diarization initialization failed'
      }
    }
  })

  // Process an audio file through the diarization engine
  // This should be called BEFORE transcription in the pipeline
  ipcMain.handle('coreDiarization:processAudioFile', async (
    _event,
    audioPath: string,
    config?: CoreDiarizationConfig
  ) => {
    console.log('[Main] coreDiarization:processAudioFile', { audioPath, config })
    try {
      const result = await coreDiarizationService.processAudioFile(audioPath, config)
      console.log('[Main] coreDiarization:processAudioFile result:', {
        success: result.success,
        num_speakers: result.num_speakers,
        segments: result.segments.length
      })
      return result
    } catch (error) {
      console.error('[Main] coreDiarization:processAudioFile error:', error)
      return {
        success: false,
        segments: [],
        num_speakers: 0,
        speaker_ids: [],
        audio_duration: 0,
        processing_time: 0,
        error: error instanceof Error ? error.message : String(error),
        error_code: 'PROCESSING_ERROR'
      }
    }
  })

  // Get the status of the core diarization engine
  ipcMain.handle('coreDiarization:getStatus', async () => {
    return coreDiarizationService.getStatus()
  })

  // Check if diarization is available
  ipcMain.handle('coreDiarization:isAvailable', async () => {
    return coreDiarizationService.isAvailable()
  })

  // Get speaker for a time range (used to assign speakers to transcription segments)
  ipcMain.handle('coreDiarization:getSpeakerForTimeRange', async (
    _event,
    startTime: number,
    endTime: number,
    segments: Array<{
      speaker_id: string
      start_time: number
      end_time: number
      duration: number
      confidence: number
    }>
  ) => {
    return coreDiarizationService.getSpeakerForTimeRange(startTime, endTime, segments)
  })

  // Cancel any ongoing diarization process
  ipcMain.handle('coreDiarization:cancel', async () => {
    return coreDiarizationService.cancel()
  })

  // Reset the service state
  ipcMain.handle('coreDiarization:reset', async () => {
    coreDiarizationService.reset()
    return { success: true }
  })
}

// ============================================================================
// Streaming Diarization IPC Handlers (Real-time speaker detection)
// ============================================================================

function setupStreamingDiarizationIPC() {
  // Set up event subscriptions for real-time speaker segments
  streamingDiarizationService.onSpeakerSegment((segment) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('streamingDiarization:segment', segment)
    }
  })

  // Forward speaker change events
  streamingDiarizationService.onSpeakerChange((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('streamingDiarization:speakerChange', event)
    }
  })

  // Forward status updates
  streamingDiarizationService.onStatus((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('streamingDiarization:status', status)
    }
  })

  // Forward retroactive corrections
  streamingDiarizationService.onCorrection((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('streamingDiarization:correction', event)
    }
  })

  // Forward speaker statistics updates
  streamingDiarizationService.onStats((stats) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('streamingDiarization:stats', stats)
    }
  })

  // Start a streaming diarization session
  ipcMain.handle('streamingDiarization:startSession', async (
    _event,
    meetingId: string,
    config?: StreamingDiarizationConfig
  ) => {
    console.log('[Main] streamingDiarization:startSession', { meetingId, config })
    const result = await streamingDiarizationService.startSession(meetingId, config)
    console.log('[Main] streamingDiarization:startSession result:', result)
    return result
  })

  // Send an audio chunk for diarization processing
  ipcMain.handle('streamingDiarization:sendAudioChunk', async (
    _event,
    audioData: ArrayBuffer
  ) => {
    return streamingDiarizationService.sendAudioChunk(Buffer.from(audioData))
  })

  // Get speaker assignment for a time range (for matching with transcription)
  ipcMain.handle('streamingDiarization:getSpeakerForTimeRange', async (
    _event,
    startTime: number,
    endTime: number
  ) => {
    return streamingDiarizationService.getSpeakerForTimeRange(startTime, endTime)
  })

  // Get all speaker segments
  ipcMain.handle('streamingDiarization:getSegments', async () => {
    return streamingDiarizationService.getSegments()
  })

  // Get speaker statistics
  ipcMain.handle('streamingDiarization:getSpeakerStats', async () => {
    return streamingDiarizationService.getSpeakerStats()
  })

  // Pause diarization
  ipcMain.handle('streamingDiarization:pause', async () => {
    return streamingDiarizationService.pause()
  })

  // Resume diarization
  ipcMain.handle('streamingDiarization:resume', async () => {
    return streamingDiarizationService.resume()
  })

  // Stop streaming diarization session
  ipcMain.handle('streamingDiarization:stopSession', async () => {
    console.log('[Main] streamingDiarization:stopSession')
    const result = await streamingDiarizationService.stopSession()
    console.log('[Main] streamingDiarization:stopSession result:', {
      success: result.success,
      segments: result.segments.length,
      speakers: Object.keys(result.stats).length
    })
    return result
  })

  // Get current status
  ipcMain.handle('streamingDiarization:getStatus', async () => {
    return streamingDiarizationService.getStatus()
  })

  // Check if streaming diarization is available
  ipcMain.handle('streamingDiarization:isAvailable', async () => {
    return streamingDiarizationService.isAvailable()
  })

  // Force reset the service state
  ipcMain.handle('streamingDiarization:forceReset', async () => {
    console.log('[Main] streamingDiarization:forceReset')
    return streamingDiarizationService.forceReset()
  })
}

// ============================================================================
// Diarization Failure Service IPC Handlers (Explicit Failure Detection)
// ============================================================================

async function setupDiarizationFailureIPC() {
  // Set up failure event subscription for the entire app lifecycle
  // This forwards failure events to the renderer for immediate display
  diarizationFailureService.onFailure((failure) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Forwarding diarization failure to renderer:', failure.id)
      mainWindow.webContents.send('diarizationFailure:failure', failure)
    }
  })

  // Forward notification events
  diarizationFailureService.onNotification((notification) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Forwarding diarization failure notification:', notification.failureId)
      mainWindow.webContents.send('diarizationFailure:notification', notification)
    }
  })

  // Record a diarization failure
  ipcMain.handle('diarizationFailure:recordFailure', async (
    _event,
    params: {
      errorCode?: string
      errorMessage?: string
      meetingId?: string
      audioPath?: string
      pythonOutput?: string
      stackTrace?: string
    }
  ) => {
    console.log('[Main] diarizationFailure:recordFailure', params)
    const failure = diarizationFailureService.recordFailure(params)
    return failure
  })

  // Generate notification for a failure
  ipcMain.handle('diarizationFailure:generateNotification', async (
    _event,
    failureId: string
  ) => {
    console.log('[Main] diarizationFailure:generateNotification', failureId)
    const failure = diarizationFailureService.getFailureById(failureId)
    if (failure) {
      return diarizationFailureService.generateNotification(failure)
    }
    return null
  })

  // Acknowledge a failure
  ipcMain.handle('diarizationFailure:acknowledge', async (
    _event,
    failureId: string
  ) => {
    console.log('[Main] diarizationFailure:acknowledge', failureId)
    return diarizationFailureService.acknowledgeFailure(failureId)
  })

  // Get recent failures
  ipcMain.handle('diarizationFailure:getRecentFailures', async (
    _event,
    count?: number
  ) => {
    return diarizationFailureService.getRecentFailures(count)
  })

  // Get unacknowledged failures
  ipcMain.handle('diarizationFailure:getUnacknowledged', async () => {
    return diarizationFailureService.getUnacknowledgedFailures()
  })

  // Check for unacknowledged failures
  ipcMain.handle('diarizationFailure:hasUnacknowledged', async () => {
    return diarizationFailureService.hasUnacknowledgedFailures()
  })

  // Get the mandatory failure message
  ipcMain.handle('diarizationFailure:getMessage', async () => {
    return diarizationFailureService.getFailureMessage()
  })

  // Validate that a result is not a silent fallback
  ipcMain.handle('diarizationFailure:validateNotSilentFallback', async (
    _event,
    result: {
      success: boolean
      segments?: any[]
      numSpeakers?: number
      speakers?: string[]
      error?: string
    }
  ) => {
    return diarizationFailureService.validateNotSilentFallback(result)
  })

  // Get failure count
  ipcMain.handle('diarizationFailure:getCount', async () => {
    return diarizationFailureService.getFailureCount()
  })

  // Export failures as JSON
  ipcMain.handle('diarizationFailure:export', async () => {
    return diarizationFailureService.exportAsJson()
  })

  // Clear all failures (for testing)
  ipcMain.handle('diarizationFailure:clear', async () => {
    diarizationFailureService.clear()
    return { success: true }
  })

  // Get/set transcription-only mode preference
  ipcMain.handle('diarizationFailure:getTranscriptionOnlyMode', async () => {
    try {
      const disabled = await settingsService.get('transcription.diarization.disabled')
      const acknowledged = await settingsService.get('transcription.diarization.transcriptionOnlyAcknowledged')
      return {
        diarizationDisabled: disabled ?? false,
        transcriptionOnlyAcknowledged: acknowledged ?? false
      }
    } catch (err) {
      console.error('[Main] Failed to get transcription-only mode:', err)
      return {
        diarizationDisabled: false,
        transcriptionOnlyAcknowledged: false
      }
    }
  })

  ipcMain.handle('diarizationFailure:setTranscriptionOnlyMode', async (
    _event,
    enabled: boolean,
    reason?: string
  ) => {
    console.log('[Main] diarizationFailure:setTranscriptionOnlyMode', { enabled, reason })
    try {
      await settingsService.set('transcription.diarization.disabled', enabled, 'transcription')
      await settingsService.set('transcription.diarization.transcriptionOnlyAcknowledged', enabled, 'transcription')
      if (reason) {
        await settingsService.set('transcription.diarization.disableReason', reason, 'transcription')
      }
      return { success: true }
    } catch (err) {
      console.error('[Main] Failed to set transcription-only mode:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ============================================================================
  // Diarization Health Monitor API (Real-time health monitoring and fallback)
  // ============================================================================

  // Import diarization health monitor and fallback services dynamically
  const { diarizationHealthMonitor } = await import('./services/diarizationHealthMonitor')
  const { diarizationFallbackService } = await import('./services/diarizationFallbackService')

  // Forward health change events to renderer
  diarizationHealthMonitor.onHealthChange((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Forwarding diarization health change:', event.status)
      mainWindow.webContents.send('diarizationHealth:change', event)
    }
  })

  // Forward recovery queued events to renderer
  diarizationHealthMonitor.onRecoveryQueued((job) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Forwarding recovery queued event:', job.meetingId)
      mainWindow.webContents.send('diarizationHealth:recoveryQueued', job)
    }
  })

  // Forward recovery progress events to renderer
  diarizationFallbackService.onRecoveryProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('diarizationHealth:recoveryProgress', progress)
    }
  })

  // Start health monitoring
  ipcMain.handle('diarizationHealth:startMonitoring', async (_event, meetingId: string) => {
    console.log('[Main] diarizationHealth:startMonitoring', meetingId)
    try {
      diarizationHealthMonitor.startMonitoring(meetingId)
      diarizationFallbackService.initialize(meetingId)
      return { success: true }
    } catch (err) {
      console.error('[Main] Failed to start health monitoring:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Stop health monitoring
  ipcMain.handle('diarizationHealth:stopMonitoring', async () => {
    console.log('[Main] diarizationHealth:stopMonitoring')
    try {
      diarizationHealthMonitor.stopMonitoring()
      diarizationFallbackService.cleanup()
      return { success: true }
    } catch (err) {
      console.error('[Main] Failed to stop health monitoring:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Report segment detected
  ipcMain.handle('diarizationHealth:reportSegment', async (_event, speaker: string) => {
    diarizationHealthMonitor.reportSegment(speaker)
    return { success: true }
  })

  // Report speaker count
  ipcMain.handle('diarizationHealth:reportSpeakerCount', async (_event, count: number) => {
    diarizationHealthMonitor.reportSpeakerCount(count)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('diarizationHealth:speakerCount', count)
    }
    return { success: true }
  })

  // Report initialization complete
  ipcMain.handle('diarizationHealth:reportInitialized', async () => {
    diarizationHealthMonitor.reportInitialized()
    return { success: true }
  })

  // Report error
  ipcMain.handle('diarizationHealth:reportError', async (_event, error: string, reason?: string) => {
    diarizationHealthMonitor.reportError(error, reason as any)
    return { success: true }
  })

  // Report unavailable
  ipcMain.handle('diarizationHealth:reportUnavailable', async (_event, reason: string) => {
    diarizationHealthMonitor.reportUnavailable(reason)
    return { success: true }
  })

  // Get current status
  ipcMain.handle('diarizationHealth:getStatus', async () => {
    return diarizationHealthMonitor.getStatus()
  })

  // Get health stats
  ipcMain.handle('diarizationHealth:getStats', async () => {
    return diarizationHealthMonitor.getStats()
  })

  // Get status for UI
  ipcMain.handle('diarizationHealth:getStatusForUI', async () => {
    return diarizationFallbackService.getStatusForUI()
  })

  // Set skip preference
  ipcMain.handle('diarizationHealth:setSkipPreference', async (_event, skip: boolean) => {
    diarizationHealthMonitor.setSkipPreference(skip)
    await settingsService.set('diarization.skipEnabled', skip, 'audio')
    return { success: true }
  })

  // Get skip preference
  ipcMain.handle('diarizationHealth:getSkipPreference', async () => {
    const pref = await settingsService.get('diarization.skipEnabled')
    return pref ?? false
  })

  // Schedule recovery
  ipcMain.handle('diarizationHealth:scheduleRecovery', async (_event, meetingId: string) => {
    diarizationFallbackService.schedulePostMeetingRecovery()
    return { success: true }
  })

  // Trigger manual recovery
  ipcMain.handle('diarizationHealth:triggerRecovery', async (_event, meetingId: string) => {
    console.log('[Main] diarizationHealth:triggerRecovery', meetingId)
    return await diarizationFallbackService.triggerPostMeetingRecovery(meetingId)
  })

  // Get pending recovery jobs
  ipcMain.handle('diarizationHealth:getPendingRecoveryJobs', async () => {
    return diarizationHealthMonitor.getPendingRecoveryJobs()
  })

  // Get capabilities
  ipcMain.handle('diarizationHealth:getCapabilities', async () => {
    try {
      const { streamingDiarizationService } = await import('./services/streamingDiarizationService')
      const availability = await streamingDiarizationService.isAvailable()
      const savedHfToken = settingsService.get<string>('transcription.hfToken') || ''
      return {
        available: availability.available,
        pyannoteInstalled: availability.available,
        huggingFaceConfigured: savedHfToken.trim().length > 0,
        device: 'auto',
        error: availability.error
      }
    } catch (err) {
      return {
        available: false,
        pyannoteInstalled: false,
        huggingFaceConfigured: false,
        device: 'unknown',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Retry diarization
  ipcMain.handle('diarizationHealth:retry', async () => {
    console.log('[Main] diarizationHealth:retry')
    // Reset health state and let streaming diarization reinitialize
    diarizationHealthMonitor.reset()
    return { success: true }
  })

  // Skip diarization
  ipcMain.handle('diarizationHealth:skip', async () => {
    console.log('[Main] diarizationHealth:skip')
    diarizationHealthMonitor.setSkipPreference(true)
    await settingsService.set('diarization.skipEnabled', true, 'audio')
    return { success: true }
  })
}

// ============================================================================
// Python Environment Validation IPC Handlers
// ============================================================================

function setupPythonValidationIPC() {
  // Run comprehensive validation
  ipcMain.handle('pythonValidation:validate', async (_event, forceRefresh = false) => {
    console.log('[Main] pythonValidation:validate', { forceRefresh })
    try {
      return await pythonEnvironmentValidator.validateEnvironment(forceRefresh)
    } catch (error) {
      console.error('[Main] Error validating Python environment:', error)
      throw error
    }
  })

  // Attempt automatic repair
  ipcMain.handle('pythonValidation:autoRepair', async () => {
    console.log('[Main] pythonValidation:autoRepair')
    try {
      return await pythonEnvironmentValidator.attemptAutoRepair()
    } catch (error) {
      console.error('[Main] Error during auto-repair:', error)
      throw error
    }
  })

  // Clear validation cache
  ipcMain.handle('pythonValidation:clearCache', async () => {
    console.log('[Main] pythonValidation:clearCache')
    pythonEnvironmentValidator.clearCache()
    return { success: true }
  })

  // Get cache statistics
  ipcMain.handle('pythonValidation:getCacheStats', async () => {
    console.log('[Main] pythonValidation:getCacheStats')
    try {
      return pythonEnvironmentValidator.getCacheStats()
    } catch (error) {
      console.error('[Main] Error getting cache stats:', error)
      return {
        smartCheckingEnabled: true,
        hasCache: false,
        lastValidated: null,
        cacheAgeHours: null,
        hashesMatch: false,
        cachedStatus: null
      }
    }
  })

  // Set smart environment checking enabled/disabled
  ipcMain.handle('pythonValidation:setSmartChecking', async (_event, enabled: boolean) => {
    console.log('[Main] pythonValidation:setSmartChecking', { enabled })
    try {
      pythonEnvironmentValidator.setSmartCheckingEnabled(enabled)
      return { success: true }
    } catch (error) {
      console.error('[Main] Error setting smart checking:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Start venv file system watchers
  ipcMain.handle('pythonValidation:startWatchers', async () => {
    console.log('[Main] pythonValidation:startWatchers')
    try {
      pythonEnvironmentValidator.startVenvWatchers()
      return { success: true }
    } catch (error) {
      console.error('[Main] Error starting watchers:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Stop venv file system watchers
  ipcMain.handle('pythonValidation:stopWatchers', async () => {
    console.log('[Main] pythonValidation:stopWatchers')
    try {
      pythonEnvironmentValidator.stopVenvWatchers()
      return { success: true }
    } catch (error) {
      console.error('[Main] Error stopping watchers:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Forward validation events to renderer
  pythonEnvironmentValidator.on('validation:start', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pythonValidation:start')
    }
  })

  pythonEnvironmentValidator.on('validation:complete', (result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pythonValidation:complete', result)
    }
  })

  pythonEnvironmentValidator.on('repair:start', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pythonValidation:repairStart')
    }
  })

  pythonEnvironmentValidator.on('repair:complete', (result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pythonValidation:repairComplete', result)
    }
  })
}

// ============================================================================
// Tiered Validation Service IPC Handlers
// ============================================================================

function setupTieredValidationIPC() {
  // Run Tier 1 validation (fast startup check)
  ipcMain.handle('tieredValidation:runTier1', async () => {
    console.log('[Main] tieredValidation:runTier1')
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return await tieredValidationService.runTier1Validation()
    } catch (error) {
      console.error('[Main] Tier 1 validation failed:', error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Run Tier 2 validation (background, after UI loads)
  ipcMain.handle('tieredValidation:runTier2', async () => {
    console.log('[Main] tieredValidation:runTier2')
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return await tieredValidationService.runTier2Validation()
    } catch (error) {
      console.error('[Main] Tier 2 validation failed:', error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Run Tier 3 validation (on-demand, when feature used)
  ipcMain.handle('tieredValidation:runTier3', async (_event, feature: 'transcription' | 'diarization') => {
    console.log('[Main] tieredValidation:runTier3', { feature })
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return await tieredValidationService.runTier3Validation(feature)
    } catch (error) {
      console.error('[Main] Tier 3 validation failed:', error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Run full validation based on validation level setting
  ipcMain.handle('tieredValidation:runFull', async (_event, forceLevel?: 'fast' | 'balanced' | 'thorough') => {
    console.log('[Main] tieredValidation:runFull', { forceLevel })
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return await tieredValidationService.runFullValidation(forceLevel)
    } catch (error) {
      console.error('[Main] Full validation failed:', error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Get current validation state
  ipcMain.handle('tieredValidation:getState', async () => {
    console.log('[Main] tieredValidation:getState')
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return tieredValidationService.getState()
    } catch (error) {
      console.error('[Main] Failed to get validation state:', error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Get validation level setting
  ipcMain.handle('tieredValidation:getLevel', async () => {
    console.log('[Main] tieredValidation:getLevel')
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return tieredValidationService.getValidationLevel()
    } catch (error) {
      console.error('[Main] Failed to get validation level:', error)
      return 'balanced' // Default
    }
  })

  // Set validation level setting
  ipcMain.handle('tieredValidation:setLevel', async (_event, level: 'fast' | 'balanced' | 'thorough') => {
    console.log('[Main] tieredValidation:setLevel', { level })
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      tieredValidationService.setValidationLevel(level)
      return { success: true }
    } catch (error) {
      console.error('[Main] Failed to set validation level:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Get validation metrics history
  ipcMain.handle('tieredValidation:getMetrics', async () => {
    console.log('[Main] tieredValidation:getMetrics')
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      return {
        history: tieredValidationService.getMetricsHistory(),
        latest: tieredValidationService.getLatestMetrics()
      }
    } catch (error) {
      console.error('[Main] Failed to get validation metrics:', error)
      return { history: [], latest: null }
    }
  })

  // Clear validation state
  ipcMain.handle('tieredValidation:clearState', async () => {
    console.log('[Main] tieredValidation:clearState')
    try {
      const { tieredValidationService } = await import('./services/tieredValidationService')
      tieredValidationService.clearState()
      return { success: true }
    } catch (error) {
      console.error('[Main] Failed to clear validation state:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Forward tiered validation events to renderer
  import('./services/tieredValidationService').then(({ tieredValidationService }) => {
    tieredValidationService.on('tier1:start', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:tier1Start')
      }
    })

    tieredValidationService.on('tier1:complete', (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:tier1Complete', result)
      }
    })

    tieredValidationService.on('tier2:start', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:tier2Start')
      }
    })

    tieredValidationService.on('tier2:complete', (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:tier2Complete', result)
      }
    })

    tieredValidationService.on('tier3:start', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:tier3Start', data)
      }
    })

    tieredValidationService.on('tier3:complete', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:tier3Complete', data)
      }
    })

    tieredValidationService.on('validation:complete', (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:complete', result)
      }
    })

    tieredValidationService.on('settings:changed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tieredValidation:settingsChanged', data)
      }
    })
  }).catch(err => {
    console.error('[Main] Failed to set up tiered validation event forwarding:', err)
  })
}

// ============================================================================
// Model Manager API (PyAnnote model downloads and bundling)
// ============================================================================

function setupModelManagerIPC() {
  // Get PyAnnote models status
  ipcMain.handle('models:getPyannoteStatus', async () => {
    console.log('[Main] models:getPyannoteStatus')
    try {
      const { modelManager } = await import('./services/modelManager')
      const savedHfToken = settingsService.get<string>('transcription.hfToken') || ''
      const hfTokenConfigured = savedHfToken.trim().length > 0
      return modelManager.getPyannoteModelsStatus(hfTokenConfigured)
    } catch (err) {
      console.error('[Main] Error getting PyAnnote models status:', err)
      return {
        allAvailable: false,
        downloading: false,
        missingModels: [],
        totalDownloadSize: 0,
        totalDownloadSizeFormatted: '0 B',
        hfTokenConfigured: false,
        modelsLocation: 'none'
      }
    }
  })

  // Get all model statuses
  ipcMain.handle('models:getAllStatuses', async () => {
    console.log('[Main] models:getAllStatuses')
    try {
      const { modelManager } = await import('./services/modelManager')
      return modelManager.getAllModelStatuses()
    } catch (err) {
      console.error('[Main] Error getting model statuses:', err)
      return []
    }
  })

  // Get single model status
  ipcMain.handle('models:getStatus', async (_event, modelId: string) => {
    console.log('[Main] models:getStatus', modelId)
    try {
      const { modelManager } = await import('./services/modelManager')
      return modelManager.getModelStatus(modelId)
    } catch (err) {
      console.error('[Main] Error getting model status:', err)
      return {
        id: modelId,
        available: false,
        localPath: null,
        downloading: false,
        progress: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Download PyAnnote models
  ipcMain.handle('models:downloadPyannote', async (_event, hfToken?: string) => {
    console.log('[Main] models:downloadPyannote')
    try {
      const { modelManager } = await import('./services/modelManager')
      const savedHfToken = settingsService.get<string>('transcription.hfToken') || ''
      const tokenToUse = (hfToken ?? savedHfToken).trim()

      // Set up progress event forwarding
      const progressHandler = (progress: any) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('models:downloadProgress', progress)
        }
      }
      const completeHandler = (data: any) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('models:downloadComplete', data)
        }
      }
      const errorHandler = (data: any) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('models:downloadError', data)
        }
      }

      const licenseHandler = (data: any) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('models:licenseRequired', data)
        }
      }

      modelManager.on('downloadProgress', progressHandler)
      modelManager.on('downloadComplete', completeHandler)
      modelManager.on('downloadError', errorHandler)
      modelManager.on('licenseRequired', licenseHandler)

      try {
        await modelManager.downloadPyannoteModels(tokenToUse)
        return { success: true }
      } finally {
        modelManager.off('downloadProgress', progressHandler)
        modelManager.off('downloadComplete', completeHandler)
        modelManager.off('downloadError', errorHandler)
        modelManager.off('licenseRequired', licenseHandler)
      }
    } catch (err) {
      console.error('[Main] Error downloading PyAnnote models:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Cancel ongoing download
  ipcMain.handle('models:cancelDownload', async () => {
    console.log('[Main] models:cancelDownload')
    try {
      const { modelManager } = await import('./services/modelManager')
      modelManager.cancelDownload()
      return { success: true }
    } catch (err) {
      console.error('[Main] Error cancelling download:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Check license access for PyAnnote models
  ipcMain.handle('models:checkLicenseAccess', async (_event, hfToken?: string) => {
    console.log('[Main] models:checkLicenseAccess')
    try {
      const { modelManager } = await import('./services/modelManager')
      const savedHfToken = settingsService.get<string>('transcription.hfToken') || ''
      const tokenToUse = (hfToken ?? savedHfToken).trim()
      return await modelManager.checkLicenseAccess(tokenToUse)
    } catch (err) {
      console.error('[Main] Error checking license access:', err)
      return {
        allAccessible: false,
        checking: false,
        modelsRequiringLicense: [],
        accessibleModels: [],
        error: err instanceof Error ? err.message : String(err),
        lastCheckTimestamp: Date.now()
      }
    }
  })

  // Get first run download info
  ipcMain.handle('models:getFirstRunInfo', async () => {
    console.log('[Main] models:getFirstRunInfo')
    try {
      const { modelManager } = await import('./services/modelManager')
      return modelManager.getFirstRunDownloadInfo()
    } catch (err) {
      console.error('[Main] Error getting first run info:', err)
      return {
        needsDownload: false,
        totalSize: 0,
        models: [],
        message: 'Error checking models'
      }
    }
  })

  // Get cache size
  ipcMain.handle('models:getCacheSize', async () => {
    console.log('[Main] models:getCacheSize')
    try {
      const { modelManager } = await import('./services/modelManager')
      const size = modelManager.getCacheSize()
      return {
        size,
        formatted: modelManager.formatSize(size)
      }
    } catch (err) {
      console.error('[Main] Error getting cache size:', err)
      return { size: 0, formatted: '0 B' }
    }
  })

  // Clear model cache
  ipcMain.handle('models:clearCache', async (_event, modelId?: string) => {
    console.log('[Main] models:clearCache', modelId)
    try {
      const { modelManager } = await import('./services/modelManager')
      await modelManager.clearModelCache(modelId)
      return { success: true }
    } catch (err) {
      console.error('[Main] Error clearing cache:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Scan for existing models in HuggingFace cache
  ipcMain.handle('models:scanExisting', async () => {
    console.log('[Main] models:scanExisting')
    try {
      const { modelManager } = await import('./services/modelManager')
      return modelManager.scanExistingModels()
    } catch (err) {
      console.error('[Main] Error scanning existing models:', err)
      return {
        foundModels: [],
        missingModels: [],
        cacheLocation: '',
        canUseExisting: false
      }
    }
  })

  // Generate download script
  ipcMain.handle('models:generateScript', async (_event, hfToken: string, platform: 'bash' | 'bat') => {
    console.log('[Main] models:generateScript', platform)
    try {
      const { modelManager } = await import('./services/modelManager')
      const script = modelManager.generateDownloadScript(hfToken, platform)
      return { success: true, script }
    } catch (err) {
      console.error('[Main] Error generating download script:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get manual download commands (huggingface-cli)
  ipcMain.handle('models:getManualCommands', async (_event, hfToken: string) => {
    console.log('[Main] models:getManualCommands')
    try {
      const { modelManager } = await import('./services/modelManager')
      const commands = modelManager.getManualDownloadCommands(hfToken)
      return { success: true, commands }
    } catch (err) {
      console.error('[Main] Error getting manual commands:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get manual Python commands
  ipcMain.handle('models:getPythonCommands', async (_event, hfToken: string) => {
    console.log('[Main] models:getPythonCommands')
    try {
      const { modelManager } = await import('./services/modelManager')
      const commands = modelManager.getManualPythonCommands(hfToken)
      return { success: true, commands }
    } catch (err) {
      console.error('[Main] Error getting Python commands:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ============================================================================
  // LLM Post-Processing API (LM Studio-based speaker consistency)
  // ============================================================================

  // Check LM Studio availability
  ipcMain.handle('llmPostProcessing:checkAvailability', async () => {
    console.log('[Main] llmPostProcessing:checkAvailability - Checking LM Studio at http://localhost:1234')
    try {
      const result = await llmPostProcessingService.checkAvailability()
      console.log('[Main] llmPostProcessing:checkAvailability result:', result)
      return result
    } catch (err) {
      console.error('[Main] LLM availability check error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Process diarization output with LLM
  ipcMain.handle('llmPostProcessing:processOutput', async (
    _event,
    output: import('./services/llmPostProcessingService').LLMPostProcessingResult extends { success: boolean } ? Parameters<typeof llmPostProcessingService.processOutput>[0] : never,
    options?: Parameters<typeof llmPostProcessingService.processOutput>[1]
  ) => {
    console.log('[Main] llmPostProcessing:processOutput - Starting LLM processing', {
      segments: output?.segments?.length,
      speakers: output?.speaker_ids?.length,
      options
    })
    try {
      const startTime = Date.now()
      const result = await llmPostProcessingService.processOutput(output, options)
      const duration = Date.now() - startTime
      console.log('[Main] llmPostProcessing:processOutput - Completed in', duration, 'ms', {
        success: result.success,
        speakerMappings: result.speakerMappings?.length,
        overlapResolutions: result.overlapResolutions?.length,
        lowConfidenceResolutions: result.lowConfidenceResolutions?.length,
        llmRequests: result.metadata?.llmRequestCount
      })
      return result
    } catch (err) {
      console.error('[Main] LLM processing error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        speakerMappings: [],
        overlapResolutions: [],
        lowConfidenceResolutions: [],
        metadata: {
          processingTimeMs: 0,
          llmRequestCount: 0,
          guardrailViolations: [],
          diarizationSchemaVersion: 'unknown'
        }
      }
    }
  })

  // Get current configuration
  ipcMain.handle('llmPostProcessing:getConfig', async () => {
    console.log('[Main] llmPostProcessing:getConfig')
    return llmPostProcessingService.getConfig()
  })

  // Update LM Studio configuration
  ipcMain.handle('llmPostProcessing:updateConfig', async (
    _event,
    config: Partial<import('./services/llmPostProcessingService').LMStudioConfig>
  ) => {
    console.log('[Main] llmPostProcessing:updateConfig', config)
    try {
      llmPostProcessingService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] LLM config update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Update confidence thresholds
  ipcMain.handle('llmPostProcessing:updateThresholds', async (
    _event,
    thresholds: Partial<import('./services/llmPostProcessingService').ConfidenceThresholds>
  ) => {
    console.log('[Main] llmPostProcessing:updateThresholds', thresholds)
    try {
      llmPostProcessingService.updateThresholds(thresholds)
      return { success: true }
    } catch (err) {
      console.error('[Main] LLM thresholds update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Reset LLM service state
  ipcMain.handle('llmPostProcessing:reset', async () => {
    console.log('[Main] llmPostProcessing:reset')
    try {
      llmPostProcessingService.reset()
      return { success: true }
    } catch (err) {
      console.error('[Main] LLM reset error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ============================================================================
  // Meeting Summary Service IPC Handlers
  // ============================================================================

  // Check if LLM service is available for summary generation
  ipcMain.handle('meetingSummary:checkAvailability', async () => {
    console.log('[Main] meetingSummary:checkAvailability')
    try {
      const result = await meetingSummaryService.checkAvailability()
      console.log('[Main] meetingSummary:checkAvailability result:', result)
      return result
    } catch (err) {
      console.error('[Main] Meeting summary availability check error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Generate a summary for a meeting
  ipcMain.handle('meetingSummary:generateSummary', async (
    _event,
    meetingId: string,
    config?: SummaryGenerationConfig
  ) => {
    console.log('[Main] meetingSummary:generateSummary', { meetingId, config })
    try {
      const startTime = Date.now()
      const result = await meetingSummaryService.generateSummary(meetingId, config)
      const duration = Date.now() - startTime
      console.log('[Main] meetingSummary:generateSummary - Completed in', duration, 'ms', {
        success: result.success,
        notesCreated: result.createdNotes?.length,
        transcriptSegments: result.metadata.transcriptSegmentCount
      })
      return result
    } catch (err) {
      console.error('[Main] Meeting summary generation error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: {
          processingTimeMs: 0,
          transcriptSegmentCount: 0,
          transcriptCharacterCount: 0
        }
      }
    }
  })

  // Delete existing AI-generated summary notes for a meeting
  ipcMain.handle('meetingSummary:deleteExistingSummary', async (
    _event,
    meetingId: string
  ) => {
    console.log('[Main] meetingSummary:deleteExistingSummary', { meetingId })
    try {
      const result = await meetingSummaryService.deleteExistingSummary(meetingId)
      console.log('[Main] meetingSummary:deleteExistingSummary result:', result)
      return { success: true, ...result }
    } catch (err) {
      console.error('[Main] Meeting summary deletion error:', err)
      return {
        success: false,
        deleted: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current summary generation configuration
  ipcMain.handle('meetingSummary:getConfig', async () => {
    console.log('[Main] meetingSummary:getConfig')
    return meetingSummaryService.getConfig()
  })

  // Update summary generation configuration
  ipcMain.handle('meetingSummary:updateConfig', async (
    _event,
    config: Partial<SummaryGenerationConfig>
  ) => {
    console.log('[Main] meetingSummary:updateConfig', config)
    try {
      meetingSummaryService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Meeting summary config update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ============================================================================
  // Action Items Extraction Service IPC Handlers
  // ============================================================================

  // Check if LLM service is available for action items extraction
  ipcMain.handle('actionItems:checkAvailability', async () => {
    console.log('[Main] actionItems:checkAvailability')
    try {
      const result = await actionItemsService.checkAvailability()
      console.log('[Main] actionItems:checkAvailability result:', result)
      return result
    } catch (err) {
      console.error('[Main] Action items availability check error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Extract action items from a meeting transcript
  ipcMain.handle('actionItems:extract', async (
    _event,
    meetingId: string,
    config?: ActionItemsExtractionConfig
  ) => {
    console.log('[Main] actionItems:extract', { meetingId, config })
    try {
      const startTime = Date.now()
      const result = await actionItemsService.extractActionItems(meetingId, config)
      const duration = Date.now() - startTime
      console.log('[Main] actionItems:extract - Completed in', duration, 'ms', {
        success: result.success,
        actionItemsExtracted: result.extractedItems?.length || 0,
        notesCreated: result.createdNotes?.length || 0,
        tasksCreated: result.createdTasks?.length || 0
      })
      return result
    } catch (err) {
      console.error('[Main] Action items extraction error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: {
          processingTimeMs: 0,
          transcriptSegmentCount: 0,
          transcriptCharacterCount: 0,
          actionItemCount: 0
        }
      }
    }
  })

  // Delete existing AI-generated action item notes for a meeting
  ipcMain.handle('actionItems:deleteExisting', async (
    _event,
    meetingId: string
  ) => {
    console.log('[Main] actionItems:deleteExisting', { meetingId })
    try {
      const result = await actionItemsService.deleteExistingActionItems(meetingId)
      console.log('[Main] actionItems:deleteExisting result:', result)
      return { success: true, ...result }
    } catch (err) {
      console.error('[Main] Action items deletion error:', err)
      return {
        success: false,
        deletedNotes: 0,
        deletedTasks: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current action items extraction configuration
  ipcMain.handle('actionItems:getConfig', async () => {
    console.log('[Main] actionItems:getConfig')
    return actionItemsService.getConfig()
  })

  // Update action items extraction configuration
  ipcMain.handle('actionItems:updateConfig', async (
    _event,
    config: Partial<ActionItemsExtractionConfig>
  ) => {
    console.log('[Main] actionItems:updateConfig', config)
    try {
      actionItemsService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Action items config update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ============================================================================
  // Decisions and Topics Extraction Service IPC Handlers
  // ============================================================================

  // Check if LLM service is available for decisions and topics extraction
  ipcMain.handle('decisionsAndTopics:checkAvailability', async () => {
    console.log('[Main] decisionsAndTopics:checkAvailability')
    try {
      const result = await decisionsAndTopicsService.checkAvailability()
      console.log('[Main] decisionsAndTopics:checkAvailability result:', result)
      return result
    } catch (err) {
      console.error('[Main] Decisions and topics availability check error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Extract decisions, key points, and topics from a meeting transcript
  ipcMain.handle('decisionsAndTopics:extract', async (
    _event,
    meetingId: string,
    config?: DecisionsAndTopicsConfig
  ) => {
    console.log('[Main] decisionsAndTopics:extract', { meetingId, config })
    try {
      const startTime = Date.now()
      const result = await decisionsAndTopicsService.extract(meetingId, config)
      const duration = Date.now() - startTime
      console.log('[Main] decisionsAndTopics:extract - Completed in', duration, 'ms', {
        success: result.success,
        decisionsExtracted: result.extraction?.decisions?.length || 0,
        keyPointsExtracted: result.extraction?.keyPoints?.length || 0,
        topicsExtracted: result.extraction?.topics?.length || 0,
        notesCreated: result.createdNotes?.length || 0
      })
      return result
    } catch (err) {
      console.error('[Main] Decisions and topics extraction error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: {
          processingTimeMs: 0,
          transcriptSegmentCount: 0,
          transcriptCharacterCount: 0
        }
      }
    }
  })

  // Delete existing AI-generated notes from decisions and topics extraction
  ipcMain.handle('decisionsAndTopics:deleteExisting', async (
    _event,
    meetingId: string
  ) => {
    console.log('[Main] decisionsAndTopics:deleteExisting', { meetingId })
    try {
      const result = await decisionsAndTopicsService.deleteExistingExtraction(meetingId)
      console.log('[Main] decisionsAndTopics:deleteExisting result:', result)
      return { success: true, ...result }
    } catch (err) {
      console.error('[Main] Decisions and topics deletion error:', err)
      return {
        success: false,
        deleted: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current decisions and topics extraction configuration
  ipcMain.handle('decisionsAndTopics:getConfig', async () => {
    console.log('[Main] decisionsAndTopics:getConfig')
    return decisionsAndTopicsService.getConfig()
  })

  // Update decisions and topics extraction configuration
  ipcMain.handle('decisionsAndTopics:updateConfig', async (
    _event,
    config: Partial<DecisionsAndTopicsConfig>
  ) => {
    console.log('[Main] decisionsAndTopics:updateConfig', config)
    try {
      decisionsAndTopicsService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Decisions and topics config update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get only decisions for a meeting
  ipcMain.handle('decisionsAndTopics:getDecisions', async (
    _event,
    meetingId: string
  ) => {
    console.log('[Main] decisionsAndTopics:getDecisions', { meetingId })
    try {
      const decisions = await decisionsAndTopicsService.getDecisions(meetingId)
      return { success: true, decisions }
    } catch (err) {
      console.error('[Main] Get decisions error:', err)
      return {
        success: false,
        decisions: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get topics with duration and sentiment for a meeting
  ipcMain.handle('decisionsAndTopics:getTopicsWithDetails', async (
    _event,
    meetingId: string
  ) => {
    console.log('[Main] decisionsAndTopics:getTopicsWithDetails', { meetingId })
    try {
      const topics = await decisionsAndTopicsService.getTopicsWithDetails(meetingId)
      return { success: true, topics }
    } catch (err) {
      console.error('[Main] Get topics with details error:', err)
      return {
        success: false,
        topics: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ============================================================================
  // Export Service IPC Handlers
  // ============================================================================

  // Export meeting to PDF
  ipcMain.handle('export:pdf', async (
    _event,
    meetingId: string,
    outputPath?: string,
    config?: ExportConfig
  ) => {
    console.log('[Main] export:pdf', { meetingId, outputPath, config })
    try {
      const result = await exportService.exportToPdf(meetingId, outputPath, config)
      console.log('[Main] export:pdf result:', result)
      return result
    } catch (err) {
      console.error('[Main] PDF export error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Export meeting to Markdown
  ipcMain.handle('export:markdown', async (
    _event,
    meetingId: string,
    outputPath?: string,
    config?: ExportConfig
  ) => {
    console.log('[Main] export:markdown', { meetingId, outputPath, config })
    try {
      const result = await exportService.exportToMarkdown(meetingId, outputPath, config)
      console.log('[Main] export:markdown result:', result)
      return result
    } catch (err) {
      console.error('[Main] Markdown export error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Generic export (supports both formats)
  ipcMain.handle('export:meeting', async (
    _event,
    meetingId: string,
    format: ExportFormat,
    outputPath?: string,
    config?: ExportConfig
  ) => {
    console.log('[Main] export:meeting', { meetingId, format, outputPath, config })
    try {
      const result = await exportService.export(meetingId, format, outputPath, config)
      console.log('[Main] export:meeting result:', result)
      return result
    } catch (err) {
      console.error('[Main] Export error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current export configuration
  ipcMain.handle('export:getConfig', async () => {
    console.log('[Main] export:getConfig')
    return exportService.getConfig()
  })

  // Update export configuration
  ipcMain.handle('export:updateConfig', async (
    _event,
    config: Partial<ExportConfig>
  ) => {
    console.log('[Main] export:updateConfig', config)
    try {
      exportService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Export config update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}

// ============================================================================
// Python Setup IPC Handlers (Automated Environment Creation)
// ============================================================================

function setupPythonSetupIPC() {
  // Check if setup is required
  ipcMain.handle('pythonSetup:isRequired', async () => {
    console.log('[Main] pythonSetup:isRequired')
    try {
      return await pythonSetupService.isSetupRequired()
    } catch (err) {
      console.error('[Main] Error checking if setup is required:', err)
      return true // Assume setup is needed if check fails
    }
  })

  // Check if setup scripts exist
  ipcMain.handle('pythonSetup:scriptsExist', () => {
    console.log('[Main] pythonSetup:scriptsExist')
    return pythonSetupService.setupScriptsExist()
  })

  // Get setup state
  ipcMain.handle('pythonSetup:getState', () => {
    console.log('[Main] pythonSetup:getState')
    return pythonSetupService.getState()
  })

  // Get setup steps
  ipcMain.handle('pythonSetup:getSteps', () => {
    console.log('[Main] pythonSetup:getSteps')
    return pythonSetupService.getSteps()
  })

  // Get environment metadata
  ipcMain.handle('pythonSetup:getMetadata', () => {
    console.log('[Main] pythonSetup:getMetadata')
    return pythonSetupService.loadMetadata()
  })

  // Check if HuggingFace token is configured
  ipcMain.handle('pythonSetup:isHfTokenConfigured', () => {
    console.log('[Main] pythonSetup:isHfTokenConfigured')
    return pythonSetupService.isHfTokenConfigured()
  })

  // Get estimated setup time
  ipcMain.handle('pythonSetup:getEstimatedTime', (_event, skipModels: boolean) => {
    console.log('[Main] pythonSetup:getEstimatedTime', { skipModels })
    return pythonSetupService.getEstimatedSetupTime(skipModels)
  })

  // Get environment paths
  ipcMain.handle('pythonSetup:getEnvironmentPaths', () => {
    console.log('[Main] pythonSetup:getEnvironmentPaths')
    return pythonSetupService.getEnvironmentPaths()
  })

  // Run setup
  ipcMain.handle('pythonSetup:runSetup', async (
    _event,
    options: Omit<SetupOptions, 'onProgress'>
  ) => {
    console.log('[Main] pythonSetup:runSetup', options)

    // Forward progress events to renderer
    const progressHandler = (progress: SetupProgress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pythonSetup:progress', progress)
      }
    }

    pythonSetupService.on('progress', progressHandler)

    try {
      // Get HF token from settings if not provided
      let hfToken = options.hfToken
      if (!hfToken) {
        const savedToken = settingsService.get<string>('transcription.hfToken')
        if (savedToken) {
          hfToken = savedToken
        }
      }

      const result = await pythonSetupService.runSetup({
        ...options,
        hfToken,
        onProgress: progressHandler
      })

      console.log('[Main] pythonSetup:runSetup result:', {
        success: result.success,
        duration: result.duration,
        error: result.error
      })

      return result
    } catch (err) {
      console.error('[Main] Python setup error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        exitCode: -1,
        duration: 0
      }
    } finally {
      pythonSetupService.off('progress', progressHandler)
    }
  })

  // Cancel running setup
  ipcMain.handle('pythonSetup:cancel', () => {
    console.log('[Main] pythonSetup:cancel')
    return pythonSetupService.cancelSetup()
  })

  // Repair environments
  ipcMain.handle('pythonSetup:repair', async (
    _event,
    options: Omit<SetupOptions, 'onProgress' | 'force'>
  ) => {
    console.log('[Main] pythonSetup:repair', options)

    // Forward progress events to renderer
    const progressHandler = (progress: SetupProgress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pythonSetup:progress', progress)
      }
    }

    pythonSetupService.on('progress', progressHandler)

    try {
      // Get HF token from settings if not provided
      let hfToken = options.hfToken
      if (!hfToken) {
        const savedToken = settingsService.get<string>('transcription.hfToken')
        if (savedToken) {
          hfToken = savedToken
        }
      }

      const result = await pythonSetupService.repairEnvironments({
        ...options,
        hfToken,
        onProgress: progressHandler
      })

      console.log('[Main] pythonSetup:repair result:', {
        success: result.success,
        duration: result.duration,
        error: result.error
      })

      return result
    } catch (err) {
      console.error('[Main] Python repair error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        exitCode: -1,
        duration: 0
      }
    } finally {
      pythonSetupService.off('progress', progressHandler)
    }
  })

  // Reset service state
  ipcMain.handle('pythonSetup:reset', () => {
    console.log('[Main] pythonSetup:reset')
    pythonSetupService.reset()
    return { success: true }
  })

  // Forward state change events to renderer
  pythonSetupService.on('stateChange', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pythonSetup:stateChange', state)
    }
  })
}

// ============================================================================
// Python Execution Manager IPC Handlers (Centralized Python Script Execution)
// ============================================================================

function setupPythonExecutionManagerIPC() {
  // Get status of all Python environments
  ipcMain.handle('pythonEnv:getStatus', async (_event, forceRefresh?: boolean) => {
    console.log('[Main] pythonEnv:getStatus', { forceRefresh })
    try {
      const status = await pythonExecutionManager.getStatus(forceRefresh)
      console.log('[Main] pythonEnv:getStatus result:', {
        type: status.type,
        ready: status.ready,
        whisperxHealthy: status.whisperx.healthy,
        pyannoteHealthy: status.pyannote.healthy
      })
      return status
    } catch (err) {
      console.error('[Main] Python environment status error:', err)
      return {
        type: 'none',
        ready: false,
        whisperx: {
          healthy: false,
          pythonPath: null,
          version: null,
          lastValidated: Date.now(),
          errors: [err instanceof Error ? err.message : String(err)],
          packages: {}
        },
        pyannote: {
          healthy: false,
          pythonPath: null,
          version: null,
          lastValidated: Date.now(),
          errors: [err instanceof Error ? err.message : String(err)],
          packages: {}
        },
        platform: {
          os: process.platform,
          arch: process.arch,
          isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64'
        },
        hfTokenConfigured: false,
        recommendations: ['Failed to check environment status. Please restart the application.']
      }
    }
  })

  // Execute a Python script with auto-routing
  ipcMain.handle('pythonEnv:execute', async (
    _event,
    scriptName: string,
    options?: {
      args?: string[]
      timeout?: number
      forceOperationType?: 'transcription' | 'diarization' | 'utility'
      enableFallback?: boolean
    }
  ) => {
    console.log('[Main] pythonEnv:execute', { scriptName, options })
    try {
      const result = await pythonExecutionManager.execute(scriptName, {
        args: options?.args,
        timeout: options?.timeout,
        forceOperationType: options?.forceOperationType,
        enableFallback: options?.enableFallback,
        onProgress: (progress, message) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pythonEnv:progress', { scriptName, progress, message })
          }
        }
      })
      console.log('[Main] pythonEnv:execute result:', {
        success: result.success,
        environmentUsed: result.environmentUsed,
        usedFallback: result.usedFallback,
        executionTimeMs: result.executionTimeMs
      })
      return result
    } catch (err) {
      console.error('[Main] Python execution error:', err)
      return {
        success: false,
        code: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        error: err instanceof Error ? err.message : String(err),
        environmentUsed: 'system' as const,
        usedFallback: false,
        executionTimeMs: 0
      }
    }
  })

  // Repair Python environments
  ipcMain.handle('pythonEnv:repair', async () => {
    console.log('[Main] pythonEnv:repair')
    try {
      const result = await pythonExecutionManager.repair()
      console.log('[Main] pythonEnv:repair result:', {
        success: result.success,
        actionsCount: result.actions.length,
        errorsCount: result.errors.length
      })
      return result
    } catch (err) {
      console.error('[Main] Python repair error:', err)
      return {
        success: false,
        actions: [],
        errors: [err instanceof Error ? err.message : String(err)],
        recommendations: ['Manual intervention may be required. Check the logs for details.']
      }
    }
  })

  // Get the scripts directory path
  ipcMain.handle('pythonEnv:getScriptsDir', () => {
    console.log('[Main] pythonEnv:getScriptsDir')
    return pythonExecutionManager.getPythonScriptsDir()
  })

  // Get the current environment type
  ipcMain.handle('pythonEnv:getEnvironmentType', () => {
    console.log('[Main] pythonEnv:getEnvironmentType')
    return pythonExecutionManager.getEnvironmentType()
  })

  // Clear environment caches
  ipcMain.handle('pythonEnv:clearCache', () => {
    console.log('[Main] pythonEnv:clearCache')
    pythonExecutionManager.clearCache()
    return { success: true }
  })

  // Get active process count
  ipcMain.handle('pythonEnv:getActiveProcessCount', () => {
    return pythonExecutionManager.getActiveProcessCount()
  })

  // Abort all running Python processes
  ipcMain.handle('pythonEnv:abortAll', () => {
    console.log('[Main] pythonEnv:abortAll')
    pythonExecutionManager.abortAll()
    return { success: true }
  })
}

// ============================================================================
// Update IPC Handlers (Automatic Updates)
// ============================================================================

function setupUpdateIPC() {
  // Get current update state
  ipcMain.handle('update:getState', async () => {
    console.log('[Main] update:getState')
    return updateService.getState()
  })

  // Check for updates
  ipcMain.handle('update:checkForUpdates', async () => {
    console.log('[Main] update:checkForUpdates')
    try {
      const result = await updateService.checkForUpdates()
      console.log('[Main] update:checkForUpdates result:', result)
      return result
    } catch (err) {
      console.error('[Main] Update check error:', err)
      return {
        updateAvailable: false,
        currentVersion: updateService.getState().currentVersion,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Download update
  ipcMain.handle('update:downloadUpdate', async () => {
    console.log('[Main] update:downloadUpdate')
    try {
      const result = await updateService.downloadUpdate()
      console.log('[Main] update:downloadUpdate result:', result)
      return result
    } catch (err) {
      console.error('[Main] Download update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Install update
  ipcMain.handle('update:installUpdate', async () => {
    console.log('[Main] update:installUpdate')
    try {
      const result = await updateService.installUpdate()
      console.log('[Main] update:installUpdate result:', result)
      return result
    } catch (err) {
      console.error('[Main] Install update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get rollback info
  ipcMain.handle('update:getRollbackInfo', async () => {
    console.log('[Main] update:getRollbackInfo')
    return updateService.getRollbackInfo()
  })

  // Attempt rollback
  ipcMain.handle('update:rollback', async () => {
    console.log('[Main] update:rollback')
    try {
      const result = await updateService.rollback()
      console.log('[Main] update:rollback result:', result)
      return result
    } catch (err) {
      console.error('[Main] Rollback error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Set update feed URL
  ipcMain.handle('update:setFeedURL', async (_event, url: string) => {
    console.log('[Main] update:setFeedURL', { url })
    try {
      updateService.setFeedURL(url)
      return { success: true }
    } catch (err) {
      console.error('[Main] Set feed URL error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Set auto-download preference
  ipcMain.handle('update:setAutoDownload', async (_event, enabled: boolean) => {
    console.log('[Main] update:setAutoDownload', { enabled })
    try {
      updateService.setAutoDownload(enabled)
      return { success: true }
    } catch (err) {
      console.error('[Main] Set auto-download error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Set allow prerelease preference
  ipcMain.handle('update:setAllowPrerelease', async (_event, enabled: boolean) => {
    console.log('[Main] update:setAllowPrerelease', { enabled })
    try {
      updateService.setAllowPrerelease(enabled)
      return { success: true }
    } catch (err) {
      console.error('[Main] Set allow prerelease error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Reset update state
  ipcMain.handle('update:reset', async () => {
    console.log('[Main] update:reset')
    try {
      updateService.reset()
      return { success: true }
    } catch (err) {
      console.error('[Main] Reset update state error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Forward update status changes to renderer
  updateService.onStatusChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Forwarding update status change:', state.status)
      mainWindow.webContents.send('update:statusChange', state)
    }
  })
}

// ============================================================================
// LLM Provider IPC Handlers
// ============================================================================

function setupLLMProviderIPC() {
  // Detect available LLM providers
  ipcMain.handle('llmProvider:detectProviders', async (
    _event,
    options?: ProviderDetectionOptions
  ) => {
    console.log('[Main] llmProvider:detectProviders', options)
    try {
      const result = await llmProviderManager.detectProviders(options)
      console.log('[Main] llmProvider:detectProviders result:', {
        providers: result.providers.map(p => ({
          provider: p.provider,
          available: p.available,
          error: p.error
        })),
        recommendedPrimary: result.recommendedPrimary
      })
      return result
    } catch (err) {
      console.error('[Main] LLM provider detection error:', err)
      return {
        providers: [],
        timestamp: Date.now(),
        detectionTimeMs: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get registered provider types
  ipcMain.handle('llmProvider:getRegisteredProviders', async () => {
    console.log('[Main] llmProvider:getRegisteredProviders')
    try {
      return llmProviderManager.getRegisteredProviders()
    } catch (err) {
      console.error('[Main] Get registered providers error:', err)
      return []
    }
  })

  // Get enabled provider types
  ipcMain.handle('llmProvider:getEnabledProviders', async () => {
    console.log('[Main] llmProvider:getEnabledProviders')
    try {
      return llmProviderManager.getEnabledProviders()
    } catch (err) {
      console.error('[Main] Get enabled providers error:', err)
      return []
    }
  })

  // Set the default provider
  ipcMain.handle('llmProvider:setDefaultProvider', async (
    _event,
    providerType: LLMProviderType
  ) => {
    console.log('[Main] llmProvider:setDefaultProvider', providerType)
    try {
      llmProviderManager.setDefaultProvider(providerType)
      return { success: true }
    } catch (err) {
      console.error('[Main] Set default provider error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Check health of a specific provider
  ipcMain.handle('llmProvider:checkHealth', async (
    _event,
    forceRefresh: boolean = false
  ) => {
    console.log('[Main] llmProvider:checkHealth', { forceRefresh })
    try {
      const result = await llmProviderManager.checkHealth(forceRefresh)
      console.log('[Main] llmProvider:checkHealth result:', result)
      return result
    } catch (err) {
      console.error('[Main] Provider health check error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        provider: 'unknown',
        responseTimeMs: 0
      }
    }
  })

  // Check if any provider is available
  ipcMain.handle('llmProvider:isAvailable', async () => {
    console.log('[Main] llmProvider:isAvailable')
    try {
      return await llmProviderManager.isAvailable()
    } catch (err) {
      console.error('[Main] Provider availability check error:', err)
      return false
    }
  })

  // Get current manager configuration
  ipcMain.handle('llmProvider:getConfig', async () => {
    console.log('[Main] llmProvider:getConfig')
    try {
      return llmProviderManager.getConfig()
    } catch (err) {
      console.error('[Main] Get config error:', err)
      return null
    }
  })

  // Update manager configuration
  ipcMain.handle('llmProvider:updateConfig', async (
    _event,
    config: { defaultProvider?: LLMProviderType }
  ) => {
    console.log('[Main] llmProvider:updateConfig', config)
    try {
      llmProviderManager.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Update config error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Register a provider by type
  ipcMain.handle('llmProvider:registerProviderByType', async (
    _event,
    providerType: LLMProviderType,
    config?: Record<string, unknown>,
    priority?: string,
    isDefault?: boolean
  ) => {
    console.log('[Main] llmProvider:registerProviderByType', { providerType, config, priority, isDefault })
    try {
      llmProviderManager.registerProviderByType(
        providerType,
        config as any,
        priority as any || 'secondary',
        isDefault || false
      )
      return { success: true }
    } catch (err) {
      console.error('[Main] Register provider error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}

// ============================================================================
// LLM Health Check IPC Handlers
// ============================================================================

function setupLLMHealthCheckIPC() {
  // Get current health summary
  ipcMain.handle('llmHealthCheck:getSummary', async () => {
    console.log('[Main] llmHealthCheck:getSummary')
    try {
      return llmHealthCheckService.getSummary()
    } catch (err) {
      console.error('[Main] Get health summary error:', err)
      return {
        timestamp: Date.now(),
        totalProviders: 0,
        availableProviders: 0,
        unavailableProviders: 0,
        providers: [],
        recentEvents: [],
        hasWarnings: true,
        warnings: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  // Run a health check now
  ipcMain.handle('llmHealthCheck:runNow', async () => {
    console.log('[Main] llmHealthCheck:runNow')
    try {
      return await llmHealthCheckService.runHealthCheck()
    } catch (err) {
      console.error('[Main] Run health check error:', err)
      return {
        timestamp: Date.now(),
        totalProviders: 0,
        availableProviders: 0,
        unavailableProviders: 0,
        providers: [],
        recentEvents: [],
        hasWarnings: true,
        warnings: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  // Get provider status
  ipcMain.handle('llmHealthCheck:getProviderStatus', async (
    _event,
    provider: LLMProviderType
  ) => {
    console.log('[Main] llmHealthCheck:getProviderStatus', provider)
    try {
      return llmHealthCheckService.getProviderStatus(provider) || null
    } catch (err) {
      console.error('[Main] Get provider status error:', err)
      return null
    }
  })

  // Get event history
  ipcMain.handle('llmHealthCheck:getEventHistory', async (
    _event,
    limit?: number
  ) => {
    console.log('[Main] llmHealthCheck:getEventHistory', { limit })
    try {
      return llmHealthCheckService.getEventHistory(limit)
    } catch (err) {
      console.error('[Main] Get event history error:', err)
      return []
    }
  })

  // Get troubleshooting guidance
  ipcMain.handle('llmHealthCheck:getTroubleshootingGuidance', async (
    _event,
    provider: LLMProviderType,
    error?: string
  ) => {
    console.log('[Main] llmHealthCheck:getTroubleshootingGuidance', { provider, error })
    try {
      return llmHealthCheckService.getTroubleshootingGuidance(provider, error)
    } catch (err) {
      console.error('[Main] Get troubleshooting guidance error:', err)
      return 'Unable to get troubleshooting guidance.'
    }
  })

  // Start health checks
  ipcMain.handle('llmHealthCheck:start', async (
    _event,
    config?: Partial<HealthCheckConfig>
  ) => {
    console.log('[Main] llmHealthCheck:start', config)
    try {
      if (config) {
        llmHealthCheckService.updateConfig(config)
      }
      llmHealthCheckService.start()
      return { success: true }
    } catch (err) {
      console.error('[Main] Start health checks error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Stop health checks
  ipcMain.handle('llmHealthCheck:stop', async () => {
    console.log('[Main] llmHealthCheck:stop')
    try {
      llmHealthCheckService.stop()
      return { success: true }
    } catch (err) {
      console.error('[Main] Stop health checks error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current config
  ipcMain.handle('llmHealthCheck:getConfig', async () => {
    console.log('[Main] llmHealthCheck:getConfig')
    try {
      return llmHealthCheckService.getConfig()
    } catch (err) {
      console.error('[Main] Get health check config error:', err)
      return null
    }
  })

  // Update config
  ipcMain.handle('llmHealthCheck:updateConfig', async (
    _event,
    config: Partial<HealthCheckConfig>
  ) => {
    console.log('[Main] llmHealthCheck:updateConfig', config)
    try {
      llmHealthCheckService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Update health check config error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Check if health check is running
  ipcMain.handle('llmHealthCheck:isRunning', async () => {
    console.log('[Main] llmHealthCheck:isRunning')
    try {
      return llmHealthCheckService.isHealthCheckRunning()
    } catch (err) {
      console.error('[Main] Check if running error:', err)
      return false
    }
  })

  // Clear history
  ipcMain.handle('llmHealthCheck:clearHistory', async () => {
    console.log('[Main] llmHealthCheck:clearHistory')
    try {
      llmHealthCheckService.clearHistory()
      return { success: true }
    } catch (err) {
      console.error('[Main] Clear history error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Subscribe to status changes (via BrowserWindow webContents)
  llmHealthCheckService.onStatusChange((summary) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('llmHealthCheck:statusChange', summary)
    }
  })
}

// ============================================================================
// Live Notes IPC Handlers
// ============================================================================

function setupLiveNotesIPC() {
  // Check if LLM is available for live notes generation
  ipcMain.handle('liveNotes:checkAvailability', async () => {
    console.log('[Main] liveNotes:checkAvailability')
    try {
      return await liveNoteGenerationService.checkAvailability()
    } catch (err) {
      console.error('[Main] Check availability error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Start a live notes generation session
  ipcMain.handle('liveNotes:startSession', async (
    _event,
    meetingId: string,
    config?: LiveNoteGenerationConfig
  ) => {
    console.log('[Main] liveNotes:startSession', meetingId)
    try {
      return await liveNoteGenerationService.startSession(meetingId, config)
    } catch (err) {
      console.error('[Main] Start session error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Stop the live notes generation session
  ipcMain.handle('liveNotes:stopSession', async () => {
    console.log('[Main] liveNotes:stopSession')
    try {
      return await liveNoteGenerationService.stopSession()
    } catch (err) {
      console.error('[Main] Stop session error:', err)
      return {
        success: false,
        totalNotes: 0,
        batchesProcessed: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Pause notes generation
  ipcMain.handle('liveNotes:pauseSession', async () => {
    console.log('[Main] liveNotes:pauseSession')
    try {
      liveNoteGenerationService.pauseSession()
      return { success: true }
    } catch (err) {
      console.error('[Main] Pause session error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Resume notes generation
  ipcMain.handle('liveNotes:resumeSession', async () => {
    console.log('[Main] liveNotes:resumeSession')
    try {
      liveNoteGenerationService.resumeSession()
      return { success: true }
    } catch (err) {
      console.error('[Main] Resume session error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Add transcript segments for processing
  ipcMain.handle('liveNotes:addSegments', async (
    _event,
    segments: LiveNoteTranscriptInput[]
  ) => {
    try {
      liveNoteGenerationService.addSegments(segments)
      return { success: true }
    } catch (err) {
      console.error('[Main] Add segments error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current session state
  ipcMain.handle('liveNotes:getSessionState', async () => {
    console.log('[Main] liveNotes:getSessionState')
    try {
      return liveNoteGenerationService.getSessionState()
    } catch (err) {
      console.error('[Main] Get session state error:', err)
      return {
        isActive: false,
        meetingId: null,
        pendingSegments: 0,
        processedSegments: 0,
        batchesProcessed: 0,
        totalNotesGenerated: 0
      }
    }
  })

  // Get current configuration
  ipcMain.handle('liveNotes:getConfig', async () => {
    console.log('[Main] liveNotes:getConfig')
    try {
      return liveNoteGenerationService.getConfig()
    } catch (err) {
      console.error('[Main] Get config error:', err)
      return {}
    }
  })

  // Update configuration
  ipcMain.handle('liveNotes:updateConfig', async (
    _event,
    config: Partial<LiveNoteGenerationConfig>
  ) => {
    console.log('[Main] liveNotes:updateConfig', config)
    try {
      liveNoteGenerationService.updateConfig(config)
      return { success: true }
    } catch (err) {
      console.error('[Main] Update config error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Force process pending segments immediately
  ipcMain.handle('liveNotes:forceBatchProcess', async () => {
    console.log('[Main] liveNotes:forceBatchProcess')
    try {
      await liveNoteGenerationService.forceBatchProcess()
      return { success: true }
    } catch (err) {
      console.error('[Main] Force batch process error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ============================================================================
  // Live Insights Persistence IPC Handlers
  // ============================================================================

  // Check if live insights exist for a meeting
  ipcMain.handle('liveInsights:check', async (_event, meetingId: string) => {
    console.log('[Main] liveInsights:check', meetingId)
    try {
      const persistenceService = getLiveInsightsPersistenceService()
      const exists = await persistenceService.hasLiveInsights(meetingId)
      return { exists }
    } catch (err) {
      console.error('[Main] Check live insights error:', err)
      return {
        exists: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get summary of live insights for a meeting
  ipcMain.handle('liveInsights:getSummary', async (_event, meetingId: string) => {
    console.log('[Main] liveInsights:getSummary', meetingId)
    try {
      const persistenceService = getLiveInsightsPersistenceService()
      return await persistenceService.getLiveInsightsSummary(meetingId)
    } catch (err) {
      console.error('[Main] Get live insights summary error:', err)
      return {
        exists: false,
        tasksCount: 0,
        notesCount: 0,
        generatedAt: null,
        types: {
          actionItems: 0,
          decisions: 0,
          keyPoints: 0,
          topics: 0
        },
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Manually save live insights (fallback if auto-save failed)
  ipcMain.handle('liveInsights:manualSave', async (_event, meetingId: string) => {
    console.log('[Main] liveInsights:manualSave', meetingId)
    try {
      const liveNotes = liveNoteGenerationService.getCurrentSessionNotes()

      if (liveNotes.length === 0) {
        return {
          success: true,
          tasksCreated: 0,
          notesCreated: 0,
          message: 'No live insights to save'
        }
      }

      const persistenceService = getLiveInsightsPersistenceService()
      const result = await persistenceService.persistLiveInsights(meetingId, liveNotes)

      return result
    } catch (err) {
      console.error('[Main] Manual save live insights error:', err)
      return {
        success: false,
        tasksCreated: 0,
        notesCreated: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}

// ============================================================================
// Subject-Aware Note Generation IPC Handlers
// ============================================================================

function setupSubjectAwareNotesIPC() {
  // Check if LLM is available for subject-aware note generation
  ipcMain.handle('subjectAwareNotes:checkAvailability', async () => {
    console.log('[Main] subjectAwareNotes:checkAvailability')
    try {
      return await subjectAwareNoteGenerationService.checkAvailability()
    } catch (err) {
      console.error('[Main] Check subject-aware notes availability error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Start a subject-aware note generation session
  ipcMain.handle('subjectAwareNotes:startSession', async (
    _event,
    meetingId: string,
    config?: Partial<SubjectAwareConfig>
  ) => {
    console.log('[Main] subjectAwareNotes:startSession', meetingId)
    try {
      return await subjectAwareNoteGenerationService.startSession(meetingId, config)
    } catch (err) {
      console.error('[Main] Start subject-aware notes session error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Stop the subject-aware note generation session (triggers finalization)
  ipcMain.handle('subjectAwareNotes:stopSession', async () => {
    console.log('[Main] subjectAwareNotes:stopSession')
    try {
      return await subjectAwareNoteGenerationService.stopSession()
    } catch (err) {
      console.error('[Main] Stop subject-aware notes session error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        notesCreated: 0,
        tasksCreated: 0,
        candidatesFiltered: 0,
        processingTimeMs: 0
      }
    }
  })

  // Pause subject-aware note generation
  ipcMain.handle('subjectAwareNotes:pauseSession', async () => {
    console.log('[Main] subjectAwareNotes:pauseSession')
    try {
      subjectAwareNoteGenerationService.pauseSession()
      return { success: true }
    } catch (err) {
      console.error('[Main] Pause subject-aware notes session error:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Resume subject-aware note generation
  ipcMain.handle('subjectAwareNotes:resumeSession', async () => {
    console.log('[Main] subjectAwareNotes:resumeSession')
    try {
      subjectAwareNoteGenerationService.resumeSession()
      return { success: true }
    } catch (err) {
      console.error('[Main] Resume subject-aware notes session error:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Add transcript segments for processing
  ipcMain.handle('subjectAwareNotes:addSegments', async (
    _event,
    segments: SubjectAwareTranscriptInput[]
  ) => {
    // Minimize logging for performance (segments come frequently)
    try {
      subjectAwareNoteGenerationService.addSegments(segments)
      return { success: true }
    } catch (err) {
      console.error('[Main] Add subject-aware notes segments error:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get current session state
  ipcMain.handle('subjectAwareNotes:getSessionState', async () => {
    console.log('[Main] subjectAwareNotes:getSessionState')
    try {
      return subjectAwareNoteGenerationService.getSessionState()
    } catch (err) {
      console.error('[Main] Get subject-aware notes session state error:', err)
      return {
        isActive: false,
        meetingId: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get current configuration
  ipcMain.handle('subjectAwareNotes:getConfig', async () => {
    console.log('[Main] subjectAwareNotes:getConfig')
    try {
      return subjectAwareNoteGenerationService.getConfig()
    } catch (err) {
      console.error('[Main] Get subject-aware notes config error:', err)
      return null
    }
  })

  // Update configuration
  ipcMain.handle('subjectAwareNotes:updateConfig', async (
    _event,
    config: Partial<SubjectAwareConfig>
  ) => {
    console.log('[Main] subjectAwareNotes:updateConfig', config)
    try {
      subjectAwareNoteGenerationService.updateConfig(config)
      return { success: true, config: subjectAwareNoteGenerationService.getConfig() }
    } catch (err) {
      console.error('[Main] Update subject-aware notes config error:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// ============================================================================
// Transcript Correction IPC Handlers
// ============================================================================

function setupTranscriptCorrectionIPC() {
  // Check if LLM is available for transcript correction
  ipcMain.handle('transcriptCorrection:checkAvailability', async () => {
    console.log('[Main] transcriptCorrection:checkAvailability')
    try {
      return await transcriptCorrectionService.checkAvailability()
    } catch (err) {
      console.error('[Main] Check correction availability error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Generate correction for a single transcript segment
  ipcMain.handle('transcriptCorrection:generateCorrection', async (
    _event,
    transcriptId: string,
    trigger?: CorrectionTrigger
  ) => {
    console.log('[Main] transcriptCorrection:generateCorrection', transcriptId, trigger)
    try {
      return await transcriptCorrectionService.generateCorrection(transcriptId, trigger)
    } catch (err) {
      console.error('[Main] Generate correction error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Generate batch corrections for a meeting
  ipcMain.handle('transcriptCorrection:generateBatchCorrections', async (
    _event,
    meetingId: string,
    options?: { onlyLowConfidence?: boolean; maxSegments?: number }
  ) => {
    console.log('[Main] transcriptCorrection:generateBatchCorrections', meetingId, options)
    try {
      return await transcriptCorrectionService.generateBatchCorrections(meetingId, options)
    } catch (err) {
      console.error('[Main] Generate batch corrections error:', err)
      return {
        success: false,
        totalSegments: 0,
        corrected: 0,
        skipped: 0,
        failed: 0,
        corrections: [],
        errors: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  // Get correction by ID
  ipcMain.handle('transcriptCorrection:getById', (_event, id: string) => {
    console.log('[Main] transcriptCorrection:getById', id)
    return transcriptCorrectionService.getById(id)
  })

  // Get corrections for a transcript
  ipcMain.handle('transcriptCorrection:getByTranscriptId', (_event, transcriptId: string) => {
    console.log('[Main] transcriptCorrection:getByTranscriptId', transcriptId)
    return transcriptCorrectionService.getByTranscriptId(transcriptId)
  })

  // Get corrections for a meeting
  ipcMain.handle('transcriptCorrection:getByMeetingId', (_event, meetingId: string) => {
    console.log('[Main] transcriptCorrection:getByMeetingId', meetingId)
    return transcriptCorrectionService.getByMeetingId(meetingId)
  })

  // Get pending corrections for a meeting
  ipcMain.handle('transcriptCorrection:getPendingByMeetingId', (_event, meetingId: string) => {
    console.log('[Main] transcriptCorrection:getPendingByMeetingId', meetingId)
    return transcriptCorrectionService.getPendingByMeetingId(meetingId)
  })

  // Accept a correction
  ipcMain.handle('transcriptCorrection:acceptCorrection', async (_event, correctionId: string) => {
    console.log('[Main] transcriptCorrection:acceptCorrection', correctionId)
    try {
      return await transcriptCorrectionService.acceptCorrection(correctionId)
    } catch (err) {
      console.error('[Main] Accept correction error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Reject a correction
  ipcMain.handle('transcriptCorrection:rejectCorrection', (_event, correctionId: string) => {
    console.log('[Main] transcriptCorrection:rejectCorrection', correctionId)
    return transcriptCorrectionService.rejectCorrection(correctionId)
  })

  // Delete a correction
  ipcMain.handle('transcriptCorrection:delete', (_event, id: string) => {
    console.log('[Main] transcriptCorrection:delete', id)
    return transcriptCorrectionService.delete(id)
  })

  // Delete all corrections for a meeting
  ipcMain.handle('transcriptCorrection:deleteByMeetingId', (_event, meetingId: string) => {
    console.log('[Main] transcriptCorrection:deleteByMeetingId', meetingId)
    return transcriptCorrectionService.deleteByMeetingId(meetingId)
  })

  // Get correction statistics for a meeting
  ipcMain.handle('transcriptCorrection:getStats', (_event, meetingId: string) => {
    console.log('[Main] transcriptCorrection:getStats', meetingId)
    return transcriptCorrectionService.getStats(meetingId)
  })

  // Check if a transcript should suggest correction
  ipcMain.handle('transcriptCorrection:shouldSuggestCorrection', (_event, transcriptId: string) => {
    console.log('[Main] transcriptCorrection:shouldSuggestCorrection', transcriptId)
    const transcript = transcriptService.getById(transcriptId)
    if (!transcript) {
      return { suggest: false, reason: 'Transcript not found' }
    }
    return transcriptCorrectionService.shouldSuggestCorrection(transcript)
  })

  // Update correction configuration
  ipcMain.handle('transcriptCorrection:updateConfig', (_event, config: Partial<CorrectionConfig>) => {
    console.log('[Main] transcriptCorrection:updateConfig', config)
    transcriptCorrectionService.updateConfig(config)
    return { success: true }
  })

  // Get current correction configuration
  ipcMain.handle('transcriptCorrection:getConfig', () => {
    console.log('[Main] transcriptCorrection:getConfig')
    return transcriptCorrectionService.getConfig()
  })
}

// ============================================================================
// Confidence Scoring IPC Handlers
// ============================================================================

function setupConfidenceScoringIPC() {
  // Get confidence level for a score
  ipcMain.handle('confidenceScoring:getConfidenceLevel', (_event, confidence: number) => {
    return confidenceScoringService.getConfidenceLevel(confidence)
  })

  // Get segment confidence info for a transcript
  ipcMain.handle('confidenceScoring:getSegmentConfidenceInfo', (_event, transcriptId: string) => {
    console.log('[Main] confidenceScoring:getSegmentConfidenceInfo', transcriptId)
    const transcript = transcriptService.getById(transcriptId)
    if (!transcript) {
      return null
    }
    return confidenceScoringService.getSegmentConfidenceInfo(transcript)
  })

  // Calculate and get meeting metrics
  ipcMain.handle('confidenceScoring:calculateMeetingMetrics', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:calculateMeetingMetrics', meetingId)
    return confidenceScoringService.calculateMeetingMetrics(meetingId)
  })

  // Get existing meeting metrics
  ipcMain.handle('confidenceScoring:getMetrics', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:getMetrics', meetingId)
    return confidenceScoringService.getMetrics(meetingId)
  })

  // Get meeting confidence summary for UI
  ipcMain.handle('confidenceScoring:getMeetingConfidenceSummary', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:getMeetingConfidenceSummary', meetingId)
    return confidenceScoringService.getMeetingConfidenceSummary(meetingId)
  })

  // Record trend data point (for live recording)
  ipcMain.handle('confidenceScoring:recordTrendDataPoint', (
    _event,
    meetingId: string,
    timestampMs: number,
    windowConfidence: number,
    segmentCount: number
  ) => {
    console.log('[Main] confidenceScoring:recordTrendDataPoint', meetingId, timestampMs)
    return confidenceScoringService.recordTrendDataPoint(
      meetingId,
      timestampMs,
      windowConfidence,
      segmentCount
    )
  })

  // Get trends for a meeting
  ipcMain.handle('confidenceScoring:getTrends', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:getTrends', meetingId)
    return confidenceScoringService.getTrends(meetingId)
  })

  // Get alerts for a meeting
  ipcMain.handle('confidenceScoring:getAlerts', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:getAlerts', meetingId)
    return confidenceScoringService.getAlerts(meetingId)
  })

  // Get low confidence transcripts
  ipcMain.handle('confidenceScoring:getLowConfidenceTranscripts', (
    _event,
    meetingId: string,
    threshold?: number
  ) => {
    console.log('[Main] confidenceScoring:getLowConfidenceTranscripts', meetingId, threshold)
    return confidenceScoringService.getLowConfidenceTranscripts(meetingId, threshold)
  })

  // Get transcripts needing review
  ipcMain.handle('confidenceScoring:getTranscriptsNeedingReview', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:getTranscriptsNeedingReview', meetingId)
    return confidenceScoringService.getTranscriptsNeedingReview(meetingId)
  })

  // Trigger batch auto-correction for low-confidence segments
  ipcMain.handle('confidenceScoring:triggerBatchAutoCorrection', async (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:triggerBatchAutoCorrection', meetingId)
    try {
      return await confidenceScoringService.triggerBatchAutoCorrection(meetingId)
    } catch (err) {
      console.error('[Main] Batch auto-correction error:', err)
      return {
        triggered: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  // Adjust confidence manually
  ipcMain.handle('confidenceScoring:adjustConfidence', (
    _event,
    transcriptId: string,
    newConfidence: number,
    reason?: string
  ) => {
    console.log('[Main] confidenceScoring:adjustConfidence', transcriptId, newConfidence, reason)
    return confidenceScoringService.adjustConfidence(transcriptId, newConfidence, reason)
  })

  // Get adjustment history for a transcript
  ipcMain.handle('confidenceScoring:getAdjustmentHistory', (_event, transcriptId: string) => {
    console.log('[Main] confidenceScoring:getAdjustmentHistory', transcriptId)
    return confidenceScoringService.getAdjustmentHistory(transcriptId)
  })

  // Get all adjustments for a meeting
  ipcMain.handle('confidenceScoring:getMeetingAdjustments', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:getMeetingAdjustments', meetingId)
    return confidenceScoringService.getMeetingAdjustments(meetingId)
  })

  // Process live segment (during recording)
  ipcMain.handle('confidenceScoring:processLiveSegment', (_event, transcriptId: string) => {
    console.log('[Main] confidenceScoring:processLiveSegment', transcriptId)
    const transcript = transcriptService.getById(transcriptId)
    if (!transcript) {
      return null
    }
    return confidenceScoringService.processLiveSegment(transcript)
  })

  // Reset alert state for a meeting
  ipcMain.handle('confidenceScoring:resetAlertState', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:resetAlertState', meetingId)
    confidenceScoringService.resetAlertState(meetingId)
    return { success: true }
  })

  // Update configuration
  ipcMain.handle('confidenceScoring:updateConfig', (
    _event,
    config: Partial<ConfidenceScoringConfig>
  ) => {
    console.log('[Main] confidenceScoring:updateConfig', config)
    confidenceScoringService.updateConfig(config)
    return { success: true }
  })

  // Get current configuration
  ipcMain.handle('confidenceScoring:getConfig', () => {
    console.log('[Main] confidenceScoring:getConfig')
    return confidenceScoringService.getConfig()
  })

  // Get confidence thresholds
  ipcMain.handle('confidenceScoring:getThresholds', () => {
    console.log('[Main] confidenceScoring:getThresholds')
    return confidenceScoringService.getThresholds()
  })

  // Delete all confidence data for a meeting
  ipcMain.handle('confidenceScoring:deleteByMeetingId', (_event, meetingId: string) => {
    console.log('[Main] confidenceScoring:deleteByMeetingId', meetingId)
    confidenceScoringService.deleteByMeetingId(meetingId)
    return { success: true }
  })

  // ============================================================================
  // Meeting Deletion API - Comprehensive meeting deletion with cleanup
  // ============================================================================

  // Get deletion preview for a meeting
  ipcMain.handle('meetingDeletion:getPreview', (_event, meetingId: string) => {
    console.log('[Main] meetingDeletion:getPreview', meetingId)
    return meetingDeletionService.getDeletionPreview(meetingId)
  })

  // Delete a meeting with all associated data
  ipcMain.handle('meetingDeletion:deleteMeeting', (_event, meetingId: string, options?: DeletionOptions) => {
    console.log('[Main] meetingDeletion:deleteMeeting', meetingId, options)
    return meetingDeletionService.deleteMeeting(meetingId, options)
  })

  // Delete multiple meetings at once
  ipcMain.handle('meetingDeletion:deleteBatch', (_event, meetingIds: string[], options?: DeletionOptions) => {
    console.log('[Main] meetingDeletion:deleteBatch', meetingIds.length, 'meetings', options)
    return meetingDeletionService.deleteMeetingsBatch(meetingIds, options)
  })

  // Archive a meeting
  ipcMain.handle('meetingDeletion:archive', (_event, meetingId: string, archivePath?: string) => {
    console.log('[Main] meetingDeletion:archive', meetingId, archivePath)
    return meetingDeletionService.archiveMeeting(meetingId, archivePath)
  })

  // Restore a soft-deleted meeting
  ipcMain.handle('meetingDeletion:restore', (_event, meetingId: string) => {
    console.log('[Main] meetingDeletion:restore', meetingId)
    return meetingDeletionService.restoreSoftDeletedMeeting(meetingId)
  })

  // Get all soft-deleted meetings
  ipcMain.handle('meetingDeletion:getSoftDeleted', () => {
    console.log('[Main] meetingDeletion:getSoftDeleted')
    return meetingDeletionService.getSoftDeletedMeetings()
  })

  // Get all archived meetings
  ipcMain.handle('meetingDeletion:getArchived', () => {
    console.log('[Main] meetingDeletion:getArchived')
    return meetingDeletionService.getArchivedMeetings()
  })

  // Cleanup expired soft-deleted meetings
  ipcMain.handle('meetingDeletion:cleanupExpired', () => {
    console.log('[Main] meetingDeletion:cleanupExpired')
    return meetingDeletionService.cleanupExpiredSoftDeletes()
  })

  // Get audit logs
  ipcMain.handle('meetingDeletion:getAuditLogs', (_event, limit?: number) => {
    console.log('[Main] meetingDeletion:getAuditLogs', limit)
    return meetingDeletionService.getAuditLogs(limit)
  })

  // Get audit logs for a specific meeting
  ipcMain.handle('meetingDeletion:getAuditLogsForMeeting', (_event, meetingId: string) => {
    console.log('[Main] meetingDeletion:getAuditLogsForMeeting', meetingId)
    return meetingDeletionService.getAuditLogsForMeeting(meetingId)
  })

  // Reassign tasks from one meeting to another
  ipcMain.handle('meetingDeletion:reassignTasks', (_event, fromMeetingId: string, toMeetingId: string) => {
    console.log('[Main] meetingDeletion:reassignTasks', fromMeetingId, '->', toMeetingId)
    return meetingDeletionService.reassignTasks(fromMeetingId, toMeetingId)
  })

  // Unlink tasks from a meeting
  ipcMain.handle('meetingDeletion:unlinkTasks', (_event, meetingId: string) => {
    console.log('[Main] meetingDeletion:unlinkTasks', meetingId)
    return meetingDeletionService.unlinkTasksFromMeeting(meetingId)
  })

  // ============================================================================
  // Export & Delete API - Export meetings before deletion with various formats
  // ============================================================================

  // Get export preview (estimated size, content counts)
  ipcMain.handle('exportDelete:getPreview', async (_event, meetingId: string, options: any) => {
    console.log('[Main] exportDelete:getPreview', meetingId)
    try {
      return await exportDeleteService.getExportPreview(meetingId, options)
    } catch (err) {
      console.error('[Main] exportDelete:getPreview error:', err)
      return null
    }
  })

  // Export meeting to specified format
  ipcMain.handle('exportDelete:exportMeeting', async (_event, meetingId: string, options: any) => {
    console.log('[Main] exportDelete:exportMeeting', meetingId, options.format)
    try {
      return await exportDeleteService.exportMeeting(meetingId, options)
    } catch (err) {
      console.error('[Main] exportDelete:exportMeeting error:', err)
      return {
        success: false,
        format: options.format,
        exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Export multiple meetings (batch)
  ipcMain.handle('exportDelete:exportBatch', async (_event, meetingIds: string[], options: any) => {
    console.log('[Main] exportDelete:exportBatch', meetingIds.length, 'meetings')
    try {
      return await exportDeleteService.exportMeetingsBatch(meetingIds, options)
    } catch (err) {
      console.error('[Main] exportDelete:exportBatch error:', err)
      return {
        success: false,
        totalMeetings: meetingIds.length,
        successfulExports: 0,
        failedExports: meetingIds.length,
        results: [],
        totalSizeBytes: 0,
        errors: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  // Export and then delete a meeting
  ipcMain.handle('exportDelete:exportAndDelete', async (_event, meetingId: string, options: any) => {
    console.log('[Main] exportDelete:exportAndDelete', meetingId)
    try {
      return await exportDeleteService.exportAndDelete(meetingId, options)
    } catch (err) {
      console.error('[Main] exportDelete:exportAndDelete error:', err)
      return {
        success: false,
        exportResult: {
          success: false,
          format: options.export?.format || 'json',
          exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err)
        },
        deleted: false
      }
    }
  })

  // One-click archive to disk
  ipcMain.handle('exportDelete:archiveToDisk', async (_event, meetingId: string, options: any) => {
    console.log('[Main] exportDelete:archiveToDisk', meetingId)
    try {
      return await exportDeleteService.archiveToDisk(meetingId, options)
    } catch (err) {
      console.error('[Main] exportDelete:archiveToDisk error:', err)
      return {
        success: false,
        meetingDeleted: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Validate import file
  ipcMain.handle('exportDelete:validateImport', async (_event, filePath: string) => {
    console.log('[Main] exportDelete:validateImport', filePath)
    try {
      return await exportDeleteService.validateImportFile(filePath)
    } catch (err) {
      console.error('[Main] exportDelete:validateImport error:', err)
      return {
        filePath,
        format: 'json',
        isValid: false,
        availableContent: {
          hasMetadata: false,
          hasTranscripts: false,
          hasNotes: false,
          hasTasks: false,
          hasSpeakers: false,
          hasAudio: false
        },
        fileSizeBytes: 0,
        validationErrors: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  // Import meeting from file
  ipcMain.handle('exportDelete:importMeeting', async (_event, filePath: string, options: any) => {
    console.log('[Main] exportDelete:importMeeting', filePath)
    try {
      return await exportDeleteService.importMeeting(filePath, options)
    } catch (err) {
      console.error('[Main] exportDelete:importMeeting error:', err)
      return {
        success: false,
        importedContent: { transcripts: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
        hadConflict: false,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // Get template configuration
  ipcMain.handle('exportDelete:getTemplateConfig', (_event, template: string) => {
    console.log('[Main] exportDelete:getTemplateConfig', template)
    return exportDeleteService.getTemplateConfig(template as any)
  })

  // Estimate export size
  ipcMain.handle('exportDelete:estimateSize', async (_event, meetingId: string, options: any) => {
    console.log('[Main] exportDelete:estimateSize', meetingId)
    try {
      return await exportDeleteService.estimateExportSize(meetingId, options)
    } catch (err) {
      console.error('[Main] exportDelete:estimateSize error:', err)
      return 0
    }
  })

  // ============================================================================
  // Storage Management API - Storage analysis, cleanup, and optimization
  // ============================================================================

  // Get comprehensive storage usage information
  ipcMain.handle('storageManagement:getUsage', () => {
    console.log('[Main] storageManagement:getUsage')
    return storageManagementService.getStorageUsage()
  })

  // Get storage info for a specific meeting
  ipcMain.handle('storageManagement:getMeetingInfo', (_event, meetingId: string) => {
    console.log('[Main] storageManagement:getMeetingInfo', meetingId)
    return storageManagementService.getMeetingStorageInfo(meetingId)
  })

  // Get cleanup preview based on criteria
  ipcMain.handle('storageManagement:getCleanupPreview', (_event, criteria: CleanupCriteria) => {
    console.log('[Main] storageManagement:getCleanupPreview', criteria)
    return storageManagementService.getCleanupPreview(criteria)
  })

  // Execute cleanup based on criteria
  ipcMain.handle('storageManagement:executeCleanup', (_event, criteria: CleanupCriteria, options?: DeletionOptions) => {
    console.log('[Main] storageManagement:executeCleanup', criteria, options)
    return storageManagementService.executeCleanup(criteria, options)
  })

  // Delete meetings older than X days
  ipcMain.handle('storageManagement:deleteOlderThan', (_event, days: number, options?: DeletionOptions) => {
    console.log('[Main] storageManagement:deleteOlderThan', days, options)
    return storageManagementService.deleteOlderThan(days, options)
  })

  // Delete meetings larger than X bytes
  ipcMain.handle('storageManagement:deleteLargerThan', (_event, bytes: number, options?: DeletionOptions) => {
    console.log('[Main] storageManagement:deleteLargerThan', bytes, options)
    return storageManagementService.deleteLargerThan(bytes, options)
  })

  // Delete meetings without transcripts
  ipcMain.handle('storageManagement:deleteWithoutTranscripts', (_event, options?: DeletionOptions) => {
    console.log('[Main] storageManagement:deleteWithoutTranscripts', options)
    return storageManagementService.deleteWithoutTranscripts(options)
  })

  // Delete meetings without notes
  ipcMain.handle('storageManagement:deleteWithoutNotes', (_event, options?: DeletionOptions) => {
    console.log('[Main] storageManagement:deleteWithoutNotes', options)
    return storageManagementService.deleteWithoutNotes(options)
  })

  // Get storage trends
  ipcMain.handle('storageManagement:getTrends', (_event, days?: number) => {
    console.log('[Main] storageManagement:getTrends', days)
    return storageManagementService.getStorageTrends(days)
  })

  // Record storage trend (should be called periodically)
  ipcMain.handle('storageManagement:recordTrend', () => {
    console.log('[Main] storageManagement:recordTrend')
    storageManagementService.recordStorageTrend()
    return { success: true }
  })

  // Get storage settings
  ipcMain.handle('storageManagement:getSettings', () => {
    console.log('[Main] storageManagement:getSettings')
    return storageManagementService.getStorageSettings()
  })

  // Update storage settings
  ipcMain.handle('storageManagement:updateSettings', (_event, settings: {
    storageLimit?: number
    warningThreshold?: number
    autoCleanup?: boolean
    audioRetentionDays?: number
  }) => {
    console.log('[Main] storageManagement:updateSettings', settings)
    storageManagementService.updateStorageSettings(settings)
    return { success: true }
  })

  // Run auto cleanup
  ipcMain.handle('storageManagement:runAutoCleanup', () => {
    console.log('[Main] storageManagement:runAutoCleanup')
    return storageManagementService.runAutoCleanup()
  })

  // Check if storage warning should be shown
  ipcMain.handle('storageManagement:shouldShowWarning', () => {
    console.log('[Main] storageManagement:shouldShowWarning')
    return storageManagementService.shouldShowStorageWarning()
  })

  // Get cleanup recommendations
  ipcMain.handle('storageManagement:getRecommendations', () => {
    console.log('[Main] storageManagement:getRecommendations')
    return storageManagementService.getCleanupRecommendations()
  })
}

// ============================================================================
// Speaker Name Detection IPC Handlers
// ============================================================================

function setupSpeakerNameDetectionIPC() {
  // Analyze transcript for speaker name detection
  ipcMain.handle('speakerNameDetection:analyzeTranscript', (
    _event,
    meetingId: string,
    speakerId: string,
    content: string,
    timestampMs: number,
    transcriptId?: string
  ) => {
    console.log('[Main] speakerNameDetection:analyzeTranscript', meetingId, speakerId)
    try {
      return speakerNameDetectionService.analyzeTranscript(
        meetingId,
        speakerId,
        content,
        timestampMs,
        transcriptId
      )
    } catch (err) {
      console.error('[Main] Analyze transcript error:', err)
      return null
    }
  })

  // Analyze name reference with speaker change
  ipcMain.handle('speakerNameDetection:analyzeNameReference', (
    _event,
    meetingId: string,
    mentionedName: string,
    mentionerSpeakerId: string,
    nextSpeakerId: string,
    mentionTimestampMs: number,
    speakerChangeTimestampMs: number
  ) => {
    console.log('[Main] speakerNameDetection:analyzeNameReference', meetingId, mentionedName)
    try {
      return speakerNameDetectionService.analyzeNameReferenceWithSpeakerChange(
        meetingId,
        mentionedName,
        mentionerSpeakerId,
        nextSpeakerId,
        mentionTimestampMs,
        speakerChangeTimestampMs
      )
    } catch (err) {
      console.error('[Main] Analyze name reference error:', err)
      return null
    }
  })

  // Check temporal correlation on speaker change
  ipcMain.handle('speakerNameDetection:checkTemporalCorrelation', (
    _event,
    meetingId: string,
    newSpeakerId: string,
    speakerChangeTimestampMs: number
  ) => {
    console.log('[Main] speakerNameDetection:checkTemporalCorrelation', meetingId, newSpeakerId)
    try {
      return speakerNameDetectionService.checkTemporalCorrelation(
        meetingId,
        newSpeakerId,
        speakerChangeTimestampMs
      )
    } catch (err) {
      console.error('[Main] Check temporal correlation error:', err)
      return null
    }
  })

  // Get candidates for a meeting (optionally filtered by speaker)
  ipcMain.handle('speakerNameDetection:getCandidates', (
    _event,
    meetingId: string,
    speakerId?: string
  ) => {
    console.log('[Main] speakerNameDetection:getCandidates', meetingId, speakerId)
    try {
      return speakerNameDetectionService.getCandidates(meetingId, speakerId)
    } catch (err) {
      console.error('[Main] Get candidates error:', err)
      return []
    }
  })

  // Get top candidate for a speaker
  ipcMain.handle('speakerNameDetection:getTopCandidate', (
    _event,
    meetingId: string,
    speakerId: string
  ) => {
    console.log('[Main] speakerNameDetection:getTopCandidate', meetingId, speakerId)
    try {
      return speakerNameDetectionService.getTopCandidate(meetingId, speakerId)
    } catch (err) {
      console.error('[Main] Get top candidate error:', err)
      return null
    }
  })

  // Accept a candidate
  ipcMain.handle('speakerNameDetection:acceptCandidate', (_event, candidateId: string) => {
    console.log('[Main] speakerNameDetection:acceptCandidate', candidateId)
    try {
      return speakerNameDetectionService.acceptCandidate(candidateId)
    } catch (err) {
      console.error('[Main] Accept candidate error:', err)
      return false
    }
  })

  // Reject a candidate
  ipcMain.handle('speakerNameDetection:rejectCandidate', (_event, candidateId: string) => {
    console.log('[Main] speakerNameDetection:rejectCandidate', candidateId)
    try {
      return speakerNameDetectionService.rejectCandidate(candidateId)
    } catch (err) {
      console.error('[Main] Reject candidate error:', err)
      return false
    }
  })

  // Manually set a speaker name
  ipcMain.handle('speakerNameDetection:manuallySetName', (
    _event,
    meetingId: string,
    speakerId: string,
    name: string
  ) => {
    console.log('[Main] speakerNameDetection:manuallySetName', meetingId, speakerId, name)
    try {
      return speakerNameDetectionService.manuallySetName(meetingId, speakerId, name)
    } catch (err) {
      console.error('[Main] Manually set name error:', err)
      return null
    }
  })

  // Get suggestions for a meeting
  ipcMain.handle('speakerNameDetection:getSuggestions', (_event, meetingId: string) => {
    console.log('[Main] speakerNameDetection:getSuggestions', meetingId)
    try {
      return speakerNameDetectionService.getSuggestions(meetingId)
    } catch (err) {
      console.error('[Main] Get suggestions error:', err)
      return []
    }
  })

  // Get meeting summary
  ipcMain.handle('speakerNameDetection:getMeetingSummary', (_event, meetingId: string) => {
    console.log('[Main] speakerNameDetection:getMeetingSummary', meetingId)
    try {
      return speakerNameDetectionService.getMeetingSummary(meetingId)
    } catch (err) {
      console.error('[Main] Get meeting summary error:', err)
      return { meetingId, speakers: [] }
    }
  })

  // Get detection events
  ipcMain.handle('speakerNameDetection:getDetectionEvents', (
    _event,
    meetingId: string,
    limit?: number
  ) => {
    console.log('[Main] speakerNameDetection:getDetectionEvents', meetingId, limit)
    try {
      return speakerNameDetectionService.getDetectionEvents(meetingId, limit)
    } catch (err) {
      console.error('[Main] Get detection events error:', err)
      return []
    }
  })

  // Disambiguate candidates for a speaker
  ipcMain.handle('speakerNameDetection:disambiguate', (
    _event,
    meetingId: string,
    speakerId: string
  ) => {
    console.log('[Main] speakerNameDetection:disambiguate', meetingId, speakerId)
    try {
      return speakerNameDetectionService.disambiguate(meetingId, speakerId)
    } catch (err) {
      console.error('[Main] Disambiguate error:', err)
      return null
    }
  })

  // Get configuration
  ipcMain.handle('speakerNameDetection:getConfig', () => {
    console.log('[Main] speakerNameDetection:getConfig')
    return speakerNameDetectionService.getConfig()
  })

  // Update configuration
  ipcMain.handle('speakerNameDetection:updateConfig', (
    _event,
    config: Partial<SpeakerNameDetectionConfig>
  ) => {
    console.log('[Main] speakerNameDetection:updateConfig', config)
    try {
      return speakerNameDetectionService.updateConfig(config)
    } catch (err) {
      console.error('[Main] Update config error:', err)
      return speakerNameDetectionService.getConfig()
    }
  })

  // Save file dialog - for exporting diagnostics and other data
  ipcMain.handle('dialog:saveFile', async (_event, filename: string, content: string) => {
    console.log('[Main] dialog:saveFile', filename)
    try {
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath('downloads'), filename),
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      })

      if (filePath) {
        await writeFile(filePath, content, 'utf-8')
        console.log('[Main] File saved successfully:', filePath)
        return { success: true, path: filePath }
      }
      return { success: false }
    } catch (err) {
      console.error('[Main] Save file error:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })
}

// ============================================================================
// Data Migration IPC Handlers
// ============================================================================

function setupDataMigrationIPC() {
  // Check if migration is needed
  ipcMain.handle('migration:check', async () => {
    console.log('[Main] migration:check')
    try {
      return await dataMigrationService.checkMigrationNeeded()
    } catch (err) {
      console.error('[Main] Migration check error:', err)
      return {
        needsMigration: false,
        legacyPaths: [],
        totalSizeBytes: 0,
        migrationComplete: false,
        summary: {
          meetingsCount: 0,
          recordingsCount: 0,
          totalAudioFilesSize: 0,
          hasSettings: false,
          databaseSizeBytes: 0
        }
      }
    }
  })

  // Get migration status
  ipcMain.handle('migration:getStatus', async () => {
    console.log('[Main] migration:getStatus')
    try {
      return await dataMigrationService.getMigrationStatus()
    } catch (err) {
      console.error('[Main] Get migration status error:', err)
      return { status: 'not_started' }
    }
  })

  // Perform migration
  ipcMain.handle('migration:migrate', async (_event, legacyPaths: LegacyPathInfo[]) => {
    console.log('[Main] migration:migrate', legacyPaths.length, 'paths')
    try {
      // Set up progress callback to send updates to renderer
      dataMigrationService.onProgress((progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('migration:progress', progress)
        }
      })

      return await dataMigrationService.migrate(legacyPaths)
    } catch (err) {
      console.error('[Main] Migration error:', err)
      return {
        success: false,
        itemsMigrated: 0,
        bytesMigrated: 0,
        pathsUpdated: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
        warnings: []
      }
    }
  })

  // Skip migration
  ipcMain.handle('migration:skip', async () => {
    console.log('[Main] migration:skip')
    try {
      await dataMigrationService.skipMigration()
      return { success: true }
    } catch (err) {
      console.error('[Main] Skip migration error:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  // Rollback migration
  ipcMain.handle('migration:rollback', async () => {
    console.log('[Main] migration:rollback')
    try {
      return await dataMigrationService.rollback()
    } catch (err) {
      console.error('[Main] Rollback error:', err)
      return {
        success: false,
        filesRestored: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error']
      }
    }
  })

  // Validate migration
  ipcMain.handle('migration:validate', async () => {
    console.log('[Main] migration:validate')
    try {
      return await dataMigrationService.validateMigration()
    } catch (err) {
      console.error('[Main] Validate migration error:', err)
      return {
        isValid: false,
        meetingsAccessible: 0,
        meetingsTotal: 0,
        recordingsAccessible: 0,
        recordingsTotal: 0,
        transcriptsCount: 0,
        fileIntegrityPassed: false,
        errors: [err instanceof Error ? err.message : 'Unknown error']
      }
    }
  })

  // Cleanup legacy data
  ipcMain.handle('migration:cleanup', async (_event, legacyPaths: LegacyPathInfo[]) => {
    console.log('[Main] migration:cleanup')
    try {
      return await dataMigrationService.cleanupLegacyData(legacyPaths)
    } catch (err) {
      console.error('[Main] Cleanup error:', err)
      return {
        success: false,
        bytesFreed: 0,
        filesDeleted: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error']
      }
    }
  })

  // Get legacy data size
  ipcMain.handle('migration:getLegacyDataSize', async (_event, legacyPaths: LegacyPathInfo[]) => {
    console.log('[Main] migration:getLegacyDataSize')
    try {
      return await dataMigrationService.getLegacyDataSize(legacyPaths)
    } catch (err) {
      console.error('[Main] Get legacy data size error:', err)
      return { totalBytes: 0, formattedSize: '0 Bytes' }
    }
  })

  // Format bytes utility
  ipcMain.handle('migration:formatBytes', (_event, bytes: number) => {
    return dataMigrationService.formatBytes(bytes)
  })
}
