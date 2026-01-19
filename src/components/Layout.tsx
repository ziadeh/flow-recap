import { ReactNode, useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings,
  Home,
  FileText,
  Mic,
  Calendar,
  LayoutGrid,
  Keyboard,
  Search
} from 'lucide-react'
import appIcon from '../../resources/FlowRecap-sign.png'
import { useNewMeeting } from '@/hooks/useNewMeeting'
import { NewMeetingModal } from './NewMeetingModal'
import { RecordingIndicator } from './RecordingIndicator'
import { useRecordingStatus } from '@/stores/recording-store'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal'
import { useKeyboardShortcutsStore } from '@/stores'
import { ToastContainer } from './ui/Toast'
import { UpdateNotification } from './UpdateNotification'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { isHelpModalOpen, closeHelpModal } = useKeyboardShortcutsStore()
  const { openModal: openNewMeetingModal } = useNewMeeting()

  // Callbacks for keyboard shortcuts
  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, [])

  const handleGlobalSearch = useCallback(() => {
    setIsSearchOpen(true)
  }, [])

  const handleNewMeeting = useCallback(() => {
    openNewMeetingModal()
  }, [openNewMeetingModal])

  // Initialize keyboard shortcuts
  useKeyboardShortcuts({
    onToggleSidebar: handleToggleSidebar,
    onGlobalSearch: handleGlobalSearch,
    onNewMeeting: handleNewMeeting,
  })

  // Note: Recording state sync and audio level listeners are now handled
  // exclusively by the useRecording hook to avoid duplicate IPC calls
  // and improve performance

  // Separate banners from routes
  const childrenArray = Array.isArray(children) ? children : [children]
  const banners = childrenArray.filter((child: any) =>
    child?.type?.name === 'EnvironmentWarningBanner'
  )
  const routes = childrenArray.filter((child: any) =>
    child?.type?.name !== 'EnvironmentWarningBanner'
  )

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        {/* Render banners below header */}
        {banners}
        <MainContent>{routes}</MainContent>
      </div>

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsModal isOpen={isHelpModalOpen} onClose={closeHelpModal} />

      {/* Global Search Modal (placeholder for now) */}
      {isSearchOpen && (
        <GlobalSearchModal onClose={() => setIsSearchOpen(false)} />
      )}

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Update Notification Banner */}
      <UpdateNotification />
    </div>
  )
}

// Simple global search modal placeholder
function GlobalSearchModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl mx-4">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search meetings, tasks, notes..."
            className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
            autoFocus
          />
          <span className="text-xs text-muted-foreground">ESC to close</span>
        </div>
        <div className="p-4 text-center text-muted-foreground text-sm">
          Start typing to search across all your meetings and notes
        </div>
      </div>
    </div>
  )
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { openHelpModal } = useKeyboardShortcutsStore()

  const isActive = (path: string) => location.pathname === path

  return (
    <aside
      className={cn(
        "bg-secondary/50 border-r border-border flex flex-col transition-all duration-300 relative",
        "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border after:opacity-50",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Drag region for macOS traffic lights area */}
      <div className="h-8 app-drag-region flex-shrink-0" />
      {/* Top Section */}
      <div className="px-4 pb-4 border-b border-border">
        {!collapsed ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={appIcon}
                alt="FlowRecap"
                className="h-[42px] w-[42px] object-contain"
              />
              <div className="leading-tight">
                <h2 className="text-lg font-bold text-foreground">FlowRecap</h2>
                <p className="text-xs text-muted-foreground -mt-0.5">v1.0.0</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate('/settings')}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <img
              src={appIcon}
              alt="FlowRecap"
              className="h-[42px] w-[42px] object-contain"
            />
            <button
              onClick={() => navigate('/settings')}
              className="p-1.5 rounded hover:bg-accent"
              title="Settings"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {!collapsed && (
          <button
            onClick={() => navigate('/meetings')}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-colors"
          >
            <Mic className="h-4 w-4" />
            <span>New Recording</span>
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => navigate('/meetings')}
            className="mt-3 w-full flex items-center justify-center p-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors"
            title="New Recording"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation Content */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* MAIN Section */}
        <div>
          {!collapsed && (
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              MAIN
            </h3>
          )}
          <div className="space-y-1">
            <NavItem
              icon={<Home className="h-4 w-4" />}
              label="Dashboard"
              active={isActive('/')}
              collapsed={collapsed}
              onClick={() => navigate('/')}
              shortcut="D"
            />
            <NavItem
              icon={<FileText className="h-4 w-4" />}
              label="Meetings"
              active={isActive('/meetings')}
              collapsed={collapsed}
              onClick={() => navigate('/meetings')}
              shortcut="M"
            />
            <NavItem
              icon={<LayoutGrid className="h-4 w-4" />}
              label="Tasks"
              active={isActive('/tasks')}
              collapsed={collapsed}
              onClick={() => navigate('/tasks')}
              shortcut="T"
            />
          </div>
        </div>

        {/* TOOLS Section */}
        <div>
          {!collapsed && (
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              TOOLS
            </h3>
          )}
          <div className="space-y-1">
            <NavItem
              icon={<Search className="h-4 w-4" />}
              label="Search"
              collapsed={collapsed}
              onClick={() => {}}
              shortcut="K"
            />
            <NavItem
              icon={<Calendar className="h-4 w-4" />}
              label="Calendar"
              collapsed={collapsed}
              onClick={() => navigate('/meetings')}
              badge={<span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Soon</span>}
            />
          </div>
        </div>
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-border p-4 space-y-1">
        <NavItem
          icon={<Keyboard className="h-4 w-4" />}
          label="Shortcuts"
          collapsed={collapsed}
          onClick={openHelpModal}
          shortcut="/"
        />
        <NavItem
          icon={<Settings className="h-4 w-4" />}
          label="Settings"
          active={isActive('/settings')}
          collapsed={collapsed}
          onClick={() => navigate('/settings')}
          shortcut=","
        />
      </div>

      {/* Collapse Toggle Button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center shadow-sm hover:bg-accent transition-colors z-10"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </aside>
  )
}

interface NavItemProps {
  icon: ReactNode
  label: string
  active?: boolean
  collapsed?: boolean
  shortcut?: string
  badge?: ReactNode
  onClick?: () => void
}

function NavItem({ icon, label, active, collapsed, shortcut, badge, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors relative group",
        active
          ? "bg-purple-100 text-purple-700 font-medium"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        collapsed && "justify-center"
      )}
    >
      <span className={cn("flex-shrink-0", active && "text-purple-600")}>
        {icon}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {shortcut && (
            <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
              {shortcut}
            </span>
          )}
          {badge && (
            <span className="text-muted-foreground">{badge}</span>
          )}
        </>
      )}
      {collapsed && (
        <span className="absolute left-full ml-2 px-2 py-1 bg-popover border border-border rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
          {label}
        </span>
      )}
    </button>
  )
}

function Header() {
  const location = useLocation()
  const { isModalOpen, openModal, closeModal, handleSuccess } = useNewMeeting()
  const status = useRecordingStatus()

  // Check if actively recording (recording or paused)
  const isRecording = status === 'recording' || status === 'paused'

  // Determine page title based on route
  const getPageTitle = () => {
    switch (location.pathname) {
      case '/':
        return 'Dashboard'
      case '/meetings':
        return 'Meetings'
      case '/tasks':
        return 'Tasks'
      case '/settings':
        return 'Settings'
      default:
        return 'FlowRecap'
    }
  }

  return (
    <header className="h-20 pt-2 bg-card border-b border-border flex items-center justify-between px-6 app-drag-region">
      {/* Left side - Page title */}
      <div className="flex items-center gap-6 app-no-drag">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{getPageTitle()}</h1>
          <p className="text-sm text-muted-foreground">FlowRecap</p>
        </div>
      </div>

      {/* Right side - Recording indicator or New Meeting button */}
      <div className="flex items-center gap-4 app-no-drag">
        {isRecording ? (
          /* Recording State - Show waveform and timer */
          <RecordingIndicator />
        ) : (
          /* Non-Recording State - Show New Meeting button */
          <button
            onClick={openModal}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-all duration-300"
          >
            <Plus className="h-4 w-4" />
            <span>New Meeting</span>
          </button>
        )}
      </div>

      <NewMeetingModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </header>
  )
}

interface MainContentProps {
  children: ReactNode
}

function MainContent({ children }: MainContentProps) {
  return (
    <main className="flex-1 overflow-auto bg-background p-6">
      {children}
    </main>
  )
}
