"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { useSessionStore } from "./useSession";

/**
 * Every swipe on the Today deck, left and right, for the data
 * (supabase/swipe_log.sql). One row per swipe, never changed: the deck is
 * endless, so the same event can be swiped many times and each one counts.
 * Guests log too (their anonymous session); only WE OUTSIDE needs an account.
 *
 * Fire and forget: a swipe never waits on this, and a lost row is not worth
 * an error on screen. The local demo (no database, demo- ids) logs nothing.
 */
export function logSwipe(eventId: string, direction: "right" | "left", surface = "today") {
  const sb = getSupabase();
  if (!sb || eventId.startsWith("demo-") || !useSessionStore.getState().userId) return;
  void sb
    .from("swipe_log")
    .insert({ event_id: eventId, direction, surface })
    .then(({ error }) => {
      if (error && process.env.NODE_ENV !== "production") console.warn("swipe log:", error.message);
    });
}

const LIKED_KEY = "hoppaz.likedAsGuest";

function readLiked(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIKED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLiked(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(LIKED_KEY, JSON.stringify(ids));
    else localStorage.removeItem(LIKED_KEY);
  } catch {
    /* private mode: they stay for this visit only */
  }
}

/**
 * The events a guest swiped right on before making an account. WE OUTSIDE is
 * saved on an account (it is what sends the group chat invite), so until then
 * they are kept on this phone, shown in your WE OUTSIDE list, and saved for
 * real the moment you sign up or log in (`save` is the going hook's decide).
 */
export function useGuestLikes(save: (eventId: string) => Promise<string | null>) {
  const email = useSessionStore((s) => s.email);
  const [liked, setLiked] = useState<string[]>([]);
  useEffect(() => setLiked(readLiked()), []);

  const add = useCallback((eventId: string) => {
    setLiked((l) => {
      const next = l.includes(eventId) ? l : [...l, eventId];
      writeLiked(next);
      return next;
    });
  }, []);

  // Signed in: save them all as going, and keep only the ones that did not save.
  useEffect(() => {
    if (!email) return;
    const ids = readLiked();
    if (!ids.length) return;
    let alive = true;
    void (async () => {
      const left: string[] = [];
      for (const id of ids) if (await save(id)) left.push(id);
      writeLiked(left);
      if (alive) setLiked(left);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per sign-in; save changes every render
  }, [email]);

  return { liked, add };
}
