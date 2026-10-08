"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Info } from "lucide-react";
import { factLine, notchAbove, stubPill } from "@/components/today/helpers";
import { eventTitle } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { EventRow } from "@/lib/types";

type Decision = "in" | "pass";
type Saved = void | string | null | Promise<void | string | null>;

const THRESHOLD = 110;
/** The instruction line shows until you have swiped once. */
const HINT_KEY = "hoppaz.swipeHint";
const FOOT = 92;
const NOTCH = notchAbove(FOOT);

/**
 * "Can't decide? Swipe": one compact ticket stub at a time. Right means
 * you're going, left means nah. It is a mode on the Today tab, not the main
 * list, and the buttons underneath do everything a drag does.
 *
 * onDecide saves the choice (Today wires it to useGoing.decide). Hand back an
 * error message, or throw, and the card comes back so nothing is lost.
 */
export default function SwipeDeck({
  events,
  onDecide,
  onInfo,
  onDone,
  dropIds,
  goingOf,
}: {
  events: EventRow[];
  /** Older callers pass this. The cards no longer print distance, so it is ignored. */
  fix?: { lat: number; lng: number; area: string | null } | null;
  onDecide: (event: EventRow, decision: Decision) => Saved;
  /** The info button opens the event page. Without it the button is left out. */
  onInfo?: (event: EventRow) => void;
  /** Shown on the "that's the lot" card as a way back to the list. */
  onDone?: () => void;
  /** Events that have a drop (a violet pill). */
  dropIds?: ReadonlySet<string>;
  /** The going count to print for an event; defaults to the loaded number. */
  goingOf?: (event: EventRow) => number;
}) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [leaving, setLeaving] = useState<Decision | null>(null);
  // Cards you have just swiped, hidden at once so the deck never waits on the network.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hint, setHint] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      setHint(!localStorage.getItem(HINT_KEY));
    } catch {
      setHint(true);
    }
  }, []);

  const stack = events.filter((e) => !hidden.has(e.id));
  const top = stack[0];
  const next = stack[1];

  const commit = (decision: Decision) => {
    if (!top || leaving) return;
    const event = top;
    setLeaving(decision);
    // Let the card clear the screen before the next one takes its place.
    window.setTimeout(async () => {
      setHidden((h) => new Set(h).add(event.id));
      setLeaving(null);
      setDrag({ dx: 0, dy: 0, active: false });
      setHint(false);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* private mode: the line simply shows again next time */
      }
      let failed = false;
      try {
        const res = await onDecide(event, decision);
        failed = typeof res === "string" && res.length > 0;
      } catch {
        failed = true;
      }
      if (failed) {
        setHidden((h) => {
          const n = new Set(h);
          n.delete(event.id);
          return n;
        });
      }
    }, 190);
  };

  if (!top) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="font-display text-[22px] font-black">That&apos;s the lot.</p>
          <p className="hint mx-auto mt-1.5 max-w-[30ch]">You&apos;ve been through everything on this day.</p>
          {onDone && (
            <button type="button" onClick={onDone} className="btn mt-5 px-5 text-[12.5px]">
              BACK TO THE LIST
            </button>
          )}
        </div>
      </div>
    );
  }

  const countOf = (e: EventRow) => (goingOf ? goingOf(e) : (e.swipes_in ?? 0));
  const intent: Decision | null = leaving ?? (drag.dx > 56 ? "in" : drag.dx < -56 ? "pass" : null);
  const offX = leaving ? (leaving === "in" ? 520 : -520) : drag.dx;
  const spin = leaving ? (leaving === "in" ? 6 : -6) : drag.dx / 30;

  return (
    <div className="relative flex h-full select-none flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative w-full max-w-md">
          {/* the card behind, so the deck has depth */}
          {next && (
            <div aria-hidden className="absolute inset-x-0 top-0 translate-y-2 scale-[0.96] opacity-50">
              <CardFace event={next} drop={!!dropIds?.has(next.id)} count={countOf(next)} />
            </div>
          )}

          <div
            className="relative touch-none motion-reduce:!transition-none"
            style={{
              transform: `translate(${offX}px, ${leaving ? -24 : drag.dy}px) rotate(${spin}deg)`,
              transition: drag.active ? "none" : "transform .19s cubic-bezier(.2,.8,.2,1)",
              opacity: leaving ? 0.2 : 1,
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button,a")) return;
              start.current = { x: e.clientX, y: e.clientY };
              setDrag({ dx: 0, dy: 0, active: true });
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              setDrag({
                dx: e.clientX - start.current.x,
                dy: (e.clientY - start.current.y) * 0.35,
                active: true,
              });
            }}
            onPointerUp={() => {
              if (!start.current) return;
              const { dx } = drag;
              start.current = null;
              if (dx > THRESHOLD) commit("in");
              else if (dx < -THRESHOLD) commit("pass");
              else setDrag({ dx: 0, dy: 0, active: false });
            }}
            onPointerCancel={() => {
              start.current = null;
              setDrag({ dx: 0, dy: 0, active: false });
            }}
          >
            <CardFace event={top} drop={!!dropIds?.has(top.id)} count={countOf(top)} intent={intent} />
          </div>
        </div>
      </div>

      {/* Controls: the deck must be usable without dragging. */}
      <div className="mx-auto w-full max-w-md flex-none pb-3 pt-1">
        {hint && (
          <p className="hint mb-2.5 text-center">Drag right if you&apos;re going. Left if you&apos;re not.</p>
        )}
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => commit("pass")} className="btn btn-ghost flex-1 px-3 text-[12.5px]">
            NAH
          </button>
          {onInfo && (
            <button
              type="button"
              onClick={() => onInfo(top)}
              aria-label="More about this one"
              className="btn btn-ghost w-11 flex-none px-0"
            >
              <Info size={18} aria-hidden />
            </button>
          )}
          <button type="button" onClick={() => commit("in")} className="btn flex-1 px-3 text-[12.5px]">
            I&apos;M GOING
          </button>
        </div>
      </div>
    </div>
  );
}

/** A compact stub: the title, one mono line, one pill, and the going count as a number. */
function CardFace({
  event,
  drop,
  count,
  intent,
}: {
  event: EventRow;
  drop: boolean;
  count: number;
  intent?: Decision | null;
}) {
  const theme = themeForEvent(event.starts_at);
  const pill = stubPill(event, { drop, count, includeGoing: false });

  return (
    <div
      className={clsx("stub relative overflow-hidden", theme === "day" ? "stub-day" : "stub-night")}
      style={NOTCH}
    >
      {/* The stamp that lands as you drag: 180ms, a degree off square, no bounce. */}
      {intent && (
        <span
          key={intent}
          className={clsx(
            "pointer-events-none absolute top-4 z-10 animate-stamp rounded-[4px] border-2 px-2.5 py-1 font-display text-[15px] font-black tracking-[0.08em]",
            intent === "in" ? "left-4 border-keke text-keke" : "right-4 border-dim text-dim"
          )}
        >
          {intent === "in" ? "GOING" : "NAH"}
        </span>
      )}

      <div className="px-5 pb-6 pt-14">
        <h2 className="font-display text-[28px] font-black leading-[1.05] tracking-[-0.01em]">{eventTitle(event)}</h2>
        <p className="mt-2.5 font-mono text-[11.5px] font-medium uppercase leading-snug tracking-[0.04em] text-dim">
          {factLine(event, Date.now())}
        </p>
      </div>

      <div
        className="flex items-center justify-between gap-3 border-t border-dashed border-line px-5"
        style={{ height: FOOT }}
      >
        {count > 0 ? (
          <div>
            <p className="num text-[36px]">{count}</p>
            <p className="seclabel mt-1.5">GOING</p>
          </div>
        ) : (
          <p className="seclabel">BE THE FIRST</p>
        )}
        {pill && <span className={clsx("pill", pill.cls)}>{pill.text}</span>}
      </div>
    </div>
  );
}
