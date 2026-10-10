"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEMO } from "@/components/me/demo";
import { getSupabase } from "@/lib/supabase/client";
import { DEMO_HOTSPOTS } from "./demo";
import { metresApart, nearestOthers, pinsFor, yoursOf } from "./geometry";
import type { Band, Hotspot, HotspotStatus, Pt, ZoneShape } from "./types";

/** How often the counts are asked again while Play is open, and how soon a sheet may ask again. */
const REFRESH_MS = 120_000;
const SHEET_REFRESH_MS = 20_000;

type Raw = {
  id?: string;
  slug?: string;
  name?: string;
  zone_name?: string;
  zone_label?: string;
  side?: string;
  junction?: string;
  road_a?: string;
  road_b?: string;
  lat?: number;
  lng?: number;
  wave?: number;
  status?: string;
  zone_geojson?: ZoneShape | null;
  here_band?: string;
  here_n?: number | null;
  today_band?: string;
  today_n?: number | null;
};

const BANDS: Band[] = ["quiet", "few", "some", "busy", "packed"];
const band = (v: string | undefined): Band => (BANDS.includes(v as Band) ? (v as Band) : "quiet");

function toHotspot(r: Raw): Hotspot | null {
  if (!r.id || !r.slug || typeof r.lat !== "number" || typeof r.lng !== "number") return null;
  const status: HotspotStatus = r.status === "open" || r.status === "paused" ? r.status : "planned";
  return {
    id: r.id,
    slug: r.slug,
    name: r.name ?? r.slug,
    zoneName: r.zone_name ?? "",
    zoneLabel: r.zone_label ?? "",
    side: r.side === "island" ? "island" : "mainland",
    junction: r.junction ?? r.name ?? r.slug,
    roadA: r.road_a ?? "",
    roadB: r.road_b ?? "",
    lat: r.lat,
    lng: r.lng,
    wave: r.wave ?? 4,
    status,
    zone: r.zone_geojson && (r.zone_geojson.type === "Polygon" || r.zone_geojson.type === "MultiPolygon") ? r.zone_geojson : null,
    hereBand: band(r.here_band),
    hereN: typeof r.here_n === "number" ? r.here_n : null,
    todayBand: band(r.today_band),
    todayN: typeof r.today_n === "number" ? r.today_n : null,
  };
}

/** The list is the same for everyone, so a visit to Play and back does not fetch the 40 KB of shapes again straight away. */
let cached: { list: Hotspot[]; at: number } | null = null;

/**
 * The hotspots (hotspot_list(), public even signed out) and what "near you" means for one Hopper. Everything about the
 * Hopper's position happens here, on the phone: the zone test uses the public shapes and the distances use the fixed
 * junction points. The server is never told where anyone is.
 *
 * `at` is the Hopper's position inside Lagos, or null (location off, or not in Lagos): then there is no "your
 * hotspot" and no distances, and the list runs in wave order with Yaba on top.
 */
export function useHotspots({ active, at }: { active: boolean; at: Pt | null }) {
  const [list, setList] = useState<Hotspot[]>(() => (DEMO ? DEMO_HOTSPOTS : (cached?.list ?? [])));
  const [loaded, setLoaded] = useState(DEMO || !!cached);
  const lastLoad = useRef(0);
  const inFlight = useRef(false);

  const reload = useCallback(async (force = false) => {
    if (DEMO) return;
    const sb = getSupabase();
    if (!sb || inFlight.current) return;
    if (!force && Date.now() - lastLoad.current < SHEET_REFRESH_MS) return;
    inFlight.current = true;
    try {
      const { data, error } = await sb.rpc("hotspot_list");
      // An old database has no hotspot_list; a flaky network fails the call. Either way keep what is on the map.
      if (error || !Array.isArray(data)) return;
      // The server sends wave order; Yaba, where the events are, leads it.
      const rows = (data as Raw[])
        .map(toHotspot)
        .filter((h): h is Hotspot => !!h)
        .sort((a, b) => Number(b.slug === "yaba") - Number(a.slug === "yaba") || a.wave - b.wave);
      lastLoad.current = Date.now();
      cached = { list: rows, at: lastLoad.current };
      setList(rows);
      setLoaded(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void reload();
    const t = setInterval(() => document.visibilityState === "visible" && void reload(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [active, reload]);

  // Position jitters every second; the answers only change by a street or two. Work from a ~110 m grid.
  const key = at ? `${at.lat.toFixed(3)},${at.lng.toFixed(3)}` : "";
  const here = useMemo<Pt | null>(() => {
    if (!key) return null;
    const [lat, lng] = key.split(",").map(Number);
    return { lat, lng };
  }, [key]);

  return useMemo(() => {
    const yours = yoursOf(list, here);
    const others = nearestOthers(list, here, yours?.slug ?? null, here ? 2 : 3);
    // With no position the row is wave order, open ones first, Yaba on top.
    const row = here
      ? [...(yours ? [yours] : []), ...others]
      : list.filter((h) => h.status === "open").slice(0, 3);
    const metres = (h: Hotspot) => (here ? metresApart(here, h) : null);
    const bySlug = (slug: string | null) => (slug ? (list.find((h) => h.slug === slug.toLowerCase()) ?? null) : null);
    return {
      list,
      loaded,
      yours,
      row,
      pins: pinsFor(list, here, yours?.slug ?? null),
      /** Metres from the Hopper, or null when we do not know where they are. Never sent anywhere. */
      metres,
      located: !!here,
      bySlug,
      reload,
    };
  }, [list, loaded, here, reload]);
}

export type HotspotsData = ReturnType<typeof useHotspots>;
