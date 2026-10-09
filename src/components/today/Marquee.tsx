"use client";

import { useEffect, useMemo, useRef } from "react";
import { clockShort, eventTitle, isEventLead } from "@/lib/geo";
import { nightOf } from "@/lib/filters";
import type { EventRow } from "@/lib/types";

/** How fast the strip drifts, in px a second. Slow enough to read a tag as it passes. */
const SPEED = 34;
/** The least tags a half of the loop holds, so a short list still fills the width. */
const MIN_TAGS = 8;

const WEEKDAY = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" }).toUpperCase();

/** "SAT 9PM", "TODAY 9PM", or just "SAT" for a lead whose time nobody has confirmed. */
function tagWhen(e: EventRow, today: string) {
  const key = nightOf(Date.parse(e.starts_at));
  const day = key === today ? "TODAY" : WEEKDAY(key);
  return isEventLead(e) ? day : `${day} ${clockShort(e.starts_at)}`;
}

/**
 * The slim strip under the deck: the nights coming up as small tags, drifting
 * by themselves. It slows to a stop when a finger or the pointer is on it (and
 * while a tag has focus), and with reduced motion it does not move at all: it
 * is an ordinary row you scroll. Tapping a tag hands the event back so the
 * deck can jump to it.
 *
 * The drift is one Web Animation on a transform, so it runs on the compositor
 * and costs the page nothing.
 */
export default function Marquee({
  events: incoming,
  now,
  onPick,
}: {
  events: EventRow[];
  now: number;
  onPick: (event: EventRow) => void;
}) {
  // The list is rebuilt every half minute with the clock. Only a real change (other events) restarts the drift.
  const kept = useRef(incoming);
  if (kept.current !== incoming && (kept.current.length !== incoming.length || kept.current.some((e, i) => e.id !== incoming[i].id))) {
    kept.current = incoming;
  }
  const events = kept.current;
  const track = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const hold = useRef({ pointer: false, touch: false, focus: false, release: 0 });
  const today = nightOf(now);

  const loop = useMemo(() => {
    if (!events.length) return [];
    const reps = Math.max(1, Math.ceil(MIN_TAGS / events.length));
    return Array.from({ length: reps }, () => events).flat();
  }, [events]);

  // Start the drift, sized so SPEED holds whatever the tags say.
  useEffect(() => {
    const el = track.current;
    if (!el || !loop.length || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const run = () => {
      // One loop is the distance from the first copy of the tags to the second.
      const copies = el.children;
      const half = copies.length > 1 ? (copies[1] as HTMLElement).offsetLeft - (copies[0] as HTMLElement).offsetLeft : 0;
      if (half <= 0) return;
      const was = anim.current;
      const a = el.animate(
        [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${-half}px,0,0)` }],
        { duration: (half / SPEED) * 1000, iterations: Infinity, easing: "linear" }
      );
      if (was) {
        a.currentTime = was.currentTime;
        a.playbackRate = was.playbackRate;
        was.cancel();
      }
      anim.current = a;
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => {
      ro.disconnect();
      anim.current?.cancel();
      anim.current = null;
    };
  }, [loop]);

  // Ease the drift to a stop and back, instead of freezing it.
  useEffect(() => {
    let raf = 0;
    const ease = () => {
      const a = anim.current;
      const h = hold.current;
      if (!a) return;
      const want = h.pointer || h.touch || h.focus ? 0 : 1;
      const rate = a.playbackRate + (want - a.playbackRate) * 0.12;
      if (Math.abs(want - rate) < 0.03) {
        a.playbackRate = want;
        return;
      }
      a.playbackRate = rate;
      raf = requestAnimationFrame(ease);
    };
    const kick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(ease);
    };
    const el = track.current?.parentElement;
    if (!el) return;
    const h = hold.current;
    const set = (k: "pointer" | "touch" | "focus", v: boolean) => {
      h[k] = v;
      kick();
    };
    const enter = (e: PointerEvent) => e.pointerType === "mouse" && set("pointer", true);
    const leave = (e: PointerEvent) => e.pointerType === "mouse" && set("pointer", false);
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      clearTimeout(h.release);
      set("touch", true);
    };
    // After a touch it rests a moment, so you see where the deck went before the strip carries on.
    const up = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      clearTimeout(h.release);
      h.release = window.setTimeout(() => set("touch", false), 1600);
    };
    const fin = () => set("focus", true);
    const fout = () => set("focus", false);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("focusin", fin);
    el.addEventListener("focusout", fout);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(h.release);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("focusin", fin);
      el.removeEventListener("focusout", fout);
    };
  }, []);

  if (!events.length) return null;

  const tags = (hidden: boolean) =>
    loop.map((e, i) => (
      <button
        key={`${e.id}-${i}`}
        type="button"
        tabIndex={hidden ? -1 : 0}
        onClick={() => onPick(e)}
        className="inline-flex min-h-[32px] flex-none items-center gap-1.5 whitespace-nowrap rounded-hz border border-line bg-ink-2 px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-cream active:translate-y-px"
      >
        <span className="text-dim">{tagWhen(e, today)}</span>
        <span aria-hidden className="text-dim">
          ·
        </span>
        <span className="max-w-[180px] truncate">{eventTitle(e)}</span>
      </button>
    ));

  return (
    <section
      aria-label="Coming up"
      className="flex-none overflow-hidden border-t border-line px-2 py-2.5 [mask-image:linear-gradient(90deg,transparent,#000_7%,#000_93%,transparent)] motion-reduce:overflow-x-auto motion-reduce:[scrollbar-width:none] motion-reduce:[&::-webkit-scrollbar]:hidden"
    >
      <div ref={track} className="flex w-max gap-2 will-change-transform motion-reduce:will-change-auto">
        <div className="flex flex-none gap-2">{tags(false)}</div>
        <div aria-hidden className="flex flex-none gap-2 motion-reduce:hidden">
          {tags(true)}
        </div>
      </div>
    </section>
  );
}
