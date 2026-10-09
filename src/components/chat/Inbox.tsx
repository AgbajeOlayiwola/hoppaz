"use client";

import Link from "next/link";
import type { DmThread, Wave } from "@/lib/types";
import ChatFace from "./ChatFace";
import { rowTime } from "./Bubble";

/**
 * The second tab of Chat: people who waved at you, then your private chats.
 * Plain rows on the card colour. The only orange here is the one thing you can answer with.
 */
export default function Inbox({
  waves,
  dms,
  hasAccount,
  onAnswer,
  onPass,
}: {
  waves: Wave[];
  dms: DmThread[];
  hasAccount: boolean;
  onAnswer: (wave: Wave) => void;
  onPass: (wave: Wave) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {!hasAccount && <AccountNudge text="Make an account to answer waves and chat privately." />}
      {waves.length > 0 && (
        <>
          <p className="seclabel mb-2">They waved at you</p>
          {waves.map((w) => (
            <div key={w.id} className="card mb-2 flex items-center gap-3 py-3">
              <ChatFace look={w.from_look} alias={w.from_look ? null : w.from_alias} size={38} caption={!w.from_look} />
              <div className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">@{w.from_alias}</b>
                <p className="hint">{w.event_title ? `Met at ${w.event_title}` : "Someone you met out"}</p>
              </div>
              <button className="btn px-3" onClick={() => onAnswer(w)}>CHAT</button>
              <button className="btn btn-ghost px-3" onClick={() => onPass(w)}>PASS</button>
            </div>
          ))}
        </>
      )}
      <p className="seclabel mb-2 mt-4">Your chats</p>
      {dms.length === 0 ? (
        <p className="hint">Wave at someone at the same party or in one of your group chats. If they wave back, your private chat opens.</p>
      ) : (
        dms.map((d) => (
          <Link href={`/chat/dm/${d.id}`} key={d.id} className="card mb-2 flex items-center gap-3 py-3">
            <ChatFace look={d.other_look} alias={d.other_look ? null : d.other_name} size={38} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display text-[15px] font-semibold">{d.other_name}</b>
              {d.other_handle && <span className="block truncate font-mono text-[10px] text-dim">@{d.other_handle}</span>}
              <p className="hint truncate">{d.last_body ?? (d.event_title ? `Met at ${d.event_title}` : "Say hello")}</p>
            </span>
            <span className="flex flex-none flex-col items-end gap-1.5">
              <span className="font-mono text-[10px] text-dim">{rowTime(d.last_at)}</span>
              {d.revealed && <span className="pill">KNOWN</span>}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}

export function AccountNudge({ text }: { text: string }) {
  return (
    <Link href="/account?next=/chat" className="mb-3 flex min-h-[44px] flex-none items-center justify-between gap-3 rounded-hz border border-line bg-ink-2 px-3 py-2">
      <span className="font-body text-[13px] leading-snug">{text}</span>
      <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">SIGN UP →</span>
    </Link>
  );
}
