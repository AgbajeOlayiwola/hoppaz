"use client";

import { useEffect, useRef, useState } from "react";
import { Award, Check } from "lucide-react";
import { badgeName } from "@/lib/useCheckin";
import { clockShort } from "@/lib/geo";
import { sfx } from "@/lib/sound/sfx";
import { haptics } from "@/lib/haptics";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * "+50 XP" counting up from 0 in 50ms steps, with two soft ticks along the way (the XP chip in Play does the
 * same). The ticks are the count-up's own sound, so with reduced motion the number just sits there and stays
 * quiet. The count itself is hidden from a screen reader, which gets the final number once.
 */
function XpCount({ xp }: { xp: number }) {
  const [n, setN] = useState(() => (reduced() ? xp : 0));
  useEffect(() => {
    if (reduced()) return;
    const steps = Math.max(2, Math.min(xp, 10));
    const ticks = [Math.round(steps / 3), Math.round((steps * 2) / 3)];
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setN(Math.round((xp * i) / steps));
      const k = ticks.indexOf(i);
      if (k >= 0) sfx.tick(k);
      if (i >= steps) clearInterval(iv);
    }, 50);
    return () => clearInterval(iv);
  }, [xp]);
  return (
    <span className="font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-dim">
      <span aria-hidden>+{n} XP</span>
      <span className="sr-only">+{xp} XP</span>
    </span>
  );
}

/** What a fresh check-in just brought back. Absent for a check-in from an earlier visit. */
export type FreshCheckin = { at: string; xp: number; badges: string[] };

/**
 * The check-in strip. Three states: the button (you are at the venue), the
 * plain disabled line (you are not), and the stamp (you are in). The stamp is
 * the only celebration: it lands once, 180ms, on the stub. Every new badge gets
 * its own stamp right behind it, 220ms apart, and each one has its sound on the same beat.
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

  // Each new badge stamps 220ms behind the last (the animationDelay below); its stamp sound lands with it.
  // (The check-in's own thump and motif sound from useCheckin, the moment the claim goes through.)
  // The buzz is one for the whole batch: the check-in's own buzz is 220ms before the first stamp, inside the 400ms
  // window that drops a second buzz, so the second stamp carries it (a lone badge has the check-in's buzz alone).
  useEffect(() => {
    if (!fresh) return;
    const timers = fresh.badges.map((_, i) =>
      setTimeout(() => {
        sfx.stamp();
        if (i === 1) haptics.buzz("stampSmall");
      }, (i + 1) * 220)
    );
    return () => timers.forEach(clearTimeout);
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
          {fresh && fresh.xp > 0 && <XpCount xp={fresh.xp} />}
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
