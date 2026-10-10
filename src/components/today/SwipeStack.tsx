"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Check, X } from "lucide-react";

/**
 * The Today deck, Tinder and Bumble style: one big card on top, the next two
 * stacked behind it. Drag the top card right and it stamps WE OUTSIDE (you're
 * interested in going), drag it left and it stamps NAH. Either way the card goes
 * to the back of the pile and comes round again, so the deck never runs out.
 * The buttons underneath and the arrow keys do everything a drag does, and a
 * tap on the top card opens the breakdown.
 *
 * The page owns the pile (which card is on top, what has gone to the back); this
 * only moves cards. A drag writes transform and opacity straight onto the
 * elements, so React never re-renders while a finger is down. The card that
 * leaves is drawn once more as a "flyer" that carries on off the screen, so the
 * pile can change at once underneath it.
 *
 * `onPos` gets how far the top card has gone, 0 to 1, every frame, so the glow
 * behind can blend towards the next card's colours as you drag.
 */

export type SwipeDir = "in" | "pass";
/** Which way is going. Right, as on Tinder and Bumble. Flip to -1 to make left the going side. */
const IN_SIDE = 1;

/** How far a drag has to go to count, as a share of the card's width. A fast flick counts sooner. */
const THRESHOLD = 0.32;
const FLICK = 0.55; // px per ms
/** Where a drag starts (px), so a tap with a shaky thumb is still a tap. */
const SLOP = 6;
const MAX_CARD = 380;
/** The cards drawn: the top one and two behind it. */
const DRAWN = 3;
const FLY_MS = 300;
/** Below this card width (px) a card uses its short wording. */
const NARROW = 244;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.2,.8,.2,1)";

/** Where a card behind the top one rests: a little smaller, a little lower. */
function rest(depth: number) {
  const d = Math.min(depth, DRAWN - 1);
  return { y: d * 14, sc: 1 - d * 0.05, op: d >= DRAWN - 1 ? 0.55 : 1 };
}
const poseCss = (p: { y: number; sc: number }) => `translate3d(0,${p.y}px,0) scale(${p.sc})`;

export type StackApi = { swipe: (dir: SwipeDir) => void };
export type SlideState = { active: boolean; near: boolean; narrow: boolean };

export default function SwipeStack({
  ids,
  onSwipe,
  onOpen,
  slide,
  label,
  onPos,
  lead,
  api,
  keys = true,
}: {
  /** The pile, top first. Only the first three are drawn. */
  ids: string[];
  /** A card was swiped away. The page moves it (out of the round, or to the back). */
  onSwipe: (id: string, dir: SwipeDir) => void;
  /** The top card was tapped. */
  onOpen: () => void;
  slide: (id: string, s: SlideState) => ReactNode;
  /** What a screen reader hears for the top card's button. */
  label: (id: string) => string;
  /** Called every frame with how far the top card has gone (0 to 1). Must not set React state. */
  onPos?: (pos: number) => void;
  /** A control for the left of the row under the deck (Share to story). */
  lead?: ReactNode;
  /** Lets the page swipe the top card itself (?demo=1). */
  api?: MutableRefObject<StackApi | null>;
  /** Arrow keys swipe. Off while something sits on top of the deck. */
  keys?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const stamps = useRef<{ in: HTMLSpanElement | null; pass: HTMLSpanElement | null }>({ in: null, pass: null });
  const [cw, setCw] = useState(0);
  const cwRef = useRef(300);
  const top = ids[0] ?? null;
  const topRef = useRef(top);
  const onSwipeRef = useRef(onSwipe);
  const onPosRef = useRef(onPos);
  useEffect(() => {
    topRef.current = top;
    onSwipeRef.current = onSwipe;
    onPosRef.current = onPos;
  });

  /** The card that has just been swiped, carrying on off the screen above the pile. */
  const [flyer, setFlyer] = useState<{ id: string; dir: SwipeDir; x: number; y: number; n: number; text: string } | null>(null);
  /** A card that was on top a moment ago: when it shows up again in the pile it fades in at the back, not slides across. */
  const justLeft = useRef<string | null>(null);
  const blockClick = useRef(false);

  /* ------------------------------------------------------------ measure -- */
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const next = Math.round(Math.max(200, Math.min(w - 40, h * 0.66, MAX_CARD)));
      cwRef.current = next;
      el.style.setProperty("--cw", `${next}px`);
      setCw((c) => (c === next ? c : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --------------------------------------------------------------- draw -- */
  /** The WE OUTSIDE or NAH stamp, faded in with the drag. `v` is -1 to 1 (signed share of the threshold). */
  const setStamp = useCallback((v: number) => {
    const going = Math.sign(v) === IN_SIDE;
    const a = Math.min(1, Math.abs(v));
    if (stamps.current.in) stamps.current.in.style.opacity = going ? a.toFixed(3) : "0";
    if (stamps.current.pass) stamps.current.pass.style.opacity = !going ? a.toFixed(3) : "0";
  }, []);

  /** Put every card in its resting place. The one that just left comes back in at the back without a slide. */
  const settle = useCallback((animate: boolean) => {
    ids.slice(0, DRAWN).forEach((id, depth) => {
      const el = els.current.get(id);
      if (!el) return;
      const p = rest(depth);
      if (id === justLeft.current) {
        el.style.transition = "none";
        el.style.transform = poseCss(rest(depth + 1));
        el.style.opacity = "0";
        void el.offsetWidth;
      }
      el.style.transition = animate && !reduced() ? `transform .28s ${EASE}, opacity .28s ease` : "none";
      el.style.transform = poseCss(p);
      el.style.opacity = String(p.op);
      el.style.zIndex = String(50 - depth);
    });
    justLeft.current = null;
    setStamp(0);
    onPosRef.current?.(0);
  }, [ids, setStamp]);

  useLayoutEffect(() => settle(true), [settle]);
  const settleRef = useRef(settle);
  useLayoutEffect(() => {
    settleRef.current = settle;
  });

  /** Draw the top card at a drag of dx, dy, and the card behind it rising to meet you. */
  const follow = (dx: number, dy: number) => {
    const id = topRef.current;
    if (!id) return;
    const el = els.current.get(id);
    const w = cwRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0) rotate(${(dx / 18).toFixed(2)}deg)`;
    }
    const f = Math.min(1, Math.abs(dx) / (w * THRESHOLD));
    const behind = ids[1] ? els.current.get(ids[1]) : null;
    if (behind) {
      const a = rest(1);
      behind.style.transition = "none";
      behind.style.transform = poseCss({ y: a.y * (1 - f), sc: a.sc + (1 - a.sc) * f });
    }
    setStamp((dx / (w * THRESHOLD)) || 0);
    onPosRef.current?.(Math.min(1, Math.abs(dx) / w));
  };

  /** Send the top card off the screen and hand it to the page. */
  const commit = useCallback(
    (dir: SwipeDir, from = { x: 0, y: 0 }) => {
      const id = topRef.current;
      if (!id || flyer) return;
      justLeft.current = id;
      setFlyer({ id, dir, x: from.x, y: from.y, n: Date.now(), text: dir === "pass" ? "NAH" : "WE OUTSIDE" });
      onSwipeRef.current(id, dir);
    },
    [flyer]
  );

  useEffect(() => {
    if (!api) return;
    api.current = { swipe: (dir) => commit(dir) };
    return () => {
      api.current = null;
    };
  }, [api, commit]);

  // The flyer: start where the finger let go, then carry on out the side it was going.
  const flyEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = flyEl.current;
    if (!flyer || !el) return;
    const side = flyer.dir === "in" ? IN_SIDE : -IN_SIDE;
    el.style.transition = "none";
    el.style.transform = `translate3d(${flyer.x}px,${flyer.y}px,0) rotate(${flyer.x / 18}deg)`;
    void el.offsetWidth;
    const out = (stage.current?.clientWidth ?? 400) / 2 + cwRef.current;
    el.style.transition = reduced() ? "none" : `transform ${FLY_MS}ms ${EASE}, opacity ${FLY_MS}ms ease`;
    el.style.transform = `translate3d(${side * out}px,${flyer.y - 30}px,0) rotate(${side * 16}deg)`;
    el.style.opacity = reduced() ? "0" : "0.9";
    // The pile may not have changed (one card, passed): bring the top card back in either way.
    settleRef.current(true);
    const t = setTimeout(() => setFlyer(null), reduced() ? 0 : FLY_MS);
    return () => clearTimeout(t);
  }, [flyer]);

  /* --------------------------------------------------------------- keys -- */
  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      const right = e.key === "ArrowRight";
      commit(right === (IN_SIDE === 1) ? "in" : "pass");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, commit]);

  /* --------------------------------------------------------------- drag -- */
  const drag = useRef<{ id: number; x: number; y: number; t: number; live: boolean; dx: number; dy: number; trail: Array<{ t: number; x: number }> } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!topRef.current || flyer) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), live: false, dx: 0, dy: 0, trail: [] };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.live) {
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy)) return;
      // From here the finger owns the card.
      d.live = true;
      blockClick.current = true;
      try {
        stage.current?.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
    }
    d.dx = dx;
    d.dy = dy * 0.3;
    follow(d.dx, d.dy);
    const now = performance.now();
    d.trail.push({ t: now, x: e.clientX });
    while (d.trail.length > 2 && now - d.trail[0].t > 110) d.trail.shift();
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.live) return;
    setTimeout(() => (blockClick.current = false), 60);
    const first = d.trail[0];
    const last = d.trail[d.trail.length - 1];
    const span = first && last ? last.t - first.t : 0;
    const stale = performance.now() - (last?.t ?? 0) > 90;
    const v = !stale && span > 12 ? (last.x - first.x) / span : 0;
    const far = Math.abs(d.dx) > cwRef.current * THRESHOLD;
    const flick = Math.abs(d.dx) > 40 && Math.abs(v) > FLICK && Math.sign(v) === Math.sign(d.dx);
    if (far || flick) commit(Math.sign(d.dx) === IN_SIDE ? "in" : "pass", { x: d.dx, y: d.dy });
    else settle(true);
  };

  const press = () => {
    if (blockClick.current) return;
    onOpen();
  };

  const drawn = ids.slice(0, DRAWN);
  const narrow = cw > 0 && cw < NARROW;
  const goSide = IN_SIDE === 1 ? "right" : "left";
  const passBtn = (
    <RoundButton key="pass" kind="pass" disabled={!top || !!flyer} onClick={() => commit("pass")} label="Nah. It comes round again." />
  );
  const inBtn = (
    <RoundButton
      key="in"
      kind="in"
      disabled={!top || !!flyer}
      onClick={() => commit("in")}
      label="We outside. You're interested in going."
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={stage}
        role="group"
        aria-roledescription="card stack"
        aria-label={`Events. Swipe ${goSide} if you're going, the other way to see it later.`}
        data-intro="deck"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDragStart={(e) => e.preventDefault()}
        className="relative min-h-0 flex-1 cursor-grab select-none overflow-x-clip active:cursor-grabbing"
        style={{ touchAction: "pan-y" }}
      >
        {/* Drawn back to front, so the top card is last. Each card keeps its element (keyed by event) as it moves up the pile. */}
        {[...drawn].reverse().map((id) => {
          const depth = drawn.indexOf(id);
          const active = depth === 0;
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) els.current.set(id, el);
                else els.current.delete(id);
              }}
              aria-hidden={!active}
              className="absolute bottom-6 top-3"
              style={{
                left: "calc(50% - var(--cw, 300px) / 2)",
                width: "var(--cw, 300px)",
                transformOrigin: "50% 100%",
                willChange: "transform, opacity",
                pointerEvents: active ? undefined : "none",
              }}
            >
              {active && (
                <button
                  type="button"
                  aria-label={label(id)}
                  onClick={press}
                  className="absolute inset-0 z-10 rounded-[22px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
                />
              )}
              {slide(id, { active, near: true, narrow })}
              {active && (
                <>
                  <Stamp refFn={(el) => (stamps.current.in = el)} kind="in" text="WE OUTSIDE" />
                  <Stamp refFn={(el) => (stamps.current.pass = el)} kind="pass" text="NAH" />
                </>
              )}
            </div>
          );
        })}

        {flyer && (
          <div
            key={flyer.n}
            ref={flyEl}
            aria-hidden
            className="pointer-events-none absolute bottom-6 top-3 z-[60]"
            style={{ left: "calc(50% - var(--cw, 300px) / 2)", width: "var(--cw, 300px)", transformOrigin: "50% 100%" }}
          >
            {slide(flyer.id, { active: true, near: true, narrow })}
            <Stamp kind={flyer.dir} text={flyer.text} shown />
          </div>
        )}
      </div>

      {/* Kept to about the width of the deck, so on a wide screen the buttons stay with the cards instead of the corners. */}
      <div className={`mx-auto flex w-full max-w-[460px] flex-none items-center gap-2 px-4 pb-1 pt-1.5 ${lead ? "justify-between" : "justify-center"}`}>
        {lead}
        <div className="flex items-center gap-3">{IN_SIDE === 1 ? [passBtn, inBtn] : [inBtn, passBtn]}</div>
      </div>
    </div>
  );
}

/** The stamp that lands on the card as you drag: WE OUTSIDE in green on the going side, NAH in red on the other. */
function Stamp({ kind, text, refFn, shown }: { kind: SwipeDir; text: string; refFn?: (el: HTMLSpanElement | null) => void; shown?: boolean }) {
  // The stamp sits on the side the card is leaving from, top corner, tilted away from the middle.
  const onLeft = (kind === "in") === (IN_SIDE === 1);
  return (
    <span
      ref={refFn}
      aria-hidden
      className={`pointer-events-none absolute top-14 z-30 rounded-[6px] border-[3px] bg-black/70 px-3 py-1.5 font-display text-[22px] font-black tracking-[0.06em] ${
        onLeft ? "left-5 -rotate-12" : "right-5 rotate-12"
      } ${kind === "in" ? "border-[#2FD35C] text-[#2FD35C]" : "border-[#E5484D] text-[#E5484D]"}`}
      style={{ opacity: shown ? 1 : 0 }}
    >
      {text}
    </span>
  );
}

/** Nah: an outlined circle with a cross. Going: solid orange with a tick, the same orange as the rest of the deck's buttons. */
function RoundButton({ kind, disabled, onClick, label }: { kind: SwipeDir; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="grid h-14 w-14 place-items-center">
      {kind === "pass" ? (
        <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-line bg-ink-2/80 text-cream transition-transform active:scale-90 [button:disabled_&]:text-dim">
          <X size={22} strokeWidth={2.8} aria-hidden />
        </span>
      ) : (
        <span className="grid h-12 w-12 place-items-center rounded-full bg-orange text-brand-ink shadow-[0_2px_0_theme(colors.orange.ember)] transition-transform active:translate-y-px active:scale-95 [button:disabled_&]:bg-line [button:disabled_&]:text-dim [button:disabled_&]:shadow-none">
          <Check size={22} strokeWidth={3} aria-hidden />
        </span>
      )}
    </button>
  );
}
