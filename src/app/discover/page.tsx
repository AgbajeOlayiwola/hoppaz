"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import SwipeDeck from "@/components/SwipeDeck";
import { getSupabase } from "@/lib/supabase/client";
import { useHoppaz, useToast } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import { useEvents } from "@/lib/useEvents";
import { clockLagos, naira } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

export default function DiscoverPage() {
  const { fix } = useHoppaz();
  const { userId } = useSession();
  const { events } = useEvents(fix, 45);
  const say = useToast((s) => s.say);

  const [judged, setJudged] = useState<Set<string>>(new Set());
  const [inList, setInList] = useState<EventRow[]>([]);

  // Pick up what this Hopper already swiped so the deck does not repeat itself.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("swipes").select("event_id, decision").eq("user_id", userId);
      if (cancelled || !data) return;
      setJudged(new Set(data.map((r) => String(r.event_id))));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const deck = useMemo(
    () =>
      events
        .filter((e) => !judged.has(e.id))
        .slice()
        .sort((a, b) => a.distance_m - b.distance_m),
    [events, judged]
  );

  const onDecide = useCallback(
    async (event: EventRow, decision: "in" | "pass") => {
      setJudged((s) => new Set(s).add(event.id));
      if (decision === "in") {
        setInList((l) => [...l, event]);
        say(`YOU ARE IN · ${event.title.toUpperCase()}`);
      }
      const sb = getSupabase();
      if (!sb || !userId) return;
      const { error } = await sb
        .from("swipes")
        .upsert({ user_id: userId, event_id: event.id, decision }, { onConflict: "user_id,event_id" });
      if (error) console.warn("[hoppaz] swipe not saved:", error.message);
    },
    [userId, say]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="pad-top flex-none px-4 pb-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-black leading-none">Tonight</h1>
            <p className="seclabel mt-1.5">
              {deck.length} left{fix?.area ? ` · from ${fix.area}` : ""}
            </p>
          </div>
          <Link href="/" className="btn btn-ghost px-3 py-2 text-[10px]">
            MAP
          </Link>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 px-4">
        <SwipeDeck events={deck} fix={fix} onDecide={onDecide} />
      </div>

      {inList.length > 0 && (
        <footer className="pad-bottom flex-none border-t border-line px-4 pt-3">
          <p className="seclabel mb-2">You said you are in</p>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {inList.map((e) => (
              <li
                key={e.id}
                className="flex-none rounded border border-orange/60 bg-ink-2 px-2.5 py-1.5"
              >
                <p className="font-display text-[11px] font-black">{e.title}</p>
                <p className="hint text-[9px]">
                  {clockLagos(e.starts_at)} · {naira(e.price_naira)}
                </p>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
