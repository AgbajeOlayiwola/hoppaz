"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Info, X } from "lucide-react";
import { factLine, stubPill } from "@/components/today/helpers";
import { demoFlyer } from "@/components/event/demo";
import { eventTitle } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { EventRow } from "@/lib/types";

type Decision = "in" | "pass";
type Saved = void | string | null | Promise<void | string | null>;

/** How far a drag has to go to count, px. A fast flick counts sooner. */
const THRESHOLD = 110;
const FLICK = 0.6; // px per ms
/** The instruction line shows until you have swiped once. */
const HINT_KEY = "hoppaz.swipeHint";

/**
 * The Discover deck, Bumble style: one big card at a time, the flyer filling
 * it. Right is WE OUTSIDE (you're going), left is nah. The buttons underneath
 * and the arrow keys do everything a drag does.
 *
 * onDecide saves the choice (Discover wires it to useGoing.decide). Hand back
 * an error message, or throw, and the card comes back so nothing is lost.
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
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const last = useRef<{ x: number; t: number } | null>(null);

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
    }, 220);
};

  // Arrow keys, for anyone on a laptop. The ref always holds this render's commit.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") commitRef.current("in");
      if (e.key === "ArrowLeft") commitRef.current("pass");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!top) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="font-display text-[22px] font-black">That&apos;s the lot.</p>
          <p className="hint mx-auto mt-1.5 max-w-[30ch]">You&apos;ve been through everything on this day.</p>
          {onDone && (
            <button type="button" onClick={onDone} className="btn mt-5 px-5 text-[12.5px]">
              SEE THE LIST
            </button>
          )}
        </div>
      </div>
    );
  }

  const countOf = (e: EventRow) => (goingOf ? goingOf(e) : (e.swipes_in ?? 0));
  const intent: Decision | null = leaving ?? (drag.dx > 56 ? "in" : drag.dx < -56 ? "pass" : null);
  const offX = leaving ? (leaving === "in" ? 640 : -640) : drag.dx;
  const spin = leaving ? (leaving === "in" ? 14 : -14) : drag.dx / 18;
  // The card behind rises to meet you as the top one goes.
  const pull = Math.min(1, Math.abs(offX) / THRESHOLD);

  return (
    <div className="relative flex h-full select-none flex-col">
      <div className="relative mx-auto min-h-0 w-full max-w-md flex-1">
        {next && (
          <div
            aria-hidden
            className="absolute inset-0 transition-transform duration-200"
            style={{ transform: `scale(${0.94 + 0.06 * pull}) translateY(${10 - 10 * pull}px)`, opacity: 0.6 + 0.4 * pull }}
          >
            <CardFace event={next} drop={!!dropIds?.has(next.id)} count={countOf(next)} />
          </div>
        )}

        <div
          className="absolute inset-0 touch-none motion-reduce:!transition-none"
          style={{
            transform: `translate(${offX}px, ${leaving ? -30 : drag.dy}px) rotate(${spin}deg)`,
            transformOrigin: "50% 110%",
            transition: drag.active ? "none" : "transform .22s cubic-bezier(.2,.8,.2,1)",
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button,a")) return;
            start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
            last.current = { x: e.clientX, t: performance.now() };
            setDrag({ dx: 0, dy: 0, active: true });
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            last.current = { x: e.clientX, t: performance.now() };
            setDrag({ dx: e.clientX - start.current.x, dy: (e.clientY - start.current.y) * 0.3, active: true });
          }}
          onPointerUp={(e) => {
            const s = start.current;
            if (!s) return;
            start.current = null;
            const dx = e.clientX - s.x;
            const speed = dx / Math.max(1, performance.now() - s.t);
            if (dx > THRESHOLD || (dx > 50 && speed > FLICK)) commit("in");
            else if (dx < -THRESHOLD || (dx < -50 && speed < -FLICK)) commit("pass");
            else setDrag({ dx: 0, dy: 0, active: false });
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag({ dx: 0, dy: 0, active: false });
          }}
        >
          <CardFace event={top} drop={!!dropIds?.has(top.id)} count={countOf(top)} intent={intent} strength={pull} />
        </div>
      </div>

      {/* Controls: the deck must be usable without dragging. */}
      <div className="mx-auto w-full max-w-md flex-none pb-3 pt-4">
        {hint && <p className="hint mb-3 text-center">Swipe right if we outside. Left if it&apos;s a nah.</p>}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => commit("pass")}
            aria-label={`Nah to ${eventTitle(top)}`}
            className="grid h-16 w-16 flex-none place-items-center rounded-full border-2 border-line bg-ink-2 text-cream transition-transform active:scale-90"
          >
            <X size={28} strokeWidth={2.6} aria-hidden />
          </button>
          {onInfo && (
            <button
              type="button"
              onClick={() => onInfo(top)}
              aria-label="More about this one"
              className="grid h-12 w-12 flex-none place-items-center rounded-full border border-line bg-ink-2 text-dim transition-transform active:scale-90"
            >
              <Info size={19} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => commit("in")}
            aria-label={`We outside: going to ${eventTitle(top)}`}
            className="flex h-16 flex-none items-center rounded-full bg-orange px-7 font-display text-[16px] font-black tracking-[0.02em] text-brand-ink shadow-chunk transition-transform active:translate-y-0.5 active:scale-95 active:shadow-chunk-sm"
          >
            WE OUTSIDE
          </button>
        </div>
      </div>
    </div>
  );
}

/** A flyer the browser may load: http(s), or the sample flyers' inline SVG. */
function flyerOf(event: EventRow) {
  const f = demoFlyer(event);
  return f && /^(https?:|data:image\/)/i.test(f) ? f : null;
}

/**
 * One card: the flyer full bleed (or a type poster when there is none), the
 * facts over a dark fade at the bottom, and the stamp that lands as you drag.
 */
function CardFace({
  event,
  drop,
  count,
  intent,
  strength = 1,
}: {
  event: EventRow;
  drop: boolean;
  count: number;
  intent?: Decision | null;
  strength?: number;
}) {
  const theme = themeForEvent(event.starts_at);
  const pill = stubPill(event, { drop, count, includeGoing: false });
  const flyer = flyerOf(event);
  const title = eventTitle(event);

  return (
    <article
      className={clsx(
        "relative h-full w-full overflow-hidden rounded-[18px] border border-line bg-ink-2 shadow-[0_18px_40px_rgb(0_0_0/.45)]",
        theme === "day" ? "stub-day" : "stub-night"
      )}
      aria-label={title}
    >
      {flyer ? (
        // eslint-disable-next-line @next/next/no-img-element -- flyers come from anywhere, sizes unknown
        <img src={flyer} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Poster event={event} />
      )}

      {/* The facts, always cream on a dark fade so they read over any flyer (so night colours, even on a day card). */}
      <div className="stub-night absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-5 pb-5 pt-28 !text-[#F5EBDD]">
        {pill && <span className={clsx("pill mb-2.5 bg-black/40", pill.cls)}>{pill.text}</span>}
        <h2 className="font-display text-[30px] font-black leading-[1.02] tracking-[-0.01em] [text-wrap:balance]">{title}</h2>
        <p className="mt-2 font-mono text-[11.5px] font-medium uppercase leading-snug tracking-[0.04em] text-[#F5EBDD]/75">
          {factLine(event, Date.now())}
        </p>
        <p className="mt-3 font-body text-[14px] font-medium">
          {count > 0 ? (
            <>
              <span className="font-display text-[18px] font-black text-orange">{count}</span> going
            </>
          ) : (
            "Be the first to say we outside"
          )}
          {event.venue_name ? <span className="text-[#F5EBDD]/60"> · {event.venue_name}</span> : null}
        </p>
      </div>

      {/* The stamps: WE OUTSIDE top left as you drag right, NAH top right as you drag left. */}
      {intent && (
        <span
          key={intent}
          className={clsx(
            "pointer-events-none absolute top-6 z-10 animate-stamp rounded-[6px] border-[3px] bg-black/70 px-3 py-1.5 font-display text-[24px] font-black tracking-[0.06em]",
            intent === "in" ? "left-5 -rotate-12 border-[#2FD35C] text-[#2FD35C]" : "right-5 rotate-12 border-[#E5484D] text-[#E5484D]"
          )}
          style={{ opacity: Math.max(0.35, strength) }}
        >
          {intent === "in" ? "WE OUTSIDE" : "NAH"}
        </span>
      )}
    </article>
  );
}

/** No flyer: a poster in the Hoppaz style, the orange sun behind the night's vibe. */
function Poster({ event }: { event: EventRow }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-3">
      <span aria-hidden className="absolute -right-16 top-10 h-64 w-64 rounded-full bg-orange" />
      <span aria-hidden className="absolute -left-10 top-48 h-40 w-40 rounded-full border-[10px] border-violet opacity-70" />
      <p
        aria-hidden
        className="absolute left-5 top-8 max-w-[85%] font-display text-[64px] font-black uppercase leading-[0.85] tracking-[-0.03em] text-cream/90 [overflow-wrap:anywhere]"
      >
        {event.vibe}
      </p>
    </div>
  );
}
