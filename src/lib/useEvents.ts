"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { demoEvents, demoHop } from "./demoData";
import { haversineKm, LAGOS_CENTER, pointFromGeog } from "./geo";
import type { EventRow, Hop } from "./types";

type Fix = { lat: number; lng: number } | null;

/**
 * Sample events and the sample Hop are for local development only. In a
 * production build a player never sees them, even when the database is down.
 */
const DEV = process.env.NODE_ENV !== "production";

/** Fills distance_m locally so demo mode and live mode render identically. */
function withDistance(rows: EventRow[], fix: Fix): EventRow[] {
  const from = fix ?? LAGOS_CENTER;
  return rows
    .map((e) => ({ ...e, distance_m: haversineKm(from.lat, from.lng, e.lat, e.lng) * 1000 }))
    .sort((a, b) => b.heat - a.heat);
}

export function useEvents(fix: Fix, radiusKm: number) {
  // Development starts on the sample day. Production starts empty (a calm
  // loading state on the map) and only ever shows what the database returns.
  const [events, setEvents] = useState<EventRow[]>(() => (DEV ? withDistance(demoEvents(), fix) : []));
  /** True only while the list on screen is the dev sample day. */
  const [demo, setDemo] = useState(DEV);
  const [loading, setLoading] = useState(false);
  /** The first load has finished, whatever it found. Until then the map says "loading", never "empty". */
  const [ready, setReady] = useState(false);
  /** Production could not reach the live events (no database keys, or the request failed). */
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      if (DEV) {
        setEvents(withDistance(demoEvents(), fix));
        setDemo(true);
        setFailed(false);
      } else {
        setEvents([]);
        setDemo(false);
        setFailed(true);
      }
      setReady(true);
      return;
    }
    setLoading(true);
    const from = fix ?? LAGOS_CENTER;
    const fetchNear = () =>
      sb.rpc("events_near", {
        p_lat: from.lat,
        p_lng: from.lng,
        // Always pull a wide net; the radius only decides what is revealed.
        p_radius_m: Math.max(radiusKm, 45) * 1000,
        // Keep upcoming listings available for calendar browsing, including
        // event calendars spanning the rest of the month. The map narrows them.
        p_to: new Date(Date.now() + 45 * 24 * 3.6e6).toISOString(),
      });
    let { data, error } = await fetchNear();
    // A stored session that went stale while the tab slept makes every request
    // fail with "JWT expired" and strands the Hopper on the demo night.
    // Refresh it and try again; if it cannot be refreshed, drop it (events are public).
    if (error && /jwt/i.test(error.message)) {
      const { error: refreshError } = await sb.auth.refreshSession();
      if (refreshError) await sb.auth.signOut({ scope: "local" });
      ({ data, error } = await fetchNear());
    }
    setLoading(false);
    setReady(true);
    if (error || !data) {
      console.warn("[hoppaz] events_near failed:", error?.message);
      if (DEV) {
        setEvents(withDistance(demoEvents(), fix));
        setDemo(true);
        setFailed(false);
      } else {
        // Keep whatever is already on the map; only say so when there is nothing to show.
        setDemo(false);
        setFailed(true);
      }
      return;
    }
    setDemo(false);
    setFailed(false);
    setEvents((data as EventRow[]).slice().sort((a, b) => b.heat - a.heat));
  }, [fix, radiusKm]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the rolling event window current while someone has the app open.
  // Refreshing on return from a background tab also catches edits made while
  // the app was suspended by the browser.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refreshIfVisible, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  // Live heat: a check-in anywhere nudges the map for everyone watching.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const ch = sb
      .channel("hoppaz-heat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [load]);

  return { events, demo, loading, ready, failed, reload: load };
}

export function useHop() {
  // The sample Hop (this coming Saturday) is a development convenience only.
  const [hop, setHop] = useState<Hop | null>(() => (DEV ? (demoHop() as Hop) : null));

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;
    (async () => {
      const { data } = await sb
        .from("hops")
        .select("*, hop_stops(*)")
        .in("status", ["announced", "selling"])
        .order("hop_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const d = data as Record<string, unknown>;
      const stops = ((d.hop_stops as Record<string, unknown>[]) ?? [])
        .map((s) => ({
          id: String(s.id),
          idx: Number(s.idx),
          name: String(s.name),
          area: (s.area as string) ?? null,
          // PostGIS geography comes back as hex EWKB from the REST API; pointFromGeog reads it.
          lat: pointFromGeog(s.geog)?.lat ?? 0,
          lng: pointFromGeog(s.geog)?.lng ?? 0,
          stop_time: String(s.stop_time),
          role: String(s.role),
        }))
        .filter((s) => s.lat !== 0)
        .sort((a, b) => a.idx - b.idx);
      if (stops.length) setHop({ ...(data as unknown as Hop), stops });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return hop;
}
