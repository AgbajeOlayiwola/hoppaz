"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import type { Profile } from "./types";

/**
 * No sign-up. Supabase anonymous sign-in gives every Hopper a real user id on
 * first open, so XP, badges and check-ins survive a refresh and a phone swap
 * later if they ever choose to attach an email.
 */
export function useSession() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");

  const loadProfile = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
    if (data) setProfile(data as Profile);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setState("offline");
      return;
    }
    let cancelled = false;

    (async () => {
      const { data: got } = await sb.auth.getSession();
      let id = got.session?.user.id ?? null;
      if (!id) {
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) {
          // Almost always: anonymous sign-ins are still switched off in the
          // Supabase dashboard. Say so rather than failing silently.
          console.warn("[hoppaz] anonymous sign-in failed:", error.message);
          if (!cancelled) setState("offline");
          return;
        }
        id = data.user?.id ?? null;
      }
      if (cancelled || !id) return;
      setUserId(id);
      await loadProfile(id);
      if (!cancelled) setState("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const patchProfile = useCallback(
    async (patch: Partial<Pick<Profile, "display_name" | "area" | "avatar">>) => {
      const sb = getSupabase();
      if (!sb || !userId) return;
      setProfile((p) => (p ? { ...p, ...patch } : p));
      await sb.from("profiles").update(patch).eq("id", userId);
    },
    [userId]
  );

  const refresh = useCallback(() => {
    if (userId) void loadProfile(userId);
  }, [userId, loadProfile]);

  return { userId, profile, state, patchProfile, refresh };
}
