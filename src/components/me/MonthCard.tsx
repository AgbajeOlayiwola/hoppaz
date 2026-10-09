"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { DEMO, demoMonth } from "./demo";
import { inMonthWindow, lagosDate, lastMonth } from "./lagosDay";
import { readJSON, writeJSON } from "./seen";

const KEY = "hoppaz.me.monthcard";

/** Dev only: ?monthcard=1 shows the card on any day of the month (with last month's real numbers). Call after mount. */
const forced = () => process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("monthcard");

export type MonthCardData = {
  /** "SEPTEMBER" */
  month: string;
  /** "9 nights out" */
  headline: string;
  /** "3 boxes opened · 2 badges · #41 in Lagos", or null when there is nothing to say */
  detail: string | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The month card is the first thing on Me for the first three days of a new
 * month (Lagos time): last month, as numbers, with a way into the report card.
 * It goes away with the X, once per month, and stays gone on this phone.
 * Every number is last month's real one; one that cannot be read is left out,
 * and with no month to report there is no card.
 */
export function useMonthCard(userId: string | null, now: number | null, badgeDates: string[]) {
  const [force, setForce] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const [recap, setRecap] = useState<{ nights: number; days: number; boxes: number; badges: number | null; rank: number } | null>(null);

  useEffect(() => {
    const f = forced();
    setForce(f);
    setGone(f ? null : readJSON<string | null>(KEY, null));
  }, []);

  const today = now === null ? null : lagosDate(now);
  const month = today ? lastMonth(today) : null;
  const key = month?.key ?? null;
  const start = month?.start ?? null;
  const end = month?.end ?? null;
  const live = !!today && (force || inMonthWindow(today)) && gone !== key;

  useEffect(() => {
    if (!live || !start || !end) return;
    if (DEMO) {
      setRecap(demoMonth());
      return;
    }
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    void (async () => {
      const [stats, claims, daily] = await Promise.all([
        sb.rpc("my_game_stats", { p_month: start }),
        sb
          .from("drop_claims")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("claimed_at", `${start}T00:00:00+01:00`)
          .lt("claimed_at", `${end}T00:00:00+01:00`),
        sb.from("daily_boxes").select("day", { count: "exact", head: true }).eq("user_id", userId).gte("day", start).lt("day", end),
      ]);
      if (cancelled) return;
      const s = (stats.data ?? {}) as { verified_outings?: number; active_days?: number; lagos_rank?: number; outside_score?: number };
      setRecap({
        nights: Number(s.verified_outings ?? 0),
        days: Number(s.active_days ?? 0),
        boxes: (claims.count ?? 0) + (daily.count ?? 0),
        badges: null,
        // Only a rank with a score behind it: a Hopper who only opened boxes is not on the board.
        rank: Number(s.outside_score ?? 0) > 0 ? Number(s.lagos_rank ?? 0) : 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [live, userId, start, end]);

  const dismiss = useCallback(() => {
    if (!key) return;
    setGone(key);
    writeJSON(KEY, key);
  }, [key]);

  let card: MonthCardData | null = null;
  if (live && month && start && end && recap) {
    const badges = recap.badges ?? badgeDates.filter((iso) => {
      const day = lagosDate(Date.parse(iso));
      return day >= start && day < end;
    }).length;
    const headline = recap.nights > 0 ? `${plural(recap.nights, "night")} out` : recap.days > 0 ? plural(recap.days, "active day") : force ? "0 nights out" : null;
    const parts = [recap.boxes > 0 && `${plural(recap.boxes, "box", "boxes")} opened`, badges > 0 && plural(badges, "badge"), recap.rank > 0 && `#${recap.rank} in Lagos`].filter(Boolean);
    if (headline) card = { month: month.name, headline, detail: parts.length ? parts.join(" · ") : null };
  }
  return { card, dismiss };
}

/** An orange block, the one loud thing on Me for three days a month. */
export default function MonthCard({
  card,
  busy,
  onOpen,
  onDismiss,
}: {
  card: MonthCardData;
  busy: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const name = card.month.charAt(0) + card.month.slice(1).toLowerCase();
  return (
    <section aria-label={`Your ${name} card`} className="relative rounded-hz bg-orange p-4 text-brand-ink">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss your ${name} card`}
        className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center text-brand-ink/80 hover:text-brand-ink focus-visible:[outline-color:#0E0B0A]"
      >
        <X size={20} strokeWidth={2.2} aria-hidden />
      </button>
      <p className="pr-10 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-brand-ink/80">YOUR {card.month} IS READY</p>
      <p className="mt-2 font-display text-[34px] font-black leading-none tracking-[-0.01em]">{card.headline}</p>
      {card.detail && <p className="mt-2 font-body text-[13.5px] font-medium leading-snug">{card.detail}</p>}
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-hz bg-brand-ink px-5 py-3 font-display text-[13px] font-black uppercase tracking-[0.02em] text-brand-cream shadow-chunk transition-[transform,box-shadow] duration-75 active:translate-y-1 active:shadow-none disabled:opacity-60 focus-visible:[outline-color:#0E0B0A]"
      >
        {busy ? "MAKING IT" : "OPEN YOUR CARD"}
      </button>
    </section>
  );
}
