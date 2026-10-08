"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Camera, Check, ChevronDown, Clock3, Lock, MapPin, PenLine, QrCode, Users } from "lucide-react";
import QrScanner from "@/components/QrScanner";
import { useQuests, useGroups, type Quest } from "@/lib/game";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { demoQuests, isDemoEvent } from "@/components/event/demo";
import { looksDone, sentence } from "@/components/event/copy";

const ICONS: Record<Quest["quest_type"], typeof Camera> = {
  checkin: MapPin,
  photo: Camera,
  qr: QrCode,
  insight: PenLine,
  group: Users,
};

/** Only mounted when a crew quest is opened, so the crew lists load only then. */
function CrewPicker({ userId, value, onChange }: { userId: string | null; value: string; onChange: (id: string) => void }) {
  const { groups } = useGroups(userId);
  return (
    <div className="mt-2 flex gap-2">
      <select aria-label="Your crew" className="min-w-0 flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose your crew</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      {!groups.length && (
        <Link href="/crew" className="btn btn-ghost flex-none px-3">
          MAKE A CREW
        </Link>
      )}
    </div>
  );
}

/**
 * The quests tied to THIS event, one line each with the reward. Tap a line and
 * its form opens (a code, a note, a crew); nothing else is on screen until you
 * do. Quests that need a check-in stay folded until you are in. City-wide
 * quests live on Me, not here.
 */
export default function EventQuestList({
  eventId,
  userId,
  checkedIn,
  hasPhoto,
  onAddPhoto,
  uploading = false,
}: {
  eventId: string;
  userId: string | null;
  checkedIn: boolean;
  hasPhoto: boolean;
  /** Opens the photo picker, for a photo quest that is waiting on a picture. */
  onAddPhoto?: () => void;
  uploading?: boolean;
}) {
  const live = useQuests(userId);
  const say = useToast((s) => s.say);
  const demo = isDemoEvent(eventId) && !getSupabase();
  const [demoClaims, setDemoClaims] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [insights, setInsights] = useState<Record<string, string>>({});
  const [crewIds, setCrewIds] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState<string | null>(null);

  const quests = demo ? demoQuests(eventId) : live.quests;
  const claims = demo ? demoClaims : live.claims;
  const busy = demo ? null : live.busy;
  const relevant = quests.filter((quest) => quest.event_id === eventId);
  if (!relevant.length) return null;

  const complete = async (quest: Quest) => {
    if (demo) {
      setDemoClaims({ ...demoClaims, [quest.id]: "ok" });
      setOpen(null);
      say("Quest done.", "ok");
      return;
    }
    const result = await live.claim(quest, {
      eventId,
      code: codes[quest.id],
      evidence: insights[quest.id],
      crewId: crewIds[quest.id],
    });
    const done = looksDone(result);
    say(done ? (result.includes("REVIEW") ? "Sent for review." : "Quest done.") : sentence(result), done ? "ok" : "error");
    if (done) setOpen(null);
  };

  const anyLocked = relevant.some((q) => (q.quest_type === "checkin" || q.quest_type === "photo") && !checkedIn && !claims[q.id]);

  return (
    <section className="px-5 pt-6" aria-label="Quests here">
      <p className="seclabel">QUESTS</p>
      <ul className="mt-1">
        {relevant.map((quest) => {
          const status = claims[quest.id];
          const Icon = ICONS[quest.quest_type] ?? MapPin;
          const requiresCheckin = quest.quest_type === "checkin" || quest.quest_type === "photo";
          const needsCode = quest.quest_type === "qr" || quest.quest_type === "insight";
          const needsInsight = quest.quest_type === "insight";
          const needsCrew = quest.quest_type === "group";
          const locked = requiresCheckin && !checkedIn && !status;
          const finished = !!status && status !== "pending";
          const inReview = status === "pending";
          const expandable = !locked && !status;
          const isOpen = open === quest.id && expandable;
          const needsPhoto = quest.quest_type === "photo" && !hasPhoto;
          const blocked =
            busy === quest.id ||
            needsPhoto ||
            (needsCode && !codes[quest.id]?.trim()) ||
            (needsInsight && !insights[quest.id]?.trim()) ||
            (needsCrew && !crewIds[quest.id]);
          const panel = `quest-${quest.id}`;

          return (
            <li key={quest.id} className="border-t border-line first:border-t-0">
              <button
                type="button"
                disabled={!expandable}
                aria-expanded={expandable ? isOpen : undefined}
                aria-controls={expandable ? panel : undefined}
                onClick={() => setOpen(isOpen ? null : quest.id)}
                className="flex min-h-[48px] w-full items-center gap-3 py-2 text-left"
              >
                {finished ? (
                  <Check size={18} strokeWidth={2.5} className="flex-none text-keke" aria-hidden />
                ) : inReview ? (
                  <Clock3 size={18} className="flex-none text-dim" aria-hidden />
                ) : (
                  <Icon size={18} className={clsx("flex-none", locked ? "text-dim/60" : "text-dim")} aria-hidden />
                )}
                <span className={clsx("min-w-0 flex-1 truncate font-body text-[14px] font-medium", locked || finished ? "text-dim" : "text-cream")}>
                  {quest.title}
                </span>
                <span className="flex-none font-mono text-[11.5px] font-medium uppercase tracking-[0.06em] text-dim">
                  {finished ? <span className="text-keke">DONE</span> : inReview ? "IN REVIEW" : <>+{quest.xp_reward} XP</>}
                </span>
                {locked ? (
                  <Lock size={14} className="flex-none text-dim/60" aria-label="Unlocks when you check in" />
                ) : expandable ? (
                  <ChevronDown size={16} className={clsx("flex-none text-dim transition-transform", isOpen && "rotate-180")} aria-hidden />
                ) : (
                  <span className="w-4 flex-none" aria-hidden />
                )}
              </button>

              {isOpen && (
                <div id={panel} className="pb-4 pl-[30px]">
                  {quest.description && <p className="hint">{quest.description}</p>}
                  {needsCode && (
                    <div className="mt-2 flex gap-2">
                      <input
                        aria-label={`Venue code for ${quest.title}`}
                        value={codes[quest.id] ?? ""}
                        onChange={(e) => setCodes({ ...codes, [quest.id]: e.target.value })}
                        placeholder="Venue code"
                      />
                      <button type="button" className="btn btn-ghost w-11 flex-none px-0" onClick={() => setScanning(quest.id)} aria-label="Scan the venue code">
                        <QrCode size={18} />
                      </button>
                    </div>
                  )}
                  {needsInsight && (
                    <textarea
                      className="mt-2"
                      rows={2}
                      maxLength={500}
                      value={insights[quest.id] ?? ""}
                      onChange={(e) => setInsights({ ...insights, [quest.id]: e.target.value })}
                      placeholder="One thing you learned"
                    />
                  )}
                  {needsCrew && <CrewPicker userId={userId} value={crewIds[quest.id] ?? ""} onChange={(id) => setCrewIds({ ...crewIds, [quest.id]: id })} />}
                  {needsPhoto && (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="hint">Post a photo from the night first.</p>
                      {onAddPhoto && (
                        <button type="button" onClick={onAddPhoto} disabled={uploading} className="btn btn-ghost flex-none px-3">
                          <Camera size={16} /> {uploading ? "SENDING…" : "ADD A PHOTO"}
                        </button>
                      )}
                    </div>
                  )}
                  <button disabled={blocked} onClick={() => void complete(quest)} className="btn mt-3 w-full">
                    {busy === quest.id ? "SAVING…" : "CLAIM"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {anyLocked && <p className="hint mt-1">Some quests unlock when you check in.</p>}
      {scanning && (
        <QrScanner
          onRead={(value) => {
            setCodes({ ...codes, [scanning]: value });
            setScanning(null);
            say("Code read.", "ok");
          }}
          onClose={() => setScanning(null)}
        />
      )}
    </section>
  );
}
