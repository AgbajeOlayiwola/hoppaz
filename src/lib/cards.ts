"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { haversineKm } from "./geo";
import { getLivePos } from "./useLivePosition";
import { useSessionStore } from "./useSession";
import { haptics } from "./haptics";
import { sfx } from "./sound/sfx";
import type { Rarity } from "./huntItems";

/**
 * The card deck on the client (docs/CARDS.md, "As built"; supabase/cards.sql). Cards are places: a card says what
 * to see there, and standing at its point stamps it Visited. This file reads the shapes the database sends
 * (card_json, my_collection, visit_card), keeps what the screens need, and does the stamping. Cards are never for
 * sale, so nothing here knows a price.
 *
 * Art: the deck's own images, a front, a back and a thumb, all with the name and rarity drawn in. They are served
 * from /public/cards, so no screen needs a third-party host.
 */

export type GeoKind = "place" | "area" | "citywide";

export type DeckCard = {
  id: string;
  key: string;
  name: string;
  setKey: string;
  setName: string;
  division: string;
  category: string;
  rarity: Rarity;
  /** Epic only in Season 1: its copies are numbered ("7 of 100"). A Rare copy has a number but the card is not numbered. */
  numbered: boolean;
  copiesTotal: number | null;
  knownFor: string;
  lore: string;
  fact: string;
  source: { title: string; url: string | null } | null;
  question: string;
  homeArea: string | null;
  geo: { kind: GeoKind; lat: number; lng: number; radiusM: number | null };
  art: { front: string; back: string; thumb: string; version: number; credit: string | null };
};

/** A card a box just paid: the card plus what this copy was. */
export type WonCard = DeckCard & {
  copyNo: number | null;
  /** The first copy you hold. */
  isNew: boolean;
  /** The 10th box for a Rare or the 60th for an Epic lifted it. */
  lifted: boolean;
  /** Already stamped: a walked box that sat inside the card's circle stamps it on the spot. */
  visited: boolean;
};

export type OwnedCard = {
  card: DeckCard;
  count: number;
  copies: { copyNo: number | null; gotOn: string }[];
  /** The play-day of your newest copy (a date, no time is kept). */
  lastOn: string;
  visited: boolean;
  visitedOn: string | null;
};

export type CardShelf = {
  /** Newest copy first, the better rarity first within a day. */
  owned: OwnedCard[];
  totals: { cards: number; copies: number; visited: number; of: number };
  stamps: { paidToday: number; paidMax: number; xp: number };
  /** Only the sets you hold a card of: how many you hold, how many of those are stamped, and the set's size. */
  sets?: { key: string; name: string; owned: number; visited: number; total: number }[];
};

/* ---------------------------------------------------------------- reading -- */
const RARITIES: readonly string[] = ["common", "rare", "epic", "legendary"];
const KINDS: readonly string[] = ["place", "area", "citywide"];

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One card as card_json sends it, or null for anything that is not a card (a box that pays XP only sends null). */
export function toCard(raw: unknown): DeckCard | null {
  const r = obj(raw);
  const art = obj(r?.art);
  const geo = obj(r?.geo);
  const set = obj(r?.set);
  if (!r || !art || !geo) return null;
  if (typeof r.id !== "string" || typeof r.name !== "string" || !RARITIES.includes(r.rarity as string) || typeof art.front !== "string") return null;
  const src = obj(r.source);
  return {
    id: r.id,
    key: str(r.key),
    name: r.name,
    setKey: str(set?.key),
    setName: str(set?.name),
    division: str(r.division),
    category: str(r.category),
    rarity: r.rarity as Rarity,
    numbered: r.numbered === true,
    copiesTotal: num(r.copies_total),
    knownFor: str(r.known_for),
    lore: str(r.lore),
    fact: str(r.fact),
    source: src && str(src.title) ? { title: str(src.title), url: str(src.url) || null } : null,
    question: str(r.question),
    homeArea: str(r.home_area) || null,
    geo: {
      kind: KINDS.includes(geo.kind as string) ? (geo.kind as GeoKind) : "area",
      lat: num(geo.lat) ?? 0,
      lng: num(geo.lng) ?? 0,
      radiusM: num(geo.radius_m),
    },
    art: { front: art.front, back: str(art.back, art.front), thumb: str(art.thumb, art.front), version: num(art.version) ?? 1, credit: str(art.credit) || null },
  };
}

/** The `card` of a claim_game_drop or open_daily_box answer: null when the box paid XP only. */
export function toWonCard(raw: unknown): WonCard | null {
  const c = toCard(raw);
  const r = obj(raw);
  if (!c || !r) return null;
  return { ...c, copyNo: num(r.copy_no), isNew: r.is_new === true, lifted: r.lifted === true, visited: r.visited === true };
}

function toOwned(raw: unknown): OwnedCard | null {
  const r = obj(raw);
  const card = toCard(r?.card);
  if (!r || !card) return null;
  const copies = (Array.isArray(r.copies) ? r.copies : []).flatMap((c) => {
    const x = obj(c);
    return x ? [{ copyNo: num(x.copy_no), gotOn: str(x.got_on) }] : [];
  });
  const lastOn = copies.reduce((a, c) => (c.gotOn > a ? c.gotOn : a), str(r.first_on));
  return { card, count: num(r.count) ?? copies.length, copies, lastOn, visited: r.visited === true, visitedOn: str(r.visited_on) || null };
}

/** The art for a face. The version keeps a cached image from outliving a new one. */
export const artUrl = (card: Pick<DeckCard, "art">, face: "front" | "back" | "thumb") => `${card.art[face]}?v=${card.art.version}`;

/**
 * The thumb at two sizes for `srcset`: the 180 px file and its 360 px twin (`<name>-2x.webp`, made by import-s1.mjs next to
 * it). A 3x phone then gets a sharp tile and a 2x phone on a small tile keeps the light file.
 */
export const thumbSrcSet = (card: Pick<DeckCard, "art">) =>
  `${artUrl(card, "thumb")} 180w, ${card.art.thumb.replace(/\.webp$/, "-2x.webp")}?v=${card.art.version} 360w`;

/** Starts the front loading, so a card that is about to turn up does not pop in. */
export function preloadCard(card: Pick<DeckCard, "art">) {
  if (typeof Image === "undefined") return;
  const i = new Image();
  i.decoding = "async";
  i.src = artUrl(card, "front");
}

/**
 * A card prize's claim receipt text: "Card", or the older "Epic card" (add_card_prizes used to name the tier of the row,
 * which is not the tier of the card that landed). The card itself is on the shelf, so a screen that lists receipts leaves
 * these out, and never prints one as a reward.
 */
const CARD_PRIZE = /^((common|rare|epic|legendary) )?card$/i;
export const isCardPrize = (receipt: string | null | undefined) => !!receipt && CARD_PRIZE.test(receipt.trim());

/** What a card says about itself when read out. */
export const cardLabel = (c: Pick<DeckCard, "name" | "rarity" | "setName">) => `${c.name}, ${c.setName ? `${c.setName}, ` : ""}${c.rarity} card`;

/** "7 of 100" for a numbered card, else null. */
export const copyLine = (card: Pick<DeckCard, "numbered" | "copiesTotal">, copyNo: number | null) =>
  card.numbered && card.copiesTotal && copyNo ? `No. ${copyNo} of ${card.copiesTotal}` : null;

/** The date a card was stamped, as "12 Oct". It is a play-day date, so the zone is fixed to keep the day. */
export const shortDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/* ------------------------------------------------------------- the shelf -- */
/** The database has no `my_collection` (cards.sql not loaded yet): that is "no cards", not a failure to retry. */
const NO_SUCH_FUNCTION = new Set(["PGRST202", "42883"]);

/**
 * Your cards, newest first, and whether the call failed. `failed` is a network or server error, which the screen offers to
 * retry; "no cards yet" (an older database, no session) is `{ shelf: null, failed: false }`, and an empty deck is a shelf
 * with nothing owned. A failed call must never read as an empty deck.
 */
export async function readShelf(): Promise<{ shelf: CardShelf | null; failed: boolean }> {
  const sb = getSupabase();
  if (!sb) return { shelf: null, failed: false };
  let res;
  try {
    res = await sb.rpc("my_collection");
  } catch {
    return { shelf: null, failed: true };
  }
  const { data, error } = res;
  if (error) return { shelf: null, failed: !NO_SUCH_FUNCTION.has(error.code) };
  const r = obj(data);
  if (!r) return { shelf: null, failed: true };
  if (r.ok !== true) return { shelf: null, failed: false };
  const owned = (Array.isArray(r.owned) ? r.owned : []).map(toOwned).filter((o): o is OwnedCard => !!o);
  // The server sorts by rarity; a stable sort on the day keeps that order inside a day.
  owned.sort((a, b) => (a.lastOn < b.lastOn ? 1 : a.lastOn > b.lastOn ? -1 : 0));
  const t = obj(r.totals);
  const s = obj(r.stamps);
  const shelf: CardShelf = {
    owned,
    totals: { cards: num(t?.cards) ?? owned.length, copies: num(t?.copies) ?? 0, visited: num(t?.visited) ?? 0, of: num(t?.of) ?? 0 },
    stamps: { paidToday: num(s?.paid_today) ?? 0, paidMax: num(s?.paid_max) ?? 3, xp: num(s?.xp) ?? 30 },
    sets: (Array.isArray(r.sets) ? r.sets : []).flatMap((x) => {
      const o = obj(x);
      return o && typeof o.key === "string"
        ? [{ key: o.key, name: str(o.name), owned: num(o.owned) ?? 0, visited: num(o.visited) ?? 0, total: num(o.total) ?? 0 }]
        : [];
    }),
  };
  return { shelf, failed: false };
}

/** Your cards, newest first. Null when there are none to show: no cards yet, or the call failed (`readShelf` tells which). */
export async function loadCards(): Promise<CardShelf | null> {
  return (await readShelf()).shelf;
}

/** How many different cards you hold (for the Shelf count on the Play HUD). 0 when unknown. */
export async function loadCardCount(): Promise<number> {
  return (await loadCards())?.totals.cards ?? 0;
}

/**
 * Loads the shelf once the session is known, and again on `reload`. `shelf` stays null until the first answer, and after
 * a failed one when there is nothing older to show; `failed` says the call failed (offer a retry), as opposed to "no cards".
 */
export function useCards(userId: string | null, opts: { demo?: CardShelf | null } = {}) {
  const demo = opts.demo ?? null;
  const [shelf, setShelf] = useState<CardShelf | null>(demo);
  const [loaded, setLoaded] = useState(!!demo);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (demo) return;
    const r = await readShelf();
    // a failed reload keeps what is already on screen
    setShelf((old) => (r.failed ? old : r.shelf));
    setFailed(r.failed);
    setLoaded(true);
  }, [demo]);

  useEffect(() => {
    if (demo) {
      setShelf(demo);
      setLoaded(true);
      return;
    }
    if (!userId) return;
    let live = true;
    void readShelf().then((r) => {
      if (!live) return;
      setShelf((old) => (r.failed ? old : r.shelf));
      setFailed(r.failed);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [userId, demo]);

  /** A stamp landed: show it on the card now, without asking again. */
  const markVisited = useCallback((cardId: string, day: string) => {
    setShelf((s) =>
      s && {
        ...s,
        owned: s.owned.map((o) => (o.card.id === cardId ? { ...o, visited: true, visitedOn: day } : o)),
        totals: { ...s.totals, visited: s.totals.visited + (s.owned.some((o) => o.card.id === cardId && !o.visited) ? 1 : 0) },
      }
    );
  }, []);

  return { shelf, loaded, failed: failed && !shelf, reload, markVisited };
}

/* --------------------------------------------------------------- stamping -- */
export type StampOk = { ok: true; already: boolean; xp: number; xpSkipped: string | null; visitedOn: string; line: string };
export type StampNo = { ok: false; reason: string; message: string };
export type StampResult = StampOk | StampNo;

type Fix = { lat: number; lng: number; accuracy: number };

/** A reading this young is used as it is; an older one is asked for again. */
const FRESH_MS = 20_000;

/**
 * Where the Hopper is right now, for one call. The live reading if it is young (a moved development position counts),
 * otherwise a one-off high accuracy request. Nothing is kept: the position goes into the stamp call and nowhere else.
 */
async function freshFix(): Promise<Fix | null> {
  const p = getLivePos();
  if (p && (p.source === "dev" || Date.now() - p.at <= FRESH_MS)) return { lat: p.lat, lng: p.lng, accuracy: p.accuracy };
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;
  return new Promise((done) => {
    navigator.geolocation.getCurrentPosition(
      (g) => done({ lat: g.coords.latitude, lng: g.coords.longitude, accuracy: Number.isFinite(g.coords.accuracy) ? g.coords.accuracy : 50 }),
      () => done(null),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 12_000 }
    );
  });
}

const metresLine = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

const REFUSALS: Record<string, string> = {
  no_session: "One moment, then try again.",
  location_required: "Turn on your location to stamp it.",
  not_found: "That card isn't in the deck any more.",
  not_owned: "You don't hold this card yet.",
  outside_lagos: "This one stamps from inside Lagos.",
  not_stampable: "This card can't be stamped.",
  location_stale: "Still finding you. Try again in a moment.",
  too_fast: "Slow down a little and try again.",
};

/** What a first stamp says, with the XP it paid or why it paid none. */
function stampLine(xp: number, skipped: string | null) {
  if (xp > 0) return `Stamped. +${xp} XP.`;
  if (skipped === "daily_limit") return "Stamped. Three paid stamps today, so no XP this time.";
  if (skipped === "near_stamp") return "Stamped. You stamped one close by today, so no XP.";
  if (skipped === "area") return "Stamped. Area cards stamp for the memory, not XP.";
  if (skipped === "unverified") return "Stamped. Out here we can't check where you are, so no XP.";
  return "Stamped.";
}

/**
 * "Stamp it": Visited, for a card you hold, from where you stand. The server checks the circle (150 m for a place, 500 m for
 * an area, anywhere in Lagos for a city-wide card), the speed and that your heartbeat is young. If it says the heartbeat is
 * old (Play is not open), one heartbeat is sent with the same reading and the stamp is tried once more (that is the usual
 * Play location update, so the privacy page says it). The position is used for these calls only: no copy is kept on the
 * phone, and for the stamp the server keeps only the day and whether it paid.
 * Plays the stamp sound and buzz on a first stamp.
 */
export async function stampCard(cardId: string): Promise<StampResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "offline", message: "No signal. Try again in a bit." };
  const fix = await freshFix();
  if (!fix) return { ok: false, reason: "location_required", message: REFUSALS.location_required };
  const visit = () => sb.rpc("visit_card", { p_card: cardId, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
  let { data, error } = await visit();
  if (!error && obj(data)?.reason === "location_stale") {
    await sb.rpc("play_tick", { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
    ({ data, error } = await visit());
  }
  const r = obj(data);
  if (error || !r) return { ok: false, reason: "error", message: "That didn't stamp. Try again in a bit." };
  if (r.ok !== true) {
    const reason = str(r.reason, "error");
    const m = num(r.distance_m);
    const message = reason === "too_far" ? `About ${metresLine(m ?? 0)} to go. Stamp it when you're there.` : (REFUSALS[reason] ?? "That didn't stamp. Try again in a bit.");
    return { ok: false, reason, message };
  }
  const already = r.already === true;
  const xp = num(r.xp) ?? 0;
  if (!already) {
    sfx.stamp();
    haptics.buzz("stampSmall");
    // The XP is already in the database; show it in the numbers now.
    const { profile, set } = useSessionStore.getState();
    if (xp > 0 && profile) set({ profile: { ...profile, xp: profile.xp + xp } });
  }
  const skipped = str(r.xp_skipped) || null;
  return { ok: true, already, xp, xpSkipped: skipped, visitedOn: str(r.visited_on), line: already ? "Already stamped." : stampLine(xp, skipped) };
}

/** Within the stamp circle of the card, as far as the phone can tell. Only for deciding whether to offer "Stamp it": the server decides. */
export function canStampHere(card: Pick<DeckCard, "geo">): boolean {
  const p = getLivePos();
  if (!p || (p.source !== "dev" && Date.now() - p.at > FRESH_MS)) return false;
  if (card.geo.kind === "citywide") return true;
  const r = card.geo.radiusM ?? 150;
  const metres = haversineKm(p.lat, p.lng, card.geo.lat, card.geo.lng) * 1000;
  return metres <= r + Math.min(p.accuracy || 0, 30);
}
