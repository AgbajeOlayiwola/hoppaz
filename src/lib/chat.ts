"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "./supabase/client";
import { shrink } from "./image";
import type { DmMessage, DmThread, Message, Person, Wave } from "./types";

/**
 * Chat, the client half. Everything that touches who-is-who (waves, DMs,
 * blocks, reports, "who's here") goes through the RPCs in schema.sql; the
 * browser only ever holds opaque keys and aliases. See the chat section there.
 */

const MSG_COLS = "id, channel, body, created_at, author_key, author_name, author_look, author_handle, anon, image_path";
const IMAGES = "chat-images";

/** Shrink and upload a chat picture under the given folder. Returns its path, or null. */
async function uploadImage(folder: string, file: File): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const blob = await shrink(file);
    const path = `${folder}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from(IMAGES).upload(path, blob, { contentType: "image/jpeg" });
    return error ? null : path;
  } catch {
    return null;
  }
}

/** Signed URLs for chat pictures (the bucket is private), fetched once per path. */
export function useChatImages(paths: (string | null | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const key = useMemo(() => [...new Set(paths.filter((p): p is string => !!p))].sort().join("|"), [paths]);
  useEffect(() => {
    const sb = getSupabase();
    const missing = (key ? key.split("|") : []).filter((p) => !asked.current.has(p));
    if (!sb || !missing.length) return;
    missing.forEach((p) => asked.current.add(p));
    void sb.storage.from(IMAGES).createSignedUrls(missing, 60 * 60).then(({ data }) => {
      if (!data) return;
      const signed = data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as const] : []));
      setUrls((now) => ({ ...now, ...Object.fromEntries(signed) }));
    });
  }, [key]);
  return urls;
}

/** Turn a database error into a line for the toast. */
export function chatError(message: string | undefined) {
  if (!message) return "DID NOT SEND";
  if (message.includes("slow_down")) return "EASY. TOO MANY MESSAGES, WAIT A FEW SECONDS";
  if (message.includes("no_session")) return "NOT SIGNED IN YET";
  if (message.includes("not_in_dm")) return "THIS CHAT IS CLOSED";
  if (message.includes("need_account")) return "MAKE AN ACCOUNT TO CHAT PRIVATELY";
  if (message.includes("bad_image")) return "THAT PICTURE DID NOT SEND";
  if (message.includes("not_at_event")) return "CHECK IN AT THE EVENT TO JOIN ITS ROOM";
  if (message.includes("not_in_group")) return "JOIN THE GROUP CHAT FIRST";
  if (message.includes("not_in_move")) return "SAY I'M IN TO JOIN THIS CHAT";
  if (message.includes("room_closed")) return "THIS ROOM HAS CLOSED";
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
    async (body: string, anon: boolean, image?: File | null): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb || !userId) {
        if (image) return "PICTURES NEED A CONNECTION";
        // Demo: show it locally so the room still feels alive, and say so.
        setMsgs((m) => [
          ...m,
          { id: `local-${Date.now()}`, channel, body, created_at: new Date().toISOString(), author_key: "me", author_name: anon ? "You (anon)" : "You", author_look: null, anon },
        ]);
        setMine((s) => new Set(s).add("me"));
        return null;
      }
      let image_path: string | null = null;
      if (image) {
        image_path = await uploadImage(`room/${userId}`, image);
        if (!image_path) return "THAT PICTURE DID NOT UPLOAD";
      }
      const { data, error } = await sb.from("messages").insert({ channel, body, anon, image_path }).select(MSG_COLS).single();
      if (error) {
        if (image_path) void sb.storage.from(IMAGES).remove([image_path]);
        return chatError(error.message);
      }
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
  not_met: "YOU CAN WAVE AT PEOPLE AT THE SAME PARTY OR IN YOUR GROUP CHATS",
  blocked: "YOU BLOCKED THEM",
  slow_down: "THAT'S A LOT OF WAVES TODAY. TRY TOMORROW",
  self: "THAT'S YOU",
  gone: "THEY'RE NOT AROUND ANY MORE",
  no_session: "NOT SIGNED IN YET",
  need_account: "MAKE AN ACCOUNT TO WAVE",
};

const CREW_TEXT: Record<string, string> = {
  added: "ADDED TO YOUR CREW",
  already: "ALREADY IN YOUR CREW",
  self: "THAT'S YOU",
  gone: "THEY'RE NOT AROUND ANY MORE",
  blocked: "YOU BLOCKED THEM",
  no_session: "NOT SIGNED IN YET",
  need_account: "MAKE AN ACCOUNT TO ADD PEOPLE",
};

/** Add the person behind a room key to your crew: they show on your map. */
export async function addToCrew(key: string): Promise<{ ok: boolean; text: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, text: "NOT CONNECTED" };
  const { data, error } = await sb.rpc("add_to_crew", { p_key: key });
  if (error) return { ok: false, text: "COULD NOT ADD" };
  const r = String(data);
  return { ok: r === "added" || r === "already", text: CREW_TEXT[r] ?? "COULD NOT ADD" };
}


export type EventRoom = { id: string; title: string; closesAt: number };

const HOUR = 3.6e6;
/** When an event's room closes for good: three days after it ends (as the server decides). */
export const roomClosesAt = (e: { starts_at: string; ends_at?: string | null }) =>
  Date.parse(e.ends_at ?? new Date(Date.parse(e.starts_at) + 8 * HOUR).toISOString()) + 72 * HOUR;

/**
 * The event rooms this Hopper is in: every event they checked in at, until its
 * room closes. Nobody adds you; checking in is the way in. (Saying you're going
 * is what gets you the group chat invite instead.)
 */
export function useMyEventRooms(userId: string | null) {
  const [rooms, setRooms] = useState<EventRoom[]>([]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    const since = new Date(Date.now() - 6 * 24 * HOUR).toISOString();
    type Row = { event_id: string; events: { title: string; starts_at: string; ends_at: string | null } | null };
    void sb
      .from("checkins")
      .select("event_id, events(title, starts_at, ends_at)")
      .eq("user_id", userId)
      .gt("created_at", since)
      .then(({ data }) => {
        if (cancelled) return;
        const now = Date.now();
        setRooms(
          ((data ?? []) as unknown as Row[])
            .flatMap((r) => (r.events ? [{ id: r.event_id, title: r.events.title, closesAt: roomClosesAt(r.events) }] : []))
            .filter((r) => now < r.closesAt)
            .sort((x, y) => x.closesAt - y.closesAt)
        );
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return rooms;
}

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

/** Whose people a chat shows: an event room, an event's group chat, or a crew move's chat. */
export type PeopleOf = { kind: "event" | "group" | "move"; id: string };

/** Who you can see in a room: everyone checked in at the event, in the group chat, or in on the move. */
export function usePeople(room: PeopleOf | null, userId: string | null) {
  const [people, setPeople] = useState<Person[]>([]);
  const ref = room?.id ?? null;
  const kind = room?.kind ?? null;
  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId || !ref || ref.startsWith("demo-")) return setPeople([]);
    const { data } =
      kind === "move"
        ? await sb.rpc("move_members", { p_move: ref })
        : await sb.rpc(kind === "group" ? "group_members" : "whos_here", { p_event: ref });
    setPeople((data ?? []) as Person[]);
  }, [kind, ref, userId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
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
    async (id: string, accept: boolean): Promise<{ dm: string | null; needAccount?: boolean }> => {
      const sb = getSupabase();
      if (!sb) return { dm: null };
      const { data, error } = await sb.rpc("respond_wave", { p_wave: id, p_accept: accept });
      if (error?.message.includes("need_account")) return { dm: null, needAccount: true };
      await load();
      return { dm: (data as string | null) ?? null };
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
    async (body: string, image?: File | null): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb || !thread || !userId) return "NOT CONNECTED";
      let image_path: string | null = null;
      if (image) {
        image_path = await uploadImage(`dm/${dmId}/${userId}`, image);
        if (!image_path) return "THAT PICTURE DID NOT UPLOAD";
      }
      const { data, error } = await sb.rpc("send_dm", { p_dm: dmId, p_body: body, p_image: image_path });
      if (error) {
        if (image_path) void sb.storage.from(IMAGES).remove([image_path]);
        return chatError(error.message);
      }
      const id = String(data);
      setMsgs((prev) =>
        prev.some((x) => x.id === id) ? prev : [...prev, { id, dm_id: dmId, from_a: thread.i_am_a, body, image_path, created_at: new Date().toISOString() }]
      );
      return null;
    },
    [dmId, thread, userId]
  );

  const reveal = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.rpc("reveal_dm", { p_dm: dmId });
    await loadThread();
  }, [dmId, loadThread]);

  return { msgs, thread, missing, send, reveal };
}

/* -------------------------------------------------- event group chats ---- */

export type EventGroup = {
  event_id: string;
  title: string;
  starts_at: string;
  status: "invited" | "joined";
  members: number;
  last_body: string | null;
  last_at: string;
};

export const groupChannel = (eventId: string) => `group:${eventId}`;
export const moveChannel = (moveId: string) => `move:${moveId}`;

/** Group chat invites (from saying you're going) and the group chats you're in. */
export function useEventGroups(userId: string | null) {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const { data } = await sb.rpc("my_groups");
    setGroups((data ?? []) as EventGroup[]);
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  const join = useCallback(async (eventId: string) => {
    const sb = getSupabase();
    const { data } = (await sb?.rpc("join_group", { p_event: eventId })) ?? { data: false };
    await load();
    return !!data;
  }, [load]);
  const leave = useCallback(async (eventId: string) => {
    const sb = getSupabase();
    await sb?.rpc("leave_group", { p_event: eventId });
    await load();
  }, [load]);
  return { groups, join, leave, reload: load };
}

/** "I'm going": the same as swiping in. It invites you to the event's group chat; the room itself opens when you check in. */
export function useGoing(eventId: string, userId: string | null) {
  const [going, setGoing] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    setGoing(false);
    if (!sb || !userId || eventId.startsWith("demo-")) return;
    let cancelled = false;
    void sb.from("swipes").select("decision").eq("user_id", userId).eq("event_id", eventId).maybeSingle().then(({ data }) => {
      if (!cancelled) setGoing((data as { decision: string } | null)?.decision === "in");
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, userId]);
  const set = useCallback(async (on: boolean) => {
    const sb = getSupabase();
    if (!sb || !userId) return false;
    // Swipes can be inserted and deleted but not updated, so an earlier "pass" is cleared first.
    const cleared = await sb.from("swipes").delete().eq("user_id", userId).eq("event_id", eventId);
    const { error } = on ? await sb.from("swipes").insert({ user_id: userId, event_id: eventId, decision: "in" }) : cleared;
    if (!error) setGoing(on);
    return !error;
  }, [eventId, userId]);
  return { going, set };
}
