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

export function dropPhase(d: Pick<GameDrop, "opens_at" | "closes_at" | "kind">, now: number): DropPhase {
  if (now >= Date.parse(d.closes_at)) return "closed";
  // Street and welcome boxes open the moment they are made, so a phone clock a little behind never shows them sealed.
  if (d.kind === "spawn" || d.kind === "welcome") return "open";
  if (now < Date.parse(d.opens_at)) return "sealed";
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

/**
 * "CLOSES 11:30PM" when it closes before the night is out, "CLOSES SUN 12:17AM"
 * when it runs past it, so a drop open for days never reads as closing tonight.
 * The night runs to 6am Lagos time, like the day rail.
 */
export function closesLabel(closesAt: string, now = Date.now()) {
  const at = Date.parse(closesAt);
  const night = (ms: number) => new Date(ms + HOUR - 6 * HOUR).toISOString().slice(0, 10);
  if (night(at) === night(now)) return `CLOSES ${clock12(at)}`;
  const t = new Date(at + HOUR);
  const far = at - now > 6 * 24 * HOUR;
  return `CLOSES ${far ? `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}` : DAYS[t.getUTCDay()]} ${clock12(at)}`;
}

/** "3 OCT" in Lagos, for stamps and receipts. */
export function shortDate(iso: string) {
  const t = new Date(Date.parse(iso) + HOUR);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/** The few characters under a sealed box on the map: "OPENS 9PM" tonight, "OPENS SAT" later. */
export function opensShort(opensAt: string, now: number) {
  const at = Date.parse(opensAt);
  const night = (ms: number) => new Date(ms + HOUR - 6 * HOUR).toISOString().slice(0, 10);
  if (night(at) === night(now)) return `OPENS ${clock12(at)}`;
  return `OPENS ${DAYS[new Date(at + HOUR).getUTCDay()]}`;
}

/** How long a box has left: "12 min" up to two hours, "23 h" after that. Never below "1 min". */
export function timeLeft(closesAt: string, now: number) {
  const left = Math.max(0, Date.parse(closesAt) - now);
  if (left < 2 * HOUR) return `${Math.max(1, Math.ceil(left / MIN))} min`;
  return `${Math.ceil(left / HOUR)} h`;
}
