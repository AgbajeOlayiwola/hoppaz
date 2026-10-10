"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import Sheet from "@/components/Sheet";
import type { EventGroup } from "@/lib/chat";
import { dayLabel } from "@/lib/filters";
import { eventTitle } from "@/lib/geo";
import type { EventRow } from "@/lib/types";
import { hasEnded } from "./helpers";

export type Liked = { event: EventRow; saved: boolean };

/**
 * WE OUTSIDE: every event you swiped right on (or said I'M GOING to), soonest
 * first, the ones that are over at the bottom. Tap one to open it; each has its
 * group chat beside it (JOIN while you're invited, CHAT once you're in). A guest's
 * right swipes are kept on the phone until they make an account, so those rows
 * say SIGN UP TO SAVE and have no chat yet.
 */
export default function WeOutsideSheet({
  open,
  onClose,
  items,
  groups,
  now,
  onOpen,
  onJoin,
  onSignUp,
}: {
  open: boolean;
  onClose: () => void;
  items: Liked[];
  groups: EventGroup[];
  now: number;
  onOpen: (event: EventRow) => void;
  /** Join the event's group chat from an invite. Resolves true when it worked. */
  onJoin: (eventId: string) => Promise<boolean>;
  onSignUp: () => void;
}) {
  const [joining, setJoining] = useState<string | null>(null);
  const byEvent = new Map(groups.map((g) => [g.event_id, g]));
  const unsaved = items.some((i) => !i.saved);

  return (
    <Sheet open={open} onClose={onClose} label="We outside">
      <h2 className="font-display text-[24px] font-black leading-none">We outside</h2>
      <p className="hint mt-1.5 pr-10">Everything you swiped right on. Open one, or jump in its group chat.</p>

      {unsaved && (
        <button type="button" onClick={onSignUp} className="btn mt-4 w-full text-[12.5px]">
          SIGN UP TO SAVE THESE AND GET THE CHATS
        </button>
      )}

      {items.length === 0 ? (
        <p className="hint mt-6 pb-4 text-center">Nothing yet. Swipe right on a night and it lands here.</p>
      ) : (
        <ul className="mt-3">
          {items.map(({ event: e, saved }) => {
            const ended = hasEnded(e, now);
            const g = byEvent.get(e.id);
            return (
              <li key={e.id} className="flex min-h-[56px] items-center gap-2 border-t border-line py-2.5">
                <button type="button" onClick={() => onOpen(e)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-dim">
                    {ended ? "ENDED" : dayLabel(e.starts_at, now)}
                    {e.area ? ` · ${e.area}` : ""}
                  </span>
                  <span className={`mt-0.5 block truncate font-display text-[15px] font-black leading-tight ${ended ? "text-dim" : ""}`}>
                    {eventTitle(e)}
                  </span>
                  {!saved && <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-orange">Sign up to save</span>}
                </button>
                {saved && g?.status === "invited" ? (
                  <button
                    type="button"
                    disabled={joining === e.id}
                    onClick={async () => {
                      setJoining(e.id);
                      await onJoin(e.id);
                      setJoining(null);
                    }}
                    className="btn flex-none px-3 text-[11px]"
                  >
                    JOIN CHAT
                  </button>
                ) : saved && g ? (
                  <Link
                    href={`/crew/group/${e.id}`}
                    aria-label={`Group chat for ${eventTitle(e)}`}
                    className="btn btn-ghost flex-none gap-1.5 px-3 text-[11px]"
                  >
                    <MessageCircle size={14} aria-hidden /> CHAT
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
