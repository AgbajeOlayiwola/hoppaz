"use client";

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

/** Users we have already asked about in this page load, so Strict Mode and a moving fix do not ask twice. */
const asked = new Set<string>();

export type WelcomeResult = "created" | "already" | "skipped" | "failed";

/**
 * A new Hopper gets three personal welcome boxes near where they are, once.
 * Play calls this with its first fresh position just before the first heartbeat,
 * so the heartbeat can return the boxes. The server keeps the real count
 * (spawn_welcome_boxes answers "already" on a repeat), so the localStorage mark
 * only saves a round trip. Demo mode and a missing session do nothing.
 *
 * Only a fresh GPS reading counts (`fresh` is the caller's word that it is one).
 * A picked area is the centre of that area, not where the Hopper is, and the
 * one-time grant must not be spent on a guess; in development a picked area
 * counts as well, so the boxes can be seen on a laptop.
 */
export async function ensureWelcomeBoxes(
  userId: string | null,
  pos: { lat: number; lng: number; fresh: boolean } | null
): Promise<WelcomeResult> {
  const sb = getSupabase();
  if (!sb || !userId || !pos) return "skipped";
  if (!pos.fresh && !IS_DEV) return "skipped";
  if (wasDone(userId)) return "already";
  if (asked.has(userId)) return "skipped";
  asked.add(userId);
  const { data, error } = await sb.rpc("spawn_welcome_boxes", { p_lat: pos.lat, p_lng: pos.lng });
  const r = data as { ok?: boolean; already?: boolean } | null;
  // A failed call is not retried until the page reloads (an old database has no such function).
  if (error) return "failed";
  if (!r?.ok) {
    // Outside Lagos for now: ask again if the location changes.
    asked.delete(userId);
    return "failed";
  }
  markDone(userId);
  return r.already ? "already" : "created";
}
