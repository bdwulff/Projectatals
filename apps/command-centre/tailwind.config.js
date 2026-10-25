/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        ink: { 950: "#06080c", 900: "#0a0d14", 800: "#10151f", 700: "#171e2b" },
        accent: { DEFAULT: "#22d3ee", soft: "#67e8f9", dim: "#0e7490" },
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
