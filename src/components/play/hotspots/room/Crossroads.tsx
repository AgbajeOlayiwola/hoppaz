"use client";

import { useMemo, useRef } from "react";
import clsx from "clsx";
import { FaceDisc } from "@/components/Avatar";
import ChatFace from "@/components/chat/ChatFace";
import type { Band, Head } from "./api";
import css from "./room.module.css";

/**
 * Where the heads stand, as percent of the stage (x, y), in the order they fill. The Hopper stands in the middle. Three rows
 * (top, middle, bottom), at least 72 px apart across on a 360 px wide stage (a tag is up to 68 px), so that a head and its tag
 * never touch the next one, the ring or the edge of a 180 px tall stage. The last slot is where "+N more" goes when there are
 * more heads than slots.
 */
const SLOTS: ReadonlyArray<readonly [number, number]> = [
  [30, 50], [70, 50], [50, 12], [50, 80], [17, 18], [83, 18], [17, 80], [10, 50], [90, 50], [83, 80],
];

/** Keeps each head in the slot it first took, so a head leaving does not shuffle everyone else. */
function useSlots(heads: Head[], cap: number) {
  const held = useRef(new Map<string, number>());
  return useMemo(() => {
    const keys = new Set(heads.map((h) => h.key));
    for (const k of [...held.current.keys()]) if (!keys.has(k)) held.current.delete(k);
    const used = new Set(held.current.values());
    const shown: Array<[Head, number]> = [];
    for (const h of heads) {
      let s = held.current.get(h.key);
      if (s === undefined || s >= cap) {
        held.current.delete(h.key);
        used.delete(s ?? -1);
        s = SLOTS.slice(0, cap).findIndex((_, i) => !used.has(i));
        if (s < 0) continue;
        held.current.set(h.key, s);
        used.add(s);
      }
      shown.push([h, s]);
    }
    return shown;
  }, [heads, cap]);
}

/**
 * An alias under a head. "Puff-puff Stepper F5": the words may be cut to fit, the code at the end never is, because the code
 * is what tells two heads with the same two words apart.
 */
function Tag({ alias }: { alias: string }) {
  const i = alias.lastIndexOf(" ");
  const name = i > 0 ? alias.slice(0, i) : alias;
  const code = i > 0 ? alias.slice(i + 1) : "";
  return (
    <span className="mt-1 flex max-w-[68px] items-baseline justify-center font-mono text-[9px] leading-none text-dim">
      <span className="min-w-0 truncate">{name}</span>
      {code && <span className="ml-[3px] flex-none text-cream/85">{code}</span>}
    </span>
  );
}

/**
 * The junction from above: two roads crossing, your head in the middle inside the orange ring, and a head
 * for everyone else in the room standing around it (an alias and a look, never a real name). Ten at most
 * (six on a low-tier phone); the rest are counted. Tap a head for its card.
 */
export default function Crossroads({
  heads,
  youLook,
  youAlias,
  hereBand,
  low,
  onPick,
}: {
  heads: Head[];
  youLook: unknown;
  youAlias: string | null;
  hereBand: Band;
  low: boolean;
  onPick: (h: Head) => void;
}) {
  const cap = low ? 6 : SLOTS.length;
  // With more heads than slots, the last slot is given to the "+N more" chip.
  const shown = useSlots(heads, heads.length > cap ? cap - 1 : cap);
  const more = heads.length - shown.length;
  const chip = SLOTS[cap - 1];
  const busy = hereBand === "some" || hereBand === "busy" || hereBand === "packed";

  return (
    <div className={css.stage} role="group" aria-label="Who is here">
      <svg className={css.roads} viewBox="0 0 360 240" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g fill="rgb(var(--card))" stroke="rgb(var(--hairline))" strokeWidth="1">
          <rect x="-2" y="94" width="364" height="52" />
          <rect x="150" y="-2" width="60" height="244" />
        </g>
        <rect x="151" y="95" width="58" height="50" fill="rgb(var(--card))" />
        <g stroke="rgb(var(--hairline))" strokeWidth="1.5" strokeDasharray="9 9">
          <line x1="0" y1="120" x2="140" y2="120" />
          <line x1="220" y1="120" x2="360" y2="120" />
          <line x1="180" y1="0" x2="180" y2="84" />
          <line x1="180" y1="156" x2="180" y2="240" />
        </g>
        <g stroke="rgb(var(--hairline))" strokeWidth="3">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line x1={158 + i * 14} y1="86" x2={158 + i * 14} y2="92" />
              <line x1={158 + i * 14} y1="148" x2={158 + i * 14} y2="154" />
              <line x1="142" y1={100 + i * 12} x2="148" y2={100 + i * 12} />
              <line x1="212" y1={100 + i * 12} x2="218" y2={100 + i * 12} />
            </g>
          ))}
        </g>
      </svg>

      <i aria-hidden className={clsx(css.ring, busy && !low && css.hot)} />

      {shown.map(([h, slot]) => (
        <button
          key={h.key}
          type="button"
          className={css.head}
          style={{ left: `${SLOTS[slot][0]}%`, top: `${SLOTS[slot][1]}%` }}
          onClick={() => onPick(h)}
          aria-label={`${h.alias}. Tap for options.`}
        >
          <ChatFace look={h.look} alias={h.look ? null : h.alias} size={38} />
          <Tag alias={h.alias} />
        </button>
      ))}

      <div className={css.you} aria-label="You">
        <FaceDisc look={youLook} initial={youAlias ?? "You"} size={42} />
        <span className="mt-1 block max-w-[110px] truncate font-mono text-[9px] font-medium leading-none tracking-[0.1em] text-cream">YOU</span>
      </div>

      {!heads.length && (
        <p className="absolute inset-x-0 top-[calc(50%+44px)] px-6 text-center font-body text-[13px] leading-snug text-dim">
          Quiet right now. You are early.
        </p>
      )}
      {more > 0 && (
        <span className="pill absolute bg-ink" style={{ left: `${chip[0]}%`, top: `calc(${chip[1]}% + 8px)`, transform: "translate(-50%, -50%)" }}>
          +{more} more
        </span>
      )}
    </div>
  );
}
