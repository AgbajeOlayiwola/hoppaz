"use client";

import clsx from "clsx";
import Mascot from "@/components/Mascot";

/**
 * A failed load, said once: the mascot caught out, one Fire Ant line, TRY AGAIN.
 * The line is a plain sentence for a Hopper, never a developer message.
 *
 *   <ErrorState line="Can't reach tonight." onRetry={reload} />
 */
export default function ErrorState({
  line = "That didn't load.",
  hint,
  onRetry,
  retryLabel = "TRY AGAIN",
  size = 112,
  className,
}: {
  line?: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div role="alert" className={clsx("flex flex-col items-center px-6 py-10 text-center", className)}>
      <Mascot state="oops" size={size} />
      <p className="mt-4 font-body text-[16px] font-semibold leading-snug text-fireant">{line}</p>
      {hint && <p className="hint mt-1.5 max-w-[17rem]">{hint}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn mt-5">
          {retryLabel}
        </button>
      )}
    </div>
  );
}
