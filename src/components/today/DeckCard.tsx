"use client";

import { memo, useState } from "react";
import clsx from "clsx";
import { Check, Package } from "lucide-react";
import Wordmark from "@/components/Wordmark";
import { demoFlyer } from "@/components/event/demo";
import { dayLabel } from "@/lib/filters";
import { eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { EventRow } from "@/lib/types";
import { hasEnded } from "./helpers";

/* eslint-disable @next/next/no-img-element -- organiser flyers come from anywhere, sizes unknown */

/** The tear-off under the perforation. The punched notches ride its top edge. */
const FOOT = 52;
const NOTCH = { ["--notch-y" as string]: `calc(100% - ${FOOT}px)` } as React.CSSProperties;

/**
 * One night as a big flyer card for the deck: the flyer (or the branded block
 * when there is none), the title, when and where, the price (with a small violet
 * mark when the night has a box or quests), and under the perforation how many
 * are going plus the WE OUTSIDE button. It wears its own event's colours, like
 * every stub in the app.
 *
 * It draws no position; the deck moves it and covers it with one button to open
 * the breakdown, and WE OUTSIDE sits above that cover (on the middle card only:
 * a tap on a neighbour still just brings it to the middle). `near` is whether it
 * is within two places of the middle: only those load their flyer, and once
 * loaded it stays loaded.
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
  /** Saving your going. */
  busy: boolean;
  /** WE OUTSIDE: the same toggle as I'M GOING on the event page. */
  onGoing: (event: EventRow) => void;
}) {
  const theme = themeForEvent(event.starts_at);
  const lead = isEventLead(event);
  const ended = hasEnded(event, now);
  /** The night can still be said yes to: WE OUTSIDE has a place in the foot. */
  const live = !ended && !lead;
  const title = eventTitle(event);
  const when = lead ? "TIME TBC" : dayLabel(event.starts_at, now);
  const where = [event.area?.toUpperCase(), eventPrice(event)].filter(Boolean).join(" · ");

  // Flyers load for the middle card and its neighbours; a card that has been near keeps its flyer.
  const [seen, setSeen] = useState(near);
  if (near && !seen) setSeen(true);

  const mark = box && quests > 0 ? "BOX · QUESTS" : box ? "BOX" : quests > 0 ? "QUESTS" : null;

  return (
    <>
      {/* The stub's notch mask would cut its own shadow, so the shadow is a layer behind it. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-1 bottom-0 top-6 rounded-[14px] shadow-[0_18px_34px_-16px_rgb(var(--shadow)/0.6)]" />
      <article
        className={clsx(
          "stub flex h-full flex-col overflow-hidden rounded-[14px] transition-transform duration-100 [button:active~&]:scale-[0.985]",
          theme === "day" ? "stub-day" : "stub-night",
          lead && "border-dashed"
        )}
        style={NOTCH}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden border-b border-line bg-ink-3">
          <Art event={event} load={seen} tone={theme === "day" ? "ink" : "cream"} />
        </div>

        <div className="flex-none px-4 pb-3 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-dim">{when}</p>
            {mark && (
              <span className="pill pill-violet flex-none">
                <Package size={12} aria-hidden />
                {mark}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-dim">{where}</p>
          <h2 className="mt-2 line-clamp-2 min-h-[2.2em] font-display text-[20px] font-black leading-[1.1] tracking-[-0.01em]">{title}</h2>
        </div>

        <div
          className={clsx("flex flex-none items-center justify-between gap-2 border-t border-dashed border-line pl-4", live ? "pr-[132px]" : "pr-4")}
          style={{ height: FOOT }}
        >
          <p className="min-w-0 truncate font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-dim">
            {ended ? "ENDED" : lead ? "UNCONFIRMED LEAD" : count > 0 ? `${count} GOING` : "BE THE FIRST"}
          </p>
        </div>

        {/* The deck dims the cards that are not in the middle by moving only this layer's opacity. */}
        <div
          data-dim
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-ink opacity-0"
          style={{ willChange: "opacity" }}
        />
      </article>
      {/*
        WE OUTSIDE sits over the foot, outside the stub: the stub is masked (its notches), which makes it a layer of its own
        under the deck's cover button, so nothing inside it could be tapped. The middle card only; a neighbour is just tapped to the middle.
      */}
      {live && active && (
        <button
          type="button"
          onClick={() => onGoing(event)}
          disabled={busy}
          aria-pressed={going}
          aria-label={going ? "You're going. Tap to undo." : "We outside. Say you're going."}
          className={clsx("btn absolute right-4 z-20 min-h-[36px] px-3 py-1.5 text-[12px]", going && "btn-ghost border-keke text-keke")}
          style={{ bottom: (FOOT - 36) / 2 }}
        >
          {going ? (
            <>
              <Check size={13} strokeWidth={3} aria-hidden /> YOU&apos;RE IN
            </>
          ) : (
            "WE OUTSIDE"
          )}
        </button>
      )}
    </>
  );
}

export default memo(DeckCard);

/**
 * The art: the whole flyer, centred on a soft blur of itself (flyers are
 * posters, not banners), or with none a calm branded block. Never a made-up
 * picture.
 */
function Art({ event, load, tone }: { event: EventRow; load: boolean; tone: "cream" | "ink" }) {
  const flyer = demoFlyer(event);
  const [broken, setBroken] = useState(false);

  if (!flyer || broken) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
        {/* A big, quiet H with its ears: the card is a poster that has not been sent yet. */}
        <img src="/brand/mark-orange.png" alt="" aria-hidden draggable={false} className="h-[42%] w-auto select-none opacity-[0.2]" />
        <Wordmark size={15} tone={tone} className="opacity-50" />
        {/* No flyer to say what kind of night it is, so the card says it. (Over a flyer it would cover the art.) */}
        <span className="absolute left-3 top-3 rounded-[4px] bg-brand-ink/75 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-brand-cream">
          {event.vibe}
        </span>
      </div>
    );
  }
  if (!load) return null;
  return (
    <>
      <img src={flyer} alt="" aria-hidden draggable={false} decoding="async" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-xl" />
      <img
        src={flyer}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => setBroken(true)}
        className="relative h-full w-full object-contain"
      />
    </>
  );
}

/** Loading: three cards with nothing in them. Static on purpose, no shimmer. */
export function GhostDeck() {
  const ghost = (cls: string, style?: React.CSSProperties) => (
    <div aria-hidden className={clsx("stub absolute bottom-1 top-3 flex flex-col overflow-hidden rounded-[14px]", cls)} style={{ ...NOTCH, ...style }}>
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
