"use client";

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import type { Profile } from "./types";

/**
 * The session, held once for the whole app. Supabase anonymous sign-in gives
 * every Hopper a real user id on first open; making an account attaches an
 * email to that same id, and logging in swaps to another one. Every screen
 * reads this one store, so a sign-up or log-in shows everywhere at once,
 * without a reload, and only one anonymous user is ever made per phone.
 */

type SessionState = {
  userId: string | null;
  /** Set once the Hopper has an account (email + password); null while anonymous. */
  email: string | null;
  profile: Profile | null;
  state: "loading" | "ready" | "offline";
  set: (patch: Partial<Omit<SessionState, "set">>) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  email: null,
  profile: null,
  state: "loading",
  set: (patch) => set(patch),
}));

async function loadProfile(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
  // Only if still the same person: a log-in may have swapped users meanwhile.
  if (data && useSessionStore.getState().userId === id) useSessionStore.getState().set({ profile: data as Profile });
}

let started = false;

/** Runs once per page load: find or make the session, then follow every change to it. */
function start() {
  if (started) return;
  started = true;
  const sb = getSupabase();
  const { set } = useSessionStore.getState();
  if (!sb) return set({ state: "offline" });

  const adopt = (user: { id: string; email?: string | null } | null) => {
    const { userId: before, email: hadEmail } = useSessionStore.getState();
    set({ userId: user?.id ?? null, email: user?.email || null });
    if (user && user.id !== before) {
      set({ profile: null });
      void loadProfile(user.id).then(() => set({ state: "ready" }));
    } else if (user && (user.email || null) !== hadEmail) {
      // Same person, just made an account: the sign-up set their name, so read it back.
      void loadProfile(user.id).then(() => set({ state: "ready" }));
    } else if (user) {
      set({ state: "ready" });
    }
  };

  const anonymous = async () => {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      // Almost always: anonymous sign-ins are still switched off in the
      // Supabase dashboard. Say so rather than failing silently.
      console.warn("[hoppaz] anonymous sign-in failed:", error.message);
      set({ state: "offline" });
      return;
    }
    adopt(data.user);
  };

  void sb.auth.getSession().then(({ data, error }) => {
    if (data.session) return adopt(data.session.user);
    // A stored session whose refresh failed only because the network did is still this Hopper's:
    // signing in again would overwrite it with a new anonymous account (and orphan the XP, badges and streak).
    // Any other refresh failure means the server turned the session down and it has been cleared, so a fresh start is right.
    if (error && isAuthRetryableFetchError(error)) {
      console.warn("[hoppaz] session start-up failed:", error.message);
      return set({ state: "offline" });
    }
    void anonymous();
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      // Logging out leaves you as a fresh anonymous Hopper, like a first open.
      set({ userId: null, email: null, profile: null, state: "loading" });
      void anonymous();
      return;
    }
    if (session?.user) adopt(session.user);
  });
}

export function useSession() {
  const { userId, email, profile, state, set } = useSessionStore();

  useEffect(() => {
    start();
  }, []);

  const patchProfile = useCallback(
    async (patch: Partial<Pick<Profile, "display_name" | "area" | "avatar">>) => {
      const sb = getSupabase();
      if (!sb || !userId) return;
      const p = useSessionStore.getState().profile;
      if (p) set({ profile: { ...p, ...patch } });
      await sb.from("profiles").update(patch).eq("id", userId);
    },
    [userId, set]
  );

  const refresh = useCallback(() => {
    if (userId) void loadProfile(userId);
  }, [userId]);

  return { userId, email, hasAccount: !!email, profile, state, patchProfile, refresh };
}
