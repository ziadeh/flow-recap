/**
 * Keyboard Shortcuts Help Modal
 *
 * Displays all available keyboard shortcuts organized by category.
 * Allows users to see and learn the available shortcuts.
 */

import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useKeyboardShortcutsStore } from '@/stores'
import {
  formatShortcut,
  type KeyboardShortcut,
  type ShortcutCategory,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from '@/types/keyboard'

interface KeyboardShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const { shortcuts, globalEnabled } = useKeyboardShortcutsStore()

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Group shortcuts by category
  const shortcutsByCategory = CATEGORY_ORDER.reduce((acc, category) => {
    const categoryShortcuts = Object.values(shortcuts).filter(
      (shortcut) => shortcut.category === category && shortcut.enabled
    )
    if (categoryShortcuts.length > 0) {
      acc[category] = categoryShortcuts
    }
    return acc
  }, {} as Record<ShortcutCategory, KeyboardShortcut[]>)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Keyboard className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-lg font-semibold text-foreground">
                Keyboard Shortcuts
              </h2>
              <p className="text-sm text-muted-foreground">
                {globalEnabled ? 'Shortcuts are enabled' : 'Shortcuts are disabled'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!globalEnabled && (
            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Keyboard shortcuts are currently disabled. Enable them in Settings to use these shortcuts.
              </p>
            </div>
          )}

          <div className="space-y-6">
            {Object.entries(shortcutsByCategory).map(([category, categoryShortcuts]) => (
              <div key={category}>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  {CATEGORY_LABELS[category as ShortcutCategory]}
                </h3>
                <div className="space-y-2">
                  {categoryShortcuts.map((shortcut) => (
                    <ShortcutRow key={shortcut.action} shortcut={shortcut} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            Press <ShortcutKey keys={['⌘', '/']} /> to toggle this help anytime
          </p>
        </div>
      </div>
    </div>
  )
}

interface ShortcutRowProps {
  shortcut: KeyboardShortcut
}

function ShortcutRow({ shortcut }: ShortcutRowProps) {
  const formattedShortcut = formatShortcut(shortcut)
  const keys = formattedShortcut.split(/(?=[A-Z⌘⌃⌥⇧])/).filter(Boolean)

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <span className="text-sm text-foreground">{shortcut.description}</span>
      <ShortcutKey keys={keys} />
    </div>
  )
}

interface ShortcutKeyProps {
  keys: string[]
}

function ShortcutKey({ keys }: ShortcutKeyProps) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, index) => (
        <kbd
          key={index}
          className={cn(
            'inline-flex items-center justify-center min-w-[24px] h-6 px-1.5',
            'text-xs font-medium',
            'bg-muted border border-border rounded',
            'text-muted-foreground'
          )}
        >
          {key}
        </kbd>
      ))}
    </div>
  )
}

/**
 * Shortcut Hint Component
 * Small inline display of a keyboard shortcut for use in UI elements
 */
interface ShortcutHintProps {
  shortcut: KeyboardShortcut
  className?: string
}

export function ShortcutHint({ shortcut, className }: ShortcutHintProps) {
  const formatted = formatShortcut(shortcut)

  return (
    <span
      className={cn(
        'text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded',
        className
      )}
      title={shortcut.description}
    >
      {formatted}
    </span>
  )
}

/**
 * Inline shortcut badge for navigation items
 */
interface NavShortcutBadgeProps {
  shortcutKey: string
  className?: string
}

export function NavShortcutBadge({ shortcutKey, className }: NavShortcutBadgeProps) {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

  return (
    <span
      className={cn(
        'text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded',
        className
      )}
    >
      {isMac ? '⌘' : 'Ctrl+'}{shortcutKey.toUpperCase()}
    </span>
  )
}

export default KeyboardShortcutsModal
