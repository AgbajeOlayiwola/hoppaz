"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Ban, Flag, Hand, UserPlus, X } from "lucide-react";
import ChatFace from "./ChatFace";
import { addToCrew, blockPerson, reportThing, wave } from "@/lib/chat";
import { useToast } from "@/lib/store";

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
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const doWave = async () => {
    setBusy(true);
    const r = await wave(person.key);
    setBusy(false);
    say(r.text, r.dm ? "orange" : "violet");
    onChanged?.();
    if (r.dm) router.push(`/chat/dm/${r.dm}`);
    else onClose();
  };

  const doAdd = async () => {
    setBusy(true);
    const r = await addToCrew(person.key);
    setBusy(false);
    say(r.text, r.ok ? "violet" : "orange");
    onChanged?.();
    onClose();
  };

  const doBlock = async () => {
    if (!window.confirm(`Block ${person.name}? You won't see each other in rooms, waves or DMs.`)) return;
    setBusy(true);
    const ok = await blockPerson({ key: person.key }, person.handle ?? person.name);
    setBusy(false);
    say(ok ? "BLOCKED" : "COULD NOT BLOCK");
    onChanged?.();
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
          <ChatFace look={person.anon ? null : person.look} alias={person.anon || !person.look ? person.handle ?? person.name : null} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-black">{person.name}</p>
            {person.handle && <p className="truncate font-mono text-[10px] font-bold text-orange">@{person.handle}</p>}
            <p className="hint">Wave, and if they wave back you can chat privately.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center text-dim">
            <X size={16} />
          </button>
        </div>

        {person.excerpt && <p className="mt-3 border-l-2 border-line pl-3 text-[13px] text-cream/80">“{person.excerpt}”</p>}

        {!reporting ? (
          <>
            {hasAccount ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="btn" onClick={doWave} disabled={busy || person.waved}>
                  <Hand size={14} /> {person.waved ? "WAVED" : "WAVE"}
                </button>
                <button className="btn btn-ghost" onClick={doAdd} disabled={busy || person.inCrew}>
                  <UserPlus size={14} /> {person.inCrew ? "IN YOUR CREW" : "ADD TO CREW"}
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded border border-line bg-ink p-3">
                <p className="font-display text-sm font-black">Make a free account to wave or add {person.handle ? `@${person.handle}` : "them"}.</p>
                <p className="hint">Name, email and a password. Takes a minute.</p>
                <Link href={`/account?next=${encodeURIComponent(path)}`} className="btn mt-2.5 w-full">
                  MAKE AN ACCOUNT
                </Link>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" onClick={doBlock} disabled={busy}>
                <Ban size={14} /> BLOCK
              </button>
              <button className="btn btn-ghost" onClick={() => setReporting(true)} disabled={busy}>
                <Flag size={14} /> REPORT
              </button>
            </div>
          </>
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
