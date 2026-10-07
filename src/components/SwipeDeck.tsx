"use client";

import { useCallback, useRef, useState } from "react";
import { Check, X, Info, MapPin } from "lucide-react";
import HeatBar from "./HeatBar";
import { areaByName, clockLagos, dayLagos, naira, travelEstimate } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

type Decision = "in" | "pass";
const THRESHOLD = 110;

export default function SwipeDeck({
  events,
  fix,
  onDecide,
}: {
  events: EventRow[];
  fix: { lat: number; lng: number; area: string | null } | null;
  onDecide: (event: EventRow, decision: Decision) => void;
}) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const top = events[0];
  const next = events[1];

  const commit = useCallback(
    (decision: Decision) => {
      if (!top || leaving) return;
      setLeaving(decision);
      setOpen(false);
      // Let the card clear the screen before the list shifts under it.
      window.setTimeout(() => {
        onDecide(top, decision);
        setLeaving(null);
        setDrag({ dx: 0, dy: 0, active: false });
      }, 190);
    },
    [top, leaving, onDecide]
  );

  if (!top) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="font-display text-xl font-black">That is the whole night</p>
          <p className="hint mt-2 max-w-[34ch]">
            You have been through everything on tonight&apos;s list. Check the map for heat, or drop
            a flyer nobody has posted yet.
          </p>
        </div>
      </div>
    );
  }

  const tilt = drag.dx / 18;
  const intent: Decision | null =
    leaving ?? (drag.dx > 56 ? "in" : drag.dx < -56 ? "pass" : null);
  const offX = leaving ? (leaving === "in" ? 520 : -520) : drag.dx;

  return (
    <div className="relative flex h-full select-none items-center justify-center pb-20">
      {/* the card behind, so the deck has depth */}
      {next && (
        <article className="absolute inset-x-0 mx-auto max-w-md translate-y-2 scale-[0.96] opacity-50">
          <CardFace event={next} fix={fix} open={false} />
        </article>
      )}

      <article
        className="absolute inset-x-0 mx-auto max-w-md touch-none"
        style={{
          transform: `translate(${offX}px, ${leaving ? -24 : drag.dy}px) rotate(${leaving ? (leaving === "in" ? 16 : -16) : tilt}deg)`,
          transition: drag.active ? "none" : "transform .19s cubic-bezier(.2,.8,.2,1)",
          opacity: leaving ? 0.2 : 1,
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button,a")) return;
          start.current = { x: e.clientX, y: e.clientY };
          setDrag({ dx: 0, dy: 0, active: true });
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setDrag({
            dx: e.clientX - start.current.x,
            dy: (e.clientY - start.current.y) * 0.35,
            active: true,
          });
        }}
        onPointerUp={() => {
          if (!start.current) return;
          const { dx } = drag;
          start.current = null;
          if (dx > THRESHOLD) commit("in");
          else if (dx < -THRESHOLD) commit("pass");
          else setDrag({ dx: 0, dy: 0, active: false });
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag({ dx: 0, dy: 0, active: false });
        }}
      >
        <CardFace event={top} fix={fix} open={open} intent={intent} />
      </article>

      {/* controls: the deck must be usable without dragging */}
      <div className="absolute inset-x-0 bottom-3 z-10 mx-auto flex max-w-md items-center justify-center gap-3">
        <button
          onClick={() => commit("pass")}
          aria-label="Pass on this one"
          className="grid h-14 w-14 place-items-center rounded-full border border-line bg-ink-2 text-dim active:translate-y-0.5"
        >
          <X size={24} strokeWidth={2.6} />
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="More information"
          aria-expanded={open}
          className="grid h-11 w-11 place-items-center rounded-full border border-line bg-ink-2 text-cream active:translate-y-0.5"
        >
          <Info size={18} />
        </button>
        <button
          onClick={() => commit("in")}
          aria-label="I am in"
          className="grid h-14 w-14 place-items-center rounded-full bg-orange text-cream shadow-chunk active:translate-y-0.5 active:shadow-chunk-sm"
        >
          <Check size={24} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

function CardFace({
  event,
  fix,
  open,
  intent,
}: {
  event: EventRow;
  fix: { lat: number; lng: number; area: string | null } | null;
  open: boolean;
  intent?: Decision | null;
}) {
  const here = fix ? { ...fix, side: areaByName(fix.area)?.side } : null;
  const trip = here
    ? travelEstimate(here, { lat: event.lat, lng: event.lng, side: areaByName(event.area)?.side })
    : null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-ink-2 p-5">
      {/* the stamp that lands as you drag */}
      {intent && (
        <span
          className={`absolute right-4 top-4 z-10 rotate-6 rounded border-2 px-2.5 py-1 font-display text-sm font-black tracking-widest ${
            intent === "in" ? "border-orange text-orange" : "border-dim text-dim"
          }`}
        >
          {intent === "in" ? "I'M IN" : "NAH"}
        </span>
      )}

      <p className="seclabel">{dayLagos(event.starts_at)}</p>
      <h2 className="mt-1.5 font-display text-2xl font-black leading-[1.05]">{event.title}</h2>
      <p className="hint mt-1.5 flex items-center gap-1.5">
        <MapPin size={11} aria-hidden /> {event.venue_name} · {event.area}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="tag tag-o">{event.vibe}</span>
        <span className="tag">{clockLagos(event.starts_at)}</span>
        <span className="tag">{naira(event.price_naira)}</span>
        {trip && <span className="tag">{trip.km.toFixed(1)} km</span>}
      </div>

      <HeatBar
        heat={event.heat}
        right={event.swipes_in ? `${event.swipes_in} in` : undefined}
      />

      {open && (
        <div className="mt-4 border-t border-line pt-3.5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Fact k="Gate fee" v={naira(event.price_naira)} />
            <Fact k="Doors" v={clockLagos(event.starts_at)} />
            {trip && <Fact k="Distance" v={`${trip.km.toFixed(1)} km`} />}
            {trip && <Fact k="Est. travel" v={`~${trip.minutes} min`} />}
            {trip?.crossesBridge && <Fact k="Route" v="Over the bridge" />}
            <Fact k="Saying they are in" v={String(event.swipes_in ?? 0)} />
            <Fact k="Checked in" v={String(event.checkins ?? 0)} />
            <Fact
              k="Listed by"
              v={
                event.source === "hopper"
                  ? "A Hopper"
                  : event.source === "hoppaz"
                    ? "Hoppaz"
                    : event.source === "instagram"
                      ? "Instagram"
                      : "The venue"
              }
            />
          </dl>
          {event.ig_url && (
            <a
              href={event.ig_url}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-ghost mt-3.5 w-full"
            >
              OPEN EVENT LISTING
            </a>
          )}
        </div>
      )}

      <p className="hint mt-4 text-center text-[10px] tracking-[0.12em]">
        SWIPE RIGHT IF YOU ARE IN · LEFT IF YOU ARE NOT
      </p>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="label mb-0.5">{k}</dt>
      <dd className="truncate font-display text-[13px] font-bold">{v}</dd>
    </div>
  );
}
