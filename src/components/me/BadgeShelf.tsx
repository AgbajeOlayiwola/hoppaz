"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import Sheet from "@/components/Sheet";
import { BADGES, CAPTAIN_HOPS } from "@/lib/brand";
import { sfx } from "@/lib/sound/sfx";
import { haptics } from "@/lib/haptics";
import StampMark from "./StampMark";
import { shortDate } from "./dropTime";

export type ShelfBadge = { key: string; name: string; how: string; icon: string };

/** The built-in badges plus anything the database added (quest badges get the generic stamp). */
export function shelfBadges(extra: { key: string; name: string; description: string }[]): ShelfBadge[] {
  return [
    ...BADGES.map((b) => ({ key: b.key, name: b.name, how: b.how, icon: b.icon })),
    ...extra.map((b) => ({ key: b.key, name: b.name, how: b.description || "Earned on a quest", icon: "Stamp" })),
  ];
}

/**
 * The badge shelf: each badge is a round rubber stamp with its name under it.
 * One you have is a solid disc; one you do not have yet is a dashed ring. Tap
 * any stamp for the date you earned it, or how to. Badges you have not seen
 * before stamp in one after another, 220ms apart (the beat of the check-in
 * strip), each with its stamp sound.
 */
export default function BadgeShelf({
  badges,
  earned,
  fresh,
}: {
  badges: ShelfBadge[];
  /** badge key to when it was earned (ISO) */
  earned: Record<string, string>;
  /** badges you have not seen before: they stamp in once */
  fresh: Set<string>;
}) {
  const [open, setOpen] = useState<ShelfBadge | null>(null);
  // What you have first (newest first), then what is left to chase, in the shelf's own order.
  const got = badges.filter((b) => earned[b.key]).sort((a, b) => Date.parse(earned[b.key]) - Date.parse(earned[a.key]));
  const left = badges.filter((b) => !earned[b.key]);
  const ordered = [...got, ...left];
  const detail = open ? ordered.find((b) => b.key === open.key) ?? open : null;

  // The new ones, in shelf order. Each stamps 220ms behind the one before (the delay on its <li>), and its sound
  // rides the same delay. The page marks a badge as seen as soon as it hands it over, so a badge that has sounded
  // is remembered here, and the timers run on even if `fresh` empties before the last one lands.
  const newKeys = got.filter((b) => fresh.has(b.key)).map((b) => b.key);
  const newList = newKeys.join(" ");
  const sounded = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (!newList) return;
    let buzzed = false;
    newList.split(" ").forEach((key, i) => {
      if (sounded.current.has(key)) return;
      sounded.current.add(key);
      // one buzz for the batch, on its first stamp: the next would land inside the 400ms window and be dropped
      const buzz = !buzzed;
      buzzed = true;
      timers.current.push(
        setTimeout(() => {
          sfx.stamp();
          if (buzz) haptics.buzz("stampSmall");
        }, i * 220)
      );
    });
  }, [newList]);
  useEffect(() => {
    const pending = timers.current;
    const done = sounded.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
      done.clear();
    };
  }, []);

  return (
    <section aria-label="Badges" className="mt-7">
      <p className="seclabel mb-3">
        BADGES · {got.length} OF {badges.length}
      </p>
      <ul className="grid grid-cols-4 gap-y-4">
        {ordered.map((b) => {
          const has = !!earned[b.key];
          return (
            <li
              key={b.key}
              className="flex justify-center [&_.animate-stamp]:[animation-delay:var(--stamp-delay)]"
              style={has && fresh.has(b.key) ? ({ "--stamp-delay": `${newKeys.indexOf(b.key) * 220}ms` } as CSSProperties) : undefined}
            >
              <button
                type="button"
                onClick={() => setOpen(b)}
                aria-label={has ? `${b.name}, earned ${shortDate(earned[b.key])}` : `${b.name}, not earned yet. ${b.how}`}
                className="flex min-h-[44px] w-full flex-col items-center gap-2 rounded-hz px-0.5 text-center"
              >
                <StampMark icon={b.icon} size={58} earned={has} stamp={has && fresh.has(b.key)} />
                <span className={clsx("line-clamp-2 font-display text-[11.5px] font-black leading-[1.15]", !has && "text-dim")}>{b.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <Sheet open={!!detail} onClose={() => setOpen(null)} label={detail ? `${detail.name} badge` : "Badge"}>
        {detail && (
          <div className="flex flex-col items-center pb-3 pt-2 text-center">
            <StampMark icon={detail.icon} size={84} earned={!!earned[detail.key]} />
            <h2 className="mt-4 font-display text-[24px] font-black leading-tight">{detail.name}</h2>
            <p className="mt-2">
              {earned[detail.key] ? (
                <span className="pill pill-keke">EARNED {shortDate(earned[detail.key])}</span>
              ) : (
                <span className="pill">NOT YET</span>
              )}
            </p>
            <p className="mt-3 max-w-[30ch] font-body text-[15px] leading-snug">{detail.how}</p>
            {detail.key === "hop" && (
              <p className="hint mt-2 max-w-[32ch]">Ride {CAPTAIN_HOPS} Hops and you make Captain. The bus never waits.</p>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
}
