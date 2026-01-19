# Contributing to FlowRecap

Thank you for your interest in contributing to FlowRecap! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Documentation Guidelines](#documentation-guidelines)
- [Documentation Validation](#documentation-validation)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to build something great together.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Set up the development environment (see [Development Setup](#development-setup))
4. Create a feature branch from `main`
5. Make your changes
6. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Python 3.12+ (for ML features)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/flowrecap.git
cd flowrecap

# Install dependencies
npm install

# Start development server
npm run dev
```

### Running Tests

```bash
# Run all tests
npm run test

# Run specific test suites
npm run test:diarization
npm run test:llm-provider
npm run test:production
```

## Documentation Guidelines

### Documentation Structure

All documentation (except specific allowed files) should be placed in the `docs/` directory:

```
docs/
├── README.md           # Documentation index
├── setup/              # Installation & configuration guides
├── features/           # Feature documentation
├── troubleshooting/    # Bug fixes, common issues, FAQ
├── development/        # Architecture, testing, contributing
└── api/                # API documentation
```

### Approved Root-Level Files

The root directory should only contain essential project files. This keeps the repository organized and makes it easier for contributors to navigate.

#### Configuration Files (Must be in Root)

| File | Purpose | Why Root? |
|------|---------|-----------|
| `package.json` | npm package manifest | npm requires it in root |
| `package-lock.json` | Dependency lock file | npm requires it in root |
| `tsconfig.json` | TypeScript configuration | tsc looks for it in root |
| `tsconfig.node.json` | Node TypeScript config | Referenced by main tsconfig |
| `vite.config.ts` | Vite build configuration | Vite looks for it in root |
| `electron-builder.config.cjs` | Electron packaging config | electron-builder convention |
| `tailwind.config.mjs` | Tailwind CSS configuration | PostCSS/Tailwind convention |
| `postcss.config.mjs` | PostCSS configuration | PostCSS convention |
| `playwright.config.ts` | Playwright test config | Playwright convention |
| `index.html` | Vite entry point | Vite requires it in root |
| `.gitignore` | Git ignore patterns | Git convention |
| `.env` | Environment variables | dotenv convention (gitignored) |

#### Documentation Files (Markdown in Root)

Only the following `.md` files are allowed in the repository root:

| File | Purpose | Why Root? |
|------|---------|-----------|
| `README.md` | Repository entry point and overview | GitHub convention for repo landing page |
| `CHANGELOG.md` | Version history and release notes | Standard location for changelogs |
| `CONTRIBUTING.md` | Contribution guidelines (this file) | GitHub convention for contribution docs |
| `LICENSE` or `LICENSE.md` | License information | Legal requirement, GitHub convention |

**All other documentation files must be placed in the `docs/` directory.**

#### Approved Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | Frontend React application source |
| `electron/` | Electron main process code |
| `python/` | Python ML services |
| `docs/` | Project documentation |
| `resources/` | Application resources (icons, assets) |
| `scripts/` | Build and utility scripts |
| `tests/` | Test suites |
| `.github/` | GitHub workflows and templates |
| `node_modules/` | npm dependencies (gitignored) |
| `dist/` | Build output (gitignored) |
| `dist-electron/` | Electron build output (gitignored) |
| `release/` | Release artifacts (gitignored) |

#### Pre-commit Hook

A pre-commit hook warns when new `.md` files are added to the root directory. This is a warning only and does not block commits, but encourages proper documentation placement.

To install the hook:
```bash
npm run prepare-hooks
```

To manually check for unapproved files:
```bash
npm run check-root-md
```

### Where to Place New Documentation

| Type of Documentation | Directory |
|----------------------|-----------|
| Installation guides | `docs/setup/` |
| Build instructions | `docs/setup/` |
| Environment configuration | `docs/setup/` |
| Feature descriptions | `docs/features/` |
| Feature implementation notes | `docs/features/` |
| Bug fixes | `docs/troubleshooting/` |
| Common issues & solutions | `docs/troubleshooting/` |
| FAQ | `docs/troubleshooting/` |
| Architecture documentation | `docs/development/` |
| Testing guides | `docs/development/` |
| Performance documentation | `docs/development/` |
| API references | `docs/api/` |
| Integration guides | `docs/api/` |

### Documentation Standards

1. **Use descriptive filenames** - Use UPPERCASE with underscores (e.g., `SPEAKER_DIARIZATION.md`)
2. **Include a title** - Start with a clear `# Title` heading
3. **Add a description** - Briefly explain what the document covers
4. **Use proper Markdown** - Follow standard Markdown formatting
5. **Update the index** - Add new files to `docs/README.md`
6. **Fix internal links** - When moving files, update all links that reference them

### Example: Adding New Documentation

1. Create your file in the appropriate directory:
   ```bash
   touch docs/features/MY_NEW_FEATURE.md
   ```

2. Write your documentation with proper structure:
   ```markdown
   # My New Feature

   ## Overview
   Brief description of the feature...

   ## Usage
   How to use the feature...

   ## Configuration
   Available options...
   ```

3. Update `docs/README.md` to include your new file:
   ```markdown
   | [MY_NEW_FEATURE.md](./features/MY_NEW_FEATURE.md) | Description of the feature |
   ```

4. If your documentation references other files, use relative links:
   ```markdown
   See [BUILD.md](../setup/BUILD.md) for build instructions.
   ```

## Documentation Validation

We enforce documentation organization standards through automated CI validation and pre-commit hooks. Understanding these rules will help your PRs pass validation on the first try.

### CI Validation

Our GitHub Actions workflow (`.github/workflows/docs-structure.yml`) runs on every PR that modifies `.md` files and enforces:

| Rule | Description | Severity |
|------|-------------|----------|
| **Root Files** | Only `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE.md` allowed in root | Error (blocks PR) |
| **Subdirectories** | All docs must be in `setup/`, `features/`, `troubleshooting/`, `development/`, or `api/` | Error (blocks PR) |
| **Naming Convention** | Files must use `kebab-case.md` or `UPPER_SNAKE_CASE.md` (no spaces) | Error (blocks PR) |
| **Frontmatter** | Documentation files must have YAML frontmatter with `title` field | Error (blocks PR) |
| **Index Coverage** | Documentation should be referenced in `docs/index.md` | Warning |
| **Internal Links** | Links to other docs should point to valid files | Warning |

### Required Frontmatter Format

All documentation files (except `index.md`, `README.md`, and `guide-map.md`) must include YAML frontmatter:

```yaml
---
title: Your Document Title
description: Brief description of what this document covers
tags:
  - relevant-tag
  - another-tag
lastUpdated: true
---

# Your Document Title

Content starts here...
```

**Required fields:**
- `title` - The document title (required)

**Recommended fields:**
- `description` - Brief description for SEO and search
- `tags` - Relevant keywords for categorization
- `lastUpdated` - Set to `true` to show last updated date

### Naming Conventions

Documentation files must follow one of these naming patterns:

| Pattern | Example | Valid |
|---------|---------|-------|
| kebab-case | `my-feature-doc.md` | ✓ |
| UPPER_SNAKE_CASE | `MY_FEATURE_DOC.md` | ✓ |
| Mixed case | `MyFeatureDoc.md` | ✗ |
| Spaces | `My Feature Doc.md` | ✗ |
| camelCase | `myFeatureDoc.md` | ✗ |

### Pre-commit Hooks

Pre-commit hooks are configured using [Husky](https://typicode.github.io/husky/) and run automatically when you commit:

```bash
# Hooks run automatically on commit when .md files are staged
# To manually run validation:
npm run validate-docs

# Run with verbose output
npm run validate-docs:verbose

# Run in CI mode (strict, exits with error code)
npm run validate-docs:ci
```

The pre-commit hook will:
1. Check for unauthorized `.md` files in root directory
2. Validate documentation locations
3. Check naming conventions
4. Verify frontmatter is present

### Fixing Validation Errors

**Error: Unauthorized .md file in root directory**
```bash
# Move the file to the appropriate docs/ subdirectory
git mv MY_DOC.md docs/features/MY_DOC.md
```

**Error: Missing frontmatter**
```bash
# Add frontmatter to the top of the file
---
title: Your Document Title
description: Brief description
---
```

**Error: Invalid naming convention**
```bash
# Rename using kebab-case or UPPER_SNAKE_CASE
git mv "My Doc.md" docs/features/MY_DOC.md
# or
git mv "My Doc.md" docs/features/my-doc.md
```

**Warning: Documentation not in index**
```bash
# Add entry to docs/index.md in the appropriate section
| [MY_DOC.md](/features/MY_DOC) | Description of the document |
```

### Validation Scripts

| Script | Description |
|--------|-------------|
| `npm run validate-docs` | Run all documentation validation checks |
| `npm run validate-docs:verbose` | Run with detailed output |
| `npm run validate-docs:ci` | Run in CI mode (strict, for pipelines) |
| `npm run check-root-md` | Check only root directory files |
| `npm run migrate-docs` | Migrate misplaced docs to correct location |
| `npm run migrate-docs:dry-run` | Preview migration without applying changes |

## Pull Request Process

1. **Update documentation** if your changes affect user-facing features
2. **Run tests** to ensure nothing is broken
3. **Update CHANGELOG.md** for significant changes
4. **Write a clear PR description** explaining what and why
5. **Link related issues** using `Fixes #123` or `Relates to #456`

### PR Checklist

- [ ] Code follows the project's coding standards
- [ ] Tests pass locally (`npm run test`)
- [ ] Documentation validation passes (`npm run validate-docs`)
- [ ] Documentation is updated (if applicable)
- [ ] New docs include required frontmatter (`title` field)
- [ ] New docs follow naming conventions (kebab-case or UPPER_SNAKE_CASE)
- [ ] New docs are added to `docs/index.md`
- [ ] CHANGELOG.md is updated (if applicable)
- [ ] No unauthorized `.md` files added to root directory

## Coding Standards

### TypeScript/JavaScript

- Use TypeScript for new code
- Follow existing code style
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### React Components

- Use functional components with hooks
- Keep components focused and modular
- Use TypeScript interfaces for props
- Follow the existing component patterns

### Python

- Follow PEP 8 style guidelines
- Use type hints where appropriate
- Document functions with docstrings

### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb (Add, Fix, Update, Remove)
- Reference issues when applicable

Example:
```
Add speaker diarization confidence scoring

- Implement confidence calculation for speaker segments
- Update UI to display confidence levels
- Add tests for confidence scoring

Fixes #123
```

## Documentation Migration Tool

We provide an automated tool for migrating documentation files from the root directory to the organized `docs/` structure.

### Running the Migration Script

```bash
# Preview changes without applying them (recommended first step)
node scripts/migrate-docs.js --dry-run

# Run the migration
node scripts/migrate-docs.js

# Run with verbose output
node scripts/migrate-docs.js --verbose

# Run migration and validate links
node scripts/migrate-docs.js --validate
```

### Script Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without applying them |
| `--rollback <file>` | Rollback using a migration report file |
| `--validate` | Validate links after migration |
| `--verbose, -v` | Show detailed output |
| `--skip-source-update` | Skip updating source code comments |
| `--skip-index` | Skip generating docs/README.md index |
| `--force` | Force migration even if no files to migrate |
| `--help` | Show help message |

### What the Script Does

1. **Scans** the root directory for `.md` files (excluding README.md, CHANGELOG.md, LICENSE.md, CONTRIBUTING.md)
2. **Analyzes** file content to determine the appropriate category (setup, features, troubleshooting, development, api)
3. **Moves** files to the appropriate `docs/<category>/` directory
4. **Updates** all internal markdown links in moved files
5. **Updates** references in source code comments
6. **Generates** an updated `docs/README.md` index
7. **Creates** a migration report for potential rollback

### Rolling Back a Migration

If you need to revert a migration:

```bash
# Use the migration report file
node scripts/migrate-docs.js --rollback .migration-reports/migration-report-<timestamp>.json
```

Migration reports are automatically saved in the `.migration-reports/` directory.

## Questions?

If you have questions about contributing, please open an issue or reach out to the maintainers.

Thank you for contributing to FlowRecap!
