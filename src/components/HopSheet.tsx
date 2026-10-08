"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import StubSheet from "@/components/event/StubSheet";
import { naira } from "@/lib/geo";
import type { Hop } from "@/lib/types";

/** "SAT 10 OCT", in Lagos time. */
function hopDate(date: string) {
  return new Date(date)
    .toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" })
    .replace(",", "")
    .toUpperCase();
}

/** "7:00pm" -> "7PM", "8:30pm" -> "8:30PM", matching the event times. */
const stopClock = (t: string) => t.replace(":00", "").replace(/\s/g, "").toUpperCase();

/**
 * The Hop, as the original ticket stub: the bus is where the stub shape comes
 * from. A mono line of facts, the route drawn as one line with a dot per stop,
 * one sentence of copy, one button.
 */
export default function HopSheet({
  hop,
  onClose,
}: {
  hop: Hop | null;
  /** Kept so existing callers still compile; stops no longer show how far they are from you. */
  fix?: { lat: number; lng: number; area: string | null } | null;
  onClose: () => void;
}) {
  if (!hop) return null;
  const first = hop.stops[0];
  const facts = [hopDate(hop.hop_date), naira(hop.price_naira)].join(" · ");
  const boardAt = first ? `BOARD AT ${first.name.toUpperCase()}` : null;

  return (
    <StubSheet
      label={hop.name}
      onClose={onClose}
      footer={
        <>
          {hop.ticket_url ? (
            <a href={hop.ticket_url} target="_blank" rel="noreferrer noopener" className="btn w-full">
              GET A SEAT
            </a>
          ) : (
            <button className="btn w-full disabled:border disabled:border-line" disabled>
              SEATS SOON
            </button>
          )}
          <p className="mt-1 text-center">
            <Link
              href={`/chat?c=hop-${hop.id}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline decoration-orange decoration-2 underline-offset-4"
            >
              HOP CHAT <ArrowRight size={14} className="text-orange" aria-hidden />
            </Link>
          </p>
        </>
      }
    >
      <div className="px-5 pb-5 pt-2">
        <p className="seclabel">THE HOP</p>
        <h2 className="mt-2 font-display text-[30px] font-black leading-[1.05] tracking-[-0.01em]">{hop.name}</h2>
        <p className="mt-2.5 font-mono text-[12px] font-medium uppercase leading-snug tracking-[0.04em] text-cream">
          {facts}
          {boardAt && (
            <>
              <br />
              {boardAt}
            </>
          )}
        </p>
        {hop.boarding && <p className="mt-1 font-body text-[14px] text-dim">{hop.boarding}</p>}

        {/* ------------------------------------------------------ the route -- */}
        <ol className="mt-6" aria-label="Stops">
          {hop.stops.map((s, i) => {
            const last = i === hop.stops.length - 1;
            return (
              <li key={s.id} className="flex gap-3">
                <span className="w-[52px] flex-none pt-px text-right font-mono text-[12px] font-medium tracking-[0.04em] text-cream">
                  {stopClock(s.stop_time)}
                </span>
                <span className="relative flex w-3 flex-none justify-center" aria-hidden>
                  <i
                    className={`relative z-10 mt-[5px] block h-3 w-3 rounded-full border ${last ? "border-cream bg-cream" : "border-dim bg-ink-2"}`}
                  />
                  {!last && <i className="absolute bottom-[-6px] top-[17px] w-px bg-line" />}
                </span>
                <span className="min-w-0 flex-1 pb-5">
                  <b className="block font-body text-[15px] font-semibold leading-snug">{s.name}</b>
                  <span className="hint block">
                    {[s.area, s.role].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-1 font-body text-[14px] leading-snug text-cream">
          Come alone, leave with friends: the bus never waits, so hop on or stay.
        </p>
      </div>
    </StubSheet>
  );
}
