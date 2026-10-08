"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One quiet line under the status bar when the phone has no signal, gone again
 * when it comes back. Mounted once, first inside the app column in layout.tsx,
 * so it pushes the page down instead of covering the night rail.
 *
 * While it shows, <html> carries .hz-offline; the end of globals.css uses that
 * to drop the safe-area top padding from .pad-top (the line already absorbs it).
 */
export default function OfflineLine() {
  const [offline, setOffline] = useState(false);
  const toggled = useRef(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("hz-offline", offline);
    // The map (and anything else that measures itself) only re-measures on a window resize.
    let id = 0;
    if (toggled.current || offline) id = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    toggled.current = true;
    return () => cancelAnimationFrame(id);
  }, [offline]);

  useEffect(() => () => document.documentElement.classList.remove("hz-offline"), []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="flex-none border-b border-line bg-ink-2 px-4 pb-1.5"
      style={{ paddingTop: "calc(0.375rem + env(safe-area-inset-top, 0px))" }}
    >
      <p className="flex items-center gap-2 font-body text-[13px] leading-snug text-dim">
        <i aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-danfo" />
        No signal. Showing what we had.
      </p>
    </div>
  );
}
