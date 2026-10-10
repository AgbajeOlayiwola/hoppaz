import type { Entered, Head, RoomState } from "./api";
import type { Message } from "@/lib/types";

/**
 * Demo mode (no database): a made-up room that only exists on this phone, so the screen can be looked at and
 * tried. Nothing is saved or sent anywhere.
 */

const ALIASES = ["Lekki Raver 51", "Okada Vibe E2", "Molue Vibe CE", "Ankara Vibe C0", "Gele Rider 86", "Owambe Raver 99", "Bridge Raver 97"];

const HEADS: Head[] = ALIASES.map((alias, i) => ({ key: `demo-head-${i}`, alias, look: null }));

export const DEMO_SLOW = { on_now: false, seconds: 10, from: "00:00", to: "05:00" };

/** The room names of the wave 1 zones; any other slug reads as its own words. */
const PLACES: Record<string, string> = { yaba: "Jibowu", lekki: "Lekki Phase 1", "victoria-island": "Adeola Odeku", ikeja: "Allen Roundabout" };
const titled = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function demoEntered(slug: string): Entered {
  const name = PLACES[slug] ?? titled(slug);
  return {
    already_here: false,
    hotspot: { id: `demo-${slug}`, slug, name, zone_name: titled(slug) },
    channel: `hotspot:demo-${slug}`,
    key: "me",
    alias: "Jollof Rider 4F",
    here_band: "some",
    slow: DEMO_SLOW,
    rules: {
      max_len: 240, burst: 5, burst_s: 30, per_hour: 40, dup_s: 60, visible_h: 24, keep_days: 7, stay_s: 300, daily_xp: 10,
      regular_days: 4, entries_per_day: 30, fade_min_s: 600, fade_max_s: 1200,
    },
  };
}

export function demoRoom(e: Entered): RoomState {
  return {
    slug: e.hotspot.slug,
    name: e.hotspot.name,
    channel: e.channel,
    you: { key: e.key, alias: e.alias },
    heads: HEADS,
    here_band: "some",
    here_n: HEADS.length + 1,
    today_band: "busy",
    today_n: 31,
    slow: DEMO_SLOW,
  };
}

export function demoMessages(channel: string): Message[] {
  const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  const say = (i: number, body: string, minsAgo: number): Message => ({
    id: `demo-m${i}`,
    channel,
    body,
    created_at: at(minsAgo),
    author_key: HEADS[i % HEADS.length].key,
    author_name: HEADS[i % HEADS.length].alias,
    author_look: null,
    author_handle: null,
    anon: false,
  });
  return [say(0, "Anyone coming through tonight?", 14), say(1, "Traffic is mad but I dey come", 11), say(2, "Save me a spot by the roundabout", 6)];
}
