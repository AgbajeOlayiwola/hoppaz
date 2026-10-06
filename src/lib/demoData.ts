import type { EventRow, HopStop } from "./types";

/**
 * Offline fallback so `npm run dev` works before Supabase is wired up, and so
 * a tile or API outage does not leave a Hopper staring at an empty map.
 * Mirrors supabase/seed.sql. Sample listings, not a confirmed week.
 */
const raw: Array<[string, string, string, number, number, string, number, string, EventRow["source"], number]> = [
  ["Soundgarden", "South Social", "Lekki Phase 1", 6.4386, 3.4655, "23:00", 10000, "afro", "hoppaz", 72],
  ["Element After Dark", "Element House", "Lekki Phase 1", 6.4428, 3.4548, "23:30", 8000, "techno", "partner", 64],
  ["Shrine Friday", "New Afrika Shrine", "Ikeja", 6.606, 3.3449, "19:00", 0, "live band", "partner", 58],
  ["Sailors Deck", "Sailors Lounge", "Victoria Island", 6.4262, 3.4405, "22:00", 7000, "rave", "partner", 55],
  ["Yaba Rooftop Session", "Herbert Macaulay rooftop", "Yaba", 6.5078, 3.3742, "22:00", 4000, "amapiano", "hopper", 50],
  ["Hard Rock Fridays", "Hard Rock Cafe", "Victoria Island", 6.4225, 3.4165, "21:00", 10000, "afro", "partner", 48],
  ["Laughter Cave", "Bogobiri House", "Ikoyi", 6.4506, 3.4318, "20:00", 5000, "comedy", "partner", 46],
  ["Jara Sundown", "Jara Beach", "Ajah", 6.459, 3.562, "16:00", 10000, "beach", "partner", 44],
  ["Freedom Park Live", "Freedom Park", "Lagos Island", 6.4489, 3.3965, "21:00", 3000, "live band", "partner", 42],
  ["Good Beach Night", "The Good Beach", "Lekki Phase 1", 6.4255, 3.518, "18:00", 7500, "beach", "partner", 38],
  ["Brewery Friday", "Bature Brewery", "Lekki Phase 1", 6.4347, 3.4876, "21:00", 5000, "rooftop", "partner", 36],
  ["Muri Night Market", "Muri Okunola Park", "Victoria Island", 6.4291, 3.4248, "18:00", 0, "food", "partner", 32],
  ["Terra Late Show", "Terra Kulture", "Victoria Island", 6.4278, 3.4345, "17:00", 7500, "live band", "partner", 26],
  ["Gbagada House Party", "off Diya Street", "Gbagada", 6.5523, 3.393, "22:00", 2000, "afro", "hopper", 22],
  ["Surulere Street Jam", "Adeniran Ogunsanya", "Surulere", 6.4987, 3.3496, "20:00", 1500, "afro", "hopper", 20],
  ["Festac Block Party", "7th Avenue", "Festac", 6.4663, 3.2871, "19:00", 2500, "amapiano", "hopper", 18],
];

/** The coming Friday in Lagos, so the demo night is always just ahead. */
function comingFriday(hhmm: string): string {
  const now = new Date();
  const d = new Date(now);
  const delta = (5 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  const [h, m] = hhmm.split(":").map(Number);
  // Lagos is UTC+1 year round
  d.setUTCHours(h - 1, m, 0, 0);
  return d.toISOString();
}

export const DEMO_EVENTS: EventRow[] = raw.map(
  ([title, venue_name, area, lat, lng, hhmm, price_naira, vibe, source, heat], i) => ({
    id: `demo-${i + 1}`,
    title,
    venue_name,
    area,
    lat,
    lng,
    starts_at: comingFriday(hhmm),
    price_naira,
    vibe,
    source,
    ig_url: null,
    flyer_url: null,
    distance_m: 0,
    heat,
    checkins: 0,
    swipes_in: 0,
  })
);

export const DEMO_HOP = {
  id: "demo-hop",
  name: "HOP 02 · FREEDOM",
  hop_date: "2026-10-09",
  price_naira: 25000,
  boarding: "Board 6:00pm, bus leaves 7:00pm and does not wait",
  ticket_url: null,
  status: "selling",
  stops: [
    { id: "h1", idx: 1, name: "New Afrika Shrine", area: "Ikeja", lat: 6.606, lng: 3.3449, stop_time: "7:00pm", role: "assembly point" },
    { id: "h2", idx: 2, name: "Freedom Park", area: "Lagos Island", lat: 6.4489, lng: 3.3965, stop_time: "8:30pm", role: "island warm-up" },
    { id: "h3", idx: 3, name: "Laughter Cave, Bogobiri", area: "Ikoyi", lat: 6.4506, lng: 3.4318, stop_time: "10:00pm", role: "comedy break" },
    { id: "h4", idx: 4, name: "South Social", area: "Lekki Phase 1", lat: 6.4386, lng: 3.4655, stop_time: "11:30pm", role: "grand finale" },
  ] as HopStop[],
};
