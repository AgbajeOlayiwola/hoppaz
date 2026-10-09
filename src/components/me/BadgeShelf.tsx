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
 * The badge shelf: each badge is a small ticket stub with a stamp on it, its
 * name and the date you earned it. A badge you do not have yet is a dashed
 * outline with how to earn it. Tap any stub for the details.
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
      <p className="seclabel mb-2.5">
        BADGES · {got.length} OF {badges.length}
      </p>
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ordered.map((b) => {
          const has = !!earned[b.key];
          return (
            <li key={b.key} className="flex w-[116px] flex-none">
              <button
                type="button"
                onClick={() => setOpen(b)}
                aria-label={has ? `${b.name}, earned ${shortDate(earned[b.key])}` : `${b.name}, not earned yet. ${b.how}`}
                className={clsx("stub flex w-full flex-col text-center", !has && "border-dashed bg-transparent")}
                style={{ ["--notch" as string]: "6px", ["--notch-y" as string]: "68px" } as React.CSSProperties}
              >
                <span className="grid h-[68px] flex-none place-items-center">
                  <StampMark icon={b.icon} size={44} earned={has} stamp={has && fresh.has(b.key)} />
                </span>
                <span className="flex flex-1 flex-col items-center border-t border-dashed border-line px-2 pb-3 pt-2.5">
                  <span className="font-display text-[12.5px] font-black leading-tight">{b.name}</span>
                  {has ? (
                    <span className="mt-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-dim">
                      {shortDate(earned[b.key])}
                    </span>
                  ) : (
                    <span className="mt-1.5 line-clamp-3 font-body text-[12px] leading-snug text-dim">{b.how}</span>
                  )}
                </span>
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
