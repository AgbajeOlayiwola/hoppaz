import clsx from "clsx";

/**
 * A ghost stub for "data is on its way". Static on purpose: the design system
 * says nothing shimmers. Use it instead of an empty-state line, so a screen
 * never says "nothing here" before the answer has arrived.
 *
 *   <LoadingStub />                 one ghost stub
 *   <LoadingStub count={3} />       a short list of them
 *   <LoadingStub lines={1} />       a slimmer one (one title bar, one mono bar)
 */
export default function LoadingStub({
  count = 1,
  lines = 2,
  label = "Loading",
  className,
}: {
  count?: number;
  /** Body bars under the title bar. */
  lines?: number;
  /** Spoken to screen readers. */
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={clsx("space-y-3", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <div key={i} aria-hidden className="stub p-4" style={{ ["--notch-y" as string]: "50%" }}>
          <div className="h-5 w-2/3 rounded-[3px] bg-line" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: Math.max(0, lines) }, (_, k) => (
              <div key={k} className="h-3 rounded-[3px] bg-line/70" style={{ width: `${k % 2 ? 46 : 62}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
