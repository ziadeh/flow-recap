---
layout: home
title: FlowRecap Documentation
description: AI-Powered Meeting Notes & Transcription - Comprehensive Documentation
tags:
  - flowrecap
  - documentation
  - meeting-notes
  - transcription
  - ai
lastUpdated: true
---

<script setup>
import { VPTeamMembers } from 'vitepress/theme'
</script>

# FlowRecap Documentation

Welcome to the FlowRecap documentation! This site provides comprehensive guides for setting up, developing, and troubleshooting the FlowRecap application.

## Quick Navigation

<div class="features">
  <div class="feature">
    <h3>Setup Guides</h3>
    <p>Installation & configuration guides to get FlowRecap up and running.</p>
    <a href="/setup/BUILD">Get Started</a>
  </div>
  <div class="feature">
    <h3>Feature Documentation</h3>
    <p>Learn about FlowRecap's powerful features including speaker diarization and LLM integration.</p>
    <a href="/features/FEATURE_IMPLEMENTATION_SUMMARY">Explore Features</a>
  </div>
  <div class="feature">
    <h3>Development</h3>
    <p>Architecture guides, testing procedures, and contribution guidelines.</p>
    <a href="/development/IMPLEMENTATION_NOTES">Start Contributing</a>
  </div>
  <div class="feature">
    <h3>Troubleshooting</h3>
    <p>Common issues, bug fixes, and solutions for platform-specific problems.</p>
    <a href="/troubleshooting/WINDOWS_TROUBLESHOOTING">Find Solutions</a>
  </div>
</div>

---

## Documentation Categories

### Setup Guides

Installation and configuration documentation to get FlowRecap running on your system.

| Document | Description |
|----------|-------------|
| [Building FlowRecap](/setup/BUILD) | Complete build instructions for all platforms |
| [Python Bundling Guide](/setup/PYTHON_BUNDLING) | How to bundle Python environment |
| [Python Environment Architecture](/setup/PYTHON_ENV_ARCHITECTURE) | Understanding the Python setup |
| [Rebuilding Python Bundle](/setup/REBUILD_BUNDLE) | Quick guide for rebuilding |
| [Windows Local Setup](/setup/WINDOWS_LOCAL_SETUP) | Windows-specific setup guide |

### Feature Documentation

Detailed documentation of FlowRecap's core features and capabilities.

| Document | Description |
|----------|-------------|
| [Feature Implementation Summary](/features/FEATURE_IMPLEMENTATION_SUMMARY) | Overview of all implemented features |
| [Speaker Diarization](/features/SPEAKER_DIARIZATION) | Multi-speaker detection and labeling |
| [Speaker Diarization Fix](/features/SPEAKER_DIARIZATION_FIX) | Recent fixes and improvements |
| [LLM Post-Processing](/features/LLM_POST_PROCESSING_INTEGRATION) | AI-powered transcript enhancement |
| [Sentiment Preservation](/features/SENTIMENT_PRESERVATION_VERIFICATION) | Maintaining sentiment accuracy |

### Development

Resources for developers contributing to FlowRecap.

| Document | Description |
|----------|-------------|
| [Implementation Notes](/development/IMPLEMENTATION_NOTES) | Technical implementation details |
| [Console Output Guide](/development/CONSOLE_OUTPUT) | Understanding console logging |
| [Manual Testing Checklist](/development/MANUAL_TESTING_CHECKLIST) | QA testing procedures |
| [Performance Optimizations](/development/PERFORMANCE_OPTIMIZATIONS_SUMMARY) | Performance improvements made |
| [Performance Testing](/development/PERFORMANCE_TESTING) | How to run performance tests |
| [Quick Performance Guide](/development/QUICK_PERFORMANCE_GUIDE) | Fast performance testing |
| [Windows Compatibility](/development/WINDOWS_COMPATIBILITY_AUDIT) | Windows platform support |

### Troubleshooting

Solutions for common issues and platform-specific problems.

| Document | Description |
|----------|-------------|
| [Windows Troubleshooting](/troubleshooting/WINDOWS_TROUBLESHOOTING) | Windows-specific issues |
| [Environment Warning Fix](/troubleshooting/BUGFIX_ENVIRONMENT_WARNING) | False positive warnings |
| [Bundle Fix Summary](/troubleshooting/BUNDLE_FIX_SUMMARY) | TorchAudio circular import fix |
| [Bundled Python Fix](/troubleshooting/BUNDLED_PYTHON_FIX) | Python detection fixes |
| [Python Bundle Fix](/troubleshooting/PYTHON_BUNDLE_FIX) | Import failure solutions |
| [Test Validation Fix](/troubleshooting/TEST_VALIDATION_FIX) | Test plan for warnings |
| [Follow-Up Summary](/troubleshooting/FOLLOW_UP_SUMMARY) | Understanding error messages |

### API Reference

API documentation for FlowRecap's interfaces.

| Document | Description |
|----------|-------------|
| [API Documentation](/api/) | Coming soon - API reference |

---

## Documentation Map

```mermaid
flowchart TB
    subgraph Getting Started
        A[Introduction] --> B[Build Guide]
        B --> C[Python Setup]
    end

    subgraph Core Features
        D[Speaker Diarization]
        E[LLM Integration]
        F[Transcription]
    end

    subgraph Development
        G[Architecture]
        H[Testing]
        I[Performance]
    end

    subgraph Troubleshooting
        J[Windows Issues]
        K[Python Errors]
        L[Build Problems]
    end

    B --> D
    B --> E
    C --> D
    C --> E
    D --> G
    E --> G
    G --> H
    H --> I
    B --> L
    C --> K
    K --> J
```

---

## Quick Links

- **Getting Started**: Start with [BUILD.md](/setup/BUILD) for build instructions
- **Python Setup**: See [PYTHON_ENV_ARCHITECTURE.md](/setup/PYTHON_ENV_ARCHITECTURE) for environment details
- **Common Issues**: Check [Troubleshooting](/troubleshooting/WINDOWS_TROUBLESHOOTING) for common problems and solutions
- **Contributing**: Review the [Implementation Notes](/development/IMPLEMENTATION_NOTES) for contribution guidelines

## Using This Documentation

### Search

Use the search bar at the top of the page (or press <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>Cmd</kbd>+<kbd>K</kbd>) to quickly find documentation on any topic.

### Navigation

- Use the **sidebar** on the left to browse documentation by category
- Use the **table of contents** on the right to jump to sections within a page
- Use the **previous/next** links at the bottom to navigate sequentially

### Contributing to Docs

When adding new documentation:

1. **Setup docs** go in `docs/setup/` - installation, configuration, build guides
2. **Feature docs** go in `docs/features/` - feature descriptions and usage
3. **Troubleshooting docs** go in `docs/troubleshooting/` - bug fixes, common issues
4. **Development docs** go in `docs/development/` - architecture, testing, contributing
5. **API docs** go in `docs/api/` - API references and integration guides

<style>
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.feature {
  padding: 1.5rem;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  transition: border-color 0.25s, box-shadow 0.25s;
}

.feature:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.feature h3 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.feature p {
  margin: 0 0 1rem;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.5;
}

.feature a {
  display: inline-block;
  padding: 0.4rem 1rem;
  border-radius: 4px;
  background: var(--vp-c-brand-1);
  color: white;
  font-size: 0.85rem;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.25s;
}

.feature a:hover {
  background: var(--vp-c-brand-2);
}
</style>
