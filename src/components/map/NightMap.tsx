"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type GeoJSONSource } from "maplibre-gl";
import { BRAND } from "@/lib/brand";
import { FALLBACK_STYLE, addCityLayer, loadBrandStyle, riseCity } from "@/lib/mapStyle";
import { normalizeLook } from "@/lib/avatar";
import { avatarSvg } from "@/lib/avatarSvg";
import type { BusFix } from "@/lib/busPosition";
import { LAGOS_BOUNDS, LAGOS_CENTER, areaByName, clockShort, dayLagos, naira, nairaShort, travelEstimate } from "@/lib/geo";
import { crowdAt, crowdLevel, TONE_HEX } from "@/lib/crowd";
import { lotFeatures } from "@/lib/eventLots";
import type { EventRow, HopStop } from "@/lib/types";

type Props = {
  events: EventRow[];
  hopStops: HopStop[];
  fix: { lat: number; lng: number; area?: string | null } | null;
  radiusKm: number;
  /** The moment the heat map shows: now (live) or a slot later in the night (expected). */
  at: number;
  live: boolean;
  crew: { id: string; lat: number; lng: number; initial: string; avatar?: unknown }[];
  /** The Hopper's own look, drawn as their pin. */
  myLook: unknown;
  /** Where the Hop bus is (estimated from the schedule), drawn as its own marker. */
  bus: BusFix | null;
  /** Bumped by the bus button in the HUD: fly to the bus. */
  busFocus: number;
  /** Flips true once the intro is out of the way: the camera then swoops in. */
  play: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHopSelect: () => void;
  /** A tap on empty map: close whatever card is open. */
  onClear: () => void;
};

type Sign = {
  mk: maplibregl.Marker;
  rank: number;
  /** Measured once: full board and price-tag sizes, in px. */
  full: [number, number];
  tag: [number, number];
};

/** Room left between two billboards, px. */
const SIGN_GAP = 4;
/** From here in, venues are 3D lots: dots fade and signs float over the roofs. */
const STREET_ZOOM = 14.6;

const SRC = {
  heat: "hoppaz-heat",
  pins: "hoppaz-pins",
  hop: "hoppaz-hop",
  lots: "hoppaz-lots",
} as const;

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

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

export default function NightMap({
  events,
  hopStops,
  fix,
  radiusKm,
  at,
  live,
  crew,
  myLook,
  bus,
  busFocus,
  play,
  selectedId,
  onSelect,
  onHopSelect,
  onClear,
}: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  // Map creation is async; this re-runs the effects below once it exists.
  const [loaded, setLoaded] = useState(false);
  const cbs = useRef({ onSelect, onHopSelect, onClear });
  cbs.current = { onSelect, onHopSelect, onClear };

  /* ---------------------------------------------------------------- init -- */
  useEffect(() => {
    if (!holder.current || map.current) return;
    const ac = new AbortController();
    let m: MLMap | null = null;

    (async () => {
      let style;
      try {
        style = await loadBrandStyle(ac.signal);
      } catch {
        style = FALLBACK_STYLE; // tile host unreachable: still open the app
      }
      if (ac.signal.aborted || !holder.current) return;

      m = new maplibregl.Map({
        container: holder.current,
        style,
        center: [LAGOS_CENTER.lng, LAGOS_CENTER.lat],
        zoom: 10.6,
        minZoom: 9,
        maxZoom: 17,
        maxBounds: LAGOS_BOUNDS, // Lagos only, for now
        maxPitch: 60,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.current = m;
      m.touchZoomRotate.disableRotation();
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

      m.on("load", () => {
        if (!m) return;

        /**
         * Label layers need a glyph source. If the style has none, or its glyph
         * host is unreachable, addLayer throws, and an uncaught throw in here
         * would abandon every source after it and leave a dead map. Labels are
         * the one thing we can lose and still have a usable night map.
         */
        const addLabelLayer = (spec: Parameters<MLMap["addLayer"]>[0]) => {
          try {
            m!.addLayer(spec);
          } catch (err) {
            console.warn("[hoppaz] label layer skipped (no glyphs):", (err as Error).message);
          }
        };

        /* ---- the illustrated city, under the basemap labels ---- */
        const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
        if (addCityLayer(m, firstSymbol)) {
          // Buildings only exist from z13; grow them the first time they show.
          const grow = () => {
            if (m!.getZoom() < 13.4) return;
            m!.off("moveend", grow);
            riseCity(m!);
          };
          m.on("moveend", grow);
        }

        /* ---- venues as Sims lots: walls, stepped roof, a floating diamond ---- */
        m.addSource(SRC.lots, { type: "geojson", data: fc([]) });
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

        /* ---- heat: the first thing you see, before any individual pin ---- */
        m.addSource(SRC.heat, { type: "geojson", data: fc([]) });
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
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(14,11,10,0)",
              0.18, "rgba(91,46,255,0.32)",   // violet, sparse, the cold edge
              0.42, "rgba(184,54,0,0.55)",    // ember
              0.7, "rgba(255,77,0,0.78)",     // Hoppaz Orange
              1, "rgba(245,235,221,0.92)",    // cream core: the night is here
            ],
          },
        });

        /* ---- radius ring ---- */
        m.addSource("hoppaz-radius", { type: "geojson", data: fc([]) });
        m.addLayer({
          id: "radius-fill",
          type: "fill",
          source: "hoppaz-radius",
          paint: { "fill-color": BRAND.orange, "fill-opacity": 0.04 },
        });
        m.addLayer({
          id: "radius-line",
          type: "line",
          source: "hoppaz-radius",
          paint: {
            "line-color": BRAND.orange,
            "line-width": 1.5,
            "line-opacity": 0.5,
            "line-dasharray": [3, 4],
          },
        });

        /* ---- the Hop route: violet, four stops, finale last ---- */
        m.addSource(SRC.hop, { type: "geojson", data: fc([]) });
        m.addLayer({
          id: "hop-line",
          type: "line",
          source: SRC.hop,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": BRAND.violet, "line-width": 3, "line-opacity": 0.85 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        m.addLayer({
          id: "hop-stops",
          type: "circle",
          source: SRC.hop,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 11,
            "circle-color": BRAND.violet,
            "circle-stroke-color": BRAND.ink,
            "circle-stroke-width": 2,
          },
        });
        addLabelLayer({
          id: "hop-stops-label",
          type: "symbol",
          source: SRC.hop,
          filter: ["==", ["geometry-type"], "Point"],
          layout: {
            "text-field": ["get", "idx"],
            "text-size": 11,
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
          },
          paint: { "text-color": BRAND.cream },
        });

        /* ---- event pins ---- */
        m.addSource(SRC.pins, { type: "geojson", data: fc([]) });
        m.addLayer({
          id: "pins-halo",
          type: "circle",
          source: SRC.pins,
          filter: [">=", ["get", "heat"], 55],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "heat"], 55, 18, 100, 30],
            "circle-color": BRAND.orange,
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM - 0.6, 0.14, STREET_ZOOM, 0],
          },
        });
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
            ],
            "circle-color": [
              "case",
              ["!", ["get", "inRange"]], "#2C2017",
              [">=", ["get", "heat"], 55], BRAND.orange,
              "#6E4433",
            ],
            "circle-stroke-color": ["case", ["get", "selected"], BRAND.cream, BRAND.ink],
            "circle-stroke-width": 2,
            // The lot takes over as the venue marker up close.
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM - 0.6, 1, STREET_ZOOM, 0],
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM - 0.6, 1, STREET_ZOOM, 0],
          },
        });
        // Event names, crew and "me" are HTML markers (see below), so they
        // pop like the intro's signs and do not depend on the glyph host.

        /* ---- interaction ---- */
        const hit = (layer: string, fn: (f: maplibregl.MapGeoJSONFeature) => void) => {
          m!.on("click", layer, (e) => {
            const f = e.features?.[0];
            if (f) fn(f);
          });
          m!.on("mouseenter", layer, () => {
            m!.getCanvas().style.cursor = "pointer";
          });
          m!.on("mouseleave", layer, () => {
            m!.getCanvas().style.cursor = "";
          });
        };
        hit("pins", (f) => cbs.current.onSelect(String(f.properties?.id)));
        m.on("mousemove", "pins", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) peek.current.show(String(id));
        });
        m.on("mouseleave", "pins", () => peek.current.hide());
        hit("hop-stops", () => cbs.current.onHopSelect());
        hit("lots", (f) => cbs.current.onSelect(String(f.properties?.id)));
        // Tap on nothing: close the card. Markers stop their own clicks.
        m.on("click", (e) => {
          const hits = m!.queryRenderedFeatures(e.point, { layers: ["pins", "hop-stops", "lots"] });
          if (!hits.length) cbs.current.onClear();
        });

        ready.current = true;
        m.resize();
        // Nudge the data layers now that the style is up.
        m.fire("hoppaz:ready");
        setLoaded(true);

        // Billboards re-sort themselves so they never pile into one blob.
        let queued = false;
        m.on("move", () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            declutter.current();
          });
        });
      });
    })();

    return () => {
      ac.abort();
      ready.current = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /* --------------------------------------------------------------- data -- */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const paint = () => {
      if (!m.getSource(SRC.pins)) return;

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
            properties: {
              id: e.id,
              title: e.title.toUpperCase(),
              heat: e.heat,
              inRange: !fix || e.distance_m / 1000 <= radiusKm,
              selected: e.id === selectedId,
            },
          }))
        )
      );

      (m.getSource(SRC.hop) as GeoJSONSource).setData(
        fc([
          ...(hopStops.length > 1
            ? [
                {
                  type: "Feature" as const,
                  geometry: {
                    type: "LineString" as const,
                    coordinates: hopStops.map((s) => [s.lng, s.lat]),
                  },
                  properties: {},
                },
              ]
            : []),
          ...hopStops.map((s) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
            properties: { idx: String(s.idx), name: s.name },
          })),
        ])
      );

      (m.getSource("hoppaz-radius") as GeoJSONSource).setData(
        fc(
          fix
            ? [
                {
                  type: "Feature",
                  geometry: {
                    type: "Polygon",
                    coordinates: [circlePolygon(fix.lat, fix.lng, radiusKm)],
                  },
                  properties: {},
                },
              ]
            : []
        )
      );
    };

    if (ready.current) paint();
    else m.once("hoppaz:ready", paint);
  }, [loaded, events, hopStops, fix, radiusKm, selectedId, at, live]);

  /* -------------------------------------------------- event billboards -- */
  // Every event stands on the map as a rooftop sign with its price and start
  // time, popping up the way the intro's signs do. Out-of-range ones are dimmed,
  // not hidden. Where signs would overlap, the lower-ranked one shrinks to a
  // price tag, then to just its dot; declutter() re-runs as the map moves.
  const signs = useRef(new Map<string, Sign>());
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const declutter = useRef(() => {});
  declutter.current = () => {
    const m = map.current;
    if (!m) return;
    const taken: Array<[number, number, number, number]> = [];
    // Up close the venue's lot stands under the sign, so the sign floats above its roof.
    const street = m.getZoom() >= STREET_ZOOM;
    holder.current?.classList.toggle("hz-street", street);
    // The lot (with its diamond) is ~95 m tall; lift the sign just past that on screen.
    const mpp = (156543.03 * Math.cos((m.getCenter().lat * Math.PI) / 180)) / 2 ** m.getZoom();
    const lift = street ? Math.round(18 + (95 / mpp) * Math.sin((m.getPitch() * Math.PI) / 180)) : 10;
    holder.current?.style.setProperty("--hz-lift", `${lift - 10}px`);
    // Your face sits above your point and the bus hangs below its own: keep both clear.
    if (fixRef.current) {
      const p = m.project([fixRef.current.lng, fixRef.current.lat]);
      taken.push([p.x - 20, p.y - 46, p.x + 20, p.y]);
    }
    if (busRef.current) {
      const p = m.project([busRef.current.lng, busRef.current.lat]);
      taken.push([p.x - 40, p.y, p.x + 40, p.y + 56]);
    }
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      !taken.some(([a0, b0, a1, b1]) => x0 < a1 + SIGN_GAP && x1 + SIGN_GAP > a0 && y0 < b1 + SIGN_GAP && y1 + SIGN_GAP > b0);
    [...signs.current.values()]
      .sort((a, b) => a.rank - b.rank)
      .forEach((sg) => {
        const el = sg.mk.getElement();
        const p = m.project(sg.mk.getLngLat());
        let mode = "off";
        for (const [name, [w, h]] of [["full", sg.full], ["tag", sg.tag]] as const) {
          const box: [number, number, number, number] = [p.x - w / 2, p.y - lift - h, p.x + w / 2, p.y - lift];
          if (free(...box)) {
            taken.push(box);
            mode = name;
            break;
          }
        }
        if (el.dataset.mode !== mode) el.dataset.mode = mode;
      });
  };

  const hover = useRef<maplibregl.Popup | null>(null);
  const showPeek = (id: string) => {
    const m = map.current;
    const e = eventsRef.current.find((x) => x.id === id);
    if (!m || !e || !window.matchMedia("(hover: hover)").matches) return;
    const box = document.createElement("div");
    const line = (cls: string, text: string) => {
      const el = document.createElement("p");
      el.className = cls;
      el.textContent = text; // textContent throughout: titles and venues come from Hoppers
      box.append(el);
    };
    const km = e.distance_m / 1000;
    line("font-display text-sm font-black leading-tight text-cream", e.title);
    line("mt-0.5 font-mono text-[10px] text-dim", `${e.venue_name}${e.area ? ` · ${e.area}` : ""}`);
    line(
      "mt-1.5 font-mono text-[11px] font-bold text-orange",
      `${naira(e.price_naira)} · ${dayLagos(e.starts_at)} ${clockShort(e.starts_at)} · ${e.vibe.toUpperCase()}`
    );
    if (fixRef.current) {
      const f = fixRef.current;
      const trip = travelEstimate({ ...f, side: areaByName(f.area ?? null)?.side }, { lat: e.lat, lng: e.lng, side: areaByName(e.area)?.side });
      line(
        "mt-0.5 font-mono text-[10px] text-dim",
        `~${trip.minutes} min · ${km.toFixed(1)} km${trip.crossesBridge ? " · over the bridge" : ""}${km > radiusRef.current ? " · outside your radius" : ""}`
      );
    }
    hover.current?.remove();
    hover.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, anchor: "top", className: "hz-peek", maxWidth: "240px" })
      .setLngLat([e.lng, e.lat])
      .setDOMContent(box)
      .addTo(m);
  };
  const hidePeek = () => {
    hover.current?.remove();
    hover.current = null;
  };
  const busRef = useRef(bus);
  busRef.current = bus;
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const radiusRef = useRef(radiusKm);
  radiusRef.current = radiusKm;

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const place = () => {
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
          const el = document.createElement("button");
          el.className = "hz-sign flex flex-col items-center";
          el.setAttribute("aria-label", `${e.title}, ${naira(e.price_naira)}, ${clockShort(e.starts_at)}`);
          const board = document.createElement("span");
          board.className = "hz-sign-board flex flex-col items-center";
          board.style.setProperty("--d", `${Math.min(rank, 20) * 0.06}s`);

          const full = document.createElement("span");
          full.className = "hz-full block whitespace-nowrap rounded-sm px-2 py-1 text-center leading-none shadow-chunk-sm";
          const title = document.createElement("b");
          title.className = "block font-display text-[10px] font-black";
          title.textContent = e.title.toUpperCase(); // textContent: titles come from Hoppers
          // Second line: crowd diamond, price, start, and how long to get there.
          const meta = document.createElement("span");
          meta.className = "mt-0.5 flex items-center justify-center gap-1 font-mono text-[9px] font-bold";
          const gem = document.createElement("i");
          gem.className = "hz-gem inline-block h-[7px] w-[7px] flex-none rotate-45";
          const metaText = document.createElement("span");
          metaText.className = "hz-meta";
          meta.append(gem, metaText);
          full.append(title, meta);

          const tag = document.createElement("span");
          tag.className = "hz-tag block whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none shadow-chunk-sm";
          tag.textContent = nairaShort(e.price_naira);

          const posts = document.createElement("span");
          posts.className = "flex w-full justify-around px-2";
          posts.innerHTML = '<i class="block h-2 w-[2px] bg-cream"></i><i class="block h-2 w-[2px] bg-cream"></i>';
          board.append(full, tag, posts);
          el.append(board);
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            hidePeek();
            cbs.current.onSelect(e.id);
          });
          el.addEventListener("mouseenter", () => showPeek(e.id));
          el.addEventListener("mouseleave", hidePeek);

          const mk = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -10] })
            .setLngLat([e.lng, e.lat])
            .addTo(m);
          sg = { mk, rank, full: [0, 0], tag: [0, 0] };
          signs.current.set(e.id, sg);
        }
        sg.rank = rank;
        const el = sg.mk.getElement();

        const tone = crowdLevel(e, at, crowdAt(e, at, live)).tone;
        const trip = fix
          ? travelEstimate({ ...fix, side: areaByName(fix.area ?? null)?.side }, { lat: e.lat, lng: e.lng, side: areaByName(e.area)?.side })
          : null;
        (el.querySelector(".hz-gem") as HTMLElement).style.background = TONE_HEX[tone];
        (el.querySelector(".hz-meta") as HTMLElement).textContent =
          `${nairaShort(e.price_naira)} · ${clockShort(e.starts_at)}${trip ? ` · ${trip.minutes}MIN` : ""}`;
        // Re-measure: the text above changes width. The pop animation scales, so use layout sizes.
        const was = el.dataset.mode;
        el.dataset.mode = "full";
        sg.full = [el.offsetWidth, el.offsetHeight];
        el.dataset.mode = "tag";
        sg.tag = [el.offsetWidth, el.offsetHeight];
        el.dataset.mode = was;
        const on = e.id === selectedId;
        el.classList.toggle("hz-on", on);
        el.classList.toggle("hz-far", !inRange(e));
        el.style.zIndex = on ? "4" : String(Math.max(1, 3 - Math.floor(rank / 10)));
      });
      declutter.current();
    };
    if (ready.current) place();
    else m.once("hoppaz:ready", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showPeek/hidePeek read refs
  }, [loaded, events, fix, radiusKm, selectedId, at, live]);

  /* ------------------------------------------- fly to the picked venue -- */
  // Down into the street so the venue's lot stands up in 3D, nudged up so the
  // card at the bottom does not cover it.
  useEffect(() => {
    const m = map.current;
    const e = events.find((x) => x.id === selectedId);
    if (!m || !e) return;
    m.easeTo({
      center: [e.lng, e.lat],
      zoom: Math.max(m.getZoom(), 15.6),
      pitch: 55,
      offset: [0, -Math.round(m.getContainer().clientHeight * 0.22)],
      duration: 900,
    });
    // Only when the pick changes, not when the event list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedId]);

  // The init effect binds once; this ref lets it reach the current handlers.
  const peek = useRef({ show: showPeek, hide: hidePeek });
  peek.current = { show: showPeek, hide: hidePeek };

  /* -------------------------------------------------------- the bus ----- */
  const busMk = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const place = () => {
      if (!bus) {
        busMk.current?.remove();
        busMk.current = null;
        return;
      }
      if (!busMk.current) {
        const el = document.createElement("button");
        el.className = "hz-bus flex flex-col items-center";
        el.innerHTML =
          '<span class="hz-bus-body grid h-8 w-11 place-items-center rounded-md border-2 border-violet bg-orange shadow-chunk-sm">' +
          '<svg viewBox="0 0 32 20" width="28" height="18" aria-hidden="true"><rect x="1" y="1" width="30" height="14" rx="3" fill="#F5EBDD"/><rect x="4" y="4" width="6" height="5" rx="1" fill="#FF4D00"/><rect x="12" y="4" width="6" height="5" rx="1" fill="#FF4D00"/><rect x="20" y="4" width="8" height="7" rx="1" fill="#0E0B0A"/><circle cx="8" cy="16" r="3" fill="#0E0B0A"/><circle cx="24" cy="16" r="3" fill="#0E0B0A"/></svg>' +
          "</span>" +
          '<span class="hz-bus-label mt-1 whitespace-nowrap rounded-sm bg-violet px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-cream"></span>';
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          cbs.current.onHopSelect();
        });
        el.style.zIndex = "5";
        busMk.current = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 4] }).setLngLat([bus.lng, bus.lat]).addTo(m);
      }
      const el = busMk.current.getElement();
      (el.querySelector(".hz-bus-label") as HTMLElement).textContent = bus.label;
      el.setAttribute("aria-label", `The Hop bus: ${bus.label.toLowerCase()}`);
      el.classList.toggle("hz-bus-moving", bus.moving);
      busMk.current.setLngLat([bus.lng, bus.lat]);
      declutter.current();
    };
    if (ready.current) place();
    else m.once("hoppaz:ready", place);
  }, [loaded, bus]);

  useEffect(() => {
    const m = map.current;
    if (!m || !busFocus || !bus) return;
    m.flyTo({ center: [bus.lng, bus.lat], zoom: Math.max(m.getZoom(), 13), pitch: 50, duration: 1600 });
    // Fly on the button press only, not every time the bus moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busFocus]);

  /* ------------------------------------------------- me and the crew ---- */
  const faces = useRef(new Map<string, maplibregl.Marker>());
  const lookKey = JSON.stringify(myLook ?? null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const place = () => {
      faces.current.forEach((mk) => mk.remove());
      faces.current.clear();
      crew.forEach((c) => {
        const el = c.avatar
          ? faceMarker(c.avatar, `crew-${c.id}`, BRAND.cream)
          : Object.assign(document.createElement("div"), {
              className:
                "grid h-6 w-6 place-items-center rounded-full border-2 border-ink bg-cream font-display text-[10px] font-black text-ink",
              textContent: c.initial,
            });
        faces.current.set(c.id, new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([c.lng, c.lat]).addTo(m));
      });
      if (fix) {
        const me = faceMarker(myLook, "me", BRAND.orange);
        me.style.zIndex = "3";
        faces.current.set("me", new maplibregl.Marker({ element: me, anchor: "bottom" }).setLngLat([fix.lng, fix.lat]).addTo(m));
      }
    };
    if (ready.current) place();
    else m.once("hoppaz:ready", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lookKey stands in for myLook
  }, [loaded, crew, fix, lookKey]);

  /* ------------------------------------------------------- the swoop ---- */
  // After the titles: start high and flat over Lagos, then sweep down into a
  // pitched, illustrated city. Once per mount.
  const swooped = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !play || swooped.current) return;
    const go = () => {
      if (swooped.current) return;
      swooped.current = true;
      const to = fix ?? LAGOS_CENTER;
      m.jumpTo({ center: [LAGOS_CENTER.lng - 0.08, LAGOS_CENTER.lat + 0.03], zoom: 9.6, pitch: 0, bearing: 0 });
      m.flyTo({ center: [to.lng, to.lat], zoom: fix ? 12.2 : 11.2, pitch: 50, bearing: -14, duration: 3400, curve: 1.3 });
    };
    if (ready.current) go();
    else m.once("hoppaz:ready", go);
    // Only the first play matters; fix is read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, play]);

  /* ------------------------------------------------------- recenter on me */
  const lastFix = useRef<string>("");
  useEffect(() => {
    const m = map.current;
    if (!m || !fix) return;
    const key = `${fix.lat.toFixed(4)},${fix.lng.toFixed(4)}`;
    if (key === lastFix.current) return;
    lastFix.current = key;
    m.easeTo({ center: [fix.lng, fix.lat], zoom: Math.max(m.getZoom(), 11.4), duration: 700 });
  }, [fix]);

  return <div ref={holder} className="absolute inset-0" aria-label="Lagos night map" />;
}
