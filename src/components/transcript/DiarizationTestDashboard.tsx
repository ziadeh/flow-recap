/**
 * Diarization Test Dashboard Component
 *
 * Displays comprehensive test results and regression detection for the
 * speaker diarization system. Shows:
 * - DER (Diarization Error Rate)
 * - Speaker confusion matrix
 * - Segment boundary accuracy
 * - Requirement compliance status
 * - Regression alerts
 */

import React, { useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Users,
  Clock,
  BarChart3,
  RefreshCw
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface QualityMetrics {
  diarizationErrorRate: number
  speakerPurity: number
  speakerCoverage: number
  segmentBoundaryAccuracy: number
  missedSpeechRate: number
  falseSpeechRate: number
}

interface RequirementStatus {
  id: string
  name: string
  description: string
  passed: boolean
  details?: string
}

interface TestResult {
  name: string
  suite: string
  passed: boolean
  duration: number
  error?: string
}

interface RegressionAlert {
  metric: string
  baseline: number
  current: number
  change: number
  severity: 'warning' | 'critical'
}

interface DashboardData {
  lastRunTime: string
  totalTests: number
  passedTests: number
  failedTests: number
  qualityMetrics: QualityMetrics
  requirements: RequirementStatus[]
  testResults: TestResult[]
  regressions: RegressionAlert[]
  speakerConfusionMatrix: number[][]
  speakerLabels: string[]
}

// ============================================================================
// Mock Data (Replace with actual test runner data in production)
// ============================================================================

const mockDashboardData: DashboardData = {
  lastRunTime: new Date().toISOString(),
  totalTests: 42,
  passedTests: 40,
  failedTests: 2,
  qualityMetrics: {
    diarizationErrorRate: 0.08,
    speakerPurity: 0.95,
    speakerCoverage: 0.98,
    segmentBoundaryAccuracy: 0.92,
    missedSpeechRate: 0.03,
    falseSpeechRate: 0.02
  },
  requirements: [
    {
      id: 'REQ1',
      name: 'Distinct Speaker Tracks',
      description: 'Two different voices produce two different speaker_ids',
      passed: true
    },
    {
      id: 'REQ2',
      name: 'Speaker ID Stability',
      description: 'Speaker IDs remain stable across multi-minute recordings',
      passed: true
    },
    {
      id: 'REQ3',
      name: 'No Unknown Speakers',
      description: 'UI displays multiple speaker timelines with no Unknown Speaker placeholders',
      passed: true
    },
    {
      id: 'REQ4',
      name: 'No Text-Based Identity',
      description: 'No speaker identity is inferred from transcribed text',
      passed: true
    },
    {
      id: 'REQ5',
      name: 'Diarization-First Pipeline',
      description: 'Diarization stage exists as separate processing step before transcription',
      passed: true
    },
    {
      id: 'REQ6',
      name: 'Explicit Failure Handling',
      description: 'System fails explicitly when diarization cannot be performed',
      passed: true
    },
    {
      id: 'REQ7',
      name: 'Schema Compliance',
      description: 'Structured speaker segment output matches the required schema',
      passed: true
    },
    {
      id: 'REQ8',
      name: 'Embedding Extraction',
      description: 'Speaker embeddings are successfully extracted from audio',
      passed: true
    }
  ],
  testResults: [
    { name: 'two different voices should produce two distinct speaker_ids', suite: 'Distinct Speaker Tracks', passed: true, duration: 45 },
    { name: 'speaker tracks should match ground truth speaker distribution', suite: 'Distinct Speaker Tracks', passed: true, duration: 32 },
    { name: 'speaker IDs should be reused consistently across segments', suite: 'Speaker ID Stability', passed: true, duration: 28 },
    { name: 'should detect unstable speaker ID patterns', suite: 'Speaker ID Stability', passed: true, duration: 15 },
    { name: 'valid result should have no unknown speaker placeholders', suite: 'No Unknown Speakers', passed: true, duration: 12 },
    { name: 'should detect "Unknown Speaker" fallback patterns', suite: 'No Unknown Speakers', passed: false, duration: 18, error: 'Expected silent fallback detection' },
    { name: 'speaker IDs should be generic, not names', suite: 'No Text-Based Identity', passed: true, duration: 10 },
    { name: 'should calculate DER (Diarization Error Rate)', suite: 'Quality Metrics', passed: true, duration: 156 },
    { name: 'should generate speaker confusion matrix', suite: 'Quality Metrics', passed: true, duration: 89 },
    { name: 'should calculate segment boundary accuracy', suite: 'Quality Metrics', passed: true, duration: 67 }
  ],
  regressions: [
    {
      metric: 'DER',
      baseline: 0.05,
      current: 0.08,
      change: 0.03,
      severity: 'warning'
    }
  ],
  speakerConfusionMatrix: [
    [95, 3, 2],
    [2, 94, 4],
    [3, 3, 94]
  ],
  speakerLabels: ['SPEAKER_0', 'SPEAKER_1', 'SPEAKER_2']
}

// ============================================================================
// Components
// ============================================================================

interface MetricCardProps {
  title: string
  value: number
  format: 'percent' | 'rate'
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'stable'
  target?: number
}

function MetricCard({ title, value, format, icon, trend, target }: MetricCardProps) {
  const displayValue = format === 'percent'
    ? `${(value * 100).toFixed(1)}%`
    : value.toFixed(3)

  const isGood = format === 'rate'
    ? value < (target || 0.1)
    : value > (target || 0.9)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div className="text-gray-500 dark:text-gray-400">{icon}</div>
        {trend && (
          <div className={trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}>
            {trend === 'up' ? <TrendingUp size={16} /> : trend === 'down' ? <TrendingDown size={16} /> : null}
          </div>
        )}
      </div>
      <div className="mt-2">
        <div className={`text-2xl font-bold ${isGood ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {displayValue}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">{title}</div>
      </div>
    </div>
  )
}

interface RequirementBadgeProps {
  requirement: RequirementStatus
}

function RequirementBadge({ requirement }: RequirementBadgeProps) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${requirement.passed ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
      <div className={`mt-0.5 ${requirement.passed ? 'text-green-500' : 'text-red-500'}`}>
        {requirement.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{requirement.id}</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{requirement.name}</span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{requirement.description}</p>
        {requirement.details && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{requirement.details}</p>
        )}
      </div>
    </div>
  )
}

interface ConfusionMatrixProps {
  matrix: number[][]
  labels: string[]
}

function ConfusionMatrix({ matrix, labels }: ConfusionMatrixProps) {
  const maxValue = Math.max(...matrix.flat())

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="p-2 text-xs font-medium text-gray-500 dark:text-gray-400"></th>
            {labels.map(label => (
              <th key={label} className="p-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="p-2 text-xs font-medium text-gray-500 dark:text-gray-400">{labels[i]}</td>
              {row.map((value, j) => {
                const intensity = value / maxValue
                const isDiagonal = i === j
                return (
                  <td
                    key={j}
                    className="p-2 text-center text-sm font-mono"
                    style={{
                      backgroundColor: isDiagonal
                        ? `rgba(34, 197, 94, ${intensity * 0.5})`
                        : `rgba(239, 68, 68, ${intensity * 0.5})`
                    }}
                  >
                    {value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
        Rows: Ground Truth | Columns: Predictions
      </p>
    </div>
  )
}

interface RegressionAlertProps {
  alert: RegressionAlert
}

function RegressionAlertCard({ alert }: RegressionAlertProps) {
  const changePercent = ((alert.change / alert.baseline) * 100).toFixed(1)

  return (
    <div className={`p-3 rounded-lg ${alert.severity === 'critical' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'}`}>
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className={alert.severity === 'critical' ? 'text-red-500' : 'text-yellow-500'} />
        <span className="font-medium text-gray-900 dark:text-gray-100">{alert.metric} Regression</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Baseline:</span>
          <span className="ml-1 font-mono">{alert.baseline.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Current:</span>
          <span className="ml-1 font-mono">{alert.current.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Change:</span>
          <span className={`ml-1 font-mono ${alert.change > 0 ? 'text-red-600' : 'text-green-600'}`}>
            +{changePercent}%
          </span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

interface DiarizationTestDashboardProps {
  data?: DashboardData
  onRefresh?: () => void
}

export default function DiarizationTestDashboard({ data = mockDashboardData, onRefresh }: DiarizationTestDashboardProps) {
  const [selectedSuite, setSelectedSuite] = useState<string | null>(null)

  const passRate = data.totalTests > 0 ? (data.passedTests / data.totalTests) * 100 : 0
  const allRequirementsPassed = data.requirements.every(r => r.passed)

  const suites = [...new Set(data.testResults.map(t => t.suite))]
  const filteredTests = selectedSuite
    ? data.testResults.filter(t => t.suite === selectedSuite)
    : data.testResults

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Diarization Test Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Last run: {new Date(data.lastRunTime).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw size={16} />
            Run Tests
          </button>
        </div>

        {/* Overall Status */}
        <div className={`p-4 rounded-lg ${allRequirementsPassed ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
          <div className="flex items-center gap-3">
            {allRequirementsPassed ? (
              <CheckCircle2 className="text-green-600 dark:text-green-400" size={24} />
            ) : (
              <XCircle className="text-red-600 dark:text-red-400" size={24} />
            )}
            <div>
              <div className="font-semibold text-lg text-gray-900 dark:text-white">
                {allRequirementsPassed ? 'All Mandatory Requirements Passed' : 'Some Requirements Failed'}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {data.passedTests} / {data.totalTests} tests passed ({passRate.toFixed(1)}%)
              </div>
            </div>
          </div>
        </div>

        {/* Regression Alerts */}
        {data.regressions.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Regression Alerts
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {data.regressions.map((alert, i) => (
                <RegressionAlertCard key={i} alert={alert} />
              ))}
            </div>
          </div>
        )}

        {/* Quality Metrics */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Quality Metrics
          </h2>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              title="DER"
              value={data.qualityMetrics.diarizationErrorRate}
              format="rate"
              icon={<Activity size={20} />}
              target={0.1}
            />
            <MetricCard
              title="Speaker Purity"
              value={data.qualityMetrics.speakerPurity}
              format="percent"
              icon={<Users size={20} />}
              target={0.9}
            />
            <MetricCard
              title="Speaker Coverage"
              value={data.qualityMetrics.speakerCoverage}
              format="percent"
              icon={<BarChart3 size={20} />}
              target={0.95}
            />
            <MetricCard
              title="Boundary Accuracy"
              value={data.qualityMetrics.segmentBoundaryAccuracy}
              format="percent"
              icon={<Clock size={20} />}
              target={0.85}
            />
            <MetricCard
              title="Miss Rate"
              value={data.qualityMetrics.missedSpeechRate}
              format="rate"
              icon={<XCircle size={20} />}
              target={0.05}
            />
            <MetricCard
              title="False Alarm"
              value={data.qualityMetrics.falseSpeechRate}
              format="rate"
              icon={<AlertTriangle size={20} />}
              target={0.05}
            />
          </div>
        </div>

        {/* Requirements */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Mandatory Requirements
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {data.requirements.map(req => (
              <RequirementBadge key={req.id} requirement={req} />
            ))}
          </div>
        </div>

        {/* Confusion Matrix */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Speaker Confusion Matrix
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <ConfusionMatrix matrix={data.speakerConfusionMatrix} labels={data.speakerLabels} />
          </div>
        </div>

        {/* Test Results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Test Results
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedSuite(null)}
                className={`px-3 py-1 text-sm rounded ${selectedSuite === null ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
              >
                All
              </button>
              {suites.map(suite => (
                <button
                  key={suite}
                  onClick={() => setSelectedSuite(suite)}
                  className={`px-3 py-1 text-sm rounded ${selectedSuite === suite ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  {suite}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Test Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Suite</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredTests.map((test, i) => (
                  <tr key={i} className={test.passed ? '' : 'bg-red-50 dark:bg-red-900/10'}>
                    <td className="px-4 py-3">
                      {test.passed ? (
                        <CheckCircle2 className="text-green-500" size={18} />
                      ) : (
                        <XCircle className="text-red-500" size={18} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900 dark:text-gray-100">{test.name}</div>
                      {test.error && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1">{test.error}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{test.suite}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400 font-mono">
                      {test.duration}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CI/CD Integration Info */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
            CI/CD Integration
          </h3>
          <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
            These tests are integrated into the CI/CD pipeline. Deployments will be blocked if:
          </p>
          <ul className="text-sm text-blue-800 dark:text-blue-200 list-disc list-inside space-y-1">
            <li>Any mandatory requirement test fails</li>
            <li>DER exceeds 15% (current threshold)</li>
            <li>Speaker purity drops below 90%</li>
            <li>Regression alerts are marked as critical</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// Export types for use in other components
export type { DashboardData, QualityMetrics, RequirementStatus, TestResult, RegressionAlert }
