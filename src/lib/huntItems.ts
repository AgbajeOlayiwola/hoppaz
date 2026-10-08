/**
 * The camera-hunt collectibles: 3D items hidden at events. A Hopper at the
 * event finds one through their camera and claims the drop's reward with it.
 *
 * This file is the catalogue only (names, rarity, XP, copy), so screens that
 * list items never load three.js. The models are in huntModels.ts, loaded on
 * demand by <Hunt3D>. Keys match the check on game_drops.hunt_item in
 * supabase/hunt_items.sql; add a key in both places.
 */

export type Rarity = "common" | "rare" | "epic" | "legendary";

export type HuntItem = {
  key: HuntKey;
  name: string;
  rarity: Rarity;
  /** Default XP when a drop is placed with this item. */
  xp: number;
  blurb: string;
  /** Shown when WebGL is not available. */
  emoji: string;
};

export const HUNT_KEYS = ["golden-danfo", "jollof-pot", "gangan-drum", "golden-cowrie", "eko-disco-ball"] as const;
export type HuntKey = (typeof HUNT_KEYS)[number];

export const HUNT_ITEMS: Record<HuntKey, HuntItem> = {
  "golden-danfo": {
    key: "golden-danfo",
    name: "Golden Danfo",
    rarity: "legendary",
    xp: 400,
    blurb: "The yellow bus that runs Lagos, dipped in gold. Conductor not included.",
    emoji: "🚌",
  },
  "jollof-pot": {
    key: "jollof-pot",
    name: "Party Jollof Pot",
    rarity: "common",
    xp: 50,
    blurb: "Smoky party jollof, straight off the firewood. Every owambe has one.",
    emoji: "🍲",
  },
  "gangan-drum": {
    key: "gangan-drum",
    name: "Gangan Talking Drum",
    rarity: "rare",
    xp: 100,
    blurb: "Squeeze the cords and it talks. The drummer always knows your name.",
    emoji: "🪘",
  },
  "golden-cowrie": {
    key: "golden-cowrie",
    name: "Golden Cowrie",
    rarity: "epic",
    xp: 200,
    blurb: "Money before money. Old Lagos traded on these; you found a gold one.",
    emoji: "🐚",
  },
  "eko-disco-ball": {
    key: "eko-disco-ball",
    name: "Eko Disco Ball",
    rarity: "rare",
    xp: 100,
    blurb: "Every Island rooftop has one spinning somewhere. This one followed you home.",
    emoji: "🪩",
  },
};

export const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: "COMMON", color: "#C9B9A3" },
  rare: { label: "RARE", color: "#5B2EFF" },
  epic: { label: "EPIC", color: "#E83F6F" },
  legendary: { label: "LEGENDARY", color: "#F4B728" },
};

export const huntItem = (key: string | null | undefined): HuntItem | null =>
  key && (HUNT_KEYS as readonly string[]).includes(key) ? HUNT_ITEMS[key as HuntKey] : null;
