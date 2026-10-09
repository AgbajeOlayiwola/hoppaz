"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useViewport } from "./useViewport";

/**
 * The card deck: big cards in a row, one centred, the neighbours peeking on
 * both sides and tilted back in 3D (turned towards the middle, pushed away,
 * smaller, dimmed), so the row reads as a fan of tickets.
 *
 * It is built for 60 fps. One number, `pos` (which card is in the middle, as a
 * fraction), drives everything. Each frame writes only transform and opacity
 * straight onto the card elements, so React never re-renders while a finger is
 * down or a card is settling. A drag follows the finger, lets go with the
 * finger's speed, and a spring carries it to the nearest card.
 *
 * The same number is handed to `onPos` every frame, so the screen behind the
 * deck can cross-fade to each event's colours as the cards slide.
 *
 * Touch swipes (pan-y, so the page still scrolls up and down), mouse drags,
 * trackpad swipes, the arrow keys and the two orange circle buttons all end up
 * in the same `go`.
 */

/** Spring for the settle: a touch under critically damped, so it lands softly. */
const STIFFNESS = 190;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.9;
/** Cards past this many places from the middle are not drawn (they have faded out by two places). */
const DRAWN = 2.2;
const MAX_CARD = 380;
/** Where a drag turns into a swipe (px), so a tap with a shaky thumb is still a tap. */
const SLOP = 6;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `narrow`: the cards are small (under NARROW px wide), so a card should use its short wording. */
export type SlideState = { active: boolean; near: boolean; narrow: boolean };

/** Below this card width (px) the card's text has to shorten: Paz's tour, or a short phone, squeezes the deck to this. */
const NARROW = 244;

export default function Deck({
  count,
  index,
  onIndex,
  onOpen,
  slide,
  label,
  keys = true,
  onPos,
  lead,
}: {
  count: number;
  /** The card in the middle. Change it from outside and the deck slides there. */
  index: number;
  onIndex: (i: number) => void;
  /** The centred card was tapped. */
  onOpen: (i: number) => void;
  slide: (i: number, s: SlideState) => ReactNode;
  /** What a screen reader hears for the card's button. */
  label: (i: number) => string;
  /** Arrow keys move the deck. Off while something sits on top of it. */
  keys?: boolean;
  /** Called every frame with where the deck is (a card index, as a fraction). Must not set React state. */
  onPos?: (pos: number) => void;
  /** A control for the left of the row under the deck (Share to story). */
  lead?: ReactNode;
}) {
  const { wide } = useViewport();
  const stage = useRef<HTMLDivElement>(null);
  const els = useRef<Array<HTMLDivElement | null>>([]);
  const parts = useRef<
    Array<{ dim: HTMLElement | null; top: HTMLElement | null; art: HTMLElement | null; sheen: HTMLElement | null; ttl: HTMLElement | null }>
  >([]);
  const geo = useRef({ cw: 280, step: 204 });
  const [box, setBox] = useState({ cw: 0 });

  // Motion state lives in a ref: it changes sixty times a second and nothing should re-render for it.
  const s = useRef({ pos: index, vel: 0, target: index, raf: 0, last: 0 });
  const reported = useRef(index);
  const onIndexRef = useRef(onIndex);
  const onPosRef = useRef(onPos);
  const countRef = useRef(count);
  const blockClick = useRef(false);

  useEffect(() => {
    onIndexRef.current = onIndex;
    onPosRef.current = onPos;
    countRef.current = count;
  });

  /* --------------------------------------------------------------- draw -- */
  const apply = useCallback((pos: number) => {
    const { cw, step } = geo.current;
    const k = cw / 260;
    const list = els.current;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (!el) continue;
      const u = i - pos;
      const a = Math.abs(u);
      if (a > DRAWN) {
        if (el.style.visibility !== "hidden") {
          el.style.visibility = "hidden";
          el.style.willChange = "auto";
        }
        continue;
      }
      if (el.style.visibility === "hidden") {
        el.style.visibility = "";
        el.style.willChange = "transform, opacity";
      }
      const side = u < 0 ? -1 : 1;
      // A neighbour sits one step away, turned to face the middle; the one behind it tucks in close and recedes.
      const x = side * (step * Math.min(a, 1) + step * 0.24 * Math.max(0, Math.min(a, 2) - 1));
      const z = -Math.min(a, 2) * 100 * k;
      const ry = clamp(-u * 44, -58, 58);
      const sc = 1 - 0.07 * Math.min(a, 2);
      const op = a <= 1.6 ? 1 : Math.max(0, 1 - (a - 1.6) * 2.2);
      el.style.transform = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
      el.style.opacity = op.toFixed(3);
      el.style.zIndex = String(100 - Math.round(a * 20));
      const p = parts.current[i];
      if (p) {
        // The flyer, the title and a glint slide at different speeds inside the card: that is the depth.
        if (p.art) p.art.style.transform = `translate3d(${(-u * 20 * k).toFixed(1)}px,0,0) scale(1.04)`;
        if (p.ttl) p.ttl.style.transform = `translate3d(${(-u * 40 * k).toFixed(1)}px,0,0)`;
        if (p.sheen) p.sheen.style.transform = `translate3d(${(-u * 190 * k).toFixed(1)}px,0,0)`;
        if (p.dim) p.dim.style.opacity = (Math.min(a, 1) * 0.5).toFixed(3);
        // The top row (countdown, WE OUTSIDE) lies outside the dimmed face, so it fades with it.
        if (p.top) p.top.style.opacity = (1 - Math.min(a, 1) * 0.5).toFixed(3);
      }
    }
    onPosRef.current?.(pos);
  }, []);

  /** Tell the page which card is in the middle, once per change. */
  const report = useCallback((i: number) => {
    const next = clamp(i, 0, Math.max(0, countRef.current - 1));
    if (next === reported.current) return;
    reported.current = next;
    onIndexRef.current(next);
  }, []);

  const loop = useCallback(
    (ts: number) => {
      const m = s.current;
      const dt = Math.min(0.034, m.last ? (ts - m.last) / 1000 : 0.016);
      m.last = ts;
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        m.vel += (-STIFFNESS * (m.pos - m.target) - DAMPING * m.vel) * h;
        m.pos += m.vel * h;
      }
      if (Math.abs(m.pos - m.target) < 0.0006 && Math.abs(m.vel) < 0.004) {
        m.pos = m.target;
        m.vel = 0;
        m.raf = 0;
        m.last = 0;
        apply(m.pos);
        return;
      }
      apply(m.pos);
      m.raf = requestAnimationFrame(loop);
    },
    [apply]
  );

  /** Carry the deck to card i. `vel` is the speed a swipe let go with, in cards a second. */
  const glide = useCallback(
    (i: number, vel = 0) => {
      const m = s.current;
      m.target = i;
      if (reduced()) {
        cancelAnimationFrame(m.raf);
        m.raf = 0;
        m.pos = i;
        m.vel = 0;
        apply(i);
        return;
      }
      // A long way off (a tag in the marquee): start a few cards short, so it still reads as a slide.
      if (Math.abs(m.pos - i) > 3) m.pos = i - Math.sign(i - m.pos) * 3;
      m.vel = vel;
      if (!m.raf) {
        m.last = 0;
        m.raf = requestAnimationFrame(loop);
      }
    },
    [apply, loop]
  );

  /** Move by n cards from wherever the deck is heading. */
  const go = useCallback(
    (n: number) => {
      const to = clamp(reported.current + n, 0, countRef.current - 1);
      if (to === reported.current) return;
      report(to);
      glide(to);
    },
    [glide, report]
  );

  /* ------------------------------------------------------------ measure -- */
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const cw = Math.round(Math.max(200, Math.min(w * 0.72, h * 0.64, MAX_CARD)));
      geo.current = { cw, step: cw * 0.73 };
      el.style.setProperty("--cw", `${cw}px`);
      setBox((b) => (b.cw === cw ? b : { cw }));
      apply(s.current.pos);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply]);

  // After every render: find the moving layers of any new cards and draw them where they belong.
  useLayoutEffect(() => {
    els.current.length = count;
    parts.current = els.current.map((el) => ({
      dim: el?.querySelector<HTMLElement>("[data-dim]") ?? null,
      top: el?.querySelector<HTMLElement>("[data-top]") ?? null,
      art: el?.querySelector<HTMLElement>("[data-art]") ?? null,
      sheen: el?.querySelector<HTMLElement>("[data-sheen]") ?? null,
      ttl: el?.querySelector<HTMLElement>("[data-ttl]") ?? null,
    }));
    apply(s.current.pos);
  });

  // The page moved the deck (a marquee tag, a new list): slide there. A change we reported ourselves is ignored.
  useEffect(() => {
    if (index === reported.current) return;
    reported.current = index;
    glide(clamp(index, 0, Math.max(0, count - 1)));
  }, [index, count, glide]);

  useEffect(() => {
    const m = s.current;
    return () => cancelAnimationFrame(m.raf);
  }, []);

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
      go(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, go]);

  /* --------------------------------------------------------------- drag -- */
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    from: number;
    anchorX: number;
    anchorPos: number;
    live: boolean;
    trail: Array<{ t: number; pos: number }>;
  } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const m = s.current;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: reported.current, anchorX: e.clientX, anchorPos: m.pos, live: false, trail: [] };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const m = s.current;
    if (!d.live) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
      // From here the finger owns the deck.
      d.live = true;
      blockClick.current = true;
      cancelAnimationFrame(m.raf);
      m.raf = 0;
      m.vel = 0;
      d.anchorX = e.clientX;
      d.anchorPos = m.pos;
      try {
        stage.current?.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
    }
    const last = countRef.current - 1;
    let raw = d.anchorPos - (e.clientX - d.anchorX) / geo.current.step;
    // Past either end the deck pulls back harder the further it is taken.
    if (raw < 0) raw *= 0.35;
    else if (raw > last) raw = last + (raw - last) * 0.35;
    m.pos = raw;
    apply(raw);
    report(Math.round(raw));
    const now = performance.now();
    d.trail.push({ t: now, pos: raw });
    while (d.trail.length > 2 && now - d.trail[0].t > 110) d.trail.shift();
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.live) return;
    const m = s.current;
    const first = d.trail[0];
    const lastSample = d.trail[d.trail.length - 1];
    const span = first && lastSample ? (lastSample.t - first.t) / 1000 : 0;
    // Cards a second, from the last tenth of a second of the drag. A finger that stopped before lifting carries nothing.
    const stale = performance.now() - (lastSample?.t ?? 0) > 90;
    const v = !stale && span > 0.012 ? (lastSample.pos - first.pos) / span : 0;
    const last = countRef.current - 1;
    let to = Math.round(m.pos + v * 0.24);
    // A short flick or a pull of a fifth of a card is enough to turn the page.
    if (to === d.from && (Math.abs(m.pos - d.from) > 0.2 || Math.abs(v) > 0.45)) {
      to = d.from + Math.sign(Math.abs(m.pos - d.from) > 0.2 ? m.pos - d.from : v);
    }
    to = clamp(to, Math.max(0, d.from - 3), Math.min(last, d.from + 3));
    report(to);
    glide(to, clamp(v, -9, 9));
    setTimeout(() => (blockClick.current = false), 60);
  };

  // A sideways swipe on a trackpad (or a tilt-wheel) turns one page, with a short rest so one swipe is one card.
  const wheelRest = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    const now = performance.now();
    if (now < wheelRest.current) return;
    wheelRest.current = now + 380;
    go(e.deltaX > 0 ? 1 : -1);
  };

  const press = (i: number) => {
    if (blockClick.current) return;
    if (i === reported.current) onOpen(i);
    else {
      report(i);
      glide(i);
    }
  };

  const atStart = index <= 0;
  const atEnd = index >= count - 1;
  const arrows = {
    prev: <Arrow dir="prev" disabled={atStart} onClick={() => go(-1)} />,
    next: <Arrow dir="next" disabled={atEnd} onClick={() => go(1)} />,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={stage}
        role="group"
        aria-roledescription="carousel"
        aria-label="Events"
        data-intro="deck"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onDragStart={(e) => e.preventDefault()}
        className="relative min-h-0 flex-1 cursor-grab select-none overflow-x-clip overscroll-x-contain active:cursor-grabbing"
        style={{ touchAction: "pan-y" }}
      >
        {/* The cards share one vanishing point, a little above the middle, so the row bends away from the eye. */}
        <div className="absolute inset-0" style={{ perspective: "1000px", perspectiveOrigin: "50% 46%" }}>
          {Array.from({ length: count }, (_, i) => {
            const active = i === index;
            return (
              <div
                key={i}
                ref={(el) => {
                  els.current[i] = el;
                }}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
                className="absolute bottom-1 top-3"
                style={{ left: "calc(50% - var(--cw, 280px) / 2)", width: "var(--cw, 280px)", transformOrigin: "50% 50%", willChange: "transform, opacity" }}
              >
                <button
                  type="button"
                  tabIndex={active ? 0 : -1}
                  aria-label={label(i)}
                  onClick={() => press(i)}
                  className="absolute inset-0 z-10 rounded-[22px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
                />
                {slide(i, { active, near: Math.abs(i - index) <= 2, narrow: box.cw > 0 && box.cw < NARROW })}
              </div>
            );
          })}
        </div>

        {/* Room to spare: the buttons sit in the empty ground either side of the cards. */}
        {wide && box.cw > 0 && (
          <>
            <div className="absolute top-1/2 z-[200] -translate-y-1/2" style={{ left: `max(8px, calc(50% - ${box.cw / 2 + 64}px))` }}>
              {arrows.prev}
            </div>
            <div className="absolute top-1/2 z-[200] -translate-y-1/2" style={{ right: `max(8px, calc(50% - ${box.cw / 2 + 64}px))` }}>
              {arrows.next}
            </div>
          </>
        )}
      </div>

      {/* Kept to about the width of the deck, so on a wide screen the buttons stay with the cards instead of the corners. */}
      <div className={`mx-auto flex w-full max-w-[460px] flex-none items-center gap-2 px-4 pb-1 pt-1.5 ${lead ? "justify-between" : "justify-center"}`}>
        {lead}
        <div className="flex items-center gap-1.5">
          {!wide && arrows.prev}
          <p aria-live="polite" className="min-w-[56px] text-center font-mono text-[13px] font-medium tracking-[0.1em] tabular-nums text-cream">
            {count ? index + 1 : 0} / {count}
          </p>
          {!wide && arrows.next}
        </div>
      </div>
    </div>
  );
}

/** Solid orange: it takes you to another card. Same button as the map's side card. */
function Arrow({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous event" : "Next event"}
      className="grid h-11 w-11 place-items-center"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-orange text-brand-ink shadow-[0_2px_0_theme(colors.orange.ember)] transition-transform active:translate-y-px [button:disabled_&]:bg-line [button:disabled_&]:text-dim [button:disabled_&]:shadow-none">
        <Icon size={20} strokeWidth={2.6} aria-hidden />
      </span>
    </button>
  );
}
