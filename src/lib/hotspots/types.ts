/**
 * Hotspots as the app sees them (docs/HOTSPOTS.md sections 6 and 13). The list is public and fixed, so everything
 * about "near you" is worked out on the phone: the server never gets a position for a hotspot.
 */

/** The app's word for a hotspot's state. The table says active; the app says open. */
export type HotspotStatus = "open" | "planned" | "paused";

/** Counts are bands, never a number under 3. */
export type Band = "quiet" | "few" | "some" | "busy" | "packed";

type Ring = [number, number][];
/** A simplified zone shape, lng/lat, as hotspot_list() sends it. */
export type ZoneShape = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };

export type Hotspot = {
  id: string;
  /** The key the calls and the deep link use ("yaba"). */
  slug: string;
  /** The room's name, the place ("Jibowu"). */
  name: string;
  zoneName: string;
  /** The places in the zone, one line. */
  zoneLabel: string;
  side: "island" | "mainland";
  /** The junction as staff wrote it ("Ajah (Mobil Road)"). */
  junction: string;
  roadA: string;
  roadB: string;
  lat: number;
  lng: number;
  wave: number;
  status: HotspotStatus;
  /** Null in the demo list, which has no shapes: the nearest hotspot stands in for the zone. */
  zone: ZoneShape | null;
  hereBand: Band;
  /** Null under 3. */
  hereN: number | null;
  todayBand: Band;
  todayN: number | null;
};

export type Pt = { lat: number; lng: number };
