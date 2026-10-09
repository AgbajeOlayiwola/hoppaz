"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { useSession } from "@/lib/useSession";
import { useEvents } from "@/lib/useEvents";
import { useHoppaz, useToast } from "@/lib/store";
import { useInbox, useMyEventRooms, type PeopleOf } from "@/lib/chat";
import PageHeader from "@/components/app/PageHeader";
import Inbox from "@/components/chat/Inbox";
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
  const inboxCount = waves.length + dms.length;

  return <div className="flex h-full flex-col overflow-hidden px-4">
    <PageHeader title="Chat" caption="Say hi on your terms" className="flex-none" />
    <div role="tablist" aria-label="Chat" className="mb-3 flex flex-none gap-6 border-b border-line">
      <Tab on={view === "room"} onClick={() => setView("room")}>ROOMS</Tab>
      <Tab on={view === "inbox"} onClick={() => setView("inbox")}>WAVES &amp; DMS{inboxCount > 0 ? ` · ${inboxCount}` : ""}</Tab>
    </div>

    {view === "room" ? <>
      {rooms.length > 1 && <div className="flex-none overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><div className="flex gap-1.5">
        {rooms.map((r) => <button key={r.id} onClick={() => setPicked(r.id)} aria-pressed={room?.id === r.id} className={clsx("min-h-[36px] flex-none whitespace-nowrap rounded-full border px-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] transition-colors", room?.id === r.id ? "border-cream text-cream" : "border-line text-dim")}>{r.label}</button>)}
      </div></div>}
      {rooms.length === 1 && room && <p className="mb-2 flex-none truncate font-display text-sm font-black">{room.kind === "hop" ? "The Hop" : events.find((e) => e.id === room.id)?.title ?? eventRooms.find((r) => r.id === room.id)?.title ?? "Event room"}</p>}
      {room ? <RoomView
        key={room.id}
        channel={room.id}
        people={{ kind: "event", id: room.id } satisfies PeopleOf}
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
    </> : <Inbox
      waves={waves}
      dms={dms}
      hasAccount={hasAccount}
      onAnswer={async (w) => {
        const r = await respond(w.id, true);
        if (r.needAccount) { say("Make an account to chat."); router.push("/account?next=/chat"); }
        else if (r.dm) router.push(`/chat/dm/${r.dm}`);
      }}
      onPass={(w) => void respond(w.id, false)}
    />}
  </div>;
}

/** A quiet tab: cream text and an orange underline when it is the one you are on, dim otherwise. */
function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={clsx(
        "-mb-px min-h-[44px] whitespace-nowrap border-b-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-colors",
        on ? "border-orange text-cream" : "border-transparent text-dim"
      )}
    >
      {children}
    </button>
  );
}

/** "SAT 2 AM": when an event room closes for good. */
function closes(at: number) {
  return new Date(at).toLocaleString("en-NG", { weekday: "short", hour: "numeric", timeZone: "Africa/Lagos" }).toUpperCase();
}
