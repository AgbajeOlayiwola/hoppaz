"use client";

import { useEffect } from "react";
import { create } from "zustand";

/**
 * Whether the map is in Play, and the doorbell for the first-run intro.
 *
 * Play is an overlay on the same map at "/", not a route. Entering pushes one
 * history entry, so the phone's back button leaves Play (the exit arrow does the
 * same thing through enter/exit here). Anything that wants to know the mode
 * (the bottom nav, the toaster, the page's tickers) reads `active`.
 *
 * INTRO HOOKS. The Paz the Conductor onboarding is a later step; it listens here
 * and never reaches into the shell. Three moments, each with a `first` flag that
 * is true only on this device's first time:
 *   - "enter"            Play opened (`first` true the very first time)
 *   - "first-box-opened" a box was opened and paid (only ever once per device)
 *   - "welcome-done"     all three welcome boxes are open (only ever once per device)
 * Subscribe with onPlayEvent(fn), or listen on window for the "hz:play" CustomEvent
 * (detail is the same object). Both fire after the thing happened, never before.
 */

export type PlayEvent =
  | { type: "enter"; first: boolean }
  | { type: "exit" }
  | { type: "first-box-opened"; boxId: string; kind: string }
  | { type: "welcome-done" };

type Listener = (e: PlayEvent) => void;
const listeners = new Set<Listener>();

/** Hear Play's moments. Returns the unsubscribe. */
export function onPlayEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitPlayEvent(e: PlayEvent) {
  listeners.forEach((fn) => {
    try {
      fn(e);
    } catch (err) {
      console.warn("[hoppaz] play listener:", err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent("hz:play", { detail: e }));
  } catch {
    /* no window (server render): nothing to tell */
  }
}

/* ----------------------------------------------- what this device has seen -- */
const SEEN_KEY = "hz-play-seen-v1";
type Seen = { enter: boolean; box: boolean; welcome: boolean };

function readSeen(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Partial<Seen>;
    return { enter: !!raw.enter, box: !!raw.box, welcome: !!raw.welcome };
  } catch {
    return { enter: false, box: false, welcome: false };
  }
}

/** Remember a first, and say whether it was one. Private mode cannot remember, so it counts every time as the first. */
export function markFirst(which: keyof Seen): boolean {
  const seen = readSeen();
  if (seen[which]) return false;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen, [which]: true }));
  } catch {
    /* private mode */
  }
  return true;
}

/** What this device has already been through. The intro reads it to decide what to show. */
export const playSeen = readSeen;

/* ------------------------------------------------------------------ mode -- */
type PlayState = {
  active: boolean;
  /** Start Play (the Play layer does the camera). */
  enter: () => void;
  /** Leave Play (the arrow, idle timeout, or the back button). */
  exit: () => void;
  /** The map page went away while Play was open: drop the flag without touching history. */
  reset: () => void;
};

let pushed = false;

export const usePlayMode = create<PlayState>((set, get) => ({
  active: false,
  enter: () => {
    if (get().active) return;
    set({ active: true });
    try {
      // Spread the current state so Next's own bookkeeping on the entry survives.
      window.history.pushState({ ...(window.history.state ?? {}), hzPlay: true }, "");
      pushed = true;
    } catch {
      pushed = false;
    }
    emitPlayEvent({ type: "enter", first: markFirst("enter") });
  },
  exit: () => {
    if (!get().active) return;
    set({ active: false });
    emitPlayEvent({ type: "exit" });
    if (pushed) {
      pushed = false;
      try {
        window.history.back();
      } catch {
        /* nothing to pop */
      }
    }
  },
  reset: () => {
    pushed = false;
    set({ active: false });
  },
}));

/** Mount once: the phone's back button leaves Play instead of leaving the map. */
export function usePlayBackButton() {
  useEffect(() => {
    const onPop = () => {
      if (!usePlayMode.getState().active) return;
      pushed = false; // the browser already popped our entry
      usePlayMode.getState().exit();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
