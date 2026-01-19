---
title: Documentation Map
description: Visual guide showing how FlowRecap documentation relates to each other
tags:
  - guide
  - map
  - navigation
  - overview
  - learning-path
lastUpdated: true
---

# Documentation Map

This page provides a visual overview of how different documentation guides relate to each other and suggests learning paths for different user roles.

## Learning Paths

### For New Users

If you're just getting started with FlowRecap:

1. **Start Here**: [Building FlowRecap](/setup/BUILD) - Get FlowRecap running on your machine
2. **Next**: [Python Environment Architecture](/setup/PYTHON_ENV_ARCHITECTURE) - Understand the ML backend
3. **Then**: [Feature Summary](/features/FEATURE_IMPLEMENTATION_SUMMARY) - Learn what FlowRecap can do
4. **Finally**: [Windows Troubleshooting](/troubleshooting/WINDOWS_TROUBLESHOOTING) or check for any issues

### For Developers

If you want to contribute to FlowRecap:

1. **Start Here**: [Building FlowRecap](/setup/BUILD) - Set up your development environment
2. **Next**: [Implementation Notes](/development/IMPLEMENTATION_NOTES) - Understand the architecture
3. **Then**: [Manual Testing Checklist](/development/MANUAL_TESTING_CHECKLIST) - Learn QA procedures
4. **Reference**: [Performance Testing](/development/PERFORMANCE_TESTING) - Ensure quality

### For ML/AI Integration

If you're working on the ML features:

1. **Start Here**: [Python Bundling](/setup/PYTHON_BUNDLING) - Understand Python integration
2. **Next**: [Speaker Diarization](/features/SPEAKER_DIARIZATION) - Core ML feature
3. **Then**: [LLM Post-Processing](/features/LLM_POST_PROCESSING_INTEGRATION) - AI enhancements
4. **Troubleshoot**: [Python Bundle Fix](/troubleshooting/PYTHON_BUNDLE_FIX) - If you hit issues

### For Windows Users

If you're running FlowRecap on Windows:

1. **Start Here**: [Windows Local Setup](/setup/WINDOWS_LOCAL_SETUP) - Windows-specific setup
2. **Reference**: [Windows Compatibility Audit](/development/WINDOWS_COMPATIBILITY_AUDIT) - Known issues
3. **Troubleshoot**: [Windows Troubleshooting](/troubleshooting/WINDOWS_TROUBLESHOOTING) - Solutions

## Documentation Relationships

```
                    ┌─────────────────────────────┐
                    │      Getting Started        │
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │    BUILD.md           │  │
                    │  │    (Entry Point)      │  │
                    │  └───────────┬───────────┘  │
                    └──────────────┼──────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
          ┌─────────▼─────────┐       ┌──────────▼──────────┐
          │   Python Setup    │       │    Feature Docs     │
          │                   │       │                     │
          │ PYTHON_BUNDLING   │       │ SPEAKER_DIARIZATION │
          │ PYTHON_ENV_ARCH   │       │ LLM_POST_PROC       │
          │ REBUILD_BUNDLE    │       │ SENTIMENT_PRES      │
          └─────────┬─────────┘       └──────────┬──────────┘
                    │                            │
                    │     ┌──────────────────────┘
                    │     │
          ┌─────────▼─────▼─────────┐
          │    Development          │
          │                         │
          │ IMPLEMENTATION_NOTES    │
          │ CONSOLE_OUTPUT          │
          │ PERFORMANCE_TESTING     │
          │ MANUAL_TESTING          │
          └─────────┬───────────────┘
                    │
          ┌─────────▼───────────────┐
          │   Troubleshooting       │
          │                         │
          │ WINDOWS_TROUBLESHOOTING │
          │ PYTHON_BUNDLE_FIX       │
          │ BUNDLE_FIX_SUMMARY      │
          └─────────────────────────┘
```

## Cross-Reference Table

This table shows which documents reference each other:

| Document | Related Documents |
|----------|-------------------|
| [BUILD.md](/setup/BUILD) | [PYTHON_BUNDLING](/setup/PYTHON_BUNDLING), [WINDOWS_LOCAL_SETUP](/setup/WINDOWS_LOCAL_SETUP) |
| [PYTHON_BUNDLING](/setup/PYTHON_BUNDLING) | [PYTHON_ENV_ARCHITECTURE](/setup/PYTHON_ENV_ARCHITECTURE), [REBUILD_BUNDLE](/setup/REBUILD_BUNDLE), [PYTHON_BUNDLE_FIX](/troubleshooting/PYTHON_BUNDLE_FIX) |
| [PYTHON_ENV_ARCHITECTURE](/setup/PYTHON_ENV_ARCHITECTURE) | [PYTHON_BUNDLING](/setup/PYTHON_BUNDLING), [PYTHON_BUNDLE_FIX](/troubleshooting/PYTHON_BUNDLE_FIX) |
| [SPEAKER_DIARIZATION](/features/SPEAKER_DIARIZATION) | [SPEAKER_DIARIZATION_FIX](/features/SPEAKER_DIARIZATION_FIX), [LLM_POST_PROCESSING](/features/LLM_POST_PROCESSING_INTEGRATION) |
| [LLM_POST_PROCESSING](/features/LLM_POST_PROCESSING_INTEGRATION) | [SPEAKER_DIARIZATION](/features/SPEAKER_DIARIZATION), [SENTIMENT_PRESERVATION](/features/SENTIMENT_PRESERVATION_VERIFICATION) |
| [WINDOWS_LOCAL_SETUP](/setup/WINDOWS_LOCAL_SETUP) | [WINDOWS_TROUBLESHOOTING](/troubleshooting/WINDOWS_TROUBLESHOOTING), [WINDOWS_COMPATIBILITY](/development/WINDOWS_COMPATIBILITY_AUDIT) |
| [PERFORMANCE_TESTING](/development/PERFORMANCE_TESTING) | [PERFORMANCE_OPTIMIZATIONS](/development/PERFORMANCE_OPTIMIZATIONS_SUMMARY), [QUICK_PERFORMANCE_GUIDE](/development/QUICK_PERFORMANCE_GUIDE) |

## Document Categories

### By Difficulty Level

**Beginner**
- [Building FlowRecap](/setup/BUILD)
- [Quick Performance Guide](/development/QUICK_PERFORMANCE_GUIDE)
- [Follow-Up Summary](/troubleshooting/FOLLOW_UP_SUMMARY)

**Intermediate**
- [Python Environment Architecture](/setup/PYTHON_ENV_ARCHITECTURE)
- [Speaker Diarization](/features/SPEAKER_DIARIZATION)
- [Manual Testing Checklist](/development/MANUAL_TESTING_CHECKLIST)

**Advanced**
- [Python Bundle Fix](/troubleshooting/PYTHON_BUNDLE_FIX)
- [LLM Post-Processing Integration](/features/LLM_POST_PROCESSING_INTEGRATION)
- [Windows Compatibility Audit](/development/WINDOWS_COMPATIBILITY_AUDIT)

### By Platform

**Cross-Platform**
- [Building FlowRecap](/setup/BUILD)
- [Python Bundling](/setup/PYTHON_BUNDLING)
- [Feature Documentation](/features/FEATURE_IMPLEMENTATION_SUMMARY)

**Windows-Specific**
- [Windows Local Setup](/setup/WINDOWS_LOCAL_SETUP)
- [Windows Compatibility Audit](/development/WINDOWS_COMPATIBILITY_AUDIT)
- [Windows Troubleshooting](/troubleshooting/WINDOWS_TROUBLESHOOTING)

**macOS/Linux-Specific**
- Most setup guides with macOS/Linux specific instructions in [BUILD.md](/setup/BUILD)

## Need Help?

- **Can't find what you need?** Use the search bar (press <kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>Cmd</kbd>+<kbd>K</kbd>)
- **Still stuck?** Check the [Troubleshooting](/troubleshooting/WINDOWS_TROUBLESHOOTING) section
- **Found an issue?** Report it on [GitHub Issues](https://github.com/flowrecap/flowrecap/issues)
