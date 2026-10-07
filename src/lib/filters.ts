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
