import type { Config } from "tailwindcss";

/**
 * Hoppaz tokens, from the design system draft (8 Oct 2026). Four tiers:
 *   1. orange (verb: tap me) and ember (the lip under a button)
 *   2. state colours: keke, lagoon, danfo, violet, fireant. Text, borders, dots
 *      and icons only, never a filled surface, one per card at most.
 *   3. grounds: ink (ground), ink-2 (raised), ink-3 (card), line (hairline),
 *      cream (text), dim (secondary text)
 *   4. illustration colours live inside artwork only.
 *
 * Tier 2 and 3 are CSS variables (globals.css) with a night set and a day set,
 * switched on <html data-theme> by the Lagos clock. The names are the night
 * names on purpose: "bg-ink" is the ground in either theme, "text-cream" is
 * the text colour in either theme. Use brand-ink / brand-cream when a colour
 * must never flip (a label on an orange button, a sign on the map).
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v("ground"), 2: v("raised"), 3: v("card") },
        line: v("hairline"),
        cream: v("text"),
        dim: v("dim"),
        orange: { DEFAULT: "#FF4D00", ember: "#B83600" },
        violet: v("violet"),
        keke: v("keke"),
        lagoon: v("lagoon"),
        danfo: v("danfo"),
        fireant: v("fireant"),
        ok: v("keke"),
        brand: { ink: "#0E0B0A", cream: "#F5EBDD", violet: "#5B2EFF" },
      },
      fontFamily: {
        display: ["var(--font-poppins)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        // "Noto Sans" sits in the stack so the naira sign always has a glyph:
        // DM Mono has no ₦, and browsers fall back per character.
        mono: ["var(--font-mono)", "ui-monospace", "Noto Sans", "Segoe UI", "monospace"],
      },
      borderRadius: {
        hz: "6px",
      },
      boxShadow: {
        chunk: "0 4px 0 #B83600",
        "chunk-sm": "0 2px 0 #B83600",
        sheet: "0 -14px 40px rgb(var(--shadow) / .55)",
      },
      keyframes: {
        // Stamp, not bounce: lands hard, a degree off square, no overshoot.
        stamp: {
          "0%": { opacity: "0", transform: "scale(1.35) rotate(-3deg)" },
          "100%": { opacity: "1", transform: "rotate(-1deg)" },
        },
        // Misregistration: a sheet rises with a violet ghost 6px off, then snaps.
        rise: { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
        misreg: {
          "0%": { boxShadow: "6px -6px 0 0 rgb(91 46 255 / .55)" },
          "100%": { boxShadow: "0 0 0 0 rgb(91 46 255 / 0)" },
        },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        pulse2: { "0%,100%": { opacity: ".12" }, "50%": { opacity: ".26" } },
      },
      animation: {
        stamp: "stamp .18s cubic-bezier(.2,.9,.3,1) both",
        // misreg has no fill mode, so the element's own shadow returns after it.
        rise: "rise .22s cubic-bezier(.2,.8,.2,1) both, misreg .12s linear .22s",
        pop: "fade .16s ease both",
        fade: "fade .16s ease both",
        pulse2: "pulse2 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
