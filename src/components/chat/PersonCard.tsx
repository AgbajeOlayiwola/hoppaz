"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Flag, Hand, X } from "lucide-react";
import ChatFace from "./ChatFace";
import { blockPerson, reportThing, wave } from "@/lib/chat";
import { useToast } from "@/lib/store";

const REASONS = ["Harassment or threats", "Sexual or unwanted advances", "Spam or selling", "Hate or abuse", "Something else"];

/**
 * What you can do about a person you see in a room or in "who's here": wave,
 * block, report. Works on an opaque key, so it never learns who they are.
 */
export default function PersonCard({
  person,
  onClose,
  onWaved,
}: {
  person: { key: string; name: string; look?: unknown; anon: boolean; messageId?: string; excerpt?: string };
  onClose: () => void;
  onWaved?: () => void;
}) {
  const say = useToast((s) => s.say);
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const doWave = async () => {
    setBusy(true);
    const r = await wave(person.key);
    setBusy(false);
    say(r.text, r.dm ? "orange" : "violet");
    onWaved?.();
    if (r.dm) router.push(`/chat/dm/${r.dm}`);
    else onClose();
  };

  const doBlock = async () => {
    if (!window.confirm(`Block ${person.name}? You won't see each other in rooms, waves or DMs.`)) return;
    setBusy(true);
    const ok = await blockPerson({ key: person.key }, person.name);
    setBusy(false);
    say(ok ? "BLOCKED" : "COULD NOT BLOCK");
    onClose();
  };

  const doReport = async (reason: string) => {
    setBusy(true);
    const ok = person.messageId
      ? await reportThing("room", person.messageId, reason)
      : await reportThing("person", person.key, reason);
    setBusy(false);
    say(ok ? "REPORTED. THE CREW WILL LOOK AT IT" : "COULD NOT REPORT");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/60" onClick={onClose}>
      <div
        role="dialog"
        aria-label={person.name}
        className="m-3 w-full rounded-lg border border-line bg-ink-2 p-4 shadow-sheet animate-rise"
        style={{ marginBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <ChatFace look={person.anon ? null : person.look} alias={person.anon ? person.name : null} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-black">{person.name}</p>
            <p className="hint">{person.anon ? "Anonymous. Wave, and if they wave back you can chat." : "Wave, and if they wave back you can chat."}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center text-dim">
            <X size={16} />
          </button>
        </div>

        {person.excerpt && <p className="mt-3 border-l-2 border-line pl-3 text-[13px] text-cream/80">“{person.excerpt}”</p>}

        {!reporting ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button className="btn" onClick={doWave} disabled={busy}>
              <Hand size={14} /> WAVE
            </button>
            <button className="btn btn-ghost" onClick={doBlock} disabled={busy}>
              <Ban size={14} /> BLOCK
            </button>
            <button className="btn btn-ghost" onClick={() => setReporting(true)} disabled={busy}>
              <Flag size={14} /> REPORT
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="label">What happened</p>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <button key={r} className="btn btn-ghost justify-start" onClick={() => doReport(r)} disabled={busy}>
                  {r}
                </button>
              ))}
            </div>
            <p className="hint mt-2">Reports go to the Hoppaz crew with what they wrote. They&apos;re not told who reported.</p>
          </div>
        )}
      </div>
    </div>
  );
}
