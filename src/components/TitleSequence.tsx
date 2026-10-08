"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Mascot from "./Mascot";
import Wordmark from "./Wordmark";

/**
 * The opening titles, after the Silicon Valley (HBO) intro: one long sideways
 * camera move across a flat illustrated city where buildings sprout out of the
 * ground, signs pop onto the roofs and swap, and a blimp drifts past. Here the
 * city is Lagos at night, mainland to Eko Atlantic, and the rooftop signs are
 * tonight's actual events. Ends on the wordmark.
 *
 * Pure SVG + CSS keyframes, no animation library. Each element's delay is
 * worked out from where it sits in the scene and the camera's easing, so
 * things grow exactly as they come into frame on any screen shape.
 *
 * About 4.5 seconds in all (START + PAN + a short hold on the lockup), a tap
 * anywhere skips it, and it ends on the wordmark with the mascot welcoming
 * you in. Motion is stamps, not springs: hard ease-out, no overshoot. The
 * timings below are handed to the CSS in globals.css (the "title sequence"
 * block) as custom properties, whose fallbacks match, so the two stay in step.
 * Reduced-motion users skip it entirely.
 */

const W = 3860; // front scene width, scene units: the pan ends with the last tower and its sign in frame
const BW = 3000; // back (parallax) layer width
const H = 900;
const GROUND = 720;
const START = 0.3; // s before the camera moves
const PAN = 3.4; // s of camera travel
const HOLD = 0.8; // s the finished lockup stays up before it fades
const END = START + PAN + HOLD; // 4.5 s
/** When the lockup lands: the wordmark first, then the tagline, then the mascot. */
const T_MARK = START + PAN - 0.55;

const C = {
  ink: "#0E0B0A",
  ink2: "#17110F",
  ink3: "#231915",
  line: "#2E211C",
  orange: "#FF4D00",
  ember: "#B83600",
  cream: "#F5EBDD",
};

const FALLBACK_SIGNS = ["SOUNDGARDEN", "LAUGHTER CAVE", "SHRINE FRIDAY", "ELEMENT", "SAILORS DECK", "JARA SUNDOWN", "FREEDOM PARK", "HARD ROCK"];

/** Small deterministic PRNG so the windows are the same every play. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

type Bld = { x: number; w: number; h: number; tone?: 0 | 1; glass?: boolean };

const MAINLAND: Bld[] = [
  { x: 40, w: 150, h: 170 },
  { x: 205, w: 110, h: 250, tone: 1 },
  { x: 330, w: 160, h: 140 },
  { x: 505, w: 120, h: 310, tone: 1 },
];
const ISLAND: Bld[] = [
  { x: 1960, w: 120, h: 400 },
  { x: 2095, w: 95, h: 520, tone: 1 },
  { x: 2205, w: 140, h: 360 },
  { x: 2360, w: 100, h: 450, tone: 1 },
];
const EKO: Bld[] = [
  { x: 3110, w: 110, h: 470, glass: true },
  { x: 3235, w: 140, h: 600, glass: true },
  { x: 3390, w: 100, h: 520, glass: true },
  { x: 3505, w: 150, h: 410, glass: true },
];

/** Rooftop billboards: which building, and the second name it flips to. */
const SIGN_SLOTS: Array<{ b: Bld; flip: boolean }> = [
  { b: MAINLAND[3], flip: false },
  { b: MAINLAND[1], flip: true },
  { b: ISLAND[1], flip: true },
  { b: ISLAND[3], flip: false },
  { b: EKO[1], flip: true },
  { b: EKO[3], flip: false },
];

export default function TitleSequence({ signs, onDone }: { signs: string[]; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  // The parent re-renders as events load; a ref keeps that from restarting the clock.
  const done = useRef(onDone);
  done.current = onDone;
  // The timer, a tap and a key can all land together: only the first counts.
  const gone = useRef(false);
  const finish = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    setLeaving(true);
    setTimeout(() => done.current(), 320);
  }, []);

  // Geometry of this screen: how much scene fits, and so where the camera goes.
  const [geo] = useState(() => {
    const vw = typeof window === "undefined" ? 390 : window.innerWidth;
    const vh = typeof window === "undefined" ? 844 : window.innerHeight;
    const scale = vh / H;
    const visible = vw / scale;
    return { scale, visible, travel: Math.max(0, W - visible), backTravel: Math.max(0, BW - visible) };
  });

  /** When the camera's right edge reaches scene x, under easeInOutSine. */
  const at = useCallback(
    (x: number, extra = 0) => {
      let t: number;
      if (x < geo.visible - 60) t = 0.1 + (x / geo.visible) * 0.25; // already in the first frame
      else {
        const p = Math.min(1, Math.max(0, (x + 60 - geo.visible) / (geo.travel || 1)));
        t = START + (PAN * Math.acos(1 - 2 * p)) / Math.PI;
      }
      return `${(t + extra).toFixed(2)}s`;
    },
    [geo]
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current();
      return;
    }
    const t = setTimeout(finish, END * 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [finish]);

  const names = useMemo(() => {
    // A billboard shows a whole name or none: a name too long for the board is skipped, never cut short.
    const clean = Array.from(new Set(signs.map((s) => s.toUpperCase().trim()).filter((s) => s && s.length <= 15)));
    return clean.length >= 4 ? clean : [...clean, ...FALLBACK_SIGNS.filter((s) => !clean.includes(s))];
  }, [signs]);

  const scenePx = (units: number) => units * geo.scale;
  const v = (d: string) => ({ "--d": d }) as React.CSSProperties;

  /* ------------------------------------------------------------ pieces -- */
  const building = (b: Bld, seed: number) => {
    const r = rng(seed);
    const top = GROUND - b.h;
    const fill = b.glass ? C.ink3 : b.tone ? C.line : C.ink3;
    const wins: React.ReactNode[] = [];
    if (b.glass) {
      for (let x = b.x + 14; x < b.x + b.w - 8; x += 16) {
        wins.push(<rect key={x} x={x} y={top + 18} width={3} height={b.h - 30} fill={C.cream} opacity={0.18} />);
      }
      wins.push(<rect key="cap" x={b.x} y={top} width={b.w} height={8} fill={C.orange} />);
    } else {
      for (let y = top + 18; y < GROUND - 28; y += 30) {
        for (let x = b.x + 12; x < b.x + b.w - 18; x += 22) {
          const n = r();
          if (n > 0.42) {
            wins.push(
              <rect key={`${x}-${y}`} x={x} y={y} width={10} height={14} fill={n > 0.92 ? C.orange : C.cream} opacity={n > 0.92 ? 1 : 0.75} />
            );
          }
        }
      }
    }
    return (
      <g key={b.x} className="ts-rise" style={v(at(b.x + b.w / 2))}>
        <rect x={b.x} y={top} width={b.w} height={b.h} fill={fill} />
        {wins}
      </g>
    );
  };

  const board = (text: string, cx: number, roof: number) => {
    const w = text.length * 15 + 34;
    return (
      <>
        <path d={`M${cx - w / 3} ${roof} V${roof - 22} M${cx + w / 3} ${roof} V${roof - 22}`} stroke={C.cream} strokeWidth={4} />
        <rect x={cx - w / 2} y={roof - 66} width={w} height={48} rx={4} fill={C.ember} />
        <rect x={cx - w / 2} y={roof - 72} width={w} height={48} rx={4} fill={C.cream} />
        <text x={cx} y={roof - 40} textAnchor="middle" fontFamily="var(--font-poppins)" fontWeight={900} fontSize={23} fill={C.ink}>
          {text}
        </text>
      </>
    );
  };

  const sign = (slot: (typeof SIGN_SLOTS)[number], i: number) => {
    const cx = slot.b.x + slot.b.w / 2;
    const roof = GROUND - slot.b.h;
    const first = names[i % names.length];
    const second = names[(i + SIGN_SLOTS.length) % names.length];
    const d = at(cx, 0.15);
    const d2 = at(cx, 0.85);
    if (!slot.flip || second === first) {
      return (
        <g key={i} className="ts-pop" style={v(d)}>
          {board(first, cx, roof)}
        </g>
      );
    }
    return (
      <g key={i}>
        <g className="ts-pop ts-flip-out" style={{ ...v(d), "--d2": d2 } as React.CSSProperties}>
          {board(first, cx, roof)}
        </g>
        <g className="ts-pop" style={v(d2)}>
          {board(second, cx, roof)}
        </g>
      </g>
    );
  };

  const water = (x: number, w: number) => {
    const r = rng(x);
    return (
      <g key={`w${x}`}>
        <rect x={x} y={GROUND} width={w} height={H - GROUND} fill={C.ink3} />
        {Array.from({ length: Math.floor(w / 46) }, (_, k) => (
          <rect
            key={k}
            x={x + 10 + k * 46 + r() * 20}
            y={GROUND + 24 + r() * 130}
            width={18 + r() * 22}
            height={3}
            rx={1.5}
            fill={C.cream}
            opacity={0.18}
          />
        ))}
      </g>
    );
  };

  /* ------------------------------------------------------------ render -- */
  const r = rng(7);
  const stars = Array.from({ length: 70 }, () => [r() * BW, r() * 520, r() * 2 + 1] as const);
  const farR = rng(11);
  const far: Array<[number, number, number]> = [];
  for (let x = 0; x < BW; x += 40 + farR() * 70) far.push([x, 40 + farR() * 60, 80 + farR() * 260]);

  const deck3M = 640;
  const deckLk = 650;
  const pylonX = 2780;

  return (
    <div
      className={`hz-night fixed inset-0 z-[60] overflow-hidden bg-ink transition-opacity duration-300 ${leaving ? "opacity-0" : "opacity-100"}`}
      role="dialog"
      aria-label="Hoppaz intro. Tap to skip."
      onClick={finish}
      style={
        {
          "--pan": `${-scenePx(geo.travel)}px`,
          "--pan-back": `${-scenePx(geo.backTravel)}px`,
          "--ts-start": `${START}s`,
          "--ts-pan": `${PAN}s`,
        } as React.CSSProperties
      }
    >
      {/* ------------------------------------------- back layer: parallax -- */}
      <svg
        className="ts-cam-back absolute left-0 top-0 h-full"
        style={{ width: scenePx(BW) }}
        viewBox={`0 0 ${BW} ${H}`}
        aria-hidden
      >
        {stars.map(([x, y, s], k) => (
          <circle key={k} cx={x} cy={y} r={s} fill={C.cream} opacity={0.5} />
        ))}
        {/* The moon over the mainland: a quiet cream disc (violet is kept for drops) */}
        <circle cx={geo.visible * 0.62} cy={230} r={84} fill={C.cream} opacity={0.88} />
        {far.map(([x, w, h], k) => (
          <rect key={k} x={x} y={GROUND - h} width={w} height={h} fill={C.ink2} />
        ))}
      </svg>

      {/* ------------------------------------------------- front layer ---- */}
      <svg
        className="ts-cam absolute left-0 top-0 h-full"
        style={{ width: scenePx(W) }}
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden
      >
        <rect x={0} y={GROUND} width={W} height={H - GROUND} fill={C.ink2} />
        <path d={`M0 ${GROUND + 70} H900 M1950 ${GROUND + 70} H2480 M3080 ${GROUND + 70} H3700`} stroke={C.cream} strokeWidth={4} strokeDasharray="34 30" opacity={0.25} />
        {water(900, 1050)}
        {water(2480, 600)}
        {water(3700, 300)}

        {/* Mainland: low blocks and the National Theatre's cap */}
        {MAINLAND.map((b, k) => building(b, 100 + k))}
        <g className="ts-rise" style={v(at(760))}>
          <path d={`M650 ${GROUND} V${GROUND - 70} H880 V${GROUND} Z`} fill={C.line} />
          <path d={`M630 ${GROUND - 70} L665 ${GROUND - 150} H865 L900 ${GROUND - 70} Z`} fill={C.ink3} />
          {Array.from({ length: 9 }, (_, k) => (
            <path key={k} d={`M${672 + k * 24} ${GROUND - 146} L${662 + k * 26} ${GROUND - 74}`} stroke={C.cream} strokeWidth={3} opacity={0.5} />
          ))}
          <rect x={630} y={GROUND - 78} width={270} height={8} fill={C.orange} />
        </g>

        {/* Third Mainland Bridge, with the bus on it */}
        <g className="ts-rise" style={v(at(1000))}>
          {Array.from({ length: 13 }, (_, k) => (
            <rect key={k} x={930 + k * 80} y={deck3M + 14} width={14} height={GROUND - deck3M + 20} fill={C.line} />
          ))}
          <rect x={900} y={deck3M} width={1060} height={18} fill={C.ink3} />
          <rect x={900} y={deck3M} width={1060} height={5} fill={C.orange} />
          {Array.from({ length: 27 }, (_, k) => (
            <circle key={k} cx={915 + k * 40} cy={deck3M - 26} r={4} fill={C.cream} opacity={0.6} />
          ))}
          {Array.from({ length: 27 }, (_, k) => (
            <rect key={k} x={913 + k * 40} y={deck3M - 22} width={3} height={22} fill={C.line} />
          ))}
        </g>
        <g className="ts-bus" style={v(at(1000, 0.1))}>
          <g transform={`translate(900 ${deck3M - 62})`}>
            <rect x={0} y={0} width={150} height={56} rx={12} fill={C.orange} />
            <rect x={0} y={42} width={150} height={8} fill={C.ember} />
            {[14, 46, 78].map((x) => (
              <rect key={x} x={x} y={10} width={26} height={18} rx={3} fill={C.cream} />
            ))}
            <rect x={112} y={10} width={30} height={24} rx={3} fill={C.ink} />
            <text x={60} y={42} textAnchor="middle" fontFamily="var(--font-poppins)" fontWeight={900} fontSize={13} fill={C.cream}>
              HOPPAZ
            </text>
            <circle cx={32} cy={58} r={11} fill={C.ink} stroke={C.line} strokeWidth={4} />
            <circle cx={118} cy={58} r={11} fill={C.ink} stroke={C.line} strokeWidth={4} />
          </g>
        </g>

        {/* Lagos Island towers */}
        {ISLAND.map((b, k) => building(b, 200 + k))}

        {/* Lekki-Ikoyi Link Bridge: the pylon goes up, the cables draw in */}
        <g className="ts-rise" style={v(at(pylonX - 120))}>
          <rect x={2480} y={deckLk} width={600} height={16} fill={C.ink3} />
          <rect x={2480} y={deckLk} width={600} height={5} fill={C.orange} />
          <path d={`M${pylonX - 16} ${deckLk + 16} L${pylonX - 4} 300 H${pylonX + 4} L${pylonX + 16} ${deckLk + 16} Z`} fill={C.cream} />
          <rect x={pylonX - 10} y={deckLk + 16} width={20} height={GROUND - deckLk - 16 + 30} fill={C.line} />
        </g>
        {Array.from({ length: 14 }, (_, k) => {
          const x = 2500 + k * 43;
          if (Math.abs(x - pylonX) < 30) return null;
          const y0 = 320 + Math.abs(x - pylonX) * 0.12;
          return (
            <path
              key={k}
              d={`M${pylonX} ${Math.min(y0, 420)} L${x} ${deckLk}`}
              stroke={C.cream}
              strokeWidth={2.5}
              opacity={0.55}
              pathLength={1}
              className="ts-draw"
              style={v(at(pylonX, 0.1 + Math.abs(x - pylonX) / 2400))}
            />
          );
        })}

        {/* Eko Atlantic glass, the tallest thing in the city */}
        {EKO.map((b, k) => building(b, 300 + k))}

        {/* The blimp */}
        <g className="ts-pop" style={v(at(3200, -0.3))}>
          <g className="ts-blimp">
            <ellipse cx={3620} cy={140} rx={150} ry={52} fill={C.cream} />
            <path d="M3470 140 L3436 102 L3436 178 Z" fill={C.ember} />
            <rect x={3560} y={180} width={70} height={20} rx={5} fill={C.ink3} />
            <text x={3630} y={152} textAnchor="middle" fontFamily="var(--font-poppins)" fontWeight={900} fontSize={34} fill={C.orange}>
              HOP OR STAY
            </text>
          </g>
        </g>

        {SIGN_SLOTS.map(sign)}
      </svg>

      {/* ----------------------------------------------- the title card -- */}
      {/* Wordmark, the line, then the mascot welcoming you in. Each stamps down, none bounce. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[3%] flex flex-col items-center">
        <div style={{ animation: `ts-stamp .18s cubic-bezier(.2,.9,.3,1) ${T_MARK}s both` }}>
          <Wordmark size={46} tone="cream" />
        </div>
        <p
          className="mt-3 rounded-sm bg-ink/80 px-2 py-1 font-mono text-[11px] font-medium tracking-[0.18em] text-cream"
          style={{ animation: `fade .16s ease ${T_MARK + 0.2}s both` }}
        >
          COME ALONE. LEAVE WITH FRIENDS.
        </p>
        <div className="-mb-1 mt-1" style={{ animation: `ts-stamp .18s cubic-bezier(.2,.9,.3,1) ${T_MARK + 0.3}s both` }}>
          <Mascot state="welcome" size={150} />
        </div>
      </div>

      {/* --------------------------------------------- tiny UI corners --- */}
      <p className="pad-top absolute left-4 top-0 font-mono text-[10px] font-medium tracking-[0.14em] text-dim">
        N 6.5244 / E 3.3792
      </p>
      <button
        type="button"
        onClick={finish}
        className="pad-top absolute right-0 top-0 min-h-[44px] px-4 pb-3 font-mono text-[10px] font-medium tracking-[0.18em] text-cream"
      >
        TAP TO SKIP
      </button>
    </div>
  );
}
