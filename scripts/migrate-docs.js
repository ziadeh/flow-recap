#!/usr/bin/env node
/**
 * Documentation Migration Script
 *
 * Automates the migration of markdown documentation files from the root directory
 * to the organized docs/ structure while updating all internal references.
 *
 * Features:
 * - Scans root directory for .md files (excluding README.md, CHANGELOG.md, LICENSE.md)
 * - Categorizes files by content analysis (setup, features, troubleshooting, development)
 * - Moves files to appropriate subdirectories
 * - Updates all markdown links in moved files
 * - Updates links in source code comments
 * - Generates docs/README.md index with table of contents
 * - Validates no broken links (optional)
 * - Creates migration report showing old path -> new path mapping
 * - Supports dry-run mode to preview changes
 * - Supports rollback capability
 *
 * Usage:
 *   node scripts/migrate-docs.js [options]
 *
 * Options:
 *   --dry-run              Preview changes without applying them
 *   --rollback <file>      Rollback using a migration report file
 *   --validate             Validate links after migration
 *   --verbose, -v          Show detailed output
 *   --skip-source-update   Skip updating source code comments
 *   --skip-index           Skip generating docs/README.md index
 *   --force                Force migration even if docs/ structure exists
 *   --help                 Show help message
 *
 * Example:
 *   # Preview changes
 *   node scripts/migrate-docs.js --dry-run
 *
 *   # Run migration
 *   node scripts/migrate-docs.js
 *
 *   # Rollback migration
 *   node scripts/migrate-docs.js --rollback migration-report-2024-01-15.json
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const ELECTRON_DIR = path.join(PROJECT_ROOT, 'electron');
const PYTHON_DIR = path.join(PROJECT_ROOT, 'python');
const REPORTS_DIR = path.join(PROJECT_ROOT, '.migration-reports');

// Files to exclude from migration (always kept in root)
const EXCLUDED_FILES = ['README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md'];

// Category definitions with keyword patterns for content analysis
const CATEGORIES = {
  setup: {
    dir: 'setup',
    description: 'Installation & configuration guides',
    keywords: [
      'install', 'setup', 'build', 'configuration', 'environment',
      'bundling', 'bundle', 'packaging', 'prerequisites', 'requirements',
      'getting started', 'quick start', 'installation', 'configure',
      'local setup', 'development setup', 'env', 'architecture'
    ],
    filePatterns: ['BUILD', 'SETUP', 'INSTALL', 'ENV', 'BUNDL', 'ARCHITECTURE']
  },
  features: {
    dir: 'features',
    description: 'Feature documentation',
    keywords: [
      'feature', 'functionality', 'implementation', 'integration',
      'diarization', 'transcription', 'speaker', 'llm', 'ai',
      'processing', 'sentiment', 'analysis', 'capability', 'usage'
    ],
    filePatterns: ['FEATURE', 'DIARIZATION', 'LLM', 'INTEGRATION', 'SENTIMENT']
  },
  troubleshooting: {
    dir: 'troubleshooting',
    description: 'Bug fixes, common issues, FAQ',
    keywords: [
      'fix', 'bug', 'error', 'issue', 'problem', 'troubleshoot',
      'debug', 'resolve', 'solution', 'workaround', 'warning',
      'failed', 'failure', 'broken', 'faq', 'common issues'
    ],
    filePatterns: ['FIX', 'BUG', 'TROUBLESHOOT', 'ERROR', 'DEBUG', 'ISSUE']
  },
  development: {
    dir: 'development',
    description: 'Architecture, testing, contributing',
    keywords: [
      'development', 'testing', 'test', 'architecture', 'design',
      'contribute', 'contributing', 'performance', 'optimization',
      'audit', 'checklist', 'workflow', 'ci', 'cd', 'console', 'notes'
    ],
    filePatterns: ['TEST', 'PERFORMANCE', 'AUDIT', 'CHECKLIST', 'DEV', 'CONSOLE', 'NOTES']
  },
  api: {
    dir: 'api',
    description: 'API documentation',
    keywords: [
      'api', 'endpoint', 'rest', 'graphql', 'service', 'interface',
      'request', 'response', 'schema', 'reference'
    ],
    filePatterns: ['API', 'ENDPOINT', 'SERVICE', 'SCHEMA']
  }
};

// Default configuration
const config = {
  dryRun: false,
  rollbackFile: null,
  validate: false,
  verbose: false,
  skipSourceUpdate: false,
  skipIndex: false,
  force: false,
};

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--rollback':
        config.rollbackFile = args[++i];
        break;
      case '--validate':
        config.validate = true;
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--skip-source-update':
        config.skipSourceUpdate = true;
        break;
      case '--skip-index':
        config.skipIndex = true;
        break;
      case '--force':
        config.force = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
}

function printHelp() {
  console.log(`
Documentation Migration Script

Automates the migration of markdown documentation files from the root directory
to the organized docs/ structure while updating all internal references.

Usage:
  node scripts/migrate-docs.js [options]

Options:
  --dry-run              Preview changes without applying them
  --rollback <file>      Rollback using a migration report file
  --validate             Validate links after migration (requires markdown-link-check)
  --verbose, -v          Show detailed output
  --skip-source-update   Skip updating source code comments
  --skip-index           Skip generating docs/README.md index
  --force                Force migration even if no files to migrate
  --help, -h             Show this help message

Examples:
  # Preview changes (recommended first step)
  node scripts/migrate-docs.js --dry-run

  # Run migration with verbose output
  node scripts/migrate-docs.js --verbose

  # Run migration and validate links
  node scripts/migrate-docs.js --validate

  # Rollback a previous migration
  node scripts/migrate-docs.js --rollback .migration-reports/migration-report-2024-01-15.json

Documentation Categories:
  - setup/          Installation guides, build instructions, environment config
  - features/       Feature documentation and usage guides
  - troubleshooting/ Bug fixes, common issues, FAQ
  - development/    Architecture, testing, contributing guides
  - api/            API documentation and references

The script will:
  1. Scan root directory for .md files (excluding README.md, CHANGELOG.md, LICENSE.md)
  2. Analyze content to determine appropriate category
  3. Move files to docs/<category>/
  4. Update all internal links in moved files
  5. Update links in source code comments
  6. Generate updated docs/README.md index
  7. Create migration report for potential rollback

Note: Always run with --dry-run first to preview changes!
`);
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(message, level = 'info') {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    success: '\x1b[32m[SUCCESS]\x1b[0m',
    warning: '\x1b[33m[WARNING]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    debug: '\x1b[90m[DEBUG]\x1b[0m',
    dryrun: '\x1b[35m[DRY-RUN]\x1b[0m',
  };

  if (level === 'debug' && !config.verbose) return;

  console.log(`${prefix[level] || prefix.info} ${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    if (config.dryRun) {
      log(`Would create directory: ${dirPath}`, 'dryrun');
    } else {
      fs.mkdirSync(dirPath, { recursive: true });
      log(`Created directory: ${dirPath}`, 'debug');
    }
  }
}

function getRelativePath(from, to) {
  return path.relative(path.dirname(from), to);
}

// ============================================================================
// Content Analysis Functions
// ============================================================================

/**
 * Analyzes markdown content to determine the most appropriate category
 * @param {string} filename - Name of the file
 * @param {string} content - File content
 * @returns {string} Category key (setup, features, troubleshooting, development, api)
 */
function analyzeContent(filename, content) {
  const filenameUpper = filename.toUpperCase();
  const contentLower = content.toLowerCase();
  const scores = {};

  // Initialize scores
  for (const category of Object.keys(CATEGORIES)) {
    scores[category] = 0;
  }

  // Score based on filename patterns (high weight)
  for (const [category, config] of Object.entries(CATEGORIES)) {
    for (const pattern of config.filePatterns) {
      if (filenameUpper.includes(pattern)) {
        scores[category] += 10;
      }
    }
  }

  // Score based on content keywords
  for (const [category, config] of Object.entries(CATEGORIES)) {
    for (const keyword of config.keywords) {
      // Count occurrences of keyword in content
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        scores[category] += matches.length;
      }
    }
  }

  // Additional heuristics
  // Check for code blocks indicating technical docs
  if (contentLower.includes('```bash') || contentLower.includes('```shell')) {
    scores.setup += 3;
  }

  // Check for error messages
  if (contentLower.includes('error:') || contentLower.includes('exception')) {
    scores.troubleshooting += 5;
  }

  // Check for test-related content
  if (contentLower.includes('test case') || contentLower.includes('npm test')) {
    scores.development += 3;
  }

  // Find the category with the highest score
  let maxScore = 0;
  let bestCategory = 'development'; // Default fallback

  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  log(`  Category scores for ${filename}: ${JSON.stringify(scores)}`, 'debug');
  log(`  Selected category: ${bestCategory} (score: ${maxScore})`, 'debug');

  return bestCategory;
}

/**
 * Gets a brief description of the file based on its first heading or content
 * @param {string} content - File content
 * @returns {string} Brief description
 */
function getFileDescription(content) {
  // Try to get first heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  // Try to get first paragraph
  const paragraphMatch = content.match(/^[^#\n][^\n]+/m);
  if (paragraphMatch) {
    let desc = paragraphMatch[0].trim();
    if (desc.length > 80) {
      desc = desc.substring(0, 77) + '...';
    }
    return desc;
  }

  return 'Documentation file';
}

// ============================================================================
// File Scanning Functions
// ============================================================================

/**
 * Scans root directory for markdown files to migrate
 * @returns {Array} Array of file objects with path, name, and content
 */
function scanRootMarkdownFiles() {
  const files = [];

  try {
    const entries = fs.readdirSync(PROJECT_ROOT);

    for (const entry of entries) {
      // Only process .md files
      if (!entry.endsWith('.md')) continue;

      // Skip excluded files
      if (EXCLUDED_FILES.includes(entry)) {
        log(`Skipping excluded file: ${entry}`, 'debug');
        continue;
      }

      const filePath = path.join(PROJECT_ROOT, entry);
      const stat = fs.statSync(filePath);

      // Only process files (not directories)
      if (!stat.isFile()) continue;

      const content = fs.readFileSync(filePath, 'utf-8');

      files.push({
        name: entry,
        sourcePath: filePath,
        content: content,
        category: null,
        targetPath: null,
      });
    }
  } catch (error) {
    log(`Error scanning root directory: ${error.message}`, 'error');
  }

  return files;
}

/**
 * Scans all markdown files in the docs directory
 * @returns {Array} Array of file paths
 */
function scanDocsMarkdownFiles() {
  const files = [];

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  walkDir(DOCS_DIR);
  return files;
}

/**
 * Scans source code files for documentation references
 * @returns {Array} Array of file paths
 */
function scanSourceFiles() {
  const files = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    if (dir.includes('node_modules')) return;
    if (dir.includes('dist')) return;
    if (dir.includes('build')) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walkDir(SRC_DIR);
  walkDir(ELECTRON_DIR);
  walkDir(PYTHON_DIR);

  return files;
}

// ============================================================================
// Link Update Functions
// ============================================================================

/**
 * Updates markdown links in content based on migration mapping
 * @param {string} content - File content
 * @param {string} currentFilePath - Current file path
 * @param {Map} migrationMap - Map of old paths to new paths
 * @returns {string} Updated content
 */
function updateMarkdownLinks(content, currentFilePath, migrationMap) {
  // Match markdown links: [text](path.md) or [text](./path.md) or [text](../path.md)
  const linkRegex = /\[([^\]]*)\]\(([^)]+\.md)\)/g;

  return content.replace(linkRegex, (match, text, linkPath) => {
    // Skip external links
    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
      return match;
    }

    // Resolve the absolute path of the linked file
    const currentDir = path.dirname(currentFilePath);
    const absoluteLinkPath = path.resolve(currentDir, linkPath);

    // Check if this file was migrated
    if (migrationMap.has(absoluteLinkPath)) {
      const newAbsolutePath = migrationMap.get(absoluteLinkPath);
      const newRelativePath = getRelativePath(currentFilePath, newAbsolutePath);

      log(`  Updating link: ${linkPath} -> ${newRelativePath}`, 'debug');
      return `[${text}](${newRelativePath})`;
    }

    // Check if the link needs updating due to current file moving
    // This handles relative links within the same directory structure
    return match;
  });
}

/**
 * Updates documentation references in source code comments
 * @param {string} content - File content
 * @param {Map} migrationMap - Map of old relative paths to new relative paths
 * @returns {string} Updated content
 */
function updateSourceCodeReferences(content, migrationMap) {
  let updated = content;

  for (const [oldPath, newPath] of migrationMap) {
    const oldFileName = path.basename(oldPath);
    const newRelativePath = path.relative(PROJECT_ROOT, newPath);

    // Update various patterns:
    // 1. Direct file references: OLD_FILE.md -> docs/category/OLD_FILE.md
    // 2. Path references: ./OLD_FILE.md or ../OLD_FILE.md
    // 3. Comment references: See OLD_FILE.md for details

    // Pattern 1: Root-relative references
    const rootRelativePattern = new RegExp(`(?<![/\\w])${oldFileName}(?![/\\w])`, 'g');
    updated = updated.replace(rootRelativePattern, newRelativePath);

    // Pattern 2: Relative path references (./FILE.md)
    const dotSlashPattern = new RegExp(`\\./${oldFileName}`, 'g');
    updated = updated.replace(dotSlashPattern, `./${newRelativePath}`);
  }

  return updated;
}

// ============================================================================
// Index Generation Functions
// ============================================================================

/**
 * Generates the docs/README.md index file
 * @param {Array} allDocFiles - Array of all documentation files (paths or objects with metadata)
 * @param {Array} pendingMigrations - Array of files pending migration (for dry-run mode)
 * @returns {string} Generated index content
 */
function generateDocsIndex(allDocFiles, pendingMigrations = []) {
  const filesByCategory = {};

  // Initialize categories
  for (const [key, categoryConfig] of Object.entries(CATEGORIES)) {
    filesByCategory[key] = [];
  }

  // Sort existing files into categories
  for (const filePath of allDocFiles) {
    const relativePath = path.relative(DOCS_DIR, filePath);
    const parts = relativePath.split(path.sep);

    if (parts.length >= 2) {
      const category = parts[0];
      if (filesByCategory[category]) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const description = getFileDescription(content);
          const fileName = path.basename(filePath);

          filesByCategory[category].push({
            name: fileName,
            relativePath: `./${relativePath}`,
            description: description,
          });
        } catch (error) {
          // Skip files that can't be read (e.g., in dry-run mode)
          log(`Skipping unreadable file: ${filePath}`, 'debug');
        }
      }
    }
  }

  // Add pending migrations (for dry-run mode)
  for (const migration of pendingMigrations) {
    const relativePath = path.relative(DOCS_DIR, migration.targetPath);
    const parts = relativePath.split(path.sep);

    if (parts.length >= 2) {
      const category = parts[0];
      if (filesByCategory[category]) {
        const description = getFileDescription(migration.content || '');
        const fileName = path.basename(migration.targetPath);

        filesByCategory[category].push({
          name: fileName,
          relativePath: `./${relativePath}`,
          description: description + ' (pending migration)',
        });
      }
    }
  }

  // Sort files within each category alphabetically
  for (const category of Object.keys(filesByCategory)) {
    filesByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Generate markdown content
  let content = `# FlowRecap Documentation

Welcome to the FlowRecap documentation! This directory contains comprehensive documentation for setting up, developing, and troubleshooting the FlowRecap application.

## Documentation Structure

`;

  // Generate category sections
  for (const [key, categoryConfig] of Object.entries(CATEGORIES)) {
    const files = filesByCategory[key];
    const categoryDir = categoryConfig.dir;

    content += `### [${capitalizeFirst(categoryDir)}](./${categoryDir}/)
${categoryConfig.description}.

`;

    if (files.length > 0) {
      content += `| Document | Description |
|----------|-------------|
`;

      for (const file of files) {
        content += `| [${file.name}](${file.relativePath}) | ${file.description} |
`;
      }
    } else {
      content += `*Coming soon: ${categoryConfig.description}.*

`;
    }

    content += '\n';
  }

  // Add quick links section
  content += `## Quick Links

- **Getting Started**: Start with [BUILD.md](./setup/BUILD.md) for build instructions
- **Python Setup**: See [PYTHON_ENV_ARCHITECTURE.md](./setup/PYTHON_ENV_ARCHITECTURE.md) for environment details
- **Common Issues**: Check [Troubleshooting](./troubleshooting/) for common problems and solutions
- **Contributing**: Review [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines

## Documentation Guidelines

When adding new documentation:

1. **Setup docs** go in \`docs/setup/\` - installation, configuration, build guides
2. **Feature docs** go in \`docs/features/\` - feature descriptions and usage
3. **Troubleshooting docs** go in \`docs/troubleshooting/\` - bug fixes, common issues
4. **Development docs** go in \`docs/development/\` - architecture, testing, contributing
5. **API docs** go in \`docs/api/\` - API references and integration guides

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full documentation placement guidelines.
`;

  return content;
}

function capitalizeFirst(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Performs the migration
 * @returns {Object} Migration report
 */
function performMigration() {
  const report = {
    timestamp: new Date().toISOString(),
    dryRun: config.dryRun,
    fileMigrations: [],
    linkUpdates: [],
    sourceUpdates: [],
    indexGenerated: false,
    errors: [],
  };

  // Step 1: Scan for files to migrate
  log('Scanning for markdown files in root directory...');
  const filesToMigrate = scanRootMarkdownFiles();

  if (filesToMigrate.length === 0) {
    log('No markdown files found to migrate.', 'info');
    if (!config.force) {
      return report;
    }
  }

  log(`Found ${filesToMigrate.length} file(s) to migrate`, 'success');

  // Step 2: Analyze and categorize files
  log('Analyzing file content for categorization...');
  for (const file of filesToMigrate) {
    file.category = analyzeContent(file.name, file.content);
    const targetDir = path.join(DOCS_DIR, CATEGORIES[file.category].dir);
    file.targetPath = path.join(targetDir, file.name);

    log(`  ${file.name} -> ${CATEGORIES[file.category].dir}/`, 'info');

    report.fileMigrations.push({
      sourcePath: file.sourcePath,
      targetPath: file.targetPath,
      category: file.category,
    });
  }

  // Step 3: Create migration map
  const migrationMap = new Map();
  for (const file of filesToMigrate) {
    migrationMap.set(file.sourcePath, file.targetPath);
  }

  // Step 4: Ensure target directories exist
  log('Ensuring target directories exist...');
  for (const category of Object.values(CATEGORIES)) {
    ensureDir(path.join(DOCS_DIR, category.dir));
  }

  // Step 5: Move files and update their internal links
  log('Moving files and updating internal links...');
  for (const file of filesToMigrate) {
    try {
      // Update links in the file content
      const updatedContent = updateMarkdownLinks(file.content, file.targetPath, migrationMap);

      if (config.dryRun) {
        log(`Would move: ${file.sourcePath} -> ${file.targetPath}`, 'dryrun');
        if (updatedContent !== file.content) {
          log(`  Would update internal links`, 'dryrun');
        }
      } else {
        // Write to new location
        fs.writeFileSync(file.targetPath, updatedContent, 'utf-8');

        // Remove from old location
        fs.unlinkSync(file.sourcePath);

        log(`Moved: ${file.name} -> ${CATEGORIES[file.category].dir}/`, 'success');
      }
    } catch (error) {
      log(`Error moving ${file.name}: ${error.message}`, 'error');
      report.errors.push({
        file: file.name,
        operation: 'move',
        error: error.message,
      });
    }
  }

  // Step 6: Update links in existing docs files
  log('Updating links in existing documentation files...');
  const existingDocFiles = scanDocsMarkdownFiles();

  for (const docFile of existingDocFiles) {
    // Skip if this is a newly migrated file
    if (filesToMigrate.some(f => f.targetPath === docFile)) continue;

    try {
      const content = fs.readFileSync(docFile, 'utf-8');
      const updatedContent = updateMarkdownLinks(content, docFile, migrationMap);

      if (updatedContent !== content) {
        if (config.dryRun) {
          log(`Would update links in: ${path.relative(PROJECT_ROOT, docFile)}`, 'dryrun');
        } else {
          fs.writeFileSync(docFile, updatedContent, 'utf-8');
          log(`Updated links in: ${path.relative(PROJECT_ROOT, docFile)}`, 'success');
        }

        report.linkUpdates.push({
          file: docFile,
          linksUpdated: true,
        });
      }
    } catch (error) {
      log(`Error updating ${docFile}: ${error.message}`, 'error');
      report.errors.push({
        file: docFile,
        operation: 'updateLinks',
        error: error.message,
      });
    }
  }

  // Step 7: Update source code references (optional)
  if (!config.skipSourceUpdate) {
    log('Scanning source code for documentation references...');
    const sourceFiles = scanSourceFiles();
    let sourceUpdatesCount = 0;

    for (const sourceFile of sourceFiles) {
      try {
        const content = fs.readFileSync(sourceFile, 'utf-8');
        const updatedContent = updateSourceCodeReferences(content, migrationMap);

        if (updatedContent !== content) {
          if (config.dryRun) {
            log(`Would update references in: ${path.relative(PROJECT_ROOT, sourceFile)}`, 'dryrun');
          } else {
            fs.writeFileSync(sourceFile, updatedContent, 'utf-8');
            log(`Updated references in: ${path.relative(PROJECT_ROOT, sourceFile)}`, 'success');
          }

          report.sourceUpdates.push({
            file: sourceFile,
            updated: true,
          });
          sourceUpdatesCount++;
        }
      } catch (error) {
        // Silently skip files that can't be read
        log(`Skipping ${sourceFile}: ${error.message}`, 'debug');
      }
    }

    log(`Updated ${sourceUpdatesCount} source file(s)`, 'info');
  }

  // Step 8: Generate docs/README.md index
  if (!config.skipIndex) {
    log('Generating documentation index...');

    // Get existing doc files
    const allDocFiles = scanDocsMarkdownFiles();

    // Filter out the README.md itself
    const indexFiles = allDocFiles.filter(f => path.basename(f) !== 'README.md');

    // Pass pending migrations for dry-run mode
    const pendingMigrations = config.dryRun ? filesToMigrate : [];
    const indexContent = generateDocsIndex(indexFiles, pendingMigrations);
    const indexPath = path.join(DOCS_DIR, 'README.md');

    if (config.dryRun) {
      log(`Would generate: ${indexPath}`, 'dryrun');
    } else {
      ensureDir(DOCS_DIR);
      fs.writeFileSync(indexPath, indexContent, 'utf-8');
      log(`Generated documentation index: ${indexPath}`, 'success');
    }

    report.indexGenerated = true;
  }

  // Step 9: Save migration report
  if (!config.dryRun) {
    saveMigrationReport(report);
  }

  return report;
}

/**
 * Saves the migration report for potential rollback
 * @param {Object} report - Migration report
 */
function saveMigrationReport(report) {
  ensureDir(REPORTS_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORTS_DIR, `migration-report-${timestamp}.json`);

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  log(`Migration report saved: ${reportPath}`, 'info');

  return reportPath;
}

// ============================================================================
// Rollback Functions
// ============================================================================

/**
 * Performs a rollback based on a migration report
 * @param {string} reportFile - Path to migration report file
 */
function performRollback(reportFile) {
  log(`Rolling back migration using: ${reportFile}`);

  // Load report
  let report;
  try {
    const reportPath = path.isAbsolute(reportFile)
      ? reportFile
      : path.join(PROJECT_ROOT, reportFile);

    if (!fs.existsSync(reportPath)) {
      throw new Error(`Report file not found: ${reportPath}`);
    }

    report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch (error) {
    log(`Error loading report: ${error.message}`, 'error');
    process.exit(1);
  }

  // Reverse file migrations
  log('Reversing file migrations...');
  for (const migration of report.fileMigrations) {
    try {
      if (fs.existsSync(migration.targetPath)) {
        // Read content from target
        const content = fs.readFileSync(migration.targetPath, 'utf-8');

        if (config.dryRun) {
          log(`Would move back: ${migration.targetPath} -> ${migration.sourcePath}`, 'dryrun');
        } else {
          // Write to original location
          fs.writeFileSync(migration.sourcePath, content, 'utf-8');

          // Remove from target location
          fs.unlinkSync(migration.targetPath);

          log(`Restored: ${path.basename(migration.sourcePath)}`, 'success');
        }
      } else {
        log(`Target file not found, skipping: ${migration.targetPath}`, 'warning');
      }
    } catch (error) {
      log(`Error rolling back ${migration.targetPath}: ${error.message}`, 'error');
    }
  }

  log('Rollback completed!', 'success');
  log('Note: Link updates and index changes are not automatically reversed.', 'warning');
  log('You may need to manually review and update links in documentation files.', 'warning');
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates all links in documentation files
 */
async function validateLinks() {
  log('Validating documentation links...');

  try {
    // Check if markdown-link-check is available
    const { execSync } = require('child_process');

    try {
      execSync('npx markdown-link-check --version', { stdio: 'pipe' });
    } catch {
      log('markdown-link-check not found. Install with: npm install -g markdown-link-check', 'warning');
      return;
    }

    // Get all markdown files
    const docFiles = scanDocsMarkdownFiles();
    let hasErrors = false;

    for (const docFile of docFiles) {
      try {
        execSync(`npx markdown-link-check "${docFile}"`, { stdio: 'pipe' });
        log(`  ✓ ${path.relative(PROJECT_ROOT, docFile)}`, 'debug');
      } catch (error) {
        log(`  ✗ ${path.relative(PROJECT_ROOT, docFile)} - has broken links`, 'error');
        hasErrors = true;
      }
    }

    if (hasErrors) {
      log('Some files have broken links. Run markdown-link-check manually for details.', 'warning');
    } else {
      log('All links validated successfully!', 'success');
    }
  } catch (error) {
    log(`Link validation error: ${error.message}`, 'error');
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n========================================');
  console.log('  FlowRecap Documentation Migration Tool');
  console.log('========================================\n');

  parseArgs();

  if (config.dryRun) {
    log('Running in DRY-RUN mode - no changes will be made', 'dryrun');
    console.log('');
  }

  try {
    if (config.rollbackFile) {
      // Perform rollback
      performRollback(config.rollbackFile);
    } else {
      // Perform migration
      const report = performMigration();

      // Print summary
      console.log('\n========================================');
      console.log('  Migration Summary');
      console.log('========================================\n');

      log(`Files migrated: ${report.fileMigrations.length}`);
      log(`Link updates: ${report.linkUpdates.length}`);
      log(`Source updates: ${report.sourceUpdates.length}`);
      log(`Index generated: ${report.indexGenerated ? 'Yes' : 'No'}`);
      log(`Errors: ${report.errors.length}`);

      if (report.fileMigrations.length > 0) {
        console.log('\nMigration Mapping:');
        console.log('─'.repeat(60));
        for (const migration of report.fileMigrations) {
          const oldPath = path.relative(PROJECT_ROOT, migration.sourcePath);
          const newPath = path.relative(PROJECT_ROOT, migration.targetPath);
          console.log(`  ${oldPath}`);
          console.log(`    -> ${newPath}`);
        }
      }

      if (report.errors.length > 0) {
        console.log('\nErrors:');
        console.log('─'.repeat(60));
        for (const error of report.errors) {
          console.log(`  ${error.file}: ${error.error}`);
        }
      }

      // Validate links if requested
      if (config.validate) {
        console.log('');
        await validateLinks();
      }

      if (config.dryRun) {
        console.log('\n' + '─'.repeat(60));
        log('This was a DRY RUN. Run without --dry-run to apply changes.', 'info');
      } else if (report.fileMigrations.length > 0) {
        console.log('\n' + '─'.repeat(60));
        log('Migration completed successfully!', 'success');
        log('A report has been saved for potential rollback.', 'info');
      }
    }
  } catch (error) {
    log(`Migration failed: ${error.message}`, 'error');
    if (config.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
