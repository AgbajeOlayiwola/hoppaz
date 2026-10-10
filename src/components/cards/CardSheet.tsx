"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LocateFixed, Stamp } from "lucide-react";
import Sheet from "@/components/Sheet";
import { shortDay, stampCard, type DeckCard, type OwnedCard, type StampOk } from "@/lib/cards";
import { RARITY_LOOK, SHOW_LOCKED_NAMES, formatDistance, insideCircle, metresTo } from "@/lib/deck";
import { useToast } from "@/lib/store";
import { useGeoPermission, useLivePosition } from "@/lib/useLivePosition";
import CardFace from "./CardFace";

const copiesNote = (c: DeckCard) =>
  c.copiesTotal === null
    ? "Unlimited copies."
    : c.numbered
      ? `Only ${c.copiesTotal.toLocaleString("en-NG")} copies a season, each one numbered.`
      : `Only ${c.copiesTotal.toLocaleString("en-NG")} copies a season.`;

/**
 * Stamp the card Visited, or say how far you are from it. The distance is worked out here on the phone from the
 * position it already has; nothing is sent until you press I'M HERE, and then the server keeps only the day.
 */
function StampBlock({ card, onStamped }: { card: DeckCard; onStamped: (r: StampOk) => void }) {
  const say = useToast((s) => s.say);
  const permission = useGeoPermission();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  // It only starts watching by itself when location is already allowed; otherwise the Hopper taps first.
  const { pos, status, fresh } = useLivePosition({ enabled: permission === "granted" || ask, precise: true });
  const citywide = card.geo.kind === "citywide";
  const here = fresh && pos ? pos : null;
  const m = here && !citywide ? metresTo(card, here.lat, here.lng) : null;
  const inside = citywide ? !!here : m !== null && here !== null && insideCircle(card, m, here.accuracy);

  // I'M HERE appears under the fold on a short phone: bring it into view when you walk into the circle.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (inside) box.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [inside]);

  const stamp = async () => {
    if (busy) return;
    setBusy(true);
    const r = await stampCard(card.id);
    setBusy(false);
    if (!r.ok) return say(r.message.toUpperCase(), "error");
    onStamped(r);
    say(r.line.toUpperCase(), "violet");
  };

  let line: string;
  if (here && m !== null) line = inside ? "You are here." : `${formatDistance(m)} away.`;
  else if (citywide) line = here ? "Stamp it from anywhere in Lagos." : "Stamp it from anywhere in Lagos. We need your location once.";
  else if (status === "denied") line = "Location is off. Turn it on in your browser settings to see how far you are.";
  else if (ask || permission === "granted") line = status === "unavailable" ? "No signal yet. Try again outside." : "Finding you.";
  else line = "Tap to see how far you are. Nothing is sent until you stamp it.";

  return (
    <section ref={box} aria-label="Visited" className="mt-5 rounded-hz border border-line bg-ink-3 p-3.5">
      <p className="seclabel">NOT STAMPED YET</p>
      <p className="mt-1 font-display text-[18px] font-black leading-tight">{citywide ? "Stamp it from anywhere" : "Go here to stamp it"}</p>
      <p className="hint mt-1" aria-live="polite">
        {line}
      </p>
      {inside ? (
        <>
          <button type="button" className="btn mt-3 w-full" disabled={busy} onClick={() => void stamp()}>
            <Stamp size={16} aria-hidden /> {busy ? "STAMPING" : "I'M HERE"}
          </button>
          <p className="hint mt-2">I&apos;M HERE sends your position once, to check you are at the card. We keep only the day.</p>
        </>
      ) : (
        !here &&
        status !== "denied" &&
        !ask &&
        permission !== "granted" && (
          <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => setAsk(true)}>
            <LocateFixed size={16} aria-hidden /> {citywide ? "USE MY LOCATION" : "SHOW HOW FAR"}
          </button>
        )
      )}
      {!citywide && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${card.geo.lat},${card.geo.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline decoration-orange decoration-2 underline-offset-4"
        >
          OPEN IN MAPS <ExternalLink size={13} aria-hidden className="text-orange" />
        </a>
      )}
    </section>
  );
}

/**
 * One card, full size: the face you can flip, what it is known for, the lore, the fact with its source, the
 * question for the back, its home area, and the Visited stamp or how to get one. A card you do not hold shows
 * only its silhouette and what kind of card it is (its name stays hidden until a box brings it to you).
 */
export default function CardSheet({
  card,
  owned,
  setCount,
  tiers,
  justStamped,
  onClose,
  onStamped,
}: {
  card: DeckCard;
  owned: OwnedCard | null;
  /** Cards you hold of this card's set, and the set's size. */
  setCount: { have: number; total: number };
  /** How many rarities the deck has (for the silhouette's pips). */
  tiers?: number;
  /** The stamp lands now (it was made with this sheet open), so it is struck in. */
  justStamped: boolean;
  onClose: () => void;
  onStamped: (r: StampOk) => void;
}) {
  const look = RARITY_LOOK[card.rarity];
  const top = useRef<HTMLDivElement>(null);
  const copy = owned?.copies.find((c) => c.copyNo !== null)?.copyNo ?? null;

  const stamped = (r: StampOk) => {
    onStamped(r);
    // The card is at the top of the sheet: bring it into view so the stamp is seen landing.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    top.current?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  };

  return (
    <Sheet open onClose={onClose} label={owned || SHOW_LOCKED_NAMES ? card.name : `Locked ${look.label.toLowerCase()} card`}>
      {/* the width also follows the screen's height (a card is 1.6 times as tall as wide), so a short phone still sees the Visited block */}
      <div ref={top} className="mx-auto w-[min(52vw,208px,28vh)] scroll-mt-3 pt-1">
        <CardFace
          card={card}
          locked={!owned}
          showName={SHOW_LOCKED_NAMES}
          tiers={tiers}
          visited={owned?.visited}
          visitedOn={owned?.visitedOn}
          stampIn={justStamped}
          copyNo={copy}
          priority
        />
      </div>
      {owned && <p className="seclabel mt-2.5 text-center">TAP THE CARD TO FLIP IT</p>}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="pill" style={{ color: look.text, borderColor: look.color }}>
          {look.label}
        </span>
        {owned && (
          // the Visited state up here too: on a short phone the block with the stamp is below the fold
          owned.visited ? (
            <span className="pill pill-keke">VISITED{owned.visitedOn ? ` ${shortDay(owned.visitedOn).toUpperCase()}` : ""}</span>
          ) : (
            <span className="pill border-dashed">NOT STAMPED</span>
          )
        )}
        <span className="pill">{card.setName}</span>
        {owned && owned.count > 1 && <span className="pill">YOU HAVE {owned.count}</span>}
        {owned && card.numbered && copy && (
          <span className="pill">
            NO. {copy} OF {card.copiesTotal}
          </span>
        )}
      </div>

      {owned ? (
        <>
          <h2 className="mt-2.5 font-display text-[24px] font-black leading-[1.1]">{card.name}</h2>
          <p className="mt-1.5 font-mono text-[11.5px] font-medium uppercase leading-snug tracking-[0.06em] text-orange">{card.knownFor}</p>

          {owned.visited ? (
            <section aria-label="Visited" className="mt-5 flex items-center gap-3 rounded-hz border border-line bg-ink-3 p-3.5">
              <Stamp size={22} aria-hidden className="flex-none text-orange" />
              <div>
                <p className="font-display text-[16px] font-black leading-tight">Visited {owned.visitedOn ? shortDay(owned.visitedOn) : ""}</p>
                <p className="hint">You stood there and stamped it.</p>
              </div>
            </section>
          ) : (
            <StampBlock card={card} onStamped={stamped} />
          )}

          {card.lore && <p className="mt-5 font-body text-[15px] italic leading-snug text-dim">{card.lore}</p>}
          {card.fact && <p className="mt-2.5 font-body text-[15px] leading-snug">{card.fact}</p>}
          {card.source && (
            <p className="mt-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-dim">
              SOURCE:{" "}
              {card.source.url ? (
                <a href={card.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  {card.source.title}
                </a>
              ) : (
                card.source.title
              )}
            </p>
          )}

          {card.question && (
            <div className="mt-5 border-t border-dashed border-line pt-4">
              <p className="seclabel">TALK ABOUT IT</p>
              <p className="mt-1.5 font-display text-[17px] font-black leading-snug">{card.question}</p>
            </div>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div>
              <dt className="seclabel">HOME AREA</dt>
              <dd className="mt-1 font-body text-[14px]">{card.homeArea || card.setName}</dd>
            </div>
            <div>
              <dt className="seclabel">YOUR {card.setName.toUpperCase()}</dt>
              <dd className="mt-1 font-body text-[14px]">
                {setCount.have} of {setCount.total} {setCount.total === 1 ? "card" : "cards"}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <h2 className="mt-2.5 font-display text-[24px] font-black leading-[1.1]">{SHOW_LOCKED_NAMES ? card.name : "Not found yet"}</h2>
          <p className="hint mt-1.5">
            A {look.label.toLowerCase()} card from {card.setName}, {card.division}. {copiesNote(card)}
          </p>
          <p className="hint mt-3">Open boxes to find it. Once it is yours, go to its place to stamp it Visited.</p>
        </>
      )}
    </Sheet>
  );
}
