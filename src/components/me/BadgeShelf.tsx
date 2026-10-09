"use client";

import { useState } from "react";
import clsx from "clsx";
import Sheet from "@/components/Sheet";
import { BADGES, CAPTAIN_HOPS } from "@/lib/brand";
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
 * any stamp for the date you earned it, or how to.
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

  return (
    <section aria-label="Badges" className="mt-7">
      <p className="seclabel mb-3">
        BADGES · {got.length} OF {badges.length}
      </p>
      <ul className="grid grid-cols-4 gap-y-4">
        {ordered.map((b) => {
          const has = !!earned[b.key];
          return (
            <li key={b.key} className="flex justify-center">
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
