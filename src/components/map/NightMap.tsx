"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { MAP_PALETTE, addCityLayer, fallbackStyle, loadBrandStyle, CITY_LAYER } from "@/lib/mapStyle";
import { hopDayLabel, type BusFix } from "@/lib/busPosition";
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
import { dayLabel } from "@/lib/filters";
import { crowdAt } from "@/lib/crowd";
import { useTheme } from "@/lib/useTheme";
import type { Theme } from "@/lib/theme";
import type { EventRow, HopStop } from "@/lib/types";
import { mountVenueModels, updateVenueModels } from "./venueModels";

// Next's app bundlers cannot infer MapLibre's dynamically resolved module-worker
// URL. Serve the package worker as a same-origin static asset instead.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

export type NightMapProps = {
  events: EventRow[];
  /** Events with a live drop: they get a violet DROP pill and a violet dot. */
  collectibleEventIds?: string[];
  hopStops: HopStop[];
  /** `source` is "gps" or "area". Your own dot only draws for "gps". */
  fix: { lat: number; lng: number; area?: string | null; source?: "gps" | "area" } | null;
  radiusKm: number;
  /** The moment the heat map shows: now (live) or a slot later in the night (expected). */
  at: number;
  live: boolean;
  /** @deprecated Crew faces are no longer drawn (their positions were invented). Kept so callers compile. */
  crew?: unknown[];
  /** @deprecated Your own position is a plain dot now, not a face. Kept so callers compile. */
  myLook?: unknown;
  /** Where the Hop bus is (estimated from the schedule), drawn as its own marker. */
  bus: BusFix | null;
  /** Bumped by the bus button in the HUD: the camera pans, flat, to the bus. */
  busFocus?: number;
  /** @deprecated The map no longer swoops in. Kept so callers compile. */
  play?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHopSelect: () => void;
  /** Changes when the filters change: the camera frames whatever now matches. */
  fitKey: string;
  /** A tap on empty map: close whatever card is open. */
  onClear: () => void;
  /**
   * True when the selected day is the Hop's date: the route, numbered stops and
   * the moving bus show. False: the bus parks at stop 1 under a "NEXT HOP" banner.
   * Omitted: today's behaviour (always show the route).
   */
  hopActive?: boolean;
  /** The Hop's date, "YYYY-MM-DD", for the "NEXT HOP · SAT 18" banner. Falls back to bus.hopDate. */
  hopDate?: string | null;
  /** The parked bus and its banner are tappable. Defaults to onHopSelect. */
  onBus?: () => void;
  /**
   * How much of the map the page's own chrome covers, px from the top and bottom
   * edges. Banners never sit under it, the camera frames inside it, and the zoom
   * buttons and the map credit stay clear of it.
   */
  hudTop?: number;
  hudBottom?: number;
};

type Mode = "card" | "banner" | "mini";
type Box = [number, number, number, number];

type Sign = {
  mk: maplibregl.Marker;
  rank: number;
  /** Measured whenever the content changes: each mode's size in px. */
  size: Partial<Record<Mode, [number, number]>>;
  sig: string;
};

/** Room left between two banners, px. */
const GAP = 4;
/** What the page's chrome covers when it does not say: the night rail above, the scrubber below. */
const DEFAULT_HUD = { top: 132, bottom: 96 };
/** From here in, a banner becomes a card with the event image on top. */
const STREET_ZOOM = 14.6;
/** The banner stands this far above its dot, px. */
const MARKER_LIFT = 10;
const NO_IDS: string[] = [];

const SRC = {
  heat: "hoppaz-heat",
  pins: "hoppaz-pins",
  hop: "hoppaz-hop",
  radius: "hoppaz-radius",
} as const;

/** Lucide's bus, inline: markers are plain DOM, so there is no React icon here. */
const BUS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>' +
  '<path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>' +
  '<circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>';

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

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Camera durations drop to zero for anyone who asked their phone for less motion. */
const ms = (n: number) => (reducedMotion() ? 0 : n);

const MONTHS = /\s(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/;
/** "11PM" tonight, "SAT 18 · 10PM" on another day: dayLabel without the month, for a small banner. */
function whenShort(e: EventRow) {
  if (isEventLead(e)) return "CHECK DETAILS";
  const label = dayLabel(e.starts_at);
  if (label.startsWith("TODAY · ") || label.startsWith("TONIGHT · ")) return clockShort(e.starts_at);
  return label.replace(MONTHS, "");
}

const framePadding = (ins: { top: number; bottom: number }) => ({
  // Banners stand above their dots, so the top needs more room than the bottom.
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
function setupLayers(m: MLMap, theme: Theme) {
  const P = MAP_PALETTE[theme];

  /* ---- the 3D city, under the basemap labels: neutral concrete, simply there from z13 ---- */
  const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
  if (!m.getLayer(CITY_LAYER)) addCityLayer(m, firstSymbol, theme);
  // Phase 4: the Campus Twin venue models mount here (see venueModels.ts).
  mountVenueModels(m, theme);

  /* ---- heat: the first thing you see, gone by street zoom ---- */
  if (!m.getSource(SRC.heat)) m.addSource(SRC.heat, { type: "geojson", data: fc([]) });
  if (!m.getLayer("heat-blur")) {
    m.addLayer({
      id: "heat-blur",
      type: "heatmap",
      source: SRC.heat,
      maxzoom: 15,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "crowd"], 0, 0, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.9, 14, 2],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 22, 13, 48, 15, 80],
        // Fades out by about zoom 14.5, where the banners turn into cards.
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, P.heatOpacity, 13, P.heatOpacity * 0.75, 14.5, 0],
        // Transparent, to ember, to orange. No violet edge, no cream core.
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, P.heat[0],
          0.2, P.heat[1],
          0.55, P.heat[2],
          1, P.heat[3],
        ] as ExpressionSpecification,
      },
    });
  }

  /* ---- radius ring: a thin dim hairline, no fill ---- */
  if (!m.getSource(SRC.radius)) m.addSource(SRC.radius, { type: "geojson", data: fc([]) });
  if (!m.getLayer("radius-line")) {
    m.addLayer({
      id: "radius-line",
      type: "line",
      source: SRC.radius,
      paint: { "line-color": P.dim, "line-width": 1, "line-opacity": 0.6 },
    });
  }

  /* ---- the Hop route: a plain dashed line. Numbered stops and the bus are DOM markers ---- */
  if (!m.getSource(SRC.hop)) m.addSource(SRC.hop, { type: "geojson", data: fc([]) });
  if (!m.getLayer("hop-line")) {
    m.addLayer({
      id: "hop-line",
      type: "line",
      source: SRC.hop,
      paint: {
        "line-color": P.text,
        "line-width": 2,
        "line-opacity": 0.85,
        "line-dasharray": [2, 2],
      },
      layout: { "line-cap": "butt", "line-join": "round" },
    });
  }

  /* ---- event dots: tap targets and the far-out marker. Banners and cards are DOM ---- */
  if (!m.getSource(SRC.pins)) m.addSource(SRC.pins, { type: "geojson", data: fc([]) });
  if (!m.getLayer("pins")) {
    m.addLayer({
      id: "pins",
      type: "circle",
      source: SRC.pins,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          9, ["case", ["get", "inRange"], 3.5, 2.5],
          15, ["case", ["get", "inRange"], 6, 4],
        ] as ExpressionSpecification,
        // Neutral. Only a live drop gets colour, and that colour is violet.
        "circle-color": ["case", ["get", "drop"], P.violet, ["get", "inRange"], P.text, P.dim] as ExpressionSpecification,
        "circle-stroke-color": ["case", ["get", "selected"], "#FF4D00", P.ground] as ExpressionSpecification,
        "circle-stroke-width": ["case", ["get", "selected"], 2, 1.5] as ExpressionSpecification,
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
  bus,
  busFocus = 0,
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
}: NightMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  /** True while the style and our layers are in; false mid-swap. */
  const ready = useRef(false);
  /** Bumps each time our layers are (re)built, so data and markers repaint. 0 = nothing yet. */
  const [epoch, setEpoch] = useState(0);
  /** Bumps when web fonts land, so banners are measured in their real font. */
  const [fontsEpoch, setFontsEpoch] = useState(0);
  /** Bumps every minute so "TODAY" and "ENDED" on the banners do not go stale. */
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

  const cbs = useRef({ onSelect, onHopSelect, onClear, onBus });
  cbs.current = { onSelect, onHopSelect, onClear, onBus };
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
  /** What the camera frames: tonight's events, plus the Hop's stops on the Hop's night. */
  const framePoints = () => [...eventsRef.current, ...(showHopRef.current ? stopsRef.current : [])];
  const busRef = useRef(busShown);
  busRef.current = busShown;
  const busKey = busShown ? `${busShown.lat.toFixed(5)},${busShown.lng.toFixed(5)}|${busShown.label}|${busShown.moving}|${busShown.parked}` : "";

  const signs = useRef(new Map<string, Sign>());
  const stopMks = useRef<maplibregl.Marker[]>([]);
  const busMk = useRef<maplibregl.Marker | null>(null);
  const meMk = useRef<maplibregl.Marker | null>(null);
  const hover = useRef<maplibregl.Popup | null>(null);
  const declutter = useRef(() => {});
  const framed = useRef(false);
  /** True while the camera is where our own framing put it: no gesture, no picked event since. */
  const autoFramed = useRef(false);

  /* ------------------------------------------------------------ hover card -- */
  const showPeek = (id: string) => {
    const m = map.current;
    const e = eventsRef.current.find((x) => x.id === id);
    if (!m || !e || !window.matchMedia("(hover: hover)").matches) return;
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

  /* ------------------------------------------------- declutter the banners -- */
  // Every event stands on the map as a banner (name, price and time) over its
  // dot; from street zoom it is a card with the flyer on top. Where they would
  // overlap, the lower-ranked one shrinks to a price tag, then to just its dot.
  // Runs on every move.
  declutter.current = () => {
    const m = map.current;
    if (!m) return;
    const street = m.getZoom() >= STREET_ZOOM;
    const { top, bottom } = insetsRef.current;
    const { clientWidth: vw, clientHeight: vh } = m.getContainer();
    const taken: Box[] = [];
    const reserve = (lng: number, lat: number, left: number, up: number, right: number, down: number) => {
      const p = m.project([lng, lat]);
      taken.push([p.x - left, p.y - up, p.x + right, p.y + down]);
    };
    // The bus and its label, the numbered stops, and the zoom buttons stay clear.
    // (Your own dot is small and sits on top: it does not push banners around.)
    const h0 = holder.current?.getBoundingClientRect();
    const busEl = busMk.current?.getElement();
    if (busEl && h0) {
      // The bus sits up and to the left of its point, its label above it. Keep the label on screen.
      const p = m.project(busMk.current!.getLngLat());
      busEl.dataset.align = p.x > vw - 150 ? "right" : "left";
      const rects = [busEl.getBoundingClientRect(), busEl.querySelector(".hz-bus-label")?.getBoundingClientRect()];
      // A bus (or its label) tucked under the page's chrome or off the edge reads as broken: hide it until it clears.
      const fits = rects.every((r) => !r || !r.width || (r.top - h0.top >= top && r.bottom - h0.top <= vh - bottom && r.left - h0.left >= 0 && r.right - h0.left <= vw));
      busEl.style.visibility = fits ? "" : "hidden";
      if (fits) {
        for (const r of rects) {
          if (r && r.width) taken.push([r.left - h0.left, r.top - h0.top, r.right - h0.left, r.bottom - h0.top]);
        }
      }
    }
    stopMks.current.forEach((mk) => {
      const ll = mk.getLngLat();
      reserve(ll.lng, ll.lat, 14, 14, 14, 14);
    });
    const ctrl = holder.current?.querySelector(".maplibregl-ctrl-top-right .maplibregl-ctrl-group");
    if (ctrl && holder.current) {
      const c = ctrl.getBoundingClientRect();
      const h = holder.current.getBoundingClientRect();
      if (c.width) taken.push([c.left - h.left, c.top - h.top, c.right - h.left, c.bottom - h.top]);
    }
    // A banner cut off by the screen edge or tucked under the chrome reads as broken:
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
          const box: Box = [p.x - w / 2, p.y - MARKER_LIFT - h, p.x + w / 2, p.y - MARKER_LIFT];
          // The one you picked always shows, in the fullest form that clears the top chrome;
          // everything else has to fit and avoid it.
          const ok = picked ? box[1] >= top || name === "banner" : free(...box);
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

      // No swoop: the map is simply there, flat, framed on the events (or on you).
      const evs = eventsRef.current;
      const ins = insetsRef.current;
      const start = fixRef.current ?? LAGOS_CENTER;
      const created = new maplibregl.Map({
        container: holder.current,
        style,
        ...(evs.length
          ? { bounds: boundsOf(framePoints()), fitBoundsOptions: { padding: framePadding(ins), maxZoom: 14 } }
          : { center: [start.lng, start.lat] as [number, number], zoom: fixRef.current ? 12 : 10.6 }),
        pitch: 0,
        minZoom: 9,
        maxZoom: 17,
        maxBounds: LAGOS_BOUNDS, // Lagos only, for now
        maxPitch: 45,
        // The credit is added below, as plain text clear of the bottom chrome.
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      m = created;
      map.current = created;
      framed.current = evs.length > 0;
      autoFramed.current = framed.current;
      // Any gesture of the Hopper's own takes the camera out of our hands.
      for (const ev of ["dragstart", "zoomstart", "pitchstart"] as const) {
        created.on(ev, (e) => {
          if ("originalEvent" in e && e.originalEvent) autoFramed.current = false;
        });
      }
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
        setupLayers(created, themeRef.current);
        styleTheme.current = themeRef.current;
        ready.current = true;
        setEpoch((n) => n + 1);
      });

      created.on("load", () => {
        if (!m) return;
        setupLayers(m, styleTheme.current ?? themeRef.current);

        /* ---- interaction ---- */
        m.on("mouseenter", "pins", () => {
          m!.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "pins", () => {
          m!.getCanvas().style.cursor = "";
          peek.current.hide();
        });
        m.on("mousemove", "pins", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) peek.current.show(String(id));
        });
        // A dot is small: tapping near one counts. Tap on nothing closes the card.
        // The banners, stops and bus are markers and stop their own clicks.
        m.on("click", (e) => {
          if (!m!.getLayer("pins")) return;
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

        // Banners re-sort themselves so they never pile into one blob.
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
    return () => {
      ac.abort();
      ready.current = false;
      signMap.clear();
      stopMks.current = [];
      busMk.current = null;
      meMk.current = null;
      hover.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Web fonts land after first paint; banners measured before that are the wrong width.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsEpoch((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  /* ------------------------------------------------ day / night basemap ---- */
  // Day is positron on cream, night is dark-matter on Night Black. When the Lagos
  // clock flips the theme while the map is open, swap the basemap and rebuild.
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
    const drops = new Set(collectibleEventIds);
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

    (m.getSource(SRC.pins) as GeoJSONSource).setData(
      fc(
        events.map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lng, e.lat] },
          properties: { id: e.id, inRange: inRange(e), selected: e.id === selectedId, drop: drops.has(e.id) },
        }))
      )
    );

    // The route only draws on the Hop's night.
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

    // Phase 4: the venue models follow the same events and selection.
    updateVenueModels(m, { theme: themeRef.current, events, selectedId });
  }, [epoch, events, collectibleEventIds, hopStops, showHop, fix, radiusKm, selectedId, at, live]);

  /* --------------------------------------------------- event banners/cards -- */
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
        // button > board > (face: art + text) + mini price tag + stem
        const el = make("button", "hz-sign");
        el.type = "button";
        const board = make("span", "hz-board");
        const face = make("span", "hz-face");
        const art = make("span", "hz-art");
        const text = make("span", "hz-text");
        const meta = make("span", "hz-meta");
        meta.append(make("span", "hz-when"), make("span", "hz-drop", "DROP"));
        text.append(make("b", "hz-name"), meta);
        face.append(art, text);
        board.append(face, make("span", "hz-mini"), make("i", "hz-stem"));
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
      const line = lead ? when : `${price} · ${when}`;
      const flyer = e.flyer_url && /^https?:\/\//i.test(e.flyer_url) ? e.flyer_url : "";

      el.classList.toggle("hz-on", on);
      el.classList.toggle("hz-far", !inRange(e));
      el.classList.toggle("hz-has-drop", hasDrop);
      el.style.zIndex = on ? "4" : String(Math.max(1, 3 - Math.floor(rank / 10)));
      el.setAttribute("aria-label", `${name}, ${lead ? "event lead; verify details" : `${eventPrice(e)}, ${when}`}${hasDrop ? ", drop live" : ""}`);

      // Re-measure only when the content changed: it costs a layout per mode.
      const sig = `${name}|${line}|${hasDrop}|${flyer}|${e.vibe}|${fontsEpoch}`;
      if (sig !== sg.sig) {
        sg.sig = sig;
        (el.querySelector(".hz-name") as HTMLElement).textContent = name;
        (el.querySelector(".hz-when") as HTMLElement).textContent = line;
        (el.querySelector(".hz-mini") as HTMLElement).textContent = lead ? "LEAD" : price;
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
  }, [epoch, events, collectibleEventIds, fix, radiusKm, selectedId, fontsEpoch, minute]);

  /* -------------------------------------------- frame the filtered events ---- */
  const lastFit = useRef(fitKey);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || fitKey === lastFit.current) return;
    lastFit.current = fitKey;
    if (!events.length) return;
    framed.current = true;
    autoFramed.current = true;
    m.fitBounds(boundsOf(framePoints()), { padding: framePadding(insetsRef.current), maxZoom: 14, pitch: 0, duration: ms(700) });
    // events is read at the moment the filter changes, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, fitKey]);

  // Events that arrive after the map opened (a slow connection) get framed once, instantly.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || framed.current || !events.length) return;
    framed.current = true;
    autoFramed.current = true;
    m.fitBounds(boundsOf(framePoints()), { padding: framePadding(insetsRef.current), maxZoom: 14, duration: 0 });
  }, [epoch, events]);

  // The page's chrome is measured after the map opens and can grow (a notice, a type chip row).
  // If nobody has touched the camera yet, frame again inside the real free space.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || !autoFramed.current || selectedRef.current) return;
    const pts = framePoints();
    if (!pts.length) return;
    m.fitBounds(boundsOf(pts), { padding: framePadding({ top: hudTop, bottom: hudBottom }), maxZoom: 14, duration: 0 });
  }, [hudTop, hudBottom]);

  /* ------------------------------------------- ease to the picked event ---- */
  // Browsing stays flat. Picking an event eases to it, above the card, at zoom 15
  // and a gentle tilt so the venue stands up; closing the card eases back, flat.
  const before = useRef<{ center: maplibregl.LngLat; zoom: number; auto: boolean } | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const e = eventsRef.current.find((x) => x.id === selectedId);
    if (!e) {
      if (before.current) {
        const { center, zoom, auto } = before.current;
        m.easeTo({ center, zoom, pitch: 0, bearing: 0, duration: ms(600) });
        autoFramed.current = auto;
      } else if (m.getPitch() > 0) {
        m.easeTo({ pitch: 0, duration: ms(400) });
      }
      before.current = null;
      return;
    }
    // Hopping from one event to the next keeps the view from before the first.
    before.current ??= { center: m.getCenter(), zoom: m.getZoom(), auto: autoFramed.current };
    autoFramed.current = false;
    // Land the venue's dot so its card stands clear of the top chrome and the sheet comes up below it.
    const H = m.getContainer().clientHeight;
    const cardH = signs.current.get(e.id)?.size.card?.[1] ?? 60;
    const dotY = Math.min(Math.max(insetsRef.current.top + cardH + MARKER_LIFT + 6, H * 0.26), H * 0.42);
    m.easeTo({
      center: [e.lng, e.lat],
      zoom: Math.max(m.getZoom(), 15),
      pitch: 40,
      offset: [0, Math.round(dotY - H / 2)],
      duration: ms(600),
    });
    // Only when the pick changes, not when the event list refreshes.
  }, [epoch, selectedId]);

  /* ----------------------------------------------- the bus button: pan flat -- */
  useEffect(() => {
    const m = map.current;
    const b = busRef.current;
    if (!m || !busFocus || !b) return;
    before.current = null; // the Hopper chose a new view; closing a card should not undo it
    autoFramed.current = false;
    m.easeTo({ center: [b.lng, b.lat], zoom: Math.max(m.getZoom(), 13), pitch: 0, duration: ms(600) });
    // Pan on the button press only, not every time the bus moves.
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

  /* -------------------------------------------------------- the bus ----- */
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
      body.innerHTML = BUS_ICON; // a constant string, no stored text
      el.append(body, make("span", "hz-bus-label"));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        (cbs.current.onBus ?? cbs.current.onHopSelect)();
      });
      el.style.zIndex = "5";
      // Up and to the left of its point, so the event dot at a stop stays visible and tappable.
      busMk.current = new maplibregl.Marker({ element: el, anchor: "bottom-right", offset: [-10, -10] }).setLngLat([b.lng, b.lat]).addTo(m);
    }
    const el = busMk.current.getElement();
    (el.querySelector(".hz-bus-label") as HTMLElement).textContent = b.label;
    el.setAttribute(
      "aria-label",
      b.parked ? `The Hop bus, parked at stop 1. ${b.label.toLowerCase()}. Opens the Hop.` : `The Hop bus: ${b.label.toLowerCase()}`
    );
    el.classList.toggle("hz-bus-moving", b.moving);
    el.classList.toggle("hz-bus-parked", b.parked);
    busMk.current.setLngLat([b.lng, b.lat]);
    declutter.current();
    // busKey stands in for the bus object, which is rebuilt every render.
  }, [epoch, busKey]);

  /* ------------------------------------------------------------- me ---- */
  // A plain dot, only when the position really is GPS. An area you picked is not a fix.
  const gpsKey = fix?.source === "gps" ? `${fix.lat},${fix.lng}` : "";
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    if (!gpsKey) {
      meMk.current?.remove();
      meMk.current = null;
      declutter.current();
      return;
    }
    const [lat, lng] = gpsKey.split(",").map(Number);
    if (!meMk.current) {
      const el = make("div", "hz-me");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "You are here");
      el.style.zIndex = "6";
      meMk.current = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(m);
    } else {
      meMk.current.setLngLat([lng, lat]);
    }
    declutter.current();
  }, [epoch, gpsKey]);

  /* ----------------------------------------------------- recenter on a new fix */
  const fixKey = fix ? `${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}` : "";
  const lastFix = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    // First time the map is up, the framing it opened with stands.
    if (lastFix.current === null) {
      lastFix.current = fixKey;
      return;
    }
    const f = fixRef.current;
    if (!f || fixKey === lastFix.current) return;
    lastFix.current = fixKey;
    if (selectedRef.current) return;
    m.easeTo({ center: [f.lng, f.lat], zoom: Math.max(m.getZoom(), 11.4), pitch: 0, duration: ms(600) });
  }, [epoch, fixKey]);

  return <div ref={holder} className="absolute inset-0" aria-label="Lagos map" />;
}
