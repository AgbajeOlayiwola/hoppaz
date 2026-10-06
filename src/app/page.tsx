"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bus, Plus, Users } from "lucide-react";
import clsx from "clsx";
import Wordmark from "@/components/Wordmark";
import AreaPicker from "@/components/AreaPicker";
import EventCard from "@/components/EventCard";
import HopSheet from "@/components/HopSheet";
import TitleSequence from "@/components/TitleSequence";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import { useEvents, useHop } from "@/lib/useEvents";
import { useCheckin } from "@/lib/useCheckin";
import { useCrew } from "@/lib/useCrew";
import { levelFor } from "@/lib/brand";
import { haversineKm } from "@/lib/geo";
import { busPosition } from "@/lib/busPosition";
import { crowdAt, timeSlots } from "@/lib/crowd";

// MapLibre touches window on import, so it stays out of the server bundle.
const NightMap = dynamic(() => import("@/components/map/NightMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-ink">
      <span className="font-mono text-[10px] tracking-[0.2em] text-dim">LOADING LAGOS…</span>
    </div>
  ),
});

export default function MapPage() {
  const {
    fix, radiusKm, setRadius, showCrew, toggleCrew, seenIntro, markIntroSeen, seenTitle, setSeenTitle, look,
  } = useHoppaz();
  const { userId, profile, refresh } = useSession();
  const { events, demo } = useEvents(fix, radiusKm);
  const hop = useHop();
  const { crew } = useCrew(userId);
  const { done, busy, checkIn } = useCheckin(userId, refresh);

  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hopOpen, setHopOpen] = useState(false);

  // The bus moves on the schedule, so re-place it every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const bus = useMemo(() => busPosition(hop, new Date(now)), [hop, now]);
  const [busFocus, setBusFocus] = useState(0);

  // The heat map's clock: NOW is live check-ins, the other slots are expected.
  const slots = useMemo(() => timeSlots(events, now), [events, now]);
  const [slotIdx, setSlotIdx] = useState(0);
  const slot = slots[Math.min(slotIdx, slots.length - 1)];
  const popping = useMemo(
    () => events.filter((e) => crowdAt(e, slot.at, slot.live) >= 60).length,
    [events, slot]
  );

  // The store rehydrates from localStorage on the client only, so wait a tick
  // before deciding whether the titles play, or the server HTML would disagree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titles = mounted && !seenTitle;
  const signNames = useMemo(
    () => [...events].sort((a, b) => b.heat - a.heat).slice(0, 12).map((e) => e.title),
    [events]
  );

  // First open with no location: ask once, do not nag. Not over the titles.
  useEffect(() => {
    if (!mounted || !seenTitle) return;
    if (!fix && !seenIntro) {
      const t = setTimeout(() => {
        setPicking(true);
        markIntroSeen();
      }, 600);
      return () => clearTimeout(t);
    }
  }, [mounted, seenTitle, fix, seenIntro, markIntroSeen]);

  const closeCard = useCallback(() => setSelected(null), []);
  const event = useMemo(() => events.find((e) => e.id === selected) ?? null, [events, selected]);
  const inRange = useMemo(
    () => (fix ? events.filter((e) => e.distance_m / 1000 <= radiusKm) : events),
    [events, fix, radiusKm]
  );
  const isHopStop = useMemo(() => {
    if (!event || !hop) return false;
    return hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2);
  }, [event, hop]);

  const xp = profile?.xp ?? 0;
  const lvl = levelFor(xp);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <NightMap
        events={events}
        hopStops={hop?.stops ?? []}
        fix={fix}
        radiusKm={radiusKm}
        crew={showCrew ? crew : []}
        myLook={profile?.avatar ?? look}
        bus={bus}
        busFocus={busFocus}
        at={slot.at}
        live={slot.live}
        onClear={() => setSelected(null)}
        play={mounted && seenTitle}
        selectedId={selected}
        onSelect={setSelected}
        onHopSelect={() => setHopOpen(true)}
      />

      {/* -------------------------------------------------------- top HUD -- */}
      <div className="pad-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-2 px-3.5">
        <div className="pointer-events-auto">
          <Wordmark />
        </div>
        <Link
          href="/me"
          className="pointer-events-auto min-w-[124px] rounded border border-line bg-ink-2/92 px-2.5 py-1.5 backdrop-blur"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[11px] font-black tracking-wider text-orange">
              {lvl.name}
            </span>
            <span className="font-mono text-[10px] font-bold tabular-nums text-dim">{xp} XP</span>
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-line">
            <i
              className="block h-full bg-orange"
              style={{ width: `${Math.round(lvl.progress * 100)}%` }}
            />
          </span>
        </Link>
        <div className="flex-1" />
        {bus && (
          <button
            onClick={() => setBusFocus((n) => n + 1)}
            aria-label={`Where is the bus: ${bus.label.toLowerCase()}`}
            title="Where is the bus"
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded border border-violet bg-ink-2/92 text-cream backdrop-blur"
          >
            <Bus size={15} />
          </button>
        )}
        <button
          onClick={toggleCrew}
          aria-pressed={showCrew}
          aria-label="Show crew on the map"
          className={clsx(
            "pointer-events-auto grid h-9 w-9 place-items-center rounded border backdrop-blur",
            showCrew
              ? "border-orange bg-orange text-ink"
              : "border-line bg-ink-2/92 text-cream"
          )}
        >
          <Users size={15} />
        </button>
      </div>

      {/* ---------------------------------------------------- bottom HUD -- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-20 flex flex-col gap-2 px-3.5">
        {demo && (
          <p className="pointer-events-auto self-start rounded border border-violet/60 bg-ink-2/92 px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] text-[#A98CFF] backdrop-blur">
            DEMO NIGHT · NOT CONNECTED TO THE DATABASE
          </p>
        )}

        <div className="pointer-events-auto rounded border border-line bg-ink-2/94 px-3 py-2 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <span className="label mb-0">Heat · {slot.live ? "live from check-ins" : "expected"}</span>
            <span className="font-mono text-[10px] font-bold text-orange">
              {popping ? `${popping} POPPING` : slot.live ? "QUIET RIGHT NOW" : "NOTHING PEAKING"}
            </span>
          </div>
          <div role="radiogroup" aria-label="Heat map time" className="-mx-1 mt-1.5 flex gap-1 overflow-x-auto px-1">
            {slots.map((s, i) => (
              <button
                key={s.at + s.label}
                role="radio"
                aria-checked={slot === s}
                onClick={() => setSlotIdx(i)}
                className={clsx(
                  "flex-none rounded-sm border px-2 py-1 font-mono text-[9px] font-bold tracking-[0.08em]",
                  slot === s ? "border-orange bg-orange text-ink" : "border-line text-dim"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5 rounded border border-line bg-ink-2/94 px-3 py-2 backdrop-blur">
          <label htmlFor="rad" className="label mb-0 whitespace-nowrap">
            Radius
          </label>
          <input
            id="rad"
            type="range"
            min={2}
            max={40}
            step={1}
            value={radiusKm}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="h-4 min-w-0 flex-1 cursor-pointer accent-orange"
          />
          <span className="min-w-[72px] text-right font-mono text-[11px] font-bold tabular-nums text-orange">
            {radiusKm} km · {inRange.length}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5 rounded border border-line bg-ink-2/94 px-3 py-2 backdrop-blur">
          <span className="label mb-0 whitespace-nowrap">You are in</span>
          <span className="min-w-0 flex-1 truncate font-display text-xs font-black">
            {fix?.area ?? "— pick an area"}
          </span>
          <button
            onClick={() => setPicking(true)}
            className="border-b border-orange pb-px font-mono text-[9px] font-bold tracking-widest text-orange"
          >
            CHANGE
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ FAB -- */}
      <Link
        href="/drop"
        aria-label="Drop a flyer on the map"
        className="absolute bottom-[178px] right-3.5 z-20 grid h-12 w-12 place-items-center rounded-full
                   bg-orange text-cream shadow-chunk active:translate-y-0.5 active:shadow-chunk-sm"
      >
        <Plus size={22} strokeWidth={3} />
      </Link>

      {/* --------------------------------------------------------- sheets -- */}
      <AreaPicker open={picking} onClose={() => setPicking(false)} />
      {event && (
        <EventCard
          event={event}
          fix={fix}
          radiusKm={radiusKm}
          userId={userId}
          checkedIn={done.has(event.id)}
          busy={busy === event.id}
          onCheckIn={() => checkIn(event, fix)}
          onClose={closeCard}
          isHopStop={isHopStop}
        />
      )}
      {hopOpen && <HopSheet hop={hop} fix={fix} onClose={() => setHopOpen(false)} />}
      {titles && <TitleSequence signs={signNames} onDone={() => setSeenTitle(true)} />}
    </div>
  );
}
