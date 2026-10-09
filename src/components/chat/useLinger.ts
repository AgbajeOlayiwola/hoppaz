"use client";

import { useEffect, useState } from "react";

/**
 * True once `on` has stayed true for `ms`. For lines that must not flash:
 * "reconnecting" while a room is still opening, or "no crews yet" while the
 * list is still on its way.
 */
export function useLinger(on: boolean, ms: number) {
  const [lingered, setLingered] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setLingered(true), ms);
    return () => {
      clearTimeout(t);
      setLingered(false);
    };
  }, [on, ms]);
  return lingered;
}
