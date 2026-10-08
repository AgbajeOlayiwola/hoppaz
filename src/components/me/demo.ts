import { supabaseConfigured } from "@/lib/supabase/client";
import type { GameDrop, Quest } from "@/lib/game";
import type { Profile } from "@/lib/types";
import type { CollectionEntry, DropReceipt } from "@/lib/useCollectibles";

/**
 * DEV-ONLY SAMPLE CONTENT for Me, Drops and the shelf, so `npm run dev` without
 * a database still has something to look at. It is on only in development AND
 * only when the Supabase keys are missing (the same rule the sample events
 * follow), so a player never sees any of it. Nothing here is a real person,
 * partner, code or reward.
 *
 * Everything is a function of "now" and is called after mount, so the server
 * render and the first browser render never disagree.
 */
export const DEMO = process.env.NODE_ENV !== "production" && !supabaseConfigured();

/** Dev only: add ?empty to see the empty states (no nights, no drops, nothing on the shelf). Call after mount. */
export const demoEmpty = () => DEMO && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("empty");

const HOUR = 3.6e6;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

export function demoProfile(): Profile {
  return { id: "demo", display_name: "Temi", area: "Victoria Island", xp: 410, is_admin: false, handle: "JollofRaver4821", avatar: null };
}

export function demoStats() {
  return { daily_streak: 4, verified_outings: 5, outing_streak: 2 };
}

export function demoBadges(now: number) {
  return [
    { key: "mainland", earned_at: iso(now - 20 * DAY) },
    { key: "free", earned_at: iso(now - 12 * DAY) },
    { key: "latenight", earned_at: iso(now - 6 * DAY) },
    { key: "hop", earned_at: iso(now - 2 * DAY) },
  ];
}

export function demoVisits(now: number) {
  const night = (daysAgo: number, title: string, venue: string, area: string, id: string) => ({
    event_id: id,
    created_at: iso(now - daysAgo * DAY),
    title,
    venue,
    area,
  });
  return [
    night(2, "Amapiano Rooftop", "Sky Lounge", "Victoria Island", "d1"),
    night(6, "Comedy at the Shrine", "New Afrika Shrine", "Ikeja", "d2"),
    night(12, "Sunday Brunch Club", "Terra Kulture", "Victoria Island", "d3"),
    night(20, "Highlife Night", "Bature Brewery", "Ikeja", "d4"),
    night(27, "Beach Sundowner", "Landmark Beach", "Oniru", "d5"),
    night(33, "Afrobeats Friday", "Hard Rock Cafe", "Victoria Island", "d6"),
  ];
}

export function demoQuests(): Quest[] {
  const base = { starts_at: iso(0), ends_at: null, badge_key: null, group_size: 0 };
  return [
    { ...base, id: "dq1", key: "daily-out", title: "Be out tonight", description: "", quest_type: "checkin", event_id: null, repeat_period: "daily", xp_reward: 50 },
    { ...base, id: "dq2", key: "weekend-photo", title: "Post a photo from the night", description: "", quest_type: "photo", event_id: "demo-1", repeat_period: "weekly", xp_reward: 30 },
    { ...base, id: "dq3", key: "crew-3", title: "Show up with three of your crew", description: "", quest_type: "group", event_id: null, repeat_period: "weekly", xp_reward: 80, group_size: 3 },
    { ...base, id: "dq4", key: "door-code", title: "Find the code at the door", description: "", quest_type: "qr", event_id: "demo-2", repeat_period: "once", xp_reward: 40 },
  ];
}

/** Event names for the demo quests that are tied to an event. */
export const DEMO_QUEST_EVENTS: Record<string, string> = { "demo-1": "Amapiano Rooftop", "demo-2": "Comedy at the Shrine" };

export function demoDrops(now: number): GameDrop[] {
  const base = { partner_id: null, event_id: null, geog: null, radius_m: 150, reward_model: "fixed" as const };
  return [
    {
      ...base, id: "dd1", title: "Free round on the house", description: "One round for you and one friend. Find the bartender with the green apron.",
      area: "Victoria Island", opens_at: iso(now - 90 * 60_000), closes_at: iso(now + 40 * 60_000), claim_method: "proximity",
      partner: { name: "Sky Lounge", logo_url: null },
    },
    {
      ...base, id: "dd2", title: "Backstage wristband", description: "Scan the code on the DJ booth. First come, first served.",
      area: "Ikeja", opens_at: iso(now - 30 * 60_000), closes_at: iso(now + 5 * HOUR + 30 * 60_000), claim_method: "either",
      partner: { name: "New Afrika Shrine", logo_url: null },
    },
    {
      ...base, id: "dd3", title: "Two tickets, any night", description: "Good for any Hoppaz night this month.",
      area: "Lekki", opens_at: iso(now + 2 * HOUR + 14 * 60_000), closes_at: iso(now + 6 * HOUR), claim_method: "proximity",
      partner: { name: "Hoppaz", logo_url: null },
    },
    {
      ...base, id: "dd4", title: "Rooftop table for six", description: "Scan the venue QR when you arrive.",
      area: "Victoria Island", opens_at: iso(now + 3 * DAY), closes_at: iso(now + 3 * DAY + 3 * HOUR), claim_method: "qr",
      partner: { name: "Sky Lounge", logo_url: null },
    },
  ];
}

export function demoReveal() {
  return { reward: "Free round on the house", description: "Show this to the bartender.", code: "HPZ-4F7K-92QD", xp: 50 };
}

const art = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#2a1b14"/><circle cx="270" cy="120" r="90" fill="#FF4D00"/><rect x="40" y="190" width="320" height="26" fill="#F5EBDD"/><rect x="40" y="228" width="200" height="26" fill="#F5EBDD"/></svg>`
)}`;

export function demoCollection(now: number): CollectionEntry[] {
  const item = (id: string, name: string, emoji: string, event: string, daysAgo: number, art_url: string | null): CollectionEntry => ({
    drop_id: id,
    collected_at: iso(now - daysAgo * DAY),
    event_title: event,
    collectible: { id, key: id, name, description: "Found at the venue.", emoji, art_url },
  });
  return [
    item("c1", "Night Bus Token", "\u{1F68C}", "Amapiano Rooftop", 2, art),
    item("c2", "Shrine Sticker", "\u{1F3A4}", "Comedy at the Shrine", 6, null),
    item("c3", "Brunch Coaster", "\u{1F964}", "Sunday Brunch Club", 12, null),
  ];
}

export function demoReceipts(now: number): DropReceipt[] {
  return [
    { drop_id: "r1", title: "Free round on the house", partner: "Sky Lounge", reward: "One free round", description: "For two. Show the code at the bar.", code: "HPZ-4F7K-92QD", claimed_at: iso(now - 2 * DAY) },
    { drop_id: "r2", title: "Backstage wristband", partner: "New Afrika Shrine", reward: "Backstage pass", description: "Good for the night you claimed it.", code: null, claimed_at: iso(now - 9 * DAY) },
  ];
}
