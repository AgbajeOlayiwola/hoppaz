"use client";

import { getSupabase } from "@/lib/supabase/client";

/**
 * The room's calls to the database (docs/HOTSPOTS.md section 13). Every Hopper call returns jsonb:
 * {ok: true, ...} or {ok: false, reason}. A network failure or an odd answer is the reason "error";
 * no database at all (local demo) is "offline". Nothing here takes or sends a position.
 */

export type Band = "quiet" | "few" | "some" | "busy" | "packed";
export type Slow = { on_now: boolean; seconds: number; from: string; to: string };
export type Rules = {
  max_len: number;
  burst: number;
  burst_s: number;
  per_hour: number;
  dup_s: number;
  visible_h: number;
  keep_days: number;
  stay_s: number;
  daily_xp: number;
  regular_days: number;
  entries_per_day: number;
  fade_min_s: number;
  fade_max_s: number;
};
/**
 * Someone else in the room: an alias, and a look that is always null (the face is drawn from the alias). Nothing
 * says who you know: no crew flag, no wave flag. That would show which alias a known person is using.
 */
export type Head = { key: string; alias: string; look: unknown };

export type Entered = {
  already_here: boolean;
  hotspot: { id: string; slug: string; name: string; zone_name: string };
  channel: string;
  key: string;
  alias: string;
  here_band: Band;
  slow: Slow;
  rules: Rules;
};

export type RoomState = {
  slug: string;
  name: string;
  channel: string;
  you: { key: string; alias: string };
  heads: Head[];
  here_band: Band;
  here_n: number | null;
  today_band: Band;
  today_n: number | null;
  slow: Slow;
};

export type Pulse = { slug: string; here_band: Band; here_n: number | null };
/** Where this account's avatar is now (it is one place at a time, across every device). */
export type Mine = { has_account: boolean; adult: boolean; in: null | { slug: string; name: string; channel: string; key: string; alias: string; entered_at: string } };
export type Daily = { xp: number; already: boolean; days_here: number; badge: { key: string; name: string } | null };

export type Out<T> = ({ ok: true } & T) | { ok: false; reason: string; wait_s?: number };

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<Out<T>> {
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "offline" };
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error || !data || typeof data !== "object") return { ok: false, reason: "error" };
    return data as Out<T>;
  } catch {
    return { ok: false, reason: "error" };
  }
}

export const enterHotspot = (slug: string) => call<Entered>("enter_hotspot", { p_slug: slug });
export const leaveHotspot = () => call<{ left: boolean }>("leave_hotspot");
export const pulseHotspot = () => call<Pulse>("hotspot_pulse");
export const myHotspot = () => call<Mine>("my_hotspot");
export const readRoom = (slug: string) => call<RoomState>("hotspot_room", { p_slug: slug });
export const confirmAdult = () => call<{ already: boolean }>("confirm_adult");
export const claimDaily = () => call<Daily>("claim_hotspot_daily");
/** ref is a message id or a head's key. */
export const reportHotspot = (ref: string, reason: string) => call<Record<string, never>>("report_hotspot", { p_ref: ref, p_reason: reason });

/** How long the avatar stays in between pings, so the pulse comes well inside the fade (10 to 20 minutes). */
export const PULSE_MS = 30_000;
export const POLL_MS = 15_000;
