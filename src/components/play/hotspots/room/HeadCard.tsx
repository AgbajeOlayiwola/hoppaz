"use client";

import { useState } from "react";
import Sheet from "@/components/Sheet";
import ChatFace from "@/components/chat/ChatFace";
import { blockPerson } from "@/lib/chat";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { reportHotspot } from "./api";
import { REASONS, reportCopy } from "./copy";

/** Who the card is about: a head on the stage, or the author of a message (then `messageId` and `excerpt` are set). */
export type HeadPerson = { key: string; alias: string; look: unknown; messageId?: string; excerpt?: string };

/**
 * What you can do about someone in a hotspot: report them (or the message you tapped) and block them. Wave,
 * Link up and Vibe come with Play mode Phase 5; until then a hotspot has chat, Block and Report only.
 * Block and Report work on the opaque room key, so the browser never learns who it is.
 */
export default function HeadCard({
  person,
  onClose,
  onBlocked,
}: {
  person: HeadPerson;
  onClose: () => void;
  /** After a block: hide their messages and re-read the room. */
  onBlocked: (key: string) => void;
}) {
  const say = useToast((s) => s.say);
  const [step, setStep] = useState<"actions" | "block" | "report">("actions");
  const [busy, setBusy] = useState(false);

  const doBlock = async () => {
    setBusy(true);
    const ok = getSupabase() ? await blockPerson({ key: person.key }, person.alias) : true;
    setBusy(false);
    say(ok ? "Blocked." : "Could not block them. Try again.", ok ? "ok" : "error");
    if (ok) onBlocked(person.key);
    onClose();
  };

  const doReport = async (reason: string) => {
    setBusy(true);
    const r = getSupabase() ? await reportHotspot(person.messageId ?? person.key, reason) : { ok: true as const };
    setBusy(false);
    const out = reportCopy(r.ok ? null : r.reason);
    say(out.text, out.ok ? "ok" : "error");
    onClose();
  };

  return (
    <>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onClose} aria-hidden />
      <Sheet open onClose={onClose} label={person.alias}>
        <div className="flex items-start gap-3 pr-10">
          <ChatFace look={person.look} alias={person.look ? null : person.alias} size={48} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate font-display text-base font-black leading-tight">{person.alias}</p>
            <p className="hint mt-1">An alias. Nobody in a hotspot sees real names.</p>
          </div>
        </div>

        {person.excerpt && <p className="mt-3 break-words border-l-2 border-line pl-3 font-body text-[14px] leading-snug text-cream/80">“{person.excerpt}”</p>}

        {step === "actions" && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-fireant disabled:opacity-50"
              onClick={() => setStep("block")}
              disabled={busy}
            >
              Block
            </button>
            <span aria-hidden className="h-4 w-px bg-line" />
            <button
              className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-cream disabled:opacity-50"
              onClick={() => setStep("report")}
              disabled={busy}
            >
              {person.messageId ? "Report this message" : "Report"}
            </button>
          </div>
        )}

        {step === "block" && (
          <div className="mt-4 rounded-hz border border-line bg-ink-3 p-3">
            <p className="font-display text-sm font-black">Block {person.alias}?</p>
            <p className="hint mt-0.5">You will not see each other in hotspots. Blocking here does not reach anywhere else.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-ghost border-fireant text-fireant" onClick={doBlock} disabled={busy}>
                BLOCK
              </button>
              <button className="btn btn-ghost" onClick={() => setStep("actions")} disabled={busy}>
                CANCEL
              </button>
            </div>
          </div>
        )}

        {step === "report" && (
          <div className="mt-4">
            <p className="label">What happened</p>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <button key={r} className="btn btn-ghost justify-start" onClick={() => doReport(r)} disabled={busy}>
                  {r}
                </button>
              ))}
            </div>
            <p className="hint mt-2">Reports go to the Hoppaz crew with what they wrote. They are not told who reported.</p>
            <button className="mt-1 min-h-[44px] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim" onClick={() => setStep("actions")} disabled={busy}>
              Back
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
