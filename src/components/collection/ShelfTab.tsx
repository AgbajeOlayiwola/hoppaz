"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import PerforatedStub from "@/components/me/PerforatedStub";
import Serial from "@/components/me/Serial";
import SpotMascot from "@/components/me/SpotMascot";
import { DEMO, demoCollection, demoEmpty, demoReceipts } from "@/components/me/demo";
import { shortDate } from "@/components/me/dropTime";
import { isCardPrize } from "@/lib/cards";
import { loadCollection, loadDropReceipts, type CollectionEntry, type DropReceipt } from "@/lib/useCollectibles";
import Hunt3D from "@/components/Hunt3D";
import { HUNT_ITEMS, HUNT_KEYS, RARITY } from "@/lib/huntItems";

/* eslint-disable @next/next/no-img-element -- collectible art is Hoppaz or partner supplied, sizes unknown */

/**
 * The shelf tab: every collectible you found and every reward you claimed, each
 * as a punched stub. Collectibles show their art; with no art they get a drawn
 * gift in a fixed frame (the database emoji never reaches the screen). Reward codes are printed like a ticket
 * serial with a COPY button. The card deck has its own tab (CardsTab).
 */
export default function ShelfTab({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<CollectionEntry[]>([]);
  const [receipts, setReceipts] = useState<DropReceipt[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (DEMO) {
      const t = Date.now();
      setItems(demoEmpty() ? [] : demoCollection(t));
      setReceipts(demoEmpty() ? [] : demoReceipts(t));
      setLoaded(true);
      return;
    }
    let live = true;
    void Promise.all([loadCollection(userId), loadDropReceipts(userId)]).then(([rows, claims]) => {
      if (!live) return;
      setItems(rows);
      setReceipts(claims);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  // A card prize's receipt ("Card", or "Epic card" from an older box) is not a reward: the card is in the Cards tab, and the
  // receipt's tier is the prize row's, which can differ from the card that landed.
  const rewards = receipts.filter((r) => !isCardPrize(r.reward));
  const total = items.length + rewards.length;
  // Camera hunt finds arrive as drop receipts tagged with the 3D item they unlocked.
  const found = new Map(receipts.filter((r) => r.hunt_item).map((r) => [r.hunt_item!, r]));
  return (
    <>
      {loaded && total > 0 && <p className="seclabel mb-4">{items.length} COLLECTED · {rewards.length} CLAIMED</p>}

      {loaded && (
        <section aria-label="Camera hunt collectibles" className="mb-7">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="seclabel">CAMERA HUNT · {found.size}/{HUNT_KEYS.length}</p>
            <span className="font-mono text-[10px] text-dim">HIDDEN AT EVENTS</span>
          </div>
          <ul className="grid grid-cols-2 gap-3">
            {HUNT_KEYS.map((key, i) => {
              const item = HUNT_ITEMS[key];
              const got = found.get(key);
              return (
                <li key={key} className={i === 0 ? "col-span-2" : undefined}>
                  <article className="stub p-3" style={{ ["--notch-y" as string]: "62%" } as React.CSSProperties}>
                    <Hunt3D item={key} locked={!got} spin={got ? 0.6 : 0.25} className={i === 0 ? "h-40" : "h-28"} />
                    <p className="mt-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: RARITY[item.rarity].color }}>
                      {RARITY[item.rarity].label}
                    </p>
                    <h2 className="font-display text-[14px] font-black leading-tight">{got ? item.name : "???"}</h2>
                    <p className="hint mt-1">{got ? item.blurb : "Hidden at an event somewhere in Lagos. Find it with your camera."}</p>
                    {got && (
                      <p className="mt-2 border-t border-line pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
                        {got.event_title ?? got.title}
                      </p>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!loaded ? (
        <p className="hint">Dusting the shelf.</p>
      ) : total === 0 ? (
        <div className="flex flex-col items-center px-6 pb-8 pt-8 text-center">
          <SpotMascot state="oya" size={120} label="The Hoppaz mascot, waving you over" />
          <p className="mt-4 font-display text-[22px] font-black">Nothing on the shelf yet.</p>
          <p className="hint mt-1 max-w-[30ch]">Find a collectible or claim a drop at a venue and it lands here.</p>
          <Link href="/" className="btn mt-5 px-5 text-[12.5px]">
            OPEN THE MAP
          </Link>
        </div>
      ) : (
        <>
          {items.length > 0 && (
            <section aria-label="Collectibles">
              <p className="seclabel mb-2.5">COLLECTIBLES · {items.length}</p>
              <ul className="grid grid-cols-2 gap-3">
                {items.map((item) => (
                  <li key={item.drop_id} className="flex">
                    <PerforatedStub
                      className="flex w-full flex-col"
                      notch={7}
                      topClassName="grid h-[112px] place-items-center overflow-hidden"
                      bottomClassName="flex-1 px-3 pb-3 pt-2.5"
                      top={
                        item.collectible.art_url ? (
                          <img src={item.collectible.art_url} alt={item.collectible.name} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <span
                            aria-hidden
                            className="grid h-[64px] w-[64px] place-items-center rounded-hz border border-line bg-ink-3 text-dim"
                          >
                            <Gift size={28} strokeWidth={1.75} />
                          </span>
                        )
                      }
                      bottom={
                        <>
                          <h2 className="font-display text-[14px] font-black leading-tight">{item.collectible.name}</h2>
                          {item.collectible.description && (
                            <p className="mt-1 line-clamp-2 font-body text-[12.5px] leading-snug text-dim">{item.collectible.description}</p>
                          )}
                          <p className="mt-2 line-clamp-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
                            {item.event_title} · {shortDate(item.collected_at)}
                          </p>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {rewards.length > 0 && (
            <section aria-label="Claimed rewards" className={items.length ? "mt-7" : undefined}>
              <p className="seclabel mb-2.5">CLAIMED REWARDS · {rewards.length}</p>
              {rewards.map((r) => (
                <PerforatedStub
                  key={r.drop_id}
                  className="mb-3"
                  top={
                    <>
                      <p className="seclabel truncate">
                        {r.partner ?? "HOPPAZ"} · {r.title}
                      </p>
                      <h2 className="mt-2 font-display text-[21px] font-black leading-tight">{r.reward}</h2>
                      {r.description && <p className="hint mt-1">{r.description}</p>}
                      <p className="mt-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-dim">
                        CLAIMED {shortDate(r.claimed_at)}
                      </p>
                    </>
                  }
                  bottom={r.code ? <Serial code={r.code} /> : undefined}
                />
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
