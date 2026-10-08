"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Ban, ChevronLeft, Eye, Flag } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { useChatImages, useDm, blockPerson, reportThing } from "@/lib/chat";
import { useToast } from "@/lib/store";
import ChatFace from "@/components/chat/ChatFace";
import Bubble, { chatTime } from "@/components/chat/Bubble";
import Composer from "@/components/chat/Composer";

export default function DmPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { userId } = useSession();
  const { msgs, thread, missing, send, reveal } = useDm(id, userId);
  const say = useToast((s) => s.say);
  const images = useChatImages(msgs.map((m) => m.image_path));
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }); }, [msgs]);
  useEffect(() => { if (missing) router.replace("/chat"); }, [missing, router]);
  if (!thread) return <div className="grid h-full place-items-center"><span className="hint">OPENING CHAT…</span></div>;
  const actions = async (kind: "block" | "report") => {
    if (kind === "block") {
      const ok = await blockPerson({ dm: id }, thread.other_name);
      say(ok ? "BLOCKED" : "COULD NOT BLOCK", ok ? "ok" : "error");
      router.replace("/chat");
    } else {
      const last = msgs[msgs.length - 1];
      const ok = last ? await reportThing("dm", last.id, "Something else") : false;
      say(ok ? "REPORTED. THE CREW WILL LOOK AT IT" : "COULD NOT REPORT", ok ? "ok" : "error");
    }
  };
  return <div className="flex h-full flex-col overflow-hidden px-4">
    <header className="pad-top flex flex-none items-center gap-2 pb-3">
      <button onClick={() => router.push("/chat")} aria-label="Back to chats" className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream"><ChevronLeft size={26} strokeWidth={2.2} aria-hidden /></button>
      <ChatFace look={thread.other_look} alias={thread.other_look ? null : thread.other_name} size={38} caption={!thread.other_look} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-lg font-black leading-tight">{thread.other_name}</h1>
        {thread.other_handle && thread.revealed && <p className="truncate font-mono text-[10px] text-dim">@{thread.other_handle}</p>}
        <p className="seclabel truncate">{thread.event_title ? `MET AT ${thread.event_title.toUpperCase()}` : "PRIVATE CHAT"}</p>
      </div>
      <button onClick={() => void actions("report")} disabled={msgs.length === 0} aria-label="Report" className="grid h-11 w-11 flex-none place-items-center text-dim disabled:opacity-40"><Flag size={16} /></button>
      <button onClick={() => void actions("block")} aria-label="Block" className="grid h-11 w-11 flex-none place-items-center text-fireant"><Ban size={16} /></button>
    </header>
    {!thread.revealed && <button onClick={() => { void reveal(); say("Reveal request sent. You'll be known if they reveal too.", "ok"); }} className="btn btn-ghost mb-3 flex-none"><Eye size={15} /> {thread.me_revealed ? "YOU REVEALED · WAITING FOR THEM" : "SHOW EACH OTHER YOUR REAL NAMES"}</button>}
    <div ref={feed} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3">
      {msgs.map((m) => {
        const own = m.from_a === thread.i_am_a;
        const img = m.image_path ? images[m.image_path] : null;
        return <div key={m.id} className={own ? "flex justify-end" : "flex justify-start"}>
          <Bubble own={own} time={chatTime(m.created_at)} body={m.body} image={img} imageLoading={!!m.image_path && !img} />
        </div>;
      })}
      {msgs.length === 0 && <p className="hint">You both waved. Start with a hello, and keep it kind.</p>}
    </div>
    <Composer placeholder="Message privately" maxLength={1000} onSend={async (body, image) => { const error = await send(body, image); if (error) say(error, "error"); return error; }} />
  </div>;
}
