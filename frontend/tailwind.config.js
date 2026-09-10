/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#0b1020',
        panel: '#121a2f',
        panel2: '#192442',
      },
    },
  },
  plugins: [],
  corePlugins: { preflight: false },
}
