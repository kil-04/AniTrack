/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables (renderer/index.css) so one palette drives every
// screen, and the accent follows the mode: azure for anime, deep royal blue for manga.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ["./apps/desktop/index.html", "./apps/desktop/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: v("bg"),
          elev: v("bg-elev"),
          card: v("surface-1"),
        },
        surface: {
          1: v("surface-1"),
          2: v("surface-2"),
          3: v("surface-3"),
        },
        ink: {
          1: v("text"),
          2: v("text-2"),
          3: v("text-3"),
        },
        accent: {
          DEFAULT: v("accent"),
          hover: v("accent-hover"),
          deep: v("accent-2"),
          soft: "rgb(var(--accent) / 0.14)",
        },
        muted: v("muted"),
        line: "rgb(255 255 255 / 0.08)",
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "sans-serif"],
      },
      backgroundImage: {
        "accent-gradient": "linear-gradient(135deg, rgb(var(--accent-hover)) 0%, rgb(var(--accent)) 45%, rgb(var(--accent-2)) 100%)",
        "scrim-b": "linear-gradient(to top, rgb(var(--bg)) 0%, rgb(var(--bg) / 0.72) 38%, rgb(var(--bg) / 0) 100%)",
        "scrim-l": "linear-gradient(to right, rgb(var(--bg)) 0%, rgb(var(--bg) / 0.78) 34%, rgb(var(--bg) / 0) 72%)",
      },
      boxShadow: {
        glow: "0 10px 30px -10px rgb(var(--accent) / 0.65)",
        "glow-lg": "0 18px 50px -14px rgb(var(--accent) / 0.7)",
        card: "inset 0 1px 0 0 rgb(255 255 255 / 0.04), 0 14px 34px -16px rgb(0 0 0 / 0.75)",
        pop: "0 28px 70px -18px rgb(0 0 0 / 0.85), 0 0 0 1px rgb(255 255 255 / 0.06)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: 0, transform: "translateY(4px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
    },
  },
  plugins: [],
};
