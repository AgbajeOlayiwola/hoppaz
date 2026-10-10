"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import SubHeader from "@/components/me/SubHeader";
import CardsTab from "@/components/cards/CardsTab";
import ShelfTab from "@/components/collection/ShelfTab";
import { useSession } from "@/lib/useSession";
import { useDeck } from "@/lib/deck";

/**
 * Your collection: the card deck first (every card in the season, the ones you hold in colour and the rest as
 * dark silhouettes, grouped by division and set), and the shelf beside it, where collectibles from events, camera
 * hunt finds and claimed rewards live. /collection?tab=shelf opens the shelf.
 */
export default function CollectionPage() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center"><span className="hint">LOADING…</span></div>}>
      <Collection />
    </Suspense>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={clsx(
        "-mb-px min-h-[44px] whitespace-nowrap border-b-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-colors",
        on ? "border-orange text-cream" : "border-transparent text-dim"
      )}
    >
      {children}
    </button>
  );
}

function Collection() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"cards" | "shelf">(params.get("tab") === "shelf" ? "shelf" : "cards");
  const { userId, state } = useSession();
  const deck = useDeck(userId, state === "offline");

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <SubHeader backHref="/me" backLabel="Me" title="Collection" caption={tab === "cards" ? "THE DECK" : "YOUR SHELF"} />

      <div role="tablist" aria-label="Collection" className="mb-4 flex gap-6 border-b border-line">
        <Tab on={tab === "cards"} onClick={() => setTab("cards")}>
          CARDS
        </Tab>
        <Tab on={tab === "shelf"} onClick={() => setTab("shelf")}>
          SHELF
        </Tab>
      </div>

      {tab === "shelf" ? (
        <ShelfTab userId={userId} />
      ) : deck.catalog && deck.mine ? (
        <CardsTab catalog={deck.catalog} mine={deck.mine} onStamped={deck.markVisited} />
      ) : deck.failed ? (
        <div className="px-6 py-12 text-center">
          <p className="font-display text-[20px] font-black">Could not load the deck.</p>
          <p className="hint mt-1">Check your signal and try again.</p>
          <button type="button" className="btn mt-5 px-5 text-[12.5px]" onClick={deck.retry}>
            TRY AGAIN
          </button>
        </div>
      ) : (
        <p className="hint">Shuffling the deck.</p>
      )}
    </div>
  );
}
