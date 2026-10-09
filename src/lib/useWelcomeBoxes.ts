"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "./supabase/client";

/** Development only: a laptop has no GPS worth trusting, so a picked area counts too and the welcome boxes can be seen. */
const IS_DEV = process.env.NODE_ENV !== "production";

const doneKey = (userId: string) => `hz-welcome-v1:${userId}`;

function wasDone(userId: string) {
  try {
    return localStorage.getItem(doneKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markDone(userId: string) {
  try {
    localStorage.setItem(doneKey(userId), "1");
  } catch {
    /* private mode: the server answers "already" next time, which is fine */
  }
}

/**
 * A new Hopper gets three personal welcome boxes near where they are, once.
 * The server keeps the real count (spawn_welcome_boxes answers "already" on a
 * repeat), so the localStorage mark only saves a round trip. Demo mode and a
 * missing session do nothing. `onDropped` runs only when boxes were just made.
 * Only a GPS fix counts. A picked area is the centre of that area, not where the
 * Hopper is, and the one-time grant must not be spent on a guess: the call waits
 * until they share their location (in development a picked area counts as well).
 */
export function useWelcomeBoxes(
  userId: string | null,
  fix: { lat: number; lng: number; source: "gps" | "area" } | null,
  onDropped: () => void
) {
  const cb = useRef(onDropped);
  useEffect(() => {
    cb.current = onDropped;
  });
  const asked = useRef<string | null>(null);

  const trusted = fix?.source === "gps" || IS_DEV;
  const lat = trusted ? fix?.lat : undefined;
  const lng = trusted ? fix?.lng : undefined;
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId || lat === undefined || lng === undefined) return;
    if (asked.current === userId || wasDone(userId)) return;
    asked.current = userId;
    // No cleanup flag on purpose: Strict Mode and a moving fix re-run this effect, and the answer must still land.
    void (async () => {
      const { data, error } = await sb.rpc("spawn_welcome_boxes", { p_lat: lat, p_lng: lng });
      const r = data as { ok?: boolean; already?: boolean; reason?: string } | null;
      // A failed call is not retried until the page reloads (an old database has no such function).
      if (error) return;
      if (!r?.ok) {
        // Outside Lagos for now: ask again if the location changes.
        asked.current = null;
        return;
      }
      markDone(userId);
      if (!r.already) cb.current();
    })();
  }, [userId, lat, lng]);
}
