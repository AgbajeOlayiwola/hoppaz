"use client";

import clsx from "clsx";
import Sheet from "@/components/Sheet";
import { distanceLabel } from "@/lib/hotspots/geometry";
import type { Hotspot } from "@/lib/hotspots/types";
import HotspotGlyph from "./HotspotGlyph";

/** Two numbers under the name: how many are in the room now and how many came today. Under 3 it is a word, never a count. */
function stat(band: Hotspot["hereBand"], n: number | null, words: { quiet: string; few: string }) {
  if (band === "quiet") return words.quiet;
  if (band === "few" || n === null) return band === "few" ? words.few : band === "some" ? "Some" : band === "busy" ? "Busy" : "Packed";
  return String(n);
}

/**
 * The sheet a hotspot's pin opens: the name, the junction, the places in the zone, who is there, ENTER. Entering
 * needs an account (the caller asks for it) and nothing here sends a position.
 */
export default function HotspotSheet({
  h,
  mine,
  metres,
  onEnter,
  onClose,
}: {
  h: Hotspot;
  mine: boolean;
  /** Straight-line metres from the Hopper, or null when we do not know where they are. */
  metres: number | null;
  onEnter: (h: Hotspot) => void;
  onClose: () => void;
}) {
  const soon = h.status !== "open";
  const here = stat(h.hereBand, h.hereN, { quiet: "Quiet", few: "A few" });
  const today = stat(h.todayBand, h.todayN, { quiet: "None yet", few: "A few" });
  return (
    <Sheet open onClose={onClose} label={`${h.name} hotspot`}>
      <div className="mx-auto max-w-[520px]">
        <div className="flex items-center gap-2 pr-9">
          <span className="grid h-7 w-7 flex-none place-items-center rounded-full border-2 border-orange bg-brand-ink text-brand-cream">
            <HotspotGlyph className="h-3.5 w-3.5" />
          </span>
          <span className={clsx("font-mono text-[10px] font-medium uppercase tracking-[0.14em]", mine && !soon ? "text-orange" : "text-dim")}>
            {soon ? "Opening soon" : mine ? "Your hotspot" : "Hotspot"}
            {metres !== null && ` · ${distanceLabel(metres)}`}
          </span>
        </div>
        <h2 className="mt-2 break-words font-display text-[28px] font-black uppercase leading-[1.05] tracking-[-0.01em]">{h.name}</h2>
        <p className="mt-1 font-body text-[13px] leading-snug text-cream/85">
          {h.roadA} x {h.roadB}
        </p>
        <p className="mt-1 line-clamp-2 font-mono text-[10px] uppercase leading-snug tracking-[0.08em] text-dim">
          {h.side === "island" ? "Island" : "Mainland"} · {h.zoneLabel}
        </p>

        {soon ? (
          <p className="mt-4 rounded-hz border border-line bg-ink-3 px-3 py-3 font-body text-[14px] leading-snug">Not open yet. Have a look around.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2.5" role="group" aria-label="Who is there">
            <div className="rounded-hz border border-line bg-ink-3 px-3 py-2.5">
              <span className="num block text-[24px]">{here}</span>
              <small className="mt-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-dim">Here now</small>
            </div>
            <div className="rounded-hz border border-line bg-ink-3 px-3 py-2.5">
              <span className="num block text-[24px]">{today}</span>
              <small className="mt-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-dim">Today</small>
            </div>
          </div>
        )}

        <button type="button" className="btn mt-4 w-full" disabled={soon} onClick={() => onEnter(h)}>
          {soon ? "Opening soon" : "Enter"}
        </button>
        <p className="hint mt-3 text-center text-[12px]">Hotspots are online. You do not need to be at this junction.</p>
      </div>
    </Sheet>
  );
}
