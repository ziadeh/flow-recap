#!/usr/bin/env node

/**
 * Cross-platform git hooks installation script
 * Copies hooks from scripts/git-hooks/ to .git/hooks/
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const gitHooksDir = path.join(projectRoot, '.git', 'hooks');
const sourceHooksDir = path.join(__dirname, 'git-hooks');

// Pre-commit hook content - embedded for simplicity
const preCommitHook = `#!/bin/sh
#
# FlowRecap Pre-commit Hook
# Checks for unapproved markdown files in root directory
#

# Run the markdown file check script
node scripts/check-root-md-files.js

# Always exit with 0 - this is a warning hook, not a blocking hook
exit 0
`;

function installHooks() {
  console.log('Installing git hooks...');

  // Ensure .git/hooks directory exists
  if (!fs.existsSync(gitHooksDir)) {
    console.error('Error: .git/hooks directory not found. Is this a git repository?');
    process.exit(1);
  }

  // Install pre-commit hook
  const preCommitPath = path.join(gitHooksDir, 'pre-commit');

  try {
    fs.writeFileSync(preCommitPath, preCommitHook, { mode: 0o755 });
    console.log('✓ Installed pre-commit hook');
  } catch (error) {
    console.error('Error installing pre-commit hook:', error.message);
    process.exit(1);
  }

  console.log('Git hooks installed successfully!');
}

installHooks();
