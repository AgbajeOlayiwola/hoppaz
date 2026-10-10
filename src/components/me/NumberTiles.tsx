"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { ChevronRight, Flame } from "lucide-react";
import { DAY_NAMES } from "./lagosDay";
import { sfx } from "@/lib/sound/sfx";
import { haptics } from "@/lib/haptics";

export type TileKey = "streak" | "xp";

/**
 * Two numbers, not eight. Poppins Black, big, tabular, with a mono caption
 * under. The streak is orange (it is the thing to keep going) and carries
 * this week's seven dots, Monday to Sunday: filled for a day that counted, a
 * dashed ring for today while it has not. The XP tile opens "Ways to earn".
 * A number that moved since you last looked stamps in once. The streak's stamp has a sound with it: the warm
 * agogo of the streak stamp, and on day 7 of the cycle (the Golden Box) the Hoppaz three as well.
 */
export default function NumberTiles({
  streak,
  xp,
  level,
  stamp,
  ready,
  week,
  weekDone,
  today,
  onXp,
}: {
  streak: number;
  xp: number;
  /** Where the XP sits on the ladder: how far to the next rung. */
  level: { next: string | null; toNext: number; progress: number };
  stamp: Partial<Record<TileKey, boolean>>;
  /** Until the numbers have loaded they keep their space but stay unseen, so nothing says 0 by mistake. */
  ready: boolean;
  /** This week's seven Lagos dates, Monday first. Null before the clock is read. */
  week: string[] | null;
  /** The dates in the week that counted toward the streak. */
  weekDone: Set<string>;
  /** Today's Lagos date. */
  today: string | null;
  onXp: () => void;
}) {
  const days = week && today ? week.map((d, i) => ({ name: DAY_NAMES[i], done: weekDone.has(d), now: d === today })) : null;
  // A streak of 0 stamping in is a streak that ended: that is no cause for a bell, so it stays silent.
  const kept = ready && !!stamp.streak && streak > 0;
  const latest = useRef(streak);
  useEffect(() => {
    latest.current = streak;
  }, [streak]);
  useEffect(() => {
    if (!kept) return;
    sfx.stamp();
    haptics.buzz("streak");
    if (latest.current % 7 !== 0) return;
    const t = setTimeout(() => sfx.motif("full"), 450); // the stamp rings first, then the three notes
    return () => clearTimeout(t);
  }, [kept]);
  return (
    <section aria-label="Your numbers" className="grid grid-cols-2 gap-3">
      <div className="card flex flex-col">
        <div className={clsx("flex items-center gap-1.5", !ready && "invisible")}>
          <Flame size={26} strokeWidth={2.2} aria-hidden className="flex-none text-orange" />
          <span className={clsx("num block text-[44px] text-orange", ready && stamp.streak && "animate-stamp")}>
            {streak.toLocaleString("en-NG")}
          </span>
        </div>
        <p className="seclabel mt-3">DAY STREAK</p>
        <div
          role="img"
          aria-label={days ? `This week: ${days.filter((d) => d.done).map((d) => d.name).join(", ") || "nothing yet"}` : "This week"}
          className={clsx("mt-3.5 flex items-center justify-between", (!ready || !days) && "invisible")}
        >
          {(days ?? Array.from({ length: 7 }, () => null)).map((d, i) => (
            <span
              key={i}
              aria-hidden
              className={clsx(
                "box-border h-[14px] w-[14px] rounded-full",
                d?.done ? "bg-orange" : d?.now ? "border-[1.5px] border-dashed border-orange" : "border border-line"
              )}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onXp}
        aria-label={`${xp} XP. Ways to earn`}
        className="card flex min-h-[44px] flex-col text-left"
      >
        <span className={clsx("num block text-[44px] text-cream", !ready && "invisible", ready && stamp.xp && "animate-stamp")}>
          {xp.toLocaleString("en-NG")}
        </span>
        <p className="seclabel mt-3 flex items-center justify-between gap-1">
          <span>XP</span>
          <span className="flex items-center gap-0.5">
            EARN
            <ChevronRight size={14} aria-hidden />
          </span>
        </p>
        <span
          role="progressbar"
          aria-label={level.next ? `${level.toNext} XP to ${level.next}` : "Top of the ladder"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level.progress * 100)}
          className={clsx("mt-3.5 flex h-[14px] flex-col justify-center", !ready && "invisible")}
        >
          <span className="block h-1.5 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-cream" style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </span>
        </span>
        <span aria-hidden className={clsx("mt-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-dim", !ready && "invisible")}>
          {level.next ? `${level.toNext} TO ${level.next}` : "TOP OF THE LADDER"}
        </span>
      </button>
    </section>
  );
}
