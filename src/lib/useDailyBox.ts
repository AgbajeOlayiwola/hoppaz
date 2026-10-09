"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lagosDate } from "@/components/me/lagosDay";
import { getSupabase } from "./supabase/client";
import type { Rarity } from "./huntItems";

/** What today's box held. Same words and numbers the database used (supabase/daily_box.sql). */
export type DailyBox = { title: string; xp: number; rarity: Rarity };
export type OpenResult = { box: DailyBox; already: boolean } | { error: string };

/** The sample box a development run without a database hands out. */
const DEMO_BOX: DailyBox = { title: "Good find", xp: 30, rarity: "rare" };

/**
 * Today's box and this week's active days, for the Me tab. One box per Hopper
 * per Lagos day (open_daily_box); the week is the dates since Monday on which
 * anything counted toward the streak (my_week_days). Opening does not change
 * what the hook shows: call `reload` when the reveal closes, so the card does
 * not flip to "opened" behind the box.
 *
 * `status`: loading until the first read, "unavailable" when the database has
 * no daily box yet (supabase/daily_box.sql not run) or cannot be reached, then
 * "ready" (can open) or "opened". `demo` is the no-database development run.
 */
export function useDailyBox(userId: string | null, opts: { demo?: boolean } = {}) {
  const demo = !!opts.demo;
  const [box, setBox] = useState<DailyBox | null>(null);
  const [week, setWeek] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const readDay = useRef("");
  const demoBox = useRef<DailyBox | null>(null);

  const reload = useCallback(async () => {
    readDay.current = lagosDate(Date.now());
    const sb = getSupabase();
    if (demo || !sb) {
      setBox(demoBox.current);
      if (demo) setWeek(demoBox.current ? [readDay.current] : []);
      setAvailable(demo);
      setReady(true);
      return;
    }
    if (!userId) return;
    const [mine, days] = await Promise.all([
      sb.from("daily_boxes").select("reward_title,xp,rarity").eq("user_id", userId).eq("day", readDay.current).maybeSingle(),
      sb.rpc("my_week_days"),
    ]);
    setAvailable(!mine.error);
    setBox(mine.data ? { title: mine.data.reward_title, xp: mine.data.xp, rarity: mine.data.rarity } : null);
    setWeek(Array.isArray(days.data) ? (days.data as string[]) : []);
    setReady(true);
  }, [userId, demo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A page left open past midnight: read again once the Lagos day has turned over.
  useEffect(() => {
    const id = setInterval(() => {
      if (readDay.current && lagosDate(Date.now()) !== readDay.current) void reload();
    }, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const open = useCallback(async (): Promise<OpenResult> => {
    if (demo) {
      demoBox.current = DEMO_BOX;
      return { box: DEMO_BOX, already: false };
    }
    const sb = getSupabase();
    if (!sb) return { error: "You're offline. Try again when you're back." };
    const { data, error } = await sb.rpc("open_daily_box");
    const r = data as { ok?: boolean; already?: boolean; title?: string; xp?: number; rarity?: Rarity; reason?: string } | null;
    if (error || !r?.ok || !r.title || !r.xp || !r.rarity) {
      return { error: r?.reason === "not_signed_in" ? "Your session ran out. Reopen Hoppaz." : "That didn't open. Try again in a bit." };
    }
    return { box: { title: r.title, xp: r.xp, rarity: r.rarity }, already: !!r.already };
  }, [demo]);

  const status = !ready ? "loading" : !available ? "unavailable" : box ? "opened" : "ready";
  return { status, box, week, reload, open } as const;
}
