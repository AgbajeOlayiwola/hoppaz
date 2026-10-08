/**
 * Hoppaz brand tokens (the fixed ones). The tier 2 state colours (keke, lagoon,
 * danfo, violet, fireant) and the night/day grounds live in tailwind.config.ts
 * and globals.css, because they flip with the theme.
 */
export const BRAND = {
  ink: "#0E0B0A",
  ink2: "#17110F",
  ink3: "#231915",
  orange: "#FF4D00",
  ember: "#B83600",
  cream: "#F5EBDD",
  violet: "#5B2EFF",
  dim: "#8A7C73",
  line: "#2E211C",
} as const;

export const VIBES = [
  "afro",
  "amapiano",
  "rave",
  "techno",
  "live band",
  "comedy",
  "beach",
  "rooftop",
  "food",
  "culture",
  "tech",
] as const;

export type Vibe = (typeof VIBES)[number];

/**
 * XP ladder: the big level name on Me.
 *
 * The names are PROPOSED and pending Jae's final sign-off (UI-REFRESH-PLAN.md,
 * open item 1): JJC, Regular, Plug, Oga, Agba. Thresholds are unchanged.
 * Hopper and Captain are NOT XP levels. They are the bus status (see
 * statusFor below): join and you are a Hopper, four Hop badges and you are a
 * Captain.
 */
export const LEVELS: ReadonlyArray<readonly [number, string]> = [
  [0, "JJC"],
  [100, "REGULAR"],
  [320, "PLUG"],
  [700, "OGA"],
  [1400, "AGBA"],
];

export function levelFor(xp: number) {
  let i = 0;
  LEVELS.forEach(([min], k) => {
    if (xp >= min) i = k;
  });
  const next = LEVELS[i + 1];
  return {
    index: i,
    name: LEVELS[i][1],
    next: next ? next[1] : null,
    /** XP still needed for the next level; 0 at the top. */
    toNext: next ? Math.max(0, next[0] - xp) : 0,
    progress: next ? (xp - LEVELS[i][0]) / (next[0] - LEVELS[i][0]) : 1,
  };
}

/** Hop badges it takes to become a Captain. */
export const CAPTAIN_HOPS = 4;

/** The bus status, shown as a small label next to the level: everyone starts as a Hopper. */
export function statusFor(hopBadges: number): "HOPPER" | "CAPTAIN" {
  return hopBadges >= CAPTAIN_HOPS ? "CAPTAIN" : "HOPPER";
}

/**
 * The built-in badges. `icon` is the name of a lucide-react line icon (no emoji
 * anywhere); the badge shelf maps the name to the component. A badge that only
 * exists in the database falls back to the generic Hoppaz stamp.
 */
export const BADGES: ReadonlyArray<{ key: string; icon: string; name: string; how: string }> = [
  { key: "mainland", icon: "Building2", name: "Mainland", how: "Check in anywhere on the mainland" },
  { key: "island", icon: "Palmtree", name: "Island", how: "Check in across a bridge" },
  { key: "latenight", icon: "Moon", name: "After 11", how: "Check in at something starting after 11pm" },
  { key: "free", icon: "Ticket", name: "No gate fee", how: "Check in at a free event" },
  { key: "comedy", icon: "Mic", name: "Comedy", how: "Check in at a comedy night" },
  { key: "beach", icon: "Waves", name: "Beach", how: "Check in at a beach party" },
  { key: "dropper", icon: "MapPinned", name: "Flyer poster", how: "Post a flyer that goes live" },
  { key: "hop", icon: "Bus", name: "On the bus", how: "Check in at a stop on an official Hop" },
];
