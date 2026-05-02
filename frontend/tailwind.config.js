/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Numero brand purple ramp — derived from the logo's #5B3A9E.
        // Override default `purple` AND `violet` so existing class usages auto-pick brand colors.
        purple: {
          50:  "#F3EFFA",
          100: "#E5DCF4",
          200: "#CBB9E9",
          300: "#B197DE",
          400: "#8869C7",
          500: "#6F4DB7",
          600: "#5B3A9E",
          700: "#4A2D85",
          800: "#3A2169",
          900: "#2A164E",
        },
        violet: {
          50:  "#F3EFFA",
          100: "#E5DCF4",
          200: "#CBB9E9",
          300: "#B197DE",
          400: "#8869C7",
          500: "#6F4DB7",
          600: "#5B3A9E",
          700: "#4A2D85",
          800: "#3A2169",
          900: "#2A164E",
        },
        brand: {
          50:  "#F3EFFA",
          100: "#E5DCF4",
          200: "#CBB9E9",
          300: "#B197DE",
          400: "#8869C7",
          500: "#6F4DB7",
          600: "#5B3A9E",
          700: "#4A2D85",
          800: "#3A2169",
          900: "#2A164E",
          blue: "#2A7FB8",
          rose: "#B0456E",
          green:"#4FA88C",
          coral:"#D8896B",
        },
        navy: {
          800: "#1a1744",
          900: "#0f0c29",
        },
      },
      backgroundImage: {
        // Logo gradient: azure → deep purple → rose (darker so white text stays legible).
        "numero-gradient": "linear-gradient(135deg, #1B3D70 0%, #4A2D85 50%, #7A2F50 100%)",
        "query-gradient":  "linear-gradient(135deg, #5B3A9E 0%, #2A7FB8 100%)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
}

