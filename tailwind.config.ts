import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        blue: '#2563eb',
        'blue-dk': '#1d4ed8',
        'blue-lt': '#eff6ff',
        teal: '#0891b2',
        green: '#059669',
        danger: '#dc2626',
        background: '#f8fafc',
        card: '#ffffff',
        text: '#0f172a',
        text2: '#475569',
        text3: '#94a3b8',
        primary: '#10b981',
      },
      borderRadius: {
        sm: '8px',
        base: '12px',
        lg: '16px',
        xl: '20px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in':     'fadeIn 150ms ease',
        'modal-enter': 'modalEnter 200ms ease-out',
        'slide-up':    'slideUp 250ms ease-out',
      },
      keyframes: {
        fadeIn:     { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        modalEnter: { '0%': { opacity: '0', transform: 'scale(0.97)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        slideUp:    { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}

export default config
