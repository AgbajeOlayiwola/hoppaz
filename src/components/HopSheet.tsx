"use client";

import Link from "next/link";
import Sheet from "./Sheet";
import { areaByName, haversineKm, naira } from "@/lib/geo";
import type { Hop } from "@/lib/types";

export default function HopSheet({
  hop,
  fix,
  onClose,
}: {
  hop: Hop | null;
  fix: { lat: number; lng: number; area: string | null } | null;
  onClose: () => void;
}) {
  if (!hop) return null;
  return (
    <Sheet open onClose={onClose} label={hop.name}>
      <p className="seclabel">The Hop · every two weeks</p>
      <h2 className="mt-1 font-display text-lg font-black">{hop.name}</h2>
      <p className="hint mt-0.5">
        {new Date(hop.hop_date).toLocaleDateString("en-NG", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}{" "}
        · {naira(hop.price_naira)} · one bus, four stops, ride home to the mainland
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="tag tag-v">THE BUS IS THE FIFTH PARTY</span>
        <span className="tag tag-o">{hop.boarding}</span>
      </div>

      <div className="mt-3">
        {hop.stops.map((s, i) => {
          const last = i === hop.stops.length - 1;
          const km = fix ? haversineKm(fix.lat, fix.lng, s.lat, s.lng) : null;
          return (
            <div key={s.id} className="flex items-start gap-3 py-1.5">
              <span
                className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full font-display text-[10px] font-black ${
                  last ? "bg-orange text-ink" : "bg-violet text-cream"
                }`}
              >
                {s.idx}
              </span>
              <span className="min-w-0 flex-1">
                <b className="font-display font-black">{s.name}</b>
                <p className="hint">
                  {s.stop_time} · {s.area} · {s.role}
                  {km !== null && ` · ${km.toFixed(1)} km from you`}
                  {areaByName(s.area)?.side === "island" && fix && areaByName(fix.area)?.side === "mainland" && i === 1
                    ? " · over the bridge"
                    : ""}
                </p>
              </span>
            </div>
          );
        })}
      </div>

      <p className="hint mt-2">
        Stops are listed, the bus is the point. Come alone, leave with friends. The bus never
        waits: hop or stay.
      </p>

      <div className="mt-3 flex gap-2">
        {hop.ticket_url ? (
          <a href={hop.ticket_url} target="_blank" rel="noreferrer noopener" className="btn flex-1">
            GET A SEAT
          </a>
        ) : (
          <button className="btn flex-1" disabled>
            TICKETS SOON
          </button>
        )}
        <Link href={`/chat?c=hop-${hop.id}`} className="btn btn-ghost flex-none">
          HOP CHAT
        </Link>
      </div>
    </Sheet>
  );
}
