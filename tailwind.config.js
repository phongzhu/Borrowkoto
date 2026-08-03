/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        canvas: '#f4efe6',
        ink: '#18212e',
        slate: '#5c6978',
        muted: '#8e98a5',
        line: '#d8dfde',
        panel: '#fffdf8',
        teal: {
          DEFAULT: '#1f6f63',
          soft: 'rgba(31,111,99,0.12)',
        },
        coral: {
          DEFAULT: '#c96a43',
          soft: 'rgba(201,106,67,0.12)',
        },
        amber: {
          DEFAULT: '#b98528',
          soft: 'rgba(185,133,40,0.12)',
        },
        sky: {
          DEFAULT: '#4b7f90',
          soft: 'rgba(75,127,144,0.12)',
        },
        success: '#34704a',
        warning: '#a66f22',
        danger: '#a94844',
        info: '#3f6d86',
      },
      fontFamily: {
        body: ['var(--ui-font-body)', 'Segoe UI', 'sans-serif'],
        display: ['var(--ui-font-display)', 'Segoe UI', 'sans-serif'],
        mono: ['var(--ui-font-mono)', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        soft: '0 20px 60px rgba(24, 33, 46, 0.08)',
        panel: '0 24px 80px rgba(24, 33, 46, 0.10)',
        button: '0 16px 34px rgba(24, 33, 46, 0.12)',
        card: '0 8px 24px rgba(24, 33, 46, 0.07)',
      },
      borderRadius: {
        sm: '16px',
        md: '24px',
        lg: '32px',
        pill: '999px',
      },
      maxWidth: {
        workspace: '1440px',
      },
    },
  },
  plugins: [],
};
