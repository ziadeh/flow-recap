/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // Custom breakpoints matching feature requirements
    // Mobile: < 768px, Tablet: 768-1024px, Desktop: > 1024px
    screens: {
      'sm': '640px',      // small mobile landscape
      'md': '768px',      // tablet breakpoint
      'lg': '1024px',     // desktop breakpoint
      'xl': '1280px',     // large desktop
      '2xl': '1536px',    // extra large desktop
    },
    extend: {
      // Design token system for consistent spacing
      // Spacing scale: xs=4px, sm=8px, md=12px, lg=16px, xl=24px, 2xl=32px
      spacing: {
        'token-xs': 'var(--spacing-xs)',   // 4px - minimal spacing
        'token-sm': 'var(--spacing-sm)',   // 8px - row spacing, button padding
        'token-md': 'var(--spacing-md)',   // 12px - section spacing, header margin
        'token-lg': 'var(--spacing-lg)',   // 16px - card padding, max section gap
        'token-xl': 'var(--spacing-xl)',   // 24px - primary action icon size
        'token-2xl': 'var(--spacing-2xl)', // 32px - large spacing
        'touch': '44px',                   // minimum touch target size (44px)
      },
      // Minimum height for touch targets (44px per WCAG guidelines)
      minHeight: {
        'touch': '44px',
      },
      minWidth: {
        'touch': '44px',
      },
      // Border radius tokens
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
        'token': 'var(--radius-md)', // default token radius = 8px
      },
      // Box shadow tokens for elevation
      boxShadow: {
        'subtle': 'var(--shadow-subtle)',      // elevation level 1
        'medium': 'var(--shadow-medium)',      // elevation level 2
        'elevated': 'var(--shadow-elevated)',  // elevation level 3
      },
      // Icon size tokens
      fontSize: {
        'icon-inline': ['1rem', { lineHeight: '1' }],     // 16px for inline icons
        'icon-primary': ['1.5rem', { lineHeight: '1' }],  // 24px for primary action icons
      },
      keyframes: {
        "slide-in-fade": {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "slide-in-fade": "slide-in-fade 0.5s ease-out",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
    },
  },
  plugins: [],
}
