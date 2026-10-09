"use client";

import clsx from "clsx";
import { dayLabel } from "@/lib/filters";
import { eventTitle } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { EventRow } from "@/lib/types";

/**
 * The nights you said you are going to, soonest first, as small stubs you can
 * tap. Labelled YOU'RE GOING, like the button, so it never reads as Me's
 * YOUR NIGHTS (the nights you have been out). Rebuilt from your saved choices every time, so it is still there after
 * a reload. The page decides when it shows (only when there is something in
 * the next 14 days).
 */
export default function YourDays({
  events,
  now,
  onOpen,
}: {
  events: EventRow[];
  now: number;
  onOpen: (event: EventRow) => void;
}) {
  return (
    <section aria-label="You're going" className="mt-5">
      <p className="seclabel mb-2 px-4">YOU&apos;RE GOING</p>
      <ul className="flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {events.map((e) => {
          const day = themeForEvent(e.starts_at) === "day";
          return (
            <li key={e.id} className="flex-none">
              <button
                type="button"
                onClick={() => onOpen(e)}
                className={clsx(
                  "stub block min-h-[44px] min-w-[168px] max-w-[232px] overflow-hidden px-3.5 py-3 text-left",
                  day ? "stub-day" : "stub-night"
                )}
                style={{ ["--notch" as string]: "6px" } as React.CSSProperties}
              >
                <span className="block truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-dim">
                  {dayLabel(e.starts_at, now)}
                </span>
                <span className="mt-1 block truncate font-display text-[15px] font-black leading-tight">
                  {eventTitle(e)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
