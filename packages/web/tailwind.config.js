/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      /**
       * Custom color palette for Gravity game
       * Based on reference images showing zone and section colors
       */
      colors: {
        // Ring zone colors (from outer to inner)
        zone: {
          green: '#22c55e',      // Rings 7-8: Safe/escape zone
          yellow: '#eab308',     // Rings 5-6: Caution
          orange: '#f97316',     // Rings 3-4: Danger
          red: '#ef4444',        // Rings 1-2: Critical
          void: '#0a0a0a',       // Center: Black hole
        },
        // Ship section colors (from reference image 2)
        section: {
          'med-lab': '#facc15',    // Yellow - Medical Lab
          bridge: '#3b82f6',       // Blue - Bridge
          'sci-lab': '#22c55e',    // Green - Science Lab
          drive: '#60a5fa',        // Light blue - Drive
          engineering: '#f97316',  // Orange - Engineering
          defense: '#ef4444',      // Red - Defense
        },
        // Crew role colors (from reference image 1)
        crew: {
          captain: '#0ea5e9',     // Cyan/teal
          tactician: '#ef4444',   // Red
          pilot: '#60a5fa',       // Light blue
          medic: '#84cc16',       // Lime green
          engineer: '#f97316',    // Orange
          scientist: '#22c55e',   // Green
          officer: '#a3a3a3',     // Gray (generic officer)
        },
        // UI chrome colors
        gravity: {
          bg: '#0f172a',          // Dark slate background
          surface: '#1e293b',     // Elevated surface
          border: '#334155',      // Border color
          text: '#f8fafc',        // Primary text
          muted: '#94a3b8',       // Muted text
          accent: '#3b82f6',      // Accent blue
        },
        // Resource colors
        resource: {
          'med-kit': '#facc15',   // Yellow cross
          'spare-parts': '#f97316', // Orange hexagon
          probe: '#22c55e',       // Green diamond
          torpedo: '#ef4444',     // Red triangle
          'power-cell': '#60a5fa', // Blue
        },
      },
      // Custom animations for game effects
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'rotate-slow': 'spin 20s linear infinite',
        'spin-slow': 'spin 30s linear infinite',
        'spin-reverse': 'spin-reverse 25s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'scan-line': 'scan-line 3s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'beacon': 'beacon 2s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px currentColor' },
          '100%': { boxShadow: '0 0 20px currentColor, 0 0 30px currentColor' },
        },
        'spin-reverse': {
          '0%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(0deg)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        beacon: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.15)' },
        },
      },
      // Board dimensions
      spacing: {
        'board': '600px',
        'dashboard': '400px',
      },
    },
  },
  plugins: [],
};
