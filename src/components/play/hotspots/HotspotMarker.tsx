"use client";

import { memo } from "react";
import clsx from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import MapMarker from "../MapMarker";
import { BAND_BARS, bandPulses, hereLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";
import HotspotGlyph from "./HotspotGlyph";
import s from "./Hotspots.module.css";

/**
 * A hotspot on the Play map (never on the events map). Dark disc, cream crossroads, orange ring, the place name
 * under it, a small bar badge for how many are there. The ring pulses when 3 or more avatars are there. One that is
 * not open yet keeps a quiet ring.
 */
function HotspotMarker({
  map,
  h,
  mine,
  picked,
  far,
  z,
  onTap,
}: {
  map: MLMap;
  h: Hotspot;
  /** It is the Hopper's own hotspot. */
  mine: boolean;
  /** Its sheet is open. */
  picked: boolean;
  /** The camera is out over all of Lagos: just the disc. */
  far: boolean;
  /** Stacking order: among the pins, and above the boxes (see PIN_Z in HotspotsLayer). In Play the map is under the HUD whatever this is. */
  z: number;
  onTap: (h: Hotspot) => void;
}) {
  const soon = h.status !== "open";
  const bars = soon ? 0 : BAND_BARS[h.hereBand];
  const label = `${h.name} hotspot${mine ? ", your hotspot" : ""}. ${soon ? "Opening soon." : `${hereLabel(h)}.`} Tap to see it.`;
  return (
    <MapMarker
      map={map}
      lng={h.lng}
      lat={h.lat}
      anchor="center"
      className={clsx(s.spot, mine && s.mine, picked && s.picked, soon && s.soon, far && s.far)}
      label={label}
      onClick={() => onTap(h)}
      style={{ zIndex: z }}
    >
      <span className={s.wrap}>
        {!soon && bandPulses(h.hereBand) && <i aria-hidden className={s.pulse} />}
        <span aria-hidden className={s.disc}>
          <HotspotGlyph className={s.glyph} />
        </span>
        {bars > 0 && (
          <span aria-hidden className={s.bars}>
            {[1, 2, 3, 4].map((n) => (
              <i key={n} className={n <= bars ? s.on : undefined} />
            ))}
          </span>
        )}
        {mine && <span aria-hidden className={s.yours}>YOURS</span>}
        <span aria-hidden className={s.name}>{h.name}</span>
      </span>
    </MapMarker>
  );
}

export default memo(HotspotMarker);
