import type { OpenTier } from "./types";

/** Tier colours and the sounds' lengths. Common cream, Rare violet, Epic pink, Legendary gold. */
export const TIER: Record<
  OpenTier,
  { name: string; c: string; t: string; l: string; r: string; bg: string; tape: string; shekere: number }
> = {
  common: { name: "Common", c: "#C9B9A3", t: "#E4D8C6", l: "#C9B9A3", r: "#9C8E7B", bg: "#2a231d", tape: "#B83600", shekere: 600 },
  rare: { name: "Rare", c: "#5B2EFF", t: "#8A66FF", l: "#5B2EFF", r: "#3A1CB5", bg: "#1f1457", tape: "#F5EBDD", shekere: 900 },
  epic: { name: "Epic", c: "#E83F6F", t: "#F2739A", l: "#E83F6F", r: "#A82650", bg: "#4a1228", tape: "#F5EBDD", shekere: 1300 },
  legendary: { name: "Legendary", c: "#F4B728", t: "#FFD966", l: "#F4B728", r: "#B9830F", bg: "#3d2a05", tape: "#F5EBDD", shekere: 1800 },
};

/** How big the crate is on the map next to a Common one (the stage starts the rise from this size). */
export const MAP_SCALE: Record<OpenTier, number> = { common: 1, rare: 1, epic: 1.12, legendary: 1.4 };
