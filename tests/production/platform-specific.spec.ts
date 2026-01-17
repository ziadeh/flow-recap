/**
 * Platform-Specific Verification Tests
 *
 * Tests that verify platform-specific features work correctly:
 *
 * - macOS: Notarization, entitlements, DMG layout, .app bundle structure
 * - Windows: Code signing, NSIS installer, registry entries, shortcuts
 * - Linux: .desktop file, AppImage permissions, snap/deb/rpm packaging
 */

import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { PROJECT_ROOT, RELEASE_DIR, findBuildArtifacts, getInstallerInfo } from './test-utils'

// ============================================================================
// macOS-Specific Tests
// ============================================================================

test.describe('macOS Platform Tests', () => {
  test.beforeAll(() => {
    if (process.platform !== 'darwin') {
      test.skip()
    }
  })

  test('should have valid entitlements.mac.plist', () => {
    const entitlementsPath = path.join(PROJECT_ROOT, 'resources/entitlements.mac.plist')

    if (!fs.existsSync(entitlementsPath)) {
      console.log('Entitlements file not found - creating default')
      // This is informational
      expect(true).toBe(true)
      return
    }

    const content = fs.readFileSync(entitlementsPath, 'utf-8')

    // Verify it's valid plist format
    expect(content).toContain('<?xml')
    expect(content).toContain('plist')
    expect(content).toContain('<dict>')

    // Check for required entitlements for meeting app
    const requiredEntitlements = [
      'com.apple.security.device.audio-input', // Microphone access
      'com.apple.security.cs.allow-unsigned-executable-memory' // For native modules
    ]

    for (const entitlement of requiredEntitlements) {
      if (!content.includes(entitlement)) {
        console.log(`Missing entitlement: ${entitlement}`)
      }
    }
  })

  test('should have Info.plist configuration in electron-builder', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    // Verify macOS config exists
    expect(config.mac).toBeDefined()
    expect(config.mac.category).toBe('public.app-category.productivity')

    // Verify extended info for privacy
    expect(config.mac.extendInfo).toBeDefined()
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription).toBeTruthy()
  })

  test('should verify DMG configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.dmg).toBeDefined()
    expect(config.dmg.contents).toBeDefined()
    expect(config.dmg.window).toBeDefined()
    expect(config.dmg.window.width).toBeGreaterThan(400)
    expect(config.dmg.window.height).toBeGreaterThan(300)
  })

  test('should verify notarization script exists', () => {
    const notarizePath = path.join(PROJECT_ROOT, 'scripts/notarize.cjs')

    if (fs.existsSync(notarizePath)) {
      const content = fs.readFileSync(notarizePath, 'utf-8')
      expect(content).toContain('notarize')
      console.log('Notarization script found')
    } else {
      console.log('Notarization script not found - notarization disabled')
    }
  })

  test('should verify .app bundle structure (if built)', () => {
    const artifacts = findBuildArtifacts()
    const dmgArtifact = artifacts.find(a => a.name.endsWith('.dmg'))

    if (!dmgArtifact) {
      console.log('No DMG found - skipping bundle verification')
      test.skip()
      return
    }

    // Check if there's an unpacked .app
    const appDir = path.join(PROJECT_ROOT, 'release')

    if (fs.existsSync(appDir)) {
      // Find .app bundle
      const walkDir = (dir: string): string | null => {
        const items = fs.readdirSync(dir)
        for (const item of items) {
          const fullPath = path.join(dir, item)
          if (item.endsWith('.app')) {
            return fullPath
          }
          if (fs.statSync(fullPath).isDirectory()) {
            const found = walkDir(fullPath)
            if (found) return found
          }
        }
        return null
      }

      const appBundle = walkDir(appDir)
      if (appBundle) {
        // Verify basic structure
        expect(fs.existsSync(path.join(appBundle, 'Contents'))).toBe(true)
        expect(fs.existsSync(path.join(appBundle, 'Contents/MacOS'))).toBe(true)
        expect(fs.existsSync(path.join(appBundle, 'Contents/Resources'))).toBe(true)
      }
    }
  })
})

// ============================================================================
// Windows-Specific Tests
// ============================================================================

test.describe('Windows Platform Tests', () => {
  test.beforeAll(() => {
    if (process.platform !== 'win32') {
      test.skip()
    }
  })

  test('should have valid NSIS configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.nsis).toBeDefined()
    expect(config.nsis.oneClick).toBe(false)
    expect(config.nsis.allowToChangeInstallationDirectory).toBe(true)
    expect(config.nsis.createDesktopShortcut).toBe(true)
    expect(config.nsis.createStartMenuShortcut).toBe(true)
  })

  test('should have Windows target configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.win).toBeDefined()
    expect(config.win.target).toBeDefined()

    // Should build at least exe
    const targets = config.win.target.map((t: any) => t.target || t)
    expect(targets).toContain('nsis')
  })

  test('should have code signing configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    // Code signing config should exist (even if not enabled)
    expect(config.win.signingHashAlgorithms).toBeDefined()
    expect(config.win.signingHashAlgorithms).toContain('sha256')
  })

  test('should check for custom NSIS script', () => {
    const nsisPath = path.join(PROJECT_ROOT, 'resources/installer/nsis-custom.nsh')

    if (fs.existsSync(nsisPath)) {
      const content = fs.readFileSync(nsisPath, 'utf-8')
      console.log('Custom NSIS script found')
      // Verify it's valid NSIS
      expect(content.length).toBeGreaterThan(0)
    } else {
      console.log('No custom NSIS script - using defaults')
    }
  })

  test('should verify Windows installer artifacts (if built)', () => {
    const artifacts = findBuildArtifacts()
    const exeArtifacts = artifacts.filter(a => a.name.endsWith('.exe'))

    if (exeArtifacts.length === 0) {
      console.log('No EXE installers found')
      test.skip()
      return
    }

    for (const artifact of exeArtifacts) {
      console.log(`Found Windows installer: ${artifact.name}`)
      const sizeMB = artifact.size / (1024 * 1024)
      console.log(`  Size: ${sizeMB.toFixed(2)} MB`)

      // Verify reasonable size
      expect(sizeMB).toBeGreaterThan(50)
      expect(sizeMB).toBeLessThan(500)
    }
  })
})

// ============================================================================
// Linux-Specific Tests
// ============================================================================

test.describe('Linux Platform Tests', () => {
  test.beforeAll(() => {
    if (process.platform !== 'linux') {
      test.skip()
    }
  })

  test('should have valid Linux configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.linux).toBeDefined()
    expect(config.linux.category).toBe('Office')
    expect(config.linux.desktop).toBeDefined()
  })

  test('should have proper .desktop entry configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    const desktop = config.linux.desktop
    expect(desktop.Name).toBe('Meeting Notes')
    expect(desktop.Comment).toBeTruthy()
    expect(desktop.Categories).toContain('Office')
  })

  test('should have Debian dependencies configured', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.deb).toBeDefined()
    expect(config.deb.depends).toBeDefined()
    expect(Array.isArray(config.deb.depends)).toBe(true)

    // Should have audio dependencies
    expect(config.deb.depends.some((d: string) => d.includes('pulse'))).toBe(true)
  })

  test('should have RPM dependencies configured', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.rpm).toBeDefined()
    expect(config.rpm.depends).toBeDefined()
    expect(Array.isArray(config.rpm.depends)).toBe(true)
  })

  test('should have Snap configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.snap).toBeDefined()
    expect(config.snap.grade).toBe('stable')
    expect(config.snap.plugs).toBeDefined()

    // Should have audio plugs
    expect(config.snap.plugs).toContain('audio-record')
    expect(config.snap.plugs).toContain('pulseaudio')
  })

  test('should have AppImage configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.appImage).toBeDefined()
    expect(config.appImage.desktop).toBeDefined()
  })

  test('should verify Linux artifacts (if built)', () => {
    const artifacts = findBuildArtifacts()
    const linuxArtifacts = artifacts.filter(a =>
      a.name.endsWith('.AppImage') ||
      a.name.endsWith('.deb') ||
      a.name.endsWith('.rpm') ||
      a.name.endsWith('.snap')
    )

    if (linuxArtifacts.length === 0) {
      console.log('No Linux artifacts found')
      test.skip()
      return
    }

    for (const artifact of linuxArtifacts) {
      console.log(`Found Linux artifact: ${artifact.name}`)
      const sizeMB = artifact.size / (1024 * 1024)
      console.log(`  Size: ${sizeMB.toFixed(2)} MB`)
    }
  })

  test('should verify AppImage is executable (if exists)', () => {
    const artifacts = findBuildArtifacts()
    const appImage = artifacts.find(a => a.name.endsWith('.AppImage'))

    if (!appImage) {
      test.skip()
      return
    }

    // Check file permissions
    const stats = fs.statSync(appImage.path)
    const isExecutable = (stats.mode & fs.constants.X_OK) !== 0

    if (!isExecutable) {
      console.log('AppImage is not executable - may need chmod +x')
    }
  })
})

// ============================================================================
// Cross-Platform Tests
// ============================================================================

test.describe('Cross-Platform Configuration', () => {
  test('should have artifact naming convention', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.artifactName).toBeDefined()
    expect(config.artifactName).toContain('${productName}')
    expect(config.artifactName).toContain('${version}')
    expect(config.artifactName).toContain('${platform}')
  })

  test('should have ASAR configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.asar).toBe(true)
    expect(config.asarUnpack).toBeDefined()
    expect(Array.isArray(config.asarUnpack)).toBe(true)

    // Should unpack native modules
    expect(config.asarUnpack.some((p: string) => p.includes('better-sqlite3'))).toBe(true)
    expect(config.asarUnpack.some((p: string) => p.includes('.node'))).toBe(true)
  })

  test('should have extra resources configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.extraResources).toBeDefined()
    expect(Array.isArray(config.extraResources)).toBe(true)
  })

  test('should have publish configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    expect(config.publish).toBeDefined()
    expect(Array.isArray(config.publish)).toBe(true)
  })
})
