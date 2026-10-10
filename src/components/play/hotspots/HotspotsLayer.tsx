"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import type { Map as MLMap } from "maplibre-gl";
import type { HotspotsData } from "@/lib/hotspots/useHotspots";
import type { Hotspot } from "@/lib/hotspots/types";
import HotspotMarker from "./HotspotMarker";
import HotspotPointer from "./HotspotPointer";
import HotspotSheet from "./HotspotSheet";
import HotspotsAll from "./HotspotsAll";

// The room (chat, faces) has its own chunk: nobody pays for it until a sheet is opened. Until it has loaded, the screen is
// the room's own dark ground, so the hand-over from the map has no empty frame in it.
const HotspotRoom = dynamic(() => import("./HotspotRoom"), { ssr: false, loading: () => <div aria-hidden className="fixed inset-0 z-[45] bg-ink" /> });

/** Below this zoom the camera is out over all of Lagos and a pin is just its disc. */
const FAR_ZOOM = 12.6;
/**
 * Pins sit above the boxes. A box's z-index is (90 - latitude) x 100,000, about 8.35 million over Lagos, and a spawn spot can be
 * 40 m from a junction, so a pin lower than that is painted over by the box beside it. Markers stay under the avatar (90 million).
 */
const PIN_Z = 8_500_000;

/**
 * Map markers carry huge z-indexes (a crate's is 8 million, the avatar's 90 million), so a sheet that must cover them
 * goes in here: its own stacking context above all of them. The wrapper takes no taps, its sheet does.
 */
function Over({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none absolute inset-0 z-[100000000] [&>*]:pointer-events-auto">{children}</div>;
}

/**
 * Everything hotspot on the Play map, apart from the tray row: the pins, the sheet a pin opens, the list of all 13,
 * and the room once the avatar has arrived. PlayLayer owns what is open and what the avatar does.
 */
export default function HotspotsLayer({
  map,
  playing,
  hs,
  sheet,
  listOpen,
  room,
  inSlug,
  running,
  inset,
  onPin,
  onEnter,
  onCloseSheet,
  onCloseList,
  onLeave,
}: {
  map: MLMap;
  playing: boolean;
  hs: HotspotsData;
  /** The slug whose sheet is open. */
  sheet: string | null;
  listOpen: boolean;
  /** The slug of the room that is open (the avatar has arrived). */
  room: string | null;
  /** The hotspot the avatar is standing in, if any. */
  inSlug: string | null;
  /** The avatar is on its way to a junction. */
  running: boolean;
  /** How much of the bottom of the screen the tray covers, in px. */
  inset: () => number;
  onPin: (h: Hotspot) => void;
  onEnter: (h: Hotspot) => void;
  onCloseSheet: () => void;
  onCloseList: () => void;
  onLeave: () => void;
}) {
  const [far, setFar] = useState(() => map.getZoom() < FAR_ZOOM);
  useEffect(() => {
    const on = () => setFar(map.getZoom() < FAR_ZOOM);
    map.on("zoomend", on);
    on();
    return () => {
      map.off("zoomend", on);
    };
  }, [map]);

  // Someone looking at a sheet may well enter: fetch the room now so it is there when the avatar arrives.
  useEffect(() => {
    if (sheet) void import("./HotspotRoom");
  }, [sheet]);

  // The room covers the whole screen: the markers (which would paint over it) step aside while it is open.
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle("hz-room-open", !!room);
    return () => el.classList.remove("hz-room-open");
  }, [map, room]);

  // A tap on the bare map puts the sheet away. A pin stops its own click, so it never reaches here.
  const covering = !!sheet || listOpen;
  useEffect(() => {
    if (!covering) return;
    const close = () => (sheet ? onCloseSheet() : onCloseList());
    map.on("click", close);
    return () => {
      map.off("click", close);
    };
  }, [map, covering, sheet, onCloseSheet, onCloseList]);

  if (!playing) return null;
  const open = hs.bySlug(sheet);
  // A hotspot picked from the full list may be far from the Hopper; it still gets its pin while it is looked at or entered.
  const extra = [open, hs.bySlug(inSlug)].filter((h): h is Hotspot => !!h && !hs.pins.includes(h));
  // Not-open pins sit behind open ones, and further north behind further south, so they stack the way the 3D map leans.
  // Zoomed right out, the pins of rooms that are not open yet are left off: 13 discs over all of Lagos overlap (five pairs do), and a
  // quiet one could hide an open one. They are all in the list, and show again as the camera comes in.
  const shown = [...hs.pins, ...extra]
    .filter((h) => !far || h.status === "open" || h.slug === sheet || h.slug === inSlug)
    .sort((a, b) => Number(a.status === "open") - Number(b.status === "open") || b.lat - a.lat);
  const lookingAtOne = !!sheet || listOpen || !!room || running;
  return (
    <>
      {shown.map((h, i) => {
        const picked = h.slug === sheet || h.slug === inSlug;
        return <HotspotMarker key={h.id} map={map} h={h} mine={h.slug === hs.yours?.slug} picked={picked} far={far} z={PIN_Z + (picked ? 24 : 2 + i)} onTap={onPin} />;
      })}
      {hs.yours && hs.located && !lookingAtOne && <HotspotPointer map={map} h={hs.yours} metres={hs.metres(hs.yours)} inset={inset} onTap={onPin} />}
      {open && !room && (
        <Over>
          <HotspotSheet key={open.slug} h={open} mine={open.slug === hs.yours?.slug} metres={hs.metres(open)} onEnter={onEnter} onClose={onCloseSheet} />
        </Over>
      )}
      {listOpen && !room && (
        <Over>
          <HotspotsAll list={hs.list} yoursSlug={hs.yours?.slug ?? null} metres={hs.metres} onPick={onPin} onClose={onCloseList} />
        </Over>
      )}
      {room && <HotspotRoom slug={room} name={hs.bySlug(room)?.name} onLeave={onLeave} />}
    </>
  );
}
