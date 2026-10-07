"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Users } from "lucide-react";
import QrScanner from "@/components/QrScanner";
import { useQuests, useGroups, type Quest } from "@/lib/game";
import { useToast } from "@/lib/store";

export default function EventQuestList({ eventId, userId, checkedIn, hasPhoto }: { eventId: string; userId: string | null; checkedIn: boolean; hasPhoto: boolean }) {
  const { quests, claims, busy, claim } = useQuests(userId);
  const { groups } = useGroups(userId);
  const say = useToast((s) => s.say);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [insights, setInsights] = useState<Record<string, string>>({});
  const [crewIds, setCrewIds] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState<string | null>(null);
  const relevant = quests.filter((quest) => !quest.event_id || quest.event_id === eventId);

  if (!relevant.length) return null;

  const complete = async (quest: Quest) => {
    const result = await claim(quest, {
      eventId,
      code: codes[quest.id],
      evidence: insights[quest.id],
      crewId: crewIds[quest.id],
    });
    say(result, result.includes("COMPLETE") || result.includes("SUBMITTED") ? "violet" : "orange");
  };

  return (
    <section className="mt-4 rounded border border-orange/40 bg-orange/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="seclabel text-orange">THINGS TO DO HERE</p>
        <span className="tag">{relevant.length} QUEST{relevant.length === 1 ? "" : "S"}</span>
      </div>
      {relevant.map((quest) => {
        const status = claims[quest.id];
        const requiresCheckin = quest.quest_type === "checkin" || quest.quest_type === "photo";
        const needsCode = quest.quest_type === "qr" || quest.quest_type === "insight";
        const needsInsight = quest.quest_type === "insight";
        const needsCrew = quest.quest_type === "group";
        const blocked = !!status || busy === quest.id || (requiresCheckin && !checkedIn) ||
          (quest.quest_type === "photo" && !hasPhoto) ||
          (needsCode && !codes[quest.id]?.trim()) || (needsInsight && !insights[quest.id]?.trim()) ||
          (needsCrew && !crewIds[quest.id]);

        return <article key={quest.id} className="border-t border-line py-2.5 first:border-0">
          <div className="flex items-start gap-2">
            <span className="grid h-7 w-7 flex-none place-items-center rounded bg-orange/10 text-orange">
              {needsCrew ? <Users size={14} /> : quest.quest_type === "photo" ? "📸" : quest.quest_type === "qr" ? "▦" : "✦"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-sm font-bold">{quest.title}</h3>
                <span className="tag tag-o flex-none">+{quest.xp_reward} XP</span>
              </div>
              <p className="hint">{quest.description}</p>
              {requiresCheckin && !checkedIn && <p className="mt-1 font-mono text-[8px] font-bold text-dim">CHECK IN HERE TO UNLOCK</p>}
              {quest.quest_type === "photo" && checkedIn && !hasPhoto && <p className="mt-1 font-mono text-[8px] font-bold text-dim">ADD A PHOTO BELOW TO UNLOCK</p>}
            </div>
          </div>
          {needsCode && <div className="mt-2 flex gap-1.5">
            <input aria-label={`Venue code for ${quest.title}`} value={codes[quest.id] ?? ""} onChange={(e) => setCodes({ ...codes, [quest.id]: e.target.value })} placeholder="Venue code" />
            <button type="button" className="btn btn-ghost flex-none px-3" onClick={() => setScanning(quest.id)} aria-label="Scan quest QR">▦</button>
          </div>}
          {needsInsight && <textarea className="mt-2" maxLength={500} value={insights[quest.id] ?? ""} onChange={(e) => setInsights({ ...insights, [quest.id]: e.target.value })} placeholder="One thing you learned" />}
          {needsCrew && <div className="mt-2 flex gap-2">
            <select className="min-w-0 flex-1" value={crewIds[quest.id] ?? ""} onChange={(e) => setCrewIds({ ...crewIds, [quest.id]: e.target.value })}>
              <option value="">Choose your crew</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            {!groups.length && <Link href="/crew" className="btn btn-ghost flex-none px-2">MAKE A CREW</Link>}
          </div>}
          <button disabled={blocked} onClick={() => void complete(quest)} className="btn btn-ghost mt-2 w-full px-3 py-2">
            {status === "pending" ? <><Clock3 size={13} /> IN REVIEW</> : status ? <><CheckCircle2 size={13} /> COMPLETE</> : busy === quest.id ? "SAVING…" : "DO THIS · EARN XP"}
          </button>
        </article>;
      })}
      {scanning && <QrScanner onRead={(value) => { setCodes({ ...codes, [scanning]: value }); setScanning(null); say("QR CODE READ", "violet"); }} onClose={() => setScanning(null)} />}
    </section>
  );
}
