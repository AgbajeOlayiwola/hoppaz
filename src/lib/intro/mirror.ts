import { getSupabase } from "@/lib/supabase/client";

/**
 * "Mirrored to a tiny profile flag only if one already exists." There is no
 * table for this and none is added here. If the profiles row the app already
 * loads happens to carry one of these columns, a Hopper who finished the tour
 * on another phone is not shown it again, and finishing it writes the flag.
 * Without such a column both functions do nothing.
 */
const FLAGS = ["intro_done", "intro_seen_at", "onboarded", "onboarded_at", "tour_done", "tour_seen_at"] as const;

const flagKey = (profile: Record<string, unknown> | null | undefined) =>
  profile ? FLAGS.find((k) => Object.prototype.hasOwnProperty.call(profile, k)) ?? null : null;

/** True when the profile row has a flag column and it says the tour is over. */
export function profileSaysDone(profile: Record<string, unknown> | null | undefined): boolean {
  const k = flagKey(profile);
  return !!k && !!profile?.[k];
}

/** Writes the flag, if the column exists. Quiet on any failure. */
export function mirrorDone(profile: Record<string, unknown> | null | undefined, userId: string | null): void {
  const k = flagKey(profile);
  const sb = getSupabase();
  if (!k || !sb || !userId) return;
  const value = k.endsWith("_at") ? new Date().toISOString() : true;
  void Promise.resolve(sb.from("profiles").update({ [k]: value }).eq("id", userId)).catch(() => {});
}
