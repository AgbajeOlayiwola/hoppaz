"use client";

import { useState } from "react";
import { shortDate } from "./dropTime";

export type Visit = { event_id: string; created_at: string; title: string; venue: string; area: string | null };

const SHOWN = 5;

/**
 * Past check-ins as a quiet list: the night, where, and a mono date. No icons,
 * no colour. The first few show, the rest sit behind one link.
 */
export default function YourNights({ visits, loaded }: { visits: Visit[]; loaded: boolean }) {
  const [all, setAll] = useState(false);
  const rows = all ? visits : visits.slice(0, SHOWN);
  return (
    <section aria-label="Your nights" className="mt-7">
      <p className="seclabel mb-1">YOUR NIGHTS{loaded && visits.length > 0 ? ` · ${visits.length}` : ""}</p>
      {!loaded ? null : visits.length === 0 ? (
        <p className="hint py-3">No nights yet. Get within 1.5 km of a party on the map and check in.</p>
      ) : (
        <>
          <ul>
            {rows.map((v) => (
              <li key={v.event_id} className="flex items-baseline justify-between gap-3 border-b border-line py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-[15px] font-semibold leading-tight">{v.title}</span>
                  <span className="hint block truncate">{[v.venue, v.area].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex-none font-mono text-[11px] font-medium tracking-[0.06em] text-dim">
                  {shortDate(v.created_at)}
                </span>
              </li>
            ))}
          </ul>
          {visits.length > SHOWN && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-orange underline underline-offset-4"
            >
              {all ? "SHOW LESS" : `SHOW ALL ${visits.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
