import { useState } from 'react'
import { Download, FileText, FileCode, Loader2, AlertCircle, CheckCircle, ChevronDown } from 'lucide-react'
import type { ExportAPI, ExportConfig, ExportResult, ExportFormat } from '../../types/electron-api'

// Access the export API with proper typing
const getExportAPI = (): ExportAPI => {
  return (window.electronAPI as unknown as { export: ExportAPI }).export
}

interface ExportButtonProps {
  /** Meeting ID to export */
  meetingId: string
  /** Whether there are transcripts available */
  hasTranscripts?: boolean
  /** Whether there are notes available */
  hasNotes?: boolean
  /** Callback when export completes */
  onExportComplete?: (result: ExportResult) => void
}

/**
 * Export Button Component
 *
 * Provides a dropdown menu to export meeting notes to PDF or Markdown format.
 * Includes options to select what content to include in the export.
 */
export function ExportButton({
  meetingId,
  hasTranscripts = false,
  hasNotes = false,
  onExportComplete
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // Default export config - include everything
  const defaultConfig: ExportConfig = {
    includeSummary: true,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: true,
    includeKeyPoints: true,
    includeMetadata: true
  }

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true)
    setExportFormat(format)
    setShowDropdown(false)
    setResult(null)

    try {
      const exportAPI = getExportAPI()
      let exportResult: ExportResult

      if (format === 'pdf') {
        exportResult = await exportAPI.toPdf(meetingId, undefined, defaultConfig)
      } else {
        exportResult = await exportAPI.toMarkdown(meetingId, undefined, defaultConfig)
      }

      if (exportResult.success) {
        setResult({
          success: true,
          message: `Successfully exported to ${format.toUpperCase()}`
        })
        onExportComplete?.(exportResult)
      } else {
        setResult({
          success: false,
          message: exportResult.error || 'Export failed'
        })
      }

      // Auto-hide success message after 5 seconds
      if (exportResult.success) {
        setTimeout(() => {
          setResult(null)
        }, 5000)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      setResult({
        success: false,
        message: errorMessage
      })
    } finally {
      setIsExporting(false)
      setExportFormat(null)
    }
  }

  const formatOptions: { format: ExportFormat; label: string; icon: typeof FileText; description: string }[] = [
    {
      format: 'pdf',
      label: 'Export as PDF',
      icon: FileText,
      description: 'Formatted document with styling'
    },
    {
      format: 'markdown',
      label: 'Export as Markdown',
      icon: FileCode,
      description: 'Plain text with markdown formatting'
    }
  ]

  // If no content to export, don't show the button
  if (!hasTranscripts && !hasNotes) {
    return null
  }

  return (
    <div className="relative">
      {/* Main Export Button */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isExporting}
        className={`inline-flex items-center px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
          isExporting
            ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {isExporting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Exporting{exportFormat ? ` ${exportFormat.toUpperCase()}` : ''}...
          </>
        ) : (
          <>
            <Download className="w-4 h-4 mr-2" />
            Export
            <ChevronDown className="w-4 h-4 ml-1" />
          </>
        )}
      </button>

      {/* Dropdown Menu */}
      {showDropdown && !isExporting && (
        <>
          {/* Backdrop to close dropdown */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />

          {/* Dropdown content */}
          <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white shadow-lg border border-gray-200 z-20 overflow-hidden">
            <div className="p-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-3 py-2">
                Export Format
              </p>
              {formatOptions.map(({ format, label, icon: Icon, description }) => (
                <button
                  key={format}
                  onClick={() => handleExport(format)}
                  className="w-full flex items-start gap-3 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors text-left"
                >
                  <Icon className="w-5 h-5 text-gray-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500">{description}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Export info */}
            <div className="border-t border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">
                Includes: Summary, Action Items, Decisions, Key Points
                {hasTranscripts && ', Transcript'}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Result message */}
      {result && (
        <div className={`absolute top-full left-0 right-0 mt-2 p-3 rounded-lg shadow-md z-30 ${
          result.success
            ? 'bg-green-50 border border-green-200'
            : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-start gap-2">
            {result.success ? (
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            )}
            <p className={`text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
              {result.message}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExportButton
