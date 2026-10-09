"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";

export type MarkerHandle = { setLngLat: (lng: number, lat: number) => void };

/**
 * A React-rendered MapLibre marker. The marker and its element are made once and
 * only moved with setLngLat (never rebuilt), the children render into the element
 * through a portal. `onClick` stops the click, so the map under it does not also
 * hear it.
 */
export default function MapMarker({
  map,
  lng,
  lat,
  anchor = "bottom",
  className,
  style,
  label,
  onClick,
  children,
  ref,
}: {
  map: MLMap;
  lng: number;
  lat: number;
  anchor?: "bottom" | "center";
  className?: string;
  /** Inline styles; names starting with "--" are custom properties. */
  style?: Record<string, string | number>;
  /** Makes the marker a button with this accessible name. */
  label?: string;
  onClick?: () => void;
  children?: ReactNode;
  ref?: Ref<MarkerHandle>;
}) {
  const [el] = useState(() => document.createElement(onClick ? "button" : "div"));
  const [marker] = useState(() => new maplibregl.Marker({ element: el, anchor }));

  // Added to the map and removed with it. The first position is the one the props hold when it mounts.
  useEffect(() => {
    marker.setLngLat([lng, lat]).addTo(map);
    return () => {
      try {
        marker.remove();
      } catch {
        /* the map is already gone */
      }
    };
    // lng and lat only seed the marker; moving it is the effect below and the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, marker]);

  useEffect(() => {
    marker.setLngLat([lng, lat]);
  }, [marker, lng, lat]);

  useImperativeHandle(ref, () => ({ setLngLat: (x, y) => marker.setLngLat([x, y]) }), [marker]);

  // MapLibre owns some of the element's classes (maplibregl-marker, the anchor), so ours are added and removed one by one.
  const mine = useRef<string[]>([]);
  useEffect(() => {
    const next = (className ?? "").split(/\s+/).filter(Boolean);
    mine.current.filter((c) => !next.includes(c)).forEach((c) => el.classList.remove(c));
    next.forEach((c) => el.classList.add(c));
    mine.current = next;
  }, [el, className]);

  useEffect(() => {
    if (el instanceof HTMLButtonElement) el.type = "button";
    if (label) el.setAttribute("aria-label", label);
    else el.removeAttribute("aria-label");
  }, [el, label]);

  const styleKey = JSON.stringify(style ?? {});
  useEffect(() => {
    const entries = Object.entries(JSON.parse(styleKey) as Record<string, string | number>);
    entries.forEach(([k, v]) => (k.startsWith("--") ? el.style.setProperty(k, String(v)) : el.style.setProperty(k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), String(v))));
  }, [el, styleKey]);

  useEffect(() => {
    if (!onClick) return;
    const h = (e: Event) => {
      e.stopPropagation();
      onClick();
    };
    el.addEventListener("click", h);
    return () => el.removeEventListener("click", h);
  }, [el, onClick]);

  return createPortal(children, el);
}
