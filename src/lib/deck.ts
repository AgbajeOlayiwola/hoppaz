"use client";

import { useCallback, useEffect, useState } from "react";
import { toCard, useCards, type CardShelf, type DeckCard } from "./cards";
import { haversineKm } from "./geo";
import { RARITY, type Rarity } from "./huntItems";
import { getSupabase } from "./supabase/client";

/**
 * The whole deck, for the album (src/app/collection): every live card in the season with its set, so the cards you
 * do not hold can be drawn as silhouettes. What you hold is in cards.ts (my_collection); this file adds the
 * catalogue, the rarity look and the distance maths that the album and the card sheet share.
 */
export type CardSet = { key: string; name: string; division: string; kind: string; count: number };

export type Catalog = {
  season: { season: number; name: string };
  /** The rarities this deck has. Show no other: Season 1 has no Legendary. */
  tiers: Rarity[];
  sets: CardSet[];
  cards: DeckCard[];
};

let catalogOnce: Promise<Catalog | null> | null = null;

/** The whole live deck (about 74 KB), read once per page load. Null when it could not be read; a retry asks again. */
export function loadCatalog(): Promise<Catalog | null> {
  if (!catalogOnce) {
    catalogOnce = (async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb.rpc("card_catalog");
      if (error || !data?.ok) return null;
      const cards = (Array.isArray(data.cards) ? data.cards : []).map(toCard).filter((c: DeckCard | null): c is DeckCard => !!c);
      return { season: data.season ?? { season: 1, name: "Season 1" }, tiers: data.tiers ?? [], sets: data.sets ?? [], cards } as Catalog;
    })().then((c) => {
      if (!c) catalogOnce = null;
      return c;
    });
  }
  return catalogOnce;
}

const NONE: CardShelf = { owned: [], totals: { cards: 0, copies: 0, visited: 0, of: 0 }, stamps: { paidToday: 0, paidMax: 3, xp: 30 } };

/**
 * The deck and what you hold of it, once both are in. A Hopper with no session at all (offline) holds nothing. `failed`
 * is either call failing (the catalogue, or `my_collection`): a screen then offers a retry and never draws an empty
 * deck, which would read as "0 of 125".
 */
export function useDeck(userId: string | null, sessionOffline: boolean) {
  const cards = useCards(userId);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  const load = useCallback(async () => {
    setCatalogFailed(false);
    const deck = await loadCatalog();
    if (deck) setCatalog(deck);
    else setCatalogFailed(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const reloadCards = cards.reload;
  const retry = useCallback(() => {
    void load();
    void reloadCards();
  }, [load, reloadCards]);

  // cards.ts answers null for "no cards yet" (an older database) as well as a failure; `cards.failed` tells the two apart.
  // With no failure the album draws with what it has: all silhouettes is a fair picture of "no cards yet".
  const mine: CardShelf | null = cards.shelf ?? (!cards.failed && (cards.loaded || sessionOffline) ? NONE : null);
  return { catalog, mine, failed: catalogFailed || cards.failed, retry, markVisited: cards.markVisited };
}

/** The rarity colours and the lighter tint each one glows in (the box-open stage uses the same hexes). */
export const RARITY_LOOK: Record<Rarity, { label: string; color: string; glow: string; text: string; onDark: string; pips: number }> = {
  // color is for borders and shapes. For words, Rare violet (#5B2EFF) is only 2.7 to 3:1 on the dark surfaces, so words use the
  // theme's readable violet (globals.css --violet: #9D81FF at night, #4A20E0 by day); `text` follows the theme, `onDark` is for
  // the silhouette, which is dark in both. The other rarities read as they are (4.4:1 and up).
  common: { ...RARITY.common, glow: "#E4D8C6", text: RARITY.common.color, onDark: RARITY.common.color, pips: 1 },
  rare: { ...RARITY.rare, glow: "#8A66FF", text: "rgb(var(--violet))", onDark: "#9D81FF", pips: 2 },
  epic: { ...RARITY.epic, glow: "#F2739A", text: RARITY.epic.color, onDark: RARITY.epic.color, pips: 3 },
  legendary: { ...RARITY.legendary, glow: "#FFD966", text: RARITY.legendary.color, onDark: RARITY.legendary.color, pips: 4 },
};

export const rarityRank = (r: Rarity) => ["common", "rare", "epic", "legendary"].indexOf(r);

/**
 * Whether a card you do not hold shows its name. Off: it is a dark silhouette with its set, rarity and copies
 * showing, and the name arrives with the card (the Game Plan's locked slot). On: the name is drawn in the silhouette.
 */
export const SHOW_LOCKED_NAMES = false;

/** "UNLIMITED" or "1,000 A SEASON", the way the printed footer says it. */
export const copiesLine = (c: Pick<DeckCard, "copiesTotal">) => (c.copiesTotal === null ? "UNLIMITED" : `${c.copiesTotal.toLocaleString("en-NG")} A SEASON`);

/* ------------------------------------------------------------- distance -- */
/** Metres from a position to the card's point. Worked out on the phone: nothing is sent to read it. */
export const metresTo = (card: Pick<DeckCard, "geo">, lat: number, lng: number) => haversineKm(lat, lng, card.geo.lat, card.geo.lng) * 1000;

/** "420 m", "2.4 km", "14 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** The slack the server allows on top of a card's circle: your GPS accuracy, up to 30 m. */
const SLACK_MAX_M = 30;

/** Whether `m` metres is inside the card's Visited circle by the server's rule (the server still decides). */
export const insideCircle = (card: Pick<DeckCard, "geo">, m: number, accuracy: number) =>
  card.geo.radiusM !== null && m <= card.geo.radiusM + Math.min(Math.max(accuracy, 0), SLACK_MAX_M);
