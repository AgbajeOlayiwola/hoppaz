"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Hand, UserPlus } from "lucide-react";
import ChatFace from "./ChatFace";
import Sheet from "@/components/Sheet";
import { addToCrew, blockPerson, reportThing, wave } from "@/lib/chat";
import { useToast } from "@/lib/store";
import { sentence } from "@/components/event/copy";

const REASONS = ["Harassment or threats", "Sexual or unwanted advances", "Spam or selling", "Hate or abuse", "Something else"];

export type CardPerson = {
  key: string;
  name: string;
  handle?: string | null;
  look?: unknown;
  /** Old anonymous posts: alias only, no look. */
  anon?: boolean;
  waved?: boolean;
  inCrew?: boolean;
  messageId?: string;
  excerpt?: string;
};

/**
 * What you can do about a person you see in a room or in the people strip:
 * wave, add to your crew, block, report. Works on an opaque room key, so the
 * browser never learns their user id. Waving and adding need an account.
 *
 * It is the shared Sheet (grab handle, hairline top, Escape to close) with a
 * scrim behind it. WAVE is the one orange button; Block and Report are quiet
 * text underneath, and Block confirms inside the sheet instead of a browser pop-up.
 */
export default function PersonCard({
  person,
  hasAccount,
  onClose,
  onChanged,
}: {
  person: CardPerson;
  hasAccount: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const say = useToast((s) => s.say);
  const router = useRouter();
  const path = usePathname();
  const [step, setStep] = useState<"actions" | "block" | "report">("actions");
  const [busy, setBusy] = useState(false);

  const anon = !!person.anon || !person.look;

  const doWave = async () => {
    setBusy(true);
    const r = await wave(person.key);
    setBusy(false);
    // The server words its answers; sent or matched is a win, a repeat is neutral, the rest failed.
    const tone = r.dm || r.text.startsWith("WAVE SENT") ? "ok" : r.text === "ALREADY WAVED" ? "orange" : "error";
    say(sentence(r.text), tone);
    onChanged?.();
    if (r.dm) router.push(`/chat/dm/${r.dm}`);
    else onClose();
  };

  const doAdd = async () => {
    setBusy(true);
    const r = await addToCrew(person.key);
    setBusy(false);
    say(sentence(r.text), r.ok ? "ok" : "error");
    onChanged?.();
    onClose();
  };

  const doBlock = async () => {
    setBusy(true);
    const ok = await blockPerson({ key: person.key }, person.handle ?? person.name);
    setBusy(false);
    say(ok ? "Blocked." : "Couldn't block them. Try again.", ok ? "ok" : "error");
    onChanged?.();
    onClose();
  };

  const doReport = async (reason: string) => {
    setBusy(true);
    const ok = person.messageId
      ? await reportThing("room", person.messageId, reason)
      : await reportThing("person", person.key, reason);
    setBusy(false);
    say(ok ? "Reported. The Hoppaz crew will look at it." : "Couldn't send the report. Try again.", ok ? "ok" : "error");
    onClose();
  };

  return (
    <>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onClose} aria-hidden />
      <Sheet open onClose={onClose} label={person.name}>
        <div className="flex items-start gap-3 pr-10">
          <ChatFace look={anon ? null : person.look} alias={anon ? person.handle ?? person.name : null} size={48} caption />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate font-display text-base font-black leading-tight">{person.name}</p>
            {person.handle && <p className="mt-0.5 truncate font-mono text-[11px] text-dim">@{person.handle}</p>}
            <p className="hint mt-1">Wave, and if they wave back you can chat privately.</p>
          </div>
        </div>

        {person.excerpt && (
          <p className="mt-3 border-l-2 border-line pl-3 font-body text-[14px] leading-snug text-cream/80">“{person.excerpt}”</p>
        )}

        {step === "actions" && (
          <div className="mt-4">
            {hasAccount ? (
              <div className="flex flex-col gap-2">
                <button className="btn w-full" onClick={doWave} disabled={busy || person.waved}>
                  <Hand size={15} /> {person.waved ? "WAVED" : "WAVE"}
                </button>
                <button className="btn btn-ghost w-full" onClick={doAdd} disabled={busy || person.inCrew}>
                  <UserPlus size={15} /> {person.inCrew ? "IN YOUR CREW" : "ADD TO CREW"}
                </button>
              </div>
            ) : (
              <div className="rounded-hz border border-line bg-ink-3 p-3">
                <p className="font-display text-sm font-black">Make a free account to wave or add {person.handle ? `@${person.handle}` : "them"}.</p>
                <p className="hint mt-0.5">Name, email and a password. Takes a minute.</p>
                <Link href={`/account?next=${encodeURIComponent(path)}`} className="btn mt-3 w-full">
                  MAKE AN ACCOUNT
                </Link>
              </div>
            )}
            <div className="mt-1 flex items-center justify-center gap-2">
              <button
                className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-fireant disabled:opacity-50"
                onClick={() => setStep("block")}
                disabled={busy}
              >
                Block
              </button>
              <span aria-hidden className="h-4 w-px bg-line" />
              <button
                className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim disabled:opacity-50"
                onClick={() => setStep("report")}
                disabled={busy}
              >
                Report
              </button>
            </div>
          </div>
        )}

        {step === "block" && (
          <div className="mt-4 rounded-hz border border-line bg-ink-3 p-3">
            <p className="font-display text-sm font-black">Block {person.name}?</p>
            <p className="hint mt-0.5">You won&apos;t see each other in rooms, waves or DMs.</p>
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
            <p className="hint mt-2">
              Reports go to the Hoppaz crew with what they wrote. They&apos;re not told who reported.{" "}
              <Link href="/community" className="hz-link">
                Community rules
              </Link>
            </p>
            <button className="mt-1 min-h-[44px] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim" onClick={() => setStep("actions")} disabled={busy}>
              Back
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
