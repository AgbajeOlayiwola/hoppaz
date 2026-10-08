"use client";

/**
 * The two things the map sometimes has to say. Plain words, no developer talk:
 * a player never reads "database" or "production" here.
 */

/** Live events failed to load in production. One line, a Fire Ant dot, one way out. */
export function ErrorLine({ onRetry }: { onRetry: () => void }) {
  return (
    <p
      role="alert"
      className="pointer-events-auto mt-2 flex items-center gap-2.5 rounded-hz border border-line bg-ink-2/95 py-1 pl-3 pr-1 backdrop-blur"
    >
      <i aria-hidden className="h-2 w-2 flex-none rounded-full bg-fireant" />
      <span className="min-w-0 flex-1 font-body text-[13px] font-semibold leading-snug">Can&apos;t reach today&apos;s events.</span>
      <button
        onClick={onRetry}
        className="flex-none px-3 py-3.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-orange underline underline-offset-4"
      >
        Try again
      </button>
    </p>
  );
}

/** A day with nothing on (or nothing that matches the type filter). */
export function EmptyDay({
  nextLabel,
  onNext,
  filtered,
}: {
  nextLabel: string | null;
  onNext: () => void;
  /** A vibe filter is on, so fewer types could bring something back. */
  filtered: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[40%] z-20 flex justify-center px-6">
      <div className="pointer-events-auto rounded-hz border border-line bg-ink-2/95 px-5 py-3.5 text-center backdrop-blur">
        <p className="font-display text-[15px] font-black">Nothing on for that.</p>
        <p className="hint mt-0.5">{filtered ? "Try another day or fewer types." : "Try another day."}</p>
        {nextLabel && (
          <button
            onClick={onNext}
            className="mt-1 px-3 py-3.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-orange underline underline-offset-4"
          >
            Next busy day: {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
