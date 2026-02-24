/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ifr: {
          red: '#C0392B',
          dark: '#0d0d0d',
          card: '#141414',
          border: '#2a2a2a',
          muted: '#888888',
        }
      }
    },
  },
  plugins: [],
}
