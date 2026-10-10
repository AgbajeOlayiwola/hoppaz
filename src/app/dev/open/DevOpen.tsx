"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import OpenStage, { type ClaimResult, type OpenTier } from "@/components/play/open/OpenStage";
import { onOpenEvent } from "@/components/play/open/events";
import { renderOffline, sfx } from "@/lib/sound/sfx";
import { levelFor } from "@/lib/brand";
import { toWonCard, type WonCard } from "@/lib/cards";
import { getSupabase } from "@/lib/supabase/client";
import { setDevPosition } from "@/lib/useLivePosition";

type Mode = { tier: OpenTier; fourBox: boolean; refuse: boolean; slow: boolean; xp: number; collectible: boolean; first: boolean; card?: WonCard | null; real?: boolean };

const TIERS: OpenTier[] = ["common", "rare", "epic", "legendary"];
const XP: Record<OpenTier, number> = { common: 10, rare: 60, epic: 60, legendary: 150 };

/** Stand-in cards, shaped as card_json sends them (real files in /public/cards). They are not in the database, so a stamp on one is refused: that path is worth seeing too. */
const stub = (key: string, name: string, rarity: string, set: string, lat: number, lng: number, extra: Record<string, unknown> = {}) =>
  toWonCard({
    id: `stub-${key}`, key, name, set: { key: set.toLowerCase(), name: set }, division: "Lagos Mainland", category: "institution", rarity,
    numbered: rarity === "epic", copies_total: rarity === "epic" ? 100 : rarity === "rare" ? 1000 : null,
    known_for: "A stand-in card.", geo: { kind: "place", lat, lng, radius_m: 150 },
    art: { front: `/cards/s1/front/${key}.webp`, back: `/cards/s1/back/${key}.webp`, thumb: `/cards/s1/thumb/${key}.webp`, version: 1, credit: null },
    copy_no: null, is_new: true, lifted: false, visited: false, ...extra,
  })!;
/** Yaba Higher College: the place the "near it" buttons stand on. */
const YABA = { lat: 6.518728, lng: 3.374141 };
const CARDS = {
  common: stub("UNI-01", "Born in 1962", "common", "UNILAG series", 6.512, 3.3935),
  rare: stub("YAB-04", "FSTC Yaba", "rare", "Yaba", 6.5167, 3.3711, { copy_no: 212 }),
  epic: stub("YAB-01", "Yaba Higher College", "epic", "Yaba", YABA.lat, YABA.lng, { copy_no: 7 }),
  again: stub("YAB-06", "St Finbarr's College", "rare", "Yaba", 6.5156, 3.3769, { copy_no: 88, is_new: false }),
  lifted: stub("YAB-12", "CcHub", "rare", "Yaba", 6.5163, 3.3735, { copy_no: 904, lifted: true }),
  visited: stub("YAB-03", "Queen's College", "epic", "Yaba", 6.5205, 3.3755, { copy_no: 41, visited: true }),
};

/**
 * A stand-in for the Play shell: a plain ground, a fake HUD to fly things into
 * (pips, XP bar, Shelf), and buttons that open each kind of box. A box that pays a
 * deck card is shown at the card's rarity; the "near it" buttons put a development
 * position on the card's place, so "Stamp it" is offered. With ?real=<drop id>&at=lat,lng
 * (and &walk to move onto the card after the box opens) a "Real box" button claims that
 * box through claim_game_drop with the signed-in session, mapping the answer the way the
 * Play shell should (toWonCard).
 */
export default function DevOpen() {
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [xp, setXp] = useState(495);
  const [shelf, setShelf] = useState(12);
  const [streak, setStreak] = useState(3);
  const [log, setLog] = useState<string[]>([]);
  const xpRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const pipsRef = useRef<HTMLDivElement>(null);
  const xpBefore = useRef(495);
  const [run, setRun] = useState(0);
  // ?real=<drop id>&tier=epic&at=lat,lng, read after mount so the server render and the first browser render agree
  const [real, setReal] = useState<{ drop: string; tier: OpenTier; at: [number, number] | null; walk: boolean } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const [lat, lng] = (q.get("at") ?? "").split(",").map(Number);
    if (q.get("real")) setReal({ drop: q.get("real")!, tier: (q.get("tier") ?? "epic") as OpenTier, at: Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null, walk: q.has("walk") });
  }, []);

  const note = useCallback((t: string) => setLog((l) => [...l.slice(-7), t]), []);

  useEffect(() => {
    sfx.setPlaying(true); // the shell does this on entering Play
    (window as unknown as { __hz: unknown }).__hz = { sfx, renderOffline };
    const off = onOpenEvent((e) => note(e.type + " " + e.tier));
    return () => {
      off();
      sfx.setPlaying(false);
    };
  }, [note]);

  const open = (m: Partial<Mode> & { tier: OpenTier; near?: boolean }) => {
    const { near, ...rest } = m;
    xpBefore.current = xp;
    // a card box opened "near it" stands the development position on the card's place, the others far from it; a real box stands where ?at says
    if (rest.card) setDevPosition(near ? rest.card.geo.lat : 6.43, near ? rest.card.geo.lng : 3.45);
    else if (rest.real && real?.at) setDevPosition(real.at[0], real.at[1]);
    setRun((n) => n + 1);
    setMode({ fourBox: false, refuse: false, slow: false, collectible: m.tier !== "common" && !m.card, first: true, xp: XP[m.tier], ...rest });
    sfx.unlock();
  };

  const claim = async (m: Mode): Promise<ClaimResult> => {
    await new Promise((r) => setTimeout(r, m.slow ? 3500 : 90));
    if (m.refuse) return { ok: false, reason: "sold_out", message: "Somebody got there first." };
    if (m.real) return claimReal();
    return { ok: true, xp: m.xp, title: m.tier === "legendary" ? "Golden Box" : "Special box", card: m.card ?? null, ...(m.collectible ? { collectible: { key: "hop", name: "Golden Hop" } } : {}) };
  };

  /** The answer of claim_game_drop, mapped as the Play shell should map it: the card goes through toWonCard. */
  const claimReal = async (): Promise<ClaimResult> => {
    const sb = getSupabase();
    if (!sb || !real) return { ok: false, reason: "offline", message: "No database." };
    const { data, error } = await sb.rpc("claim_game_drop", { p_drop: real.drop, p_lat: real.at?.[0] ?? null, p_lng: real.at?.[1] ?? null, p_code: null });
    const r = data as { ok?: boolean; reason?: string; reward?: string; xp?: number; card?: unknown } | null;
    if (error || !r) return { ok: false, reason: "error", message: "That didn't open." };
    if (!r.ok) return { ok: false, reason: r.reason ?? "error", message: r.reason ?? "refused" };
    const card = toWonCard(r.card);
    note("real claim, card " + (card ? "yes" : "no"));
    // &walk: after the box opens, stand on the card's place, as a Hopper who walks up to it would
    if (card && real.walk) setDevPosition(card.geo.lat, card.geo.lng);
    return { ok: true, xp: r.xp ?? 0, title: r.reward, card };
  };

  const lv = levelFor(xp);
  const rect = (r: React.RefObject<HTMLDivElement | null>) => r.current?.getBoundingClientRect() ?? null;

  return (
    <main className="absolute inset-0 overflow-y-auto bg-ink px-4 pb-10 pt-3 text-cream" style={{ backgroundImage: "radial-gradient(120% 80% at 50% 40%, #2a1f19 0, #0e0b0a 70%)" }}>
      {/* the fake HUD the things fly into */}
      <div className="mx-auto flex max-w-xl items-start justify-between gap-3">
        <div ref={pipsRef} data-testid="pips" className="mt-1 flex gap-1.5 rounded-full border border-line bg-ink-2 px-2.5 py-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className={`block h-2.5 w-2.5 rounded-full border-[1.5px] ${i < streak ? "border-orange bg-orange" : "border-cream/40"}`} />
          ))}
        </div>
        <div className="w-28">
          <div className="mb-1 flex items-baseline justify-between font-mono text-[9px] tracking-[0.08em]">
            <span>LV {lv.index + 1} {lv.name}</span>
            <b className="font-display text-[13px] font-black">{xp}</b>
          </div>
          <div ref={xpRef} data-testid="xpbar" className="h-[9px] overflow-hidden rounded-full border border-cream/10 bg-cream/15">
            <i className="block h-full rounded-full bg-orange transition-[width] duration-500" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
          </div>
        </div>
      </div>

      <section className="mx-auto mt-10 max-w-xl">
        <h1 className="font-display text-2xl font-black">Play: open</h1>
        <p className="mt-1 font-body text-sm text-dim">Dev page. The open moment over a plain ground. XP starts at 495, so a 10 XP box crosses into REGULAR.</p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {TIERS.map((t) => (
            <button key={t} id={`open-${t}`} type="button" className="btn btn-ghost" onClick={() => open({ tier: t, collectible: false })}>
              Open {t}
            </button>
          ))}
          {TIERS.slice(1).map((t) => (
            <button key={t + "c"} id={`open-${t}-card`} type="button" className="btn btn-ghost" onClick={() => open({ tier: t, collectible: true })}>
              {t} with card
            </button>
          ))}
          <button id="open-common-card" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", collectible: true })}>
            common with card
          </button>
          {/* deck cards: the box colour and the card's rarity are separate */}
          <button id="deck-common" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", xp: 10, card: CARDS.common })}>
            Deck: Common, new
          </button>
          <button id="deck-rare" type="button" className="btn btn-ghost" onClick={() => open({ tier: "rare", xp: 25, card: CARDS.rare })}>
            Deck: Rare, new
          </button>
          <button id="deck-epic" type="button" className="btn btn-ghost" onClick={() => open({ tier: "epic", xp: 60, card: CARDS.epic })}>
            Deck: Epic, No. 7 of 100
          </button>
          <button id="deck-epic-near" type="button" className="btn btn-ghost" onClick={() => open({ tier: "epic", xp: 60, card: CARDS.epic, near: true })}>
            Deck: Epic, near it
          </button>
          <button id="deck-again" type="button" className="btn btn-ghost" onClick={() => open({ tier: "rare", xp: 25, card: CARDS.again })}>
            Deck: Rare, a repeat
          </button>
          <button id="deck-lifted" type="button" className="btn btn-ghost" onClick={() => open({ tier: "rare", xp: 25, card: CARDS.lifted })}>
            Deck: Rare, guaranteed
          </button>
          <button id="deck-visited" type="button" className="btn btn-ghost" onClick={() => open({ tier: "epic", xp: 60, card: CARDS.visited })}>
            Deck: Epic, stamped on the spot
          </button>
          <button id="deck-mismatch" type="button" className="btn btn-ghost" onClick={() => open({ tier: "epic", xp: 10, card: CARDS.common })}>
            Epic crate, Common card
          </button>
          <button id="deck-golden" type="button" className="btn btn-ghost" onClick={() => open({ tier: "legendary", xp: 150, card: CARDS.epic })}>
            Golden crate, Epic card
          </button>
          <button id="deck-fourbox" type="button" className="btn" onClick={() => open({ tier: "legendary", fourBox: true, xp: 150, card: CARDS.epic })}>
            Four-box with a card
          </button>
          {real && (
            <button id="open-real" type="button" className="btn" onClick={() => open({ tier: real.tier, real: true, xp: 0 })}>
              Real box (claim_game_drop)
            </button>
          )}
          <button id="open-fourbox" type="button" className="btn" onClick={() => open({ tier: "rare", fourBox: true, xp: 50, collectible: true })}>
            Four-box (welcome A)
          </button>
          <button id="open-refused" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", refuse: true })}>
            Refused claim
          </button>
          <button id="open-slow" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", slow: true })}>
            Slow claim (3.5 s)
          </button>
          <button id="open-nostamp" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", first: false })}>
            Common, not first of day
          </button>
          <button id="mute" type="button" className="btn btn-ghost" aria-pressed={muted} onClick={() => sfx.setMuted(!muted)}>
            {muted ? "Sound off" : "Sound on"}
          </button>
        </div>

        <div className="mt-6 flex items-center gap-4">
          <div ref={shelfRef} data-testid="shelf" className="flex items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2">
            <span className="h-6 w-5 rounded-[3px] border border-cream bg-ink" />
            <span className="font-display text-xl font-black">{shelf}</span>
            <small className="font-mono text-[9px] uppercase tracking-[0.1em] text-dim">Shelf</small>
          </div>
        </div>

        <pre data-testid="log" className="mt-6 whitespace-pre-wrap font-mono text-[11px] leading-5 text-dim">{log.join("\n")}</pre>
      </section>

      {mode && (
        <OpenStage
          key={run}
          drop={{ id: "dev" }}
          tier={mode.tier}
          fourBox={mode.fourBox}
          claim={() => claim(mode)}
          target={{ xp: rect(xpRef), shelf: rect(shelfRef), pips: mode.first ? rect(pipsRef) : null }}
          xpBefore={xpBefore.current}
          onLand={(k, r) => {
            note("land " + k);
            if (k === "xp") setXp((v) => v + r.xp);
            if (k === "collectible") setShelf((v) => v + 1);
            if (k === "card" && r.card?.isNew) setShelf((v) => v + 1);
            if (k === "stamp") setStreak((v) => Math.min(7, v + 1));
          }}
          onDone={(r) => {
            note("done " + (r.ok ? "ok" : "refused " + r.reason));
            // a count that the log (which keeps eight lines) cannot lose, for the headless check
            const w = window as unknown as { __hzDone?: number };
            w.__hzDone = (w.__hzDone ?? 0) + 1;
            setMode(null);
          }}
          onCancel={() => {
            note("cancel");
            setMode(null);
          }}
        />
      )}
    </main>
  );
}
