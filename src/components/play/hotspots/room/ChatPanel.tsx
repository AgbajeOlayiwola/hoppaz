"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import Composer from "@/components/chat/Composer";
import { RoomMessage } from "@/components/chat/RoomView";
import { useLinger } from "@/components/chat/useLinger";
import { getSupabase } from "@/lib/supabase/client";
import type { Message } from "@/lib/types";
import type { Rules, Slow } from "./api";
import { RULES_LINE, SLOW_GAP, postProblem } from "./copy";
import type { HeadPerson } from "./HeadCard";

/**
 * The room's chat, on Ola's pieces: RoomMessage (face and bubble), Composer (without the picture button, a
 * hotspot is text only) and the same Realtime feed. What is new is the plain state line above the box: the
 * rules, then slow mode, then a countdown or the reason a post was refused. The server decides every refusal;
 * the countdown only stops a second tap from making one.
 */
export default function ChatPanel({
  msgs,
  live,
  send,
  youKey,
  slow,
  rules,
  onPick,
  onRejoin,
  typing = false,
}: {
  msgs: Message[];
  live: boolean;
  send: (body: string) => Promise<string | null>;
  youKey: string;
  slow: Slow;
  rules: Rules;
  onPick: (p: HeadPerson) => void;
  /** The server said the avatar is not in the room: come back in. */
  onRejoin: () => void;
  /** The phone's keyboard is up: every spare line goes to the messages, so the pinned rules step aside. */
  typing?: boolean;
}) {
  const reconnecting = useLinger(!live && !!getSupabase(), 3000);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [behind, setBehind] = useState(false);
  // The refusal to keep showing until the next try, and the moment the box opens again.
  const [problem, setProblem] = useState<string | null>(null);
  const [until, setUntil] = useState({ at: 0, text: "" });
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [msgs.length]);

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((until.at - Date.now()) / 1000)));
    tick();
    if (until.at <= Date.now()) return;
    const t = setInterval(() => {
      tick();
      if (Date.now() >= until.at) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [until]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setBehind(false);
  };
  const toBottom = () => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const onSend = async (body: string): Promise<string | null> => {
    if (until.at > Date.now()) return "wait";
    stick.current = true;
    const err = await send(body);
    if (!err) {
      setProblem(null);
      // Slow mode paces everyone, so the box rests for its gap after a post that went through.
      if (slow.on_now && slow.seconds > 0) setUntil({ at: Date.now() + slow.seconds * 1000, text: SLOW_GAP });
      return null;
    }
    const p = postProblem(err, slow);
    setProblem(p.text || null);
    if (p.wait && p.counting) setUntil({ at: Date.now() + p.wait * 1000, text: p.counting });
    if (err.includes("not_in_hotspot")) onRejoin();
    return err;
  };

  // One state line: a countdown beats a refusal, a refusal beats the standing slow mode notice.
  const line =
    left > 0
      ? `${until.text} ${left}s.`
      : problem ?? (slow.on_now ? `Slow mode until ${slow.to}. One message every ${slow.seconds} seconds.` : null);
  const warn = !!problem;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-3">
      <div className="mb-2 flex flex-none items-center justify-between gap-2">
        <span className="seclabel">CHAT{reconnecting && " · RECONNECTING..."}</span>
        <span className="truncate font-mono text-[10px] text-dim">KEPT {rules.keep_days} DAYS</span>
      </div>
      {!typing && (
        <p className="mb-2 flex-none rounded-hz border border-line bg-ink-2 px-3 py-2 font-body text-[13px] leading-snug text-cream/80">{RULES_LINE}</p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={list} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3" aria-label="Hotspot chat">
          {!msgs.length ? (
            <p className="hint">Nobody has said anything yet. Say hi to the room.</p>
          ) : (
            msgs.map((m) => (
              <RoomMessage
                key={m.id}
                m={m}
                own={!!m.author_key && m.author_key === youKey}
                onPick={(p) => onPick({ key: p.key, alias: p.name, look: p.look, messageId: p.messageId, excerpt: p.excerpt })}
              />
            ))
          )}
        </div>
        {behind && (
          <button
            type="button"
            onClick={toBottom}
            className="absolute bottom-3 left-1/2 flex min-h-[36px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-ink-2 px-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-cream shadow-sheet"
          >
            <ArrowDown size={12} aria-hidden /> New messages
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="flex flex-none items-start gap-2 pb-2 empty:hidden">
        {line && (
          <>
            <i aria-hidden className={`mt-[5px] h-2 w-2 flex-none rounded-full ${warn ? "bg-fireant" : "bg-danfo"}`} />
            <span className="font-body text-[13px] leading-snug text-cream">{line}</span>
          </>
        )}
      </p>
      <Composer
        safeArea
        images={false}
        placeholder="Say something"
        maxLength={rules.max_len}
        onSend={(body) => onSend(body)}
      />
    </div>
  );
}
