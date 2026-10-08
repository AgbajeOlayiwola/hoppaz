"use client";

import Link from "next/link";
import Mascot from "@/components/Mascot";
import { useTheme } from "@/lib/useTheme";
import { nextBusyLabel } from "./helpers";

/**
 * A day with nothing on at all: the one place the mascot may sit on this tab.
 * It is asleep, says one line, and offers the one useful move.
 */
export function EmptyDay({
  next,
  onNext,
}: {
  next: { key: string; n: number } | null;
  onNext: () => void;
}) {
  // The mascot is cream: on the cream day ground it needs the ink edge to be seen at all.
  const theme = useTheme();
  return (
    <div className="flex flex-col items-center px-6 pb-8 pt-10 text-center">
      <Mascot state="sleep" size={120} edge={theme === "day" ? "ink" : "ground"} label="The Hoppaz mascot, asleep" />
      <p className="mt-4 font-display text-[22px] font-black">Quiet one.</p>
      {next && (
        <button type="button" onClick={onNext} className="btn mt-5 px-5 text-[12.5px]">
          {nextBusyLabel(next)}
        </button>
      )}
      <Link
        href="/drop"
        className="mt-3 inline-flex min-h-[44px] items-center px-3 font-body text-[14px] text-dim underline underline-offset-4"
      >
        Post a flyer
      </Link>
    </div>
  );
}

/** The day has events, but the "what kind" filter hides every one. Plain words, no mascot. */
export function FilteredOut({
  onClear,
  next,
  onNext,
}: {
  onClear: () => void;
  next: { key: string; n: number } | null;
  onNext: () => void;
}) {
  return (
    <div className="px-4 pb-8 pt-8 text-center">
      <p className="font-display text-[20px] font-black">Nothing on for that.</p>
      <p className="hint mt-1">Your filter is hiding everything on this day.</p>
      <button type="button" onClick={onClear} className="btn mt-4 px-5 text-[12.5px]">
        CLEAR THE FILTER
      </button>
      {next && <NextBusyLine next={next} onNext={onNext} className="mt-2" />}
    </div>
  );
}

/** A quiet line at the end of a short day pointing to the next busy one. */
export function NextBusyLine({
  next,
  onNext,
  className = "",
}: {
  next: { key: string; n: number };
  onNext: () => void;
  className?: string;
}) {
  return (
    <p className={`px-4 text-center ${className}`}>
      <button
        type="button"
        onClick={onNext}
        className="inline-flex min-h-[44px] items-center px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-orange underline underline-offset-4"
      >
        {nextBusyLabel(next)}
      </button>
    </p>
  );
}

/** Live events could not be reached (production only). One line, a Fire Ant dot, one way out. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <p
      role="alert"
      className="mx-4 mt-4 flex items-center gap-2.5 rounded-hz border border-line bg-ink-2 py-1 pl-3 pr-1"
    >
      <i aria-hidden className="h-2 w-2 flex-none rounded-full bg-fireant" />
      <span className="min-w-0 flex-1 font-body text-[13px] font-semibold leading-snug">
        Can&apos;t reach today&apos;s events.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="flex-none px-3 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-orange underline underline-offset-4"
      >
        Try again
      </button>
    </p>
  );
}
