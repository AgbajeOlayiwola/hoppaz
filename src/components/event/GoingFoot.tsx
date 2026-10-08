"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, ArrowUpRight, Check, Share2 } from "lucide-react";
import Avatar from "@/components/Avatar";
import { useGoing } from "@/lib/useGoing";
import { useToast } from "@/lib/store";
import type { EventRow } from "@/lib/types";
import { shareEvent } from "./share";
import { useMyLook } from "./useMyLook";

const HOUR = 3.6e6;

/** TICKETS for a ticketing link, LISTING when all we have is an Instagram post. */
function linkLabel(event: EventRow) {
  if (!event.ig_url || event.source === "instagram") return "LISTING";
  try {
    return /(^|\.)(instagram\.com|instagr\.am)$/i.test(new URL(event.ig_url).hostname) ? "LISTING" : "TICKETS";
  } catch {
    return "LISTING";
  }
}

const CELL =
  "flex min-h-[44px] flex-1 items-center justify-center gap-1 whitespace-nowrap px-1 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-cream hover:bg-ink-3";

/**
 * Pinned under the perforation: the guest list (the going count, your face),
 * the one button that matters, and the ways to pass the night on.
 */
export default function GoingFoot({
  event,
  userId,
  compact = false,
}: {
  event: EventRow;
  userId: string | null;
  /** Narrow (the card docked beside the map): the secondary row folds into two columns. */
  compact?: boolean;
}) {
  const say = useToast((s) => s.say);
  const { isGoing, busy, toggleGoing } = useGoing(userId);
  const look = useMyLook(userId);
  const going = isGoing(event.id);
  const saving = !!busy[event.id];

  // The count comes from the last load (events_near.swipes_in). Your own tap shows at once:
  // adjust it by one until a fresh load brings the real number.
  const loaded = event.swipes_in ?? 0;
  const [adj, setAdj] = useState({ base: loaded, delta: 0 });
  const delta = adj.base === loaded ? adj.delta : 0;
  const count = Math.max(0, loaded + delta);

  const start = Date.parse(event.starts_at);
  const now = Date.now();
  const ended = now > start + 6 * HOUR;
  const live = now >= start && !ended;
  const here = event.here_now ?? 0;

  const onGoing = async () => {
    if (saving || ended) return;
    const was = going;
    const err = await toggleGoing(event.id);
    if (err) {
      say(err, "error");
      return;
    }
    setAdj({ base: loaded, delta: delta + (was ? -1 : 1) });
  };

  const onShare = async () => {
    const res = await shareEvent(event, count);
    if (res === "copied") say("Link copied", "ok");
    else if (res === "failed") say("Couldn't share that. Try again.", "error");
  };

  return (
    <>
      {/* ---------------------------------------------------- the guest list -- */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="num text-[36px] text-cream" aria-live="polite">
            {count}
          </p>
          <p className="mt-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-dim">
            {count === 0 ? "BE THE FIRST" : count === 1 ? "HOPPER GOING" : "HOPPERS GOING"}
          </p>
          {live && here > 0 && (
            <p className="mt-1 font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-cream">{here} HERE NOW</p>
          )}
        </div>

        <div className="flex flex-none items-end gap-2">
          {/* TODO(back end): crew faces. Who in your crew is going to this event is not readable
              client side (swipes are private; crew RSVPs carry no avatars). It needs an RPC that
              returns crewmates' avatars for an event id. Render them here, before your own face. */}
          <div className="flex flex-col items-center gap-1">
            {going ? (
              <span
                key="face-on"
                className="block h-11 w-11 overflow-hidden rounded-full border border-line bg-ink-3 animate-stamp"
                title="You"
              >
                <Avatar look={look} crop="head" label="You" />
              </span>
            ) : (
              <span aria-hidden className="block h-11 w-11 rounded-full border border-dashed border-dim/60" />
            )}
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim">YOU</span>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- the one button -- */}
      <div className="mt-3">
        {ended ? (
          <button className="btn w-full disabled:border disabled:border-line" disabled>
            ENDED
          </button>
        ) : going ? (
          <button
            type="button"
            onClick={onGoing}
            aria-busy={saving}
            aria-label="You're going. Tap to undo."
            className="btn btn-ghost relative w-full border-keke text-keke"
          >
            <span key="going" className="inline-flex items-center gap-2 animate-stamp">
              <Check size={16} strokeWidth={3} /> YOU&apos;RE GOING
            </span>
            <span className="absolute right-3 font-mono text-[10px] font-medium tracking-[0.1em] text-dim">UNDO</span>
          </button>
        ) : (
          <button type="button" onClick={onGoing} aria-busy={saving} className="btn w-full">
            {saving ? "SAVING…" : "I'M GOING"}
          </button>
        )}
      </div>

      {/* -------------------------------------------------- the secondary row -- */}
      <div
        className={clsx(
          "mt-2 overflow-hidden rounded-hz border border-line",
          // Narrow: a two-column grid whose 1px gaps show the hairline; the chat link takes a row of its own when it is the odd one out.
          compact ? "grid grid-cols-2 gap-px bg-line [&>*]:bg-ink-2" : "flex divide-x divide-line"
        )}
      >
        <button type="button" onClick={onShare} className={CELL}>
          <Share2 size={14} className="text-orange" aria-hidden /> SHARE
        </button>
        {event.ig_url && (
          <a href={event.ig_url} target="_blank" rel="noreferrer noopener" className={CELL}>
            {linkLabel(event)} <ArrowUpRight size={14} className="text-orange" aria-hidden />
          </a>
        )}
        <Link href={`/chat?c=${event.id}`} className={clsx(CELL, compact && event.ig_url && "col-span-2")}>
          EVENT CHAT <ArrowRight size={14} className="text-orange" aria-hidden />
        </Link>
      </div>
    </>
  );
}
