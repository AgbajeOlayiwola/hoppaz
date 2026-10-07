"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Hand, MessageCircle, Users } from "lucide-react";
import clsx from "clsx";
import { useSession } from "@/lib/useSession";
import { useEvents } from "@/lib/useEvents";
import { useHoppaz, useToast } from "@/lib/store";
import { useInbox, useRoom, useWhosHere, wave } from "@/lib/chat";
import ChatFace from "@/components/chat/ChatFace";
import PersonCard from "@/components/chat/PersonCard";

export default function ChatPage() {
  return <Suspense fallback={<div className="grid h-full place-items-center"><span className="hint">LOADING…</span></div>}><Chat /></Suspense>;
}

function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const { userId, profile } = useSession();
  const { fix } = useHoppaz();
  const { events } = useEvents(fix, 45);
  const [channel, setChannel] = useState(params.get("c") ?? "base");
  const [view, setView] = useState<"room" | "inbox">("room");
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [person, setPerson] = useState<{ key: string; name: string; look?: unknown; anon: boolean; messageId?: string; excerpt?: string } | null>(null);
  const say = useToast((s) => s.say);
  const { msgs, mine, alias, live, send } = useRoom(channel, userId);
  const { waves, dms, respond } = useInbox(userId);
  const event = events.find((e) => e.id === channel);
  const { people, reload } = useWhosHere(event?.id ?? null, !!event && !event.id.startsWith("demo-"));
  const rooms = useMemo(() => [{ id: "base", label: "BASE" }, ...events.slice(0, 8).map((e) => ({ id: e.id, label: e.title.toUpperCase() }))], [events]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    const error = await send(text, anon);
    if (error) say(error);
    else setBody("");
  };

  return <div className="flex h-full flex-col overflow-hidden px-4">
    <header className="pad-top flex-none pb-3">
      <h1 className="font-display text-2xl font-black leading-none">Chat</h1>
      <p className="seclabel mt-1.5">Meet at the night. Say hi on your terms.</p>
    </header>
    <div className="mb-3 grid flex-none grid-cols-2 gap-2">
      <button className={clsx("btn", view !== "room" && "btn-ghost")} onClick={() => setView("room")}><MessageCircle size={14}/> ROOMS</button>
      <button className={clsx("btn", view !== "inbox" && "btn-ghost")} onClick={() => setView("inbox")}><Hand size={14}/> WAVES & DMS{waves.length + dms.length > 0 ? ` · ${waves.length + dms.length}` : ""}</button>
    </div>

    {view === "room" ? <>
      <div className="flex-none overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><div className="flex gap-1.5">
        {rooms.map((r) => <button key={r.id} onClick={() => setChannel(r.id)} aria-pressed={channel === r.id} className={clsx("flex-none whitespace-nowrap rounded-full border px-2.5 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.08em]", channel === r.id ? "border-orange bg-orange text-ink" : "border-line text-dim")}>{r.label}</button>)}
      </div></div>
      <div className="mb-2 flex flex-none items-center justify-between">
        <span className={clsx("seclabel", live ? "text-ok" : "text-dim")}>{live ? "LIVE" : "ROOM CHAT"} · {anon ? alias ?? "ANONYMOUS" : profile?.display_name ?? "HOPPER"}</span>
        {event && <button className="btn btn-ghost px-2.5 py-1.5 text-[9px]" onClick={() => void reload()}><Users size={13}/> WHO’S HERE</button>}
      </div>
      {event && people.length > 0 && <div className="mb-2 flex flex-none gap-2 overflow-x-auto">{people.map((p) => <button key={p.key} className="tag tag-v" onClick={async () => { const r = await wave(p.key); say(r.text, r.dm ? "orange" : "violet"); if (r.dm) router.push(`/chat/dm/${r.dm}`); else void reload(); }}>{p.alias} · WAVE</button>)}</div>}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3">
        {!msgs.length ? <p className="hint">Be the first to break the ice. Keep it friendly; you can post with a room alias.</p> : msgs.map((m) => {
          const own = !!m.author_key && mine.has(m.author_key);
          const who = own ? (m.anon ? alias ?? m.author_name ?? "You" : "You") : m.author_name ?? "A Hopper";
          return <button key={m.id} onClick={() => !own && m.author_key && setPerson({ key: m.author_key, name: who, look: m.author_look, anon: m.anon, messageId: m.id, excerpt: m.body })} className={clsx("flex items-start gap-2 text-left", own && "flex-row-reverse")}>
            <ChatFace look={m.author_look} alias={m.anon ? who : null} size={32}/>
            <span className={clsx("min-w-0 max-w-[82%] rounded border px-2.5 py-2", own ? "border-[#4A2D1E] bg-[#2A1A12]" : "border-line bg-ink-2")}><span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-orange">{who}{m.anon ? " · ANON" : ""}</span><p className="mt-0.5 break-words font-display text-[13.5px] leading-snug">{m.body}</p></span>
          </button>;
        })}
      </div>
      <form onSubmit={submit} className="pad-bottom flex flex-none flex-col gap-2 border-t border-line pt-2.5">
        <label className="flex items-center gap-2 font-mono text-[10px] text-dim"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="h-4 w-4 accent-orange"/> POST AS {anon ? alias ?? "ANONYMOUS ALIAS" : "MY NAME"}</label>
        <div className="flex items-end gap-2"><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Say something" maxLength={400} autoComplete="off" aria-label="Message"/><button type="submit" className="btn flex-none px-3.5 py-2.5 text-[11px]">SEND</button></div>
      </form>
    </> : <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {waves.length > 0 && <><p className="seclabel mb-2">They waved at you</p>{waves.map((w) => <div key={w.id} className="card mb-2 flex items-center gap-3 py-3"><ChatFace alias={w.from_alias} size={38}/><div className="min-w-0 flex-1"><b className="font-display">{w.from_alias}</b><p className="hint">{w.event_title ? `Met at ${w.event_title}` : "Someone you met out"}</p></div><button className="btn px-3 py-2" onClick={async () => { const id = await respond(w.id, true); if (id) router.push(`/chat/dm/${id}`); }}>CHAT</button><button className="btn btn-ghost px-3 py-2" onClick={() => void respond(w.id, false)}>PASS</button></div>)}</>}
      <p className="seclabel mb-2 mt-4">Your chats</p>
      {dms.length === 0 ? <p className="hint">Wave at someone you met at an event or on a Hoppaz ride. If they wave back, your private chat opens.</p> : dms.map((d) => <Link href={`/chat/dm/${d.id}`} key={d.id} className="card mb-2 flex items-center gap-3 py-3"><ChatFace look={d.other_look} alias={d.revealed ? null : d.other_name} size={38}/><span className="min-w-0 flex-1"><b className="font-display">{d.other_name}</b><p className="hint truncate">{d.last_body ?? (d.event_title ? `Met at ${d.event_title}` : "Say hello")}</p></span><span className="tag">{d.revealed ? "KNOWN" : "ANON"}</span></Link>)}
    </div>}
    {person && <PersonCard person={person} onClose={() => setPerson(null)}/>}
  </div>;
}
