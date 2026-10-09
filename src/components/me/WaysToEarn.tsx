"use client";

import { useEffect, useState } from "react";
import { Camera, Flag, Gift, MapPin, Package, type LucideIcon } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { levelFor } from "@/lib/brand";
import { useQuests, type Quest } from "@/lib/game";
import { DEMO, DEMO_QUEST_EVENTS, demoQuests } from "./demo";

/**
 * The "Ways to earn" sheet, opened from the XP tile (and from /me#earn, which
 * is where the old Quests page and the map's streak chip send people). It
 * lists the quests the app already loads, then the fixed things that always
 * earn XP. Read only: a quest is finished on its own event page.
 *
 * It sits inside the Sheet, so it only mounts (and only loads) while open.
 */
const PERIOD: Record<string, string> = { once: "ONCE", daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };

const ALWAYS: Array<{ icon: LucideIcon; title: string; line: string; drop?: boolean }> = [
  { icon: Package, title: "Open today's box", line: "One a day, on this tab. A little XP, and it keeps your streak.", drop: true },
  { icon: MapPin, title: "Check in at an event", line: "Get to the venue, tap CHECK IN. Being there is the whole job." },
  { icon: Camera, title: "Post a photo after you check in", line: "Put the night on the event page. We look at it first." },
  { icon: Flag, title: "Finish a quest", line: "Quests sit on the night they belong to. Do the thing, take the XP." },
  { icon: Gift, title: "Claim a drop", line: "Drops land at the venue. Be close, be quick.", drop: true },
];

export default function WaysToEarn({ userId, xp }: { userId: string | null; xp: number }) {
  const live = useQuests(userId);
  const [demo, setDemo] = useState<Quest[]>([]);
  const [names, setNames] = useState<Record<string, string>>(DEMO ? DEMO_QUEST_EVENTS : {});

  useEffect(() => {
    if (DEMO) setDemo(demoQuests());
  }, []);

  const quests = DEMO ? demo : live.quests;
  const ready = DEMO || live.ready;
  const eventKey = [...new Set(quests.map((q) => q.event_id).filter((id): id is string => !!id))].join(",");

  // Names of the events the quests are tied to, one light lookup.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !eventKey) return;
    let cancelled = false;
    void sb
      .from("events")
      .select("id,title")
      .in("id", eventKey.split(","))
      .then(({ data }) => {
        if (cancelled) return;
        setNames(Object.fromEntries(((data ?? []) as { id: string; title: string }[]).map((e) => [e.id, e.title])));
      });
    return () => {
      cancelled = true;
    };
  }, [eventKey]);

  const lvl = levelFor(xp);
  return (
    <div className="pb-3 pt-1">
      <h2 className="font-display text-[24px] font-black leading-tight">Ways to earn</h2>
      <p className="seclabel mt-1.5">
        {xp.toLocaleString("en-NG")} XP · {lvl.name}
        {lvl.next ? ` · ${lvl.toNext} TO ${lvl.next}` : ""}
      </p>
      {lvl.next && (
        <div aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-line">
          <i className="block h-full bg-cream" style={{ width: `${Math.round(lvl.progress * 100)}%` }} />
        </div>
      )}
      <p className="hint mt-3">XP is your level. More nights out, more XP. The bus keeps count.</p>

      <p className="seclabel mb-1 mt-6">QUESTS RIGHT NOW</p>
      {!ready ? (
        <p className="hint py-3">Checking the board.</p>
      ) : quests.length === 0 ? (
        <p className="hint py-3">No quests on the board. They show up on the night they belong to.</p>
      ) : (
        <ul>
          {quests.map((q) => {
            const done = live.claims[q.id];
            const event = q.event_id ? names[q.event_id] : null;
            return (
              <li key={q.id} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-[15px] font-semibold leading-tight">{q.title}</span>
                  <span className="mt-1 block font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-dim">
                    {PERIOD[q.repeat_period] ?? q.repeat_period.toUpperCase()}
                    {event ? ` · ${event}` : ""}
                  </span>
                </span>
                <span className="flex flex-none flex-col items-end gap-1.5">
                  <span className="flex items-baseline gap-1">
                    <span className="num text-[20px]">+{q.xp_reward}</span>
                    <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-dim">XP</span>
                  </span>
                  {done && <span className={done === "pending" ? "pill" : "pill pill-keke"}>{done === "pending" ? "IN REVIEW" : "DONE"}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="seclabel mb-1 mt-6">ALWAYS EARNS</p>
      <ul>
        {ALWAYS.map(({ icon: Icon, title, line, drop }) => (
          <li key={title} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
            <Icon size={19} strokeWidth={1.9} aria-hidden className={drop ? "mt-0.5 flex-none text-violet" : "mt-0.5 flex-none text-dim"} />
            <span className="min-w-0 flex-1">
              <span className="block font-body text-[15px] font-semibold leading-tight">{title}</span>
              <span className="hint mt-0.5 block">{line}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
