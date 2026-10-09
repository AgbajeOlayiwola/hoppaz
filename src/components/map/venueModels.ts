import type { Map as MLMap } from "maplibre-gl";
import type { Theme } from "@/lib/theme";
import type { EventRow } from "@/lib/types";

/**
 * PHASE 4 HOOK: Campus Twin venue models.
 *
 * This is where the real venue models mount, and the only place NightMap needs
 * to change when they land. Plan (docs/UI-REFRESH-PLAN.md, build order step 4):
 * a MapLibre custom layer (CustomLayerInterface, three.js or raw WebGL) that
 * draws public/venues/<id>.json from the venue builder, only for venues that
 * have an event on the selected day, with the two patch sizes (venue only, venue
 * plus block) behind a switch for testing. The event marker (banner or card)
 * floats above whatever this layer draws.
 *
 * Until then both functions do nothing, on purpose. The old per-event "Sims lot"
 * houses are gone and must not come back as a stand-in.
 */
export const VENUE_MODELS_ENABLED = false;

export type VenueModelsContext = {
  theme: Theme;
  /** The events on the map (already filtered to the selected day). */
  events: EventRow[];
  selectedId: string | null;
};

/** Called each time the basemap style has loaded (first load and every day/night swap). */
export function mountVenueModels(map: MLMap, theme: Theme): void {
  void map;
  void theme;
}

/** Called whenever the events on the map or the selection change. */
export function updateVenueModels(map: MLMap, ctx: VenueModelsContext): void {
  void map;
  void ctx;
}
