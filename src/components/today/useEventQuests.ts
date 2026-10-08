"use client";

import { useMemo } from "react";
import { demoQuests, isDemoEvent } from "@/components/event/demo";
import { useQuests } from "@/lib/game";
import type { EventRow } from "@/lib/types";

export type StubQuest = { id: string; title: string; xp: number };

/**
 * Each event's own quests and what they pay, from the quests the app already
 * loads (useQuests). City-wide quests (no event) are not listed here; they
 * belong in "Ways to earn". One hook for the whole list, not one per stub.
 *
 * Local development has no database, so a few sample events borrow the event
 * page's sample quests; a player in production only ever sees real rows.
 */
export function useEventQuests(userId: string | null, events: EventRow[]) {
  const { quests } = useQuests(userId);
  return useMemo(() => {
    const byEvent = new Map<string, StubQuest[]>();
    for (const q of quests) {
      if (!q.event_id) continue;
      const list = byEvent.get(q.event_id) ?? [];
      list.push({ id: q.id, title: q.title, xp: q.xp_reward });
      byEvent.set(q.event_id, list);
    }
    for (const e of events) {
      if (byEvent.has(e.id) || !isDemoEvent(e.id) || e.heat < 40) continue;
      byEvent.set(e.id, demoQuests(e.id).map((q) => ({ id: q.id, title: q.title, xp: q.xp_reward })));
    }
    return byEvent;
  }, [quests, events]);
}
