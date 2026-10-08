import type { CSSProperties } from "react";
import { dayLabel, nightOf } from "@/lib/filters";
import { eventPrice, isEventLead } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { EventRow } from "@/lib/types";

/**
 * Small pure helpers for the Today tab. Kept out of the components so the
 * wording (the conductor line, the one-pill rule, the mono fact line) is easy
 * to read in one place.
 */

export const HOUR = 3.6e6;

const noon = (dayKey: string) => new Date(`${dayKey}T12:00:00Z`);

/** "Friday": the page title for any day that is not today. */
export const weekdayLong = (dayKey: string) =>
  noon(dayKey).toLocaleDateString("en-NG", { weekday: "long", timeZone: "UTC" });

/** "FRI 9": a day as the rail and the next-busy-day button name it. */
export function railTag(dayKey: string) {
  const d = noon(dayKey);
  const wd = d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  return `${wd} ${d.getUTCDate()}`;
}

/** "9 OCT": a quiet date next to a weekday title, so "Friday" is never ambiguous. */
export function dateTag(dayKey: string) {
  const d = noon(dayKey);
  const m = d.toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${d.getUTCDate()} ${m}`;
}

/** Most Hoppers going first, then the earliest start. */
export function byGoingThenStart(a: EventRow, b: EventRow) {
  return (b.swipes_in ?? 0) - (a.swipes_in ?? 0) || Date.parse(a.starts_at) - Date.parse(b.starts_at);
}

/** The next day after dayKey that has something on, with how many. */
export function nextBusyDay(counts: Record<string, number>, dayKey: string) {
  const key = Object.keys(counts)
    .filter((k) => k > dayKey && counts[k] > 0)
    .sort()[0];
  return key ? { key, n: counts[key] } : null;
}

/** "NEXT BUSY DAY · FRI 9 · 23 ON" */
export const nextBusyLabel = (next: { key: string; n: number }) =>
  `NEXT BUSY DAY · ${railTag(next.key)} · ${next.n} ON`;

export type PillSpec = { cls: string; text: string };

/**
 * One coloured pill at most (the design system's one tier-2 colour per card):
 * a drop beats an unconfirmed lead beats a daytime event beats the going
 * count. With includeGoing off the going count is left out (the swipe card
 * prints it as a big number instead). Hidden at 0 so a new listing never
 * says "0 GOING".
 */
export function stubPill(
  event: EventRow,
  opts: { drop: boolean; count: number; includeGoing?: boolean }
): PillSpec | null {
  if (opts.drop) return { cls: "pill-violet", text: "DROP" };
  if (isEventLead(event)) return { cls: "pill-danfo", text: "UNCONFIRMED" };
  if (themeForEvent(event.starts_at) === "day") return { cls: "pill-lagoon", text: "DAYTIME" };
  if (opts.includeGoing !== false && opts.count > 0) return { cls: "pill-keke", text: `${opts.count} GOING` };
  return null;
}

/** The one mono line: "TODAY · 10PM · VICTORIA ISLAND · ₦5,000". Same words as the event page. */
export function factLine(event: EventRow, now: number) {
  const when = isEventLead(event) ? "TIME TBC" : dayLabel(event.starts_at, now);
  return [when, event.area?.toUpperCase(), eventPrice(event)].filter(Boolean).join(" · ");
}

export const hasEnded = (event: EventRow, now: number) => Date.parse(event.starts_at) + 6 * HOUR < now;

/**
 * The conductor line under the title. Today it counts Hoppers checked in
 * (here_now), falling back to who says they are going; any other day it is
 * the going count. Drops come from the same flag the map uses.
 */
export function conductorLine(opts: {
  events: EventRow[];
  dropIds: ReadonlySet<string>;
  dayKey: string;
  now: number;
  goingOf: (e: EventRow) => number;
}) {
  const { events, dropIds, dayKey, now, goingOf } = opts;
  if (!events.length) return "";
  const today = nightOf(now) === dayKey;
  const out = events.reduce((n, e) => n + (e.here_now ?? 0), 0);
  const going = events.reduce((n, e) => n + goingOf(e), 0);
  const drops = events.filter((e) => dropIds.has(e.id)).length;
  const s = (n: number) => (n === 1 ? "" : "s");

  const parts: string[] = [];
  if (today && out > 0) parts.push(`${out} Hopper${s(out)} out.`);
  else if (going > 0) parts.push(`${going} Hopper${s(going)} going.`);
  else parts.push(today ? "Nobody's out yet. Be the first." : "Nobody's going yet. Be the first.");
  if (drops > 0) parts.push(`Drops at ${drops} spot${s(drops)}.`);
  return parts.join(" ");
}

/** Where a stub's two punched notches sit: on the perforation, `px` above the bottom edge. */
export const notchAbove = (px: number) => ({ ["--notch-y" as string]: `calc(100% - ${px}px)` }) as CSSProperties;
