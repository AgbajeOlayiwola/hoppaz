"use client";

import { useCallback, useEffect, useState } from "react";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import type { Profile } from "./types";

type Started = { id: string | null; email: string | null; failed: boolean };
let starting: Promise<Started> | null = null;

/**
 * Reads the stored session, or makes the anonymous one when there is none.
 * One start-up at a time per page: React Strict Mode (development) runs the
 * effect twice, and two sign-ins would make two anonymous users, with the
 * page holding one and the welcome boxes (or a claim) landing on the other.
 */
function startSession(sb: SupabaseClient): Promise<Started> {
  starting ??= (async (): Promise<Started> => {
    try {
      const { data: got, error: readError } = await sb.auth.getSession();
      const user = got.session?.user;
      if (user) return { id: user.id, email: user.email || null, failed: false };
      // A stored session whose refresh failed only because the network did is still this Hopper's:
      // signing in again would overwrite it with a new anonymous account (and orphan the XP, badges and streak).
      // Any other refresh failure means the server turned the session down and it has been cleared, so a fresh start is right.
      if (readError && isAuthRetryableFetchError(readError)) throw readError;
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      return { id: data.user?.id ?? null, email: null, failed: false };
    } catch (e) {
      // Almost always: anonymous sign-ins are still switched off in the
      // Supabase dashboard (or the network is down). Say so rather than failing silently.
      console.warn("[hoppaz] session start-up failed:", e instanceof Error ? e.message : e);
      return { id: null, email: null, failed: true };
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/**
 * No sign-up. Supabase anonymous sign-in gives every Hopper a real user id on
 * first open, so XP, badges and check-ins survive a refresh and a phone swap
 * later if they ever choose to attach an email.
 */
export function useSession() {
  const [userId, setUserId] = useState<string | null>(null);
  /** Set once the Hopper has made an account (email + password); null while anonymous. */
  const [email, setEmail] = useState<string | null>(null);
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
      const started = await startSession(sb);
      if (cancelled) return;
      if (started.failed) {
        setState("offline");
        return;
      }
      setEmail(started.email);
      if (!started.id) return;
      setUserId(started.id);
      await loadProfile(started.id);
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

  return { userId, email, hasAccount: !!email, profile, state, patchProfile, refresh };
}
