/** Box tiers by colour: Common cream, Rare violet, Epic pink, Legendary gold. */
export type PlayTier = "common" | "rare" | "epic" | "legendary";

/**
 * One of the Hopper's own boxes on the Play map, as play_tick returns it
 * (docs/PLAY-API.md). `needsPresence` false means send the avatar (small boxes,
 * welcome A and B); true means walk there (welcome C, and the special box later).
 */
export type PlayBox = {
  /** The game_drops id, for claim_game_drop. */
  id: string;
  /** "near" is a small box; "welcome"; later "special". */
  kind: string;
  tier: PlayTier;
  lat: number;
  lng: number;
  closesAt: string;
  needsPresence: boolean;
  /** Welcome boxes only: A is the four-box reveal, B is the second run, C needs the walk. */
  slot: "a" | "b" | "c" | null;
};

/** The bits of play_tick that are not boxes. */
export type PlayInfo = {
  /** 21:00 to 06:00 Lagos: boxes sit closer. */
  night: boolean;
  playDay: string | null;
  /** Small boxes still to open today. Null before the first answer. */
  smallLeft: number | null;
  welcomeLeft: number;
};

/** Why a heartbeat was turned down, for the ones the shell acts on. */
export type TickRefusal = "need_account" | "outside_lagos" | "location_required" | null;
