"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Package } from "lucide-react";
import { demoFlyer } from "@/components/event/demo";
import { dayLabel } from "@/lib/filters";
import { clockShort, eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import type { EventRow } from "@/lib/types";
import { HOUR, hasEnded } from "./helpers";
import m from "./today.module.css";

/* eslint-disable @next/next/no-img-element -- organiser flyers come from anywhere, sizes unknown */

/** Where the strip's two punched notches sit when the ghost cards (below) borrow the same shape. */
const FOOT = 52;
const NOTCH = { ["--notch-y" as string]: `calc(100% - ${FOOT}px)` } as React.CSSProperties;

/**
 * One night as a ticket for the deck. The flyer is the whole card, full bleed
 * (or, with none, the title set big on the brand's colours). Across the bottom
 * is the ticket strip: when, where, the price and how many are going, and under
 * it a clear TAP FOR DETAILS bar. The countdown rides the top left, and the
 * violet BOX HERE mark the bottom right when the night has a drop or quests.
 *
 * It draws no position; the deck moves it and covers it with one button that
 * opens the breakdown. The countdown and WE OUTSIDE share one row above that
 * cover (WE OUTSIDE on the middle card only: a tap on a neighbour just brings it
 * to the middle), so on a small card the countdown gives way instead of the two
 * lying on top of each other. `near` is whether the card is within two places of
 * the middle: only those load their flyer, and once loaded it stays loaded.
 * `narrow` is a small card (a short screen, or Paz's tour taking room): the
 * wording shortens and the title is set smaller.
 *
 * The parts the deck slides against each other (the picture, the title, the
 * glint, the dimming, the top row) carry data-art, data-ttl, data-sheen, data-dim
 * and data-top.
 */
function DeckCard({
  event,
  now,
  count,
  going,
  box,
  quests,
  near,
  active,
  narrow,
  busy,
  onGoing,
}: {
  event: EventRow;
  now: number;
  /** The going count to print: the loaded number plus your own tap. */
  count: number;
  /** You said you are going. */
  going: boolean;
  /** The night has a box (a drop). */
  box: boolean;
  /** How many quests belong to this night. */
  quests: number;
  near: boolean;
  /** The card in the middle: the only one whose WE OUTSIDE takes a tap. */
  active: boolean;
  /** A small card: shorter wording, a smaller title. */
  narrow: boolean;
  /** Saving your going. */
  busy: boolean;
  /** WE OUTSIDE: the same toggle as I'M GOING on the event page. */
  onGoing: (event: EventRow) => void;
}) {
  const lead = isEventLead(event);
  const ended = hasEnded(event, now);
  /** The night can still be said yes to: WE OUTSIDE has a place on the card. */
  const live = !ended && !lead;
  const title = eventTitle(event);
  const time = lead ? "TBC" : clockShort(event.starts_at);
  const day = lead ? "" : (dayLabel(event.starts_at, now).split(" · ")[0] ?? "");
  const price = eventPrice(event);
  const where = event.area?.toUpperCase() || event.venue_name.toUpperCase();

  // Flyers load for the middle card and its neighbours; a card that has been near keeps its flyer.
  const [seen, setSeen] = useState(near);
  if (near && !seen) setSeen(true);

  const mark = box ? "BOX HERE" : quests > 0 ? "QUESTS" : null;

  return (
    <>
      {/* The face is masked (its notches), which would cut its own shadow, so the shadow is a layer behind it. */}
      <span aria-hidden className={m.under} />
      <article className={clsx(m.face, active && m.front)}>
        <Art event={event} load={seen} title={title} narrow={narrow} badge={!!mark} />
        <div aria-hidden data-sheen className={m.sheen} />
        <div aria-hidden className={m.shade} />

        {mark && (
          <div className={m.cbot}>
            <span className={m.boxb}>
              <Package size={11} strokeWidth={2.4} aria-hidden />
              {mark}
            </span>
          </div>
        )}

        <div className={m.strip}>
          <div className={m.rowA}>
            <span className={m.rowL}>
              <span className={m.tm}>{time}</span>
              {day && <span className={m.dy}>{day}</span>}
            </span>
            {lead ? <span className={m.prSmall}>{price}</span> : <span className={m.pr}>{price}</span>}
          </div>
          <div className={m.rowB}>
            <span className={m.area}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2.5a7 7 0 00-7 7c0 5 7 12 7 12s7-7 7-12a7 7 0 00-7-7zm0 9.6a2.6 2.6 0 110-5.2 2.6 2.6 0 010 5.2z" />
              </svg>
              <span>{where}</span>
            </span>
            <span className={m.going}>
              {ended ? "ENDED" : lead ? "UNCONFIRMED" : count > 0 ? <><b>{count}</b> GOING</> : "BE THE FIRST"}
            </span>
          </div>
          <div className={m.tap}>
            <span>TAP FOR DETAILS</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </div>
        </div>

        <div data-dim aria-hidden className={m.dim} />
        <div aria-hidden className={m.edge} />
      </article>

      {/*
        The top row sits over the card, outside the masked face: the face is a layer of its own under the deck's cover
        button, so nothing inside it could be tapped. The countdown and WE OUTSIDE share the row, so they can never
        overlap: the countdown is the part that shrinks. The middle card only takes a tap on WE OUTSIDE; a neighbour is
        just tapped to the middle.
      */}
      <div data-top className={clsx(m.ctop, active && m.front)}>
        <span className={m.cd}>
          <i className={clsx(m.dot, (lead || ended) && m.dotOff)} />
          <Countdown at={Date.parse(event.starts_at)} lead={lead} ended={ended} compact={narrow} />
        </span>
        {live && active && (
          <button
            type="button"
            onClick={() => onGoing(event)}
            disabled={busy}
            aria-pressed={going}
            aria-label={going ? "You're going. Tap to undo." : "We outside. Say you're going."}
            className={clsx(m.out, narrow && m.outSm, going && m.outOn)}
          >
            {going ? (
              <>
                <Check size={narrow ? 11 : 12} strokeWidth={3.4} aria-hidden /> YOU&apos;RE IN
              </>
            ) : (
              "WE OUTSIDE"
            )}
          </button>
        )}
      </div>
    </>
  );
}

export default memo(DeckCard);

/**
 * "STARTS IN 3H 12M", then "LIVE NOW" once it has started. It keeps its own
 * clock (every 15 seconds, every second in the last hour) so the card is live
 * without the page re-drawing the deck. On a small card (`compact`) it drops
 * the lead-in words and the minutes of a far-off day, and gives way to WE OUTSIDE.
 */
function Countdown({ at, lead, ended, compact }: { at: number; lead: boolean; ended: boolean; compact: boolean }) {
  const [t, setT] = useState(() => Date.now());
  const left = at - t;
  const running = !lead && !ended && left > 0;
  const fast = left < HOUR;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setT(Date.now()), fast ? 1000 : 15_000);
    return () => clearInterval(id);
  }, [running, fast]);
  if (lead) return <span className={m.cdT}>{compact ? "TBC" : "TIME TBC"}</span>;
  if (ended) return <span className={m.cdT}>ENDED</span>;
  if (left <= 0) return <span className={m.cdT}>{compact ? "LIVE" : "LIVE NOW"}</span>;
  return (
    <span className={m.cdT}>
      {!compact && "STARTS IN "}
      <b style={{ fontWeight: 500 }}>{formatLeft(left, compact)}</b>
    </span>
  );
}

/** "2D 7H 5M", "3H 12M", "42M 05S". Whole numbers, never negative. Compact: "2D 7H" (days away, the minutes do not matter). */
export function formatLeft(ms: number, compact = false) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (d > 0) return compact ? `${d}D ${h}H` : `${d}D ${h}H ${min}M`;
  if (h > 0) return `${h}H ${min}M`;
  return `${min}M ${String(s % 60).padStart(2, "0")}S`;
}

/**
 * The art: the flyer filling the whole card (cover), or with none the title set
 * big on a branded block. The flyer is asked for with CORS so the page can read
 * its colours; if a server will not allow that, it is shown without (the colours
 * then fall back to the brand's), and only a flyer that will not load at all is
 * replaced by the block.
 */
function Art({ event, load, title, narrow, badge }: { event: EventRow; load: boolean; title: string; narrow: boolean; badge: boolean }) {
  const flyer = demoFlyer(event);
  const [how, setHow] = useState<"cors" | "plain" | "broken">("cors");
  const [shown, setShown] = useState(false);

  if (!flyer || how === "broken") return <Block event={event} title={title} narrow={narrow} badge={badge} />;
  if (!load) return null;
  return (
    <div data-art className={m.art}>
      <img
        key={how}
        src={flyer}
        alt=""
        draggable={false}
        decoding="async"
        crossOrigin={how === "cors" ? "anonymous" : undefined}
        onLoad={() => setShown(true)}
        onError={() => setHow(how === "cors" ? "plain" : "broken")}
        className={clsx(m.img, shown && m.imgOn)}
      />
    </div>
  );
}

/**
 * No flyer: the title in Poppins Black, the brand's mark behind it, and what kind of night it is.
 * The title is set to fit the room it has, whatever size the card is: it starts from a size taken from the card's own
 * width (--cw, which the deck sets; the same sizes the card has always had at 281px wide: 52, 42, 34 and 28px) and steps
 * down until no word runs past the edge and the lines stop above the badge row. Measured in the browser, so a small
 * card (a short phone, Paz's tour taking room) shrinks the title instead of breaking a word or running into the chips.
 */
function Block({ event, title, narrow, badge }: { event: EventRow; title: string; narrow: boolean; badge: boolean }) {
  const n = title.length;
  const step = n <= 12 ? 18.5 : n <= 22 ? 14.9 : n <= 36 ? 12.1 : 10;
  const longest = Math.max(1, ...title.split(/\s+/).map((w) => w.length));
  const start = Math.min(step, 100 / longest) / 100;
  const vibe = !!event.vibe && !narrow;
  const box = useRef<HTMLDivElement>(null);
  const ttl = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = box.current;
    const el = ttl.current;
    if (!frame || !el) return;
    const fit = () => {
      const cw = frame.clientWidth;
      if (!cw) return;
      let px = cw * start;
      const least = Math.max(11, cw * 0.075);
      el.style.fontSize = `${px.toFixed(2)}px`;
      // Words are never broken, so one too long for the line runs past the edge (scrollWidth) and the loop takes it down.
      while (px > least && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        px = Math.max(least, px * 0.94);
        el.style.fontSize = `${px.toFixed(2)}px`;
      }
    };
    let dead = false;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    // The first fit may have used a stand-in font; fit again once Poppins is in.
    void document.fonts?.ready.then(() => !dead && fit());
    return () => {
      dead = true;
      ro.disconnect();
    };
  }, [title, start]);

  return (
    <div ref={box} className={m.block}>
      <img src="/brand/mark-orange.png" alt="" aria-hidden draggable={false} className={m.blockMark} />
      <div ref={ttl} data-ttl className={clsx(m.blockTitle, badge || vibe ? m.blockTitleTall : m.blockTitleFull)}>
        {title}
      </div>
      {vibe && <span className={m.vibe}>{event.vibe}</span>}
    </div>
  );
}

/** Loading: three cards with nothing in them. Static on purpose, no shimmer. */
export function GhostDeck() {
  const ghost = (cls: string, style?: React.CSSProperties) => (
    <div aria-hidden className={clsx("stub absolute bottom-1 top-3 flex flex-col overflow-hidden rounded-[22px]", cls)} style={{ ...NOTCH, ...style }}>
      <div className="min-h-0 flex-1 border-b border-line bg-ink-3" />
      <div className="flex-none px-4 pb-3.5 pt-3">
        <div className="h-3 w-2/5 rounded-[3px] bg-ink-3" />
        <div className="mt-2.5 h-5 w-4/5 rounded-[3px] bg-ink-3" />
        <div className="mt-2 h-3 w-3/5 rounded-[3px] bg-ink-3" />
      </div>
      <div className="flex-none border-t border-dashed border-line" style={{ height: FOOT }} />
    </div>
  );
  const w = "min(72%, 300px)";
  const left = "calc(50% - min(72%, 300px) / 2)";
  return (
    <div role="status" aria-label="Loading the events" className="relative h-full min-h-0 overflow-x-clip">
      {ghost("opacity-40", { width: w, left, transform: "translateX(-76%) rotate(-4deg) scale(.88)", transformOrigin: "50% 100%" })}
      {ghost("opacity-40", { width: w, left, transform: "translateX(76%) rotate(4deg) scale(.88)", transformOrigin: "50% 100%" })}
      {ghost("", { width: w, left })}
    </div>
  );
}
