import { crowdAt, timeSlots } from "@/lib/crowd";
import { nightOf } from "@/lib/filters";
import type { EventRow } from "@/lib/types";

/**
 * The time scrubber's maths, kept apart from the component so it is easy to
 * reason about. A "stop" is one position on the track. On today the first stop
 * is NOW (live check-ins); every other stop is an expected time, built from the
 * same crowd curve the heat map has always used (lib/crowd.ts).
 *
 * Lagos is UTC+1 all year, and a day runs 6am to 6am (lib/filters.ts).
 */

const HOUR = 3.6e6;

export type Stop = { t: number; live: boolean };

const floorTo = (ms: number, step: number) => Math.floor(ms / step) * step;
const ceilTo = (ms: number, step: number) => Math.ceil(ms / step) * step;

/** 6am Lagos on a day key, in ms. */
export const dayStartMs = (dayKey: string) => Date.parse(`${dayKey}T05:00:00Z`);

const lagos = (ms: number) => new Date(ms + HOUR);

/** "11PM", "7:30PM": a clock time as the map prints it. */
export function clock(ms: number) {
  const d = lagos(ms);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "AM" : "PM"}`;
}

const weekday = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" }).toUpperCase();

/** "SAT 10 OCT", for labelling a day that is not today. */
export function dayTag(dayKey: string) {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const month = d.toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${weekday(dayKey)} ${d.getUTCDate()} ${month}`;
}

/** How a day reads in the conductor line: "today", "tomorrow", then "Sat". */
export function dayWord(dayKey: string, now: number) {
  const today = nightOf(now);
  if (dayKey === today) return "today";
  if (dayKey === nightOf(now + 24 * HOUR)) return "tomorrow";
  const w = weekday(dayKey);
  return w.charAt(0) + w.slice(1).toLowerCase();
}

/**
 * The track for one day: stops half an hour apart (an hour apart when the day
 * is long), from the first thing worth seeing to when the last crowd has gone home.
 */
export function scrubStops(events: EventRow[], dayKey: string, now: number): Stop[] {
  const today = nightOf(now) === dayKey;
  const dayStart = dayStartMs(dayKey);
  const dayEnd = dayStart + 24 * HOUR;
  const starts = events.map((e) => Date.parse(e.starts_at)).sort((a, b) => a - b);

  let from: number;
  let to: number;
  if (starts.length) {
    from = today ? now : Math.max(dayStart, floorTo(starts[0] - 1.5 * HOUR, HOUR));
    // The night curve is spent about five hours after the last door.
    to = Math.min(dayEnd, ceilTo(starts[starts.length - 1] + 5 * HOUR, HOUR));
  } else {
    from = today ? now : dayStart + 12 * HOUR; // 6pm
    to = dayStart + 22 * HOUR; // 4am
  }
  to = Math.max(to, from + 3 * HOUR);

  const step = to - from > 12 * HOUR ? HOUR : HOUR / 2;
  const out: Stop[] = [];
  let t: number;
  if (today) {
    out.push({ t: now, live: true });
    t = ceilTo(now, step);
    if (t - now < 10 * 60_000) t += step; // no stop crowding right behind NOW
  } else {
    t = from;
  }
  for (; t <= to; t += step) out.push({ t, live: false });
  return out;
}

export function nearestStop(stops: Stop[], t: number) {
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i].t - t) < Math.abs(stops[best].t - t)) best = i;
  }
  return best;
}

/**
 * Where the thumb starts. Today: NOW. Any other day: that day's first
 * expected slot, the same one the old time strip led with.
 */
export function defaultStop(stops: Stop[], events: EventRow[], now: number, today: boolean) {
  if (today || stops.length < 2) return 0;
  const first = timeSlots(events, now).find((s) => !s.live);
  return first ? nearestStop(stops, first.at) : 0;
}

/** How busy the city is at each stop, 0 to 1 against the busiest stop, for the little bars. */
export function scrubStrengths(events: EventRow[], stops: Stop[]) {
  if (!events.length) return stops.map(() => 0);
  const raw = stops.map((s) => events.reduce((sum, e) => sum + crowdAt(e, s.t, s.live), 0));
  const max = Math.max(...raw, 1);
  return raw.map((v) => v / max);
}

/** Which stops carry a printed time under the track, so labels never crowd. */
export function scrubTicks(stops: Stop[], today: boolean): Array<{ i: number; label: string }> {
  if (stops.length < 2) return [];
  const span = (stops[stops.length - 1].t - stops[0].t) / HOUR;
  const every = [1, 2, 3, 4, 6].find((h) => span / h <= 5.5) ?? 6;
  const out: Array<{ i: number; label: string }> = [];
  stops.forEach((s, i) => {
    if (s.live) {
      out.push({ i, label: "NOW" });
      return;
    }
    const d = lagos(s.t);
    if (d.getUTCMinutes() !== 0 || d.getUTCHours() % every !== 0) return;
    // Keep clear of NOW (it sits at the left edge on today): a label needs about 12% of the track.
    if (today && (s.t - stops[0].t) / (stops[stops.length - 1].t - stops[0].t) < 0.12) return;
    out.push({ i, label: clock(s.t) });
  });
  return out;
}

/** "23 Hoppers out · 2 drops today": plain cream text from data the page already holds. */
export function conductorLine(opts: {
  events: EventRow[];
  dropEventIds: ReadonlySet<string>;
  dayKey: string;
  now: number;
}) {
  const { events, dropEventIds, dayKey, now } = opts;
  if (!events.length) return "Quiet one.";
  const today = nightOf(now) === dayKey;
  const out = events.reduce((n, e) => n + (e.here_now ?? 0), 0);
  const going = events.reduce((n, e) => n + (e.swipes_in ?? 0), 0);
  const drops = events.filter((e) => dropEventIds.has(e.id)).length;
  const s = (n: number) => (n === 1 ? "" : "s");

  const parts: string[] = [];
  if (today && out > 0) parts.push(`${out} Hopper${s(out)} out`);
  else if (going > 0) parts.push(`${going} Hopper${s(going)} going`);
  else parts.push(today ? "Nobody out yet" : "Nobody in yet");
  if (drops > 0) parts.push(`${drops} drop${s(drops)} ${dayWord(dayKey, now)}`);
  return parts.join(" · ");
}

/** Caption under the big time: LIVE or EXPECTED, with the day when it is not today. */
export function scrubCaption(stop: Stop, dayKey: string, today: boolean) {
  const head = stop.live ? "LIVE" : "EXPECTED";
  if (today) return head;
  // 1am on a Friday night is still "FRI NIGHT", not Saturday.
  const afterMidnight = lagos(stop.t).getUTCHours() < 6;
  return `${head} · ${afterMidnight ? `${weekday(dayKey)} NIGHT` : dayTag(dayKey)}`;
}
