"use client";

import { useRef } from "react";
import clsx from "clsx";
import { clock, scrubCaption, type Stop } from "./scrub";

/**
 * The map's one slim bottom bar: a time scrubber. Drag the thumb (or tap a
 * printed hour) and the heat on the map moves to that moment. The chosen time
 * is big, the caption says whether it is LIVE (check-ins right now) or
 * EXPECTED (a guess from how busy each event usually gets), and a plain
 * conductor line says who is out.
 *
 * It is the one ambient moment on the map, so nothing else here moves.
 */
export default function TimeScrubber({
  stops,
  index,
  onIndex,
  strengths,
  ticks,
  dayKey,
  today,
  line,
  dimLine = false,
  sample = false,
  className,
}: {
  stops: Stop[];
  index: number;
  onIndex: (i: number) => void;
  /** 0 to 1 per stop: the city's crowd, drawn as small bars behind the track. */
  strengths: number[];
  ticks: Array<{ i: number; label: string }>;
  dayKey: string;
  today: boolean;
  /** The conductor line: "23 Hoppers out · 2 drops today". */
  line: string;
  dimLine?: boolean;
  /** Development builds only: a tiny "SAMPLE DAY" tag. */
  sample?: boolean;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = Math.max(stops.length - 1, 1);
  const stop = stops[Math.min(index, stops.length - 1)];
  const pct = (i: number) => (i / last) * 100;

  const fromX = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const i = Math.round(f * last);
    if (i !== index) onIndex(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const jump: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 4, PageDown: -4 };
    if (e.key in jump) {
      e.preventDefault();
      onIndex(Math.min(last, Math.max(0, index + jump[e.key])));
    } else if (e.key === "Home") {
      e.preventDefault();
      onIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onIndex(last);
    }
  };

  if (!stop) return null;
  const big = clock(stop.t);
  const caption = scrubCaption(stop, dayKey, today);

  return (
    <section
      aria-label="Time on the map"
      className={clsx("relative rounded-hz border border-line bg-ink-2/95 px-3.5 pb-1.5 pt-2.5 backdrop-blur", className)}
    >
      {sample && (
        <span className="absolute -top-[7px] left-3.5 bg-ink-2 px-1.5 font-mono text-[10px] leading-none tracking-[0.1em] text-dim">
          SAMPLE DAY
        </span>
      )}
      <div className="flex items-end gap-3">
        <span aria-hidden className="num min-w-[3.4ch] text-[32px] leading-none">
          {big}
        </span>
        <div className="min-w-0 flex-1 pb-px">
          <p className="seclabel truncate">{caption}</p>
          <p className={clsx("mt-0.5 truncate font-body text-[13px] leading-snug", dimLine ? "text-dim" : "text-cream")}>{line}</p>
        </div>
      </div>

      {/* The track. Bars are the city's crowd at each stop; the thumb is the only orange. */}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Time on the map"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={`${big}, ${stop.live ? "live" : "expected"}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromX(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && fromX(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        className="relative mx-3 mt-2 h-[72px] cursor-pointer touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-orange"
      >
        <div aria-hidden className="absolute inset-x-0 top-0 flex h-6 items-end justify-between">
          {strengths.map((s, i) => (
            <i
              key={i}
              className={clsx("block w-[3px] rounded-[1px]", i === index ? "bg-cream" : "bg-cream/25")}
              style={{ height: Math.max(2, Math.round(s * 24)) }}
            />
          ))}
        </div>
        <div aria-hidden className="absolute inset-x-0 top-[30px] h-[3px] rounded-full bg-line" />
        <div aria-hidden className="absolute left-0 top-[30px] h-[3px] rounded-full bg-cream/40" style={{ width: `${pct(index)}%` }} />
        <div
          aria-hidden
          className="absolute top-[19px] h-6 w-[14px] -translate-x-1/2 rounded-hz bg-orange shadow-chunk-sm"
          style={{ left: `${pct(index)}%` }}
        />
        {/* Printed times. They sit inside the slider on purpose: a tap anywhere on a label is a tap on
            the track, so every one of them is a full 44px target and there are no buttons in a slider. */}
        {ticks.map((t) => (
          <span
            key={t.i}
            aria-hidden
            className={clsx(
              "pointer-events-none absolute top-11 flex h-7 -translate-x-1/2 items-center font-mono text-[10px] tracking-[0.08em]",
              t.i === index ? "text-cream" : "text-dim"
            )}
            style={{ left: `${pct(t.i)}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </section>
  );
}
