"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";

/**
 * Where the Hopper really is, right now. Play needs it every few seconds, so it
 * lives here and not in the store's `fix` (a GPS tick must never make the events
 * map refetch). One watchPosition for the whole app, foreground only: it stops
 * when the tab is hidden and starts again when it is back.
 *
 * Every reading carries its accuracy (metres) and the time we last heard from the
 * phone. A reading older than 2 minutes is stale: Play says "Finding you" and
 * pauses sending and claims until a new one lands. A phone standing still may
 * go quiet for minutes, so while someone is watching we ask again once the last
 * reading is 20 s old.
 *
 * Development only: arrow keys or a click on the map move the position, for
 * laptop testing (setDevPosition). A moved position beats the GPS until reload.
 */

export type LivePos = {
  lat: number;
  lng: number;
  /** Metres. */
  accuracy: number;
  /** When we last heard from the phone (ms, our clock, so a skewed device clock cannot fake a fresh fix). */
  at: number;
  source: "gps" | "dev";
};

export type LiveStatus = "off" | "asking" | "on" | "denied" | "unavailable";

/** A reading older than this is stale. */
export const STALE_MS = 120_000;
/** While watching, a reading this old is refreshed with a one-off request (a still phone fires no updates). */
const REFRESH_MS = 20_000;

const IS_DEV = process.env.NODE_ENV !== "production";

type State = { pos: LivePos | null; status: LiveStatus };
const useLiveStore = create<State>(() => ({ pos: null, status: "off" }));

/** Fresh enough to trust for a claim or a tick. A moved development position never goes stale. */
export const isFresh = (pos: LivePos | null, now = Date.now()): pos is LivePos =>
  !!pos && (pos.source === "dev" || now - pos.at <= STALE_MS);

/** The newest reading, or null. For code that is not a component (the heartbeat). */
export const getLivePos = () => useLiveStore.getState().pos;

/* ------------------------------------------------------------- the watch -- */
type Want = { precise: boolean };
const wants = new Set<Want>();
let watchId: number | null = null;
let watchPrecise = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let devPos: LivePos | null = null;
let listening = false;

function onReading(p: GeolocationPosition) {
  if (devPos) return; // a moved development position beats the GPS
  useLiveStore.setState({
    status: "on",
    pos: {
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : 50,
      at: Date.now(),
      source: "gps",
    },
  });
}

function onFail(e: GeolocationPositionError) {
  // Denied is final until they change it in settings. A timeout or "no signal" only means keep waiting.
  if (e.code === e.PERMISSION_DENIED) {
    stopWatch();
    useLiveStore.setState({ status: "denied" });
  } else if (!useLiveStore.getState().pos) {
    useLiveStore.setState({ status: "unavailable" });
  }
}

function stopWatch() {
  if (watchId !== null && "geolocation" in navigator) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function startWatch() {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    useLiveStore.setState({ status: "unavailable" });
    return;
  }
  const precise = [...wants].some((w) => w.precise);
  if (watchId !== null && precise === watchPrecise) return;
  stopWatch();
  if (document.visibilityState !== "visible" || wants.size === 0) return;
  if (useLiveStore.getState().status === "denied") return;
  watchPrecise = precise;
  if (!useLiveStore.getState().pos) useLiveStore.setState({ status: "asking" });
  watchId = navigator.geolocation.watchPosition(onReading, onFail, {
    enableHighAccuracy: precise,
    maximumAge: 5_000,
    timeout: 20_000,
  });
  refreshTimer = setInterval(() => {
    const p = useLiveStore.getState().pos;
    if (devPos || (p && Date.now() - p.at < REFRESH_MS)) return;
    navigator.geolocation.getCurrentPosition(onReading, () => {}, { enableHighAccuracy: precise, maximumAge: 0, timeout: 12_000 });
  }, 5_000);
}

/** After "denied": if the Hopper changed the setting (in the browser's site settings) the watch may start again. */
function recheckDenied() {
  if (useLiveStore.getState().status !== "denied" || !navigator.permissions) return;
  navigator.permissions
    .query({ name: "geolocation" })
    .then((st) => {
      if (st.state === "denied" || useLiveStore.getState().status !== "denied") return;
      useLiveStore.setState({ status: "off" });
      startWatch();
    })
    .catch(() => {});
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    recheckDenied();
    startWatch();
  } else stopWatch();
}

function want(w: Want) {
  wants.add(w);
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
  startWatch();
}

function unwant(w: Want) {
  wants.delete(w);
  if (wants.size === 0) {
    stopWatch();
    if (listening) {
      listening = false;
      document.removeEventListener("visibilitychange", onVisibility);
    }
  } else {
    startWatch(); // maybe the precise one left
  }
}

/* ------------------------------------------------------------ development -- */
/** Development only: stand somewhere else. Returns false in production. */
export function setDevPosition(lat: number, lng: number, accuracy = 8): boolean {
  if (!IS_DEV) return false;
  devPos = { lat, lng, accuracy, at: Date.now(), source: "dev" };
  useLiveStore.setState({ pos: devPos, status: "on" });
  return true;
}

/* ------------------------------------------------------ the permission -- */
export type GeoPermission = "granted" | "denied" | "prompt" | "unknown";

/**
 * Whether location is already allowed, read without asking. A watch started only when this says "granted" never
 * raises a prompt by itself. "unknown" is a browser that cannot say.
 */
export function useGeoPermission(): GeoPermission {
  const [state, setState] = useState<GeoPermission>("unknown");
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let status: PermissionStatus | null = null;
    let on = true;
    const sync = () => status && on && setState(status.state as GeoPermission);
    navigator.permissions
      .query({ name: "geolocation" })
      .then((st) => {
        status = st;
        sync();
        st.addEventListener("change", sync);
        // Allowed in settings after a refusal: let the watch try again.
        st.addEventListener("change", recheckDenied);
      })
      .catch(() => {});
    return () => {
      on = false;
      status?.removeEventListener("change", sync);
      status?.removeEventListener("change", recheckDenied);
    };
  }, []);
  return state;
}

/* -------------------------------------------------------------- the hook -- */
/**
 * Watch the position while `enabled`. `precise` asks the phone for GPS-grade fixes (Play); without it a coarse
 * network fix does (the avatar on the events map). Returns the newest reading, whether it is stale, and the status.
 */
export function useLivePosition({ enabled = true, precise = false }: { enabled?: boolean; precise?: boolean } = {}) {
  const pos = useLiveStore((s) => s.pos);
  const status = useLiveStore((s) => s.status);
  // Staleness is time passing, not a new reading, so re-check on a slow clock.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const w: Want = { precise };
    want(w);
    return () => unwant(w);
  }, [enabled, precise]);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, [enabled]);

  const fresh = isFresh(pos, Math.max(now, pos?.at ?? 0));
  return { pos, status, fresh, stale: !!pos && !fresh };
}
