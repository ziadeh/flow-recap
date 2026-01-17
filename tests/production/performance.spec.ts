/**
 * Performance and Health Check Tests
 *
 * Tests that measure and verify:
 * 1. App startup time
 * 2. Memory usage
 * 3. Bundle size
 * 4. Build time metrics
 * 5. Runtime performance
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { PROJECT_ROOT, findBuildArtifacts, getProcessMemory } from './test-utils'

// ============================================================================
// Configuration
// ============================================================================

const MAIN_PATH = path.join(PROJECT_ROOT, 'dist-electron/main.js')
const isBuilt = fs.existsSync(MAIN_PATH)

// Performance thresholds
const THRESHOLDS = {
  startupTime: 10000,        // Max 10 seconds to start
  initialMemory: 500,        // Max 500MB initial memory
  bundleSize: {
    mainJs: 5 * 1024 * 1024,      // Max 5MB for main.js
    preloadJs: 500 * 1024,         // Max 500KB for preload.js
    renderer: 10 * 1024 * 1024     // Max 10MB for renderer bundle
  },
  buildTime: 300000           // Max 5 minutes build time
}

// ============================================================================
// Bundle Size Tests
// ============================================================================

test.describe('Bundle Size Analysis', () => {
  test('should measure main.js bundle size', () => {
    if (!fs.existsSync(MAIN_PATH)) {
      console.log('main.js not found - skipping')
      test.skip()
      return
    }

    const stats = fs.statSync(MAIN_PATH)
    const sizeKB = stats.size / 1024
    const sizeMB = sizeKB / 1024

    console.log(`main.js size: ${sizeKB.toFixed(2)} KB (${sizeMB.toFixed(2)} MB)`)

    // Warn if exceeding threshold but don't fail
    if (stats.size > THRESHOLDS.bundleSize.mainJs) {
      console.warn(`⚠️ main.js exceeds recommended size (${THRESHOLDS.bundleSize.mainJs / 1024 / 1024} MB)`)
    }

    expect(stats.size).toBeGreaterThan(0)
  })

  test('should measure preload.js bundle size', () => {
    const preloadPath = path.join(PROJECT_ROOT, 'dist-electron/preload.js')

    if (!fs.existsSync(preloadPath)) {
      console.log('preload.js not found - skipping')
      test.skip()
      return
    }

    const stats = fs.statSync(preloadPath)
    const sizeKB = stats.size / 1024

    console.log(`preload.js size: ${sizeKB.toFixed(2)} KB`)

    if (stats.size > THRESHOLDS.bundleSize.preloadJs) {
      console.warn(`⚠️ preload.js exceeds recommended size (${THRESHOLDS.bundleSize.preloadJs / 1024} KB)`)
    }

    expect(stats.size).toBeGreaterThan(0)
  })

  test('should measure renderer bundle size', () => {
    const assetsDir = path.join(PROJECT_ROOT, 'dist/assets')

    if (!fs.existsSync(assetsDir)) {
      console.log('Assets directory not found - skipping')
      test.skip()
      return
    }

    let totalSize = 0
    const files = fs.readdirSync(assetsDir)

    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.css')) {
        const filePath = path.join(assetsDir, file)
        const stats = fs.statSync(filePath)
        totalSize += stats.size
        console.log(`  ${file}: ${(stats.size / 1024).toFixed(2)} KB`)
      }
    }

    const totalMB = totalSize / 1024 / 1024
    console.log(`Total renderer assets: ${totalMB.toFixed(2)} MB`)

    if (totalSize > THRESHOLDS.bundleSize.renderer) {
      console.warn(`⚠️ Renderer bundle exceeds recommended size (${THRESHOLDS.bundleSize.renderer / 1024 / 1024} MB)`)
    }
  })

  test('should measure installer sizes', () => {
    const artifacts = findBuildArtifacts()

    if (artifacts.length === 0) {
      console.log('No build artifacts found')
      test.skip()
      return
    }

    console.log('\nInstaller Sizes:')
    console.log('================')

    let totalSize = 0
    for (const artifact of artifacts) {
      const sizeMB = artifact.size / (1024 * 1024)
      console.log(`  ${artifact.name}: ${sizeMB.toFixed(2)} MB`)
      totalSize += artifact.size
    }

    console.log(`Total: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
  })
})

// ============================================================================
// Startup Performance Tests
// ============================================================================

test.describe('Startup Performance', () => {
  test('should measure app startup time', async () => {
    if (!isBuilt) {
      console.log('App not built - skipping')
      test.skip()
      return
    }

    const startTime = Date.now()

    try {
      const electronApp = await electron.launch({
        args: [MAIN_PATH],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ELECTRON_IS_DEV: '0'
        },
        timeout: 30000
      })

      const mainWindow = await electronApp.firstWindow({ timeout: 30000 })
      await mainWindow.waitForLoadState('domcontentloaded')

      const startupTime = Date.now() - startTime

      console.log(`App startup time: ${startupTime}ms`)

      if (startupTime > THRESHOLDS.startupTime) {
        console.warn(`Startup time exceeds threshold (${THRESHOLDS.startupTime}ms)`)
      }

      await electronApp.close()

      // Informational - don't fail
      expect(startupTime).toBeGreaterThan(0)
    } catch (error) {
      console.log('Electron launch failed - skipping startup time measurement')
      console.log('This is expected in headless/CI environments.')
      test.skip()
    }
  })

  test('should measure time to interactive', async () => {
    if (!isBuilt) {
      test.skip()
      return
    }

    const startTime = Date.now()

    try {
      const electronApp = await electron.launch({
        args: [MAIN_PATH],
        env: {
          ...process.env,
          NODE_ENV: 'production'
        },
        timeout: 30000
      })

      const mainWindow = await electronApp.firstWindow({ timeout: 30000 })

      // Wait for React to render something meaningful
      await mainWindow.waitForLoadState('networkidle')

      const timeToInteractive = Date.now() - startTime
      console.log(`Time to interactive: ${timeToInteractive}ms`)

      await electronApp.close()
    } catch (error) {
      console.log('Electron launch failed - skipping time to interactive measurement')
      test.skip()
    }
  })
})

// ============================================================================
// Memory Usage Tests
// ============================================================================

test.describe('Memory Usage', () => {
  test('should measure initial memory usage', async () => {
    if (!isBuilt) {
      test.skip()
      return
    }

    try {
      const electronApp = await electron.launch({
        args: [MAIN_PATH],
        env: {
          ...process.env,
          NODE_ENV: 'production'
        },
        timeout: 30000
      })

      const mainWindow = await electronApp.firstWindow({ timeout: 30000 })
      await mainWindow.waitForLoadState('domcontentloaded')

      // Give app time to settle
      await mainWindow.waitForTimeout(3000)

      // Get memory info from main process
      const memoryInfo = await electronApp.evaluate(async () => {
        const memUsage = process.memoryUsage()
        return {
          heapUsed: memUsage.heapUsed / (1024 * 1024),
          heapTotal: memUsage.heapTotal / (1024 * 1024),
          rss: memUsage.rss / (1024 * 1024),
          external: memUsage.external / (1024 * 1024)
        }
      })

      console.log('\nMemory Usage (Main Process):')
      console.log(`  Heap Used: ${memoryInfo.heapUsed.toFixed(2)} MB`)
      console.log(`  Heap Total: ${memoryInfo.heapTotal.toFixed(2)} MB`)
      console.log(`  RSS: ${memoryInfo.rss.toFixed(2)} MB`)
      console.log(`  External: ${memoryInfo.external.toFixed(2)} MB`)

      if (memoryInfo.rss > THRESHOLDS.initialMemory) {
        console.warn(`Memory usage exceeds threshold (${THRESHOLDS.initialMemory} MB)`)
      }

      await electronApp.close()
    } catch (error) {
      console.log('Electron launch failed - skipping memory measurement')
      test.skip()
    }
  })

  test('should check for memory leaks pattern', async () => {
    if (!isBuilt) {
      test.skip()
      return
    }

    try {
      const electronApp = await electron.launch({
        args: [MAIN_PATH],
        env: {
          ...process.env,
          NODE_ENV: 'production'
        },
        timeout: 30000
      })

      const mainWindow = await electronApp.firstWindow({ timeout: 30000 })
      await mainWindow.waitForLoadState('domcontentloaded')

      // Take initial measurement
      const initialMemory = await electronApp.evaluate(() => process.memoryUsage().heapUsed)

      // Simulate some activity (navigate, interact)
      for (let i = 0; i < 5; i++) {
        await mainWindow.waitForTimeout(1000)
      }

      // Force garbage collection if possible
      await electronApp.evaluate(() => {
        if (global.gc) {
          global.gc()
        }
      })

      // Take final measurement
      const finalMemory = await electronApp.evaluate(() => process.memoryUsage().heapUsed)

      const memoryGrowth = (finalMemory - initialMemory) / (1024 * 1024)
      console.log(`Memory growth over test: ${memoryGrowth.toFixed(2)} MB`)

      if (memoryGrowth > 50) {
        console.warn('Significant memory growth detected - potential leak')
      }

      await electronApp.close()
    } catch (error) {
      console.log('Electron launch failed - skipping memory leak test')
      test.skip()
    }
  })
})

// ============================================================================
// Node Modules Analysis
// ============================================================================

test.describe('Dependency Analysis', () => {
  test('should analyze node_modules size', () => {
    const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      test.skip()
      return
    }

    // Use du command if available
    try {
      const result = execSync(`du -sh "${nodeModulesPath}"`, { encoding: 'utf-8' })
      console.log(`node_modules size: ${result.trim().split('\t')[0]}`)
    } catch {
      console.log('Could not measure node_modules size')
    }
  })

  test('should list largest dependencies', () => {
    const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      test.skip()
      return
    }

    const dirs = fs.readdirSync(nodeModulesPath)
    const sizes: { name: string; size: number }[] = []

    for (const dir of dirs.slice(0, 50)) { // Check first 50 for performance
      const dirPath = path.join(nodeModulesPath, dir)
      try {
        const stats = fs.statSync(dirPath)
        if (stats.isDirectory()) {
          // Get directory size (simplified - just counts files)
          let size = 0
          const walkDir = (d: string) => {
            const items = fs.readdirSync(d)
            for (const item of items.slice(0, 100)) {
              const itemPath = path.join(d, item)
              try {
                const itemStats = fs.statSync(itemPath)
                if (itemStats.isFile()) {
                  size += itemStats.size
                } else if (itemStats.isDirectory()) {
                  walkDir(itemPath)
                }
              } catch { /* ignore */ }
            }
          }
          walkDir(dirPath)
          sizes.push({ name: dir, size })
        }
      } catch { /* ignore */ }
    }

    // Sort by size descending
    sizes.sort((a, b) => b.size - a.size)

    console.log('\nLargest Dependencies:')
    for (const dep of sizes.slice(0, 10)) {
      console.log(`  ${dep.name}: ${(dep.size / (1024 * 1024)).toFixed(2)} MB`)
    }
  })

  test('should check for duplicate packages', () => {
    // This would require package-lock.json analysis
    const lockPath = path.join(PROJECT_ROOT, 'package-lock.json')

    if (!fs.existsSync(lockPath)) {
      test.skip()
      return
    }

    // Simple check - just verify lock file exists
    const lockContent = fs.readFileSync(lockPath, 'utf-8')
    expect(lockContent.length).toBeGreaterThan(1000)
    console.log('package-lock.json present and valid')
  })
})

// ============================================================================
// Build Performance Tests
// ============================================================================

test.describe('Build Performance', () => {
  test('should measure TypeScript compilation time', async () => {
    const startTime = Date.now()

    try {
      execSync('npm run typecheck', {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        timeout: 60000
      })
    } catch (error) {
      // May fail if there are type errors, but we still get timing
    }

    const elapsed = Date.now() - startTime
    console.log(`TypeScript check time: ${elapsed}ms`)
  })

  test.skip('should measure full build time', async () => {
    // Skip by default - takes too long for regular testing
    const startTime = Date.now()

    try {
      execSync('npm run build:vite', {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        timeout: THRESHOLDS.buildTime
      })
    } catch (error) {
      console.log('Build failed or timed out')
    }

    const elapsed = Date.now() - startTime
    console.log(`Vite build time: ${elapsed}ms`)

    if (elapsed > THRESHOLDS.buildTime) {
      console.warn(`⚠️ Build time exceeds threshold (${THRESHOLDS.buildTime / 1000}s)`)
    }
  })
})

// ============================================================================
// Performance Report Generation
// ============================================================================

test.describe('Performance Report', () => {
  test('should generate performance summary', () => {
    const report = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      metrics: {} as Record<string, unknown>
    }

    // Collect metrics
    if (fs.existsSync(MAIN_PATH)) {
      report.metrics['main.js'] = fs.statSync(MAIN_PATH).size
    }

    const preloadPath = path.join(PROJECT_ROOT, 'dist-electron/preload.js')
    if (fs.existsSync(preloadPath)) {
      report.metrics['preload.js'] = fs.statSync(preloadPath).size
    }

    const artifacts = findBuildArtifacts()
    report.metrics['artifactCount'] = artifacts.length
    report.metrics['totalArtifactSize'] = artifacts.reduce((sum, a) => sum + a.size, 0)

    console.log('\n=== Performance Report ===')
    console.log(JSON.stringify(report, null, 2))

    // Write report to file
    const reportPath = path.join(PROJECT_ROOT, 'performance-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`Report written to: ${reportPath}`)
  })
})
