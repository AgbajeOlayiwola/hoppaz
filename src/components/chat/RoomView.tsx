"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Check, Hand } from "lucide-react";
import { useToast } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";
import { useChatImages, usePeople, useRoom, type PeopleOf } from "@/lib/chat";
import type { Message, Person } from "@/lib/types";
import ChatFace from "./ChatFace";
import Bubble, { chatTime } from "./Bubble";
import Composer from "./Composer";
import PersonCard, { type CardPerson } from "./PersonCard";
import { useLinger } from "./useLinger";

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
  // Only say so when there is a connection to lose: in local demo there is none.
  const reconnecting = useLinger(!live && !!getSupabase(), 3000);

  return <>
    <div className="mb-2 flex flex-none items-center justify-between gap-2">
      <span className="seclabel">
        {people.length ? `${people.length} IN HERE` : "CHAT"}
        {reconnecting && " · RECONNECTING..."}
      </span>
      {note && <span className="truncate font-mono text-[10px] text-dim">{note}</span>}
    </div>
    {people.length > 0 ? (
      <PeopleStrip people={people} onPick={setPerson} />
    ) : noPeople && <p className="hint mb-2 flex-none">{noPeople}</p>}
    {!hasAccount && <Link href={`/account?next=${encodeURIComponent(path)}`} className="mb-3 flex min-h-[44px] flex-none items-center justify-between gap-3 rounded-hz border border-line bg-ink-2 px-3 py-2">
      <span className="font-body text-[13px] leading-snug">Make an account to wave, add people to your crew and DM.</span>
      <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">SIGN UP →</span>
    </Link>}
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3">
      {!msgs.length ? <p className="hint">{empty}</p> : msgs.map((m) => (
        <RoomMessage
          key={m.id}
          m={m}
          own={!!m.author_key && mine.has(m.author_key)}
          image={m.image_path ? images[m.image_path] : null}
          onPick={setPerson}
        />
      ))}
    </div>
    <Composer safeArea={false} placeholder={placeholder} maxLength={400} onSend={async (body, image) => { const error = await send(body, false, image); if (error) say(error, "error"); return error; }} />
    {person && <PersonCard person={person} hasAccount={hasAccount} onClose={() => setPerson(null)} onChanged={() => void reload()} />}
  </>;
}

/** The faces in the room, one tap each to open their card. */
export function PeopleStrip({ people, onPick }: { people: Person[]; onPick: (p: CardPerson) => void }) {
  return (
    <div className="mb-2 flex flex-none gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="People in this chat">
      {people.map((p) => (
        <button
          key={p.key}
          onClick={() => onPick({ key: p.key, name: p.name, handle: p.handle, look: p.look, waved: p.waved, inCrew: p.in_crew })}
          className="flex w-16 flex-none flex-col items-center gap-1"
        >
          <span className="relative">
            <ChatFace look={p.look} alias={p.look ? null : p.handle} size={44} />
            {(p.waved || p.in_crew) && (
              <span
                className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border border-line bg-ink"
                title={p.in_crew ? "In your crew" : "You waved"}
              >
                {p.in_crew ? <Check size={10} strokeWidth={3} className="text-keke" aria-hidden /> : <Hand size={9} className="text-dim" aria-hidden />}
                <span className="sr-only">{p.in_crew ? "In your crew" : "You waved"}</span>
              </span>
            )}
          </span>
          <span className="w-full truncate text-center font-mono text-[10px] text-dim">@{p.handle}</span>
        </button>
      ))}
    </div>
  );
}

/** One message in a room: the face, then the bubble. Tap someone else's to open their card. */
export function RoomMessage({
  m,
  own,
  image,
  onPick,
}: {
  m: Message;
  own: boolean;
  image?: string | null;
  onPick: (p: CardPerson) => void;
}) {
  const who = own ? "You" : m.author_name ?? "A Hopper";
  const canPick = !own && !!m.author_key;
  return (
    <button
      type="button"
      disabled={!canPick}
      onClick={() => canPick && onPick({ key: m.author_key!, name: who, handle: m.author_handle, look: m.author_look, anon: m.anon, messageId: m.id, excerpt: m.body || undefined })}
      className={clsx("flex items-start gap-2 text-left", own && "flex-row-reverse")}
    >
      <ChatFace look={m.author_look} alias={m.anon || !m.author_look ? who : null} size={32} />
      <Bubble
        own={own}
        author={who}
        handle={m.author_handle}
        anon={m.anon}
        time={chatTime(m.created_at)}
        body={m.body}
        image={image}
        imageAlt={`Picture from ${who}`}
        imageLoading={!!m.image_path && !image}
      />
    </button>
  );
}
