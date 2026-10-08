"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { BRAND } from "@/lib/brand";
import { MAP_PALETTE, addCityLayer, fallbackStyle, loadBrandStyle, riseCity, CITY_LAYER } from "@/lib/mapStyle";
import { hopDayLabel, type BusFix } from "@/lib/busPosition";
import { normalizeLook } from "@/lib/avatar";
import { avatarSvg } from "@/lib/avatarSvg";
import {
  LAGOS_BOUNDS,
  LAGOS_CENTER,
  areaByName,
  clockShort,
  eventPrice,
  eventPriceShort,
  eventTitle,
  isEventLead,
  travelEstimate,
} from "@/lib/geo";
import { dayLabel, nightOf, nightTag } from "@/lib/filters";
import { crowdAt, crowdLevel, TONE_HEX } from "@/lib/crowd";
import { lotFeatures } from "@/lib/eventLots";
import { useTheme } from "@/lib/useTheme";
import type { Theme } from "@/lib/theme";
import type { EventRow, HopStop } from "@/lib/types";
import { SIDE_PANEL, sidePanelWidth } from "@/components/event/side";
import { mountVenueModels, updateVenueModels } from "./venueModels";

// Next's app bundlers cannot infer MapLibre's dynamically resolved module-worker
// URL. Serve the package worker as a same-origin static asset instead.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

export type NightMapProps = {
  events: EventRow[];
  /** Events with a live drop: their sign carries a DROP pill. */
  collectibleEventIds?: string[];
  hopStops: HopStop[];
  fix: { lat: number; lng: number; area?: string | null; source?: "gps" | "area" } | null;
  radiusKm: number;
  /** The moment the heat map shows: now (live) or a slot later in the night (expected). */
  at: number;
  live: boolean;
  /** @deprecated Crew faces are not drawn on the map. Kept so callers compile. */
  crew?: unknown[];
  /** The Hopper's own look, drawn as their pin. */
  myLook?: unknown;
  /** Where the Hop bus is (estimated from the schedule), drawn as its own marker. */
  bus: BusFix | null;
  /** Bumped by the bus button in the HUD: fly to the bus. */
  busFocus?: number;
  /** Flips true once the intro is out of the way: the camera then swoops in. */
  play?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHopSelect: () => void;
  /** Changes when the filters change: the camera frames whatever now matches. */
  fitKey: string;
  /** A tap on empty map: close whatever card is open. */
  onClear: () => void;
  /**
   * True when the selected day is the Hop's date: the purple route, its stops and
   * the moving bus show. False: no purple, the bus parks at stop 1 under a
   * "NEXT HOP" banner. Omitted: always show the route.
   */
  hopActive?: boolean;
  /** The Hop's date, "YYYY-MM-DD", for the "NEXT HOP · SAT 18" banner. Falls back to bus.hopDate. */
  hopDate?: string | null;
  /** The parked bus and its banner are tappable. Defaults to onHopSelect. */
  onBus?: () => void;
  /**
   * How much of the map the page's own chrome covers, px from the top and bottom
   * edges. Signs never sit under it and the camera frames inside it.
   */
  hudTop?: number;
  hudBottom?: number;
  /**
   * The open event docks on the right (see components/event/side.ts). The camera
   * then pulls in and stands the venue's house in the strip of map to its left.
   */
  sidePanel?: boolean;
  /** Every pin orange (the map's opening "next 20" view), not just the busy ones. */
  allHot?: boolean;
  /** Sealed boxes (drops) to place on the map. Tapping one calls onBox. */
  boxes?: MapBox[];
  onBox?: (id: string) => void;
  /** Filled with a finder for the side card's arrows: the nearest event left (-1) or right (1) of one, on screen. */
  navRef?: React.MutableRefObject<((fromId: string, dir: -1 | 1) => string | null) | null>;
};

/** A drop on the map: a sealed box at its spot. Open ones glow; sealed ones carry when they open. */
export type MapBox = { id: string; lat: number; lng: number; open: boolean; label: string; hunt: boolean };

type Mode = "card" | "banner" | "mini";
type Box = [number, number, number, number];

type Sign = {
  mk: maplibregl.Marker;
  rank: number;
  /** Measured whenever the content changes: each mode's size in px. */
  size: Partial<Record<Mode, [number, number]>>;
  sig: string;
};

/** Room left between two billboards, px. */
const GAP = 4;
/** What the page's chrome covers when it does not say: the day rail above, the scrubber below. */
const DEFAULT_HUD = { top: 132, bottom: 96 };
/** From here in, venues are 3D houses: dots fade, and signs become cards floating over the roofs. */
const STREET_ZOOM = 14.6;
/** A sign stands this far above its dot, px. Up close it is lifted past the house instead. */
const MARKER_LIFT = 10;
/** A house with its floating diamond is about this tall, metres (see eventLots.ts). */
const HOUSE_TOP_M = 95;
/** Picking an event pulls the camera in to at least this zoom, tilted, so the house stands up. */
const PICK_ZOOM = 15.6;
/** With the card docked on the right the house has a narrow strip, so the camera comes in closer. */
const PICK_ZOOM_SIDE = 16;
const NO_IDS: string[] = [];
const NO_BOXES: MapBox[] = [];

const SRC = {
  heat: "hoppaz-heat",
  pins: "hoppaz-pins",
  hop: "hoppaz-hop",
  lots: "hoppaz-lots",
  radius: "hoppaz-radius",
} as const;

/** The little Hop bus from the intro: cream body, orange windows. */
const BUS_ART =
  '<svg viewBox="0 0 32 20" width="28" height="18" aria-hidden="true"><rect x="1" y="1" width="30" height="14" rx="3" fill="#F5EBDD"/><rect x="4" y="4" width="6" height="5" rx="1" fill="#FF4D00"/><rect x="12" y="4" width="6" height="5" rx="1" fill="#FF4D00"/><rect x="20" y="4" width="8" height="7" rx="1" fill="#0E0B0A"/><circle cx="8" cy="16" r="3" fill="#0E0B0A"/><circle cx="24" cy="16" r="3" fill="#0E0B0A"/></svg>';

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

function circlePolygon(lat: number, lng: number, km: number, steps = 96) {
  const coords: [number, number][] = [];
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return coords;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text; // textContent throughout: titles and venues come from Hoppers
  return el;
};

/** A Hopper's face in a ring with a little pointer, as a map marker element. */
function faceMarker(look: unknown, uid: string, ring: string) {
  const el = document.createElement("div");
  el.className = "pointer-events-none flex flex-col items-center";
  const face = document.createElement("div");
  face.className = "h-9 w-9 overflow-hidden rounded-full border-2 bg-orange shadow-chunk-sm";
  face.style.borderColor = ring;
  // Safe: normalizeLook() whitelists every field, so no stored text reaches the markup.
  face.innerHTML = avatarSvg(normalizeLook(look), { uid, crop: "head" });
  const tip = document.createElement("div");
  tip.className = "h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent";
  tip.style.borderTopColor = ring;
  el.append(face, tip);
  return el;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Camera durations drop to zero for anyone who asked their phone for less motion. */
const ms = (n: number) => (reducedMotion() ? 0 : n);

const MONTHS = /\s(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/;
/** "11PM" tonight, "SAT 18 · 10PM" on another day: dayLabel without the month, for a small sign. */
function whenShort(e: EventRow) {
  if (isEventLead(e)) return "CHECK DETAILS";
  const label = dayLabel(e.starts_at);
  if (label.startsWith("TODAY · ") || label.startsWith("TONIGHT · ")) return clockShort(e.starts_at);
  return label.replace(MONTHS, "");
}

const framePadding = (ins: { top: number; bottom: number }) => ({
  // Signs stand above their dots, so the top needs more room than the bottom.
  top: ins.top + 56,
  bottom: ins.bottom + 44,
  left: 36,
  right: 36,
});

function boundsOf(points: Array<{ lat: number; lng: number }>) {
  const b = new maplibregl.LngLatBounds();
  points.forEach((p) => b.extend([p.lng, p.lat]));
  return b;
}

/**
 * Every Hoppaz source and layer, built (or rebuilt) once a basemap style is in.
 * MapLibre's setStyle drops all of it, so this runs on first load and again
 * after every day/night swap. Each add is guarded, so it is safe to call twice.
 */
function setupLayers(m: MLMap, theme: Theme, cityGrown: boolean) {
  const P = MAP_PALETTE[theme];
  const night = theme === "night";

  /* ---- the 3D city, under the basemap labels: neutral concrete, grows in the first time ---- */
  const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
  if (!m.getLayer(CITY_LAYER)) addCityLayer(m, firstSymbol, theme, cityGrown);
  // Later: the Campus Twin venue models mount here and take the houses' place (see venueModels.ts).
  mountVenueModels(m, theme);

  /* ---- venues as Sims houses: walls, stepped roof, a floating diamond ---- */
  if (!m.getSource(SRC.lots)) m.addSource(SRC.lots, { type: "geojson", data: fc([]) });
  if (!m.getLayer("lots")) {
    m.addLayer(
      {
        id: "lots",
        type: "fill-extrusion",
        source: SRC.lots,
        minzoom: 13,
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "top"],
          "fill-extrusion-vertical-gradient": false,
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 13.6, 1],
        },
      },
      firstSymbol
    );
  }

  /* ---- heat: the first thing you see, before any individual pin ---- */
  if (!m.getSource(SRC.heat)) m.addSource(SRC.heat, { type: "geojson", data: fc([]) });
  if (!m.getLayer("heat-blur")) {
    // Night: ember, orange, then a cream core where the night is. No violet edge.
    // Day: the cream core would vanish on a cream map, so it peaks at orange.
    const ramp = night
      ? [0, "rgba(14,11,10,0)", 0.18, "rgba(184,54,0,0.22)", 0.42, "rgba(184,54,0,0.55)", 0.7, "rgba(255,77,0,0.78)", 1, "rgba(245,235,221,0.92)"]
      : [0, P.heat[0], 0.2, P.heat[1], 0.55, P.heat[2], 1, P.heat[3]];
    m.addLayer({
      id: "heat-blur",
      type: "heatmap",
      source: SRC.heat,
      maxzoom: 16,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "crowd"], 0, 0, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.9, 15, 2.4],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 22, 13, 48, 16, 90],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.75, 15.5, 0.35, 16, 0],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], ...ramp] as ExpressionSpecification,
      },
    });
  }

  /* ---- radius ring ---- */
  if (!m.getSource(SRC.radius)) m.addSource(SRC.radius, { type: "geojson", data: fc([]) });
  if (!m.getLayer("radius-fill")) {
    m.addLayer({
      id: "radius-fill",
      type: "fill",
      source: SRC.radius,
      paint: { "fill-color": BRAND.orange, "fill-opacity": 0.04 },
    });
  }
  if (!m.getLayer("radius-line")) {
    m.addLayer({
      id: "radius-line",
      type: "line",
      source: SRC.radius,
      paint: { "line-color": BRAND.orange, "line-width": 1.5, "line-opacity": 0.5, "line-dasharray": [3, 4] },
    });
  }

  /* ---- the Hop route: violet, and only on the Hop's day. Numbered stops are DOM markers ---- */
  if (!m.getSource(SRC.hop)) m.addSource(SRC.hop, { type: "geojson", data: fc([]) });
  if (!m.getLayer("hop-line")) {
    m.addLayer({
      id: "hop-line",
      type: "line",
      source: SRC.hop,
      paint: { "line-color": BRAND.violet, "line-width": 3, "line-opacity": 0.85 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  /* ---- event pins: hot ones glow orange; up close the house takes over ---- */
  if (!m.getSource(SRC.pins)) m.addSource(SRC.pins, { type: "geojson", data: fc([]) });
  if (!m.getLayer("pins-halo")) {
    m.addLayer({
      id: "pins-halo",
      type: "circle",
      source: SRC.pins,
      filter: ["==", ["get", "hot"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "heat"], 55, 18, 100, 30],
        "circle-color": BRAND.orange,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM - 0.6, 0.14, STREET_ZOOM, 0],
      },
    });
  }
  if (!m.getLayer("pins")) {
    m.addLayer({
      id: "pins",
      type: "circle",
      source: SRC.pins,
      paint: {
        "circle-radius": [
          "case",
          ["get", "inRange"],
          ["interpolate", ["linear"], ["get", "heat"], 0, 7, 100, 12],
          6,
        ] as ExpressionSpecification,
        "circle-color": [
          "case",
          ["get", "hot"], BRAND.orange,
          ["!", ["get", "inRange"]], night ? "#2C2017" : "#CDBEA9",
          "#6E4433",
        ] as ExpressionSpecification,
        "circle-stroke-color": ["case", ["get", "selected"], P.text, P.ground] as ExpressionSpecification,
        "circle-stroke-width": 2,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM - 0.6, 1, STREET_ZOOM, 0],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM - 0.6, 1, STREET_ZOOM, 0],
      },
    });
  }
}

export default function NightMap({
  events,
  collectibleEventIds = NO_IDS,
  hopStops,
  fix,
  radiusKm,
  at,
  live,
  myLook,
  bus,
  busFocus = 0,
  play = true,
  selectedId,
  onSelect,
  onHopSelect,
  onClear,
  fitKey,
  hopActive,
  hopDate,
  onBus,
  hudTop = DEFAULT_HUD.top,
  hudBottom = DEFAULT_HUD.bottom,
  sidePanel = false,
  allHot = false,
  boxes = NO_BOXES,
  onBox,
  navRef,
}: NightMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  /** True while the style and our layers are in; false mid-swap. */
  const ready = useRef(false);
  /** Bumps each time our layers are (re)built, so data and markers repaint. 0 = nothing yet. */
  const [epoch, setEpoch] = useState(0);
  /** Bumps when web fonts land, so signs are measured in their real font. */
  const [fontsEpoch, setFontsEpoch] = useState(0);
  /** Bumps every minute so "TODAY" and "ENDED" on the signs do not go stale. */
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const theme = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  /** The theme the loaded basemap was painted for. */
  const styleTheme = useRef<Theme | null>(null);
  const swapping = useRef(false);
  const swapToken = useRef(0);
  /** The city has risen once; a day/night swap rebuilds it standing. */
  const cityGrown = useRef(false);

  const cbs = useRef({ onSelect, onHopSelect, onClear, onBus, onBox });
  cbs.current = { onSelect, onHopSelect, onClear, onBus, onBox };
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const radiusRef = useRef(radiusKm);
  radiusRef.current = radiusKm;
  const insetsRef = useRef({ top: hudTop, bottom: hudBottom });
  insetsRef.current = { top: hudTop, bottom: hudBottom };
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const sideRef = useRef(sidePanel);
  sideRef.current = sidePanel;
  const stopsRef = useRef(hopStops);
  stopsRef.current = hopStops;

  /* ---- what the bus shows: the live route on the Hop's day, parked at stop 1 on every other ---- */
  const showHop = hopActive ?? true;
  // The page may hand over no stops on other days, so the boarding point rides on the bus fix.
  const firstStop = hopStops.reduce<HopStop | null>((a, s) => (!a || s.idx < a.idx ? s : a), null);
  const nextDate = hopDate ?? bus?.hopDate;
  const busShown =
    bus &&
    (showHop
      ? { lat: bus.lat, lng: bus.lng, label: bus.label, moving: bus.moving, parked: false }
      : {
          lat: bus.boarding?.lat ?? firstStop?.lat ?? bus.lat,
          lng: bus.boarding?.lng ?? firstStop?.lng ?? bus.lng,
          label: bus.phase === "after" || !nextDate ? "NEXT HOP SOON" : `NEXT HOP · ${hopDayLabel(nextDate)}`,
          moving: false,
          parked: true,
        });
  const showHopRef = useRef(showHop);
  showHopRef.current = showHop;
  /** What the camera frames: the day's events, plus the Hop's stops on the Hop's day. */
  const framePoints = () => [...eventsRef.current, ...(showHopRef.current ? stopsRef.current : [])];
  const busRef = useRef(busShown);
  busRef.current = busShown;
  const busKey = busShown ? `${busShown.lat.toFixed(5)},${busShown.lng.toFixed(5)}|${busShown.label}|${busShown.moving}|${busShown.parked}` : "";

  const signs = useRef(new Map<string, Sign>());
  const stopMks = useRef<maplibregl.Marker[]>([]);
  const busMk = useRef<maplibregl.Marker | null>(null);
  const meMk = useRef<maplibregl.Marker | null>(null);
  const boxMks = useRef(new Map<string, maplibregl.Marker>());
  const hover = useRef<maplibregl.Popup | null>(null);
  const declutter = useRef(() => {});

  /* ------------------------------------------------------------ hover card -- */
  const showPeek = (id: string) => {
    const m = map.current;
    const e = eventsRef.current.find((x) => x.id === id);
    // The open event already has its card; a hover card over it would cover the house.
    if (!m || !e || id === selectedRef.current || !window.matchMedia("(hover: hover)").matches) return;
    const box = make("div", "hz-peek-body");
    const line = (cls: string, text: string) => box.append(make("p", cls, text));
    line("hz-peek-title", `${isEventLead(e) ? "LEAD · " : ""}${eventTitle(e)}`);
    line("hz-peek-sub", `${e.venue_name}${e.area ? ` · ${e.area}` : ""}`);
    line("hz-peek-meta", `${eventPrice(e)} · ${isEventLead(e) ? "CHECK DETAILS" : dayLabel(e.starts_at)} · ${e.vibe.toUpperCase()}`);
    const f = fixRef.current;
    if (f) {
      const trip = travelEstimate({ ...f, side: areaByName(f.area ?? null)?.side }, { lat: e.lat, lng: e.lng, side: areaByName(e.area)?.side });
      line(
        "hz-peek-sub",
        `~${trip.minutes} min · ${(e.distance_m / 1000).toFixed(1)} km${trip.crossesBridge ? " · over the bridge" : ""}${e.distance_m / 1000 > radiusRef.current ? " · outside your radius" : ""}`
      );
    }
    hover.current?.remove();
    // Below the dot, unless that would tuck it under the page's bottom chrome.
    const low = m.project([e.lng, e.lat]).y > m.getContainer().clientHeight - insetsRef.current.bottom - 170;
    hover.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: low ? 22 : 14, anchor: low ? "bottom" : "top", className: "hz-peek", maxWidth: "240px" })
      .setLngLat([e.lng, e.lat])
      .setDOMContent(box)
      .addTo(m);
  };
  const hidePeek = () => {
    hover.current?.remove();
    hover.current = null;
  };
  // The init effect binds once; this ref lets it reach the current handlers.
  const peek = useRef({ show: showPeek, hide: hidePeek });
  peek.current = { show: showPeek, hide: hidePeek };

  /* ------------------------------------------------- declutter the signs -- */
  // Every event stands on the map as a rooftop billboard over its dot; up close it
  // is a card with the flyer on top, floating over its house. Where signs would
  // overlap, the lower-ranked one shrinks to a price tag, then to just its dot.
  // Runs on every move.
  declutter.current = () => {
    const m = map.current;
    if (!m) return;
    const street = m.getZoom() >= STREET_ZOOM;
    // Up close the house stands under the sign, so the sign floats above its roof and diamond.
    const mpp = (156543.03 * Math.cos((m.getCenter().lat * Math.PI) / 180)) / 2 ** m.getZoom();
    const lift = street ? Math.round(18 + (HOUSE_TOP_M / mpp) * Math.sin((m.getPitch() * Math.PI) / 180)) : MARKER_LIFT;
    holder.current?.classList.toggle("hz-street", street);
    holder.current?.style.setProperty("--hz-lift", `${lift - MARKER_LIFT}px`);

    const { top, bottom } = insetsRef.current;
    const { clientWidth: vw, clientHeight: vh } = m.getContainer();
    const taken: Box[] = [];
    const reserve = (lng: number, lat: number, left: number, up: number, right: number, down: number) => {
      const p = m.project([lng, lat]);
      taken.push([p.x - left, p.y - up, p.x + right, p.y + down]);
    };
    // The open event's card covers the right of the map: nothing else may hide under it.
    const side = sideRef.current && !!selectedRef.current;
    if (side) taken.push([vw - sidePanelWidth(vw) - SIDE_PANEL.gap * 2, 0, vw, vh]);
    // Your face sits above your point, the bus hangs below its own, the stops and zoom buttons stay clear.
    const me = meMk.current?.getLngLat();
    if (me) reserve(me.lng, me.lat, 20, 46, 20, 0);
    const h0 = holder.current?.getBoundingClientRect();
    const busEl = busMk.current?.getElement();
    if (busEl && h0) {
      const r = busEl.getBoundingClientRect();
      // A bus tucked under the page's chrome reads as broken: hide it until it clears.
      const fits = !r.width || (r.top - h0.top >= top && r.bottom - h0.top <= vh - bottom);
      busEl.style.visibility = fits ? "" : "hidden";
      if (fits && r.width) taken.push([r.left - h0.left, r.top - h0.top, r.right - h0.left, r.bottom - h0.top]);
    }
    stopMks.current.forEach((mk) => {
      const ll = mk.getLngLat();
      reserve(ll.lng, ll.lat, 14, 14, 14, 14);
    });
    // A box and its label sit just above its point.
    boxMks.current.forEach((mk) => {
      const ll = mk.getLngLat();
      reserve(ll.lng, ll.lat, 34, 58, 34, 4);
    });
    const ctrl = holder.current?.querySelector(".maplibregl-ctrl-top-right .maplibregl-ctrl-group");
    if (ctrl && h0) {
      const c = ctrl.getBoundingClientRect();
      if (c.width) taken.push([c.left - h0.left, c.top - h0.top, c.right - h0.left, c.bottom - h0.top]);
    }
    // A sign cut off by the screen edge or tucked under the chrome reads as broken:
    // it only shows if it fits, otherwise it drops to its price tag, then its dot.
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      x0 >= GAP && x1 <= vw - GAP && y0 >= top && y1 <= vh - bottom &&
      !taken.some(([a0, b0, a1, b1]) => x0 < a1 + GAP && x1 + GAP > a0 && y0 < b1 + GAP && y1 + GAP > b0);
    const order: Mode[] = street ? ["card", "banner", "mini"] : ["banner", "mini"];
    [...signs.current.values()]
      .sort((a, b) => a.rank - b.rank)
      .forEach((sg) => {
        const el = sg.mk.getElement();
        const p = m.project(sg.mk.getLngLat());
        const picked = el.classList.contains("hz-on");
        let mode: Mode | "off" = "off";
        for (const name of order) {
          const size = sg.size[name];
          if (!size) continue;
          const [w, h] = size;
          const box: Box = [p.x - w / 2, p.y - lift - h, p.x + w / 2, p.y - lift];
          // The one you picked always shows, in the fullest form that clears the top chrome;
          // everything else has to fit and avoid it.
          const ok = picked ? box[1] >= top || name === "mini" : free(...box);
          if (ok) {
            taken.push(box);
            mode = name;
            break;
          }
        }
        if (el.dataset.mode !== mode) el.dataset.mode = mode;
        // The flyer only downloads once its card is actually on screen.
        if (mode === "card") {
          const img = el.querySelector<HTMLImageElement>(".hz-art img[data-src]");
          if (img) {
            img.src = img.dataset.src ?? "";
            img.removeAttribute("data-src");
          }
        }
      });
  };

  /* ---------------------------------------------------------------- init -- */
  useEffect(() => {
    if (!holder.current || map.current) return;
    const ac = new AbortController();
    let m: MLMap | null = null;

    (async () => {
      const t = themeRef.current;
      let style: StyleSpecification;
      try {
        style = await loadBrandStyle(t, ac.signal);
      } catch {
        style = fallbackStyle(t); // tile host unreachable: still open the app
      }
      if (ac.signal.aborted || !holder.current) return;
      styleTheme.current = t;

      // The map opens high over Lagos; the swoop (below) brings it down once the intro is done.
      const created = new maplibregl.Map({
        container: holder.current,
        style,
        center: [LAGOS_CENTER.lng, LAGOS_CENTER.lat],
        zoom: 10.6,
        minZoom: 9,
        maxZoom: 17,
        maxBounds: LAGOS_BOUNDS, // Lagos only, for now
        maxPitch: 60,
        // The credit is added below, as plain text clear of the bottom chrome.
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      m = created;
      map.current = created;
      created.on("error", (event) => {
        console.warn("[hoppaz] map:", event.error);
      });
      created.touchZoomRotate.disableRotation();
      created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      created.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");

      // A style swap (day/night) drops every custom source and layer; rebuild them.
      created.on("style.load", () => {
        if (!swapping.current || map.current !== created) return;
        swapping.current = false;
        setupLayers(created, themeRef.current, cityGrown.current);
        styleTheme.current = themeRef.current;
        ready.current = true;
        setEpoch((n) => n + 1);
      });

      created.on("load", () => {
        if (!m) return;
        setupLayers(m, styleTheme.current ?? themeRef.current, false);

        // Buildings only exist from z13; grow them the first time they show.
        if (m.getLayer(CITY_LAYER)) {
          const grow = () => {
            if (m!.getZoom() < 13.4) return;
            m!.off("moveend", grow);
            cityGrown.current = true;
            riseCity(m!, ms(1100));
          };
          m.on("moveend", grow);
        } else {
          cityGrown.current = true;
        }

        /* ---- interaction ---- */
        for (const layer of ["pins", "lots"]) {
          m.on("mouseenter", layer, () => {
            m!.getCanvas().style.cursor = "pointer";
          });
          m.on("mouseleave", layer, () => {
            m!.getCanvas().style.cursor = "";
            peek.current.hide();
          });
        }
        m.on("mousemove", "pins", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) peek.current.show(String(id));
        });
        // A dot is small: tapping near one counts, and so does tapping a house.
        // Tap on nothing closes the card. Signs, stops and the bus are markers and stop their own clicks.
        m.on("click", (e) => {
          if (!m!.getLayer("pins")) return;
          const house = m!.getLayer("lots") ? m!.queryRenderedFeatures(e.point, { layers: ["lots"] })[0] : undefined;
          if (house) {
            cbs.current.onSelect(String(house.properties?.id));
            return;
          }
          const pad = 12;
          const hits = m!.queryRenderedFeatures(
            [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]],
            { layers: ["pins"] }
          );
          if (!hits.length) {
            cbs.current.onClear();
            return;
          }
          let best = hits[0];
          let bestD = Infinity;
          for (const f of hits) {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            const p = m!.project([lng, lat]);
            const d = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
            if (d < bestD) {
              best = f;
              bestD = d;
            }
          }
          cbs.current.onSelect(String(best.properties?.id));
        });

        // Signs re-sort themselves so they never pile into one blob.
        let queued = false;
        m.on("move", () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            declutter.current();
          });
        });

        ready.current = true;
        m.resize();
        setEpoch((n) => n + 1);
      });
    })();

    const signMap = signs.current;
    const boxMap = boxMks.current;
    return () => {
      ac.abort();
      ready.current = false;
      signMap.clear();
      stopMks.current = [];
      boxMap.clear();
      busMk.current = null;
      meMk.current = null;
      hover.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Web fonts land after first paint; signs measured before that are the wrong width.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsEpoch((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  /* ------------------------------------------------ day / night basemap ---- */
  // Day is positron on cream, night is the original Hoppaz night paint. When the
  // Lagos clock flips the theme while the map is open, swap the basemap and rebuild.
  useEffect(() => {
    const m = map.current;
    if (!m || epoch === 0 || styleTheme.current === theme) return;
    const token = ++swapToken.current;
    (async () => {
      let style: StyleSpecification;
      try {
        style = await loadBrandStyle(theme);
      } catch {
        style = fallbackStyle(theme);
      }
      if (token !== swapToken.current || map.current !== m) return;
      ready.current = false;
      swapping.current = true;
      // diff:false forces a full swap, which is what fires style.load (see init).
      m.setStyle(style, { diff: false });
    })();
  }, [theme, epoch]);

  /* ------------------------------------------------ chrome insets as CSS ---- */
  useEffect(() => {
    const h = holder.current;
    if (!h) return;
    h.style.setProperty("--hz-inset-top", `${hudTop}px`);
    h.style.setProperty("--hz-inset-bottom", `${hudBottom}px`);
    declutter.current();
  }, [hudTop, hudBottom, epoch]);

  /* --------------------------------------------------------------- data -- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || !m.getSource(SRC.pins)) return;
    const inRange = (e: EventRow) => !fix || e.distance_m / 1000 <= radiusKm;

    (m.getSource(SRC.heat) as GeoJSONSource).setData(
      fc(
        events.map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lng, e.lat] },
          properties: { crowd: crowdAt(e, at, live) },
        }))
      )
    );

    (m.getSource(SRC.lots) as GeoJSONSource).setData(
      fc(
        events.flatMap((e) => {
          const tone = crowdLevel(e, at, crowdAt(e, at, live)).tone;
          return lotFeatures(e, tone, e.id === selectedId);
        })
      )
    );

    (m.getSource(SRC.pins) as GeoJSONSource).setData(
      fc(
        events.map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lng, e.lat] },
          properties: { id: e.id, heat: e.heat, hot: allHot || e.heat >= 55, inRange: inRange(e), selected: e.id === selectedId },
        }))
      )
    );

    // The purple route only draws on the Hop's day.
    const stops = hopStops.slice().sort((a, b) => a.idx - b.idx);
    (m.getSource(SRC.hop) as GeoJSONSource).setData(
      fc(
        showHop && stops.length > 1
          ? [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: stops.map((s) => [s.lng, s.lat]) },
                properties: {},
              },
            ]
          : []
      )
    );

    (m.getSource(SRC.radius) as GeoJSONSource).setData(
      fc(
        fix
          ? [
              {
                type: "Feature",
                geometry: { type: "Polygon", coordinates: [circlePolygon(fix.lat, fix.lng, radiusKm)] },
                properties: {},
              },
            ]
          : []
      )
    );

    // Later: the venue models follow the same events and selection.
    updateVenueModels(m, { theme: themeRef.current, events, selectedId });
  }, [epoch, events, hopStops, showHop, fix, radiusKm, selectedId, at, live, allHot]);

  /* -------------------------------------------------------- event signs -- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const drops = new Set(collectibleEventIds);
    const inRange = (e: EventRow) => !fix || e.distance_m / 1000 <= radiusKm;
    const order = events
      .slice()
      .sort(
        (a, b) =>
          Number(b.id === selectedId) - Number(a.id === selectedId) ||
          Number(inRange(b)) - Number(inRange(a)) ||
          b.heat - a.heat
      );
    const keep = new Set(order.map((e) => e.id));
    signs.current.forEach((sg, id) => {
      if (!keep.has(id)) {
        sg.mk.remove();
        signs.current.delete(id);
      }
    });

    order.forEach((e, rank) => {
      let sg = signs.current.get(e.id);
      if (!sg) {
        // button > board > (face: art + text) + price tag + two posts
        const el = make("button", "hz-sign");
        el.type = "button";
        const board = make("span", "hz-board");
        // Signs pop up one after another, the way the intro's signs do.
        board.style.setProperty("--d", `${Math.min(rank, 20) * 0.06}s`);
        const face = make("span", "hz-face");
        const art = make("span", "hz-art");
        const text = make("span", "hz-text");
        const meta = make("span", "hz-meta");
        meta.append(make("i", "hz-gem"), make("span", "hz-when"), make("span", "hz-drop", "DROP"));
        text.append(make("b", "hz-name"), meta);
        face.append(art, text);
        const posts = make("span", "hz-posts");
        posts.append(make("i", ""), make("i", ""));
        board.append(face, make("span", "hz-mini"), posts);
        el.append(board);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          hidePeek();
          cbs.current.onSelect(e.id);
        });
        el.addEventListener("mouseenter", () => peek.current.show(e.id));
        el.addEventListener("mouseleave", () => peek.current.hide());
        const mk = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -MARKER_LIFT] })
          .setLngLat([e.lng, e.lat])
          .addTo(m);
        sg = { mk, rank, size: {}, sig: "" };
        signs.current.set(e.id, sg);
      }
      sg.rank = rank;
      const el = sg.mk.getElement();
      const on = e.id === selectedId;
      const hasDrop = drops.has(e.id);
      const lead = isEventLead(e);
      const name = `${lead ? "LEAD · " : ""}${eventTitle(e)}`;
      const when = whenShort(e);
      const price = eventPriceShort(e);
      const trip = fix
        ? travelEstimate({ ...fix, side: areaByName(fix.area ?? null)?.side }, { lat: e.lat, lng: e.lng, side: areaByName(e.area)?.side })
        : null;
      const line = `${lead ? when : `${price} · ${when}`}${trip ? ` · ${trip.minutes}MIN` : ""}`;
      const flyer = e.flyer_url && /^https?:\/\//i.test(e.flyer_url) ? e.flyer_url : "";
      const tone = crowdLevel(e, at, crowdAt(e, at, live)).tone;

      el.classList.toggle("hz-on", on);
      el.classList.toggle("hz-far", !inRange(e));
      el.classList.toggle("hz-has-drop", hasDrop);
      el.style.zIndex = on ? "4" : String(Math.max(1, 3 - Math.floor(rank / 10)));
      el.setAttribute("aria-label", `${name}, ${lead ? "event lead; verify details" : `${eventPrice(e)}, ${when}`}${hasDrop ? ", drop live" : ""}`);
      // The diamond's colour says how busy it is, the same diamond that floats over the house.
      (el.querySelector(".hz-gem") as HTMLElement).style.background = TONE_HEX[tone];

      // Re-measure only when the content changed: it costs a layout per mode.
      const sig = `${name}|${line}|${hasDrop}|${flyer}|${e.vibe}|${fontsEpoch}`;
      if (sig !== sg.sig) {
        sg.sig = sig;
        (el.querySelector(".hz-name") as HTMLElement).textContent = name;
        (el.querySelector(".hz-when") as HTMLElement).textContent = line;
        // A lead has no price yet; its night says more than "LEAD" would on every pin.
        (el.querySelector(".hz-mini") as HTMLElement).textContent = lead ? nightTag(nightOf(Date.parse(e.starts_at))) : price;
        (el.querySelector(".hz-drop") as HTMLElement).hidden = !hasDrop;
        const art = el.querySelector(".hz-art") as HTMLElement;
        art.dataset.vibe = e.vibe;
        art.replaceChildren();
        if (flyer) {
          // The branded block under it shows until the flyer loads, and stays if it never does.
          const img = document.createElement("img");
          img.alt = "";
          img.decoding = "async";
          img.dataset.src = flyer;
          img.addEventListener("error", () => img.remove());
          art.append(img);
        }
        const was = el.dataset.mode;
        for (const mode of ["card", "banner", "mini"] as const) {
          el.dataset.mode = mode;
          sg.size[mode] = [el.offsetWidth, el.offsetHeight];
        }
        el.dataset.mode = was ?? "off";
      }
    });
    declutter.current();
  }, [epoch, events, collectibleEventIds, fix, radiusKm, selectedId, at, live, fontsEpoch, minute]);

  /* ------------------------------------------------------- the swoop ---- */
  // After the titles: start high and flat over Lagos, then sweep down into a
  // pitched, illustrated city at an angle. Once per visit to the map.
  const swooped = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || !play || swooped.current) return;
    swooped.current = true;
    const to = fixRef.current ?? LAGOS_CENTER;
    m.jumpTo({ center: [LAGOS_CENTER.lng - 0.08, LAGOS_CENTER.lat + 0.03], zoom: 9.6, pitch: 0, bearing: 0 });
    m.flyTo({ center: [to.lng, to.lat], zoom: fixRef.current ? 12.2 : 11.2, pitch: 50, bearing: -14, duration: ms(3400), curve: 1.3 });
  }, [epoch, play]);

  /* -------------------------------------------- frame the filtered events ---- */
  const lastFit = useRef(fitKey);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || fitKey === lastFit.current) return;
    lastFit.current = fitKey;
    if (!events.length) return;
    // Frame what is within your reach, so a day spread from Ikeja to Tarkwa Bay does not shrink
    // into one blob where no sign fits. Fewer than two in reach: the whole day. Hop day keeps its route in.
    const f = fixRef.current;
    const near = f ? eventsRef.current.filter((e) => e.distance_m / 1000 <= radiusRef.current) : [];
    const pts = near.length >= 2 ? [...near, ...(showHopRef.current ? stopsRef.current : [])] : framePoints();
    // Keep the swoop's tilt and angle: fitBounds would otherwise turn the map back north.
    m.fitBounds(boundsOf(pts), { padding: framePadding(insetsRef.current), maxZoom: 14, bearing: m.getBearing(), duration: ms(900) });
    // events is read at the moment the filter changes, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, fitKey]);

  /* ------------------------------------------- fly to the picked venue -- */
  // Down into the street so the venue's house stands up in 3D. With the card
  // docked on the right, the house lands in the strip of map to its left;
  // otherwise it is nudged up so a bottom card does not cover it. Closing the
  // card puts the camera back where it was, rather than leaving the Hopper
  // stranded at street level with no idea where everything else is.
  const before = useRef<{ center: maplibregl.LngLat; zoom: number; pitch: number; bearing: number } | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    // The camera is about to fly the venue under the cursor: drop any hover card first.
    peek.current.hide();
    const e = eventsRef.current.find((x) => x.id === selectedId);
    if (!e) {
      if (before.current) m.easeTo({ ...before.current, duration: ms(800) });
      before.current = null;
      return;
    }
    // Hopping from one venue to the next keeps the view from before the first.
    before.current ??= { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    const { clientWidth: W, clientHeight: H } = m.getContainer();
    let offset: [number, number] = [0, -Math.round(H * 0.22)];
    let zoom = PICK_ZOOM;
    if (sideRef.current) {
      const strip = W - sidePanelWidth(W) - SIDE_PANEL.gap * 3;
      const x = SIDE_PANEL.gap + strip / 2;
      const top = insetsRef.current.top;
      // Low in the strip, so the house and the card floating over it both have room above.
      const y = top + (H - top) * 0.64;
      offset = [Math.round(x - W / 2), Math.round(y - H / 2)];
      zoom = PICK_ZOOM_SIDE;
    }
    m.easeTo({ center: [e.lng, e.lat], zoom: Math.max(m.getZoom(), zoom), pitch: 55, offset, duration: ms(900) });
    // Only when the pick changes, not when the event list refreshes.
  }, [epoch, selectedId]);

  /* -------------------------------------------------------- the bus ----- */
  useEffect(() => {
    const m = map.current;
    const b = busRef.current;
    if (!m || !busFocus || !b) return;
    before.current = null; // the Hopper chose a new view; closing a card should not undo it
    m.flyTo({ center: [b.lng, b.lat], zoom: Math.max(m.getZoom(), 13), pitch: 50, duration: ms(1600) });
    // Fly on the button press only, not every time the bus moves.
  }, [busFocus]);

  /* --------------------------------------------- the Hop: numbered stops ---- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    stopMks.current.forEach((mk) => mk.remove());
    stopMks.current = [];
    if (!showHop) {
      declutter.current();
      return;
    }
    hopStops.forEach((s) => {
      const el = make("button", "hz-stop", String(s.idx));
      el.type = "button";
      el.setAttribute("aria-label", `Hop stop ${s.idx}: ${s.name}`);
      el.style.zIndex = "3";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cbs.current.onHopSelect();
      });
      stopMks.current.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([s.lng, s.lat]).addTo(m));
    });
    declutter.current();
  }, [epoch, hopStops, showHop]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const b = busRef.current;
    if (!b) {
      busMk.current?.remove();
      busMk.current = null;
      declutter.current();
      return;
    }
    if (!busMk.current) {
      const el = make("button", "hz-bus");
      el.type = "button";
      const body = make("span", "hz-bus-body");
      body.innerHTML = BUS_ART; // a constant string, no stored text
      el.append(body, make("span", "hz-bus-label"));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        (cbs.current.onBus ?? cbs.current.onHopSelect)();
      });
      el.style.zIndex = "5";
      busMk.current = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 4] }).setLngLat([b.lng, b.lat]).addTo(m);
    }
    const el = busMk.current.getElement();
    (el.querySelector(".hz-bus-label") as HTMLElement).textContent = b.label;
    el.setAttribute(
      "aria-label",
      b.parked ? `The Hop bus, parked at stop 1. ${b.label.toLowerCase()}. Opens the Hop.` : `The Hop bus: ${b.label.toLowerCase()}`
    );
    el.classList.toggle("hz-bus-moving", b.moving);
    // Not the Hop's day: no purple until the Hop.
    el.classList.toggle("hz-bus-parked", b.parked);
    busMk.current.setLngLat([b.lng, b.lat]);
    declutter.current();
    // busKey stands in for the bus object, which is rebuilt every render.
  }, [epoch, busKey]);

  /* ------------------------------------------------------------ boxes ---- */
  // Drops stand on the map as sealed boxes: open ones glow and bob, sealed ones say when they open.
  const boxKey = boxes.map((b) => `${b.id}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}:${b.open}:${b.hunt}:${b.label}`).join("|");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const keep = new Set(boxes.map((b) => b.id));
    boxMks.current.forEach((mk, id) => {
      if (!keep.has(id)) {
        mk.remove();
        boxMks.current.delete(id);
      }
    });
    boxes.forEach((b, i) => {
      let mk = boxMks.current.get(b.id);
      if (!mk) {
        const el = make("button", "hz-boxpin");
        el.type = "button";
        const glow = make("span", "hz-boxpin-glow");
        const box = make("span", "hz-boxpin-box");
        el.append(glow, box, make("span", "hz-boxpin-label"));
        el.style.setProperty("--d", `${i * 90}ms`);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          hidePeek();
          cbs.current.onBox?.(b.id);
        });
        el.style.zIndex = "5";
        mk = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([b.lng, b.lat]).addTo(m);
        boxMks.current.set(b.id, mk);
      }
      const el = mk.getElement();
      el.classList.toggle("hz-boxpin-open", b.open);
      el.classList.toggle("hz-boxpin-sealed", !b.open);
      el.classList.toggle("hz-boxpin-hunt", b.hunt);
      (el.querySelector(".hz-boxpin-label") as HTMLElement).textContent = b.label;
      el.setAttribute("aria-label", `${b.hunt ? "Hunt" : "Drop"}: ${b.label.toLowerCase()}. ${b.open ? "Open it nearby." : ""}`);
      mk.setLngLat([b.lng, b.lat]);
    });
    declutter.current();
    // boxKey stands in for boxes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, boxKey]);

  /* ---------------------------------------- the side card's left and right -- */
  // The nearest event to the left or right of one, as the map is drawn now (tilt and angle included).
  useEffect(() => {
    if (!navRef) return;
    navRef.current = (fromId, dir) => {
      const m = map.current;
      const evs = eventsRef.current;
      const from = evs.find((e) => e.id === fromId);
      if (!m || !from) return null;
      const p0 = m.project([from.lng, from.lat]);
      let best: string | null = null;
      let bestD = Infinity;
      for (const e of evs) {
        if (e.id === fromId) continue;
        const p = m.project([e.lng, e.lat]);
        const dx = (p.x - p0.x) * dir;
        const dy = p.y - p0.y;
        let d: number;
        if (Math.abs(p.x - p0.x) < 1 && Math.abs(dy) < 1) {
          // Two events at one venue: step through them in a fixed order.
          if (e.id > fromId !== (dir === 1)) continue;
          d = 0.5;
        } else {
          if (dx <= 2) continue;
          d = dx * dx + 2.5 * dy * dy;
        }
        if (d < bestD) {
          bestD = d;
          best = e.id;
        }
      }
      return best;
    };
    return () => {
      navRef.current = null;
    };
  }, [navRef]);

  /* ------------------------------------------------------------- me ---- */
  const lookKey = JSON.stringify(myLook ?? null);
  const fixKey = fix ? `${fix.lat.toFixed(5)},${fix.lng.toFixed(5)}` : "";
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    meMk.current?.remove();
    meMk.current = null;
    const f = fixRef.current;
    if (f) {
      const el = faceMarker(myLook, "me", BRAND.orange);
      el.style.zIndex = "3";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "You");
      meMk.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([f.lng, f.lat]).addTo(m);
    }
    declutter.current();
    // lookKey stands in for myLook, fixKey for fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, lookKey, fixKey]);

  /* ----------------------------------------------------- recenter on a new fix */
  const lastFix = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    // The first fix is the swoop's destination.
    if (lastFix.current === null) {
      lastFix.current = fixKey;
      return;
    }
    const f = fixRef.current;
    if (!f || fixKey === lastFix.current) return;
    lastFix.current = fixKey;
    if (selectedRef.current) return;
    m.easeTo({ center: [f.lng, f.lat], zoom: Math.max(m.getZoom(), 11.4), duration: ms(700) });
  }, [epoch, fixKey]);

  return <div ref={holder} className="absolute inset-0" aria-label="Lagos map" />;
}
