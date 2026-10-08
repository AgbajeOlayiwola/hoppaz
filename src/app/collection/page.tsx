"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PerforatedStub from "@/components/me/PerforatedStub";
import Serial from "@/components/me/Serial";
import SpotMascot from "@/components/me/SpotMascot";
import SubHeader from "@/components/me/SubHeader";
import { DEMO, demoCollection, demoEmpty, demoReceipts } from "@/components/me/demo";
import { shortDate } from "@/components/me/dropTime";
import { useSession } from "@/lib/useSession";
import { loadCollection, loadDropReceipts, type CollectionEntry, type DropReceipt } from "@/lib/useCollectibles";
import Hunt3D from "@/components/Hunt3D";
import { HUNT_ITEMS, HUNT_KEYS, RARITY } from "@/lib/huntItems";

/* eslint-disable @next/next/no-img-element -- collectible art is Hoppaz or partner supplied, sizes unknown */

/**
 * Your shelf: every collectible you found and every reward you claimed, each
 * as a punched stub. Collectibles show their art; only when there is no art
 * does the emoji go in a fixed frame. Reward codes are printed like a ticket
 * serial with a COPY button.
 */
export default function CollectionPage() {
  const { userId } = useSession();
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

  const total = items.length + receipts.length;
  // Camera hunt finds arrive as drop receipts tagged with the 3D item they unlocked.
  const found = new Map(receipts.filter((r) => r.hunt_item).map((r) => [r.hunt_item!, r]));
  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <SubHeader
        backHref="/me"
        backLabel="Me"
        title="Your shelf"
        caption={loaded && total ? `${items.length} COLLECTED · ${receipts.length} CLAIMED` : "COLLECTIBLES AND REWARDS"}
      />

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
                            className="grid h-[64px] w-[64px] place-items-center rounded-hz border border-line bg-ink-3 text-[30px] leading-none"
                          >
                            {item.collectible.emoji}
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

          {receipts.length > 0 && (
            <section aria-label="Claimed rewards" className={items.length ? "mt-7" : undefined}>
              <p className="seclabel mb-2.5">CLAIMED REWARDS · {receipts.length}</p>
              {receipts.map((r) => (
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
    </div>
  );
}
