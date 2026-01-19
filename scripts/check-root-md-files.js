#!/usr/bin/env node

/**
 * Pre-commit hook script to warn about new .md files added to root directory.
 * Only specific approved markdown files are allowed in the root.
 *
 * Approved root-level .md files:
 * - README.md - Repository entry point and overview
 * - CHANGELOG.md - Version history and release notes
 * - CONTRIBUTING.md - Contribution guidelines
 * - LICENSE.md - License information
 *
 * All other documentation should be in the docs/ directory.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Approved root-level markdown files
const APPROVED_ROOT_MD_FILES = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE.md',
  'LICENSE',  // Also allow LICENSE without .md extension
];

// ANSI color codes
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function getColoredText(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=A', {
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting staged files:', error.message);
    return [];
  }
}

function checkRootMdFiles() {
  const stagedFiles = getStagedFiles();
  const unapprovedMdFiles = [];

  for (const file of stagedFiles) {
    // Check if file is in root directory (no directory separators)
    if (!file.includes('/') && !file.includes('\\')) {
      // Check if it's a markdown file
      if (file.endsWith('.md')) {
        // Check if it's in the approved list
        if (!APPROVED_ROOT_MD_FILES.includes(file)) {
          unapprovedMdFiles.push(file);
        }
      }
    }
  }

  if (unapprovedMdFiles.length > 0) {
    console.log('\n' + getColoredText('⚠️  WARNING: Unapproved markdown files detected in root directory!', 'yellow'));
    console.log(getColoredText('─'.repeat(60), 'yellow'));
    console.log('\nThe following .md files are not allowed in the root directory:\n');

    for (const file of unapprovedMdFiles) {
      console.log(getColoredText(`  • ${file}`, 'red'));
    }

    console.log('\n' + getColoredText('Approved root-level .md files:', 'cyan'));
    for (const file of APPROVED_ROOT_MD_FILES.filter(f => f.endsWith('.md'))) {
      console.log(getColoredText(`  ✓ ${file}`, 'green'));
    }

    console.log('\n' + getColoredText('Action required:', 'bold'));
    console.log('  1. Move documentation files to docs/ directory');
    console.log('  2. Or add the file to APPROVED_ROOT_MD_FILES in scripts/check-root-md-files.js');
    console.log('\nSuggested commands:\n');

    for (const file of unapprovedMdFiles) {
      const category = suggestCategory(file);
      console.log(`  git mv ${file} docs/${category}/${file}`);
    }

    console.log('\n' + getColoredText('This is a warning - commit will proceed.', 'yellow'));
    console.log(getColoredText('Please consider moving these files before pushing.', 'yellow'));
    console.log('─'.repeat(60) + '\n');
  }

  // Always exit 0 (success) - this is just a warning, not a blocker
  process.exit(0);
}

function suggestCategory(filename) {
  const lowerName = filename.toLowerCase();

  if (lowerName.includes('setup') || lowerName.includes('install') || lowerName.includes('build')) {
    return 'setup';
  }
  if (lowerName.includes('api') || lowerName.includes('endpoint')) {
    return 'api';
  }
  if (lowerName.includes('fix') || lowerName.includes('issue') || lowerName.includes('troubleshoot')) {
    return 'troubleshooting';
  }
  if (lowerName.includes('architecture') || lowerName.includes('test') || lowerName.includes('dev')) {
    return 'development';
  }

  // Default to features
  return 'features';
}

// Run the check
checkRootMdFiles();
