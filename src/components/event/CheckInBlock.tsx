"use client";

import { useEffect, useRef } from "react";
import { Award, Check } from "lucide-react";
import { badgeName } from "@/lib/useCheckin";
import { clockShort } from "@/lib/geo";

/** What a fresh check-in just brought back. Absent for a check-in from an earlier visit. */
export type FreshCheckin = { at: string; xp: number; badges: string[] };

/**
 * The check-in strip. Three states: the button (you are at the venue), the
 * plain disabled line (you are not), and the stamp (you are in). The stamp is
 * the only celebration: it lands once, 180ms, on the stub. Every new badge gets
 * its own stamp right behind it.
 */
export default function CheckInBlock({
  checkedIn,
  busy,
  closeEnough,
  at,
  fresh,
  onCheckIn,
}: {
  checkedIn: boolean;
  busy: boolean;
  closeEnough: boolean;
  /** When you checked in, ISO, if we know. */
  at: string | null;
  fresh: FreshCheckin | null;
  onCheckIn: () => void;
}) {
  const stamps = useRef<HTMLElement>(null);
  // Checked in while this card was open: the stamp lands. Opened already checked in: it just sits there.
  const wasIn = useRef(checkedIn);
  const landing = !!fresh || (checkedIn && !wasIn.current);

  // A fresh stamp must land where you can see it, not behind the pinned footer.
  useEffect(() => {
    const el = stamps.current;
    const scroller = el?.closest<HTMLElement>("[data-evt-scroll]");
    if (!el || !scroller || !fresh) return;
    const over = el.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    if (over > 0) scroller.scrollTop += over + 16;
  }, [fresh]);

  if (checkedIn) {
    return (
      <section ref={stamps} className="px-5 pt-5" aria-label="Check-in" role="status">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <p
            key={landing ? "fresh" : "kept"}
            className={
              "inline-flex items-center gap-2 rounded-[4px] border-2 border-keke px-3 py-2 font-mono text-[13px] font-medium uppercase tracking-[0.1em] text-keke " +
              (landing ? "animate-stamp" : "-rotate-1")
            }
          >
            <Check size={16} strokeWidth={3} aria-hidden />
            {at ? `CHECKED IN · ${clockShort(at)}` : "CHECKED IN"}
          </p>
          {fresh && fresh.xp > 0 && (
            <span className="font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-dim">+{fresh.xp} XP</span>
          )}
          {fresh?.badges.map((key, i) => (
            <p
              key={key}
              className="inline-flex animate-stamp items-center gap-2 rounded-[4px] border-2 border-cream px-3 py-2 font-mono text-[13px] font-medium uppercase tracking-[0.1em] text-cream"
              style={{ animationDelay: `${(i + 1) * 220}ms` }}
            >
              <Award size={16} aria-hidden />
              BADGE · {badgeName(key).toUpperCase()}
            </p>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="px-5 pt-5" aria-label="Check-in">
      <button className="btn w-full disabled:border disabled:border-line" onClick={onCheckIn} disabled={!closeEnough || busy}>
        {busy ? "CHECKING…" : closeEnough ? "CHECK IN" : "CHECK-IN OPENS AT THE VENUE"}
      </button>
    </section>
  );
}
