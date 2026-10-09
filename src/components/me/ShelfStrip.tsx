"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bus, ChevronRight, CookingPot, Disc3, Drum, Gift, Lock, Shell, Ticket, type LucideIcon } from "lucide-react";
import { HUNT_ITEMS, HUNT_KEYS, RARITY, type HuntKey, type Rarity } from "@/lib/huntItems";
import { loadCollection, loadDropReceipts, type CollectionEntry, type DropReceipt } from "@/lib/useCollectibles";
import { DEMO, demoCollection, demoEmpty, demoReceipts } from "./demo";

/* eslint-disable @next/next/no-img-element -- collectible art is Hoppaz or partner supplied, sizes unknown */

/** A drawn icon for each camera-hunt item: the strip never mounts a 3D canvas (the full shelf does). */
const ICON: Record<HuntKey, LucideIcon> = {
  "golden-danfo": Bus,
  "jollof-pot": CookingPot,
  "gangan-drum": Drum,
  "golden-cowrie": Shell,
  "eko-disco-ball": Disc3,
};

/** What an icon is drawn in on its rarity colour: ink where that reads, cream on the violet. */
const ON: Record<Rarity, string> = { legendary: "#0E0B0A", epic: "#0E0B0A", rare: "#F5EBDD", common: "#0E0B0A" };

const CARD = "flex h-[104px] w-[74px] flex-none flex-col overflow-hidden rounded-[8px] border-[1.5px]";

/** One trading-card tile: coloured art on top, the name and a mono tag under it. */
function Tile({ name, tag, color, ink, icon: Icon, art }: { name: string; tag: string; color?: string; ink?: string; icon: LucideIcon; art?: string | null }) {
  return (
    <li className="flex-none">
      <Link
        href="/collection"
        aria-label={`${name}, ${tag.toLowerCase()}. Open your shelf`}
        className={`${CARD} ${color ? "" : "border-line"}`}
        style={color ? { borderColor: color } : undefined}
      >
        <span
          aria-hidden
          className={`grid h-[62px] flex-none place-items-center overflow-hidden ${color ? "" : "bg-ink-3 text-dim"}`}
          style={color ? { background: color, color: ink } : undefined}
        >
          {art ? <img src={art} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Icon size={28} strokeWidth={1.9} />}
        </span>
        <span className="flex min-h-0 flex-1 flex-col justify-center bg-ink-2 px-1.5">
          <span className="line-clamp-2 font-display text-[10px] font-black leading-[1.12]">{name}</span>
          <span className="mt-[3px] font-mono text-[8px] font-medium uppercase tracking-[0.1em] text-dim">{tag}</span>
        </span>
      </Link>
    </li>
  );
}

/** A camera-hunt item you have not found: a dashed outline and three question marks. */
function Locked({ hint }: { hint: string }) {
  return (
    <li className="flex-none">
      <Link
        href="/collection"
        aria-label={`Not found yet. ${hint}`}
        className="flex h-[104px] w-[74px] flex-col items-center justify-center gap-1.5 rounded-[8px] border-[1.5px] border-dashed border-line text-dim"
      >
        <Lock size={16} strokeWidth={2} aria-hidden />
        <span aria-hidden className="font-display text-[18px] font-black leading-none">
          ???
        </span>
      </Link>
    </li>
  );
}

/**
 * Your shelf as a strip of trading cards: the camera-hunt items first (found
 * ones in their rarity colour, the rest dashed and locked), then collectibles
 * and the rewards you claimed. The strip is light on purpose (no 3D); the full
 * shelf at /collection has the models. Under it, how much of the hunt set you
 * have.
 */
export default function ShelfStrip({ userId, offline = false }: { userId: string | null; offline?: boolean }) {
  const [items, setItems] = useState<CollectionEntry[]>([]);
  const [receipts, setReceipts] = useState<DropReceipt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (DEMO) {
      const t = Date.now();
      setItems(demoEmpty() ? [] : demoCollection(t));
      setReceipts(demoEmpty() ? [] : demoReceipts(t));
      setLoaded(true);
      return;
    }
    if (!userId) return;
    let live = true;
    void Promise.all([loadCollection(userId), loadDropReceipts(userId)])
      .then(([rows, claims]) => {
        if (!live) return;
        setItems(rows);
        setReceipts(claims);
        setFailed(false);
        setLoaded(true);
      })
      // Never a blank gap: say what happened (the session itself failing, with no user to load for, is the `offline` prop).
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [userId]);

  // Camera hunt finds arrive as drop receipts tagged with the 3D item they unlocked.
  const found = new Map(receipts.filter((r) => r.hunt_item).map((r) => [r.hunt_item!, r]));
  const rewards = receipts.filter((r) => !r.hunt_item);
  const hunted = HUNT_KEYS.filter((k) => found.has(k)).length;
  const total = hunted + items.length + rewards.length;
  const cantLoad = !DEMO && !loaded && (failed || offline);

  return (
    <section aria-label="Your shelf" className="mt-7">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="seclabel">YOUR SHELF{loaded ? ` · ${total}` : ""}</p>
        {!cantLoad && (
          <Link href="/collection" className="seclabel -my-4 -mr-2 flex min-h-[44px] items-center gap-0.5 pl-3 pr-2 hover:text-cream">
            SEE ALL
            <ChevronRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      {cantLoad ? (
        <p className="hint">Couldn&apos;t load your shelf. It&apos;ll be here when you&apos;re back online.</p>
      ) : loaded ? (
        <>
          <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {HUNT_KEYS.map((key) => {
              const item = HUNT_ITEMS[key];
              return found.has(key) ? (
                <Tile key={key} name={item.name} tag={RARITY[item.rarity].label} color={RARITY[item.rarity].color} ink={ON[item.rarity]} icon={ICON[key]} />
              ) : (
                <Locked key={key} hint="Hidden at an event. Find it with your camera." />
              );
            })}
            {items.map((x) => (
              <Tile key={x.drop_id} name={x.collectible.name} tag="COLLECTIBLE" icon={Gift} art={x.collectible.art_url} />
            ))}
            {rewards.map((r) => (
              <Tile key={r.drop_id} name={r.reward} tag="REWARD" icon={Ticket} />
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3">
            <p className="seclabel flex-none">
              CAMERA HUNT SET · {hunted} OF {HUNT_KEYS.length}
            </p>
            <div
              role="progressbar"
              aria-label="Camera hunt set"
              aria-valuemin={0}
              aria-valuemax={HUNT_KEYS.length}
              aria-valuenow={hunted}
              className="flex h-1.5 flex-1 gap-[3px]"
            >
              {HUNT_KEYS.map((k, i) => (
                <span key={k} className={`h-full flex-1 rounded-full ${i < hunted ? "bg-brand-violet" : "bg-line"}`} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div aria-hidden className="h-[104px]" />
      )}
    </section>
  );
}
