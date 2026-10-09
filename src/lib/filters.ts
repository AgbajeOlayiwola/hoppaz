import type { EventRow } from "./types";

/**
 * Map filters: which night, and what kind of event.
 *
 * A "night" runs 6am to 6am Lagos time, so a party that starts at 1am Saturday
 * still counts as Friday night, which is how anyone in Lagos would say it.
 */

const HOUR = 3.6e6;

/** "2026-10-09" for the Lagos night an instant belongs to. Lagos is UTC+1 all year. */
export function nightOf(ms: number) {
  return new Date(ms + HOUR - 6 * HOUR).toISOString().slice(0, 10);
}

export type DateFilter =
  | { kind: "any" }
  | { kind: "weekend" }
  | { kind: "night"; date: string };

export const ANY_DATE: DateFilter = { kind: "any" };

export function dateOptions(now = Date.now()): Array<{ key: string; label: string; value: DateFilter }> {
  const tonight = nightOf(now);
  const out: Array<{ key: string; label: string; value: DateFilter }> = [
    { key: "any", label: "ANY DAY", value: ANY_DATE },
    { key: "weekend", label: "THIS WEEKEND", value: { kind: "weekend" } },
  ];
  for (let i = 0; i < 7; i++) {
    const date = nightOf(now + i * 24 * HOUR);
    const d = new Date(`${date}T12:00:00Z`);
    const label =
      date === tonight
        ? "TONIGHT"
        : i === 1
          ? "TOMORROW"
          : d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
    out.push({ key: date, label, value: { kind: "night", date } });
  }
  return out;
}

export const dateKey = (f: DateFilter) => (f.kind === "night" ? f.date : f.kind);

/** The coming Friday, Saturday and Sunday nights (or the rest of this one, if it has started). */
function weekendNights(now: number) {
  const nights: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = nightOf(now + i * 24 * HOUR);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 5 Fri, 6 Sat, 0 Sun
    if (dow === 5 || dow === 6 || dow === 0) nights.push(date);
    if (dow === 0 && nights.length) break;
  }
  return nights;
}

export function matchesDate(e: EventRow, f: DateFilter, now = Date.now()) {
  if (f.kind === "any") return true;
  const n = nightOf(Date.parse(e.starts_at));
  if (f.kind === "night") return n === f.date;
  return weekendNights(now).includes(n);
}

export function matchesType(e: EventRow, types: string[]) {
  return types.length === 0 || types.includes(e.vibe);
}

export function describeFilter(f: DateFilter, types: string[], now = Date.now()) {
  const parts: string[] = [];
  if (f.kind !== "any") {
    const quickLabel = dateOptions(now).find((o) => o.key === dateKey(f))?.label;
    const customLabel = f.kind === "night"
      ? new Date(`${f.date}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase()
      : f.kind.toUpperCase();
    parts.push(quickLabel ?? customLabel);
  }
  if (types.length) parts.push(types.length > 2 ? `${types.length} TYPES` : types.join(", ").toUpperCase());
  return parts.join(" · ");
}

/* ---------------------------------------------------------- the day rail -- */
/*
 * The design system's night rail, named "day" in the UI because Hoppaz lists
 * day and night events. A day still runs 6am to 6am Lagos time (nightOf), so
 * a 1am party belongs to the day it started the evening of.
 */

export const todayKey = (now = Date.now()) => nightOf(now);

export const TODAY = (now = Date.now()): DateFilter => ({ kind: "night", date: nightOf(now) });

export type RailDay = { date: string; weekday: string; day: number; month: string; isToday: boolean };

/** The next n days from today, for the rail. */
export function railDays(n = 14, now = Date.now()): RailDay[] {
  const today = nightOf(now);
  return Array.from({ length: n }, (_, i) => {
    const date = nightOf(now + i * 24 * HOUR);
    const d = new Date(`${date}T12:00:00Z`);
    return {
      date,
      weekday: date === today ? "TODAY" : d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
      day: d.getUTCDate(),
      month: d.toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" }).toUpperCase(),
      isToday: date === today,
    };
  });
}

/** How many events fall on each day key. */
export function countByDay(events: Array<{ starts_at: string }>) {
  const out: Record<string, number> = {};
  for (const e of events) {
    const k = nightOf(Date.parse(e.starts_at));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * How a card prints its day: "TODAY · 10PM", "SAT 18 OCT · 10PM", or the day
 * it belongs to for after-midnight starts ("FRI NIGHT · 1AM").
 */
export function dayLabel(startsAt: string, now = Date.now()) {
  const ms = Date.parse(startsAt);
  const key = nightOf(ms);
  const lagos = new Date(ms + HOUR);
  const h = lagos.getUTCHours();
  const m = lagos.getUTCMinutes();
  const time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "AM" : "PM"}`;
  if (ms + 6 * HOUR < now) return "ENDED";
  const d = new Date(`${key}T12:00:00Z`);
  const afterMidnight = h < 6;
  const day =
    key === nightOf(now)
      ? afterMidnight ? "TONIGHT" : "TODAY"
      : afterMidnight
        ? `${d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" }).toUpperCase()} NIGHT`
        : d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase().replace(",", "");
  return `${day} · ${time}`;
}

/** How many events the map opens on: enough to look alive, few enough to read. */
export const NEXT_COUNT = 20;

/**
 * The next `n` events from now (anything still on counts: it started under six
 * hours ago), soonest first, with the first and last night they cover. The map
 * opens on these instead of one possibly quiet day.
 */
export function nextEvents(events: EventRow[], n = NEXT_COUNT, now = Date.now()) {
  const list = events
    .filter((e) => Date.parse(e.starts_at) > now - 6 * HOUR)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, n);
  const from = list[0] ? nightOf(Date.parse(list[0].starts_at)) : null;
  const to = list.length ? nightOf(Date.parse(list[list.length - 1].starts_at)) : null;
  return { list, from, to };
}

/** "FRI 9": a night key as the rail prints it. */
export function nightTag(key: string) {
  const d = new Date(`${key}T12:00:00Z`);
  return `${d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" }).toUpperCase()} ${d.getUTCDate()}`;
}
