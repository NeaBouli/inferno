/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ifr: {
          red: '#C0392B',
          green: '#27AE60',
          orange: '#E67E22',
        },
      },
    },
  },
  plugins: [],
};
