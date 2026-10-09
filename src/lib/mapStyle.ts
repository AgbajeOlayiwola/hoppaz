import type { ExpressionSpecification, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { BRAND } from "./brand";
import type { Theme } from "./theme";

/**
 * The map's two looks. Night is CARTO dark-matter (or NEXT_PUBLIC_MAP_STYLE when
 * set, night only) in the original Hoppaz night paint: Night Black with orange
 * arteries (repaintNight). Day is CARTO positron moved onto Bridge Cream with
 * hairline roads (repaint). Both styles share OpenMapTiles layer naming.
 */
const NIGHT_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE ||
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const DAY_STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const styleUrlFor = (theme: Theme) => (theme === "day" ? DAY_STYLE_URL : NIGHT_STYLE_URL);

/**
 * Hex versions of the design tokens (MapLibre paint cannot read CSS variables).
 * Keep in step with the night and day sets in globals.css.
 */
export type MapPalette = {
  /** The ground: Night Black / Bridge Cream. */
  ground: string;
  /** Text colour (cream at night, ink by day): route line, own dot. */
  text: string;
  dim: string;
  card: string;
  hairline: string;
  violet: string;
  /** Basemap tones. */
  water: string;
  waterLine: string;
  park: string;
  land: string;
  building: string;
  casing: string;
  roadMinor: string;
  roadMajor: string;
  bridge: string;
  boundary: string;
  label: string;
  place: string;
  /** The 3D city, low to tall. Neutral concrete, never ember or orange. */
  city: [string, string, string];
  /** Heat ramp, thin to thick. Orange on both grounds, a touch stronger on cream. */
  heat: [string, string, string, string];
  heatOpacity: number;
};

export const MAP_PALETTE: Record<Theme, MapPalette> = {
  night: {
    ground: "#0E0B0A",
    text: "#F5EBDD",
    dim: "#9C9087",
    card: "#221A17",
    hairline: "#2E2320",
    violet: "#9D81FF",
    water: "#1D2B32",
    waterLine: "#2A3A42",
    park: "#1B221D",
    land: "#15110F",
    building: "#221A17",
    casing: "#0E0B0A",
    roadMinor: "#2E2320",
    roadMajor: "#4A3F3A",
    bridge: "#5C4F49",
    boundary: "#3A2F2B",
    label: "#8F847B",
    place: "#BDB0A3",
    // Campus Twin neighbours: #2a2320 walls, a gentle ramp by height.
    city: ["#221A17", "#2A2320", "#3A302B"],
    heat: ["rgba(184,54,0,0)", "rgba(184,54,0,0.4)", "rgba(255,77,0,0.62)", "rgba(255,77,0,0.82)"],
    heatOpacity: 0.85,
  },
  day: {
    ground: "#F5EBDD",
    text: "#0E0B0A",
    dim: "#6E635A",
    card: "#FFFCF7",
    hairline: "#E0D3C2",
    violet: "#4A20E0",
    water: "#C9D6D8",
    waterLine: "#B6C6C9",
    park: "#E3E5D0",
    land: "#EFE4D4",
    building: "#EADFCE",
    casing: "#F5EBDD",
    roadMinor: "#E0D3C2",
    roadMajor: "#D2C3AF",
    bridge: "#C4B49F",
    boundary: "#CDBEA9",
    label: "#6E635A",
    place: "#2A2320",
    city: ["#E0D3C2", "#D8CAB8", "#CFC1AE"],
    heat: ["rgba(184,54,0,0)", "rgba(184,54,0,0.5)", "rgba(255,77,0,0.72)", "rgba(255,77,0,0.9)"],
    heatOpacity: 0.95,
  },
};

type AnyLayer = StyleSpecification["layers"][number] & {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  "source-layer"?: string;
};

const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

/**
 * Matching is by layer id plus the OpenMapTiles source-layer, which is how
 * CARTO's styles (and most others) are built. The 3D city is ours, so any
 * extruded building layer a style ships is hidden here: a style swap or a
 * different NEXT_PUBLIC_MAP_STYLE can never bring an unpainted city back.
 */
function repaint(style: StyleSpecification, theme: Theme): StyleSpecification {
  const P = MAP_PALETTE[theme];
  const layers = (style.layers as AnyLayer[]).map((layer) => {
    const id = layer.id.toLowerCase();
    const sl = String(layer["source-layer"] ?? "").toLowerCase();
    const l: AnyLayer = { ...layer, paint: { ...(layer.paint ?? {}) } };
    const paint = l.paint as Record<string, unknown>;
    const hide = () => {
      l.layout = { ...(l.layout ?? {}), visibility: "none" };
      return l;
    };

    if (l.type === "background") {
      paint["background-color"] = P.ground;
      return l;
    }
    if (l.type === "fill-extrusion") {
      if (has(id, "building") || sl === "building") return hide();
      return l;
    }
    if (l.type === "symbol") {
      paint["text-color"] = has(id, "place", "city", "country", "state") ? P.place : P.label;
      paint["text-halo-color"] = P.ground;
      paint["text-halo-width"] = 1.2;
      if (has(id, "poi", "housenum")) hide();
      return l;
    }
    if (l.type !== "fill" && l.type !== "line") return l;

    const fill = (color: string, opacity = 1) => {
      if (l.type === "fill") {
        paint["fill-color"] = color;
        paint["fill-opacity"] = opacity;
      }
      return l;
    };

    if (sl === "water" || sl === "waterway" || has(id, "water", "ocean", "bay")) {
      if (l.type === "fill") return fill(P.water);
      paint["line-color"] = P.waterLine;
      return l;
    }
    if (sl === "building" || has(id, "building")) {
      return fill(P.building, 1);
    }
    if (sl === "boundary" || has(id, "boundary", "admin")) {
      if (l.type === "line") {
        paint["line-color"] = P.boundary;
        paint["line-opacity"] = 0.7;
      }
      return l;
    }
    if (sl === "park" || has(id, "park", "wood", "forest", "grass", "nature")) {
      return fill(P.park);
    }
    if (sl === "landcover" || sl === "landuse" || has(id, "landcover", "landuse")) {
      return fill(P.land);
    }

    const road =
      sl === "transportation" ||
      sl === "aeroway" ||
      has(id, "road", "street", "tunnel", "bridge", "motorway", "trunk", "highway", "rail", "transit", "ramp", "aeroway");
    if (road) {
      if (l.type === "fill") return fill(P.roadMinor);
      let color = P.roadMinor;
      let opacity = 1;
      if (has(id, "case", "casing")) {
        color = P.casing;
      } else if (has(id, "bridge")) {
        color = P.bridge;
      } else if (has(id, "motorway", "trunk", "primary", "highway", "_mot", "_pri", "_trunk")) {
        color = P.roadMajor;
      } else if (has(id, "tunnel")) {
        opacity = 0.55;
      } else if (has(id, "rail", "transit")) {
        opacity = 0.7;
      }
      paint["line-color"] = color;
      paint["line-opacity"] = opacity;
      return l;
    }
    return l;
  });

  // A low light keeps the extruded city close to the tones above: roofs read as the
  // palette, walls a shade down, never the default 1.5x glare on dark colours.
  const light = { anchor: "map" as const, color: "#ffffff", intensity: 0.2, position: [1.15, 210, 30] as [number, number, number] };
  return { ...style, light, layers: layers as StyleSpecification["layers"] };
}

/**
 * The original night paint: dark-matter repainted so it reads as Night Black
 * with orange arteries instead of Google-with-a-filter. Matching is by layer id.
 * The one change from the original: the basemap's own extruded buildings are
 * hidden, because the 3D city is ours (addCityLayer).
 */
function repaintNight(style: StyleSpecification): StyleSpecification {
  const layers = (style.layers as AnyLayer[]).map((layer) => {
    const id = layer.id.toLowerCase();
    const sl = String(layer["source-layer"] ?? "").toLowerCase();
    const l: AnyLayer = { ...layer, paint: { ...(layer.paint ?? {}) } };
    const paint = l.paint as Record<string, unknown>;

    if (l.type === "background") {
      paint["background-color"] = BRAND.ink;
      return l;
    }
    if (l.type === "fill-extrusion" && (id.includes("building") || sl === "building")) {
      l.layout = { ...(l.layout ?? {}), visibility: "none" };
      return l;
    }
    if (id.includes("water") || id.includes("ocean") || id.includes("bay")) {
      if (l.type === "fill") paint["fill-color"] = "#1D2B32";
      if (l.type === "line") paint["line-color"] = "#455963";
      return l;
    }
    if (id.includes("park") || id.includes("wood") || id.includes("landcover") || id.includes("landuse")) {
      if (l.type === "fill") {
        paint["fill-color"] = id.includes("park") || id.includes("wood") ? "#29352B" : "#34322B";
        paint["fill-opacity"] = 0.9;
      }
      return l;
    }
    if (id.includes("building")) {
      if (l.type === "fill") {
        paint["fill-color"] = "#3A2B23";
        paint["fill-opacity"] = 0.95;
      }
      return l;
    }
    if (id.includes("boundary") || id.includes("admin")) {
      if (l.type === "line") {
        paint["line-color"] = "#59453A";
        paint["line-opacity"] = 0.72;
      }
      return l;
    }
    if (id.includes("bridge")) {
      if (l.type === "line") {
        paint["line-color"] = "#C85E28";
        paint["line-opacity"] = 0.8;
      }
      return l;
    }
    if (id.includes("motorway") || id.includes("trunk") || id.includes("primary")) {
      if (l.type === "line") {
        paint["line-color"] = "#D88A4E";
        paint["line-opacity"] = 0.98;
      }
      if (l.type === "fill") paint["fill-color"] = "#78513A";
      return l;
    }
    if (id.includes("road") || id.includes("street") || id.includes("tunnel") || id.includes("transit")) {
      if (l.type === "line") {
        paint["line-color"] = "#896B56";
        paint["line-opacity"] = 0.92;
      }
      if (l.type === "fill") paint["fill-color"] = "#57473B";
      return l;
    }
    if (l.type === "symbol") {
      paint["text-color"] = id.includes("place") || id.includes("city") ? "#D0B6A3" : "#A38B79";
      paint["text-halo-color"] = BRAND.ink;
      paint["text-halo-width"] = 1.2;
      if (id.includes("poi") || id.includes("housenum")) l.layout = { ...(l.layout ?? {}), visibility: "none" };
      return l;
    }
    return l;
  });

  return { ...style, layers: layers as StyleSpecification["layers"] };
}

export async function loadBrandStyle(theme: Theme, signal?: AbortSignal): Promise<StyleSpecification> {
  const res = await fetch(styleUrlFor(theme), { signal });
  if (!res.ok) throw new Error(`Basemap style failed: ${res.status}`);
  const style = (await res.json()) as StyleSpecification;
  return theme === "night" ? repaintNight(style) : repaint(style, theme);
}

/**
 * The 3D city: the basemap's buildings extruded in flat neutral concrete (the
 * Campus Twin neighbour tones), no shading gradient, never orange. They grow out
 * of the ground the first time they are in view (riseCity), the way buildings
 * grow in the intro. Heights are exaggerated because most of Lagos has no height
 * data and comes in at the OpenMapTiles default. Pass grown when the city has
 * already risen (a day/night swap rebuilds it at full height). Returns the layer
 * id, or null when the basemap has no building layer (e.g. the fallback style).
 */
export const CITY_LAYER = "hoppaz-city";
const CITY_HEIGHT: ExpressionSpecification = ["*", 2.2, ["max", 6, ["coalesce", ["get", "render_height"], 6]]];

export function addCityLayer(m: MLMap, beforeId?: string, theme: Theme = "night", grown = true): string | null {
  const src = (m.getStyle().layers as AnyLayer[]).find((l) => l["source-layer"] === "building" && "source" in l) as
    | (AnyLayer & { source: string })
    | undefined;
  if (!src) return null;
  const [low, mid, tall] = MAP_PALETTE[theme].city;
  m.addLayer(
    {
      id: CITY_LAYER,
      type: "fill-extrusion",
      source: src.source,
      "source-layer": "building",
      minzoom: 13,
      filter: ["!=", ["get", "hide_3d"], true],
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], CITY_HEIGHT, 12, low, 40, mid, 90, tall],
        "fill-extrusion-height": grown ? CITY_HEIGHT : ["*", 0, CITY_HEIGHT],
        "fill-extrusion-base": ["*", 2.2, ["coalesce", ["get", "render_min_height"], 0]],
        "fill-extrusion-opacity": 0.96,
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
 * Last-resort style if the tile host is unreachable (and the day style's twin).
 * The app still opens: pins, heat and the Hop route are our own GeoJSON and do
 * not need tiles. The glyphs entry is not optional, since any layer with a
 * text-field throws without it.
 */
export function fallbackStyle(theme: Theme = "night"): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": MAP_PALETTE[theme].ground } }],
  };
}

export const FALLBACK_STYLE: StyleSpecification = fallbackStyle("night");
