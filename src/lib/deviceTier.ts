/**
 * How much phone we are on, for Play (docs/PLAY-MODE.md section 17).
 *
 * "low" is a phone with 2 GB of memory or less, or one with data saver on. It
 * gets a lighter world: fewer pixels, no 3D city, a flatter camera, a slower
 * heartbeat, fewer crates, no ambient animation and no backdrop blur.
 * Browsers that do not report memory (Safari) are treated as "normal".
 * In development `?tier=low` forces the low tier so it can be looked at on a laptop.
 */
export type DeviceTier = "low" | "normal";

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

let cached: DeviceTier | null = null;

export function deviceTier(): DeviceTier {
  if (cached) return cached;
  if (typeof navigator === "undefined") return "normal";
  const nav = navigator as NavigatorHints;
  let tier: DeviceTier = "normal";
  if ((typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) || nav.connection?.saveData) tier = "low";
  if (process.env.NODE_ENV !== "production") {
    const forced = new URLSearchParams(window.location.search).get("tier");
    if (forced === "low" || forced === "normal") tier = forced;
  }
  cached = tier;
  return tier;
}

/** Everything Play tunes by tier, in one place. */
export function playTuning(tier: DeviceTier = deviceTier()) {
  const low = tier === "low";
  return {
    low,
    /** play_tick heartbeat, ms. */
    heartbeatMs: low ? 30_000 : 20_000,
    /** Camera tilt in Play, degrees. */
    pitch: low ? 30 : 55,
    /** Crates drawn at once. */
    maxCrates: low ? 12 : 24,
  };
}
