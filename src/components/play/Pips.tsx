"use client";

import clsx from "clsx";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

export type PipsHandle = {
  /** The pip the next box will light, for the open moment to fly into. */
  rect: () => DOMRect | null;
};

/**
 * The seven streak pips and the flame with today's count. Six are orange as they
 * fill; the seventh is the Golden Box, dashed gold until it is earned. The pip
 * for today pulses until the first box of the day lights it (a stamp).
 */
export default function Pips({
  streak,
  doneToday,
  ref,
}: {
  /** Consecutive days with a box or a check-in. */
  streak: number;
  /** Today already has its box. */
  doneToday: boolean;
  ref?: Ref<PipsHandle>;
}) {
  // The cycle of seven: day 7 earns the Golden Box and the next day starts over. Once today has its box the streak
  // counts today and the last lit pip is today's; before that it counts through yesterday and the next pip is today's
  // (so a streak of 7 not yet stamped today starts a fresh row).
  const lit = doneToday ? (streak <= 0 ? 0 : ((streak - 1) % 7) + 1) : Math.max(0, streak) % 7;
  const todayIdx = doneToday ? lit - 1 : lit;
  const root = useRef<HTMLDivElement>(null);
  const [stamp, setStamp] = useState<number | null>(null);
  const was = useRef(doneToday);

  useEffect(() => {
    if (!was.current && doneToday) {
      // Defer one frame so the pip is on screen as lit before the stamp lands.
      const t = setTimeout(() => setStamp(todayIdx), 0);
      const u = setTimeout(() => setStamp(null), 800);
      was.current = doneToday;
      return () => {
        clearTimeout(t);
        clearTimeout(u);
      };
    }
    was.current = doneToday;
  }, [doneToday, todayIdx]);

  useImperativeHandle(
    ref,
    () => ({ rect: () => root.current?.querySelectorAll("i")[Math.max(0, todayIdx)]?.getBoundingClientRect() ?? null }),
    [todayIdx]
  );

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="hz-flame" aria-label={`Streak ${streak} ${streak === 1 ? "day" : "days"}`} role="img">
        <svg viewBox="0 0 32 36" aria-hidden>
          <path d="M16 1c1.6 6 10 10 10 20a10 10 0 0 1-20 0c0-4.6 2.4-7.4 4.6-9.6.2 3 1.4 4.6 3.2 5C13.2 12.4 12.4 6 16 1z" fill="#FF4D00" />
          <circle cx="16" cy="25.5" r="8.2" fill="#F5EBDD" />
        </svg>
        <b>{streak}</b>
      </div>
      <div ref={root} className="hz-pips" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => (
          <i
            key={i}
            className={clsx(
              "hz-pip",
              i < lit && "hz-pip-on",
              i === todayIdx && !doneToday && "hz-pip-today",
              i === 6 && "hz-pip-gold",
              stamp === i && "hz-pip-stamp"
            )}
          />
        ))}
      </div>
    </div>
  );
}
