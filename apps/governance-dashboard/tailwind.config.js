/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ifr: {
          bg: "#0d0d1a",
          card: "#1a1a2e",
          input: "#16213e",
          border: "#2a2a4a",
          accent: "#ff4500",
          "accent-dim": "#cc3700",
          green: "#00c853",
          yellow: "#ffd600",
          red: "#ff1744",
          muted: "#888888",
        },
      },
    },
  },
  plugins: [],
};
