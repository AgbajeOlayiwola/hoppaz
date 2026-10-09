"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase/client";
import type { PlayBox, PlayInfo, PlayTier, TickRefusal } from "./playTypes";

/**
 * The Play heartbeat (docs/PLAY-API.md): play_tick(lat, lng, accuracy) every 20 s
 * (30 s on a low tier), paused while the tab is hidden. Each call writes the
 * server's one rounded copy of your position and answers with your open boxes.
 *
 * Quiet by design: after 5 minutes without a touch the beat stops (the next touch
 * wakes it with an immediate tick), and after 10 minutes without one Play ends
 * (`onIdle`). The server takes one accepted call per 15 s, so an early request
 * waits for its turn rather than being refused.
 */

const MIN_GAP_MS = 15_500;
const SLEEP_AFTER_MS = 5 * 60_000;
const EXIT_AFTER_MS = 10 * 60_000;

const TIERS: PlayTier[] = ["common", "rare", "epic", "legendary"];

type RawBox = {
  id?: string;
  kind?: string;
  tier?: string;
  lat?: number;
  lng?: number;
  closes_at?: string;
  needs_presence?: boolean;
  slot?: string | null;
};

type RawTick = {
  ok?: boolean;
  reason?: string;
  retry_in_s?: number;
  night?: boolean;
  play_day?: string;
  small_left_today?: number;
  welcome_left?: number;
  boxes?: RawBox[];
};

function toBox(r: RawBox): PlayBox | null {
  if (!r.id || typeof r.lat !== "number" || typeof r.lng !== "number") return null;
  const tier = TIERS.includes(r.tier as PlayTier) ? (r.tier as PlayTier) : "common";
  const slot = r.slot === "a" || r.slot === "b" || r.slot === "c" ? r.slot : null;
  return {
    id: r.id,
    kind: r.kind ?? "near",
    tier,
    lat: r.lat,
    lng: r.lng,
    closesAt: r.closes_at ?? "",
    needsPresence: !!r.needs_presence,
    slot,
  };
}

export type TickPos = { lat: number; lng: number; accuracy: number };

export type TickOptions = {
  /** Play is open. */
  active: boolean;
  userId: string | null;
  /** Seconds between beats, in ms (20 s, 30 s on a low tier). */
  everyMs: number;
  /** The fresh position to send, or null when we are still finding the Hopper. Read at the moment of each beat. */
  getPos: () => TickPos | null;
  /** True when a fresh position exists, so a position arriving starts the first beat. */
  hasPos: boolean;
  /** Runs once before the first beat of a session (welcome boxes are made here, so the beat can return them). */
  beforeFirst?: (pos: TickPos) => Promise<void>;
  /** 10 minutes without a touch: Play should end. */
  onIdle: () => void;
};

/**
 * The tick controller. `boxes` are the Hopper's own open boxes; `removeBox` drops one the moment it is opened (a
 * beat already in flight cannot bring it back). No database (the development demo) means no beat; the caller fills
 * the boxes with `setBoxes`.
 */
export function usePlayTick({ active, userId, everyMs, getPos, hasPos, beforeFirst, onIdle }: TickOptions) {
  const [boxes, setBoxes] = useState<PlayBox[]>([]);
  const [info, setInfo] = useState<PlayInfo>({ night: false, playDay: null, smallLeft: null, welcomeLeft: 0 });
  const [refusal, setRefusal] = useState<TickRefusal>(null);
  const [sleeping, setSleeping] = useState(false);
  /** The first answer has landed (so "no boxes" is a fact, not a loading state). */
  const [answered, setAnswered] = useState(false);

  const gone = useRef(new Set<string>());
  const inFlight = useRef(false);
  const lastSent = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  const lastTouch = useRef(Date.now());
  const asleep = useRef(false);
  const opts = useRef({ getPos, beforeFirst, onIdle, userId });
  useEffect(() => {
    opts.current = { getPos, beforeFirst, onIdle, userId };
  });

  const run = useCallback(async () => {
    const sb = getSupabase();
    const { getPos: pos, beforeFirst: before, userId: uid } = opts.current;
    if (!sb || !uid || inFlight.current || document.visibilityState !== "visible") return;
    const p = pos();
    if (!p) return;
    const wait = lastSent.current + MIN_GAP_MS - Date.now();
    if (wait > 0) {
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => void run(), wait);
      return;
    }
    inFlight.current = true;
    lastSent.current = Date.now();
    try {
      if (first.current) {
        first.current = false;
        await before?.(p).catch(() => {});
      }
      const { data, error } = await sb.rpc("play_tick", { p_lat: p.lat, p_lng: p.lng, p_accuracy: p.accuracy });
      // An old database has no play_tick; a flaky network fails the call. Either way: keep what is on the map.
      if (error || !data) return;
      const r = data as RawTick;
      if (!r.ok) {
        if (r.reason === "too_soon") {
          if (retry.current) clearTimeout(retry.current);
          retry.current = setTimeout(() => void run(), Math.max(1, r.retry_in_s ?? 5) * 1000 + 400);
        } else if (r.reason === "need_account" || r.reason === "outside_lagos" || r.reason === "location_required") {
          setRefusal(r.reason);
        }
        return;
      }
      setRefusal(null);
      setAnswered(true);
      setBoxes(
        (r.boxes ?? [])
          .map(toBox)
          .filter((b): b is PlayBox => !!b && !gone.current.has(b.id))
      );
      setInfo({
        night: !!r.night,
        playDay: r.play_day ?? null,
        smallLeft: typeof r.small_left_today === "number" ? r.small_left_today : null,
        welcomeLeft: r.welcome_left ?? 0,
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  // The beat itself, and the quiet rules.
  useEffect(() => {
    if (!active) {
      first.current = true;
      asleep.current = false;
      gone.current.clear();
      return;
    }
    lastTouch.current = Date.now();
    asleep.current = false;
    const wake = () => {
      lastTouch.current = Date.now();
      if (asleep.current) {
        asleep.current = false;
        setSleeping(false);
        void run();
      }
    };
    const events = ["pointerdown", "keydown"] as const;
    events.forEach((e) => document.addEventListener(e, wake, true));
    const beat = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const idle = Date.now() - lastTouch.current;
      if (idle >= EXIT_AFTER_MS) return opts.current.onIdle();
      if (idle >= SLEEP_AFTER_MS) {
        asleep.current = true;
        setSleeping(true);
        return;
      }
      void run();
    }, everyMs);
    const visible = () => document.visibilityState === "visible" && void run();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(beat);
      events.forEach((e) => document.removeEventListener(e, wake, true));
      document.removeEventListener("visibilitychange", visible);
      if (retry.current) clearTimeout(retry.current);
    };
  }, [active, everyMs, run]);

  // The first beat goes the moment there is a position and a session (and again when a lost position comes back).
  useEffect(() => {
    if (active && hasPos && userId) void run();
  }, [active, hasPos, userId, run]);

  const removeBox = useCallback((id: string) => {
    gone.current.add(id);
    setBoxes((list) => list.filter((b) => b.id !== id));
  }, []);

  return { boxes, info, refusal, sleeping, answered, setBoxes, removeBox, tickNow: run };
}
