/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      colors: {
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        brand: {
          pri: 'rgb(var(--accent-sun) / <alpha-value>)',
          ok: 'rgb(var(--accent-mint) / <alpha-value>)',
          warn: 'rgb(var(--accent-peach) / <alpha-value>)',
          err: 'rgb(var(--accent-rose) / <alpha-value>)',
          info: 'rgb(var(--accent-sky) / <alpha-value>)',
          violet: 'rgb(var(--accent-sky) / <alpha-value>)',
        },
      },
      borderColor: {
        DEFAULT: 'rgb(var(--ink) / 0.12)',
      },
      borderRadius: {
        card: '18px',
        pill: '999px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-hover)',
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
