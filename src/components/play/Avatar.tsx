"use client";

import type { Ref } from "react";
import type { Map as MLMap } from "maplibre-gl";
import clsx from "clsx";
import { FaceDisc } from "@/components/Avatar";
import MapMarker, { type MarkerHandle } from "./MapMarker";

export type AvatarHandle = MarkerHandle;

/**
 * Your avatar on the map: a 44 px tappable disc on a neutral ring (never orange).
 * Out of Play it invites a tap (a slow violet pulse and a PLAY tag) and tapping it
 * opens Play. In Play the invitation goes quiet. It is one MapLibre marker that is
 * made once and moved with the handle's setLngLat (60 times a second during a run),
 * never rebuilt.
 */
export default function Avatar({
  map,
  look,
  lng,
  lat,
  playing,
  running,
  onTap,
  ref,
}: {
  map: MLMap;
  look: unknown;
  /** Where it first appears; later moves go through the handle. */
  lng: number;
  lat: number;
  playing: boolean;
  /** Mid-run to a box: the legs go. */
  running: boolean;
  onTap: () => void;
  ref?: Ref<AvatarHandle>;
}) {
  return (
    <MapMarker
      map={map}
      lng={lng}
      lat={lat}
      anchor="bottom"
      className={clsx("hz-avatar", playing && "hz-avatar-play", running && "hz-avatar-run")}
      label={playing ? "Your avatar" : "Your avatar. Tap to play."}
      onClick={onTap}
      style={{ zIndex: 90_000_000 }}
      ref={ref}
    >
      <i aria-hidden className="hz-avatar-pulse" />
      <i aria-hidden className="hz-avatar-pulse hz-avatar-pulse-b" />
      <span className="hz-avatar-body">
        <span className="hz-avatar-ring">
          <FaceDisc look={look} size={38} />
        </span>
        <i aria-hidden className="hz-avatar-tip" />
      </span>
      <i aria-hidden className="hz-avatar-shadow" />
      <span aria-hidden className="hz-avatar-tag">PLAY</span>
    </MapMarker>
  );
}
