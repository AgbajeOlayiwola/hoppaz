/** Hoppaz brand tokens. Never a fifth colour. */
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

/** XP ladder. The Badge ladder (Hopper to Captain) is separate and rides on Hops. */
export const LEVELS: ReadonlyArray<readonly [number, string]> = [
  [0, "ROOKIE"],
  [100, "HOPPER"],
  [320, "NIGHT RUNNER"],
  [700, "BRIDGE RAT"],
  [1400, "CAPTAIN"],
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
    progress: next ? (xp - LEVELS[i][0]) / (next[0] - LEVELS[i][0]) : 1,
  };
}

export const BADGES: ReadonlyArray<{ key: string; icon: string; name: string; how: string }> = [
  { key: "mainland", icon: "🌉", name: "Mainland", how: "Check in anywhere on the mainland" },
  { key: "island", icon: "🌴", name: "Island", how: "Check in across a bridge" },
  { key: "latenight", icon: "🌙", name: "After 11", how: "Check in at something starting after 11pm" },
  { key: "free", icon: "🎟", name: "No gate fee", how: "Check in at a free event" },
  { key: "comedy", icon: "🎤", name: "Comedy", how: "Check in at a comedy night" },
  { key: "beach", icon: "🏖", name: "Beach", how: "Check in at a beach party" },
  { key: "dropper", icon: "📌", name: "Flyer drop", how: "Drop a flyer that goes live" },
  { key: "hop", icon: "🚌", name: "On the bus", how: "Check in at a stop on an official Hop" },
];
