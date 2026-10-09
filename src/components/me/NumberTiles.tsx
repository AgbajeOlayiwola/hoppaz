"use client";

import clsx from "clsx";
import { ChevronRight } from "lucide-react";

export type TileKey = "streak" | "xp";

/**
 * Two numbers, not eight. Poppins Black, big, tabular, with a mono caption
 * under. Only the one that moved most recently is orange, and it stamps in
 * once. The XP tile opens "Ways to earn".
 */
export default function NumberTiles({
  streak,
  xp,
  hot,
  stamp,
  ready,
  onXp,
}: {
  streak: number;
  xp: number;
  hot: TileKey;
  stamp: Partial<Record<TileKey, boolean>>;
  /** Until the numbers have loaded they keep their space but stay unseen, so nothing says 0 by mistake. */
  ready: boolean;
  onXp: () => void;
}) {
  const num = (key: TileKey, value: number) => (
    <span
      className={clsx(
        "num block text-[44px]",
        hot === key ? "text-orange" : "text-cream",
        !ready && "invisible",
        ready && stamp[key] && "animate-stamp"
      )}
    >
      {value.toLocaleString("en-NG")}
    </span>
  );
  return (
    <section aria-label="Your numbers" className="grid grid-cols-2 gap-3">
      <div className="card">
        {num("streak", streak)}
        <p className="seclabel mt-3">DAILY STREAK</p>
      </div>
      <button
        type="button"
        onClick={onXp}
        aria-label={`${xp} XP. Ways to earn`}
        className="card block min-h-[44px] text-left"
      >
        {num("xp", xp)}
        <p className="seclabel mt-3 flex items-center justify-between gap-1">
          <span>XP</span>
          <span className="flex items-center gap-0.5">
            EARN
            <ChevronRight size={14} aria-hidden />
          </span>
        </p>
      </button>
    </section>
  );
}
