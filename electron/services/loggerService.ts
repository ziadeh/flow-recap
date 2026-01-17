/**
 * Logger Service
 *
 * Provides structured logging using electron-log with support for:
 * - Multiple log levels (error, warn, info, debug)
 * - File-based log persistence
 * - Context tagging for better log organization
 * - Error logging with stack traces
 * - IPC-based renderer process logging
 */

import log from 'electron-log'
import { app } from 'electron'
import path from 'path'

// Configure electron-log
const setupLogger = () => {
  // Set log file path
  const logPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(process.cwd(), 'logs')

  log.transports.file.resolvePathFn = () => path.join(logPath, 'main.log')

  // Configure log format
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.console.format = '[{level}] {text}'

  // Set max log file size (10MB)
  log.transports.file.maxSize = 10 * 1024 * 1024

  // Keep the last 5 log files
  // Note: electron-log handles rotation automatically

  // Set log level based on environment
  if (process.env.NODE_ENV === 'development') {
    log.transports.console.level = 'debug'
    log.transports.file.level = 'debug'
  } else {
    log.transports.console.level = 'info'
    log.transports.file.level = 'info'
  }

  return log
}

// Initialize logger
const logger = setupLogger()

export interface LogContext {
  module?: string
  action?: string
  meetingId?: string
  recordingId?: string
  [key: string]: unknown
}

/**
 * Format context for logging
 */
function formatContext(context?: LogContext): string {
  if (!context) return ''
  const parts: string[] = []
  if (context.module) parts.push(`[${context.module}]`)
  if (context.action) parts.push(`(${context.action})`)
  return parts.length > 0 ? parts.join(' ') + ' ' : ''
}

/**
 * Logger interface for structured logging
 */
export const loggerService = {
  /**
   * Log an error with optional context and error object
   */
  error: (message: string, errorOrContext?: Error | LogContext, context?: LogContext) => {
    const ctx = errorOrContext instanceof Error ? context : errorOrContext
    const err = errorOrContext instanceof Error ? errorOrContext : undefined
    const prefix = formatContext(ctx)

    if (err) {
      logger.error(`${prefix}${message}`, {
        error: err.message,
        stack: err.stack,
        ...ctx
      })
    } else {
      logger.error(`${prefix}${message}`, ctx || {})
    }
  },

  /**
   * Log a warning with optional context
   */
  warn: (message: string, context?: LogContext) => {
    const prefix = formatContext(context)
    logger.warn(`${prefix}${message}`, context || {})
  },

  /**
   * Log info with optional context
   */
  info: (message: string, context?: LogContext) => {
    const prefix = formatContext(context)
    logger.info(`${prefix}${message}`, context || {})
  },

  /**
   * Log debug information with optional context
   */
  debug: (message: string, context?: LogContext) => {
    const prefix = formatContext(context)
    logger.debug(`${prefix}${message}`, context || {})
  },

  /**
   * Log a successful operation
   */
  success: (operation: string, context?: LogContext) => {
    const prefix = formatContext(context)
    logger.info(`${prefix}${operation} completed successfully`, context || {})
  },

  /**
   * Log operation start for tracking
   */
  startOperation: (operation: string, context?: LogContext) => {
    const prefix = formatContext(context)
    logger.info(`${prefix}Starting: ${operation}`, context || {})
  },

  /**
   * Log operation end with duration
   */
  endOperation: (operation: string, startTime: number, context?: LogContext) => {
    const duration = Date.now() - startTime
    const prefix = formatContext(context)
    logger.info(`${prefix}Completed: ${operation} (${duration}ms)`, {
      ...context,
      duration
    })
  },

  /**
   * Create a scoped logger for a specific module
   */
  scope: (moduleName: string) => {
    return {
      error: (message: string, errorOrContext?: Error | LogContext, context?: LogContext) => {
        loggerService.error(message, errorOrContext, { ...context, module: moduleName })
      },
      warn: (message: string, context?: LogContext) => {
        loggerService.warn(message, { ...context, module: moduleName })
      },
      info: (message: string, context?: LogContext) => {
        loggerService.info(message, { ...context, module: moduleName })
      },
      debug: (message: string, context?: LogContext) => {
        loggerService.debug(message, { ...context, module: moduleName })
      },
      success: (operation: string, context?: LogContext) => {
        loggerService.success(operation, { ...context, module: moduleName })
      },
      startOperation: (operation: string, context?: LogContext) => {
        loggerService.startOperation(operation, { ...context, module: moduleName })
      },
      endOperation: (operation: string, startTime: number, context?: LogContext) => {
        loggerService.endOperation(operation, startTime, { ...context, module: moduleName })
      }
    }
  },

  /**
   * Get the raw electron-log instance for advanced use
   */
  getRawLogger: () => logger,

  /**
   * Get the log file path
   */
  getLogPath: () => {
    return log.transports.file.getFile().path
  }
}

export default loggerService
