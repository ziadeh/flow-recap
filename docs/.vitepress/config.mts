import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "FlowRecap Documentation",
  description: "Comprehensive documentation for FlowRecap - AI-Powered Meeting Notes & Transcription",

  // Base path for GitHub Pages deployment (use '/' for root or '/repo-name/' for subpath)
  base: '/flowrecap-docs/',

  // Last updated timestamp
  lastUpdated: true,

  // Clean URLs
  cleanUrls: true,

  // Theme configuration
  themeConfig: {
    // Site logo and title
    logo: '/logo.svg',
    siteTitle: 'FlowRecap Docs',

    // Navigation bar
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Setup', link: '/setup/BUILD' },
      { text: 'Features', link: '/features/FEATURE_IMPLEMENTATION_SUMMARY' },
      { text: 'Development', link: '/development/IMPLEMENTATION_NOTES' },
      { text: 'Troubleshooting', link: '/troubleshooting/WINDOWS_TROUBLESHOOTING' },
      { text: 'Guide Map', link: '/guide-map' }
    ],

    // Sidebar navigation matching docs/ structure
    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          collapsed: false,
          items: [
            { text: 'Introduction', link: '/' },
            { text: 'Quick Start', link: '/setup/BUILD' }
          ]
        },
        {
          text: 'Setup Guides',
          collapsed: false,
          items: [
            { text: 'Building FlowRecap', link: '/setup/BUILD' },
            { text: 'Python Bundling', link: '/setup/PYTHON_BUNDLING' },
            { text: 'Python Environment Architecture', link: '/setup/PYTHON_ENV_ARCHITECTURE' },
            { text: 'Rebuilding Python Bundle', link: '/setup/REBUILD_BUNDLE' },
            { text: 'Windows Local Setup', link: '/setup/WINDOWS_LOCAL_SETUP' }
          ]
        },
        {
          text: 'Feature Documentation',
          collapsed: false,
          items: [
            { text: 'Feature Summary', link: '/features/FEATURE_IMPLEMENTATION_SUMMARY' },
            { text: 'Speaker Diarization', link: '/features/SPEAKER_DIARIZATION' },
            { text: 'Speaker Diarization Fix', link: '/features/SPEAKER_DIARIZATION_FIX' },
            { text: 'LLM Post-Processing', link: '/features/LLM_POST_PROCESSING_INTEGRATION' },
            { text: 'Sentiment Preservation', link: '/features/SENTIMENT_PRESERVATION_VERIFICATION' }
          ]
        },
        {
          text: 'Development',
          collapsed: false,
          items: [
            { text: 'Implementation Notes', link: '/development/IMPLEMENTATION_NOTES' },
            { text: 'Console Output Guide', link: '/development/CONSOLE_OUTPUT' },
            { text: 'Manual Testing Checklist', link: '/development/MANUAL_TESTING_CHECKLIST' },
            { text: 'Performance Optimizations', link: '/development/PERFORMANCE_OPTIMIZATIONS_SUMMARY' },
            { text: 'Performance Testing', link: '/development/PERFORMANCE_TESTING' },
            { text: 'Quick Performance Guide', link: '/development/QUICK_PERFORMANCE_GUIDE' },
            { text: 'Windows Compatibility', link: '/development/WINDOWS_COMPATIBILITY_AUDIT' }
          ]
        },
        {
          text: 'Troubleshooting',
          collapsed: false,
          items: [
            { text: 'Windows Troubleshooting', link: '/troubleshooting/WINDOWS_TROUBLESHOOTING' },
            { text: 'Environment Warning Fix', link: '/troubleshooting/BUGFIX_ENVIRONMENT_WARNING' },
            { text: 'Bundle Fix Summary', link: '/troubleshooting/BUNDLE_FIX_SUMMARY' },
            { text: 'Bundled Python Fix', link: '/troubleshooting/BUNDLED_PYTHON_FIX' },
            { text: 'Python Bundle Fix', link: '/troubleshooting/PYTHON_BUNDLE_FIX' },
            { text: 'Test Validation Fix', link: '/troubleshooting/TEST_VALIDATION_FIX' },
            { text: 'Follow-Up Summary', link: '/troubleshooting/FOLLOW_UP_SUMMARY' }
          ]
        },
        {
          text: 'API Reference',
          collapsed: true,
          items: [
            { text: 'API Overview', link: '/api/' }
          ]
        },
        {
          text: 'Resources',
          collapsed: true,
          items: [
            { text: 'Documentation Map', link: '/guide-map' }
          ]
        }
      ]
    },

    // Built-in search (local search)
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        miniSearch: {
          // Configure search options
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
            boost: {
              title: 4,
              text: 2,
              tags: 1
            }
          }
        }
      }
    },

    // Social links
    socialLinks: [
      { icon: 'github', link: 'https://github.com/flowrecap/flowrecap' }
    ],

    // Edit this page link
    editLink: {
      pattern: 'https://github.com/flowrecap/flowrecap/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    // Footer
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 FlowRecap Team'
    },

    // Outline configuration (auto-generated TOC on the right)
    outline: {
      level: [2, 3],
      label: 'On this page'
    },

    // Document footer navigation
    docFooter: {
      prev: 'Previous',
      next: 'Next'
    },

    // Last updated text
    lastUpdatedText: 'Last updated',

    // Dark mode toggle
    darkModeSwitchLabel: 'Appearance',
    lightModeSwitchTitle: 'Switch to light theme',
    darkModeSwitchTitle: 'Switch to dark theme'
  },

  // Markdown configuration
  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },

  // Head configuration
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#5f67ee' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'FlowRecap Documentation' }]
  ],

  // Sitemap generation for SEO
  sitemap: {
    hostname: 'https://flowrecap.github.io/flowrecap-docs/'
  }
})
