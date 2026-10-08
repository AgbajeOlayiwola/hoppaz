"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useToast } from "@/lib/store";
import { useChatImages, usePeople, useRoom, type PeopleOf } from "@/lib/chat";
import ChatFace from "./ChatFace";
import Composer from "./Composer";
import PersonCard, { type CardPerson } from "./PersonCard";

/**
 * One conversation: the people in it as a strip of faces, the messages, the
 * composer. The same view serves an event's room and its group chat;
 * who may read or post is decided by the server.
 */
export default function RoomView({
  channel,
  people: peopleOf,
  userId,
  hasAccount,
  note,
  empty,
  noPeople,
  placeholder = "Say something",
}: {
  channel: string;
  people: PeopleOf;
  userId: string | null;
  hasAccount: boolean;
  /** One line under the header, e.g. when the room closes. */
  note?: string;
  empty: string;
  noPeople?: string;
  placeholder?: string;
}) {
  const say = useToast((s) => s.say);
  const { msgs, mine, live, send } = useRoom(channel, userId);
  const { people, reload } = usePeople(peopleOf, userId);
  const images = useChatImages(msgs.map((m) => m.image_path));
  const [person, setPerson] = useState<CardPerson | null>(null);
  const path = usePathname();

  return <>
    <div className="mb-2 flex flex-none items-center justify-between gap-2">
      <span className={clsx("seclabel", live ? "text-ok" : "text-dim")}>{live ? "LIVE" : "CHAT"}{people.length ? ` · ${people.length} IN HERE` : ""}</span>
      {note && <span className="truncate font-mono text-[9px] text-dim">{note}</span>}
    </div>
    {people.length > 0 ? (
      <div className="mb-2 flex flex-none gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="People in this chat">
        {people.map((p) => <button key={p.key} onClick={() => setPerson({ key: p.key, name: p.name, handle: p.handle, look: p.look, waved: p.waved, inCrew: p.in_crew })} className="flex w-14 flex-none flex-col items-center gap-1">
          <span className="relative">
            <ChatFace look={p.look} alias={p.look ? null : p.handle} size={44} />
            {(p.waved || p.in_crew) && <i className={clsx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink", p.in_crew ? "bg-violet" : "bg-orange")} aria-hidden />}
          </span>
          <span className="w-full truncate text-center font-mono text-[8px] font-bold text-dim">@{p.handle}</span>
        </button>)}
      </div>
    ) : noPeople && <p className="hint mb-2 flex-none">{noPeople}</p>}
    {!hasAccount && <Link href={`/account?next=${encodeURIComponent(path)}`} className="mb-3 flex flex-none items-center justify-between gap-3 rounded border border-orange/60 bg-ink-2 px-3 py-2">
      <span className="text-[12px] leading-snug">Make an account to wave, add people to your crew and DM.</span>
      <span className="flex-none font-mono text-[9px] font-bold tracking-widest text-orange">SIGN UP →</span>
    </Link>}
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3">
      {!msgs.length ? <p className="hint">{empty}</p> : msgs.map((m) => {
        const own = !!m.author_key && mine.has(m.author_key);
        const who = own ? "You" : m.author_name ?? "A Hopper";
        const img = m.image_path ? images[m.image_path] : null;
        return <button key={m.id} onClick={() => !own && m.author_key && setPerson({ key: m.author_key, name: who, handle: m.author_handle, look: m.author_look, anon: m.anon, messageId: m.id, excerpt: m.body || undefined })} className={clsx("flex items-start gap-2 text-left", own && "flex-row-reverse")}>
          <ChatFace look={m.author_look} alias={m.anon || !m.author_look ? who : null} size={32}/>
          <span className={clsx("min-w-0 max-w-[82%] rounded border px-2.5 py-2", own ? "border-[#4A2D1E] bg-[#2A1A12]" : "border-line bg-ink-2")}>
            <span className="block truncate font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-orange">{who}{m.author_handle && !own ? <span className="normal-case tracking-normal text-dim"> @{m.author_handle}</span> : null}</span>
            {m.image_path && (img
              // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
              ? <img src={img} alt={`Picture from ${who}`} loading="lazy" className="mt-1 max-h-60 w-full rounded object-cover" />
              : <span className="mt-1 block h-32 w-40 animate-pulse rounded bg-ink-3" aria-label="Loading picture" />)}
            {m.body && <p className="mt-0.5 break-words font-display text-[13.5px] leading-snug">{m.body}</p>}
          </span>
        </button>;
      })}
    </div>
    <Composer placeholder={placeholder} maxLength={400} onSend={async (body, image) => { const error = await send(body, false, image); if (error) say(error); return error; }} />
    {person && <PersonCard person={person} hasAccount={hasAccount} onClose={() => setPerson(null)} onChanged={() => void reload()} />}
  </>;
}
