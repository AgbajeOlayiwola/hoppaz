"use client";

import { useState } from "react";
import clsx from "clsx";
import Avatar from "@/components/Avatar";
import Wordmark from "@/components/Wordmark";
import { demoFlyer } from "@/components/event/demo";
import { eventTitle } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { EventRow } from "@/lib/types";
import { factLine, hasEnded, notchAbove, stubPill } from "./helpers";
import type { StubQuest } from "./useEventQuests";

/* eslint-disable @next/next/no-img-element -- organiser flyers come from anywhere, sizes unknown */

/** The tear-off under the perforation. The punched notches ride its top edge. */
const FOOT = 68;
const stubNotch = notchAbove(FOOT);

/**
 * One night as a ticket stub: the flyer, the title, one mono line, this
 * event's quests, then the tear-off with the status pill and the one button.
 * The stub wears its own event's colours (a daytime event is cream in the
 * night app, and back), so the list never flickers as you scroll.
 */
export default function EventStub({
  event,
  now,
  going,
  count,
  drop,
  quests,
  look,
  saving,
  stamped,
  onOpen,
  onToggle,
}: {
  event: EventRow;
  now: number;
  going: boolean;
  /** The going count to print: the loaded number plus your own tap. */
  count: number;
  drop: boolean;
  quests: StubQuest[];
  /** Your own look, for the face the stub stamps when you say you are going. */
  look: unknown;
  saving: boolean;
  /** You just tapped: play the stamp. (Not on page load, where nothing moves.) */
  stamped: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const theme = themeForEvent(event.starts_at);
  const title = eventTitle(event);
  const ended = hasEnded(event, now);
  const pill = ended ? null : stubPill(event, { drop, count });
  const goingPill = pill?.cls === "pill-keke";
  const questXp = quests.reduce((n, q) => n + q.xp, 0);

  return (
    <article
      className={clsx("stub overflow-hidden", theme === "day" ? "stub-day" : "stub-night")}
      style={stubNotch}
    >
      {/* The whole top of the stub is one tap target: the title button stretches over it. */}
      <div className="relative">
        <Art event={event} tone={theme === "day" ? "ink" : "cream"} />
        <div className="px-4 pb-4 pt-3.5">
          <h2 className="font-display text-[22px] font-black leading-[1.1] tracking-[-0.01em]">
            <button
              type="button"
              onClick={onOpen}
              className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-orange"
            >
              {title}
            </button>
          </h2>
          <p className="mt-1.5 font-mono text-[11.5px] font-medium uppercase leading-snug tracking-[0.04em] text-dim">
            {factLine(event, now)}
          </p>
          {quests.length > 0 && (
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="seclabel">QUESTS HERE</span>
                <span className="font-mono text-[11px] font-medium text-dim">+{questXp} XP</span>
              </div>
              <p className="mt-1 truncate font-body text-[13px] text-cream">
                {[...quests.slice(0, 2).map((q) => q.title), ...(quests.length > 2 ? [`+${quests.length - 2} more`] : [])].join(" · ")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* The tear-off. */}
      <div
        className="flex items-center justify-between gap-3 border-t border-dashed border-line px-4"
        style={{ height: FOOT }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {ended && <span className="pill">ENDED</span>}
          {pill && <span className={clsx("pill", pill.cls)}>{pill.text}</span>}
          {pill && !goingPill && count > 0 && (
            <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-dim">
              {count} GOING
            </span>
          )}
        </div>

        {!ended &&
          (going ? (
            <button
              type="button"
              onClick={onToggle}
              aria-pressed
              aria-busy={saving}
              aria-label="You're going. Tap to undo."
              className="btn btn-ghost flex-none border-keke px-3 text-[12px] text-keke"
            >
              <span key="going" className={clsx("inline-flex items-center gap-2", stamped && "animate-stamp")}>
                <span className="block h-6 w-6 overflow-hidden rounded-full border border-keke bg-ink-3">
                  <Avatar look={look} crop="head" label="You" />
                </span>
                YOU&apos;RE GOING
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              aria-pressed={false}
              aria-busy={saving}
              className="btn flex-none px-4 text-[12px]"
            >
              I&apos;M GOING
            </button>
          ))}
      </div>
    </article>
  );
}

/**
 * The art on top: the whole flyer (the event page opens it full size), or,
 * with none, a calm branded strip. Never a made-up picture.
 */
function Art({ event, tone }: { event: EventRow; tone: "cream" | "ink" }) {
  const flyer = demoFlyer(event);
  const [broken, setBroken] = useState(false);

  if (!flyer || broken) {
    return (
      <div className="flex h-[56px] items-end justify-between border-b border-line bg-ink-3 px-4 pb-2.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim">{event.vibe}</span>
        <Wordmark size={11} tone={tone} className="opacity-60" />
      </div>
    );
  }
  return (
    // Flyers are posters, not banners: the whole flyer sits centred on a soft blur of itself.
    <div className="relative h-[148px] overflow-hidden border-b border-line bg-ink-3">
      <img src={flyer} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-xl" />
      <img
        src={flyer}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="relative h-full w-full object-contain"
      />
    </div>
  );
}

/** Loading: a stub with nothing in it. Static on purpose, no shimmer. */
export function GhostStub() {
  return (
    <div aria-hidden className="stub overflow-hidden" style={stubNotch}>
      <div className="h-[148px] border-b border-line bg-ink-3" />
      <div className="px-4 pb-4 pt-3.5">
        <div className="h-[22px] w-3/5 rounded-[3px] bg-ink-3" />
        <div className="mt-3 h-3 w-4/5 rounded-[3px] bg-ink-3" />
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-line px-4" style={{ height: FOOT }}>
        <div className="h-[22px] w-20 rounded-[4px] bg-ink-3" />
        <div className="h-11 w-32 rounded-hz bg-ink-3" />
      </div>
    </div>
  );
}
