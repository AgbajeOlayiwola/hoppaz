import type { ExpressionSpecification, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { BRAND } from "./brand";

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE ||
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

type AnyLayer = StyleSpecification["layers"][number] & {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

/**
 * CARTO's dark-matter is the right starting point (free, no key, vector) but
 * it is neutral grey. This repaints it into the Hoppaz palette so the basemap
 * reads as Night Black with orange arteries instead of Google-with-a-filter.
 * Matching is by layer id, which is how these styles are conventionally named.
 */
function repaint(style: StyleSpecification): StyleSpecification {
  const layers = (style.layers as AnyLayer[]).map((layer) => {
    const id = layer.id.toLowerCase();
    const l: AnyLayer = { ...layer, paint: { ...(layer.paint ?? {}) } };
    const paint = l.paint as Record<string, unknown>;

    if (l.type === "background") {
      paint["background-color"] = BRAND.ink;
      return l;
    }
    if (id.includes("water") || id.includes("ocean") || id.includes("bay")) {
      if (l.type === "fill") paint["fill-color"] = BRAND.ink3;
      if (l.type === "line") paint["line-color"] = "#2E211C";
      return l;
    }
    if (id.includes("park") || id.includes("wood") || id.includes("landcover") || id.includes("landuse")) {
      if (l.type === "fill") {
        paint["fill-color"] = "#141010";
        paint["fill-opacity"] = 0.8;
      }
      return l;
    }
    if (id.includes("building")) {
      if (l.type === "fill") {
        paint["fill-color"] = "#1C1512";
        paint["fill-opacity"] = 0.85;
      }
      return l;
    }
    if (id.includes("boundary") || id.includes("admin")) {
      if (l.type === "line") {
        paint["line-color"] = "#3A2A23";
        paint["line-opacity"] = 0.5;
      }
      return l;
    }
    if (id.includes("bridge")) {
      if (l.type === "line") {
        paint["line-color"] = BRAND.orange;
        paint["line-opacity"] = 0.55;
      }
      return l;
    }
    if (id.includes("motorway") || id.includes("trunk") || id.includes("primary")) {
      if (l.type === "line") {
        paint["line-color"] = "#4A2D1E";
        paint["line-opacity"] = 0.9;
      }
      return l;
    }
    if (id.includes("road") || id.includes("street") || id.includes("tunnel") || id.includes("transit")) {
      if (l.type === "line") {
        paint["line-color"] = "#2A1F1A";
        paint["line-opacity"] = 0.75;
      }
      return l;
    }
    if (l.type === "symbol") {
      paint["text-color"] = id.includes("place") || id.includes("city") ? "#A89588" : "#6B5B52";
      paint["text-halo-color"] = BRAND.ink;
      paint["text-halo-width"] = 1.2;
      if (id.includes("poi") || id.includes("housenum")) l.layout = { ...(l.layout ?? {}), visibility: "none" };
      return l;
    }
    return l;
  });

  return { ...style, layers: layers as StyleSpecification["layers"] };
}

export async function loadBrandStyle(signal?: AbortSignal): Promise<StyleSpecification> {
  const res = await fetch(DEFAULT_STYLE, { signal });
  if (!res.ok) throw new Error(`Basemap style failed: ${res.status}`);
  return repaint((await res.json()) as StyleSpecification);
}

/**
 * The illustrated city: buildings extruded in flat Hoppaz colours, no shading
 * gradient, so a pitched camera reads like the intro's flat skyline. Heights
 * are exaggerated because most of Lagos has no height data and comes in at
 * the OpenMapTiles default. Returns the layer id, or null when the basemap has
 * no building layer (e.g. the fallback style).
 */
export const CITY_LAYER = "hoppaz-city";
const CITY_HEIGHT: ExpressionSpecification = ["*", 2.2, ["max", 6, ["coalesce", ["get", "render_height"], 6]]];

export function addCityLayer(m: MLMap, beforeId?: string): string | null {
  const src = (m.getStyle().layers as AnyLayer[]).find(
    (l) => "source-layer" in l && l["source-layer"] === "building"
  ) as (AnyLayer & { source: string }) | undefined;
  if (!src) return null;
  m.addLayer(
    {
      id: CITY_LAYER,
      type: "fill-extrusion",
      source: src.source,
      "source-layer": "building",
      minzoom: 13,
      filter: ["!=", ["get", "hide_3d"], true],
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], CITY_HEIGHT,
          12, BRAND.ink3,
          40, "#2E211C",
          90, BRAND.ember,
        ],
        "fill-extrusion-height": ["*", 0, CITY_HEIGHT],
        "fill-extrusion-opacity": 0.94,
        "fill-extrusion-vertical-gradient": false,
      },
    },
    beforeId
  );
  return CITY_LAYER;
}

/**
 * The city sprouts out of the ground the first time it is in view, the way
 * buildings grow in the intro. Overshoots a touch, then settles.
 */
export function riseCity(m: MLMap, ms = 1100) {
  const t0 = performance.now();
  const backOut = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const step = (now: number) => {
    if (!m.getLayer(CITY_LAYER)) return;
    const t = Math.min(1, (now - t0) / ms);
    m.setPaintProperty(CITY_LAYER, "fill-extrusion-height", ["*", backOut(t), CITY_HEIGHT]);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Last-resort style if the tile host is unreachable. The app still opens: pins,
 * heat and the Hop route are our own GeoJSON and do not need tiles. The glyphs
 * entry is not optional, since any layer with a text-field throws without it.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": BRAND.ink } }],
};
