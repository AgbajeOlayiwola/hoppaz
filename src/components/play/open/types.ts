export type OpenTier = "common" | "rare" | "epic" | "legendary";

/** What the claim gives back. Mirrors claim_game_drop, mapped by the shell. */
export type ClaimOk = { ok: true; xp: number; title?: string; collectible?: { key: string; name: string } };
export type ClaimRefused = { ok: false; reason: string; message: string };
export type ClaimResult = ClaimOk | ClaimRefused;

/** Where the things fly to, as screen rects (getBoundingClientRect). A null rect falls back to where the HUD normally sits. */
export type OpenTargets = { xp: DOMRect | null; shelf: DOMRect | null; pips: DOMRect | null };

/** What a landing item was, for the shell to tick its own counters. */
export type LandKind = "xp" | "collectible" | "stamp";

/** The hooks the later intro (Paz the Conductor) listens to. */
export type OpenEvent =
  | { type: "open-start"; tier: OpenTier }
  | { type: "open-claimed"; tier: OpenTier; result: ClaimResult }
  | { type: "open-burst"; tier: OpenTier }
  | { type: "open-done"; tier: OpenTier; result: ClaimResult }
  | { type: "open-cancel"; tier: OpenTier };
