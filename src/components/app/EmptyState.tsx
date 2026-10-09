"use client";

import Link from "next/link";
import clsx from "clsx";
import Mascot, { type MascotState } from "@/components/Mascot";

export type StateAction = { label: string; href?: string; onClick?: () => void };

/**
 * An empty list, said once: the mascot asleep, one line, one action.
 * The mascot is allowed here because an empty state is an edge of the app.
 *
 *   <EmptyState line="Quiet one." action={{ label: "SEE SATURDAY", onClick: next }} />
 *
 * Never show this before the data has arrived; show <LoadingStub /> first.
 * `compact` drops the padding for use inside a card.
 */
export default function EmptyState({
  line,
  hint,
  action,
  mascot = "sleep",
  size = 112,
  compact,
  className,
}: {
  line: string;
  /** One short quiet line under it. Optional. */
  hint?: string;
  action?: StateAction;
  mascot?: MascotState;
  size?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center px-6 text-center", compact ? "py-4" : "py-10", className)}>
      <Mascot state={mascot} size={size} />
      <p className="mt-4 font-display text-[22px] font-black leading-tight">{line}</p>
      {hint && <p className="hint mt-1.5 max-w-[17rem]">{hint}</p>}
      {action &&
        (action.href ? (
          <Link href={action.href} onClick={action.onClick} className="btn mt-5">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="btn mt-5">
            {action.label}
          </button>
        ))}
    </div>
  );
}
