"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import EventCard from "@/components/EventCard";
import { haversineKm } from "@/lib/geo";
import type { EventRow } from "@/lib/types";
import { useHoppaz } from "@/lib/store";
import { useCheckin } from "@/lib/useCheckin";
import { fetchEventById, useEvents, useHop } from "@/lib/useEvents";
import { useSession } from "@/lib/useSession";

/**
 * The full event page (FULL LISTING from the map's side card, a Today card,
 * or a shared link): the flyer as a hero, the facts, directions and tickets,
 * who is going, check-in, this event's quests, its drop and its photos, with
 * I'M GOING pinned at the bottom. The same pieces as the cards, at full size.
 *
 * The map's list only reaches 45 km around you, so a link shared to someone far
 * away (or to a night that started a few hours ago) is looked up by its id
 * instead; "isn't on the map" is only said when that finds nothing too.
 */
export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { fix, radiusKm } = useHoppaz();
  const { userId, refresh } = useSession();
  const { events, ready } = useEvents(fix, 45);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);

  const listed = useMemo(() => events.find((e) => e.id === id) ?? null, [events, id]);
  // undefined: not asked yet. event null: asked, and there is no such live event.
  const [looked, setLooked] = useState<{ id: string; event: EventRow | null } | undefined>(undefined);
  useEffect(() => {
    if (!ready || listed) return;
    let dead = false;
    fetchEventById(id, fix)
      .then((e) => !dead && setLooked({ id, event: e }))
      .catch(() => !dead && setLooked({ id, event: null }));
    return () => {
      dead = true;
    };
  }, [ready, listed, id, fix]);
  const lookedUp = looked?.id === id ? looked : undefined;
  const event = listed ?? lookedUp?.event ?? null;
  const settled = ready && (!!listed || lookedUp !== undefined);
  const isHopStop = useMemo(
    () => !!event && !!hop && hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2),
    [event, hop]
  );

  const back = () => {
    // Back where you came from; a shared link opened cold goes to the event on the map, or just the map when it is not near.
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (nav ? nav.canGoBack : window.history.length > 1) router.back();
    else router.replace(listed ? `/?e=${encodeURIComponent(id)}` : "/");
  };

  if (!event) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-[22px] font-black">{settled ? "This one isn't on the map." : "Finding it."}</p>
        {settled && (
          <>
            <p className="hint mt-1">It may have ended, or moved. The map has what&apos;s on now.</p>
            <Link href="/" className="btn mt-5 px-5">
              BACK TO THE MAP
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <EventCard
      event={event}
      fix={fix}
      radiusKm={radiusKm}
      userId={userId}
      checkedIn={done.has(event.id)}
      checkedAt={checkedAt[event.id] ?? null}
      busy={busy === event.id}
      onCheckIn={() => checkIn(event, fix)}
      onClose={back}
      isHopStop={isHopStop}
      placement="page"
    />
  );
}
