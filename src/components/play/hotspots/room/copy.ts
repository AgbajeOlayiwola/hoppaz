import type { Band } from "./api";

/** The words of the room, in one place. Short, second person. */

export const RULES_LINE = "Be kind. No numbers or links. Report anything that feels off.";
export const REASONS = ["Harassment or threats", "Sexual or unwanted advances", "Spam or selling", "Hate or abuse", "Something else"];

/**
 * "Just you", "A few here", "12 here now". The server sends a number only from 3 up, and its bands count you, so
 * alone in a room it says "a few": `others` is how many heads you can see, and 0 with no number reads "Just you".
 */
export function hereText(band: Band, n: number | null, others: number | null = null) {
  if (n !== null) return band === "packed" ? `${n} here, packed` : `${n} here now`;
  if (others === 0) return "Just you";
  return band === "quiet" ? "Quiet right now" : "A few here";
}

/** The day total, only once it is a number worth saying. */
export const todayText = (n: number | null) => (n !== null ? `${n} today` : null);

export type Closed = { title: string; body: string; retry?: boolean };

/** Why the door did not open (enter_hotspot's reasons), or why the room shut under you. */
export function closedCopy(reason: string, place: string): Closed {
  switch (reason) {
    case "not_open":
      return { title: "Opening soon", body: `${place} is not open yet. Hotspots open in waves.` };
    case "paused":
      return { title: "Paused for now", body: `The crew paused ${place}. Try again a little later.` };
    case "full":
      return { title: "Packed right now", body: `${place} is full. Try the nearest other hotspot.` };
    case "slow_down":
      return { title: "Easy on the door", body: "You have hopped in and out a lot today. Try again tomorrow." };
    case "not_found":
      return { title: "No such hotspot", body: "That one is not on the map any more." };
    case "elsewhere":
      return { title: "You moved on", body: "Your avatar is in another hotspot, on another screen. One avatar, one place." };
    case "no_session":
      return { title: "One moment", body: "Still connecting. Try again.", retry: true };
    default:
      return { title: "Could not get in", body: "Check your connection and try again.", retry: true };
  }
}

/** The start of the line while the box rests ("Slow mode. Next message in 7s."). */
export const SLOW_GAP = "Slow mode. Next message in";

/**
 * A refused post: the line to show, and for the two speed rules how many seconds the box rests and what the
 * line says while it counts down ("counting" plus the seconds left).
 */
export function postProblem(message: string | undefined, slow: { seconds: number }): { text: string; wait?: number; counting?: string } {
  const m = message ?? "";
  const has = (code: string) => m.includes(code);
  if (has("need_account")) return { text: "Make an account to chat." };
  if (has("need_adult")) return { text: "Confirm you are 18 or older to chat." };
  if (has("room_closed")) return { text: "This hotspot is closed right now." };
  if (has("not_in_hotspot")) return { text: "You drifted out of the room. Getting you back in." };
  if (has("muted")) return { text: "You are muted here for now. You can read, not post." };
  if (has("too_long")) return { text: "Too long. Keep it under 240 characters." };
  if (has("no_links")) return { text: "No numbers or links in hotspots." };
  if (has("blocked_word")) return { text: "That message has a word that is not allowed here." };
  if (has("duplicate")) return { text: "You just said that." };
  if (has("slow_mode")) return { text: `Slow mode. One message every ${slow.seconds || 10} seconds.`, wait: slow.seconds || 10, counting: SLOW_GAP };
  if (has("slow_down")) return { text: "Easy. Too many messages. Try again in a few seconds.", wait: 8, counting: "Easy. Too many messages. Try again in" };
  if (has("empty")) return { text: "" };
  return { text: "That did not send. Try again." };
}

/** report_hotspot's answers, as a line for the toast. */
export function reportCopy(reason: string | null) {
  switch (reason) {
    case null:
      return { text: "Reported. The Hoppaz crew will look at it.", ok: true };
    case "already":
      return { text: "You already reported them today. The crew has it.", ok: true };
    case "self":
      return { text: "That is you.", ok: false };
    case "gone":
      return { text: "They have left. Nothing to report.", ok: false };
    case "slow_down":
      return { text: "That is a lot of reports today. Try again tomorrow.", ok: false };
    case "not_in_hotspot":
      return { text: "You are not in the room any more.", ok: false };
    default:
      return { text: "Could not send the report. Try again.", ok: false };
  }
}
