"use client";

import Link from "next/link";
import clsx from "clsx";
import { Bus, Crosshair, Flame, SlidersHorizontal, X } from "lucide-react";
import DayRail from "@/components/DayRail";
import Wordmark from "@/components/Wordmark";
import type { DateFilter } from "@/lib/filters";

/**
 * Everything across the top of the map: a compact row (wordmark, streak,
 * "what kind", "where am I"), the day rail, and a slim row of removable pills
 * when a vibe filter is on. Anything the page needs to say (a failed load)
 * is passed as children and sits under the rail.
 *
 * The visible chips are 36px; each button carries 4px of padding so the thing
 * you can tap is 44px.
 */

const CHIP =
  "grid h-9 place-items-center rounded-hz border backdrop-blur transition-colors";

export default function TopChrome({
  hudRef,
  day,
  onDay,
  counts,
  types,
  onRemoveType,
  onClearTypes,
  streak,
  onFilter,
  onLocate,
  showBus,
  onBus,
  children,
}: {
  hudRef?: React.Ref<HTMLDivElement>;
  day: DateFilter;
  onDay: (f: DateFilter) => void;
  counts: Record<string, number>;
  types: string[];
  onRemoveType: (t: string) => void;
  onClearTypes: () => void;
  /** Daily streak, from the game dashboard. 0 when there is none yet. */
  streak: number;
  onFilter: () => void;
  onLocate: () => void;
  /** Hop day only: a button that flies to the bus. */
  showBus: boolean;
  onBus: () => void;
  children?: React.ReactNode;
}) {
  const filtered = types.length > 0;
  return (
    <div ref={hudRef} className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {/* A soft scrim so the wordmark, icons and rail read over any map: map labels must not show through. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top,0px)+8rem)] bg-gradient-to-b from-ink/95 via-ink/80 to-transparent" />

      <div className="pad-top relative mx-auto max-w-[640px] px-3.5 pb-2">
        <div className="flex items-center gap-1">
          <div className="pointer-events-auto mr-auto min-w-0 overflow-hidden py-1">
            <Wordmark size={15} />
          </div>

          <Link
            href="/me#earn"
            aria-label={`Daily streak ${streak}. Ways to earn`}
            className="pointer-events-auto -my-1 flex h-11 items-center px-1"
          >
            <span className={clsx(CHIP, "min-w-[56px] grid-flow-col gap-1.5 border-line bg-ink-2/95 px-2.5")}>
              <Flame size={16} strokeWidth={2.2} className="text-orange" aria-hidden />
              <span className="num text-[15px]">{streak}</span>
            </span>
          </Link>

          <button
            onClick={onFilter}
            aria-label={filtered ? `What kind: ${types.join(", ")}` : "What kind"}
            className="pointer-events-auto -my-1 grid h-11 w-11 place-items-center"
          >
            <span
              className={clsx(
                CHIP,
                "w-9",
                filtered ? "border-orange bg-orange text-brand-ink" : "border-line bg-ink-2/95 text-cream"
              )}
            >
              <SlidersHorizontal size={16} aria-hidden />
            </span>
          </button>

          {showBus && (
            <button
              onClick={onBus}
              aria-label="Where is the bus"
              className="pointer-events-auto -my-1 grid h-11 w-11 place-items-center"
            >
              <span className={clsx(CHIP, "w-9 border-line bg-ink-2/95 text-cream")}>
                <Bus size={16} aria-hidden />
              </span>
            </button>
          )}

          <button
            onClick={onLocate}
            aria-label="Set your location"
            className="pointer-events-auto -my-1 -mr-1 grid h-11 w-11 place-items-center"
          >
            <span className={clsx(CHIP, "w-9 border-line bg-ink-2/95 text-cream")}>
              <Crosshair size={16} aria-hidden />
            </span>
          </button>
        </div>

        <DayRail slim value={day} onChange={onDay} counts={counts} className="pointer-events-auto mt-1" />

        {filtered && (
          <div className="pointer-events-auto -mx-3.5 mt-px flex items-center gap-1.5 overflow-x-auto px-3.5 py-[7px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {types.map((t) => (
              <button
                key={t}
                aria-pressed="true"
                aria-label={`Remove ${t}`}
                onClick={() => onRemoveType(t)}
                className="chip relative min-h-[30px] flex-none gap-1.5 px-2.5 text-[10px] before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']"
              >
                {t}
                <X size={12} aria-hidden />
              </button>
            ))}
            <button
              onClick={onClearTypes}
              className="relative flex h-[30px] flex-none items-center px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-cream underline underline-offset-4 before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']"
            >
              Clear
            </button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
