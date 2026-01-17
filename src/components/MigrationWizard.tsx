/**
 * Migration Wizard Component
 *
 * User-friendly migration wizard for transferring data from legacy 'Meeting Notes'
 * installation to the renamed 'FlowRecap' application.
 *
 * Features:
 * - Detection of legacy data
 * - Progress tracking with visual feedback
 * - Validation of migrated data
 * - Rollback option if migration fails
 * - Cleanup option after successful migration
 * - Skip option to start fresh
 */

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  ArrowRight,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Database,
  FolderOpen,
  Trash2,
  RefreshCw,
  X,
  HelpCircle,
  ChevronRight,
  Sparkles
} from 'lucide-react'

// ============================================================================
// Type Definitions (matching electron/preload.ts)
// ============================================================================

interface MigrationSummary {
  meetingsCount: number
  recordingsCount: number
  totalAudioFilesSize: number
  hasSettings: boolean
  databaseSizeBytes: number
}

interface LegacyPathInfo {
  type: 'appData' | 'documents' | 'recordings'
  legacyPath: string
  newPath: string
  exists: boolean
  sizeBytes: number
  fileCount?: number
}

interface MigrationCheckResult {
  needsMigration: boolean
  legacyPaths: LegacyPathInfo[]
  totalSizeBytes: number
  migrationComplete: boolean
  summary: MigrationSummary
}

interface MigrationProgress {
  phase: 'checking' | 'backing_up' | 'copying' | 'updating_paths' | 'validating' | 'cleanup' | 'complete' | 'error' | 'rolling_back'
  currentItem?: string
  itemsCopied: number
  totalItems: number
  bytesCopied: number
  totalBytes: number
  errorMessage?: string
  percentComplete: number
}

interface ValidationResult {
  isValid: boolean
  meetingsAccessible: number
  meetingsTotal: number
  recordingsAccessible: number
  recordingsTotal: number
  transcriptsCount: number
  fileIntegrityPassed: boolean
  errors: string[]
}

interface MigrationResult {
  success: boolean
  itemsMigrated: number
  bytesMigrated: number
  pathsUpdated: number
  errors: string[]
  warnings: string[]
  validation?: ValidationResult
}

interface CleanupResult {
  success: boolean
  bytesFreed: number
  filesDeleted: number
  errors: string[]
}

interface RollbackResult {
  success: boolean
  filesRestored: number
  errors: string[]
}

// Migration API type (for type assertions)
interface MigrationAPI {
  check: () => Promise<MigrationCheckResult>
  getStatus: () => Promise<{ status: string }>
  migrate: (legacyPaths: LegacyPathInfo[]) => Promise<MigrationResult>
  skip: () => Promise<{ success: boolean; error?: string }>
  rollback: () => Promise<RollbackResult>
  validate: () => Promise<ValidationResult>
  cleanup: (legacyPaths: LegacyPathInfo[]) => Promise<CleanupResult>
  getLegacyDataSize: (legacyPaths: LegacyPathInfo[]) => Promise<{ totalBytes: number; formattedSize: string }>
  formatBytes: (bytes: number) => Promise<string>
  onProgress: (callback: (progress: MigrationProgress) => void) => () => void
}

// Helper to get the migration API with proper typing
function getMigrationAPI(): MigrationAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI?.migration
}

// ============================================================================
// Types
// ============================================================================

interface MigrationWizardProps {
  onComplete: () => void
  onSkip: () => void
}

type WizardStep = 'detect' | 'confirm' | 'migrate' | 'validate' | 'cleanup' | 'complete' | 'error'

// ============================================================================
// Helper Components
// ============================================================================

function ProgressBar({ percent, phase }: { percent: number; phase: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground capitalize">{phase.replace('_', ' ')}</span>
        <span className="font-medium">{Math.round(percent)}%</span>
      </div>
      <div className="h-3 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-600 transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function DataSummary({
  summary,
  totalSize
}: {
  summary: MigrationCheckResult['summary']
  totalSize: string
}) {
  return (
    <div className="grid grid-cols-2 gap-4 p-4 bg-secondary/30 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
          <Database className="h-5 w-5 text-purple-600" />
        </div>
        <div>
          <p className="text-sm font-medium">{summary.meetingsCount} Meetings</p>
          <p className="text-xs text-muted-foreground">{summary.recordingsCount} recordings</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <FolderOpen className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-medium">{totalSize}</p>
          <p className="text-xs text-muted-foreground">Total data size</p>
        </div>
      </div>
    </div>
  )
}

function LegacyPathsList({ paths }: { paths: LegacyPathInfo[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Data locations found:</p>
      <div className="space-y-2">
        {paths.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-2 p-2 bg-secondary/50 rounded text-sm font-mono"
          >
            <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate">{p.legacyPath}</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {formatBytes(p.sizeBytes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// ============================================================================
// Main Component
// ============================================================================

export function MigrationWizard({ onComplete, onSkip }: MigrationWizardProps) {
  const [step, setStep] = useState<WizardStep>('detect')
  const [checkResult, setCheckResult] = useState<MigrationCheckResult | null>(null)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showLearnMore, setShowLearnMore] = useState(false)

  // Check for migration need on mount
  useEffect(() => {
    const checkMigration = async () => {
      try {
        setIsLoading(true)
        const migrationAPI = getMigrationAPI()
        if (!migrationAPI) {
          // No migration API available, complete immediately
          onComplete()
          return
        }
        const result = await migrationAPI.check()
        setCheckResult(result)

        if (!result.needsMigration) {
          // No migration needed, complete immediately
          onComplete()
        }
      } catch (err) {
        console.error('Failed to check migration:', err)
        setError(err instanceof Error ? err.message : 'Failed to check for legacy data')
        setStep('error')
      } finally {
        setIsLoading(false)
      }
    }

    checkMigration()
  }, [onComplete])

  // Subscribe to progress updates
  useEffect(() => {
    const migrationAPI = getMigrationAPI()
    if (!migrationAPI?.onProgress) return

    const unsubscribe = migrationAPI.onProgress((p: MigrationProgress) => {
      setProgress(p)

      if (p.phase === 'complete') {
        setStep('validate')
      } else if (p.phase === 'error') {
        setError(p.errorMessage || 'Migration failed')
        setStep('error')
      }
    })

    return unsubscribe
  }, [])

  // Handle migration
  const handleMigrate = useCallback(async () => {
    if (!checkResult?.legacyPaths) return

    setStep('migrate')
    setError(null)

    try {
      const migrationAPI = getMigrationAPI()
      const result = await migrationAPI.migrate(checkResult.legacyPaths)
      setMigrationResult(result)

      if (result.success) {
        setStep('validate')
      } else {
        setError(result.errors.join('; '))
        setStep('error')
      }
    } catch (err) {
      console.error('Migration failed:', err)
      setError(err instanceof Error ? err.message : 'Migration failed')
      setStep('error')
    }
  }, [checkResult])

  // Handle skip
  const handleSkip = useCallback(async () => {
    try {
      const migrationAPI = getMigrationAPI()
      await migrationAPI.skip()
      onSkip()
    } catch (err) {
      console.error('Failed to skip migration:', err)
      setError(err instanceof Error ? err.message : 'Failed to skip migration')
    }
  }, [onSkip])

  // Handle rollback
  const handleRollback = useCallback(async () => {
    try {
      setIsLoading(true)
      const migrationAPI = getMigrationAPI()
      const result = await migrationAPI.rollback()

      if (result.success) {
        // Reset to detection step
        setStep('detect')
        setMigrationResult(null)
        setProgress(null)
        setError(null)

        // Re-check migration status
        const checkResultNew = await migrationAPI.check()
        setCheckResult(checkResultNew)
      } else {
        setError('Rollback failed: ' + result.errors.join('; '))
      }
    } catch (err) {
      console.error('Rollback failed:', err)
      setError(err instanceof Error ? err.message : 'Rollback failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle cleanup
  const handleCleanup = useCallback(async () => {
    if (!checkResult?.legacyPaths) return

    setStep('cleanup')
    setIsLoading(true)

    try {
      const migrationAPI = getMigrationAPI()
      const result = await migrationAPI.cleanup(checkResult.legacyPaths)
      setCleanupResult(result)
      setStep('complete')
    } catch (err) {
      console.error('Cleanup failed:', err)
      // Don't fail the whole process, just go to complete
      setStep('complete')
    } finally {
      setIsLoading(false)
    }
  }, [checkResult])

  // Handle complete without cleanup
  const handleCompleteWithoutCleanup = useCallback(() => {
    setStep('complete')
  }, [])

  // Handle final complete
  const handleFinalComplete = useCallback(() => {
    onComplete()
  }, [onComplete])

  // Loading state
  if (isLoading && step === 'detect') {
    return (
      <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-purple-600 mx-auto" />
          <h2 className="text-xl font-semibold">Checking for existing data...</h2>
          <p className="text-muted-foreground">
            Looking for Meeting Notes data to migrate to FlowRecap
          </p>
        </div>
      </div>
    )
  }

  // No migration needed (shouldn't normally render)
  if (!checkResult?.needsMigration && step === 'detect') {
    return null
  }

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <Sparkles className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Welcome to FlowRecap!</h1>
            <p className="text-sm text-muted-foreground">
              {step === 'detect' || step === 'confirm'
                ? "We've found your Meeting Notes data"
                : step === 'migrate'
                ? 'Migrating your data...'
                : step === 'validate'
                ? 'Verifying migration...'
                : step === 'cleanup'
                ? 'Cleaning up...'
                : step === 'complete'
                ? 'Migration complete!'
                : 'Migration encountered an issue'}
            </p>
          </div>
        </div>

        {(step === 'detect' || step === 'confirm') && (
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-2"
          >
            Skip Migration
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto">
          {/* Detection/Confirm Step */}
          {(step === 'detect' || step === 'confirm') && checkResult && (
            <div className="space-y-6">
              {/* Welcome message */}
              <div className="text-center space-y-4">
                <h2 className="text-2xl font-bold text-foreground">
                  We've rebranded to FlowRecap!
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  We found existing Meeting Notes data on your computer. Would you like to migrate
                  your meetings, recordings, and settings to FlowRecap?
                </p>
              </div>

              {/* Data summary */}
              <DataSummary
                summary={checkResult.summary}
                totalSize={formatBytes(checkResult.totalSizeBytes)}
              />

              {/* Legacy paths */}
              <LegacyPathsList paths={checkResult.legacyPaths} />

              {/* Learn more section */}
              <div className="border border-border rounded-lg">
                <button
                  onClick={() => setShowLearnMore(!showLearnMore)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">What will happen during migration?</span>
                  </div>
                  <ChevronRight
                    className={cn(
                      'h-5 w-5 text-muted-foreground transition-transform',
                      showLearnMore && 'rotate-90'
                    )}
                  />
                </button>

                {showLearnMore && (
                  <div className="p-4 pt-0 space-y-3 text-sm text-muted-foreground">
                    <p>During migration, FlowRecap will:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Copy your database with all meetings and transcripts</li>
                      <li>Move your audio recordings to the new location</li>
                      <li>Transfer your app settings and preferences</li>
                      <li>Update file paths to reference new directories</li>
                      <li>Verify all data was transferred correctly</li>
                    </ul>
                    <p className="pt-2">
                      <strong className="text-foreground">Your original data will be preserved</strong>{' '}
                      until you choose to delete it after confirming the migration was successful.
                    </p>
                  </div>
                )}
              </div>

              {/* Warning about skip */}
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-900 dark:text-amber-200">
                      Skipping migration will start fresh
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      If you skip, your existing meetings, recordings, and settings will not be
                      available in FlowRecap. The original data will remain on your computer.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4">
                <button
                  onClick={handleSkip}
                  className="px-4 py-2 border border-border hover:bg-secondary rounded-md font-medium text-muted-foreground"
                >
                  Skip & Start Fresh
                </button>
                <button
                  onClick={handleMigrate}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
                >
                  Migrate Now
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Migration in progress */}
          {step === 'migrate' && progress && (
            <div className="space-y-6">
              <div className="text-center space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-purple-600 mx-auto" />
                <h2 className="text-2xl font-bold text-foreground">Migrating your data...</h2>
                <p className="text-muted-foreground">
                  Please don't close the app while migration is in progress
                </p>
              </div>

              <ProgressBar percent={progress.percentComplete} phase={progress.phase} />

              {progress.currentItem && (
                <p className="text-sm text-center text-muted-foreground">
                  {progress.currentItem}
                </p>
              )}

              <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="text-center p-3 bg-secondary/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{progress.itemsCopied}</p>
                  <p className="text-xs text-muted-foreground">Items copied</p>
                </div>
                <div className="text-center p-3 bg-secondary/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">
                    {formatBytes(progress.bytesCopied)}
                  </p>
                  <p className="text-xs text-muted-foreground">Data transferred</p>
                </div>
                <div className="text-center p-3 bg-secondary/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{progress.totalItems}</p>
                  <p className="text-xs text-muted-foreground">Total items</p>
                </div>
              </div>
            </div>
          )}

          {/* Validation step */}
          {step === 'validate' && migrationResult && (
            <div className="space-y-6">
              <div className="text-center space-y-4">
                {migrationResult.validation?.isValid ? (
                  <>
                    <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                      <CheckCircle className="h-10 w-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">Migration Successful!</h2>
                    <p className="text-muted-foreground">
                      All your data has been migrated and verified successfully.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mx-auto w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                      <AlertTriangle className="h-10 w-10 text-amber-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">Migration Completed with Warnings</h2>
                    <p className="text-muted-foreground">
                      Most data was migrated successfully, but some issues were detected.
                    </p>
                  </>
                )}
              </div>

              {/* Validation results */}
              {migrationResult.validation && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-secondary/30 rounded-lg">
                    <p className="text-sm text-muted-foreground">Meetings</p>
                    <p className="text-xl font-bold">
                      {migrationResult.validation.meetingsAccessible} /{' '}
                      {migrationResult.validation.meetingsTotal}
                    </p>
                  </div>
                  <div className="p-4 bg-secondary/30 rounded-lg">
                    <p className="text-sm text-muted-foreground">Recordings</p>
                    <p className="text-xl font-bold">
                      {migrationResult.validation.recordingsAccessible} /{' '}
                      {migrationResult.validation.recordingsTotal}
                    </p>
                  </div>
                </div>
              )}

              {/* Warnings */}
              {migrationResult.warnings.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <p className="font-medium text-amber-900 dark:text-amber-200 mb-2">Warnings:</p>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                    {migrationResult.warnings.map((w: string, i: number) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cleanup offer */}
              {checkResult && checkResult.legacyPaths.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Trash2 className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-900 dark:text-blue-200">
                        Delete old Meeting Notes data?
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                        This will free up {formatBytes(checkResult.totalSizeBytes)} of space. Your
                        data is now safely stored in FlowRecap.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4">
                <button
                  onClick={handleCompleteWithoutCleanup}
                  className="px-4 py-2 border border-border hover:bg-secondary rounded-md font-medium"
                >
                  Keep Old Data
                </button>
                <button
                  onClick={handleCleanup}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
                >
                  Delete Old Data & Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Cleanup in progress */}
          {step === 'cleanup' && isLoading && (
            <div className="space-y-6 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-purple-600 mx-auto" />
              <h2 className="text-2xl font-bold text-foreground">Cleaning up old data...</h2>
              <p className="text-muted-foreground">Removing legacy Meeting Notes files</p>
            </div>
          )}

          {/* Complete step */}
          {step === 'complete' && (
            <div className="space-y-6">
              <div className="text-center space-y-4">
                <div className="mx-auto w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-12 w-12 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">You're all set!</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Your data has been successfully migrated to FlowRecap. Enjoy the new experience!
                </p>
              </div>

              {/* Cleanup results */}
              {cleanupResult && cleanupResult.success && (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
                  <p className="text-green-900 dark:text-green-200">
                    <strong>{formatBytes(cleanupResult.bytesFreed)}</strong> of space freed by
                    removing old data
                  </p>
                </div>
              )}

              {/* Summary */}
              {migrationResult && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-secondary/30 rounded-lg">
                    <p className="text-2xl font-bold text-foreground">
                      {migrationResult.itemsMigrated}
                    </p>
                    <p className="text-xs text-muted-foreground">Items migrated</p>
                  </div>
                  <div className="text-center p-4 bg-secondary/30 rounded-lg">
                    <p className="text-2xl font-bold text-foreground">
                      {formatBytes(migrationResult.bytesMigrated)}
                    </p>
                    <p className="text-xs text-muted-foreground">Data transferred</p>
                  </div>
                  <div className="text-center p-4 bg-secondary/30 rounded-lg">
                    <p className="text-2xl font-bold text-foreground">
                      {migrationResult.pathsUpdated}
                    </p>
                    <p className="text-xs text-muted-foreground">Paths updated</p>
                  </div>
                </div>
              )}

              {/* Continue button */}
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleFinalComplete}
                  className="px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
                >
                  Get Started with FlowRecap
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

          {/* Error step */}
          {step === 'error' && (
            <div className="space-y-6">
              <div className="text-center space-y-4">
                <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-10 w-10 text-red-600" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Migration Failed</h2>
                <p className="text-muted-foreground">
                  Something went wrong during the migration process.
                </p>
              </div>

              {/* Error message */}
              {error && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p className="text-sm text-red-900 dark:text-red-200 font-mono">{error}</p>
                </div>
              )}

              {/* Help text */}
              <div className="bg-secondary/30 rounded-lg p-4 space-y-2">
                <p className="font-medium">Don't worry, your data is safe!</p>
                <p className="text-sm text-muted-foreground">
                  Your original Meeting Notes data has not been modified. You can try the migration
                  again or skip to start fresh.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4">
                <button
                  onClick={handleSkip}
                  className="px-4 py-2 border border-border hover:bg-secondary rounded-md font-medium text-muted-foreground"
                >
                  Skip & Start Fresh
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={handleRollback}
                    disabled={isLoading}
                    className="px-4 py-2 border border-border hover:bg-secondary rounded-md font-medium flex items-center gap-2"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Rollback
                  </button>
                  <button
                    onClick={handleMigrate}
                    disabled={isLoading}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
                  >
                    Try Again
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default MigrationWizard
