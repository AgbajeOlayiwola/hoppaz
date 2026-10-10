"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Message } from "@/lib/types";
import { POLL_MS } from "./api";
import { demoMessages } from "./demo";

/**
 * The messages of one hotspot room. The same table, the same Realtime channel as Ola's rooms
 * (`room:hotspot:<id>`, an INSERT filter on the channel), but not his useRoom: that one also asks for
 * my_alias, which would make an anonymous alias a hotspot never uses. Here "mine" is the room key
 * enter_hotspot gave back, and the post is just {channel, body}: the server sets the alias and look,
 * and nothing is ever anonymous or a picture.
 *
 * Reads only work while the avatar is in the room (the read policy), so this starts after entering.
 *
 * The Realtime feed only brings new messages. Staff can delete the last N minutes of a room that is open (and the 24 hour
 * window moves on its own), and a feed of INSERTs never hears that, so the list is read again every POLL_MS and
 * REPLACES what is on screen: whatever the server no longer returns goes.
 */

const COLS = "id, channel, body, created_at, author_key, author_name, author_look, author_handle, anon";
const KEEP = 120;

export function useHotspotChat(channel: string | null, youKey: string | null) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [live, setLive] = useState(false);
  // People I blocked this visit: their earlier messages go from the list at once (the server stops the new ones).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // When each message reached this phone (this phone's clock), so a read that was already on its way does not drop it.
  const arrived = useRef(new Map<string, number>());

  useEffect(() => {
    const sb = getSupabase();
    setMsgs([]);
    setLive(false);
    if (!channel) return;
    if (!sb) return void setMsgs(demoMessages(channel));
    let dead = false;

    const byTime = (a: Message, b: Message) => Date.parse(a.created_at) - Date.parse(b.created_at);

    const merge = (rows: Message[]) =>
      setMsgs((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const add = rows.filter((m) => !ids.has(m.id));
        if (!add.length) return prev;
        for (const m of add) arrived.current.set(m.id, Date.now());
        return [...prev, ...add].sort(byTime).slice(-KEEP);
      });

    // Read the visible window and make it the list.
    const resync = async () => {
      const t0 = Date.now();
      const { data } = await sb.from("messages").select(COLS).eq("channel", channel).order("created_at", { ascending: false }).limit(KEEP);
      if (dead || !data) return;
      const rows = data as Message[];
      setMsgs((prev) => {
        const ids = new Set(rows.map((m) => m.id));
        const late = prev.filter((m) => !ids.has(m.id) && (arrived.current.get(m.id) ?? 0) >= t0 - 1000);
        const next = [...rows, ...late].sort(byTime).slice(-KEEP);
        return next.length === prev.length && next.every((m, i) => m.id === prev[i].id) ? prev : next;
      });
    };

    const ch = sb
      .channel(`room:${channel}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel=eq.${channel}` }, (p) => {
        merge([p.new as Message]);
      })
      .subscribe((s) => {
        setLive(s === "SUBSCRIBED");
        // The first time, and back after a gap: fetch what was said meanwhile.
        if (s === "SUBSCRIBED") void resync();
      });
    const showing = () => document.visibilityState === "visible";
    const timer = setInterval(() => showing() && void resync(), POLL_MS);
    const onShow = () => showing() && void resync();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      void sb.removeChannel(ch);
    };
  }, [channel]);

  /** Returns the database's error message when the post is refused (the code, e.g. "no_links"), or null when it went. */
  const send = useCallback(
    async (body: string): Promise<string | null> => {
      if (!channel) return "room_closed";
      const sb = getSupabase();
      if (!sb) {
        setMsgs((m) => [
          ...m,
          { id: `local-${Date.now()}`, channel, body, created_at: new Date().toISOString(), author_key: youKey, author_name: "You", author_look: null, anon: false },
        ]);
        return null;
      }
      const { data, error } = await sb.from("messages").insert({ channel, body }).select(COLS).single();
      if (error) return error.message || "error";
      const m = data as Message;
      arrived.current.set(m.id, Date.now());
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      return null;
    },
    [channel, youKey]
  );

  const hide = useCallback((key: string) => setHidden((s) => new Set(s).add(key)), []);

  return { msgs: msgs.filter((m) => !m.author_key || !hidden.has(m.author_key)), live, send, hide };
}
