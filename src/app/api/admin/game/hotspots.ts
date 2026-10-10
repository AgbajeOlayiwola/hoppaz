import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The staff side of Hotspots (supabase/hotspots.sql, docs/HOTSPOTS.md section 13) for the admin desk's
 * route: what the Hotspots section reads, and the actions it can take. They are the `admin_hotspot_*`
 * calls of the database, which only the service role can run, so the staff token on the route is the gate.
 * Plain data in and out (no Next types), so a script can run them against a local database.
 *
 * Staff see rooms, aliases and alias keys. They never see a user id or a position: the database does not
 * give them one.
 */

export type HotspotRoomRow = {
  slug: string;
  /** The room's name, the place ("Jibowu"). */
  place: string;
  /** The zone ("Yaba"). */
  zone: string;
  wave: number;
  status: "open" | "planned" | "paused";
  /** Avatars in the room right now. */
  here: number;
  slow_seconds: number;
  slow_from: string;
  slow_to: string;
};

export type HotspotReport = {
  id: string;
  hotspot_slug: string | null;
  alias: string | null;
  key: string | null;
  excerpt: string | null;
  reason: string;
  created_at: string;
  reporters_24h: number;
};

export type HotspotMute = {
  id: string;
  /** Null: every hotspot. */
  hotspot_slug: string | null;
  alias: string | null;
  key: string | null;
  until: string;
  auto: boolean;
  reason: string | null;
  created_at: string;
};

export type HotspotsAdmin = {
  rooms: HotspotRoomRow[];
  reports: HotspotReport[];
  mutes: HotspotMute[];
  words: string[];
  /** Set when the hotspot tables are missing: hotspots.sql has not been run on this database. */
  error?: string;
};

export const emptyHotspots: HotspotsAdmin = { rooms: [], reports: [], mutes: [], words: [] };

type Row = Record<string, unknown>;

/** "Lekki Phase 1 (Admiralty Way)" is "Lekki Phase 1": the same rule as the database's room name. */
const placeName = (junction: unknown, zone: string) => String(junction ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || zone;
const clock = (t: unknown) => String(t ?? "").slice(0, 5);

/** Everything the Hotspots section needs. A database without hotspots.sql gets an error note, not a broken desk. */
export async function hotspotsData(sb: SupabaseClient): Promise<HotspotsAdmin> {
  const [rooms, visits, reports, mutes, words] = await Promise.all([
    sb.from("hotspots").select("slug,name,junction,wave,status,slow_seconds,slow_from,slow_to").in("status", ["active", "planned", "paused"]).order("wave").order("name"),
    sb.from("hotspot_visits").select("hotspot_id,hotspots(slug)").gt("fades_at", new Date().toISOString()),
    sb.rpc("admin_hotspot_reports", { p_open_only: true, p_limit: 50 }),
    sb.rpc("admin_hotspot_mutes", { p_active_only: true }),
    sb.from("hotspot_words").select("word").order("word"),
  ]);
  const failed = [rooms, visits, reports, mutes, words].find((r) => r.error);
  if (failed?.error) return { ...emptyHotspots, error: failed.error.message };

  const here = new Map<string, number>();
  for (const v of (visits.data ?? []) as unknown as { hotspots: { slug: string } | { slug: string }[] | null }[]) {
    const h = Array.isArray(v.hotspots) ? v.hotspots[0] : v.hotspots;
    if (h) here.set(h.slug, (here.get(h.slug) ?? 0) + 1);
  }
  return {
    rooms: ((rooms.data ?? []) as Row[]).map((r) => ({
      slug: String(r.slug),
      place: placeName(r.junction, String(r.name)),
      zone: String(r.name),
      wave: Number(r.wave),
      status: r.status === "active" ? "open" : (r.status as "planned" | "paused"),
      here: here.get(String(r.slug)) ?? 0,
      slow_seconds: Number(r.slow_seconds),
      slow_from: clock(r.slow_from),
      slow_to: clock(r.slow_to),
    })),
    reports: (reports.data ?? []) as HotspotReport[],
    mutes: (mutes.data ?? []) as HotspotMute[],
    words: ((words.data ?? []) as Row[]).map((w) => String(w.word)),
  };
}

type Out = { status: number; body: Record<string, unknown> };
const fail = (message: string, status = 400): Out => ({ status, body: { error: message } });
const done = (body: Record<string, unknown> = {}): Out => ({ status: 200, body: { ok: true, ...body } });

/** The database's reasons, as lines for the desk. */
const REASONS: Record<string, string> = {
  bad_status: "Status is open, planned or paused",
  not_found: "Hotspot not found",
  bad_seconds: "Slow mode: 0 to 120 seconds (0 is off)",
  bad_hours: "Mute for 1 minute up to a year",
  not_a_hotspot_alias: "That key is not a hotspot alias",
  bad_minutes: "Clear 1 to 1440 minutes",
  bad_word: "A word is 2 to 40 characters",
};

type Answer = { error: { message: string } | null; data: unknown };

/** Reads an admin_hotspot_* answer: {ok:true, ...} passes through, {ok:false, reason} becomes a 400. */
function answer(r: Answer): Out {
  if (r.error) return fail(r.error.message, 500);
  const d = (r.data ?? {}) as Row;
  if (d.ok === false) {
    const reason = d.reason ? String(d.reason) : "";
    return reason ? fail(REASONS[reason] ?? `Refused: ${reason}`) : fail("Nothing to change", 404);
  }
  return done(d);
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const slugOf = (v: unknown) => (typeof v === "string" && SLUG.test(v) ? v : null);
const number = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN);

/**
 * Runs one hotspot action. Returns null for an action that is not a hotspot one, so the route can carry on.
 *   hotspot_status      slug, status (open | planned | paused)
 *   hotspot_open_wave   wave (opens every room of that wave that is still planned; a paused one stays paused)
 *   hotspot_slow        slug, seconds, from, to ("HH:MM", Lagos time)
 *   hotspot_mute        key (an alias key from a report), hours, reason, slug (one hotspot) or none (all)
 *   hotspot_unmute      id
 *   hotspot_clear       slug, minutes
 *   hotspot_word_add    word
 *   hotspot_word_remove word
 * Closing a report is the desk's existing resolve_report.
 */
export async function hotspotAction(sb: SupabaseClient, action: string, b: Record<string, unknown>): Promise<Out | null> {
  switch (action) {
    case "hotspot_status": {
      const slug = slugOf(b.slug);
      if (!slug || !["open", "planned", "paused"].includes(String(b.status))) return fail("Pick a hotspot and a status");
      return answer(await sb.rpc("admin_hotspot_set_status", { p_slug: slug, p_status: b.status }));
    }
    case "hotspot_open_wave": {
      const wave = number(b.wave);
      if (!Number.isInteger(wave) || wave < 1 || wave > 9) return fail("Pick a wave");
      const { data, error } = await sb.from("hotspots").select("slug").eq("wave", wave).eq("status", "planned");
      if (error) return fail(error.message, 500);
      let opened = 0;
      for (const r of (data ?? []) as Row[]) {
        const out = answer(await sb.rpc("admin_hotspot_set_status", { p_slug: r.slug, p_status: "open" }));
        if (out.status !== 200) return out;
        opened++;
      }
      return done({ opened });
    }
    case "hotspot_slow": {
      const slug = slugOf(b.slug);
      const seconds = number(b.seconds);
      const from = String(b.from ?? "");
      const to = String(b.to ?? "");
      if (!slug) return fail("Pick a hotspot");
      if (!Number.isInteger(seconds)) return fail(REASONS.bad_seconds);
      if (!CLOCK.test(from) || !CLOCK.test(to)) return fail("Times need the form HH:MM");
      return answer(await sb.rpc("admin_hotspot_set_slow", { p_slug: slug, p_seconds: seconds, p_from: from, p_to: to }));
    }
    case "hotspot_mute": {
      if (typeof b.key !== "string" || !UUID.test(b.key)) return fail("Pick an alias to mute");
      const hours = number(b.hours);
      if (!(hours > 0)) return fail(REASONS.bad_hours);
      let hotspot: string | null = null;
      if (b.slug != null && b.slug !== "") {
        const slug = slugOf(b.slug);
        if (!slug) return fail("Pick a hotspot or all of them");
        const { data, error } = await sb.from("hotspots").select("id").eq("slug", slug).maybeSingle();
        if (error) return fail(error.message, 500);
        if (!data) return fail(REASONS.not_found, 404);
        hotspot = data.id as string;
      }
      return answer(await sb.rpc("admin_hotspot_mute", { p_hotspot: hotspot, p_key: b.key, p_hours: hours, p_reason: String(b.reason ?? "").slice(0, 300) }));
    }
    case "hotspot_unmute": {
      if (typeof b.id !== "string" || !UUID.test(b.id)) return fail("Mute ID required");
      return answer(await sb.rpc("admin_hotspot_unmute", { p_mute: b.id }));
    }
    case "hotspot_clear": {
      const slug = slugOf(b.slug);
      const minutes = number(b.minutes);
      if (!slug) return fail("Pick a hotspot");
      if (!Number.isInteger(minutes)) return fail(REASONS.bad_minutes);
      return answer(await sb.rpc("admin_hotspot_clear", { p_slug: slug, p_minutes: minutes }));
    }
    case "hotspot_word_add":
      return answer(await sb.rpc("admin_hotspot_word_add", { p_word: String(b.word ?? "") }));
    case "hotspot_word_remove":
      return answer(await sb.rpc("admin_hotspot_word_remove", { p_word: String(b.word ?? "") }));
    default:
      return null;
  }
}
