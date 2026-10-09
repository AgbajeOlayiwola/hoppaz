import type { EventRow, HopStop } from "./types";

/**
 * DEV-ONLY SAMPLE DATA. Nothing in this file is a real listing.
 *
 * It exists so `npm run dev` works before Supabase is wired up, and so the day
 * rail, the heat and the screenshots have something realistic to show. The
 * venue names are real Lagos places used as stand-ins; the titles, prices,
 * times, heat and going counts are made up. useEvents only ever serves this in
 * development (NODE_ENV !== "production"), never to a player in production.
 *
 * Start times are RELATIVE to now: they are rebuilt from today's Lagos date on
 * every call, so there is always something on today, tomorrow, this weekend
 * and across the next fortnight, whatever day the dev server was started.
 */

const HOUR = 3.6e6;
const DAY = 24 * HOUR;

/** Lagos is UTC+1 all year. A "night" runs 6am to 6am, same rule as filters.ts. */
function nightKey(ms: number) {
  return new Date(ms + HOUR - 6 * HOUR).toISOString().slice(0, 10);
}

/** Midnight at the start of today's Lagos night, in ms (the night that is on now). */
function nightMidnight(now: number) {
  return Date.parse(`${nightKey(now)}T00:00:00Z`) - HOUR;
}

/** Days from today until the next given weekday (0 = Sun ... 6 = Sat); 0 if today is that day. */
function daysUntil(now: number, weekday: number) {
  const today = new Date(`${nightKey(now)}T12:00:00Z`).getUTCDay();
  return (weekday - today + 7) % 7;
}

/** "13:00" on night `day` days from today, as an ISO time. 00:00 to 05:59 means after midnight, same night. */
function at(now: number, day: number, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const afterMidnight = h < 6 ? DAY : 0;
  return new Date(nightMidnight(now) + day * DAY + afterMidnight + (h * 60 + m) * 60_000).toISOString();
}

type Row = [
  title: string,
  venue: string,
  area: string,
  lat: number,
  lng: number,
  day: number,
  hhmm: string,
  price: number,
  vibe: string,
  source: EventRow["source"],
  heat: number,
];

function rows(now: number): Row[] {
  // Each weekend night is the next one on or after today, so on a Saturday "Saturday" is tonight.
  const fri = daysUntil(now, 5);
  const sat = daysUntil(now, 6);
  const sun = daysUntil(now, 0);
  const nextFri = fri + 7;
  return [
    // Today: a daytime one that has already started, then the evening building up, one after midnight.
    ["Freedom Park Live", "Freedom Park", "Lagos Island", 6.4489, 3.3965, 0, "13:00", 3000, "live band", "partner", 42],
    ["Terra Late Show", "Terra Kulture", "Victoria Island", 6.4278, 3.4345, 0, "17:00", 7500, "live band", "partner", 26],
    ["Muri Night Market", "Muri Okunola Park", "Victoria Island", 6.4291, 3.4248, 0, "18:00", 0, "food", "partner", 32],
    ["Laughter Cave", "Bogobiri House", "Ikoyi", 6.4506, 3.4318, 0, "20:00", 5000, "comedy", "partner", 46],
    ["Surulere Street Jam", "Adeniran Ogunsanya", "Surulere", 6.4987, 3.3496, 0, "20:00", 1500, "afro", "hopper", 20],
    ["Yaba Rooftop Session", "Herbert Macaulay rooftop", "Yaba", 6.5078, 3.3742, 0, "22:00", 4000, "amapiano", "hopper", 50],
    ["Gbagada House Party", "off Diya Street", "Gbagada", 6.5523, 3.393, 0, "01:00", 2000, "afro", "hopper", 22],

    // The coming Friday.
    ["Shrine Friday", "New Afrika Shrine", "Ikeja", 6.606, 3.3449, fri, "19:00", 0, "live band", "partner", 58],
    ["Hard Rock Fridays", "Hard Rock Cafe", "Victoria Island", 6.4225, 3.4165, fri, "21:00", 10000, "afro", "partner", 48],
    ["Brewery Friday", "Bature Brewery", "Lekki Phase 1", 6.4347, 3.4876, fri, "21:00", 5000, "rooftop", "partner", 36],
    ["Sailors Deck", "Sailors Lounge", "Victoria Island", 6.4262, 3.4405, fri, "22:00", 7000, "rave", "partner", 55],
    ["Soundgarden", "South Social", "Lekki Phase 1", 6.4386, 3.4655, fri, "23:00", 10000, "afro", "hoppaz", 72],
    ["Element After Dark", "Element House", "Lekki Phase 1", 6.4428, 3.4548, fri, "23:30", 8000, "techno", "partner", 64],

    // The coming Saturday: beach by day, the big nights after.
    ["Jara Sundown", "Jara Beach", "Ajah", 6.459, 3.562, sat, "16:00", 10000, "beach", "partner", 44],
    ["Good Beach Night", "The Good Beach", "Lekki Phase 1", 6.4255, 3.518, sat, "18:00", 7500, "beach", "partner", 38],
    ["Festac Block Party", "7th Avenue", "Festac", 6.4663, 3.2871, sat, "19:00", 2500, "amapiano", "hopper", 18],
    ["Soundgarden Saturday", "South Social", "Lekki Phase 1", 6.4386, 3.4655, sat, "23:00", 12000, "afro", "hoppaz", 80],
    ["Element After Dark", "Element House", "Lekki Phase 1", 6.4428, 3.4548, sat, "00:30", 8000, "techno", "partner", 60],

    // Sunday: slow day things.
    ["Jara Sunday Reset", "Jara Beach", "Ajah", 6.459, 3.562, sun, "14:00", 5000, "beach", "partner", 34],
    ["Muri Sunday Market", "Muri Okunola Park", "Victoria Island", 6.4291, 3.4248, sun, "15:00", 0, "food", "partner", 24],

    // The week after: thinner, with a gap day or two so the rail shows "0 on".
    ["Terra Open Mic", "Terra Kulture", "Victoria Island", 6.4278, 3.4345, sun + 2, "18:30", 3000, "comedy", "partner", 22],
    ["Midweek Amapiano", "Herbert Macaulay rooftop", "Yaba", 6.5078, 3.3742, sun + 3, "21:00", 4000, "amapiano", "hopper", 30],
    ["Bogobiri Comedy Night", "Bogobiri House", "Ikoyi", 6.4506, 3.4318, sun + 4, "20:00", 5000, "comedy", "partner", 40],
    ["Shrine Friday", "New Afrika Shrine", "Ikeja", 6.606, 3.3449, nextFri, "19:00", 0, "live band", "partner", 52],
    ["Hard Rock Fridays", "Hard Rock Cafe", "Victoria Island", 6.4225, 3.4165, nextFri, "21:00", 10000, "afro", "partner", 44],
    ["Sailors Deck", "Sailors Lounge", "Victoria Island", 6.4262, 3.4405, nextFri, "22:00", 7000, "rave", "partner", 50],
    ["Jara Sundown", "Jara Beach", "Ajah", 6.459, 3.562, nextFri + 1, "16:00", 10000, "beach", "partner", 40],
    ["Soundgarden", "South Social", "Lekki Phase 1", 6.4386, 3.4655, nextFri + 1, "23:00", 10000, "afro", "hoppaz", 68],
    ["Freedom Park Live", "Freedom Park", "Lagos Island", 6.4489, 3.3965, nextFri + 2, "14:00", 3000, "live band", "partner", 36],
  ];
}

/** Sample events, built fresh from `now`. Dev only. */
export function demoEvents(now = Date.now()): EventRow[] {
  return rows(now)
    .filter(([, , , , , day]) => day <= 14)
    .map(([title, venue_name, area, lat, lng, day, hhmm, price_naira, vibe, source, heat], i) => {
      const starts_at = at(now, day, hhmm);
      const started = Date.parse(starts_at);
      // A crowd only exists for something that has started in the last three hours.
      const live = now >= started && now < started + 3 * HOUR;
      return {
        id: `demo-${i + 1}`,
        title,
        venue_name,
        area,
        lat,
        lng,
        starts_at,
        price_naira,
        vibe,
        source,
        ig_url: null,
        flyer_url: null,
        distance_m: 0,
        heat,
        checkins: 0,
        swipes_in: Math.round(heat / 3),
        here_now: live ? Math.round(heat / 5) : 0,
      };
    });
}

/** Titles that get a sample "drop" flag on the map in development. */
export const DEMO_DROP_TITLES = ["Muri Night Market", "Soundgarden", "Jara Sundown"];

/** Same list, built once at import. Prefer demoEvents(): this one goes stale on a long-running dev server. */
export const DEMO_EVENTS: EventRow[] = demoEvents();

/** The sample Hop runs this coming Saturday (today, if today is Saturday). */
export function demoHop(now = Date.now()) {
  return {
    id: "demo-hop",
    name: "HOP 02 · FREEDOM",
    hop_date: nightKey(nightMidnight(now) + daysUntil(now, 6) * DAY + 12 * HOUR),
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
}

export const DEMO_HOP = demoHop();
