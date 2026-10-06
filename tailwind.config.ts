import type { Config } from "tailwindcss";

/**
 * Hoppaz brand tokens. Never a fifth colour.
 * Ratio to aim for across a screen: black 60 / orange 25 / cream 10 / violet 5.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0E0B0A", 2: "#17110F", 3: "#231915" },
        orange: { DEFAULT: "#FF4D00", ember: "#B83600" },
        cream: "#F5EBDD",
        violet: "#5B2EFF",
        dim: "#8A7C73",
        line: "#2E211C",
        ok: "#49D07A",
      },
      fontFamily: {
        display: ["var(--font-poppins)", "system-ui", "sans-serif"],
        // "Noto Sans" sits in the stack so the naira sign always has a glyph:
        // Space Mono has no ₦, and browsers fall back per character.
        mono: ["var(--font-mono)", "ui-monospace", "Noto Sans", "Segoe UI", "monospace"],
      },
      boxShadow: {
        chunk: "0 4px 0 #B83600",
        "chunk-sm": "0 2px 0 #B83600",
        sheet: "0 -14px 40px rgba(0,0,0,.6)",
      },
      keyframes: {
        pop: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        pulse2: { "0%,100%": { opacity: ".12" }, "50%": { opacity: ".26" } },
        rise: { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
      },
      animation: {
        pop: "pop .24s ease both",
        pulse2: "pulse2 2.6s ease-in-out infinite",
        rise: "rise .26s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
