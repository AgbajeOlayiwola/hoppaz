import { haversineKm } from "@/lib/geo";
import type { Band, Hotspot, Pt, ZoneShape } from "./types";

/** Metres between two points. */
export const metresApart = (a: Pt, b: Pt) => haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;

/** Ray casting on one ring. */
function inRing(lat: number, lng: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** In the outer ring and in none of the holes. */
const inPolygon = (lat: number, lng: number, rings: [number, number][][]) =>
  rings.length > 0 && inRing(lat, lng, rings[0]) && !rings.slice(1).some((r) => inRing(lat, lng, r));

/** Is this point inside the zone's shape? The phone does this with its own fix; nothing is sent anywhere. */
export function inZone(p: Pt, zone: ZoneShape | null): boolean {
  if (!zone) return false;
  return zone.type === "Polygon"
    ? inPolygon(p.lat, p.lng, zone.coordinates)
    : zone.coordinates.some((poly) => inPolygon(p.lat, p.lng, poly));
}

const nearestOf = (list: Hotspot[], p: Pt) =>
  list.reduce<{ h: Hotspot; m: number } | null>((best, h) => {
    const m = metresApart(p, h);
    return !best || m < best.m ? { h, m } : best;
  }, null)?.h ?? null;

/**
 * "Your hotspot": the open hotspot of the zone you are standing in. Over the line in Ogun State you are in no zone, and
 * a zone that is not open yet (or is paused) is not one you can enter, so in both cases it is the nearest open one.
 */
export function yoursOf(list: Hotspot[], p: Pt | null): Hotspot | null {
  if (!p) return null;
  const open = list.filter((h) => h.status === "open");
  const inside = list.find((h) => h.status !== "paused" && inZone(p, h.zone));
  if (inside && inside.status === "open") return inside;
  return nearestOf(open, p);
}

/** The nearest others, open ones first (an "Opening soon" one only fills a gap). */
export function nearestOthers(list: Hotspot[], p: Pt | null, skip: string | null, count: number): Hotspot[] {
  const rest = list.filter((h) => h.status !== "paused" && h.slug !== skip);
  const byDistance = (a: Hotspot, b: Hotspot) => (p ? metresApart(p, a) - metresApart(p, b) : a.wave - b.wave);
  const open = rest.filter((h) => h.status === "open").sort(byDistance);
  const planned = rest.filter((h) => h.status === "planned").sort(byDistance);
  return [...open, ...planned].slice(0, count);
}

/** The hotspots worth a pin: yours, those within 10 km, and the nearest two if none are that close. With no position, all of them. */
export function pinsFor(list: Hotspot[], p: Pt | null, yoursSlug: string | null): Hotspot[] {
  const live = list.filter((h) => h.status !== "paused");
  if (!p) return live;
  const shown = new Set(live.filter((h) => metresApart(p, h) <= 10_000));
  if (shown.size === 0) nearestOthers(live, p, null, 2).forEach((h) => shown.add(h));
  const mine = live.find((h) => h.slug === yoursSlug);
  if (mine) shown.add(mine);
  return [...shown];
}

/** "640 m", "1.2 km", "14 km". Only ever shown to the Hopper whose position it is. */
export function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** How full, as a number of bars: 0 hides the badge. */
export const BAND_BARS: Record<Band, number> = { quiet: 0, few: 1, some: 2, busy: 3, packed: 4 };

/** The ring on a pin pulses when 3 or more avatars are there. */
export const bandPulses = (b: Band) => b === "some" || b === "busy" || b === "packed";

export function hereLabel(h: Pick<Hotspot, "hereBand" | "hereN">): string {
  switch (h.hereBand) {
    case "quiet":
      return "Quiet right now";
    case "few":
      return "A few here now";
    default:
      return h.hereN ? `${h.hereN} here now` : h.hereBand === "some" ? "Some here now" : h.hereBand === "busy" ? "Busy now" : "Packed now";
  }
}

export function todayLabel(h: Pick<Hotspot, "todayBand" | "todayN">): string {
  switch (h.todayBand) {
    case "quiet":
      return "Nobody yet today";
    case "few":
      return "A few today";
    default:
      return h.todayN ? `${h.todayN} today` : "Plenty today";
  }
}
