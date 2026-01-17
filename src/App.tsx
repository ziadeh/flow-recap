import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { SetupWizard } from '@/components/SetupWizard'
import { MigrationWizard } from '@/components/MigrationWizard'
import { LiveTranscriptionProvider } from '@/components/LiveTranscriptionProvider'
import { EnvironmentWarningBanner } from '@/components/EnvironmentWarningBanner'
import { StartupValidationScreen } from '@/components/StartupValidationScreen'
import { Dashboard, Meetings, Settings, Tasks } from '@/pages'
import MeetingDetail from '@/pages/MeetingDetail'

function App() {
  const [showWizard, setShowWizard] = useState<boolean | null>(null)
  const [showMigration, setShowMigration] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startupValidationComplete, setStartupValidationComplete] = useState(false)

  useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        // First check if migration is needed (rebrand from Meeting Notes to FlowRecap)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const migrationAPI = (window as any).electronAPI?.migration
        if (migrationAPI) {
          const migrationCheck = await migrationAPI.check()
          if (migrationCheck.needsMigration) {
            setShowMigration(true)
            setShowWizard(false)
            setIsLoading(false)
            return
          }
        }
        setShowMigration(false)

        // Then check setup status
        const completed = await window.electronAPI.db.settings.get<boolean>('setup.completed')
        setShowWizard(completed === null || completed === false)
      } catch (err) {
        console.error('Failed to check setup status:', err)
        setShowMigration(false)
        setShowWizard(true) // Show wizard on error
      } finally {
        setIsLoading(false)
      }
    }
    checkSetupStatus()
  }, [])

  const handleMigrationComplete = async () => {
    setShowMigration(false)
    // After migration, check if setup is needed
    try {
      const completed = await window.electronAPI.db.settings.get<boolean>('setup.completed')
      setShowWizard(completed === null || completed === false)
    } catch (err) {
      setShowWizard(true)
    }
  }

  const handleMigrationSkip = async () => {
    setShowMigration(false)
    // After skipping migration, check if setup is needed
    try {
      const completed = await window.electronAPI.db.settings.get<boolean>('setup.completed')
      setShowWizard(completed === null || completed === false)
    } catch (err) {
      setShowWizard(true)
    }
  }

  const handleWizardComplete = async () => {
    setShowWizard(false)
  }

  const handleWizardSkip = async () => {
    // Mark as skipped (but not completed)
    await window.electronAPI.db.settings.set('setup.skipped', true, 'general')
    setShowWizard(false)
  }

  const handleStartupValidationComplete = () => {
    setStartupValidationComplete(true)
  }

  const handleStartupValidationSkip = () => {
    setStartupValidationComplete(true)
  }

  // Show startup validation screen first (for tiered validation)
  // This runs Tier 1 fast validation and kicks off Tier 2 in background
  if (isLoading || (!startupValidationComplete && !showWizard && !showMigration)) {
    return (
      <StartupValidationScreen
        onComplete={handleStartupValidationComplete}
        onSkip={handleStartupValidationSkip}
      />
    )
  }

  // Show migration wizard if legacy data is found
  if (showMigration) {
    return <MigrationWizard onComplete={handleMigrationComplete} onSkip={handleMigrationSkip} />
  }

  if (showWizard) {
    return <SetupWizard onComplete={handleWizardComplete} onSkip={handleWizardSkip} />
  }

  return (
    <LiveTranscriptionProvider>
      <HashRouter>
        <Layout>
          {/* Environment warning banner - shows when Python environments are degraded */}
          <EnvironmentWarningBanner />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/meeting/:id" element={<MeetingDetail />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </HashRouter>
    </LiveTranscriptionProvider>
  )
}

export default App
