"use client";

import clsx from "clsx";
import type { Ref } from "react";
import { Layers } from "lucide-react";

export type TrayLine = {
  /** "info" is the quiet default; "warn" is a state worth a glance (finding you, location off). */
  tone: "info" | "warn";
  text: string;
};

/**
 * The tray along the bottom: your Shelf count (cards and collectibles) and one line
 * of what Play is saying: today's XP and boxes, or the state it is in. No Gist
 * count until a Gist system exists.
 */
export default function Tray({
  shelf,
  line,
  shelfRef,
  trayRef,
}: {
  shelf: number | null;
  line: TrayLine;
  shelfRef?: Ref<HTMLSpanElement>;
  trayRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={trayRef} className="hz-tray" role="region" aria-label="Your tray">
      <div className="flex items-center gap-3">
        <span ref={shelfRef} className="grid h-8 w-8 flex-none place-items-center text-cream" aria-hidden>
          <Layers size={24} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <span className="num block text-[24px] leading-none">{shelf ?? 0}</span>
          <small className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-dim">Shelf</small>
        </div>
      </div>
      <p
        className={clsx("hz-tray-line", line.tone === "warn" && "hz-tray-warn")}
        role="status"
        aria-live="polite"
      >
        {line.tone === "warn" && <i aria-hidden className="h-2 w-2 flex-none rounded-full bg-violet" />}
        <span className="min-w-0 truncate">{line.text}</span>
      </p>
    </div>
  );
}
