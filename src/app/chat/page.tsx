"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Hand, MessageCircle } from "lucide-react";
import clsx from "clsx";
import { useSession } from "@/lib/useSession";
import { useEvents } from "@/lib/useEvents";
import { useHoppaz, useToast } from "@/lib/store";
import { useInbox, useMyEventRooms, type PeopleOf } from "@/lib/chat";
import ChatFace from "@/components/chat/ChatFace";
import RoomView from "@/components/chat/RoomView";

export default function ChatPage() {
  return <Suspense fallback={<div className="grid h-full place-items-center"><span className="hint">LOADING…</span></div>}><Chat /></Suspense>;
}

type Room = { id: string; label: string; kind: "event" | "hop"; closesAt?: number; member: boolean };

/**
 * Rooms are temporary and automatic: each event you're checked in at has one,
 * gone for good three days after the event. Opening chat from an event card or
 * the Hop shows that room too. The permanent group chats (from saying you're
 * going) live in Crew.
 */
function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const { userId, hasAccount } = useSession();
  const { fix } = useHoppaz();
  const { events } = useEvents(fix, 45);
  const eventRooms = useMyEventRooms(userId);
  const [view, setView] = useState<"room" | "inbox">("room");
  const [picked, setPicked] = useState<string | null>(null);
  const say = useToast((s) => s.say);
  const { waves, dms, respond } = useInbox(userId);

  const linked = params.get("c");
  const rooms = useMemo(() => {
    const list: Room[] = eventRooms.map((r) => ({ id: r.id, label: r.title.toUpperCase(), kind: "event", closesAt: r.closesAt, member: true }));
    if (linked && !list.some((r) => r.id === linked) && !linked.startsWith("area:")) {
      if (linked.startsWith("hop-")) list.push({ id: linked, label: "THE HOP", kind: "hop", member: false });
      else {
        const title = events.find((e) => e.id === linked)?.title;
        list.push({ id: linked, label: title ? title.toUpperCase() : "EVENT ROOM", kind: "event", member: false });
      }
    }
    return list;
  }, [eventRooms, linked, events]);
  const room = rooms.find((r) => r.id === (picked ?? linked)) ?? rooms[0] ?? null;

  return <div className="flex h-full flex-col overflow-hidden px-4">
    <header className="pad-top flex-none pb-3">
      <h1 className="font-display text-2xl font-black leading-none">Chat</h1>
      <p className="seclabel mt-1.5">The people at your party tonight. Say hi on your terms.</p>
    </header>
    <div className="mb-3 grid flex-none grid-cols-2 gap-2">
      <button className={clsx("btn", view !== "room" && "btn-ghost")} onClick={() => setView("room")}><MessageCircle size={14}/> ROOMS</button>
      <button className={clsx("btn", view !== "inbox" && "btn-ghost")} onClick={() => setView("inbox")}><Hand size={14}/> WAVES & DMS{waves.length + dms.length > 0 ? ` · ${waves.length + dms.length}` : ""}</button>
    </div>

    {view === "room" ? <>
      {rooms.length > 1 && <div className="flex-none overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><div className="flex gap-1.5">
        {rooms.map((r) => <button key={r.id} onClick={() => setPicked(r.id)} aria-pressed={room?.id === r.id} className={clsx("flex-none whitespace-nowrap rounded-full border px-2.5 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.08em]", room?.id === r.id ? "border-orange bg-orange text-ink" : "border-line text-dim")}>{r.label}</button>)}
      </div></div>}
      {rooms.length === 1 && room && <p className="mb-2 flex-none truncate font-display text-sm font-black">{room.kind === "hop" ? "The Hop" : events.find((e) => e.id === room.id)?.title ?? eventRooms.find((r) => r.id === room.id)?.title ?? "Event room"}</p>}
      {room ? <RoomView
        key={room.id}
        channel={room.id}
        people={{ kind: "event", eventId: room.id } satisfies PeopleOf}
        userId={userId}
        hasAccount={hasAccount}
        note={room.closesAt ? `CLOSES ${closes(room.closesAt)}` : undefined}
        empty={!room.member
          ? room.kind === "hop" ? "This is the Hop's room, for riders on the bus." : "This room is for people at the event. Check in when you get there and you're in."
          : "You're in. Be the first to break the ice, and keep it friendly."}
        noPeople={room.kind === "event" && room.member ? "Nobody else checked in yet." : undefined}
      /> : (
        <div className="card">
          <p className="font-display text-sm font-black">No party room open</p>
          <p className="hint mt-1">Check in at an event when you get there and you&apos;re in its room with everyone else who&apos;s there. It closes three days after the event.</p>
          <p className="hint mt-2">Going to something later? Tap I&apos;M GOING on it and its group chat invite lands in Crew.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/" className="btn">FIND A PARTY</Link>
            <Link href="/crew" className="btn btn-ghost">GROUP CHATS</Link>
          </div>
        </div>
      )}
    </> : <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {!hasAccount && <AccountNudge text="Make an account to answer waves and chat privately." />}
      {waves.length > 0 && <><p className="seclabel mb-2">They waved at you</p>{waves.map((w) => <div key={w.id} className="card mb-2 flex items-center gap-3 py-3"><ChatFace look={w.from_look} alias={w.from_look ? null : w.from_alias} size={38}/><div className="min-w-0 flex-1"><b className="block truncate font-display">@{w.from_alias}</b><p className="hint">{w.event_title ? `Met at ${w.event_title}` : "Someone you met out"}</p></div><button className="btn px-3 py-2" onClick={async () => { const r = await respond(w.id, true); if (r.needAccount) { say("MAKE AN ACCOUNT TO CHAT"); router.push("/account?next=/chat"); } else if (r.dm) router.push(`/chat/dm/${r.dm}`); }}>CHAT</button><button className="btn btn-ghost px-3 py-2" onClick={() => void respond(w.id, false)}>PASS</button></div>)}</>}
      <p className="seclabel mb-2 mt-4">Your chats</p>
      {dms.length === 0 ? <p className="hint">Wave at someone at the same party or in one of your group chats. If they wave back, your private chat opens.</p> : dms.map((d) => <Link href={`/chat/dm/${d.id}`} key={d.id} className="card mb-2 flex items-center gap-3 py-3"><ChatFace look={d.other_look} alias={d.other_look ? null : d.other_name} size={38}/><span className="min-w-0 flex-1"><b className="block truncate font-display">{d.other_name}</b>{d.other_handle && <span className="block truncate font-mono text-[9px] font-bold text-orange">@{d.other_handle}</span>}<p className="hint truncate">{d.last_body ?? (d.event_title ? `Met at ${d.event_title}` : "Say hello")}</p></span>{d.revealed && <span className="tag">KNOWN</span>}</Link>)}
    </div>}
  </div>;
}

function AccountNudge({ text }: { text: string }) {
  return <Link href="/account?next=/chat" className="mb-3 flex flex-none items-center justify-between gap-3 rounded border border-orange/60 bg-ink-2 px-3 py-2">
    <span className="text-[12px] leading-snug">{text}</span>
    <span className="flex-none font-mono text-[9px] font-bold tracking-widest text-orange">SIGN UP →</span>
  </Link>;
}

/** "SAT 2 AM": when an event room closes for good. */
function closes(at: number) {
  return new Date(at).toLocaleString("en-NG", { weekday: "short", hour: "numeric", timeZone: "Africa/Lagos" }).toUpperCase();
}
