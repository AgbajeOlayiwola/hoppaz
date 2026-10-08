"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, Flag, Eye } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { useChatImages, useDm, blockPerson, reportThing } from "@/lib/chat";
import { useToast } from "@/lib/store";
import ChatFace from "@/components/chat/ChatFace";
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
    if (kind === "block") { const ok = await blockPerson({ dm: id }, thread.other_name); say(ok ? "BLOCKED" : "COULD NOT BLOCK"); router.replace("/chat"); }
    else { const last = msgs[msgs.length - 1];
      const ok = last ? await reportThing("dm", last.id, "Something else") : false; say(ok ? "REPORTED. THE CREW WILL LOOK AT IT" : "COULD NOT REPORT"); }
  };
  return <div className="flex h-full flex-col overflow-hidden px-4">
    <header className="pad-top flex flex-none items-center gap-3 pb-3"><button onClick={() => router.push("/chat")} aria-label="Back to chats" className="grid h-9 w-9 place-items-center rounded border border-line"><ArrowLeft size={16}/></button><ChatFace look={thread.other_look} alias={thread.other_look ? null : thread.other_name} size={38}/><div className="min-w-0 flex-1"><h1 className="truncate font-display text-lg font-black">{thread.other_name}</h1>{thread.other_handle && thread.revealed && <p className="truncate font-mono text-[9px] font-bold text-orange">@{thread.other_handle}</p>}<p className="seclabel">{thread.event_title ? `MET AT ${thread.event_title.toUpperCase()}` : "PRIVATE CHAT"}</p></div><button onClick={() => void actions("report")} disabled={msgs.length === 0} aria-label="Report" className="grid h-8 w-8 place-items-center text-dim"><Flag size={15}/></button><button onClick={() => void actions("block")} aria-label="Block" className="grid h-8 w-8 place-items-center text-dim"><Ban size={15}/></button></header>
    {!thread.revealed && <button onClick={() => { void reveal(); say("REVEAL REQUEST SENT · YOU’LL BE KNOWN IF THEY ALSO REVEAL", "violet"); }} className="mb-3 flex flex-none items-center justify-center gap-2 rounded border border-line py-2 font-mono text-[9px] font-bold tracking-wider text-dim"><Eye size={14}/> {thread.me_revealed ? "YOU REVEALED · WAITING FOR THEM" : "SHOW EACH OTHER YOUR REAL NAMES"}</button>}
    <div ref={feed} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3">{msgs.map((m) => { const own = m.from_a === thread.i_am_a; return <div key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}><span className={`max-w-[84%] rounded border px-3 py-2 ${own ? "border-[#4A2D1E] bg-[#2A1A12]" : "border-line bg-ink-2"}`}>{m.image_path && (images[m.image_path]
      // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
      ? <img src={images[m.image_path]} alt="Picture" loading="lazy" className="mb-1 max-h-64 w-full rounded object-cover" />
      : <span className="mb-1 block h-32 w-40 animate-pulse rounded bg-ink-3" aria-label="Loading picture" />)}{m.body && <p className="break-words text-[13.5px] leading-snug">{m.body}</p>}</span></div>; })}{msgs.length === 0 && <p className="hint">You both waved. Start with a hello, and keep it kind.</p>}</div>
    <Composer placeholder="Message privately" maxLength={1000} onSend={async (body, image) => { const error = await send(body, image); if (error) say(error); return error; }} />
  </div>;
}
