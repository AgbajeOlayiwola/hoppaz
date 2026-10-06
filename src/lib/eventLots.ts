import type { CrowdTone } from "./crowd";
import { TONE_HEX } from "./crowd";

/**
 * Each venue as a little Sims lot: plinth, cream walls, a door, a stepped
 * roof, and a floating diamond whose colour says how busy it is. Plain boxes
 * for MapLibre's fill-extrusion, nine per venue, so it costs next to nothing
 * on a phone GPU. Sizes are toy scale on purpose (a lot is ~120 m across) so
 * the venue reads from a few blocks away.
 */

type Box = { w: number; d: number; base: number; top: number; color: string; dy?: number; diamond?: boolean };

const M_PER_DEG_LAT = 110_574;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function ring(lat: number, lng: number, b: Box, rot: number): [number, number][] {
  const mLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const pts: Array<[number, number]> = b.diamond
    ? [[0, -b.d], [b.w, 0], [0, b.d], [-b.w, 0]]
    : [[-b.w / 2, -b.d / 2], [b.w / 2, -b.d / 2], [b.w / 2, b.d / 2], [-b.w / 2, b.d / 2]];
  const c = Math.cos(rot), s = Math.sin(rot);
  const out = pts.map(([x, y]) => {
    const yy = y + (b.dy ?? 0);
    const rx = x * c - yy * s;
    const ry = x * s + yy * c;
    return [lng + rx / mLng, lat + ry / M_PER_DEG_LAT] as [number, number];
  });
  out.push(out[0]);
  return out;
}

export function lotFeatures(
  e: { id: string; lat: number; lng: number },
  tone: CrowdTone,
  selected: boolean
): GeoJSON.Feature[] {
  const rot = ((hash(e.id) % 50) - 25) * (Math.PI / 180);
  const roof = selected ? "#FF4D00" : "#B83600";
  const gem = TONE_HEX[tone];
  const boxes: Box[] = [
    { w: 124, d: 96, base: 0, top: 3, color: "#2E211C" }, // the lot
    { w: 88, d: 62, base: 3, top: 26, color: "#F5EBDD" }, // walls
    { w: 18, d: 6, base: 3, top: 16, color: "#0E0B0A", dy: -33 }, // door, on the front face
    { w: 96, d: 70, base: 26, top: 31, color: roof }, // eaves
    { w: 72, d: 46, base: 31, top: 38, color: roof },
    { w: 44, d: 20, base: 38, top: 44, color: selected ? "#B83600" : "#FF4D00" }, // ridge
    // The plumbob: three stacked diamonds make a low-poly octahedron
    { w: 10, d: 10, base: 64, top: 70, color: gem, diamond: true },
    { w: 18, d: 18, base: 70, top: 84, color: gem, diamond: true },
    { w: 10, d: 10, base: 84, top: 90, color: gem, diamond: true },
  ];
  return boxes.map((b) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring(e.lat, e.lng, b, rot)] },
    properties: { id: e.id, base: b.base, top: b.top, color: b.color },
  }));
}
