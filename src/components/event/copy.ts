/**
 * Small copy helpers for the event page.
 *
 * A few hooks outside this surface (quests, drops, collectibles) still hand
 * back SHOUTING one-liners. The toast is a plain card now, so they are read
 * back in sentence case, and the ones that only make sense on a developer's
 * screen are turned into something a Hopper can act on.
 */

const FRIENDLY: Array<[RegExp, string]> = [
  [/^NOT CONNECTED/, "Can't reach that right now. Try again in a bit."],
  [/^SET YOUR LOCATION/, "Set your location first."],
  [/^GET CLOSER/, "Get closer to the venue."],
  [/^TURN ON LOCATION/, "Turn on location to open it."],
  [/^COULD NOT (CLAIM|COLLECT|COMPLETE)/, "That didn't go through. Try again."],
  [/^QUEST NOT READY/, "That one isn't ready yet."],
  [/^THIS COLLECTIBLE IS CLOSED/, "This drop is closed."],
];

/** "DROP IS CLOSED" -> "Drop is closed.", "WAVE SENT. IF THEY..." -> "Wave sent. If they...", QR kept as QR. */
export function sentence(raw: string) {
  const hit = FRIENDLY.find(([re]) => re.test(raw));
  if (hit) return hit[1];
  const t = raw.replace(/\s*·\s*/g, ". ").trim();
  const lower = t.toLowerCase().replace(/\bqr\b/g, "QR").replace(/\bxp\b/g, "XP");
  const s = lower.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase());
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Reads a legacy one-liner as done (true) or not. */
export const looksDone = (raw: string) => /COMPLETE|SUBMITTED|ADDED|CLAIMED|OPENED/.test(raw);
