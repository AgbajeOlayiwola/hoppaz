"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Camera, ExternalLink, MessageSquare, X } from "lucide-react";
import clsx from "clsx";
import { CHECKIN_RADIUS_M } from "@/lib/useCheckin";
import { useEventFeed } from "@/lib/useEventFeed";
import { useToast } from "@/lib/store";
import { crowdAt, crowdLevel, nightProfile, TONE_HEX } from "@/lib/crowd";
import { areaByName, clockLagos, clockShort, dayLagos, naira, travelEstimate } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

const SOURCE_LABEL: Record<EventRow["source"], string> = {
  hoppaz: "Hoppaz pick",
  hopper: "Dropped by a Hopper",
  instagram: "From Instagram",
  partner: "Listing",
};

/**
 * Tapping an event opens this: a card floating over the map, not a sheet that
 * takes the screen. The top is the decision (price, time, how long to get
 * there, how busy it is); everything below scrolls inside the card.
 */
export default function EventCard({
  event,
  fix,
  radiusKm,
  userId,
  checkedIn,
  busy,
  onCheckIn,
  onClose,
  isHopStop,
}: {
  event: EventRow;
  fix: { lat: number; lng: number; area: string | null } | null;
  radiusKm: number;
  userId: string | null;
  checkedIn: boolean;
  busy: boolean;
  onCheckIn: () => void;
  onClose: () => void;
  isHopStop: boolean;
}) {
  const say = useToast((s) => s.say);
  const { photos, chat, uploading, upload } = useEventFeed(event.id, userId);
  const file = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event.id, onClose]);

  const km = event.distance_m / 1000;
  const here = fix ? { ...fix, side: areaByName(fix.area)?.side } : null;
  const trip = here ? travelEstimate(here, { lat: event.lat, lng: event.lng, side: areaByName(event.area)?.side }) : null;
  const closeEnough = km * 1000 <= CHECKIN_RADIUS_M;

  const now = Date.now();
  const score = crowdAt(event, now, true);
  const level = crowdLevel(event, now, score);
  const profile = nightProfile(event);
  const peak = Math.max(1, ...profile.map((p) => p.score));

  return (
    <div
      role="dialog"
      aria-label={event.title}
      className="absolute inset-x-3 bottom-3 z-40 flex max-h-[64%] flex-col overflow-hidden rounded-lg border border-line bg-ink-2 shadow-sheet animate-rise"
    >
      {/* ---------------------------------------------- fixed header -- */}
      <div className="relative flex-none border-b border-line px-4 pb-3 pt-3.5">
        <button onClick={onClose} aria-label="Close" className="absolute right-2 top-2 grid h-8 w-8 place-items-center text-dim hover:text-cream">
          <X size={16} />
        </button>
        <p className="seclabel pr-8">{SOURCE_LABEL[event.source]}</p>
        <h2 className="mt-0.5 pr-8 font-display text-lg font-black leading-tight">{event.title}</h2>
        <p className="hint">
          {event.venue_name} · {event.area} · {dayLagos(event.starts_at)} from {clockLagos(event.starts_at)}
        </p>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Stat label="Price" value={naira(event.price_naira)} hot />
          <Stat
            label={trip?.crossesBridge ? "Over the bridge" : "To get there"}
            value={trip ? `~${trip.minutes} MIN` : "SET LOCATION"}
            sub={trip ? `${trip.km.toFixed(1)} km` : undefined}
          />
          <Stat
            label="Right now"
            value={level.label}
            dot={TONE_HEX[level.tone]}
            sub={event.here_now ? `${event.here_now} checked in` : undefined}
          />
        </div>

        <div className="mt-2.5 flex gap-2">
          <button className="btn flex-1" onClick={onCheckIn} disabled={checkedIn || !closeEnough || busy}>
            {checkedIn ? "CHECKED IN ✓" : busy ? "CHECKING…" : closeEnough ? "CHECK IN · +50 XP" : "GET CLOSER TO CHECK IN"}
          </button>
          <Link href={`/chat?c=${event.id}`} className="btn btn-ghost flex-none" aria-label="Event chat">
            <MessageSquare size={14} />
          </Link>
          {event.ig_url && (
            <a href={event.ig_url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost flex-none" aria-label="Open the Instagram post">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* ------------------------------------------ scrolls in the card -- */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="tag tag-o">{event.vibe}</span>
          {isHopStop && <span className="tag tag-v">HOP STOP</span>}
          {fix && km > radiusKm && <span className="tag">OUTSIDE YOUR {radiusKm} KM</span>}
          {(event.swipes_in ?? 0) > 0 && <span className="tag">{event.swipes_in} SAID THEY&apos;RE IN</span>}
        </div>

        {/* How the night goes: expected crowd hour by hour */}
        <p className="seclabel mt-4">How the night goes · expected</p>
        <div className="mt-2 flex h-20 items-end gap-1" aria-label="Expected crowd through the night">
          {profile.map((p) => {
            const isNow = now >= p.at && now < p.at + 3.6e6;
            return (
              <div key={p.at} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={clsx("w-full rounded-t-sm", isNow ? "bg-cream" : p.score >= 60 ? "bg-orange" : "bg-orange-ember")}
                  style={{ height: `${Math.max(4, (p.score / peak) * 56)}px` }}
                  title={`${p.label}: ${crowdLevel(event, p.at, p.score).label}`}
                />
                <span className={clsx("font-mono text-[8px] font-bold", isNow ? "text-cream" : "text-dim")}>{p.label}</span>
              </div>
            );
          })}
        </div>
        <p className="hint mt-1.5">
          Built from how many Hoppers swiped in and how Lagos nights usually run. Peaks around{" "}
          {clockShort(new Date(profile.reduce((a, b) => (b.score > a.score ? b : a)).at).toISOString())}.
          {(event.checkins ?? 0) > 0 && ` ${event.checkins} checked in tonight so far.`}
        </p>

        {/* Pictures */}
        <div className="mt-5 flex items-center justify-between">
          <p className="seclabel">Pictures from tonight</p>
          {checkedIn && (
            <>
              <button
                className="flex items-center gap-1.5 border-b border-orange pb-px font-mono text-[9px] font-bold tracking-widest text-orange disabled:opacity-50"
                onClick={() => file.current?.click()}
                disabled={uploading}
              >
                <Camera size={12} /> {uploading ? "SENDING…" : "ADD ONE"}
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const err = await upload(f);
                  say(err ?? "PHOTO POSTED");
                }}
              />
            </>
          )}
        </div>
        {event.flyer_url || photos.length ? (
          <div className="-mx-4 mt-2 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
            {event.flyer_url && <Photo src={event.flyer_url} alt={`${event.title} flyer`} />}
            {photos.map((p) => (
              <Photo key={p.id} src={p.url} alt={`From ${event.title}`} />
            ))}
          </div>
        ) : (
          <p className="hint mt-1.5">
            No pictures yet. {checkedIn ? "You're here: post the first one." : "Hoppers who check in can post them here."}
          </p>
        )}

        {/* The room */}
        <div className="mt-5 flex items-center justify-between">
          <p className="seclabel">On the ground</p>
          <Link href={`/chat?c=${event.id}`} className="border-b border-orange pb-px font-mono text-[9px] font-bold tracking-widest text-orange">
            OPEN CHAT
          </Link>
        </div>
        {chat.length ? (
          <div className="mt-1.5">
            {chat.map((m) => (
              <p key={m.id} className="border-b border-line py-2 text-[13px] leading-snug last:border-0">
                <b className="font-display font-black text-orange">{m.author_name ?? "A Hopper"}</b>{" "}
                <span className="text-cream/90">{m.body}</span>
                <span className="ml-1.5 font-mono text-[9px] text-dim">{clockShort(m.created_at)}</span>
              </p>
            ))}
          </div>
        ) : (
          <p className="hint mt-1.5">Nobody has said anything yet. Ask who&apos;s going.</p>
        )}

        {!checkedIn && !closeEnough && trip && (
          <p className="hint mt-4">
            Check-in opens inside 1.5 km of the venue, and the server checks it. You are {trip.km.toFixed(1)} km out.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, hot, dot }: { label: string; value: string; sub?: string; hot?: boolean; dot?: string }) {
  return (
    <div className="min-w-0 rounded border border-line bg-ink px-2 py-1.5">
      <p className="truncate font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-dim">{label}</p>
      <p className={clsx("mt-0.5 flex items-center gap-1 truncate font-display text-[12px] font-black", hot ? "text-orange" : "text-cream")}>
        {dot && <i className="inline-block h-2 w-2 flex-none rotate-45" style={{ background: dot }} />}
        {value}
      </p>
      {sub && <p className="truncate font-mono text-[9px] text-dim">{sub}</p>}
    </div>
  );
}

function Photo({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- user uploads from Supabase storage, sizes unknown
    <img src={src} alt={alt} loading="lazy" className="h-40 w-32 flex-none snap-start rounded-md border border-line object-cover" />
  );
}
