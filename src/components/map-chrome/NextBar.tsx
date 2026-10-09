"use client";

import clsx from "clsx";
import { Crosshair } from "lucide-react";
import { nightTag } from "@/lib/filters";

/**
 * The map's bottom bar while it shows the next events rather than one day:
 * how many, which nights they cover, and the boxes. Without a location the
 * boxes stay hidden, and this is where you set one.
 */
export default function NextBar({
  count,
  from,
  to,
  boxes,
  openBoxes,
  hasFix,
  onLocate,
  className,
}: {
  count: number;
  from: string | null;
  to: string | null;
  /** Boxes on the map (open and sealed). */
  boxes: number;
  openBoxes: number;
  hasFix: boolean;
  onLocate: () => void;
  className?: string;
}) {
  const range = from && to ? (from === to ? nightTag(from) : `${nightTag(from)} TO ${nightTag(to)}`) : null;
  return (
    <section aria-label="What is on" className={clsx("rounded-hz border border-line bg-ink-2/95 px-3.5 py-3 backdrop-blur", className)}>
      <div className="flex items-end gap-3">
        <span className="num text-[32px] leading-none">{count}</span>
        <div className="min-w-0 flex-1 pb-px">
          <p className="seclabel truncate">{range ? `NEXT ${count} · ${range}` : "NOTHING COMING UP"}</p>
          <p className="mt-0.5 truncate font-body text-[13px] leading-snug text-cream">
            {count === 1 ? "event coming up" : "events coming up"}. Tap a day for one night.
          </p>
        </div>
      </div>
      <div className="mt-2.5 border-t border-line pt-2.5">
        {hasFix ? (
          <p className="flex items-center gap-2 font-body text-[13px] leading-snug text-cream">
            <i aria-hidden className={clsx("h-2 w-2 flex-none rounded-full", boxes ? "bg-violet" : "bg-dim")} />
            {boxes === 0
              ? "No boxes out right now. They drop at venues."
              : `${boxes} ${boxes === 1 ? "box" : "boxes"} on the map${openBoxes ? `, ${openBoxes} open now` : ""}. Get close and open ${boxes === 1 ? "it" : "them"}.`}
          </p>
        ) : (
          <button type="button" onClick={onLocate} className="flex min-h-[40px] w-full items-center gap-2 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream">
            <Crosshair size={15} className="flex-none text-orange" aria-hidden />
            <span className="underline decoration-orange decoration-2 underline-offset-4">Set your location to find the boxes near you</span>
          </button>
        )}
      </div>
    </section>
  );
}
