"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { useEvents } from "@/lib/useEvents";
import { useHoppaz } from "@/lib/store";
import type { Message } from "@/lib/types";

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center"><span className="hint">LOADING…</span></div>}>
      <Chat />
    </Suspense>
  );
}

function Chat() {
  const params = useSearchParams();
  const { userId, profile } = useSession();
  const { fix } = useHoppaz();
  const { events } = useEvents(fix, 45);

  const [channel, setChannel] = useState(params.get("c") ?? "base");
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [live, setLive] = useState(false);
  const feed = useRef<HTMLDivElement>(null);

  const channels = useMemo(() => {
    const top = events.slice(0, 6).map((e) => ({ id: e.id, label: e.title.toUpperCase() }));
    const list = [{ id: "base", label: "BASE" }, ...top];
    if (!list.some((c) => c.id === channel)) {
      const e = events.find((x) => x.id === channel);
      list.push({ id: channel, label: (e?.title ?? channel.replace(/^hop-/, "HOP ")).toUpperCase() });
    }
    return list;
  }, [events, channel]);

  const resolveNames = useCallback(async (rows: Message[]) => {
    const sb = getSupabase();
    if (!sb) return;
    const need = [...new Set(rows.map((r) => r.user_id))].filter((id) => !(id in names));
    if (!need.length) return;
    const { data } = await sb.from("profiles").select("id, display_name").in("id", need);
    if (!data) return;
    setNames((n) => {
      const out = { ...n };
      (data as { id: string; display_name: string | null }[]).forEach((p) => {
        out[p.id] = p.display_name || "A Hopper";
      });
      return out;
    });
  }, [names]);

  // history
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setMsgs([]);
      setLive(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await sb
        .from("messages")
        .select("*")
        .eq("channel", channel)
        .order("created_at", { ascending: false })
        .limit(80);
      if (cancelled || !data) return;
      const rows = (data as Message[]).slice().reverse();
      setMsgs(rows);
      void resolveNames(rows);
    })();
    return () => {
      cancelled = true;
    };
    // resolveNames intentionally excluded: it changes with the name cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  // realtime
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const ch = sb
      .channel(`room:${channel}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel=eq.${channel}` },
        (payload) => {
          const m = payload.new as Message;
          setMsgs((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m].slice(-120)));
          void resolveNames([m]);
        }
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      void sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [msgs]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    const sb = getSupabase();
    if (!sb || !userId) {
      setMsgs((m) => [
        ...m,
        {
          id: `local-${Date.now()}`,
          channel,
          user_id: "me",
          body: text,
          created_at: new Date().toISOString(),
        },
      ]);
      return;
    }
    const { error } = await sb.from("messages").insert({ channel, user_id: userId, body: text });
    if (error) console.warn("[hoppaz] message not sent:", error.message);
  };

  const label = channels.find((c) => c.id === channel)?.label ?? "BASE";

  return (
    <div className="flex h-full flex-col overflow-hidden px-4">
      <header className="pad-top flex-none pb-2">
        <h1 className="font-display text-2xl font-black leading-none">The bus chat</h1>
        <p className={clsx("seclabel mt-1.5", live ? "text-ok" : "text-dim")}>
          {live ? `LIVE · ${label}` : `${label} · NOT CONNECTED`}
        </p>
      </header>

      <div className="flex-none overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-1.5">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              aria-pressed={c.id === channel}
              className={clsx(
                "flex-none whitespace-nowrap rounded-full border px-2.5 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.08em]",
                c.id === channel
                  ? "border-orange bg-orange text-ink"
                  : "border-line text-dim"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={feed} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3">
        {msgs.length === 0 ? (
          <p className="hint">
            Quiet in here. Say where you are coming from and who is out tonight.
          </p>
        ) : (
          msgs.map((m) => {
            const mine = m.user_id === userId || m.user_id === "me";
            const who = mine ? profile?.display_name || "You" : names[m.user_id] || "A Hopper";
            return (
              <div key={m.id} className={clsx("flex items-start gap-2", mine && "flex-row-reverse")}>
                <span
                  className={clsx(
                    "grid h-8 w-8 flex-none place-items-center rounded font-display text-xs font-black",
                    mine ? "bg-orange text-ink" : "bg-cream text-ink"
                  )}
                  aria-hidden
                >
                  {who[0].toUpperCase()}
                </span>
                <span
                  className={clsx(
                    "min-w-0 max-w-[82%] rounded border px-2.5 py-2",
                    mine ? "border-[#4A2D1E] bg-[#2A1A12]" : "border-line bg-ink-2"
                  )}
                >
                  <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-orange">
                    {who}
                  </span>
                  <p className="mt-0.5 break-words font-display text-[13.5px] leading-snug">
                    {m.body}
                  </p>
                </span>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={send} className="pad-bottom flex flex-none items-end gap-2 border-t border-line pt-2.5">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Say something"
          maxLength={400}
          autoComplete="off"
          aria-label="Message"
        />
        <button type="submit" className="btn flex-none px-3.5 py-2.5 text-[11px]">
          SEND
        </button>
      </form>
    </div>
  );
}
