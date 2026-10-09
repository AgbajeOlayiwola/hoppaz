"use client";

import clsx from "clsx";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowLeft, Volume2, VolumeX } from "lucide-react";
import { levelFor } from "@/lib/brand";
import Pips, { type PipsHandle } from "./Pips";
import Tray, { type TrayLine } from "./Tray";

/** Where the open moment flies its things to. Any can be null if the piece is not on screen. */
export type HudRects = { xp: DOMRect | null; shelf: DOMRect | null; pips: DOMRect | null };
export type HudHandle = { rects: () => HudRects; trayHeight: () => number };

const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A number that counts up to its new value instead of jumping. */
function Roll({ to, className }: { to: number; className?: string }) {
  const [shown, setShown] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    const start = from.current;
    if (start === to) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = to;
      const t = setTimeout(() => setShown(to), 0);
      return () => clearTimeout(t);
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 500);
      const v = Math.round(start + (to - start) * (1 - Math.pow(1 - u, 3)));
      setShown(v);
      if (u < 1) raf = requestAnimationFrame(step);
      else from.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <b className={className}>{fmt(shown)}</b>;
}

/**
 * The four things on the Play screen, and nothing else: the exit arrow, the streak
 * pips, the XP bar with your level, and the tray along the bottom (Shelf and one
 * line of what is going on). Plus the mute button, which the shell owns.
 * Everything is over the map with no blur (a cheap phone cannot afford it).
 */
export default function Hud({
  xp,
  streak,
  doneToday,
  shelf,
  line,
  night,
  muted,
  onMute,
  onExit,
  ref,
}: {
  xp: number;
  streak: number;
  doneToday: boolean;
  shelf: number | null;
  line: TrayLine;
  night: boolean;
  muted: boolean;
  onMute: () => void;
  onExit: () => void;
  ref?: Ref<HudHandle>;
}) {
  const level = levelFor(xp);
  const bar = useRef<HTMLDivElement>(null);
  const pips = useRef<PipsHandle>(null);
  const shelfEl = useRef<HTMLSpanElement>(null);
  const tray = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      rects: () => ({
        xp: bar.current?.getBoundingClientRect() ?? null,
        shelf: shelfEl.current?.getBoundingClientRect() ?? null,
        pips: pips.current?.rect() ?? null,
      }),
      trayHeight: () => tray.current?.getBoundingClientRect().height ?? 0,
    }),
    []
  );

  return (
    <div className="hz-hud" role="group" aria-label="Play">
      <div className="hz-hud-top">
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onExit} aria-label="Back to the events map" className="hz-hud-btn">
            <ArrowLeft size={20} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onMute}
            aria-label={muted ? "Sound is off. Turn sound on" : "Sound is on. Turn sound off"}
            aria-pressed={!muted}
            className="hz-hud-btn"
          >
            {muted ? <VolumeX size={18} strokeWidth={2.2} aria-hidden /> : <Volume2 size={18} strokeWidth={2.2} aria-hidden />}
          </button>
        </div>
        <Pips ref={pips} streak={streak} doneToday={doneToday} />
        <div className="hz-xp">
          <div className="flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-cream">
            <span className="truncate">{level.name}</span>
            <Roll to={xp} className="font-display text-[13px] font-black leading-none tracking-normal" />
          </div>
          <div ref={bar} className="hz-xp-bar" role="img" aria-label={`${fmt(xp)} XP, level ${level.name}`}>
            <i style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </div>
        </div>
      </div>
      <div className={clsx("hz-play-night", night && "hz-play-night-on")} aria-hidden={!night}>
        Night mode. Boxes stay close.
      </div>
      <Tray shelf={shelf} line={line} shelfRef={shelfEl} trayRef={tray} />
    </div>
  );
}
