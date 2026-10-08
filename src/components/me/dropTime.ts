import type { GameDrop } from "@/lib/game";

/**
 * Drop timing, all in Lagos time (UTC+1 all year) and all from the opens_at and
 * closes_at the app already loads. A drop is sealed until it opens, open until
 * it closes, then it leaves the list.
 */
const HOUR = 3.6e6;
const MIN = 6e4;
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type DropPhase = "sealed" | "open" | "closed";

export function dropPhase(d: Pick<GameDrop, "opens_at" | "closes_at">, now: number): DropPhase {
  if (now < Date.parse(d.opens_at)) return "sealed";
  if (now >= Date.parse(d.closes_at)) return "closed";
  return "open";
}

/** In the last hour before it closes. */
export function closingSoon(d: Pick<GameDrop, "closes_at">, now: number) {
  const left = Date.parse(d.closes_at) - now;
  return left > 0 && left <= HOUR;
}

/** "10PM", "10:30PM" */
function clock12(ms: number) {
  const t = new Date(ms + HOUR);
  const h = t.getUTCHours();
  const m = t.getUTCMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "AM" : "PM"}`;
}

/** "23:30" */
function clock24(ms: number) {
  const t = new Date(ms + HOUR);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

/** "OPENS IN 2H 14M" when it is close, "OPENS FRI 10PM" when it is not. */
export function opensLabel(opensAt: string, now: number) {
  const at = Date.parse(opensAt);
  const left = at - now;
  if (left <= 0) return "OPEN";
  if (left < 12 * HOUR) {
    const mins = Math.max(1, Math.ceil(left / MIN));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `OPENS IN ${h ? `${h}H` : ""}${h && m ? " " : ""}${m || !h ? `${m}M` : ""}`;
  }
  const t = new Date(at + HOUR);
  const far = left > 6 * 24 * HOUR;
  const when = far ? `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}` : DAYS[t.getUTCDay()];
  return `OPENS ${when} ${clock12(at)}`;
}

/** "CLOSES 23:30" */
export function closesLabel(closesAt: string) {
  return `CLOSES ${clock24(Date.parse(closesAt))}`;
}

/** "3 OCT" in Lagos, for stamps and receipts. */
export function shortDate(iso: string) {
  const t = new Date(Date.parse(iso) + HOUR);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}
