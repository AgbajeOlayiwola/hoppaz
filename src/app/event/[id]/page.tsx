"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import EventCard from "@/components/EventCard";
import { haversineKm } from "@/lib/geo";
import { useHoppaz } from "@/lib/store";
import { useCheckin } from "@/lib/useCheckin";
import { useEvents, useHop } from "@/lib/useEvents";
import { useSession } from "@/lib/useSession";

/**
 * The full event page (FULL LISTING from the map's side card, a Today card,
 * or a shared link): the flyer as a hero, the facts, directions and tickets,
 * who is going, check-in, this event's quests, its drop and its photos, with
 * I'M GOING pinned at the bottom. The same pieces as the cards, at full size.
 */
export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { fix, radiusKm } = useHoppaz();
  const { userId, refresh } = useSession();
  const { events, ready } = useEvents(fix, 45);
  const hop = useHop();
  const { done, checkedAt, busy, checkIn } = useCheckin(userId, refresh);

  const event = useMemo(() => events.find((e) => e.id === id) ?? null, [events, id]);
  const isHopStop = useMemo(
    () => !!event && !!hop && hop.stops.some((s) => haversineKm(s.lat, s.lng, event.lat, event.lng) < 0.2),
    [event, hop]
  );

  const back = () => {
    // Back where you came from; a shared link opened cold goes to the event on the map.
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (nav ? nav.canGoBack : window.history.length > 1) router.back();
    else router.replace(`/?e=${encodeURIComponent(id)}`);
  };

  if (!event) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-[22px] font-black">{ready ? "This one isn't on the map." : "Finding it."}</p>
        {ready && (
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
