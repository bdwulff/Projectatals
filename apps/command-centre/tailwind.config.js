/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        ink: { 950: "#060c10", 900: "#0a131b", 800: "#101e28", 700: "#172b37" },
        accent: { DEFAULT: "#7de8f3", soft: "#a1edf5", dim: "#397c8b" },
        warn: { DEFAULT: "#f59e0b", soft: "#fbbf24" },
        danger: { DEFAULT: "#ef4444", soft: "#f87171" },
        ok: { DEFAULT: "#34d399", soft: "#6ee7b7" },
      },
      boxShadow: {
        glass: "inset 0 1px 0 0 rgba(255,255,255,0.06), 0 10px 40px -10px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(34,211,238,0.25), 0 0 24px -4px rgba(34,211,238,0.35)",
      },
      backdropBlur: { xs: "2px" },
    },
  },
  plugins: [],
};
