"use client";

import { useEffect, useState } from "react";

/**
 * The clock as a render input. It is null on the server and on the first paint,
 * so a countdown never mismatches between server and browser; it ticks after that.
 */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
