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
import { isNeedAccount } from "@/lib/accountGate";
import { haversineKm, hasVenue } from "@/lib/geo";
import type { HopStop } from "@/lib/types";
import { busPosition } from "@/lib/busPosition";
import { useCollectibleEventIds } from "@/lib/useCollectibles";
import { DEMO_DROP_TITLES } from "@/lib/demoData";
import NextBar from "@/components/map-chrome/NextBar";
import BoxSheet from "@/components/reveal/BoxSheet";
import Reveal, { type RevealItem, type RevealOutcome } from "@/components/reveal/Reveal";
import CameraHunt from "@/components/CameraHunt";
import type { MapBox } from "@/components/map/NightMap";
import { sentence } from "@/components/event/copy";
import { DEMO, demoDrops, demoReveal } from "@/components/me/demo";
import { dropPhase, opensShort } from "@/components/me/dropTime";
import { NEXT_COUNT, nextEvents } from "@/lib/filters";
import { areaByName, pointFromGeog } from "@/lib/geo";
import { dropsLeft, useGameDrops, type GameDrop } from "@/lib/game";
import { huntItem } from "@/lib/huntItems";
import { useToast } from "@/lib/store";
import { loadDropReceipts } from "@/lib/useCollectibles";
import { useWelcomeBoxes } from "@/lib/useWelcomeBoxes";

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

/** The "N boxes on the map" toast, once per page load: coming back to the map from another tab is not news. */
let boxesAnnounced = false;

const IS_DEV = process.env.NODE_ENV !== "production";

/** A street box this close to you is worth a toast. */
const NEAR_SPAWN_KM = 1.5;

/** "400 m" under a kilometre (to the nearest 10), "1.2 km" after. */
function awayLabel(km: number) {
  const m = Math.round(km * 100) * 10;
  return m < 1000 ? `${Math.max(m, 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

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
  /** The map opens on the next events (NEXT 20); tapping a day switches to that one night. */
  const [mode, setMode] = useState<"next" | "day">("next");
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

  // Rail counts: everything loaded that has a real place, narrowed by type only (not by distance).
  // Leads with no venue yet stay off the map; Today still lists them.
  const typed = useMemo(() => allEvents.filter((e) => hasVenue(e) && matchesType(e, shownTypes)), [allEvents, shownTypes]);
  const counts = useMemo(() => countByDay(typed), [typed]);
  // NEXT 20: the next events from now, whatever night they fall on, so the map never opens empty.
  const next = useMemo(() => nextEvents(typed, NEXT_COUNT, now), [typed, now]);
  // Otherwise everything on the map (pins, heat, the scrubber) works off the one chosen day.
  const dayEvents = useMemo(() => typed.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey), [typed, dayKey]);
  const events = mode === "next" ? next.list : dayEvents;

  const pickDay = useCallback(
    (f: DateFilter) => {
      setDateFilter(f);
      setMode("day");
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
    setMode("day");
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
    // NEXT 20 is never empty while anything is coming up, so there is no quiet day to skip.
    if (mode === "next") return;
    if (deepLink.current) return;
    const d = useHoppaz.getState().dateFilter;
    const t = todayKey();
    if (d.kind !== "night" || d.date !== t || counts[t]) return;
    const next = Object.keys(counts)
      .filter((k) => k > t && counts[k] > 0)
      .sort()[0];
    if (next) setDateFilter({ kind: "night", date: next });
  }, [ready, failed, allEvents.length, counts, setDateFilter, mode]);

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
  // The NEXT view spans several nights, so there it waits for the Hop's own night.
  const hopActive = !!hop && hop.hop_date === (mode === "next" ? todayStr : dayKey);

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

  /* ------------------------------------------------------------ boxes -- */
  // Drops stand on the map as boxes once you have set where you are.
  const say = useToast((s) => s.say);
  const live = useGameDrops();
  const [sampleDrops] = useState<GameDrop[]>(() => (DEMO ? demoDrops(Date.now()) : []));
  const allDrops = DEMO ? sampleDrops : live.drops;
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    let on = true;
    void loadDropReceipts(userId).then((rows) => on && setOpened(new Set(rows.map((r) => r.drop_id))));
    return () => {
      on = false;
    };
  }, [userId]);
  const placed = useMemo(() => {
    const out: Array<{ drop: GameDrop; at: { lat: number; lng: number }; eventId: string | null }> = [];
    for (const d of allDrops) {
      if (opened.has(d.id) || Date.parse(d.closes_at) <= now) continue;
      // A street box with nobody left to open it is gone.
      if (d.kind === "spawn" && dropsLeft(d) === 0) continue;
      const ev = d.event_id ? allEvents.find((e) => e.id === d.event_id) : undefined;
      const at = pointFromGeog(d.geog) ?? (ev ? { lat: ev.lat, lng: ev.lng } : null) ?? areaByName(d.area) ?? null;
      if (at) out.push({ drop: d, at: { lat: at.lat, lng: at.lng }, eventId: ev?.id ?? null });
    }
    return out;
  }, [allDrops, opened, allEvents, now]);
  const boxes: MapBox[] = useMemo(
    () =>
      fix
        ? placed.map(({ drop, at }) => {
            const open = dropPhase(drop, now) === "open";
            const hunt = !!huntItem(drop.hunt_item);
            const left = dropsLeft(drop);
            const label = !open
              ? opensShort(drop.opens_at, now)
              : drop.kind === "welcome"
                ? "YOURS"
                : drop.kind === "spawn"
                  ? left !== null
                    ? `${left} LEFT`
                    : "STREET"
                  : hunt
                    ? "HUNT"
                    : "OPEN";
            return { id: drop.id, lat: at.lat, lng: at.lng, open, hunt, label, kind: drop.kind };
          })
        : [],
    [placed, fix, now]
  );
  const openBoxes = boxes.filter((b) => b.open).length;
  // The moment you set your location, the boxes drop onto the map; say so once.
  useEffect(() => {
    if (!fix || boxesAnnounced || boxes.length === 0) return;
    boxesAnnounced = true;
    say(`${boxes.length} ${boxes.length === 1 ? "box" : "boxes"} on the map. Go find ${boxes.length === 1 ? "it" : "them"}.`, "violet");
  }, [fix, boxes.length, say]);

  // New Hoppers get three personal boxes near where they are, once.
  useWelcomeBoxes(userId, fix, () => {
    boxesAnnounced = true;
    say("3 welcome boxes just dropped near you. You have 24 hours.", "violet");
    // The page clock ticks every 30 s: catch it up, or the new boxes read as a minute old.
    void live.reload().then(() => setNow(Date.now()));
  });

  // A street box that turns up on a refresh, close to you: say so once. The first successful read only learns what is already there
  // (a failed first read must not count, or every box already out there would toast as new on the next one).
  const seenSpawns = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (DEMO || !live.loaded) return;
    const spawns = live.drops.filter((d) => d.kind === "spawn");
    const seen = seenSpawns.current;
    if (!seen) {
      seenSpawns.current = new Set(spawns.map((d) => d.id));
      return;
    }
    const fresh = spawns.filter((d) => !seen.has(d.id));
    fresh.forEach((d) => seen.add(d.id));
    if (!fix) return;
    let best: { drop: GameDrop; km: number } | null = null;
    for (const d of fresh) {
      const at = pointFromGeog(d.geog);
      if (!at || opened.has(d.id) || dropsLeft(d) === 0) continue;
      const km = haversineKm(fix.lat, fix.lng, at.lat, at.lng);
      if (km <= NEAR_SPAWN_KM && (!best || km < best.km)) best = { drop: d, km };
    }
    if (!best) return;
    boxesAnnounced = true;
    const n = best.drop.max_claims;
    say(`A street box just dropped ${awayLabel(best.km)} away.${n ? ` First ${n} get it.` : ""}`, "violet");
  }, [live.loaded, live.drops, fix, opened, say]);

  const [boxId, setBoxId] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ drop: GameDrop; code: string; outcome?: RevealOutcome } | null>(null);
  const [hunting, setHunting] = useState<{ drop: GameDrop; at: { lat: number; lng: number } } | null>(null);
  const box = boxId ? placed.find((p) => p.drop.id === boxId) ?? null : null;
  const markOpened = (id: string) => setOpened((s) => new Set(s).add(id));
  /** What came out of a claim, as the reveal shows it. */
  const outcomeOf = (drop: GameDrop, r: { reward?: string; description?: string; code?: string; xp?: number }): RevealOutcome => {
    const items: RevealItem[] = [{ kind: huntItem(drop.hunt_item) ? "collectible" : "reward", title: r.reward ?? "Your reward", line: r.description, code: r.code }];
    if (r.xp) items.push({ kind: "xp", title: `+${r.xp} XP`, line: "Added to your XP." });
    return { items };
  };
  const openBox = async (drop: GameDrop, code: string): Promise<RevealOutcome> => {
    const r: { error?: string; reward?: string; description?: string; code?: string; xp?: number } = DEMO ? demoReveal() : await live.claim(drop, fix, code || undefined);
    if (r.error) {
      // No account yet (claim() has already opened the sign-up sheet, and a welcome box never gets here): the tape is not torn.
      // The Reveal goes away quietly and the box's sheet is back underneath, so signing up lands on the box.
      if (isNeedAccount(r.error)) {
        setOpening(null);
        setBoxId(drop.id);
        return { error: "" };
      }
      return { error: sentence(r.error) };
    }
    markOpened(drop.id);
    return outcomeOf(drop, r);
  };

  /* ---------------------------------------- the side card's left and right -- */
  const navRef = useRef<((fromId: string, dir: -1 | 1) => string | null) | null>(null);
  const step = (dir: -1 | 1) => (selected ? navRef.current?.(selected, dir) ?? null : null);

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

  // The toast sits above the bottom card, not on top of its text (the side card has no bottom card under it).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--hz-toast-lift", `${event ? 0 : hud.bottom}px`);
    return () => {
      root.style.removeProperty("--hz-toast-lift");
    };
  }, [event, hud.bottom]);

  const noLiveEvents = failed && allEvents.length === 0;
  const line = !ready
    ? "Checking what's on…"
    : noLiveEvents
      ? "Nothing to show yet."
      : conductorLine({ events, dropEventIds: dropSet, dayKey, now });
  const showEmpty = mode === "day" && ready && !noLiveEvents && events.length === 0 && !filtering && !event;

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
        at={mode === "next" ? now : slot?.t ?? now}
        live={mode === "next" ? true : slot?.live ?? true}
        onClear={() => setSelected(null)}
        fitKey={`${mode === "next" ? "next" : dayKey}|${shownTypes.join(",")}`}
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
        allHot={mode === "next"}
        boxes={boxes}
        onBox={(id) => {
          setSelected(null);
          setBoxId(id);
        }}
        navRef={navRef}
      />

      {/* The chrome is all "now" (today's rail, the clock), so it draws on the client only: a page
          prerendered yesterday must not hydrate against today's rail. */}

      {/* -------------------------------------------------------------- top -- */}
      {mounted && (
        <TopChrome
          key={todayStr} /* a new day (6am) rebuilds the 14-day rail */
          hudRef={topRef}
          day={mode === "next" ? { kind: "any" } : dayFilter}
          lead={{
            label: "NEXT",
            sub: String(next.list.length || NEXT_COUNT),
            aria: `Next ${next.list.length} events`,
            on: mode === "next",
            onClick: () => {
              setMode("next");
              setSelected(null);
            },
          }}
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
            {mode === "next" ? (
              <NextBar
                className="pointer-events-auto w-full"
                count={next.list.length}
                from={next.from}
                to={next.to}
                boxes={boxes.length}
                openBoxes={openBoxes}
                hasFix={!!fix}
                onLocate={() => setPicking(true)}
              />
            ) : slot && (
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
          onPrev={step(-1) ? () => setSelected(step(-1)) : undefined}
          onNext={step(1) ? () => setSelected(step(1)) : undefined}
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
      {box && (
        <BoxSheet
          drop={box.drop}
          at={box.at}
          fix={fix}
          now={now}
          eventTitle={box.eventId ? allEvents.find((e) => e.id === box.eventId)?.title ?? null : null}
          onEvent={
            box.eventId
              ? () => {
                  const ev = allEvents.find((e) => e.id === box.eventId);
                  setBoxId(null);
                  if (ev) {
                    if (mode === "day" && nightOf(Date.parse(ev.starts_at)) !== dayKey) setDateFilter({ kind: "night", date: nightOf(Date.parse(ev.starts_at)) });
                    setSelected(ev.id);
                  }
                }
              : undefined
          }
          onOpen={(code) => {
            setOpening({ drop: box.drop, code });
            setBoxId(null);
          }}
          onHunt={() => {
            setHunting({ drop: box.drop, at: box.at });
            setBoxId(null);
          }}
          onClose={() => setBoxId(null)}
        />
      )}
      {opening && (
        <Reveal
          label={opening.drop.title}
          where={opening.drop.partner?.name ?? opening.drop.area}
          open={async () => opening.outcome ?? openBox(opening.drop, opening.code)}
          // Backing out, or a box that would not open, lands on the box's sheet again (it is gone once the claim went through).
          onClose={(claimed) => {
            if (!claimed) setBoxId(opening.drop.id);
            setOpening(null);
          }}
        />
      )}
      {hunting && (
        <CameraHunt
          drop={hunting.drop}
          eventPoint={hunting.at}
          initialFix={fix ?? null}
          onClaim={async (at) => {
            const r = DEMO ? demoReveal() : await live.claim(hunting.drop, at);
            // The server's one-liners are SHOUTING; the hunt shows them the way a box on the map does.
            if ("error" in r && r.error) return { error: sentence(r.error) };
            markOpened(hunting.drop.id);
            return r;
          }}
          // A found hunt is already claimed: the box opens on what it paid out.
          onOpenBox={(won) => {
            setOpening({ drop: hunting.drop, code: "", outcome: outcomeOf(hunting.drop, won) });
            setHunting(null);
          }}
          onClose={() => setHunting(null)}
        />
      )}
      {hopOpen && <HopSheet hop={hop} fix={fix} onClose={() => setHopOpen(false)} />}
      {titles && <TitleSequence signs={signNames} onDone={() => setSeenTitle(true)} />}
    </div>
  );
}
