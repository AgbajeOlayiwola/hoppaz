"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import clsx from "clsx";
import { requireAccount } from "@/lib/accountGate";
import { introEvent, registerIntroAction } from "@/lib/intro";
import { introSetOpening } from "@/lib/intro/store";
import { deviceTier, playTuning } from "@/lib/deviceTier";
import type { PlayBox } from "@/lib/playTypes";
import { sfx } from "@/lib/sound/sfx";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { lagosDate } from "@/components/me/lagosDay";
import { DEMO } from "@/components/me/demo";
import { loadCollection } from "@/lib/useCollectibles";
import { setDevPosition, useGeoPermission, useLivePosition } from "@/lib/useLivePosition";
import { emitPlayEvent, markFirst, playSeen, usePlayBackButton, usePlayMode } from "@/lib/usePlayMode";
import { usePlayTick } from "@/lib/usePlayTick";
import { useSession } from "@/lib/useSession";
import { ensureWelcomeBoxes } from "@/lib/useWelcomeBoxes";
import Avatar, { type AvatarHandle } from "./Avatar";
import Crate, { TIER_ART } from "./Crate";
import Hud, { type HudHandle } from "./Hud";
import MapMarker from "./MapMarker";
import { clamp, circleRing, easeInOut, easeOut, insideLagos, lerp, metresBetween, nudgePoint, reducedMotion } from "./geo";
import type { TrayLine } from "./Tray";
import OpenStage, { type ClaimResult, type LandKind, type OpenTargets } from "./open/OpenStage";

const IS_DEV = process.env.NODE_ENV !== "production";

/** The camera in Play: close enough to see all three welcome boxes on a phone. */
const PLAY_ZOOM = 16.4;
/**
 * Presence boxes open from this close. The server's rule is the box's own radius (60 m for a welcome box, from the
 * claim point you send, and no accuracy bonus until Phase 2), so the client stops 5 m short of it: a walker who drifts
 * a few metres between the tap and the claim must not be refused after the whole open sequence has played.
 */
const REACH_M = 55;
/** The run is cosmetic: 40 m/s, never shorter than 0.9 s nor longer than 3.5 s. */
const RUN_MPS = 40;
const RUN_MIN_S = 0.9;
const RUN_MAX_S = 3.5;
/** The avatar stops this far short of the crate it runs to, so it stands beside it. */
const STOP_SHORT_M = 8;
/** Development: arrow keys walk at this speed. */
const DEV_WALK_MPS = 28;

type Pt = { lat: number; lng: number };
type Here = Pt & { accuracy: number; real: boolean };
type Run = { from: Pt; to: Pt; t0: number; dur: number; done: () => void };

const ms = (n: number) => (reducedMotion() ? 0 : n);

/* ------------------------------------------------------- today's numbers -- */
type Today = { day: string; xp: number; boxes: number };
const todayKey = (userId: string) => `hz-play-today-v1:${userId}`;
/** The play-day turns over at 06:00 Lagos. */
const playDayNow = () => lagosDate(Date.now() - 6 * 3.6e6);

function readToday(userId: string | null): Today {
  const day = playDayNow();
  try {
    const raw = userId ? (JSON.parse(localStorage.getItem(todayKey(userId)) ?? "null") as Today | null) : null;
    if (raw && raw.day === day) return raw;
  } catch {
    /* private mode */
  }
  return { day, xp: 0, boxes: 0 };
}

function writeToday(userId: string | null, t: Today) {
  if (!userId) return;
  try {
    localStorage.setItem(todayKey(userId), JSON.stringify(t));
  } catch {
    /* private mode: the counters just restart next visit */
  }
}

/* --------------------------------------------------------- claim wording -- */
const REFUSALS: Record<string, string> = {
  closed: "Gone",
  sold_out: "Gone",
  already: "Gone",
  not_yours: "Gone",
  need_account: "Sign up to open this box.",
  location_required: "This one needs a walk. Go to the crate.",
  too_fast: "Slow down a little and try again.",
  slow_down: "Hold on, you are opening a lot. Try again soon.",
  no_session: "One moment, then try again.",
};
const GONE = new Set(["closed", "sold_out", "already", "not_yours"]);

/** Demo mode (development without a database): the same three welcome boxes (all sent by avatar) and three small ones, around you. */
function demoBoxes(at: Pt): PlayBox[] {
  const closes = new Date(Date.now() + 24 * 3.6e6).toISOString();
  const spot = (id: string, kind: string, tier: PlayBox["tier"], east: number, north: number, slot: PlayBox["slot"], needsPresence = false): PlayBox => {
    const p = nudgePoint(at.lat, at.lng, east, north);
    return { id, kind, tier, lat: p.lat, lng: p.lng, closesAt: closes, needsPresence, slot };
  };
  return [
    spot("demo-a", "welcome", "rare", 18, 17, "a"),
    spot("demo-b", "welcome", "rare", -85, 48, "b"),
    spot("demo-c", "welcome", "legendary", 130, 170, "c"),
    spot("demo-n1", "near", "common", -70, -60, null),
    spot("demo-n2", "near", "common", 95, -40, null),
    spot("demo-n3", "near", "common", 20, -120, null),
  ];
}

type Opening = { box: PlayBox; origin: { x: number; y: number }; targets: OpenTargets; firstOfDay: boolean };

export default function PlayLayer({
  map,
  look,
  fix,
  streak,
  onNeedLocation,
}: {
  map: MLMap;
  /** The Hopper's own look (profile avatar, or the local copy). */
  look: unknown;
  /** The events map's location: GPS when they shared it, the picked area otherwise. */
  fix: { lat: number; lng: number; source: "gps" | "area" } | null;
  /** Streak days, from the stats the page already reads. */
  streak: number;
  /** Open the location sheet ("Turn on location to open boxes"). */
  onNeedLocation: () => void;
}) {
  const playing = usePlayMode((s) => s.active);
  const say = useToast((s) => s.say);
  const { userId, hasAccount, profile, refresh } = useSession();
  const tuning = useMemo(() => playTuning(), []);
  usePlayBackButton();

  /* ------------------------------------------------------- where you are -- */
  const [wantLive, setWantLive] = useState(false);
  // The avatar on the events map follows the phone only where location is already allowed: a watch never asks again by itself.
  const geoPermission = useGeoPermission();
  const live = useLivePosition({
    enabled: playing || wantLive || (fix?.source === "gps" && geoPermission === "granted"),
    precise: playing || wantLive,
  });
  const livePos = live.fresh && live.pos && (!IS_DEV || live.pos.source === "dev" || insideLagos(live.pos.lat, live.pos.lng)) ? live.pos : null;
  // A laptop has no GPS worth trusting: in development the picked area stands in.
  const here: Here | null = useMemo(() => {
    if (livePos) return { lat: livePos.lat, lng: livePos.lng, accuracy: livePos.accuracy, real: true };
    if (IS_DEV && fix) return { lat: fix.lat, lng: fix.lng, accuracy: 15, real: false };
    return null;
  }, [livePos, fix]);
  const hereRef = useRef(here);
  const home: Pt | null = useMemo(() => here ?? (fix ? { lat: fix.lat, lng: fix.lng } : null), [here, fix]);
  const homeRef = useRef<Pt | null>(home);
  useEffect(() => {
    hereRef.current = here;
    homeRef.current = home;
  });

  /* -------------------------------------------------------------- the world -- */
  const [opening, setOpening] = useState<Opening | null>(null);
  const [running, setRunning] = useState(false);
  const [wig, setWig] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const avatar = useRef<AvatarHandle>(null);
  const hud = useRef<HudHandle>(null);
  const disp = useRef<Pt | null>(null);
  const runRef = useRef<Run | null>(null);
  const followRef = useRef(false);
  const bias = useRef({ target: { lng: 0, lat: 0, until: 0 }, now: { lng: 0, lat: 0 } });
  const [styleEpoch, setStyleEpoch] = useState(0);

  const tell = useCallback((text: string, forMs = 2600) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(text);
    flashTimer.current = setTimeout(() => setFlash(null), forMs);
  }, []);

  /* ----------------------------------------------------- the boxes (tick) -- */
  const [demo, setDemo] = useState<PlayBox[]>([]);
  const exit = useCallback(() => usePlayMode.getState().exit(), []);
  const tick = usePlayTick({
    active: playing && !DEMO,
    userId,
    everyMs: tuning.heartbeatMs,
    getPos: () => {
      const p = hereRef.current;
      return p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null;
    },
    hasPos: !!here,
    beforeFirst: async (p) => {
      const h = hereRef.current;
      await ensureWelcomeBoxes(userId, { lat: p.lat, lng: p.lng, fresh: !!h?.real });
    },
    onIdle: () => {
      say("Play paused. Tap your avatar to come back.");
      exit();
    },
  });
  const boxes = useMemo(() => (DEMO ? demo : tick.boxes).slice(0, tuning.maxCrates), [demo, tick.boxes, tuning.maxCrates]);
  const info = tick.info;

  // The development demo has no server: three welcome boxes and three small ones appear around you on entering.
  const demoMade = useRef(false);
  useEffect(() => {
    if (!playing) {
      demoMade.current = false;
      return;
    }
    if (DEMO && !demoMade.current && home) {
      demoMade.current = true;
      const made = demoBoxes(home);
      queueMicrotask(() => setDemo(made));
    }
  }, [playing, home]);

  // Refusals from the heartbeat that the shell acts on.
  useEffect(() => {
    if (!playing || !tick.refusal) return;
    if (tick.refusal === "outside_lagos") {
      say("Play is Lagos only for now.");
      exit();
    } else if (tick.refusal === "need_account") {
      requireAccount("keep playing");
    }
  }, [playing, tick.refusal, say, exit]);

  // A box that appears after the first answer rises with a sound.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!playing) {
      known.current = null;
      return;
    }
    if (!(DEMO ? demo.length : tick.answered)) return;
    const ids = new Set(boxes.map((b) => b.id));
    if (known.current && boxes.some((b) => !known.current!.has(b.id))) sfx.rise();
    known.current = ids;
  }, [playing, boxes, demo.length, tick.answered]);

  /* ------------------------------------------------- numbers on the HUD -- */
  const [today, setToday] = useState<Today>(() => ({ day: playDayNow(), xp: 0, boxes: 0 }));
  const [optimisticXp, setOptimisticXp] = useState(0);
  const [shelf, setShelf] = useState<number | null>(null);
  const [doneToday, setDoneToday] = useState(false);
  /** The first box of the day landed in this visit. Only a guess for the streak if the server cannot be asked. */
  const [stamped, setStamped] = useState(false);
  /** The streak as the server counts it after a box (a claim writes today's activity, so it already includes today). */
  const [liveStreak, setLiveStreak] = useState<number | null>(null);
  const reloadStreak = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.rpc("my_game_stats");
    const n = Number((data as { daily_streak?: number } | null)?.daily_streak);
    if (Number.isFinite(n)) setLiveStreak(n);
  }, []);
  const xp = Math.max(profile?.xp ?? 0, optimisticXp);

  useEffect(() => {
    if (!playing) return;
    const t = readToday(userId);
    queueMicrotask(() => {
      setToday(t);
      setDoneToday(t.boxes > 0);
    });
    if (DEMO) {
      queueMicrotask(() => setShelf(3));
      return;
    }
    let on = true;
    void loadCollection(userId)
      .then((rows) => on && setShelf(rows.length))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [playing, userId]);

  /* ----------------------------------------------------------- the camera -- */
  const saved = useRef<{ zoom: number; pitch: number; bearing: number } | null>(null);
  const wasPlaying = useRef(false);
  const enteredAt = useRef(0);
  const soundOff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitted = useRef(false);
  useEffect(() => {
    if (playing === wasPlaying.current) return;
    wasPlaying.current = playing;
    const d = disp.current ?? homeRef.current;
    const box = map.getContainer();
    box.classList.toggle("hz-low", deviceTier() === "low");
    // The nav bar leaves (or returns) and the map gets (or gives back) its height.
    requestAnimationFrame(() => map.resize());
    setTimeout(() => map.resize(), 80);
    if (playing) {
      saved.current = { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      followRef.current = false;
      enteredAt.current = performance.now();
      // Coming back within the exit tail must not leave Play silent.
      if (soundOff.current) clearTimeout(soundOff.current);
      soundOff.current = null;
      sfx.setPlaying(true);
      sfx.talkingDrum("call");
      if (d) {
        map.easeTo({
          center: [d.lng, d.lat],
          zoom: PLAY_ZOOM,
          pitch: tuning.pitch,
          padding: { top: Math.round(box.clientHeight * 0.2), bottom: 0, left: 0, right: 0 },
          duration: ms(700),
        });
      }
      const t = setTimeout(() => (followRef.current = true), ms(700) + 60);
      return () => clearTimeout(t);
    }
    followRef.current = false;
    sfx.talkingDrum("exit");
    if (soundOff.current) clearTimeout(soundOff.current);
    soundOff.current = setTimeout(() => {
      soundOff.current = null;
      sfx.setPlaying(false);
    }, 700);
    const s = saved.current;
    if (d) {
      map.easeTo({
        center: [d.lng, d.lat],
        zoom: Math.min(s?.zoom ?? 13.2, 14.5),
        pitch: s?.pitch ?? 50,
        bearing: s?.bearing ?? map.getBearing(),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: ms(600),
      });
    }
  }, [playing, map, tuning.pitch]);

  // Leaving the page with Play open must not leave the flag behind.
  useEffect(() => {
    return () => {
      if (soundOff.current) clearTimeout(soundOff.current);
      if (fitTimer.current) clearTimeout(fitTimer.current);
      if (usePlayMode.getState().active) {
        usePlayMode.getState().reset();
        sfx.setPlaying(false);
      }
    };
  }, []);

  /* ----------------------------------------------- the reach ring and path -- */
  useEffect(() => {
    const bump = () => setStyleEpoch((n) => n + 1);
    map.on("style.load", bump);
    return () => {
      map.off("style.load", bump);
    };
  }, [map]);

  const reachM = REACH_M;
  const inReach = useMemo(
    () => !!here && boxes.some((b) => b.needsPresence && metresBetween(here.lat, here.lng, b.lat, b.lng) <= reachM),
    [here, boxes, reachM]
  );
  useEffect(() => {
    const src = map.getSource("hoppaz-play-reach") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features:
        playing && here
          ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(here.lat, here.lng, reachM)] }, properties: {} }]
          : [],
    });
    if (map.getLayer("play-reach-fill")) {
      map.setPaintProperty("play-reach-fill", "fill-opacity", inReach ? 0.28 : 0.12);
      map.setPaintProperty("play-reach-line", "line-opacity", inReach ? 1 : 0.85);
    }
  }, [map, playing, here, reachM, inReach, styleEpoch]);

  const wasIn = useRef(false);
  useEffect(() => {
    if (playing && inReach && !wasIn.current) sfx.agogo(0);
    wasIn.current = inReach;
  }, [playing, inReach]);

  const drawPath = useCallback(
    (from: Pt, to: Pt) => {
      const src = map.getSource("hoppaz-play-path") as GeoJSONSource | undefined;
      if (!src) return;
      if (map.getLayer("play-path")) map.setPaintProperty("play-path", "line-opacity", 0.9);
      const t0 = performance.now();
      const dur = ms(1200);
      const line = (u: number) => ({
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: [[from.lng, from.lat], [lerp(from.lng, to.lng, u), lerp(from.lat, to.lat, u)]] },
            properties: {},
          },
        ],
      });
      const step = (now: number) => {
        const u = dur ? clamp((now - t0) / dur, 0, 1) : 1;
        src.setData(line(easeOut(u)));
        if (u < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      // Hold it, fade it, clear it.
      setTimeout(() => map.getLayer("play-path") && map.setPaintProperty("play-path", "line-opacity", 0), ms(2700));
      setTimeout(() => src.setData({ type: "FeatureCollection", features: [] }), ms(3300));
    },
    [map]
  );

  /* ------------------------------------------------------ the frame loop -- */
  const devKeys = useRef(new Set<string>());
  const devTarget = useRef<Pt | null>(null);
  const devPushed = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const d = disp.current;
      const h = homeRef.current;
      if (!d) {
        if (h) disp.current = { lat: h.lat, lng: h.lng };
        return;
      }
      // Development: keys walk you (screen-up is where the map points).
      if (IS_DEV && usePlayMode.getState().active && !busy.current && devKeys.current.size) {
        const cur = devTarget.current ?? hereRef.current ?? h;
        if (cur) {
          const b = (map.getBearing() * Math.PI) / 180;
          const k = devKeys.current;
          const up = (k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0);
          const right = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
          const east = (Math.sin(b) * up + Math.cos(b) * right) * DEV_WALK_MPS * dt;
          const north = (Math.cos(b) * up - Math.sin(b) * right) * DEV_WALK_MPS * dt;
          devTarget.current = nudgePoint(cur.lat, cur.lng, east, north);
          if (now - devPushed.current > 100) {
            devPushed.current = now;
            setDevPosition(devTarget.current.lat, devTarget.current.lng);
          }
        }
      } else if (!devKeys.current.size) {
        devTarget.current = null;
      }

      let moved = false;
      const run = runRef.current;
      if (run) {
        const u = clamp((now - run.t0) / run.dur, 0, 1);
        const e = easeInOut(u);
        d.lng = lerp(run.from.lng, run.to.lng, e);
        d.lat = lerp(run.from.lat, run.to.lat, e);
        moved = true;
        if (u >= 1) {
          runRef.current = null;
          run.done();
        }
      } else if (h) {
        const dist = metresBetween(d.lat, d.lng, h.lat, h.lng);
        if (dist > 400 || reducedMotion()) {
          if (dist > 0.01) {
            d.lat = h.lat;
            d.lng = h.lng;
            moved = true;
          }
        } else if (dist > 0.05) {
          const k = 1 - Math.exp(-dt * 5);
          d.lat += (h.lat - d.lat) * k;
          d.lng += (h.lng - d.lng) * k;
          moved = true;
        }
      }
      if (moved) avatar.current?.setLngLat(d.lng, d.lat);

      if (followRef.current) {
        const bs = bias.current;
        const want = now < bs.target.until ? bs.target : { lng: 0, lat: 0 };
        const k = 1 - Math.exp(-dt * 6);
        const dl = (want.lng - bs.now.lng) * k;
        const dt2 = (want.lat - bs.now.lat) * k;
        bs.now.lng += dl;
        bs.now.lat += dt2;
        if (moved || Math.abs(dl) > 1e-9 || Math.abs(dt2) > 1e-9) map.setCenter([d.lng + bs.now.lng, d.lat + bs.now.lat]);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [map]);

  // Development input: arrow keys walk, a click on the map stands you there.
  useEffect(() => {
    if (!IS_DEV || !playing) return;
    const keys = devKeys.current;
    const down = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow") || /input|textarea|select/i.test((e.target as HTMLElement | null)?.tagName ?? "")) return;
      e.preventDefault();
      keys.add(e.key);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key);
    const click = (e: { lngLat: { lat: number; lng: number } }) => {
      if (!busy.current) setDevPosition(e.lngLat.lat, e.lngLat.lng);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    map.on("click", click);
    return () => {
      keys.clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      map.off("click", click);
    };
  }, [map, playing]);

  // Escape leaves Play (the open stage handles its own Escape first).
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy.current && exit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, exit]);

  /* ------------------------------------------- all the welcome boxes in view -- */
  // On the first look the camera widens just enough to hold you and every welcome box between the HUD and the tray.
  const fitWelcome = useCallback(
    (pts: Pt[]) => {
      const d = disp.current;
      if (!d || !pts.length) return;
      const el = map.getContainer();
      const w = el.clientWidth;
      const h = el.clientHeight;
      const top = 112;
      const bottom = h - ((hud.current?.trayHeight() ?? 110) + 28);
      const inView = (z: number) => {
        map.jumpTo({ center: [d.lng, d.lat], zoom: z });
        return pts.every((p) => {
          const q = map.project([p.lng, p.lat]);
          return q.x >= 40 && q.x <= w - 40 && q.y >= top && q.y <= bottom;
        });
      };
      // Tried in one frame without painting, then the camera is put back and eased to the answer.
      let z = PLAY_ZOOM;
      while (z > 15.2 && !inView(z)) z = Math.round((z - 0.2) * 10) / 10;
      map.jumpTo({ center: [d.lng, d.lat], zoom: PLAY_ZOOM });
      if (z < PLAY_ZOOM) map.easeTo({ center: [d.lng, d.lat], zoom: z, duration: ms(500) });
    },
    [map]
  );

  useEffect(() => {
    if (!playing) {
      fitted.current = false;
      if (fitTimer.current) clearTimeout(fitTimer.current);
      fitTimer.current = null;
      return;
    }
    if (fitted.current || fitTimer.current) return;
    const pts = boxes.filter((b) => b.kind === "welcome");
    if (!pts.length) return;
    // Wait for the swoop into Play to land first.
    const wait = Math.max(0, enteredAt.current + ms(700) + 150 - performance.now());
    fitTimer.current = setTimeout(() => {
      fitTimer.current = null;
      fitted.current = true;
      if (usePlayMode.getState().active && !busy.current) fitWelcome(pts);
    }, wait);
  }, [playing, boxes, fitWelcome]);

  /* ------------------------------------------------ the run to a box ----- */
  const runTo = useCallback((to: Pt, done: () => void) => {
    const d = disp.current;
    if (!d) return done();
    const m = metresBetween(d.lat, d.lng, to.lat, to.lng);
    const dur = reducedMotion() ? 200 : clamp(m / RUN_MPS, RUN_MIN_S, RUN_MAX_S) * 1000;
    runRef.current = { from: { ...d }, to, t0: performance.now(), dur, done };
    setRunning(true);
  }, []);

  const goHome = useCallback(() => {
    const h = homeRef.current;
    const d = disp.current;
    if (!h || !d) return;
    runTo(h, () => setRunning(false));
  }, [runTo]);

  /* -------------------------------------------------------- opening a box -- */
  const claim = useCallback(
    async (box: PlayBox): Promise<ClaimResult> => {
      if (DEMO) return { ok: true, xp: box.kind === "welcome" ? (box.slot === "c" ? 150 : 50) : 10, title: "Small find" };
      const sb = getSupabase();
      if (!sb) return { ok: false, reason: "offline", message: "No signal. Try again in a bit." };
      const at = box.needsPresence ? hereRef.current : null;
      const { data, error } = await sb.rpc("claim_game_drop", {
        p_drop: box.id,
        p_lat: at?.lat ?? null,
        p_lng: at?.lng ?? null,
        p_code: null,
      });
      if (error || !data) return { ok: false, reason: "error", message: "That didn't open. Try again in a bit." };
      const r = data as { ok: boolean; reason?: string; reward?: string; xp?: number; distance_m?: number };
      if (r.ok) return { ok: true, xp: r.xp ?? 0, title: r.reward };
      const reason = r.reason ?? "error";
      if (GONE.has(reason)) tick.removeBox(box.id);
      if (reason === "need_account") requireAccount("open this box");
      const message =
        reason === "too_far"
          ? `About ${Math.round(r.distance_m ?? 0)} m to go.`
          : (REFUSALS[reason] ?? "That didn't open. Try again in a bit.");
      return { ok: false, reason, message };
    },
    [tick]
  );

  const landed = useRef<{ xp: boolean; stamp: boolean }>({ xp: false, stamp: false });
  const credit = useCallback(
    (kind: LandKind, r: { xp: number }) => {
      if (kind === "xp" && !landed.current.xp) {
        landed.current.xp = true;
        setOptimisticXp(Math.max(profile?.xp ?? 0, optimisticXp) + r.xp);
        setToday((t) => {
          const next = { ...t, xp: t.xp + r.xp, boxes: t.boxes + 1 };
          writeToday(userId, next);
          return next;
        });
      } else if (kind === "stamp" && !landed.current.stamp) {
        landed.current.stamp = true;
        setDoneToday(true);
        setStamped(true);
      }
    },
    [profile?.xp, optimisticXp, userId]
  );

  const farNudge = useCallback(
    (box: PlayBox, metres: number) => {
      const d = disp.current;
      sfx.knock();
      setWig(box.id);
      setTimeout(() => setWig(null), 650);
      tell(`Worth the walk. About ${Math.round(metres)} m to go.`, 3200);
      if (!d) return;
      drawPath(d, box);
      // A soft nudge: the camera leans toward the box and settles back.
      const k = Math.min(0.3, 95 / Math.max(metres, 1));
      bias.current.target = { lng: (box.lng - d.lng) * k, lat: (box.lat - d.lat) * k, until: performance.now() + 1400 };
    },
    [drawPath, tell]
  );

  const finish = useCallback(
    (op: Opening, result: ClaimResult) => {
      setOpening(null);
      busy.current = false;
      goHome();
      if (!result.ok) {
        // A timeout or a broken answer may hide a claim the server did pay: ask again for the numbers and the boxes.
        if (result.reason === "timeout" || result.reason === "error") {
          void refresh();
          void reloadStreak().catch(() => {});
          void tick.tickNow();
        }
        if (result.reason === "too_far") {
          // The stage already said how far. The tray, the wiggle and the path say which way, and the crate stays.
          const h = hereRef.current;
          if (h) setTimeout(() => farNudge(op.box, metresBetween(h.lat, h.lng, op.box.lat, op.box.lng)), 250);
        } else if (GONE.has(result.reason)) {
          // The stage showed it for a second; the tray keeps it a little longer.
          tell("Gone", 2000);
        }
        return;
      }
      // Anything the stage did not land one by one still counts.
      credit("xp", result);
      credit("stamp", result);
      tick.removeBox(op.box.id);
      if (DEMO) setDemo((list) => list.filter((b) => b.id !== op.box.id));
      void refresh();
      void reloadStreak().catch(() => {});
      if (markFirst("box")) emitPlayEvent({ type: "first-box-opened", boxId: op.box.id, kind: op.box.kind });
      if (op.box.kind === "welcome") {
        const left = boxes.filter((b) => b.kind === "welcome" && b.id !== op.box.id).length;
        if (left === 0) {
          if (markFirst("welcome")) emitPlayEvent({ type: "welcome-done" });
          // The third welcome box is open: keep it by making an account, in place (same user id is upgraded).
          if (!hasAccount) setTimeout(() => requireAccount("keep your Golden Danfo"), 700);
        }
      }
    },
    [boxes, credit, goHome, hasAccount, refresh, reloadStreak, tick, farNudge, tell]
  );

  const showStage = useCallback(
    (box: PlayBox) => {
      const p = map.project([box.lng, box.lat]);
      const r = map.getContainer().getBoundingClientRect();
      landed.current = { xp: false, stamp: false };
      setOpening({
        box,
        origin: { x: r.left + p.x, y: r.top + p.y - 24 },
        targets: hud.current?.rects() ?? { xp: null, shelf: null, pips: null },
        firstOfDay: !doneToday,
      });
    },
    [map, doneToday]
  );

  const onBoxTap = useCallback(
    (box: PlayBox) => {
      if (busy.current || !playing) return;
      const h = hereRef.current;
      if (!h) {
        tell("Finding you");
        introEvent("location_needed");
        return;
      }
      // An account is asked for before the tape rips, never for a welcome box.
      if (box.kind !== "welcome" && !requireAccount("open boxes", () => onBoxTap(box))) return;
      if (box.needsPresence) {
        const m = metresBetween(h.lat, h.lng, box.lat, box.lng);
        if (m > REACH_M) {
          farNudge(box, m);
          return;
        }
        busy.current = true;
        showStage(box);
        return;
      }
      // A remote box: the avatar runs there in a straight line (cosmetic), then it opens.
      busy.current = true;
      const d = disp.current ?? h;
      const m = metresBetween(d.lat, d.lng, box.lat, box.lng);
      const short = Math.min(STOP_SHORT_M, m / 2);
      const stop = m > 0 ? { lat: box.lat + ((d.lat - box.lat) * short) / m, lng: box.lng + ((d.lng - box.lng) * short) / m } : box;
      runTo(stop, () => {
        setRunning(false);
        showStage(box);
      });
    },
    [playing, tell, farNudge, runTo, showStage]
  );

  // Paz's tour: SEND IT on the far welcome box starts the same run a tap on it does, and it opens like any remote box.
  const farWelcome = useMemo(() => boxes.find((b) => b.kind === "welcome" && b.slot === "c") ?? null, [boxes]);
  useEffect(() => {
    if (!farWelcome) return;
    return registerIntroAction("send_avatar", () => {
      if (busy.current) return;
      onBoxTap(farWelcome);
      if (!busy.current) return;
      // The card steps out for the run; the open moment's own events keep it out and bring it back.
      introSetOpening(true);
      setTimeout(() => {
        if (!busy.current) introSetOpening(false);
      }, 6000);
    });
  }, [farWelcome, onBoxTap]);
  useEffect(() => {
    if (!playing) introSetOpening(false);
  }, [playing]);

  /* ------------------------------------------------------ entering Play ---- */
  const pendingEnter = useRef(false);
  const enterNow = useCallback(() => {
    const h = homeRef.current;
    if (h && !insideLagos(h.lat, h.lng)) {
      say("Play is Lagos only for now.");
      return;
    }
    usePlayMode.getState().enter();
  }, [say]);

  const onAvatarTap = useCallback(() => {
    if (playing) {
      // Tap yourself to bring the camera back.
      const d = disp.current;
      if (d && !busy.current) map.easeTo({ center: [d.lng, d.lat], duration: ms(400) });
      return;
    }
    if (livePos || (IS_DEV && fix)) {
      enterNow();
      return;
    }
    // No fresh GPS yet: ask for it, and go in the moment it arrives.
    if (live.status === "denied") {
      say("Turn on location to open boxes.");
      introEvent("location_needed");
      onNeedLocation();
      return;
    }
    pendingEnter.current = true;
    setWantLive(true);
  }, [playing, map, livePos, fix, enterNow, live.status, say, onNeedLocation]);

  // The precise watch is on only while Play is wanted: once we are in, or the attempt fails, it lets go.
  useEffect(() => {
    if (!pendingEnter.current) return;
    if (livePos) {
      pendingEnter.current = false;
      setWantLive(false);
      enterNow();
    } else if (live.status === "denied") {
      pendingEnter.current = false;
      setWantLive(false);
      say("Turn on location to open boxes.");
      introEvent("location_needed");
      onNeedLocation();
    } else if (live.status === "unavailable") {
      // A timeout or no signal is not a settings problem: say so, and let them tap again.
      pendingEnter.current = false;
      setWantLive(false);
      say("Still finding you. Try again in a moment.");
    }
  }, [livePos, live.status, enterNow, say, onNeedLocation]);

  // /?play opens Play straight away (the Me tab's Today's box will link here).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !home) return;
    if (!new URL(window.location.href).searchParams.has("play")) return;
    // A timer, not a straight call: Strict Mode mounts, cleans up and mounts again, and the cleanup must not eat the entry.
    const t = setTimeout(() => {
      if (deepLinked.current) return;
      deepLinked.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("play");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      onAvatarTap();
    }, 0);
    return () => clearTimeout(t);
  }, [home, onAvatarTap]);

  /* --------------------------------------------------------------- sound ---- */
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);

  /* ----------------------------------------------------------- the tray ---- */
  const welcome = boxes.filter((b) => b.kind === "welcome");
  const seen = playSeen();
  const line: TrayLine = (() => {
    if (flash) return { tone: "info", text: flash };
    if (!here) return { tone: "warn", text: live.status === "denied" ? "Turn on location to open boxes" : "Finding you" };
    if (tick.sleeping) return { tone: "info", text: "Paused. Touch the screen to carry on." };
    if (welcome.length && !hasAccount && !seen.welcome && today.boxes === 0) {
      const n = welcome.length;
      return { tone: "info", text: `${n} welcome ${n === 1 ? "box" : "boxes"} for you. Tap one.` };
    }
    // A guest has no small boxes by design (the server says 0 left); they have welcome boxes, then the sign-up sheet.
    if ((DEMO ? demo.length : tick.answered) && boxes.length === 0) {
      if (!hasAccount) return { tone: "info", text: "Make an account to keep playing." };
      return info.smallLeft === 0
        ? { tone: "info", text: "Tomorrow's box is sealed." }
        : { tone: "info", text: "No boxes right now. New ones rise nearby." };
    }
    if (hasAccount && info.smallLeft === 0 && !boxes.some((b) => b.kind === "near")) return { tone: "info", text: "Tomorrow's box is sealed." };
    if (!(DEMO ? demo.length : tick.answered)) return { tone: "info", text: "Finding boxes" };
    if (!seen.box && today.boxes === 0) return { tone: "info", text: "Tap a box. Your avatar runs to it." };
    return { tone: "info", text: `Today +${today.xp} XP, ${today.boxes} ${today.boxes === 1 ? "box" : "boxes"}` };
  })();

  // Toasts sit above the tray while Play has the bottom of the screen.
  useEffect(() => {
    if (!playing) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--hz-play-lift", `${(hud.current?.trayHeight() ?? 110) + 14}px`);
    set();
    const t = setTimeout(set, 400);
    return () => {
      clearTimeout(t);
      root.style.removeProperty("--hz-play-lift");
    };
  }, [playing, line.text]);

  /* ---------------------------------------------------------------- render -- */
  const d0 = disp.current ?? home;
  return (
    <>
      {d0 && (
        <Avatar map={map} look={look} lng={d0.lng} lat={d0.lat} playing={playing} running={running} onTap={onAvatarTap} ref={avatar} />
      )}
      {playing &&
        boxes.map((b, i) => {
          if (opening?.box.id === b.id) return null;
          const art = TIER_ART[b.tier];
          const name = b.kind === "welcome" ? "Welcome box" : b.needsPresence ? "Box that needs a walk" : "Small box";
          const dist = here && b.needsPresence ? Math.round(metresBetween(here.lat, here.lng, b.lat, b.lng)) : null;
          const live = !!here && b.needsPresence && dist !== null && dist <= reachM;
          return (
            <MapMarker
              key={b.id}
              map={map}
              lng={b.lng}
              lat={b.lat}
              anchor="bottom"
              className="hz-crate"
              dataIntro={b.kind === "welcome" ? (b.slot === "c" ? "far-box" : "box") : undefined}
              label={`${name}, ${art.name}. ${b.needsPresence ? (live ? "In reach. Tap to open." : `About ${dist} metres away. Tap to see the way.`) : "Tap to send your avatar."}`}
              onClick={() => onBoxTap(b)}
              style={{ zIndex: Math.round((90 - b.lat) * 100_000) }}
            >
              <span
                className={clsx(
                  "hz-crate-wrap hz-born",
                  `hz-crate-${b.tier}`,
                  live && "hz-crate-live",
                  b.needsPresence && !live && "hz-crate-far",
                  wig === b.id && "hz-wig"
                )}
                style={{ ["--tc" as string]: art.c, animationDelay: `${250 + i * 80}ms` }}
              >
                {(b.tier === "epic" || b.tier === "legendary") && <i aria-hidden className="hz-crate-col" />}
                <i aria-hidden className="hz-crate-gr" />
                <i aria-hidden className="hz-crate-sh" />
                <span aria-hidden className="hz-crate-body">
                  <span className="hz-crate-in">
                    <Crate tier={b.tier} />
                  </span>
                </span>
              </span>
            </MapMarker>
          );
        })}
      {playing && (
        <Hud
          ref={hud}
          xp={xp}
          streak={liveStreak ?? streak + (stamped ? 1 : 0)}
          doneToday={doneToday}
          shelf={shelf}
          line={line}
          night={info.night}
          muted={muted}
          onMute={() => sfx.setMuted(!muted)}
          onExit={exit}
        />
      )}
      {opening && (
        <OpenStage
          key={opening.box.id}
          drop={opening.box}
          tier={opening.box.tier}
          fourBox={opening.box.slot === "a"}
          claim={() => claim(opening.box)}
          target={opening.targets}
          origin={opening.origin}
          firstOfDay={opening.firstOfDay}
          xpBefore={xp}
          onLand={(kind, r) => credit(kind, r)}
          onDone={(result) => finish(opening, result)}
          onCancel={() => {
            setOpening(null);
            busy.current = false;
            goHome();
          }}
        />
      )}
    </>
  );
}
