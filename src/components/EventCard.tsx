"use client";

import { useEffect, useMemo, useState } from "react";
import { Bus } from "lucide-react";
import StubSheet from "@/components/event/StubSheet";
import ArtPanel from "@/components/event/ArtPanel";
import GoingFoot from "@/components/event/GoingFoot";
import CheckInBlock, { type FreshCheckin } from "@/components/event/CheckInBlock";
import DropRow from "@/components/event/DropRow";
import Photos, { usePhotoPicker } from "@/components/event/Photos";
import { demoDrop, demoFlyer, demoPhotos } from "@/components/event/demo";
import EventQuestList from "@/components/EventQuestList";
import { CHECKIN_RADIUS_M, type CheckinOutcome } from "@/lib/useCheckin";
import { useEventFeed } from "@/lib/useEventFeed";
import { useToast } from "@/lib/store";
import { loadDropReceipts, useEventCollectibles } from "@/lib/useCollectibles";
import { useGameDrops } from "@/lib/game";
import { themeForEvent } from "@/lib/theme";
import { clockShort, eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import { dayLabel } from "@/lib/filters";
import type { EventRow } from "@/lib/types";

const HOUR = 3.6e6;

type Props = {
  event: EventRow;
  fix: { lat: number; lng: number; area: string | null } | null;
  /** No longer shown (the "outside your radius" tag is gone). Kept so existing callers still compile. */
  radiusKm?: number;
  userId: string | null;
  checkedIn: boolean;
  busy: boolean;
  /** Runs the check-in. If it hands back the outcome, the card punches the stub with it. */
  onCheckIn: () => void | Promise<CheckinOutcome | void>;
  onClose: () => void;
  isHopStop: boolean;
  /** When you checked in (ISO), if the caller knows it from an earlier visit. */
  checkedAt?: string | null;
};

/** Check-in times seen this session, so the stamp keeps its time when you reopen the card. */
const stampedAt = new Map<string, string>();

/**
 * Tapping an event opens this: one tall ticket stub. The flyer is the art, the
 * title and one line of facts come next, the guest list and the one button sit
 * pinned under the perforation, and what is left (check-in, this event's
 * quests, the drop, the photos) scrolls above it.
 *
 * Its colours follow the event, not the page: a daytime event is a cream stub
 * even in the night app, and the other way round.
 */
export default function EventCard(props: Props) {
  // A new event is a new ticket: nothing from the last one (stamps, forms) carries over.
  return <EventSheet key={props.event.id} {...props} />;
}

function EventSheet({ event, fix, userId, checkedIn, busy, onCheckIn, onClose, isHopStop, checkedAt }: Props) {
  const say = useToast((s) => s.say);
  const { photos: loaded, uploading, upload } = useEventFeed(event.id, userId);
  const sampleShots = useMemo(() => demoPhotos(event), [event]);
  const photos = loaded.length ? loaded : sampleShots;
  const { drops: collectibles, claimed, busy: collecting, collect } = useEventCollectibles(event.id, userId);
  const { drops: liveDrops, busy: dropBusy, claim: claimDrop } = useGameDrops(event.id);
  const [fresh, setFresh] = useState<FreshCheckin | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const theme = themeForEvent(event.starts_at);
  const lead = isEventLead(event);
  const title = eventTitle(event);
  const flyer = useMemo(() => demoFlyer(event), [event]);

  const start = Date.parse(event.starts_at);
  const now = Date.now();
  const closeEnough = !!fix && event.distance_m <= CHECKIN_RADIUS_M;
  // Check-in is about the night itself; a listing weeks away has no use for the strip unless you are standing there.
  const aroundNow = now > start - 18 * HOUR && now < start + 12 * HOUR;
  const showCheckIn = !lead && (checkedIn || closeEnough || aroundNow);

  /* ---------------------------------------------------------- the facts -- */
  const when = lead ? "TIME TBC" : dayLabel(event.starts_at);
  const line = [when, event.area?.toUpperCase(), eventPrice(event)].filter(Boolean).join(" · ");

  /* ----------------------------------------------------------- the drop -- */
  const sample = demoDrop(event);
  const gameDrops = sample ? [sample] : liveDrops;
  // Drops you opened on an earlier visit (receipts) or a minute ago stop counting as hidden.
  const [receipts, setReceipts] = useState<Set<string>>(new Set());
  const [justOpened, setJustOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    void loadDropReceipts(userId).then((rows) => {
      if (!cancelled) setReceipts(new Set(rows.map((r) => r.drop_id)));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const openedIds = useMemo(() => new Set([...receipts, ...justOpened]), [receipts, justOpened]);
  const hasDrop = gameDrops.some((d) => !openedIds.has(d.id)) || collectibles.some((d) => !claimed.has(d.id) && !openedIds.has(d.id));
  const opensAt = gameDrops.filter((d) => !openedIds.has(d.id)).map((d) => Date.parse(d.opens_at)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b)[0];
  const pill = hasDrop
    ? { cls: "pill-violet", text: opensAt && opensAt > now ? `DROP AT ${clockShort(new Date(opensAt).toISOString())}` : "DROP LIVE" }
    : lead
      ? { cls: "pill-danfo", text: "UNCONFIRMED" }
      : theme === "day"
        ? { cls: "pill-lagoon", text: "DAYTIME" }
        : null;

  /* ----------------------------------------------------------- photos -- */
  const picker = usePhotoPicker(async (f) => {
    const res = await upload(f);
    if (res.ok) setSubmitted(true);
    say(res.message, res.ok ? "ok" : "error");
  });
  const hasPhoto = photos.some((p) => p.user_id === userId) || submitted;

  const doCheckIn = async () => {
    const res = (await onCheckIn()) as CheckinOutcome | undefined;
    if (res && res.ok) {
      stampedAt.set(event.id, res.at);
      setFresh({ at: res.at, xp: res.xp, badges: res.badges });
    }
  };

  return (
    <StubSheet label={title} theme={theme} onClose={onClose} footer={<GoingFoot event={event} userId={userId} />}>
      <ArtPanel flyer={flyer} alt={`${title} flyer`} vibe={event.vibe} tone={theme === "day" ? "ink" : "cream"} />

      {/* ----------------------------------------------- title and the facts -- */}
      <div className="px-5 pt-4">
        <h2 className="font-display text-[30px] font-black leading-[1.05] tracking-[-0.01em]">{title}</h2>
        <p className="mt-2.5 font-mono text-[12px] font-medium uppercase leading-snug tracking-[0.04em] text-cream [text-wrap:balance]">{line}</p>
        <p className="mt-1 font-body text-[14px] text-dim">{event.venue_name}</p>
        {pill && (
          <p className="mt-3">
            <span className={`pill ${pill.cls}`}>{pill.text}</span>
          </p>
        )}
        {isHopStop && (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
            <Bus size={14} aria-hidden /> ON THE HOP ROUTE
          </p>
        )}
        {lead && <p className="hint mt-3">Community lead. Times and prices can move, so check the listing before you go.</p>}
      </div>

      {showCheckIn && (
        <CheckInBlock
          checkedIn={checkedIn}
          busy={busy}
          closeEnough={closeEnough}
          at={fresh?.at ?? checkedAt ?? stampedAt.get(event.id) ?? null}
          fresh={fresh}
          onCheckIn={() => void doCheckIn()}
        />
      )}

      <EventQuestList eventId={event.id} userId={userId} checkedIn={checkedIn} hasPhoto={hasPhoto} onAddPhoto={picker.open} uploading={uploading} />

      <DropRow
        closeEnough={closeEnough}
        gameDrops={gameDrops}
        gameBusy={dropBusy}
        onClaimGame={async (drop, code) => {
          // The sample drop on a sample event has no database to claim from.
          if (sample && drop.id === sample.id) return { reward: "A free drink on us", description: "Show this at the bar.", code: "HZ-4821" };
          return claimDrop(drop, fix, code);
        }}
        collectibles={collectibles}
        collected={claimed}
        collectBusy={collecting}
        onCollect={(drop) => collect(drop.id, fix)}
        openedIds={openedIds}
        onOpened={(id) => setJustOpened((s) => new Set(s).add(id))}
        onClaimHunt={(drop, at) => claimDrop(drop, at)}
        eventPoint={{ lat: event.lat, lng: event.lng }}
        fix={fix}
      />

      <Photos photos={photos} title={title} checkedIn={checkedIn} uploading={uploading} onAdd={picker.open} />
      {picker.input}

      <div className="h-6" />
    </StubSheet>
  );
}
