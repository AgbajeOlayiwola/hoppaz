"use client";

import { useEffect, useState } from "react";
import { useHoppaz } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";

/** One profile read per session, shared by every event page you open. */
const fetched = new Map<string, unknown>();

/**
 * Your own face: the look saved on your profile, or the local copy from the
 * avatar editor when the profile has none (or there is no database at all).
 * Pass it to <Avatar look={...} />, which falls back to the default look.
 */
export function useMyLook(userId: string | null): unknown {
  const stored = useHoppaz((s) => s.look);
  const [remote, setRemote] = useState<unknown>(() => (userId ? (fetched.get(userId) ?? null) : null));

  useEffect(() => {
    if (!userId || fetched.has(userId)) return;
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;
    void sb
      .from("profiles")
      .select("avatar")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        fetched.set(userId, data?.avatar ?? null);
        if (!cancelled) setRemote(data?.avatar ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return remote ?? stored;
}
