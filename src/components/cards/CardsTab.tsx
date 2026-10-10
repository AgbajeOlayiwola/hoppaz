"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { shortDay, type CardShelf, type DeckCard, type OwnedCard } from "@/lib/cards";
import { RARITY_LOOK, SHOW_LOCKED_NAMES, rarityRank, type CardSet, type Catalog } from "@/lib/deck";
import type { Rarity } from "@/lib/huntItems";
import CardFace from "./CardFace";
import CardSheet from "./CardSheet";

type Group = { division: string; sets: { set: CardSet; cards: DeckCard[]; have: number }[]; have: number; total: number };

const KIND_ORDER: Record<string, number> = { council: 0, campus: 1, city: 2 };
const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
/** A tile is a third of the page less the gutters (16 px a side) and the two 10 px gaps. */
const TILE_SIZES = "calc((100vw - 52px) / 3)";

/**
 * The deck as an album: sets grouped by division, cards you hold in colour and the rest as dark silhouettes, the
 * count per set and overall, a filter by division and by rarity, and the card sheet on a tap.
 */
export default function CardsTab({
  catalog,
  mine,
  onStamped,
}: {
  catalog: Catalog;
  mine: CardShelf;
  /** A stamp landed on a card: the page marks it Visited. */
  onStamped: (cardId: string, day: string) => void;
}) {
  const [division, setDivision] = useState<string | null>(null);
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useState<DeckCard | null>(null);
  const [stampedNow, setStampedNow] = useState<string | null>(null);

  const owned = useMemo(() => new Map(mine.owned.map((o) => [o.card.id, o] as const)), [mine.owned]);
  const haveBySet = useMemo(() => {
    const n = new Map<string, number>();
    for (const o of mine.owned) n.set(o.card.setKey, (n.get(o.card.setKey) ?? 0) + 1);
    return n;
  }, [mine.owned]);

  const divisions = useMemo(() => {
    const kind = new Map<string, string>();
    for (const s of catalog.sets) kind.set(s.division, s.kind);
    return [...kind.keys()].sort((a, b) => (KIND_ORDER[kind.get(a)!] ?? 9) - (KIND_ORDER[kind.get(b)!] ?? 9) || a.localeCompare(b));
  }, [catalog.sets]);

  // Cards that pass the filters, grouped. The counts on the headings are always the whole set's, not the filtered view's.
  const groups = useMemo(() => {
    const byDivision = new Map<string, Group>();
    for (const d of divisions) byDivision.set(d, { division: d, sets: [], have: 0, total: 0 });
    for (const set of catalog.sets) {
      const g = byDivision.get(set.division);
      if (!g) continue;
      const have = haveBySet.get(set.key) ?? 0;
      g.have += have;
      g.total += set.count;
      if (division && set.division !== division) continue;
      const cards = catalog.cards
        .filter((c) => c.setKey === set.key && (!rarity || c.rarity === rarity) && (!onlyMine || owned.has(c.id)))
        .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.key.localeCompare(b.key));
      if (cards.length) g.sets.push({ set, cards, have });
    }
    return divisions.map((d) => byDivision.get(d)!).filter((g) => g.sets.length);
  }, [catalog, divisions, division, rarity, onlyMine, owned, haveBySet]);

  const total = catalog.cards.length;
  const have = mine.totals.cards;
  const filtered = division !== null || rarity !== null || onlyMine;
  const sheetOwned: OwnedCard | null = open ? (owned.get(open.id) ?? null) : null;

  return (
    <>
      <section aria-label="Your deck" className="mb-5">
        <div className="flex items-end justify-between gap-3">
          <p className="num text-[40px]" aria-label={`${have} of ${total} cards`}>
            {have} <span className="text-[20px] text-dim">of {total}</span>
          </p>
          <span className="pill mb-1">{catalog.season.name.toUpperCase()}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Cards found"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={have}
          className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-orange" style={{ width: `${total ? Math.max(have ? 2 : 0, (have / total) * 100) : 0}%` }} />
        </div>
        <p className="seclabel mt-2.5">
          {mine.totals.copies} {mine.totals.copies === 1 ? "COPY" : "COPIES"} · {mine.totals.visited} VISITED
        </p>
        {have === 0 && <p className="hint mt-3 max-w-[34ch]">Nothing in your deck yet. Boxes bring cards. Each one is a place in Lagos: go there and stamp it Visited.</p>}
      </section>

      <div className="mb-4 space-y-2">
        <div role="group" aria-label="Division" className={clsx("-mx-4 flex gap-2 overflow-x-auto px-4", NO_SCROLLBAR)}>
          <button type="button" className="chip flex-none" aria-pressed={division === null} onClick={() => setDivision(null)}>
            ALL
          </button>
          {divisions.map((d) => (
            <button key={d} type="button" className="chip flex-none" aria-pressed={division === d} onClick={() => setDivision(division === d ? null : d)}>
              {d}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Rarity" className={clsx("-mx-4 flex gap-2 overflow-x-auto px-4", NO_SCROLLBAR)}>
          <button type="button" className="chip flex-none" aria-pressed={rarity === null} onClick={() => setRarity(null)}>
            ALL RARITIES
          </button>
          {catalog.tiers.map((t) => (
            <button key={t} type="button" className="chip flex-none" aria-pressed={rarity === t} onClick={() => setRarity(rarity === t ? null : t)}>
              {RARITY_LOOK[t].label}
            </button>
          ))}
          <button type="button" className="chip flex-none" aria-pressed={onlyMine} onClick={() => setOnlyMine(!onlyMine)}>
            I HAVE
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-display text-[18px] font-black">No cards match.</p>
          <button
            type="button"
            className="btn btn-ghost mt-4 px-5 text-[12.5px]"
            onClick={() => {
              setDivision(null);
              setRarity(null);
              setOnlyMine(false);
            }}
          >
            CLEAR FILTERS
          </button>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.division} aria-label={g.division} className="mb-8">
            <div className="flex items-baseline justify-between border-b border-line pb-1.5">
              <h2 className="font-display text-[19px] font-black leading-none">{g.division}</h2>
              <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-dim">
                {g.have} OF {g.total}
              </span>
            </div>
            {g.sets.map(({ set, cards, have: setHave }) => (
              <div key={set.key} className="mt-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream">{set.name}</h3>
                  <span className={clsx("font-mono text-[11px] font-medium tracking-[0.08em]", setHave === set.count ? "text-orange" : "text-dim")}>
                    {setHave}/{set.count}
                  </span>
                </div>
                <ul className="grid grid-cols-3 gap-2.5">
                  {cards.map((card) => {
                    const entry = owned.get(card.id);
                    const look = RARITY_LOOK[card.rarity];
                    return (
                      <li key={card.id}>
                        <button
                          type="button"
                          onClick={() => setOpen(card)}
                          aria-label={
                            entry
                              ? `${card.name}, ${look.label.toLowerCase()}${entry.count > 1 ? `, you have ${entry.count}` : ""}${entry.visited ? `, visited ${entry.visitedOn ? shortDay(entry.visitedOn) : ""}` : ""}`
                              : SHOW_LOCKED_NAMES
                                ? `${card.name}, ${look.label.toLowerCase()}, not found yet`
                                : `Locked ${look.label.toLowerCase()} card from ${set.name}`
                          }
                          className="block w-full rounded-[6px]"
                        >
                          <CardFace
                            card={card}
                            mode="tile"
                            locked={!entry}
                            showName={SHOW_LOCKED_NAMES}
                            tiers={catalog.tiers.length}
                            tileSizes={TILE_SIZES}
                            visited={entry?.visited}
                            visitedOn={entry?.visitedOn}
                            count={entry?.count}
                          />
                          {/* the printed name is about 7 px on a tile, and some cards share an icon: say who it is */}
                          {entry && <span className="mt-1.5 line-clamp-2 block text-center font-display text-[10.5px] font-black leading-[1.15]">{card.name}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
      {filtered && groups.length > 0 && <p className="hint pb-2 text-center">Showing the cards that match. Counts are for the whole set.</p>}

      {open && (
        <CardSheet
          // a new key per card: tapping another tile while a sheet is open must not carry the flip over
          key={open.id}
          // an owned card comes back whole from my_collection (lore, fact, question); the catalogue card is the short one
          card={sheetOwned?.card ?? open}
          owned={sheetOwned}
          setCount={{ have: haveBySet.get(open.setKey) ?? 0, total: catalog.sets.find((s) => s.key === open.setKey)?.count ?? 0 }}
          tiers={catalog.tiers.length}
          justStamped={stampedNow === open.id}
          onClose={() => setOpen(null)}
          onStamped={(r) => {
            setStampedNow(open.id);
            onStamped(open.id, r.visitedOn);
          }}
        />
      )}
    </>
  );
}
