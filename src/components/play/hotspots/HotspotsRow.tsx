"use client";

import clsx from "clsx";
import { distanceLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";

/** One short word for how busy it is: the chip has room for little else. */
function sub(h: Hotspot) {
  if (h.status !== "open") return "Soon";
  switch (h.hereBand) {
    case "quiet":
      return "Quiet";
    case "few":
      return "A few";
    default:
      return h.hereN ? `${h.hereN} here` : h.hereBand === "some" ? "Some" : h.hereBand === "busy" ? "Busy" : "Packed";
  }
}

/**
 * "Hotspots near you", in the tray, in ONE row of chips: your hotspot first, then the two nearest, then a chip for the full
 * list. The tray sits over the map, so every line it grows is a line the map loses (this row is 44 px, the least a finger
 * can hit). With no position (location off, or not in Lagos) the chips are in wave order. The distances are worked out on
 * the phone and shown only here.
 */
export default function HotspotsRow({
  items,
  total,
  yoursSlug,
  located,
  metres,
  onPick,
  onMore,
}: {
  items: Hotspot[];
  /** How many hotspots the full list holds. */
  total: number;
  yoursSlug: string | null;
  located: boolean;
  metres: (h: Hotspot) => number | null;
  onPick: (h: Hotspot) => void;
  onMore: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5 border-t border-line pt-2" role="group" aria-label={located ? "Hotspots near you" : "Hotspots"}>
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((h, i) => {
          const mine = h.slug === yoursSlug;
          const m = metres(h);
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onPick(h)}
              className={clsx(
                "flex min-h-[44px] w-[148px] flex-none snap-start flex-col items-start justify-center rounded-hz border bg-ink-3 px-2.5 py-1 text-left",
                mine ? "border-orange" : "border-line",
                i === 2 && "short:hidden"
              )}
            >
              <span className={clsx("max-w-full truncate font-mono text-[8.5px] uppercase leading-tight tracking-[0.1em]", mine ? "text-orange" : "text-dim")}>
                {mine ? (m !== null ? `Your hotspot · ${distanceLabel(m)}` : "Your hotspot") : m !== null ? distanceLabel(m) : h.zoneName}
              </span>
              <span className="mt-px flex w-full items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-display text-[13px] font-black uppercase leading-tight">{h.name}</span>
                <span className="flex-none font-mono text-[9px] leading-tight text-dim">{sub(h)}</span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-label="More hotspots"
          className="flex min-h-[44px] w-[72px] flex-none snap-start flex-col items-center justify-center rounded-hz border border-line px-2 text-center font-mono text-[9.5px] font-medium uppercase leading-tight tracking-[0.1em] text-orange"
        >
          <span>All</span>
          <span>{total}</span>
        </button>
      </div>
    </div>
  );
}
