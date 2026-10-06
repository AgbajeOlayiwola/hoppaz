"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import type { DmMessage, DmThread, Message, Wave } from "./types";

/**
 * Chat, the client half. Everything that touches who-is-who (waves, DMs,
 * blocks, reports, "who's here") goes through the RPCs in schema.sql; the
 * browser only ever holds opaque keys and aliases. See the chat section there.
 */

const MSG_COLS = "id, channel, body, created_at, author_key, author_name, author_look, anon";

/** Turn a database error into a line for the toast. */
export function chatError(message: string | undefined) {
  if (!message) return "DID NOT SEND";
  if (message.includes("slow_down")) return "EASY. TOO MANY MESSAGES, WAIT A FEW SECONDS";
  if (message.includes("no_session")) return "NOT SIGNED IN YET";
  if (message.includes("not_in_dm")) return "THIS CHAT IS CLOSED";
  return "DID NOT SEND";
}

/* ----------------------------------------------------------------- rooms -- */

export function useRoom(channel: string, userId: string | null) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [alias, setAlias] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const loadKeys = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const [{ data: keys }, { data: a }] = await Promise.all([
      sb.rpc("my_room_keys", { p_channel: channel }),
      sb.rpc("my_alias", { p_channel: channel }),
    ]);
    setMine(new Set(((keys ?? []) as { key: string }[]).map((k) => k.key)));
    setAlias((a as string | null) ?? null);
  }, [channel, userId]);

  useEffect(() => {
    const sb = getSupabase();
    setMsgs([]);
    if (!sb) return;
    let cancelled = false;
    (async () => {
      const { data } = await sb
        .from("messages")
        .select(MSG_COLS)
        .eq("channel", channel)
        .order("created_at", { ascending: false })
        .limit(80);
      if (!cancelled && data) setMsgs((data as Message[]).slice().reverse());
    })();
    void loadKeys();

    const ch = sb
      .channel(`room:${channel}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel=eq.${channel}` }, (p) => {
        const m = p.new as Message;
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-120)));
      })
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    return () => {
      cancelled = true;
      void sb.removeChannel(ch);
    };
  }, [channel, loadKeys]);

  /** Returns an error line, or null when sent. */
  const send = useCallback(
    async (body: string, anon: boolean): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb || !userId) {
        // Demo: show it locally so the room still feels alive, and say so.
        setMsgs((m) => [
          ...m,
          { id: `local-${Date.now()}`, channel, body, created_at: new Date().toISOString(), author_key: "me", author_name: anon ? "You (anon)" : "You", author_look: null, anon },
        ]);
        setMine((s) => new Set(s).add("me"));
        return null;
      }
      const { data, error } = await sb.from("messages").insert({ channel, body, anon }).select(MSG_COLS).single();
      if (error) return chatError(error.message);
      const m = data as Message;
      if (m.author_key) setMine((s) => new Set(s).add(m.author_key!));
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      return null;
    },
    [channel, userId]
  );

  return { msgs, mine, alias, live, send };
}

/* ------------------------------------------------------- people actions -- */

const WAVE_TEXT: Record<string, string> = {
  sent: "WAVE SENT. IF THEY WAVE BACK, YOU CAN CHAT",
  already: "ALREADY WAVED",
  not_met: "YOU CAN ONLY WAVE AT PEOPLE YOU'VE BEEN OUT WITH",
  blocked: "YOU BLOCKED THEM",
  slow_down: "THAT'S A LOT OF WAVES TODAY. TRY TOMORROW",
  self: "THAT'S YOU",
  gone: "THEY'RE NOT AROUND ANY MORE",
  no_session: "NOT SIGNED IN YET",
};

/** Wave at the person behind a room key. matched means they had already waved: the DM is open. */
export async function wave(key: string): Promise<{ text: string; dm?: string }> {
  const sb = getSupabase();
  if (!sb) return { text: "NOT CONNECTED" };
  const { data, error } = await sb.rpc("send_wave", { p_key: key });
  if (error) return { text: "COULD NOT WAVE" };
  const r = String(data);
  if (r.startsWith("matched:")) return { text: "YOU BOTH WAVED. SAY HI", dm: r.slice(8) };
  return { text: WAVE_TEXT[r] ?? "COULD NOT WAVE" };
}

export async function blockPerson(target: { key?: string; dm?: string }, label: string) {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.rpc("block_person", { p_key: target.key ?? null, p_dm: target.dm ?? null, p_label: label });
  return !!data;
}

export async function reportThing(kind: "room" | "dm" | "person", ref: string, reason: string) {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.rpc("report", { p_kind: kind, p_ref: ref, p_reason: reason });
  return !!data;
}

export function useWhosHere(eventId: string | null, enabled: boolean) {
  const [people, setPeople] = useState<{ key: string; alias: string; waved: boolean }[]>([]);
  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !eventId || !enabled || eventId.startsWith("demo-")) return setPeople([]);
    const { data } = await sb.rpc("whos_here", { p_event: eventId });
    setPeople((data ?? []) as { key: string; alias: string; waved: boolean }[]);
  }, [eventId, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { people, reload: load };
}

/* ----------------------------------------------------- waves and DMs ----- */

export function useInbox(userId: string | null) {
  const [waves, setWaves] = useState<Wave[]>([]);
  const [dms, setDms] = useState<DmThread[]>([]);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const [w, d] = await Promise.all([sb.rpc("my_waves"), sb.rpc("my_dms")]);
    setWaves((w.data ?? []) as Wave[]);
    setDms((d.data ?? []) as DmThread[]);
  }, [userId]);

  useEffect(() => {
    void load();
    const sb = getSupabase();
    if (!sb || !userId) return;
    // RLS only delivers DM messages from your own threads; refresh the list on any.
    const ch = sb
      .channel(`inbox:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, () => void load())
      .subscribe();
    const t = setInterval(load, 30_000); // waves have no realtime feed: poll
    return () => {
      clearInterval(t);
      void sb.removeChannel(ch);
    };
  }, [load, userId]);

  const respond = useCallback(
    async (id: string, accept: boolean): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data } = await sb.rpc("respond_wave", { p_wave: id, p_accept: accept });
      await load();
      return (data as string | null) ?? null;
    },
    [load]
  );

  return { waves, dms, respond, reload: load };
}

export function useDm(dmId: string, userId: string | null) {
  const [msgs, setMsgs] = useState<DmMessage[]>([]);
  const [thread, setThread] = useState<DmThread | null>(null);
  const [missing, setMissing] = useState(false);

  const loadThread = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const { data } = await sb.rpc("my_dms");
    const t = ((data ?? []) as DmThread[]).find((x) => x.id === dmId) ?? null;
    setThread(t);
    setMissing(!t);
  }, [dmId, userId]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    void loadThread();
    (async () => {
      const { data } = await sb.from("dm_messages").select("*").eq("dm_id", dmId).order("created_at", { ascending: true }).limit(200);
      if (!cancelled) setMsgs((data ?? []) as DmMessage[]);
    })();
    const ch = sb
      .channel(`dm:${dmId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `dm_id=eq.${dmId}` }, (p) => {
        const m = p.new as DmMessage;
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      })
      .subscribe();
    // Reveal state can change on the other side.
    const t = setInterval(loadThread, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      void sb.removeChannel(ch);
    };
  }, [dmId, userId, loadThread]);

  const send = useCallback(
    async (body: string): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb || !thread) return "NOT CONNECTED";
      const { data, error } = await sb.rpc("send_dm", { p_dm: dmId, p_body: body });
      if (error) return chatError(error.message);
      const id = String(data);
      setMsgs((prev) =>
        prev.some((x) => x.id === id) ? prev : [...prev, { id, dm_id: dmId, from_a: thread.i_am_a, body, created_at: new Date().toISOString() }]
      );
      return null;
    },
    [dmId, thread]
  );

  const reveal = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.rpc("reveal_dm", { p_dm: dmId });
    await loadThread();
  }, [dmId, loadThread]);

  return { msgs, thread, missing, send, reveal };
}
