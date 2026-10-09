"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import DayRail from "@/components/DayRail";
import EventCard from "@/components/EventCard";
import { SIDE_PANEL, sidePanelWidth } from "@/components/event/side";
import Deck from "@/components/today/Deck";
import DeckCard, { GhostDeck } from "@/components/today/DeckCard";
import Marquee from "@/components/today/Marquee";
import { EmptyDay, FilteredOut, LoadFailed } from "@/components/today/Empty";
import YourDays from "@/components/today/YourDays";
import { useEventQuests } from "@/components/today/useEventQuests";
import { useViewport } from "@/components/today/useViewport";
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
import {
  NEXT_COUNT,
  TODAY,
  countByDay,
  matchesType,
  nextEvents,
  nightOf,
  todayKey,
  type DateFilter,
} from "@/lib/filters";
import { eventTitle, haversineKm } from "@/lib/geo";
import { useHoppaz, useToast } from "@/lib/store";
import { isNeedAccount } from "@/lib/accountGate";
import { useCheckin } from "@/lib/useCheckin";
import { useCollectibleEventIds } from "@/lib/useCollectibles";
import { useEvents, useHop } from "@/lib/useEvents";
import { useGoing } from "@/lib/useGoing";
import { useSession } from "@/lib/useSession";
import type { EventRow } from "@/lib/types";

// One stable empty list, so memo deps do not change on every render.
const NO_TYPES: string[] = [];

/**
 * TODAY (the /discover route): the night as a deck of big flyer cards you
 * slide through, one centred and the neighbours peeking. Pick the night on the
 * same rail the Map uses (or NEXT, the next twenty). Tap the centred card and
 * it opens into the breakdown: the event card as a sheet on a phone, docked on
 * the right on a wide screen. A slow strip of tags underneath scrolls what is
 * coming up and jumps the deck to whichever one you tap.
 */
export default function TodayPage() {
  const { fix, radiusKm, dateFilter, setDateFilter, types, setTypes } = useHoppaz();
  const { userId, refresh } = useSession();
  const { events: allEvents, demo, ready, failed, reload } = useEvents(fix, 45);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);
  const going = useGoing(userId);
  const say = useToast((st) => st.say);
  const { width, wide } = useViewport();

  /** Which night the deck shows: one chosen day, or the next twenty events whatever night they fall on. */
  const [mode, setMode] = useState<"day" | "next">("day");
  /** The card in the middle, remembered by event (not place) so a list that shifts under it keeps it there. */
  const [cursor, setCursor] = useState<{ key: string; id: string | null }>({ key: "", id: null });
  /** The breakdown is open on the card in the middle. */
  const [open, setOpen] = useState(false);
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
  // The next events from now, whatever night: the deck's NEXT view and the strip under it.
  const next = useMemo(() => nextEvents(typed, NEXT_COUNT, now), [typed, now]);
  // One night: the busiest first, the ones already over at the back.
  const dayEvents = useMemo(
    () =>
      typed
        .filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey)
        .sort((a, b) => Number(hasEnded(a, now)) - Number(hasEnded(b, now)) || byGoingThenStart(a, b)),
    [typed, dayKey, now]
  );
  const dayTotal = useMemo(
    () => allEvents.filter((e) => nightOf(Date.parse(e.starts_at)) === dayKey).length,
    [allEvents, dayKey]
  );
  const nextBusy = useMemo(() => nextBusyDay(counts, dayKey), [counts, dayKey]);

  const goingOf = useCallback((e: EventRow) => Math.max(0, (e.swipes_in ?? 0) + (delta[e.id] ?? 0)), [delta]);

  /* ------------------------------------------------------------ the deck -- */
  const deckKey = mode === "next" ? "next" : `day:${dayKey}`;
  const deckEvents = mode === "next" ? next.list : dayEvents;
  const index = useMemo(() => {
    const i = cursor.key === deckKey && cursor.id ? deckEvents.findIndex((e) => e.id === cursor.id) : -1;
    return i < 0 ? 0 : i;
  }, [cursor, deckKey, deckEvents]);
  const event = open ? deckEvents[index] ?? null : null;

  const setIndex = useCallback(
    (i: number) => setCursor({ key: deckKey, id: deckEvents[i]?.id ?? null }),
    [deckKey, deckEvents]
  );

  const pickDay = useCallback(
    (f: DateFilter) => {
      setDateFilter(f);
      setMode("day");
      setOpen(false);
    },
    [setDateFilter]
  );

  /** A tag in the strip: jump the deck to that event, and to its night if it is not on this deck. */
  const jump = (e: EventRow) => {
    setOpen(false);
    if (mode === "next" && next.list.some((x) => x.id === e.id)) {
      setCursor({ key: "next", id: e.id });
      return;
    }
    const night = nightOf(Date.parse(e.starts_at));
    setDateFilter({ kind: "night", date: night });
    setMode("day");
    setCursor({ key: `day:${night}`, id: e.id });
  };

  /* ----------------------------------------------- drops, quests, your days -- */
  const liveDropIds = useCollectibleEventIds(allEvents.map((e) => e.id));
  // Development has no database, so a few sample events carry a drop (same rule as the Map).
  const dropSet = useMemo(
    () =>
      new Set(demo ? allEvents.filter((e) => DEMO_DROP_TITLES.includes(e.title)).map((e) => e.id) : liveDropIds),
    [demo, allEvents, liveDropIds]
  );
  const questsByEvent = useEventQuests(userId, deckEvents);

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

  /* ---------------------------------------------------- the breakdown -- */
  // The event card can change your going. When it closes or moves on, fold that change into the count.
  const goingRef = useRef(going);
  useEffect(() => {
    goingRef.current = going;
  });
  const openId = event?.id ?? null;
  const openIdRef = useRef<string | null>(null);
  useEffect(() => {
    openIdRef.current = openId;
  });
  useEffect(() => {
    if (!openId) return;
    const was = goingRef.current.isGoing(openId);
    return () => {
      const is = goingRef.current.isGoing(openId);
      if (is !== was) setDelta((d) => ({ ...d, [openId]: (d[openId] ?? 0) + (is ? 1 : -1) }));
    };
  }, [openId]);

  /* ------------------------------------------------- WE OUTSIDE on a card -- */
  const WE_OUTSIDE = "We outside. Its group chat invite is in Crew.";
  // A guest's tap opens the sign-up sheet and finishes on its own after sign-up (useGoing remembers it);
  // when the going lands, fold it into the count here and say so.
  const awaiting = useRef<Set<string>>(new Set());
  useEffect(() => {
    awaiting.current.forEach((id) => {
      if (!going.isGoing(id)) return;
      awaiting.current.delete(id);
      if (id !== openIdRef.current) setDelta((d) => ({ ...d, [id]: (d[id] ?? 0) + 1 }));
      say(WE_OUTSIDE, "ok");
    });
  }, [going, say]);
  const weOutside = async (e: EventRow) => {
    if (going.busy[e.id]) return;
    const was = going.isGoing(e.id);
    const err = await going.toggleGoing(e.id);
    if (err) {
      if (isNeedAccount(err)) awaiting.current.add(e.id);
      else say(err, "error");
      return;
    }
    // The open breakdown folds its own change in when it closes; counting it here too would double it.
    if (e.id !== openIdRef.current) setDelta((d) => ({ ...d, [e.id]: (d[e.id] ?? 0) + (was ? -1 : 1) }));
    if (!was) say(WE_OUTSIDE, "ok");
  };
  // The deck's cards are memoised: hand them one steady function that always reaches the newest.
  const weOutsideRef = useRef(weOutside);
  useEffect(() => {
    weOutsideRef.current = weOutside;
  });
  const onGoing = useCallback((e: EventRow) => void weOutsideRef.current(e), []);

  const isHopStop = useMemo(() => {
    if (!event || !hop) return false;
    return hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2);
  }, [event, hop]);

  // Docked on the right, the card sits under the rail and the deck slides left to stay in view beside it.
  const root = useRef<HTMLDivElement>(null);
  const deckBox = useRef<HTMLDivElement>(null);
  const [sideTop, setSideTop] = useState(140);
  useEffect(() => {
    if (!event || !wide) return;
    const r = root.current?.getBoundingClientRect();
    const d = deckBox.current?.getBoundingClientRect();
    if (r && d) setSideTop(Math.max(8, Math.round(d.top - r.top)));
  }, [event, wide]);
  const shift = event && wide ? Math.round((sidePanelWidth(width) + SIDE_PANEL.gap * 2) / 2) : 0;

  /* ------------------------------------------------------------ what shows -- */
  const loading = !mounted || !ready;
  const noLiveEvents = ready && failed && allEvents.length === 0;
  const empty = !loading && !noLiveEvents && deckEvents.length === 0;

  const line = loading
    ? "Checking what's on…"
    : empty
      ? "Nothing listed for this night yet."
      : conductorLine({ events: deckEvents, dropIds: dropSet, dayKey: mode === "next" ? "" : dayKey, now, goingOf });

  const title = mode === "next" ? "Next up" : isToday ? "Today" : weekdayLong(dayKey);

  return (
    <div
      ref={root}
      className="relative flex h-full flex-col overflow-hidden"
      style={{ ["--hz-side-top" as string]: `${sideTop}px` }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col">
          {/* -------------------------------------------------------- header -- */}
          <header className="pad-top flex-none px-4 pb-3">
            <div className="flex items-baseline gap-2.5">
              <h1 className="truncate font-display text-[34px] font-black leading-none tracking-[-0.01em]">{title}</h1>
              {mode === "day" && !isToday && mounted && <span className="seclabel flex-none">{dateTag(dayKey)}</span>}
            </div>
            <p className="mt-2.5 min-h-[22px] font-body text-[15px] font-medium leading-snug text-cream">{line}</p>
          </header>

          <div className="flex-none px-4">
            {mounted ? (
              <DayRail
                key={today}
                value={mode === "next" ? { kind: "any" } : dayFilter}
                onChange={pickDay}
                counts={counts}
                lead={{
                  label: "NEXT",
                  sub: String(next.list.length || NEXT_COUNT),
                  aria: `Next ${next.list.length} events`,
                  on: mode === "next",
                  onClick: () => {
                    setMode("next");
                    setOpen(false);
                  },
                }}
              />
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

          {/* ------------------------------------------------------- the deck -- */}
          <div
            ref={deckBox}
            className="flex min-h-[400px] flex-1 flex-col pt-2 transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{ transform: shift ? `translate3d(${-shift}px,0,0)` : undefined }}
          >
            {loading ? (
              <GhostDeck />
            ) : noLiveEvents ? (
              <LoadFailed onRetry={() => void reload()} />
            ) : empty ? (
              <div className="my-auto">
                {mode === "day" && dayTotal > 0 && shownTypes.length > 0 ? (
                  <FilteredOut
                    onClear={() => setTypes([])}
                    next={nextBusy}
                    onNext={() => nextBusy && pickDay({ kind: "night", date: nextBusy.key })}
                  />
                ) : (
                  <EmptyDay
                    next={nextBusy}
                    onNext={() => nextBusy && pickDay({ kind: "night", date: nextBusy.key })}
                  />
                )}
              </div>
            ) : (
              <div key={deckKey} className="flex min-h-0 flex-1 animate-fade flex-col">
                <Deck
                  count={deckEvents.length}
                  index={index}
                  onIndex={setIndex}
                  onOpen={() => setOpen(true)}
                  label={(i) => `${i === index ? "Open" : "Show"} ${eventTitle(deckEvents[i])}`}
                  slide={(i, s) => {
                    const e = deckEvents[i];
                    return (
                      <DeckCard
                        event={e}
                        now={now}
                        count={goingOf(e)}
                        going={going.isGoing(e.id)}
                        box={dropSet.has(e.id)}
                        quests={questsByEvent.get(e.id)?.length ?? 0}
                        near={s.near}
                        active={s.active}
                        busy={!!going.busy[e.id]}
                        onGoing={onGoing}
                      />
                    );
                  }}
                />
              </div>
            )}
          </div>

          {/* --------------------------------------------- the moving strip -- */}
          {!loading && !noLiveEvents && <Marquee events={next.list} now={now} onPick={jump} />}

          {!loading && mine.length > 0 && <YourDays
              events={mine}
              now={now}
              onOpen={(e) => {
                // A night you are going to: slide the deck to it and open it, like a tap on its card.
                jump(e);
                setOpen(true);
              }}
            />}
          <div className="h-3 flex-none" />
        </div>
      </div>

      {/* ------------------------------------------------------ the breakdown -- */}
      {event && !wide && (
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="absolute inset-0 z-30 animate-fade bg-brand-ink/50"
        />
      )}
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
          onClose={() => setOpen(false)}
          isHopStop={isHopStop}
          placement={wide ? "side" : "sheet"}
          onPrev={wide && index > 0 ? () => setIndex(index - 1) : undefined}
          onNext={wide && index < deckEvents.length - 1 ? () => setIndex(index + 1) : undefined}
        />
      )}
    </div>
  );
}
