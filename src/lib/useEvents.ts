"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { DEMO_EVENTS, DEMO_HOP } from "./demoData";
import { haversineKm, LAGOS_CENTER } from "./geo";
import type { EventRow, Hop } from "./types";

type Fix = { lat: number; lng: number } | null;

/** Fills distance_m locally so demo mode and live mode render identically. */
function withDistance(rows: EventRow[], fix: Fix): EventRow[] {
  const from = fix ?? LAGOS_CENTER;
  return rows
    .map((e) => ({ ...e, distance_m: haversineKm(from.lat, from.lng, e.lat, e.lng) * 1000 }))
    .sort((a, b) => b.heat - a.heat);
}

export function useEvents(fix: Fix, radiusKm: number) {
  const [events, setEvents] = useState<EventRow[]>(() => withDistance(DEMO_EVENTS, fix));
  const [demo, setDemo] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setEvents(withDistance(DEMO_EVENTS, fix));
      setDemo(true);
      return;
    }
    setLoading(true);
    const from = fix ?? LAGOS_CENTER;
    const { data, error } = await sb.rpc("events_near", {
      p_lat: from.lat,
      p_lng: from.lng,
      // Always pull a wide net; the radius only decides what is revealed.
      p_radius_m: Math.max(radiusKm, 45) * 1000,
    });
    setLoading(false);
    if (error || !data) {
      console.warn("[hoppaz] events_near failed, showing the demo night:", error?.message);
      setEvents(withDistance(DEMO_EVENTS, fix));
      setDemo(true);
      return;
    }
    setDemo(false);
    setEvents((data as EventRow[]).slice().sort((a, b) => b.heat - a.heat));
  }, [fix, radiusKm]);

  useEffect(() => {
    void load();
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

  return { events, demo, loading, reload: load };
}

export function useHop() {
  const [hop, setHop] = useState<Hop | null>(DEMO_HOP as Hop);

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
          // PostGIS geography comes back as GeoJSON when selected directly
          lat: Number((s.geog as { coordinates?: number[] })?.coordinates?.[1] ?? 0),
          lng: Number((s.geog as { coordinates?: number[] })?.coordinates?.[0] ?? 0),
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
