"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase/client";
import { BADGES } from "./brand";
import { areaByName } from "./geo";
import { useToast } from "./store";
import { requireAccount } from "./accountGate";
import { useSessionStore } from "./useSession";
import type { CheckinClaim, EventRow } from "./types";

export const CHECKIN_RADIUS_M = 1500;

/** Fired once, the first time a Hopper checks in. The install sheet listens: it is its second and last chance. */
export const FIRST_CHECKIN_EVENT = "hoppaz:first-checkin";
const FIRST_CHECKIN_KEY = "hoppaz.firstCheckin";

function markFirstCheckin() {
  try {
    if (localStorage.getItem(FIRST_CHECKIN_KEY)) return;
    localStorage.setItem(FIRST_CHECKIN_KEY, "1");
    window.dispatchEvent(new Event(FIRST_CHECKIN_EVENT));
  } catch {
    /* private mode: skip the install nudge */
  }
}

/**
 * What a check-in attempt came to. The event page reads this to punch the
 * stub (one stamp for the check-in, one per new badge); failures have already
 * been said out loud in a toast, so the page only needs to know they failed.
 */
export type CheckinOutcome =
  | { ok: true; /** ISO time the check-in landed. */ at: string; xp: number; badges: string[] }
  | { ok: false; reason: "no_fix" | "too_far" | "already" | "closed" | "error" | "account" };

/** "latenight" -> "Latenight". Used only when a badge key is not in the BADGES list. */
function prettyKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The name a badge goes by on screen. */
export function badgeName(key: string) {
  return BADGES.find((b) => b.key === key)?.name ?? prettyKey(key);
}

/** The badges the real check-in would hand out, worked out in the browser for the sample night (dev only). */
function demoBadges(event: EventRow) {
  const out: string[] = [];
  if (event.area) out.push(areaByName(event.area)?.side === "island" ? "island" : "mainland");
  if (Number(new Date(Date.parse(event.starts_at) + 3.6e6).getUTCHours()) >= 23) out.push("latenight");
  if (event.price_naira === 0) out.push("free");
  if (event.vibe === "comedy" || event.vibe === "beach") out.push(event.vibe);
  return out;
}

export function useCheckin(userId: string | null, onDone?: () => void) {
  const [done, setDone] = useState<Set<string>>(new Set());
  /** When each check-in landed (ISO), for the events we know it for. */
  const [checkedAt, setCheckedAt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const say = useToast((s) => s.say);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("checkins").select("event_id, created_at").eq("user_id", userId);
      if (cancelled || !data) return;
      setDone(new Set(data.map((r) => String(r.event_id))));
      setCheckedAt(Object.fromEntries(data.filter((r) => r.created_at).map((r) => [String(r.event_id), String(r.created_at)])));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const checkIn = useCallback(
    async (event: EventRow, fix: { lat: number; lng: number } | null): Promise<CheckinOutcome> => {
      if (!fix) {
        say("Set your location first.");
        return { ok: false, reason: "no_fix" };
      }
      const sb = getSupabase();
      if (!sb) {
        // Local demo (no database): let the loop be felt without saving anything anywhere.
        const at = new Date().toISOString();
        setDone((s) => new Set(s).add(event.id));
        setCheckedAt((m) => ({ ...m, [event.id]: at }));
        markFirstCheckin();
        return { ok: true, at, xp: 50, badges: demoBadges(event) };
      }
      // Checking in (and the XP and badges with it) needs an account; the sheet finishes it after.
      if (!requireAccount("check in and earn XP", () => void checkInRef.current(event, fix))) return { ok: false, reason: "account" };
      const uid = useSessionStore.getState().userId ?? userId;
      if (!uid) {
        // Signed-in session not ready yet: never pretend it was saved.
        say("Still connecting. Try again in a moment.", "error");
        return { ok: false, reason: "error" };
      }
      setBusy(event.id);
      const { data, error } = await sb.rpc("claim_checkin", {
        p_event_id: event.id,
        p_lat: fix.lat,
        p_lng: fix.lng,
      });
      setBusy(null);
      if (error) {
        say("Couldn't check you in. Try again.", "error");
        return { ok: false, reason: "error" };
      }
      const res = data as CheckinClaim;
      if (!res.ok) {
        if (res.reason === "too_far") {
          say(`Too far. You're ${Math.round((res.distance_m ?? 0) / 100) / 10} km out.`, "error");
          return { ok: false, reason: "too_far" };
        }
        if (res.reason === "already") {
          setDone((s) => new Set(s).add(event.id));
          say("You're already checked in here.");
          return { ok: false, reason: "already" };
        }
        say("Check-in isn't open for this one.", "error");
        return { ok: false, reason: "closed" };
      }
      const at = new Date().toISOString();
      setDone((s) => new Set(s).add(event.id));
      setCheckedAt((m) => ({ ...m, [event.id]: at }));
      onDone?.();
      markFirstCheckin();
      return { ok: true, at, xp: res.xp, badges: res.badges ?? [] };
    },
    [userId, say, onDone]
  );

  // The sign-up sheet finishes a gated check-in later; this always reaches the newest checkIn.
  const checkInRef = useRef(checkIn);
  useEffect(() => {
    checkInRef.current = checkIn;
  });

  return { done, checkedAt, busy, checkIn };
}
