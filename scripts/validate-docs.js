#!/usr/bin/env node

/**
 * Documentation Structure Validation Script
 *
 * This script validates documentation organization standards:
 * 1. Only approved .md files exist in root directory
 * 2. All other .md files are in docs/ subdirectories
 * 3. Check for broken internal links
 * 4. Verify documentation frontmatter is present and valid
 * 5. Ensure docs/index.md is up-to-date
 * 6. Validate documentation follows naming conventions
 *
 * Usage:
 *   node scripts/validate-docs.js [options]
 *
 * Options:
 *   --fix          Attempt to fix issues automatically
 *   --verbose, -v  Show detailed output
 *   --ci           CI mode (exit with error code on violations)
 *   --quick        Quick mode (skip slow checks like link validation)
 *   --help         Show help message
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// Configuration
const APPROVED_ROOT_MD_FILES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md'];
const APPROVED_DOCS_ROOT_FILES = ['index.md', 'guide-map.md', 'README.md'];
const DOC_CATEGORIES = ['setup', 'features', 'troubleshooting', 'development', 'api', 'examples'];
const REQUIRED_FRONTMATTER = ['title'];
const RECOMMENDED_FRONTMATTER = ['description', 'tags'];

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  fix: args.includes('--fix'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  ci: args.includes('--ci'),
  quick: args.includes('--quick'),
  help: args.includes('--help') || args.includes('-h'),
};

if (options.help) {
  console.log(`
Documentation Structure Validator

Usage: node scripts/validate-docs.js [options]

Options:
  --fix          Attempt to fix issues automatically
  --verbose, -v  Show detailed output
  --ci           CI mode (exit with error code on violations)
  --quick        Quick mode (skip slow checks like link validation)
  --help, -h     Show this help message

Validation Rules:
  1. Root Directory: Only approved .md files (README, CHANGELOG, CONTRIBUTING, LICENSE)
  2. Doc Location: All docs must be in docs/ subdirectories
  3. Naming: kebab-case or UPPER_SNAKE_CASE, no spaces
  4. Frontmatter: Must have 'title' field
  5. Index: All docs should be referenced in docs/index.md
  6. Links: Internal links should point to valid files
`);
  process.exit(0);
}

// Utility functions
function color(text, colorName) {
  return `${colors[colorName]}${text}${colors.reset}`;
}

function log(message, type = 'info') {
  const prefix = {
    error: color('✗', 'red'),
    warning: color('⚠', 'yellow'),
    success: color('✓', 'green'),
    info: color('•', 'blue'),
  };
  console.log(`${prefix[type] || ''} ${message}`);
}

function logVerbose(message) {
  if (options.verbose) {
    console.log(color(`  ${message}`, 'dim'));
  }
}

function getAllMdFiles(dir, files = []) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
      getAllMdFiles(fullPath, files);
    } else if (item.isFile() && item.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return null;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const frontmatter = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

function isValidNaming(filename) {
  // Remove .md extension
  const name = filename.replace(/\.md$/, '');

  // Skip special files
  if (['index', 'README', 'guide-map'].includes(name)) {
    return true;
  }

  // kebab-case: lowercase letters, numbers, and hyphens
  const kebabCase = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  // UPPER_SNAKE_CASE: uppercase letters, numbers, and underscores
  const upperSnakeCase = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;

  return kebabCase.test(name) || upperSnakeCase.test(name);
}

function suggestCategory(filename) {
  const lowerName = filename.toLowerCase();

  if (
    lowerName.includes('setup') ||
    lowerName.includes('install') ||
    lowerName.includes('build') ||
    lowerName.includes('config')
  ) {
    return 'setup';
  }
  if (lowerName.includes('api') || lowerName.includes('endpoint') || lowerName.includes('reference')) {
    return 'api';
  }
  if (
    lowerName.includes('fix') ||
    lowerName.includes('issue') ||
    lowerName.includes('troubleshoot') ||
    lowerName.includes('bug')
  ) {
    return 'troubleshooting';
  }
  if (
    lowerName.includes('architecture') ||
    lowerName.includes('test') ||
    lowerName.includes('dev') ||
    lowerName.includes('contribute') ||
    lowerName.includes('performance')
  ) {
    return 'development';
  }

  return 'features';
}

// Validation functions
function validateRootFiles() {
  console.log(color('\n📁 Checking root directory files...', 'bold'));

  const rootFiles = fs.readdirSync('.').filter((f) => f.endsWith('.md'));

  const violations = [];
  const valid = [];

  for (const file of rootFiles) {
    if (APPROVED_ROOT_MD_FILES.includes(file)) {
      valid.push(file);
      logVerbose(`${file} - approved`);
    } else {
      violations.push(file);
    }
  }

  if (violations.length > 0) {
    log('Unauthorized .md files found in root:', 'error');
    for (const file of violations) {
      console.log(color(`    ${file}`, 'red'));
      const category = suggestCategory(file);
      console.log(color(`    → Move to: docs/${category}/${file}`, 'dim'));
    }
    return { pass: false, violations };
  }

  log(`All root .md files are approved (${valid.length} files)`, 'success');
  return { pass: true, violations: [] };
}

function validateDocLocations() {
  console.log(color('\n📂 Checking documentation locations...', 'bold'));

  if (!fs.existsSync('docs')) {
    log('docs/ directory not found', 'error');
    return { pass: false, violations: ['docs/ directory missing'] };
  }

  const docsRootFiles = fs.readdirSync('docs').filter((f) => f.endsWith('.md'));

  const violations = [];

  for (const file of docsRootFiles) {
    if (!APPROVED_DOCS_ROOT_FILES.includes(file)) {
      violations.push(`docs/${file}`);
    }
  }

  if (violations.length > 0) {
    log('Files found outside of docs/ subdirectories:', 'error');
    for (const file of violations) {
      console.log(color(`    ${file}`, 'red'));
      const category = suggestCategory(path.basename(file));
      console.log(color(`    → Move to: docs/${category}/${path.basename(file)}`, 'dim'));
    }
    return { pass: false, violations };
  }

  // Check that all required categories exist
  for (const category of DOC_CATEGORIES) {
    const categoryPath = path.join('docs', category);
    if (!fs.existsSync(categoryPath)) {
      log(`Missing directory: docs/${category}/`, 'warning');
    } else {
      logVerbose(`docs/${category}/ exists`);
    }
  }

  log('All documentation is in appropriate subdirectories', 'success');
  return { pass: true, violations: [] };
}

function validateNamingConventions() {
  console.log(color('\n📝 Checking naming conventions...', 'bold'));

  const allDocs = getAllMdFiles('docs').filter((f) => !f.includes('.vitepress'));

  const violations = [];

  for (const file of allDocs) {
    const filename = path.basename(file);

    // Check for spaces
    if (file.includes(' ')) {
      violations.push({ file, issue: 'contains spaces' });
      continue;
    }

    // Check naming convention
    if (!isValidNaming(filename)) {
      violations.push({
        file,
        issue: `'${filename}' - use kebab-case (my-doc.md) or UPPER_SNAKE_CASE (MY_DOC.md)`,
      });
    }
  }

  if (violations.length > 0) {
    log('Naming convention violations:', 'error');
    for (const { file, issue } of violations) {
      console.log(color(`    ${file}: ${issue}`, 'red'));
    }
    return { pass: false, violations };
  }

  log(`All ${allDocs.length} documentation files follow naming conventions`, 'success');
  return { pass: true, violations: [] };
}

function validateFrontmatter() {
  console.log(color('\n📋 Checking frontmatter...', 'bold'));

  const allDocs = getAllMdFiles('docs').filter((f) => !f.includes('.vitepress'));

  const errors = [];
  const warnings = [];

  for (const file of allDocs) {
    const content = fs.readFileSync(file, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    // Check if frontmatter exists
    if (!frontmatter) {
      // Skip api/index.md and examples files which may not need frontmatter
      if (!file.includes('api/index.md') && !file.includes('examples/')) {
        errors.push({ file, issue: 'missing frontmatter' });
      }
      continue;
    }

    // Check required fields
    for (const field of REQUIRED_FRONTMATTER) {
      if (!frontmatter[field] || frontmatter[field].trim() === '') {
        errors.push({ file, issue: `missing or empty '${field}'` });
      }
    }

    // Check recommended fields
    for (const field of RECOMMENDED_FRONTMATTER) {
      if (!frontmatter[field]) {
        warnings.push({ file, issue: `consider adding '${field}'` });
      }
    }
  }

  if (errors.length > 0) {
    log('Frontmatter errors:', 'error');
    for (const { file, issue } of errors) {
      console.log(color(`    ${file}: ${issue}`, 'red'));
    }
  }

  if (warnings.length > 0 && options.verbose) {
    log('Frontmatter recommendations:', 'warning');
    for (const { file, issue } of warnings) {
      console.log(color(`    ${file}: ${issue}`, 'yellow'));
    }
  }

  if (errors.length === 0) {
    log(`All documentation has valid frontmatter (${warnings.length} recommendations)`, 'success');
    return { pass: true, violations: [] };
  }

  return { pass: false, violations: errors };
}

function validateIndex() {
  console.log(color('\n📑 Checking docs/index.md coverage...', 'bold'));

  const indexPath = 'docs/index.md';
  if (!fs.existsSync(indexPath)) {
    log('docs/index.md not found', 'error');
    return { pass: false, violations: ['docs/index.md missing'] };
  }

  const indexContent = fs.readFileSync(indexPath, 'utf-8');

  // Get all .md files in docs subdirectories (excluding index files)
  const allDocs = getAllMdFiles('docs')
    .filter((f) => !f.includes('.vitepress'))
    .filter((f) => !path.basename(f).match(/^(index|README|guide-map)\.md$/));

  const missing = [];

  for (const doc of allDocs) {
    const filename = path.basename(doc, '.md');
    const relativePath = doc.replace('docs/', '').replace('.md', '');

    // Check if file is mentioned in index
    if (!indexContent.includes(filename) && !indexContent.includes(relativePath)) {
      missing.push(doc);
    }
  }

  if (missing.length > 0) {
    log(`Documentation files not in index (${missing.length} files):`, 'warning');
    for (const file of missing) {
      console.log(color(`    ${file}`, 'yellow'));
    }
    // This is a warning, not an error
    return { pass: true, violations: [], warnings: missing };
  }

  log(`All ${allDocs.length} documentation files are referenced in index`, 'success');
  return { pass: true, violations: [] };
}

function validateInternalLinks() {
  if (options.quick) {
    console.log(color('\n🔗 Skipping internal link check (quick mode)...', 'dim'));
    return { pass: true, violations: [] };
  }

  console.log(color('\n🔗 Checking internal links...', 'bold'));

  const allDocs = getAllMdFiles('docs').filter((f) => !f.includes('.vitepress'));

  const broken = [];

  // Regex to find markdown links
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const file of allDocs) {
    const content = fs.readFileSync(file, 'utf-8');
    const dir = path.dirname(file);

    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const linkPath = match[2];

      // Skip external links, anchors, mailto
      if (linkPath.startsWith('http') || linkPath.startsWith('#') || linkPath.startsWith('mailto:')) {
        continue;
      }

      // Resolve the link path
      let targetPath;
      if (linkPath.startsWith('/')) {
        // Absolute path from docs root
        targetPath = path.join('docs', linkPath);
      } else {
        // Relative path
        targetPath = path.join(dir, linkPath);
      }

      // Handle .html extension (VitePress converts .md to .html)
      targetPath = targetPath.replace(/\.html$/, '.md');

      // Add .md if no extension
      if (!path.extname(targetPath)) {
        if (fs.existsSync(targetPath + '.md')) {
          targetPath = targetPath + '.md';
        } else if (fs.existsSync(path.join(targetPath, 'index.md'))) {
          targetPath = path.join(targetPath, 'index.md');
        } else if (fs.existsSync(path.join(targetPath, 'README.md'))) {
          targetPath = path.join(targetPath, 'README.md');
        }
      }

      // Check if target exists
      if (!fs.existsSync(targetPath)) {
        broken.push({ file, link: linkPath });
      }
    }
  }

  if (broken.length > 0) {
    log(`Potentially broken internal links (${broken.length}):`, 'warning');
    for (const { file, link } of broken) {
      console.log(color(`    ${file}: ${link}`, 'yellow'));
    }
    // This is a warning since VitePress routes may differ
    return { pass: true, violations: [], warnings: broken };
  }

  log('No broken internal links detected', 'success');
  return { pass: true, violations: [] };
}

// Main execution
async function main() {
  console.log(color('═══════════════════════════════════════════════════════════', 'cyan'));
  console.log(color('          Documentation Structure Validation               ', 'bold'));
  console.log(color('═══════════════════════════════════════════════════════════', 'cyan'));

  const results = {
    rootFiles: validateRootFiles(),
    docLocations: validateDocLocations(),
    namingConventions: validateNamingConventions(),
    frontmatter: validateFrontmatter(),
    index: validateIndex(),
    internalLinks: validateInternalLinks(),
  };

  // Summary
  console.log(color('\n═══════════════════════════════════════════════════════════', 'cyan'));
  console.log(color('                        Summary                            ', 'bold'));
  console.log(color('═══════════════════════════════════════════════════════════', 'cyan'));

  const passed = Object.values(results).filter((r) => r.pass).length;
  const failed = Object.values(results).filter((r) => !r.pass).length;

  console.log(`\n  Checks passed: ${color(passed.toString(), 'green')}`);
  console.log(`  Checks failed: ${color(failed.toString(), failed > 0 ? 'red' : 'green')}`);

  if (failed > 0) {
    console.log(color('\n❌ Validation failed. Please fix the issues above.', 'red'));
    console.log(color('   See CONTRIBUTING.md for documentation guidelines.\n', 'dim'));

    if (options.ci) {
      process.exit(1);
    }
  } else {
    console.log(color('\n✅ All validation checks passed!\n', 'green'));
  }

  process.exit(failed > 0 && options.ci ? 1 : 0);
}

main().catch((err) => {
  console.error(color(`Error: ${err.message}`, 'red'));
  process.exit(1);
});
