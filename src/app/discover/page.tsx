"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import DayRail from "@/components/DayRail";
import EventCard from "@/components/EventCard";
import SwipeDeck from "@/components/SwipeDeck";
import EventStub, { GhostStub } from "@/components/today/EventStub";
import { EmptyDay, FilteredOut, LoadFailed, NextBusyLine } from "@/components/today/Empty";
import YourDays from "@/components/today/YourDays";
import { useEventQuests } from "@/components/today/useEventQuests";
import {
  HOUR,
  byGoingThenStart,
  conductorLine,
  dateTag,
  hasEnded,
  nextBusyDay,
  weekdayLong,
} from "@/components/today/helpers";
import { DEMO_DROP_TITLES } from "@/lib/demoData";
import { TODAY, countByDay, matchesType, nightOf, todayKey, type DateFilter } from "@/lib/filters";
import { haversineKm } from "@/lib/geo";
import { useHoppaz, useToast } from "@/lib/store";
import { useCheckin } from "@/lib/useCheckin";
import { useCollectibleEventIds } from "@/lib/useCollectibles";
import { useEvents, useHop } from "@/lib/useEvents";
import { useGoing } from "@/lib/useGoing";
import { useSession } from "@/lib/useSession";
import type { EventRow } from "@/lib/types";

// One stable empty list, so memo deps do not change on every render.
const NO_TYPES: string[] = [];

/**
 * DISCOVER (the /discover route). One day at a time, picked on the same rail
 * the Map uses. It opens on the swipe deck, Bumble style: right is WE OUTSIDE,
 * left is nah. Once you've been through the day, or if you'd rather scan, the
 * list of ticket stubs is one tap away.
 */
export default function TodayPage() {
  const { fix, radiusKm, dateFilter, setDateFilter, types, setTypes, look: savedLook } = useHoppaz();
  const { userId, refresh, profile } = useSession();
  const { events: allEvents, demo, ready, failed, reload } = useEvents(fix, 45);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);
  const going = useGoing(userId);
  const say = useToast((s) => s.say);

  const [selected, setSelected] = useState<string | null>(null);
  const [swipe, setSwipe] = useState(true);
  /** The stub that was just tapped to "going", so only that one plays the stamp. */
  const [stamped, setStamped] = useState<string | null>(null);
  /** Your own taps, added to the loaded going counts until a fresh load brings the real ones. */
  const [delta, setDelta] = useState<Record<string, number>>({});

  // The store rehydrates from localStorage on the client only, and everything
  // here is "now" (today's rail, the clock), so it draws after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [now, setNow] = useState(() => Date.now());

  // Never sit on a day that is over: past days snap to today, on return and every half minute.
  useEffect(() => {
    const snap = () => {
      const d = useHoppaz.getState().dateFilter;
      if (d.kind !== "night" || d.date < todayKey()) setDateFilter(TODAY());
    };
    snap();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      snap();
    };
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

  // A fresh load carries the real counts, so your own taps are no longer needed.
  // (The sample day in development never includes them, so it keeps them.)
  useEffect(() => {
    if (!demo) setDelta({});
  }, [allEvents, demo]);

  /* ------------------------------------------------------------- the day -- */
  const shownTypes = mounted ? types : NO_TYPES;
  const today = nightOf(now);
  const dayKey = mounted && dateFilter.kind === "night" ? dateFilter.date : today;
  const isToday = dayKey === today;
  const dayFilter: DateFilter = useMemo(() => ({ kind: "night", date: dayKey }), [dayKey]);

  // Rail counts: everything loaded, narrowed by type only (the same numbers the Map's rail shows).
  const typed = useMemo(() => allEvents.filter((e) => matchesType(e, shownTypes)), [allEvents, shownTypes]);
  const counts = useMemo(() => countByDay(typed), [typed]);
  const dayEvents = useMemo(
    () => typed.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey).sort(byGoingThenStart),
    [typed, dayKey]
  );
  const dayTotal = useMemo(
    () => allEvents.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey).length,
    [allEvents, dayKey]
  );
  const next = useMemo(() => nextBusyDay(counts, dayKey), [counts, dayKey]);

  const goingOf = useCallback((e: EventRow) => Math.max(0, (e.swipes_in ?? 0) + (delta[e.id] ?? 0)), [delta]);

  /* ----------------------------------------------- drops, quests, your days -- */
  const liveDropIds = useCollectibleEventIds(allEvents.map((e) => e.id));
  // Development has no database, so a few sample events carry a drop (same rule as the Map).
  const dropSet = useMemo(
    () =>
      new Set(demo ? allEvents.filter((e) => DEMO_DROP_TITLES.includes(e.title)).map((e) => e.id) : liveDropIds),
    [demo, allEvents, liveDropIds]
  );
  const questsByEvent = useEventQuests(userId, dayEvents);

  const mine = useMemo(
    () =>
      allEvents
        .filter(
          (e) =>
            going.decisions[e.id] === "in" &&
            !hasEnded(e, now) &&
            Date.parse(e.starts_at) < now + 14 * 24 * HOUR
        )
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
    [allEvents, going.decisions, now]
  );

  // Your own face, for the stamp on a stub you said you are going to.
  const look = profile?.avatar ?? savedLook;

  /* ------------------------------------------------------------ actions -- */
  const pickDay = useCallback(
    (f: DateFilter) => {
      setDateFilter(f);
      setSelected(null);
      openedWith.current = null;
    },
    [setDateFilter]
  );

  const toggleGoing = async (e: EventRow) => {
    if (going.busy[e.id]) return;
    const was = going.isGoing(e.id);
    const err = await going.toggleGoing(e.id);
    if (err) {
      say(err, "error");
      return;
    }
    setDelta((d) => ({ ...d, [e.id]: (d[e.id] ?? 0) + (was ? -1 : 1) }));
    setStamped(was ? null : e.id);
  };

  // Swipe mode saves through the same hook. Hand the error back and the card returns.
  const swipeDecide = async (e: EventRow, decision: "in" | "pass") => {
    const err = await going.decide(e.id, decision);
    if (err) {
      say(err, "error");
      return err;
    }
    if (decision === "in") {
      setDelta((d) => ({ ...d, [e.id]: (d[e.id] ?? 0) + 1 }));
      say("We outside. Its group chat invite is in Crew.", "ok");
    }
    return null;
  };

  // The event page can change your going too. When it closes, fold that change into the count.
  const openedWith = useRef<{ id: string; going: boolean } | null>(null);
  const settle = () => {
    const o = openedWith.current;
    openedWith.current = null;
    if (!o) return;
    const now = going.isGoing(o.id);
    if (now !== o.going) setDelta((d) => ({ ...d, [o.id]: (d[o.id] ?? 0) + (now ? 1 : -1) }));
  };
  const open = (e: EventRow) => {
    settle();
    openedWith.current = { id: e.id, going: going.isGoing(e.id) };
    setSelected(e.id);
  };
  const closeCard = () => {
    settle();
    setSelected(null);
  };
  const event = useMemo(() => allEvents.find((e) => e.id === selected) ?? null, [allEvents, selected]);
  const isHopStop = useMemo(() => {
    if (!event || !hop) return false;
    return hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2);
  }, [event, hop]);

  /* ------------------------------------------------------------ what shows -- */
  const loading = !mounted || !ready;
  const noLiveEvents = ready && failed && allEvents.length === 0;
  const empty = !loading && !noLiveEvents && dayEvents.length === 0;
  const swiping = swipe && !loading && dayEvents.length > 0;
  // Swiping is for the ones you have not decided on yet.
  const deck = useMemo(() => dayEvents.filter((e) => !going.hasJudged(e.id)), [dayEvents, going]);

  const line = loading
    ? "Checking what's on…"
    : conductorLine({ events: dayEvents, dropIds: dropSet, dayKey, now, goingOf });

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className={clsx("min-h-0 flex-1", swiping ? "flex flex-col overflow-hidden" : "overflow-y-auto overscroll-contain")}>
        {/* -------------------------------------------------------- header -- */}
        <header className="pad-top flex-none px-4 pb-4">
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <h1 className="truncate font-display text-[34px] font-black leading-none tracking-[-0.01em]">
                {isToday ? "Today" : weekdayLong(dayKey)}
              </h1>
              {!isToday && mounted && <span className="seclabel flex-none">{dateTag(dayKey)}</span>}
            </div>
            {(swiping || (!loading && deck.length > 0)) && (
              <button
                type="button"
                onClick={() => setSwipe((v) => !v)}
                className="-mb-2.5 flex-none px-1 py-3 font-body text-[13px] text-dim underline underline-offset-4"
              >
                {swiping ? "See the list" : "Swipe"}
              </button>
            )}
          </div>
          <p className="mt-2.5 min-h-[22px] font-body text-[15px] font-medium leading-snug text-cream">
            {line}
          </p>
        </header>

        <div className="flex-none px-4">
          {mounted ? (
            <DayRail key={today} value={dayFilter} onChange={pickDay} counts={counts} />
          ) : (
            <div className="h-[72px]" aria-hidden />
          )}
        </div>

        {shownTypes.length > 0 && (
          <div className="flex flex-none items-center gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shownTypes.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed="true"
                aria-label={`Remove ${t}`}
                onClick={() => setTypes(types.filter((x) => x !== t))}
                className="chip min-h-[32px] flex-none gap-1.5 px-2.5 text-[10.5px]"
              >
                {t}
                <X size={12} aria-hidden />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTypes([])}
              className="flex h-[32px] flex-none items-center px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-cream underline underline-offset-4"
            >
              Clear
            </button>
          </div>
        )}

        {!swiping && mine.length > 0 && (
          <YourDays events={mine} now={now} onOpen={open} />
        )}

        {/* ----------------------------------------------------------- body -- */}
        {swiping ? (
          <div className="relative mt-4 min-h-0 flex-1 px-4">
            <SwipeDeck
              events={deck}
              onDecide={swipeDecide}
              onInfo={open}
              onDone={() => setSwipe(false)}
              dropIds={dropSet}
              goingOf={goingOf}
            />
          </div>
        ) : loading ? (
          <ul aria-label="Loading the day" className="space-y-4 px-4 pb-6 pt-4">
            <li>
              <GhostStub />
            </li>
            <li>
              <GhostStub />
            </li>
          </ul>
        ) : noLiveEvents ? (
          <LoadFailed onRetry={() => void reload()} />
        ) : empty ? (
          dayTotal > 0 && shownTypes.length > 0 ? (
            <FilteredOut
              onClear={() => setTypes([])}
              next={next}
              onNext={() => next && pickDay({ kind: "night", date: next.key })}
            />
          ) : (
            <EmptyDay next={next} onNext={() => next && pickDay({ kind: "night", date: next.key })} />
          )
        ) : (
          <>
            <ul className="space-y-4 px-4 pb-4 pt-4">
              {dayEvents.map((e) => (
                <li key={e.id}>
                  <EventStub
                    event={e}
                    now={now}
                    going={going.isGoing(e.id)}
                    count={goingOf(e)}
                    drop={dropSet.has(e.id)}
                    quests={questsByEvent.get(e.id) ?? []}
                    look={look}
                    saving={!!going.busy[e.id]}
                    stamped={stamped === e.id}
                    onOpen={() => open(e)}
                    onToggle={() => void toggleGoing(e)}
                  />
                </li>
              ))}
            </ul>
            {dayEvents.length <= 5 && next && (
              <NextBusyLine
                next={next}
                onNext={() => pickDay({ kind: "night", date: next.key })}
                className="pb-6"
              />
            )}
          </>
        )}
      </div>

      {/* ---------------------------------------------------- the event page -- */}
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
        />
      )}
    </div>
  );
}
