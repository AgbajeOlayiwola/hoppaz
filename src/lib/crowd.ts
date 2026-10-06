import { clockShort } from "./geo";
import type { EventRow } from "./types";

/**
 * How busy an event is at a given moment, 0 to 100.
 *
 * Two inputs, kept apart on purpose:
 *  - live: check-ins in the last three hours (here_now). Real people, real
 *    place. Only used for "now".
 *  - expected: the event's heat (seeded popularity + swipes in + check-ins)
 *    shaped by a typical Lagos night: quiet before doors, builds for two hours
 *    after the start, holds, then thins out.
 * The map labels the second one EXPECTED so nobody mistakes a guess for a crowd.
 */

const HOUR = 3.6e6;

function nightCurve(hoursSinceStart: number) {
  const h = hoursSinceStart;
  if (h < -1.5) return 0.04;
  if (h < 0) return 0.04 + ((h + 1.5) / 1.5) * 0.3;
  if (h < 2) return 0.34 + (h / 2) * 0.66;
  if (h < 4) return 1 - ((h - 2) / 2) * 0.45;
  if (h < 6) return 0.55 - ((h - 4) / 2) * 0.5;
  return 0.03;
}

export function crowdAt(e: EventRow, at: number, live: boolean): number {
  const expected = e.heat * nightCurve((at - Date.parse(e.starts_at)) / HOUR);
  const real = live ? Math.min(100, (e.here_now ?? 0) * 8) : 0;
  return Math.round(Math.min(100, Math.max(expected, real)));
}

export type CrowdTone = "hot" | "warm" | "mild" | "cold";

export function crowdLevel(e: EventRow, at: number, score: number): { label: string; tone: CrowdTone } {
  if (at < Date.parse(e.starts_at) - 1.5 * HOUR) return { label: `STARTS ${clockShort(e.starts_at)}`, tone: "cold" };
  if (score >= 60) return { label: "POPPING", tone: "hot" };
  if (score >= 35) return { label: "BUILDING", tone: "warm" };
  if (score >= 12) return { label: "WARMING UP", tone: "mild" };
  return { label: "QUIET", tone: "cold" };
}

export const TONE_HEX: Record<CrowdTone, string> = {
  hot: "#FF4D00",
  warm: "#B83600",
  mild: "#F5EBDD",
  cold: "#8A7C73",
};

/** The time strip: now, then every two hours across the night the events are on. */
export function timeSlots(events: EventRow[], now = Date.now()): Array<{ at: number; label: string; live: boolean }> {
  const upcoming = events
    .map((e) => Date.parse(e.starts_at))
    .filter((t) => t > now - 6 * HOUR)
    .sort((a, b) => a - b);
  // Centre the strip on the night's typical door time, not its earliest (a 4pm
  // beach party would drag the whole strip into the afternoon and miss the peak).
  const typical = upcoming.length ? upcoming[Math.floor(upcoming.length / 2)] : now;
  let base = Math.max(now, typical - 2 * HOUR);
  base = Math.ceil(base / HOUR) * HOUR;
  const sameDay = (a: number, b: number) =>
    new Date(a + HOUR).toISOString().slice(0, 10) === new Date(b + HOUR).toISOString().slice(0, 10); // Lagos is UTC+1
  const slots = [{ at: now, label: "NOW", live: true }];
  for (let i = 0; i < 5; i++) {
    const at = base + i * 2 * HOUR;
    const clock = clockShort(new Date(at).toISOString());
    const day = new Date(at).toLocaleDateString("en-NG", { weekday: "short", timeZone: "Africa/Lagos" }).toUpperCase();
    slots.push({ at, label: i === 0 && !sameDay(at, now) ? `${day} ${clock}` : clock, live: false });
  }
  return slots;
}

/** Expected crowd for each hour of the event's night, for the card's little chart. */
export function nightProfile(e: EventRow) {
  const start = Date.parse(e.starts_at);
  return Array.from({ length: 8 }, (_, i) => {
    const at = start - HOUR + i * HOUR;
    return { at, label: clockShort(new Date(at).toISOString()), score: crowdAt(e, at, false) };
  });
}
