"use client";

import { useEffect, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { Navigation2 } from "lucide-react";
import { distanceLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";

/** Clear of the screen edges, and of the HUD's top row. */
const SIDE = 16;
const TOP = 104;
/** About half the size of the chip, so its middle stays far enough in for all of it to show. */
const HALF_W = 84;
const HALF_H = 22;

type Place = { x: number; y: number; deg: number };

/** Ray casting on a ring of [lng, lat]. */
function inRing(x: number, y: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * "Your hotspot" when its pin is off the screen: a chip on the edge of the map, pointing the way, with the name and the
 * distance. At the zoom Play opens on a junction is usually a kilometre or more away, so without this the only way to find it
 * would be the tray. Tap it for the sheet. Worked out on the phone from the map and the fixed junction point; nothing is sent.
 * `inset` is how much of the bottom of the screen the tray takes.
 */
export default function HotspotPointer({
  map,
  h,
  metres,
  inset,
  onTap,
}: {
  map: MLMap;
  h: Hotspot;
  metres: number | null;
  inset: () => number;
  onTap: (h: Hotspot) => void;
}) {
  const [at, setAt] = useState<Place | null>(null);

  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = map.getContainer();
      const w = el.clientWidth;
      const bottom = el.clientHeight - inset();
      if (bottom - TOP < 60) return setAt(null);
      // Is the junction on the ground shown inside the free part of the screen? (Looked at on the ground, not by projecting the
      // point: a point behind the camera projects to the wrong side of the screen.)
      const corners = [
        [SIDE, TOP],
        [w - SIDE, TOP],
        [w - SIDE, bottom],
        [SIDE, bottom],
      ].map(([x, y]) => {
        const p = map.unproject([x, y]);
        return [p.lng, p.lat] as [number, number];
      });
      if (inRing(h.lng, h.lat, corners)) return setAt(null);
      // Which way, from the middle of the free part of the screen: the compass direction turned by the map's bearing.
      const c = map.getCenter();
      const east = (h.lng - c.lng) * Math.cos((c.lat * Math.PI) / 180);
      const north = h.lat - c.lat;
      const turn = Math.atan2(east, north) - (map.getBearing() * Math.PI) / 180;
      const dx = Math.sin(turn);
      const dy = -Math.cos(turn);
      const cx = w / 2;
      const cy = (TOP + bottom) / 2;
      const room = { x: w / 2 - SIDE - HALF_W, y: (bottom - TOP) / 2 - HALF_H };
      const t = Math.min(room.x / Math.max(Math.abs(dx), 1e-6), room.y / Math.max(Math.abs(dy), 1e-6));
      setAt({ x: Math.round(cx + dx * t), y: Math.round(cy + dy * t), deg: Math.round((turn * 180) / Math.PI) });
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    map.on("move", soon);
    map.on("resize", soon);
    return () => {
      map.off("move", soon);
      map.off("resize", soon);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map, h.lat, h.lng, inset]);

  if (!at) return null;
  const how = metres !== null ? `, ${distanceLabel(metres)} away` : "";
  return (
    <div className="pointer-events-none absolute inset-0 z-[24]">
      <button
        type="button"
        onClick={() => onTap(h)}
        style={{ left: at.x, top: at.y }}
        aria-label={`Your hotspot, ${h.name}${how}. Tap to see it.`}
        className="pointer-events-auto absolute flex min-h-[44px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border-2 border-orange bg-brand-ink px-3 text-brand-cream shadow-sheet"
      >
        <Navigation2 size={16} strokeWidth={2.4} aria-hidden className="flex-none text-orange" style={{ transform: `rotate(${at.deg}deg)` }} />
        <span className="max-w-[110px] truncate font-display text-[12px] font-black uppercase leading-none">{h.name}</span>
        {metres !== null && <span className="font-mono text-[10px] leading-none text-brand-cream/70">{distanceLabel(metres)}</span>}
      </button>
    </div>
  );
}
