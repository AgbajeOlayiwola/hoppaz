import { haversineKm } from "@/lib/geo";

/** Metres between two points. */
export const metresBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => haversineKm(aLat, aLng, bLat, bLng) * 1000;

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** A circle on the ground, `metres` across from its middle, as a closed ring of [lng, lat]. */
export function circleRing(lat: number, lng: number, metres: number, steps = 72): [number, number][] {
  const dLat = metres / M_PER_DEG_LAT;
  const dLng = metres / mPerDegLng(lat);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return ring;
}

/** Move a point east and north by metres. */
export function nudgePoint(lat: number, lng: number, eastM: number, northM: number) {
  return { lat: lat + northM / M_PER_DEG_LAT, lng: lng + eastM / mPerDegLng(lat) };
}

/** Lagos only for now (the same box as the server's bounds). */
export const insideLagos = (lat: number, lng: number) => lat >= 6.3 && lat <= 6.8 && lng >= 3.05 && lng <= 3.95;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
