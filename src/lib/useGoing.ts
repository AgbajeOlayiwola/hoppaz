"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { getSupabase } from "./supabase/client";
import { NEED_ACCOUNT, requireAccount } from "./accountGate";
import { useSessionStore } from "./useSession";
import { sfx } from "./sound/sfx";
import { haptics } from "./haptics";

/**
 * "I'm going", shared by the event page, the Today list and the swipe mode.
 *
 * It is the same row a right swipe has always written (public.swipes,
 * decision "in"), so the going count (events_near.swipes_in) and the map heat
 * keep working unchanged. Swipes are private to each Hopper: only your own
 * choices are ever read back.
 *
 * The table allows insert and delete of your own rows but not update, so
 * changing an old "pass" to "in" deletes the old row first. Tapping again
 * undoes it. The button only shows "going" after the save succeeds.
 */

type Decision = "in" | "pass";

type GoingState = {
  loadedFor: string | null;
  decisions: Record<string, Decision>;
  busy: Record<string, boolean>;
  setLoaded: (userId: string, decisions: Record<string, Decision>) => void;
  setDecision: (eventId: string, d: Decision | null) => void;
  setBusy: (eventId: string, b: boolean) => void;
};

const useGoingStore = create<GoingState>((set) => ({
  loadedFor: null,
  decisions: {},
  busy: {},
  setLoaded: (loadedFor, decisions) => set({ loadedFor, decisions }),
  setDecision: (eventId, d) =>
    set((s) => {
      const next = { ...s.decisions };
      if (d) next[eventId] = d;
      else delete next[eventId];
      return { decisions: next };
    }),
  setBusy: (eventId, b) => set((s) => ({ busy: { ...s.busy, [eventId]: b } })),
}));

/** Fired once, the first time a Hopper says they're going. The install sheet listens. */
export const FIRST_GOING_EVENT = "hoppaz:first-going";
const FIRST_GOING_KEY = "hoppaz.firstGoing";

function markFirstGoing() {
  try {
    if (localStorage.getItem(FIRST_GOING_KEY)) return;
    localStorage.setItem(FIRST_GOING_KEY, "1");
    window.dispatchEvent(new Event(FIRST_GOING_EVENT));
  } catch {
    /* private mode: skip the install nudge */
  }
}

/**
 * WE OUTSIDE took (GAMIFY-NEXT 5.2): the small crowd "ehn" and a short buzz. Only when the toggle turns ON and
 * the save went through, so undoing, an error and the sign-up gate stay silent. The gated tap that the sheet
 * finishes after sign-up sounds when it lands, with the button that flips on screen.
 */
function weOutside() {
  sfx.outside();
  haptics.buzz("outside");
}

export function useGoing(userId: string | null) {
  const { loadedFor, decisions, busy, setLoaded, setDecision, setBusy } = useGoingStore();

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId || loadedFor === userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("swipes").select("event_id, decision").eq("user_id", userId);
      if (cancelled || !data) return;
      const map: Record<string, Decision> = {};
      for (const r of data) map[String(r.event_id)] = r.decision as Decision;
      setLoaded(userId, map);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, loadedFor, setLoaded]);

  const isGoing = useCallback((eventId: string) => decisions[eventId] === "in", [decisions]);
  const hasJudged = useCallback((eventId: string) => eventId in decisions, [decisions]);

  /**
   * Save a decision. Returns an error message for the person, or null on
   * success. Without Supabase (local demo) it only changes the screen.
   */
  const decide = useCallback(
    async (eventId: string, decision: Decision | null): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb) {
        setDecision(eventId, decision);
        if (decision === "in") {
          markFirstGoing();
          weOutside();
        }
        return null;
      }
      // Saying you're going needs an account; the sheet opens and finishes this after.
      if (decision === "in" && !requireAccount("say we outside", () => void decideRef.current(eventId, decision))) return NEED_ACCOUNT;
      // Read the id fresh: a log-in from the sheet may have just swapped users.
      const uid = useSessionStore.getState().userId ?? userId;
      if (!uid) return "Still connecting. Try again in a moment.";
      setBusy(eventId, true);
      try {
        if (eventId in useGoingStore.getState().decisions) {
          const { error } = await sb.from("swipes").delete().eq("user_id", uid).eq("event_id", eventId);
          if (error) return "That didn't save. Try again.";
        }
        if (decision) {
          const { error } = await sb.from("swipes").insert({ user_id: uid, event_id: eventId, decision });
          if (error) return "That didn't save. Try again.";
        }
        setDecision(eventId, decision);
        if (decision === "in") {
          markFirstGoing();
          weOutside();
        }
        return null;
      } finally {
        setBusy(eventId, false);
      }
    },
    [userId, setBusy, setDecision]
  );

  // The sheet finishes a gated decision later; this always reaches the newest decide.
  const decideRef = useRef(decide);
  useEffect(() => {
    decideRef.current = decide;
  });

  /** I'M GOING toggles: going -> not decided, anything else -> going. */
  const toggleGoing = useCallback(
    (eventId: string) => decide(eventId, decisions[eventId] === "in" ? null : "in"),
    [decide, decisions]
  );

  return { decisions, busy, isGoing, hasJudged, decide, toggleGoing };
}
