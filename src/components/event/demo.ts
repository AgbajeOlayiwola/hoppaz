import { DEMO_DROP_TITLES } from "@/lib/demoData";
import type { GameDrop, Quest } from "@/lib/game";
import type { EventPhoto, EventRow } from "@/lib/types";

/**
 * DEV-ONLY SAMPLE CONTENT for the event page, so `npm run dev` without a
 * database can still show a quest, a drop and a flyer. Everything here is gated
 * on a "demo-" event id, which only exists in development (see demoData.ts), so
 * a player never sees any of it.
 */
export const isDemoEvent = (id: string) => process.env.NODE_ENV !== "production" && id.startsWith("demo-");

export function demoQuests(eventId: string): Quest[] {
  if (!isDemoEvent(eventId)) return [];
  const base = { event_id: eventId, starts_at: new Date(0).toISOString(), ends_at: null, repeat_period: "once", badge_key: null, group_size: 0 };
  return [
    { ...base, id: `${eventId}-q1`, key: "photo", title: "Post a photo here", description: "Check in, then add one picture from the night.", quest_type: "photo", xp_reward: 50 },
    { ...base, id: `${eventId}-q2`, key: "qr", title: "Find the code at the door", description: "Scan it or type it in.", quest_type: "qr", xp_reward: 30 },
    { ...base, id: `${eventId}-q3`, key: "group", title: "Show up with your crew", description: "Pick the crew you came with.", quest_type: "group", xp_reward: 80, group_size: 3 },
  ];
}

/** A sample drop on the events the map already flags with one (DEMO_DROP_TITLES). */
export function demoDrop(event: EventRow): GameDrop | null {
  if (!isDemoEvent(event.id) || !DEMO_DROP_TITLES.includes(event.title)) return null;
  const opens = new Date(Date.parse(event.starts_at) + 3.6e6).toISOString();
  return {
    id: `${event.id}-drop`,
    title: "Night box",
    description: "A sample reward.",
    partner_id: null,
    event_id: event.id,
    area: event.area,
    geog: null,
    opens_at: opens,
    closes_at: new Date(Date.parse(event.starts_at) + 8 * 3.6e6).toISOString(),
    radius_m: 150,
    claim_method: "proximity",
    reward_model: "fixed",
    partner: null,
  };
}

/** A typographic stand-in flyer on every other sample event, so both art states show. */
export function demoFlyer(event: EventRow): string | null {
  if (!isDemoEvent(event.id) || event.flyer_url) return event.flyer_url;
  const n = Number(event.id.replace("demo-", ""));
  if (!Number.isFinite(n) || n % 2 === 1) return null;
  const title = event.title.toUpperCase().replace(/[&<>"]/g, "").slice(0, 26);
  const words = title.split(" ");
  const half = Math.ceil(words.length / 2);
  const l1 = words.slice(0, half).join(" ");
  const l2 = words.slice(half).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<rect width="800" height="1000" fill="#2a1b14"/><rect x="40" y="40" width="720" height="920" fill="none" stroke="#F5EBDD" stroke-width="4"/>
<circle cx="600" cy="300" r="190" fill="#FF4D00"/>
<text x="70" y="700" font-family="Arial Black, Helvetica, sans-serif" font-weight="900" font-size="84" fill="#F5EBDD">${l1}</text>
<text x="70" y="820" font-family="Arial Black, Helvetica, sans-serif" font-weight="900" font-size="84" fill="#F5EBDD">${l2}</text>
<text x="70" y="900" font-family="Courier New, monospace" font-size="38" fill="#F5EBDD">${(event.venue_name || "").toUpperCase().replace(/[&<>"]/g, "").slice(0, 28)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Three plain colour-block "photos" on every fourth sample event, so the photo strip can be seen. */
export function demoPhotos(event: EventRow): EventPhoto[] {
  const n = Number(event.id.replace("demo-", ""));
  if (!isDemoEvent(event.id) || !Number.isFinite(n) || n % 4 !== 0) return [];
  const tones = ["#5a3b2a", "#2f4a46", "#6b2f2a"];
  return tones.map((fill, i) => ({
    id: `${event.id}-p${i}`,
    event_id: event.id,
    user_id: "sample",
    path: "",
    created_at: new Date().toISOString(),
    url: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="${fill}"/><circle cx="${90 + i * 60}" cy="${140 + i * 30}" r="70" fill="#F5EBDD" fill-opacity=".18"/></svg>`)}`,
  }));
}
