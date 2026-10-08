"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import AreaPicker from "@/components/AreaPicker";
import EventCard from "@/components/EventCard";
import HopSheet from "@/components/HopSheet";
import TitleSequence from "@/components/TitleSequence";
import FilterCard from "@/components/FilterCard";
import TopChrome from "@/components/map-chrome/TopChrome";
import TimeScrubber from "@/components/map-chrome/TimeScrubber";
import { EmptyDay, ErrorLine } from "@/components/map-chrome/MapNotice";
import {
  conductorLine,
  dayTag,
  defaultStop,
  nearestStop,
  scrubStops,
  scrubStrengths,
  scrubTicks,
} from "@/components/map-chrome/scrub";
import { TODAY, countByDay, matchesType, nightOf, todayKey, type DateFilter } from "@/lib/filters";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import { useEvents, useHop } from "@/lib/useEvents";
import { useCheckin } from "@/lib/useCheckin";
import { useGameDashboard } from "@/lib/game";
import { haversineKm } from "@/lib/geo";
import type { HopStop } from "@/lib/types";
import { busPosition } from "@/lib/busPosition";
import { useCollectibleEventIds } from "@/lib/useCollectibles";
import { DEMO_DROP_TITLES } from "@/lib/demoData";

// MapLibre touches window on import, so it stays out of the server bundle.
const NightMap = dynamic(() => import("@/components/map/NightMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-ink">
      <span className="font-mono text-[10px] tracking-[0.2em] text-dim">LOADING LAGOS…</span>
    </div>
  ),
});

// One stable empty list, so memo deps do not change on every render.
const NO_TYPES: string[] = [];
const NO_STOPS: HopStop[] = [];

/** Open on a day with something on, once per page load, and never over a day the Hopper chose. */
let firstDayChosen = false;

const IS_DEV = process.env.NODE_ENV !== "production";

export default function MapPage() {
  const {
    fix, radiusKm, seenIntro, markIntroSeen, seenTitle, setSeenTitle,
    dateFilter, setDateFilter, types, setTypes, look,
  } = useHoppaz();
  const { userId, refresh, profile } = useSession();
  const { events: allEvents, demo, ready, failed, reload } = useEvents(fix, radiusKm);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);
  // Only the streak is needed here, so ask for the lite read (one call, signed-in Hoppers only).
  const { stats } = useGameDashboard(userId, { lite: true });
  const streak = Number(stats?.daily_streak ?? 0) || 0;

  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hopOpen, setHopOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);

  // The store rehydrates from localStorage on the client only, so anything that
  // reads it waits a tick, or the server HTML would disagree with the first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titles = mounted && !seenTitle;

  // Clocks: the bus and the scrubber re-place themselves every half minute.
  const [now, setNow] = useState(() => Date.now());

  /* ------------------------------------------------------------- the day -- */
  const shownTypes = mounted ? types : NO_TYPES;
  const dayKey = mounted && dateFilter.kind === "night" ? dateFilter.date : todayKey();
  const todayStr = nightOf(now);
  const today = dayKey === todayStr;
  const dayFilter: DateFilter = useMemo(() => ({ kind: "night", date: dayKey }), [dayKey]);

  // Rail counts: everything loaded, narrowed by type only (not by distance).
  const typed = useMemo(() => allEvents.filter((e) => matchesType(e, shownTypes)), [allEvents, shownTypes]);
  const counts = useMemo(() => countByDay(typed), [typed]);
  // Everything on the map (pins, heat, the scrubber) works off the one chosen day.
  const events = useMemo(() => typed.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey), [typed, dayKey]);

  const pickDay = useCallback(
    (f: DateFilter) => {
      setDateFilter(f);
      setSelected(null);
    },
    [setDateFilter]
  );

  // Never leave the map on a day that is over: past days and any leftover "any day" snap to today.
  useEffect(() => {
    const snap = () => {
      const d = useHoppaz.getState().dateFilter;
      if (d.kind !== "night" || d.date < todayKey()) setDateFilter(TODAY());
    };
    snap();
    const onVisible = () => document.visibilityState === "visible" && snap();
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => {
      setNow(Date.now());
      snap();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
    };
  }, [setDateFilter]);

  /* ------------------------------------------------ opening an event (?e=) -- */
  const deepLink = useRef<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("e");
    if (id) {
      deepLink.current = id;
      setSelected(id);
    }
  }, []);

  // Once events are in, put the rail on that event's day so its pin is on the map.
  useEffect(() => {
    const id = deepLink.current;
    if (!id || !ready) return;
    deepLink.current = null;
    const ev = allEvents.find((e) => e.id === id);
    if (!ev) {
      setSelected(null); // gone or finished: drop the link quietly
      return;
    }
    setDateFilter({ kind: "night", date: nightOf(Date.parse(ev.starts_at)) });
    if (useHoppaz.getState().types.length && !useHoppaz.getState().types.includes(ev.vibe)) setTypes([]);
  }, [ready, allEvents, setDateFilter, setTypes]);

  // The URL follows the open event, so the share button's link is always the one you are looking at.
  useEffect(() => {
    if (!mounted) return;
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("e", selected);
    else url.searchParams.delete("e");
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", next);
    }
  }, [selected, mounted]);

  // First load: if today is empty, open on the next day that has something on.
  useEffect(() => {
    // A failed first load has nothing to look at yet: wait for "try again" to bring events in.
    if (!ready || firstDayChosen || (failed && allEvents.length === 0)) return;
    firstDayChosen = true;
    if (deepLink.current) return;
    const d = useHoppaz.getState().dateFilter;
    const t = todayKey();
    if (d.kind !== "night" || d.date !== t || counts[t]) return;
    const next = Object.keys(counts)
      .filter((k) => k > t && counts[k] > 0)
      .sort()[0];
    if (next) setDateFilter({ kind: "night", date: next });
  }, [ready, failed, allEvents.length, counts, setDateFilter]);

  /* ---------------------------------------------------------- the scrubber -- */
  const [chosen, setChosen] = useState<{ day: string; at: number; live: boolean } | null>(null);
  const stops = useMemo(() => scrubStops(events, dayKey, now), [events, dayKey, now]);
  const stopIdx = useMemo(() => {
    if (chosen && chosen.day === dayKey) {
      return chosen.live && stops[0]?.live ? 0 : nearestStop(stops, chosen.at);
    }
    return defaultStop(stops, events, now, today);
  }, [chosen, dayKey, stops, events, now, today]);
  const slot = stops[Math.min(stopIdx, stops.length - 1)];
  const strengths = useMemo(() => scrubStrengths(events, stops), [events, stops]);
  const ticks = useMemo(() => scrubTicks(stops, today), [stops, today]);
  const onStop = useCallback(
    (i: number) => {
      const s = stops[i];
      if (s) setChosen({ day: dayKey, at: s.t, live: s.live });
    },
    [stops, dayKey]
  );

  /* ----------------------------------------------------------- drops, bus -- */
  const liveDropIds = useCollectibleEventIds(allEvents.map((e) => e.id));
  // Development has no database, so a few sample events carry a drop flag.
  const dropIds = useMemo(
    () => (demo ? allEvents.filter((e) => DEMO_DROP_TITLES.includes(e.title)).map((e) => e.id) : liveDropIds),
    [demo, allEvents, liveDropIds]
  );
  const dropSet = useMemo(() => new Set(dropIds), [dropIds]);

  const bus = useMemo(() => busPosition(hop, new Date(now)), [hop, now]);
  const [busFocus, setBusFocus] = useState(0);
  // The route and the bus button belong to Hop day only. Other days the bus sits parked and opens the Hop.
  const hopActive = !!hop && hop.hop_date === dayKey;

  // The first-run title plays once; after it, ask for a location once, never nag.
  const signNames = useMemo(
    () => [...allEvents].sort((a, b) => b.heat - a.heat).slice(0, 12).map((e) => e.title),
    [allEvents]
  );
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
  const event = useMemo(() => allEvents.find((e) => e.id === selected) ?? null, [allEvents, selected]);
  const isHopStop = useMemo(() => {
    if (!event || !hop) return false;
    return hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2);
  }, [event, hop]);

  const nextBusy = useMemo(
    () =>
      Object.keys(counts)
        .filter((k) => k > dayKey && counts[k] > 0)
        .sort()[0] ?? null,
    [counts, dayKey]
  );

  /* ------------------------------------------- how much of the map the chrome covers -- */
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState({ top: 132, bottom: 150 });
  useEffect(() => {
    const measure = () =>
      setHud((h) => {
        const top = Math.round(topRef.current?.getBoundingClientRect().height ?? h.top);
        const bottom = Math.round(bottomRef.current?.getBoundingClientRect().height ?? h.bottom);
        return top === h.top && bottom === h.bottom ? h : { top, bottom };
      });
    measure();
    const ro = new ResizeObserver(measure);
    if (topRef.current) ro.observe(topRef.current);
    if (bottomRef.current) ro.observe(bottomRef.current);
    return () => ro.disconnect();
  }, [mounted, event, todayStr]);

  const noLiveEvents = failed && allEvents.length === 0;
  const line = !ready
    ? "Checking what's on…"
    : noLiveEvents
      ? "Nothing to show yet."
      : conductorLine({ events, dropEventIds: dropSet, dayKey, now });
  const showEmpty = ready && !noLiveEvents && events.length === 0 && !filtering && !event;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      // An open event docks on the right, from just under the top chrome.
      style={{ ["--hz-side-top" as string]: `${hud.top + 4}px` }}
    >
      <NightMap
        events={events}
        collectibleEventIds={dropIds}
        hopStops={hop?.stops ?? NO_STOPS}
        fix={fix}
        radiusKm={radiusKm}
        bus={bus}
        busFocus={busFocus}
        at={slot?.t ?? now}
        live={slot?.live ?? true}
        onClear={() => setSelected(null)}
        fitKey={`${dayKey}|${shownTypes.join(",")}`}
        selectedId={selected}
        onSelect={setSelected}
        onHopSelect={() => setHopOpen(true)}
        hopActive={hopActive}
        hopDate={hop?.hop_date ?? null}
        onBus={() => setHopOpen(true)}
        hudTop={hud.top}
        hudBottom={hud.bottom}
        play={mounted && seenTitle}
        myLook={profile?.avatar ?? look}
        sidePanel={!!event}
      />

      {/* The chrome is all "now" (today's rail, the clock), so it draws on the client only: a page
          prerendered yesterday must not hydrate against today's rail. */}

      {/* -------------------------------------------------------------- top -- */}
      {mounted && (
        <TopChrome
          key={todayStr} /* a new day (6am) rebuilds the 14-day rail */
          hudRef={topRef}
          day={dayFilter}
          onDay={pickDay}
          counts={counts}
          types={shownTypes}
          onRemoveType={(t) => setTypes(types.filter((x) => x !== t))}
          onClearTypes={() => setTypes([])}
          streak={streak}
          onFilter={() => {
            setSelected(null);
            setFiltering(true);
          }}
          onLocate={() => {
            setSelected(null);
            setPicking(true);
          }}
          showBus={hopActive && !!bus}
          onBus={() => setBusFocus((n) => n + 1)}
        >
          {noLiveEvents && <ErrorLine onRetry={() => void reload()} />}
        </TopChrome>
      )}

      {showEmpty && (
        <EmptyDay
          filtered={shownTypes.length > 0}
          nextLabel={nextBusy ? dayTag(nextBusy) : null}
          onNext={() => nextBusy && pickDay({ kind: "night", date: nextBusy })}
        />
      )}

      {/* ----------------------------------------------------------- bottom -- */}
      {mounted && !event && (
        <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3.5 pb-2.5">
          <div className="mx-auto flex max-w-[560px] flex-col items-end gap-2.5">
            <Link href="/drop" aria-label="Post a flyer" className="btn pointer-events-auto px-3.5 py-2.5">
              <Plus size={16} strokeWidth={3} aria-hidden />
              Post a flyer
            </Link>
            {slot && (
              <TimeScrubber
                className="pointer-events-auto w-full"
                stops={stops}
                index={stopIdx}
                onIndex={onStop}
                strengths={strengths}
                ticks={ticks}
                dayKey={dayKey}
                today={today}
                line={line}
                dimLine={!ready || noLiveEvents}
                sample={IS_DEV && demo}
              />
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- sheets -- */}
      <AreaPicker open={picking} onClose={() => setPicking(false)} showRadius />
      {event && (
        <EventCard
          event={event}
          fix={fix}
          radiusKm={radiusKm}
          userId={userId}
          checkedIn={done.has(event.id)}
          checkedAt={checkedAt[event.id] ?? null}
          busy={busy === event.id}
          onCheckIn={() => checkIn(event, fix)}
          onClose={closeCard}
          isHopStop={isHopStop}
          placement="side"
        />
      )}
      {filtering && (
        <FilterCard
          types={shownTypes}
          count={events.length}
          onTypes={setTypes}
          onClear={() => setTypes([])}
          onClose={() => setFiltering(false)}
        />
      )}
      {hopOpen && <HopSheet hop={hop} fix={fix} onClose={() => setHopOpen(false)} />}
      {titles && <TitleSequence signs={signNames} onDone={() => setSeenTitle(true)} />}
    </div>
  );
}
