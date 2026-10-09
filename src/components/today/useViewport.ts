"use client";

import { useEffect, useState } from "react";

/** From this width the breakdown docks on the right (like the map) instead of rising as a sheet. */
export const WIDE_FROM = 900;

/**
 * The window's width, and whether it is wide enough to dock the event card at
 * the side. Narrow until the client has measured, so the server and the first
 * paint agree.
 */
export function useViewport() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return { width, wide: width >= WIDE_FROM };
}
