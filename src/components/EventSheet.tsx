"use client";

import { ExternalLink, MessageSquare } from "lucide-react";
import Link from "next/link";
import Sheet from "./Sheet";
import HeatBar from "./HeatBar";
import { CHECKIN_RADIUS_M } from "@/lib/useCheckin";
import { areaByName, clockLagos, dayLagos, naira, travelEstimate } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

const SOURCE_LABEL: Record<EventRow["source"], string> = {
  hoppaz: "Hoppaz pick",
  hopper: "Dropped by a Hopper",
  instagram: "From Instagram",
  partner: "Tonight",
};

export default function EventSheet({
  event,
  fix,
  radiusKm,
  checkedIn,
  busy,
  onCheckIn,
  onClose,
  isHopStop,
}: {
  event: EventRow | null;
  fix: { lat: number; lng: number; area: string | null } | null;
  radiusKm: number;
  checkedIn: boolean;
  busy: boolean;
  onCheckIn: () => void;
  onClose: () => void;
  isHopStop: boolean;
}) {
  if (!event) return null;
  const km = event.distance_m / 1000;
  const outOfRange = !!fix && km > radiusKm;

  const here = fix ? { ...fix, side: areaByName(fix.area)?.side } : null;
  const there = { lat: event.lat, lng: event.lng, side: areaByName(event.area)?.side };
  const trip = here ? travelEstimate(here, there) : null;
  const closeEnough = km * 1000 <= CHECKIN_RADIUS_M;

  return (
    <Sheet open onClose={onClose} label={event.title}>
      <p className="seclabel">{SOURCE_LABEL[event.source]}</p>
      <h2 className="mt-1 font-display text-lg font-black leading-tight">{event.title}</h2>
      <p className="hint mt-0.5">
        {event.venue_name} · {event.area} · {dayLagos(event.starts_at)} from{" "}
        {clockLagos(event.starts_at)}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="tag tag-o">{event.vibe}</span>
        <span className="tag">{naira(event.price_naira)}</span>
        {trip && <span className="tag">{trip.km.toFixed(1)} km</span>}
        {trip && (
          <span className="tag">
            ~{trip.minutes} min{trip.crossesBridge ? " over the bridge" : ""}
          </span>
        )}
        {isHopStop && <span className="tag tag-v">HOP STOP</span>}
        {outOfRange && <span className="tag">OUTSIDE YOUR {radiusKm} KM</span>}
      </div>

      <HeatBar
        heat={event.heat}
        right={event.checkins ? `${event.checkins} here now` : undefined}
      />

      <div className="mt-3.5 flex gap-2">
        <button
          className="btn flex-1"
          onClick={onCheckIn}
          disabled={checkedIn || !closeEnough || busy}
        >
          {checkedIn
            ? "CHECKED IN ✓"
            : busy
              ? "CHECKING…"
              : closeEnough
                ? "CHECK IN · +50 XP"
                : "GET CLOSER TO CHECK IN"}
        </button>
        <Link href={`/chat?c=${event.id}`} className="btn btn-ghost flex-none">
          <MessageSquare size={14} />
        </Link>
        {event.ig_url && (
          <a
            href={event.ig_url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-ghost flex-none"
            aria-label="Open the Instagram post"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {!checkedIn && !closeEnough && trip && (
        <p className="hint mt-2">
          Check-in opens inside 1.5 km of the venue, and the server checks it. You are{" "}
          {trip.km.toFixed(1)} km out.
        </p>
      )}
      {!fix && (
        <p className="hint mt-2">Set your location to get distance, travel time and check-in.</p>
      )}
    </Sheet>
  );
}
