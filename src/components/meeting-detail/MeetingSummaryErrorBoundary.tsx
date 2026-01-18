/**
 * Meeting Summary Error Boundary
 *
 * Catches React rendering errors specifically for the Meeting Summary section
 * and provides a user-friendly fallback UI with debugging information.
 */

import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, Bug } from 'lucide-react'

interface Props {
  children: ReactNode
  meetingId: string
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
}

export class MeetingSummaryErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging
    console.error('[MeetingSummaryErrorBoundary] Error caught:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      meetingId: this.props.meetingId,
      timestamp: new Date().toISOString(),
    })

    // Log to console in a structured format for DevTools
    console.group('%c[MeetingSummary Debug] Error Boundary Triggered', 'color: red; font-weight: bold')
    console.log('Meeting ID:', this.props.meetingId)
    console.log('Error Message:', error.message)
    console.log('Error Stack:', error.stack)
    console.log('Component Stack:', errorInfo.componentStack)
    console.log('Timestamp:', new Date().toISOString())
    console.groupEnd()

    this.setState({
      error,
      errorInfo,
    })
  }

  private handleRetry = () => {
    console.log('[MeetingSummaryErrorBoundary] Retry requested for meeting:', this.props.meetingId)
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
    this.props.onRetry?.()
  }

  private toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }))
  }

  private copyDiagnostics = () => {
    const diagnostics = {
      error: this.state.error?.message,
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      meetingId: this.props.meetingId,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    }
    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      .then(() => alert('Diagnostics copied to clipboard'))
      .catch((err) => console.error('Failed to copy diagnostics:', err))
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden bg-red-50 dark:bg-red-900/20"
          data-testid="meeting-summary-error-boundary"
          data-meeting-id={this.props.meetingId}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-red-200 dark:border-red-800 bg-red-100 dark:bg-red-900/30">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              <h3 className="font-semibold text-red-700 dark:text-red-300">
                Failed to load Meeting Summary
              </h3>
            </div>
            <button
              onClick={this.toggleDetails}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              <Bug className="w-4 h-4" />
              View Details
              {this.state.showDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            <p className="text-sm text-red-700 dark:text-red-300 mb-3">
              An error occurred while rendering the Meeting Summary section.
              This may be due to corrupted data or a rendering issue.
            </p>

            {/* Error Details (Expandable) */}
            {this.state.showDetails && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-md">
                <h4 className="text-xs font-semibold text-red-800 dark:text-red-200 mb-2 uppercase tracking-wide">
                  Error Details
                </h4>
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="font-medium text-red-700 dark:text-red-300">Error Message:</dt>
                    <dd className="font-mono text-red-600 dark:text-red-400 break-all">
                      {this.state.error?.message || 'Unknown error'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-red-700 dark:text-red-300">Meeting ID:</dt>
                    <dd className="font-mono text-red-600 dark:text-red-400">
                      {this.props.meetingId}
                    </dd>
                  </div>
                  {process.env.NODE_ENV === 'development' && this.state.error?.stack && (
                    <div>
                      <dt className="font-medium text-red-700 dark:text-red-300">Stack Trace:</dt>
                      <dd className="font-mono text-red-600 dark:text-red-400 text-[10px] whitespace-pre-wrap overflow-auto max-h-32">
                        {this.state.error.stack}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
              {this.state.showDetails && (
                <button
                  onClick={this.copyDiagnostics}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                >
                  Copy Diagnostics
                </button>
              )}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default MeetingSummaryErrorBoundary
