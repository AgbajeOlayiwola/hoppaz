export type Area = { name: string; side: "mainland" | "island"; lat: number; lng: number };

/**
 * Mirrors public.areas. Kept client side so the area picker renders before the
 * first network round trip, and so the map still works if the table is empty.
 */
export const AREAS: Area[] = [
  { name: "Ikeja", side: "mainland", lat: 6.601, lng: 3.349 },
  { name: "Magodo", side: "mainland", lat: 6.616, lng: 3.378 },
  { name: "Maryland", side: "mainland", lat: 6.57, lng: 3.365 },
  { name: "Ogudu", side: "mainland", lat: 6.577, lng: 3.388 },
  { name: "Gbagada", side: "mainland", lat: 6.552, lng: 3.396 },
  { name: "Shomolu", side: "mainland", lat: 6.54, lng: 3.383 },
  { name: "Mushin", side: "mainland", lat: 6.527, lng: 3.345 },
  { name: "Yaba", side: "mainland", lat: 6.509, lng: 3.375 },
  { name: "Surulere", side: "mainland", lat: 6.497, lng: 3.352 },
  { name: "Apapa", side: "mainland", lat: 6.448, lng: 3.363 },
  { name: "Festac", side: "mainland", lat: 6.466, lng: 3.286 },
  { name: "Lagos Island", side: "island", lat: 6.455, lng: 3.399 },
  { name: "Ikoyi", side: "island", lat: 6.452, lng: 3.436 },
  { name: "Victoria Island", side: "island", lat: 6.429, lng: 3.424 },
  { name: "Lekki Phase 1", side: "island", lat: 6.441, lng: 3.47 },
  { name: "Ajah", side: "island", lat: 6.468, lng: 3.565 },
];

export const LAGOS_CENTER = { lat: 6.5, lng: 3.42 };
/** Hard bound so nobody pans the map to Kansas. Lagos only, for now. */
export const LAGOS_BOUNDS: [[number, number], [number, number]] = [
  [3.05, 6.30],
  [3.95, 6.80],
];

export function areaByName(name?: string | null): Area | undefined {
  if (!name) return undefined;
  return AREAS.find((a) => a.name === name);
}

/** Nearest known area to a pair of coordinates. Used after a real GPS fix. */
export function nearestArea(lat: number, lng: number): Area {
  return AREAS.reduce((best, a) =>
    haversineKm(lat, lng, a.lat, a.lng) < haversineKm(lat, lng, best.lat, best.lng) ? a : best
  );
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const t = Math.PI / 180;
  const dLa = (bLat - aLat) * t;
  const dLo = (bLng - aLng) * t;
  const h =
    Math.sin(dLa / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Rough night-time travel estimate for Lagos: 2.4 min/km plus 5 to get moving,
 * plus 18 minutes when the trip crosses a bridge. It is an estimate and the UI
 * says so. Swap in a routing API when the numbers start costing people a bus.
 */
export function travelEstimate(
  from: { lat: number; lng: number; side?: Area["side"] },
  to: { lat: number; lng: number; side?: Area["side"] }
): { km: number; minutes: number; crossesBridge: boolean } {
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  const crossesBridge = !!from.side && !!to.side && from.side !== to.side;
  return { km, minutes: Math.round(km * 2.4 + 5 + (crossesBridge ? 18 : 0)), crossesBridge };
}

export const naira = (n: number) => (n > 0 ? `₦${n.toLocaleString("en-NG")}` : "FREE");

/** Price for a map tag, where space is tight: ₦10K, ₦7.5K, ₦800, FREE. */
export const nairaShort = (n: number) =>
  n <= 0 ? "FREE" : n >= 1000 ? `₦${Number((n / 1000).toFixed(1))}K` : `₦${n}`;

/** "11PM", "7:30PM": the start time as the map shows it. */
export function clockShort(iso: string) {
  return clockLagos(iso).replace(":00", "").replace(/\s/g, "").toUpperCase();
}

export function clockLagos(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  });
}

export function dayLagos(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  });
}
