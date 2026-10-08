"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useEventGroups } from "@/lib/chat";
import { dayLagos } from "@/lib/geo";
import { Search, UserMinus, UserPlus } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { useCrew } from "@/lib/useCrew";
import { useHoppaz, useToast } from "@/lib/store";
import { areaByName, travelEstimate } from "@/lib/geo";
import { levelFor } from "@/lib/brand";
import type { Profile } from "@/lib/types";
import Avatar from "@/components/Avatar";
import { useGroups, type CrewGroup } from "@/lib/game";
import { CalendarDays, Copy, MapPin, Plus } from "lucide-react";
import { useEvents } from "@/lib/useEvents";

export default function CrewPage() {
  const { userId, profile } = useSession();
  const { crew, add, remove, search } = useCrew(userId);
  const { groups, openGroups, create: createGroup, join: joinGroup, plan, rsvp } = useGroups(userId);
  const { groups: chats, join: joinChat, leave: leaveChat } = useEventGroups(userId);
  const invites = chats.filter((g) => g.status === "invited");
  const joined = chats.filter((g) => g.status === "joined");
  const { fix, look } = useHoppaz();
  const { events } = useEvents(fix,45);
  const say = useToast((s) => s.say);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [groupName,setGroupName]=useState("");
  const [invite,setInvite]=useState("");
  const [visibility,setVisibility]=useState<"private"|"open">("private");
  const [moving,setMoving]=useState<string|null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      setHits(await search(q));
      setSearching(false);
    }, 280);
    return () => clearTimeout(t);
  }, [q, search]);

  const board = useMemo(() => {
    const me = {
      id: userId ?? "me",
      display_name: profile?.display_name ?? "You",
      area: profile?.area ?? fix?.area ?? null,
      xp: profile?.xp ?? 0,
      is_admin: false,
      avatar: profile?.avatar ?? look,
      mine: true,
    };
    return [...crew.map((c) => ({ ...c, mine: false })), me].sort((a, b) => b.xp - a.xp);
  }, [crew, userId, profile, fix, look]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <header className="pad-top pb-4">
        <h1 className="font-display text-2xl font-black leading-none">Your crew</h1>
        <p className="seclabel mt-1.5">Who is out and where they are</p>
      </header>

      <section className="card mb-4 p-3" aria-label="Event group chats">
        <div className="flex items-center justify-between"><p className="seclabel text-orange">EVENT GROUP CHATS</p><span className="tag">{invites.length ? `${invites.length} INVITE${invites.length === 1 ? "" : "S"}` : "STAY IN TOUCH"}</span></div>
        {chats.length === 0 && <p className="hint mt-2">Say you&apos;re going to an event and you&apos;re invited to its group chat. Unlike the event room, it stays after the night.</p>}
        {invites.map((g) => (
          <div key={g.event_id} className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display">{g.title}</b>
              <span className="hint">{dayLagos(g.starts_at)} · {g.members} in the chat · you&apos;re invited</span>
            </span>
            <button className="btn px-3 py-2" onClick={async () => say((await joinChat(g.event_id)) ? "YOU'RE IN THE GROUP CHAT" : "COULD NOT JOIN", "violet")}>JOIN</button>
            <button className="btn btn-ghost px-3 py-2" onClick={() => void leaveChat(g.event_id)} aria-label={`No thanks to ${g.title}`}>NO</button>
          </div>
        ))}
        {joined.map((g) => (
          <Link key={g.event_id} href={`/crew/group/${g.event_id}`} className="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded bg-violet text-cream"><MessageSquare size={15} /></span>
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display">{g.title}</b>
              <span className="hint block truncate">{g.last_body ?? `${g.members} in the chat · say hi`}</span>
            </span>
            <span className="flex-none font-mono text-[9px] font-bold text-orange">OPEN →</span>
          </Link>
        ))}
      </section>

      <section className="card mb-4 p-3">
        <div className="flex items-center justify-between"><p className="seclabel text-orange">YOUR CREWS</p><span className="tag">LONG-TERM GROUPS</span></div>
        <div className="mt-3 flex gap-2"><input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Name a crew" maxLength={50}/><select value={visibility} onChange={e=>setVisibility(e.target.value as "private"|"open")} className="max-w-28"><option value="private">Private</option><option value="open">Open</option></select><button className="btn px-3" aria-label="Create crew" onClick={async()=>{if(!groupName.trim())return;const id=await createGroup(groupName.trim(),visibility);if(id){setGroupName("");say("CREW CREATED · INVITE CODE READY","violet");}}}><Plus size={14}/></button></div>
        <div className="mt-2 flex gap-2"><input value={invite} onChange={e=>setInvite(e.target.value)} placeholder="Join with invite code"/><button className="btn btn-ghost px-3" onClick={async()=>{const ok=await joinGroup(invite);say(ok?"JOINED THE CREW":"CODE NOT FOUND",ok?"violet":"orange");if(ok)setInvite("")}}>JOIN</button></div>
        {groups.map(g=><CrewPanel key={g.id} group={g} events={events} moving={moving===g.id} onPlan={()=>setMoving(moving===g.id?null:g.id)} onRsvp={rsvp} onSubmit={async(form)=>{const ok=await plan(g.id,form);say(ok?"MOVE ADDED TO THE CREW":"COULD NOT PLAN MOVE",ok?"violet":"orange");setMoving(null);}}/>)}
        {openGroups.length>0&&<><p className="seclabel mb-2 mt-4">OPEN CREWS</p>{openGroups.map(g=><div key={g.id} className="mb-2 flex items-center gap-2 border-t border-line pt-2"><span className="flex-1 font-display font-bold">{g.name}</span><button className="btn btn-ghost px-3 py-2" onClick={async()=>{const ok=await joinGroup(g.id);say(ok?"JOINED THE CREW":"COULD NOT JOIN",ok?"violet":"orange")}}>JOIN</button></div>)}</>}
      </section>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-3.5 text-dim" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a Hopper by name"
          className="pl-9"
          autoComplete="off"
          aria-label="Find a Hopper by name"
        />
      </div>

      {q.trim().length >= 2 && (
        <div className="mb-5">
          <p className="seclabel mb-2">{searching ? "Looking…" : `${hits.length} found`}</p>
          {hits
            .filter((h) => h.id !== userId && !crew.some((c) => c.id === h.id))
            .map((h) => (
              <div key={h.id} className="mb-2 flex items-center gap-3 card py-3">
                <Face p={h} />
                <span className="min-w-0 flex-1">
                  <b className="font-display font-black">{h.display_name}</b>
                  <p className="hint">
                    {h.area ?? "somewhere in Lagos"} · {h.xp} XP
                  </p>
                </span>
                <button
                  className="btn btn-ghost flex-none px-3 py-2"
                  onClick={async () => {
                    const ok = await add(h.id);
                    say(ok ? `${(h.display_name ?? "HOPPER").toUpperCase()} ADDED` : "COULD NOT ADD");
                    if (ok) setQ("");
                  }}
                >
                  <UserPlus size={14} />
                </button>
              </div>
            ))}
          {!searching && hits.length === 0 && (
            <p className="hint">
              Nobody by that name yet. Hoppers only appear here once they have set a name on the Me
              tab.
            </p>
          )}
        </div>
      )}

      {crew.length === 0 ? (
        <p className="hint mb-6">
          No crew yet. Add the people you actually go out with, then flip the crew button on the
          map and their pins show up where they are.
        </p>
      ) : (
        <div className="mb-6">
          {crew.map((m) => {
            const here = fix ? { ...fix, side: areaByName(fix.area)?.side } : null;
            const there = areaByName(m.area);
            const trip = here && there ? travelEstimate(here, there) : null;
            return (
              <div key={m.id} className="mb-2 flex items-center gap-3 card py-3">
                <Face p={m} cream />
                <span className="min-w-0 flex-1">
                  <b className="font-display font-black">{m.display_name ?? "A Hopper"}</b>
                  <p className="hint">
                    {m.area ?? "somewhere in Lagos"}
                    {trip && ` · ${trip.km.toFixed(1)} km · ~${trip.minutes} min away`}
                  </p>
                </span>
                <button
                  className="btn btn-ghost flex-none px-3 py-2"
                  aria-label={`Remove ${m.display_name ?? "this Hopper"}`}
                  onClick={() => void remove(m.id)}
                >
                  <UserMinus size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-3 h-px bg-line" />
      <p className="seclabel mb-2">Crew leaderboard</p>
      {board.map((m, i) => (
        <div key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
          <span className="w-5 flex-none font-mono text-[11px] font-bold tabular-nums text-dim">
            {i + 1}
          </span>
          <Face p={m} cream={!m.mine} />
          <span className="min-w-0 flex-1">
            <b className="font-display font-black">
              {m.display_name ?? "A Hopper"}
              {m.mine && " (you)"}
            </b>
            <p className="hint">
              {levelFor(m.xp).name} · {m.xp} XP{m.area ? ` · ${m.area}` : ""}
            </p>
          </span>
        </div>
      ))}
    </div>
  );
}

function CrewPanel({group,events,moving,onPlan,onSubmit,onRsvp}:{group:CrewGroup;events:{id:string;title:string}[];moving:boolean;onPlan:()=>void;onSubmit:(move:{title:string;meetup:string|null;starts_at:string;note:string;event_id:string|null})=>void;onRsvp:(moveId:string,status:"going"|"maybe"|"cant_go")=>Promise<boolean>}) {
  const [copied,setCopied]=useState(false);
  return <div className="mt-3 rounded border border-line p-3"><div className="flex items-center gap-2"><span className="flex-1"><b className="font-display">{group.name}</b><span className="ml-2 tag">{group.visibility}</span></span><button className="tag" onClick={async()=>{await navigator.clipboard.writeText(group.invite_code);setCopied(true);setTimeout(()=>setCopied(false),1500)}}><Copy size={11}/> {copied?"COPIED":group.invite_code}</button><button className="btn px-2 py-1.5 text-[9px]" onClick={onPlan}>PLAN A MOVE</button></div>
    {moving&&<form className="mt-3 grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSubmit({title:String(f.get("title")),meetup:String(f.get("meetup")||"")||null,starts_at:new Date(String(f.get("starts_at"))).toISOString(),note:String(f.get("note")||""),event_id:String(f.get("event_id")||"")||null})}}><input name="title" required placeholder="What’s the move?"/><div className="grid grid-cols-2 gap-2"><input name="meetup" placeholder="Where to meet"/><input name="starts_at" required type="datetime-local"/></div><select name="event_id"><option value="">General crew move</option>{events.map(event=><option key={event.id} value={event.id}>{event.title}</option>)}</select><input name="note" placeholder="Extra details"/><button className="btn px-3 py-2">SAVE THE MOVE</button></form>}
    {(group.crew_moves??[]).map(move=><div key={move.id} className="mt-3 border-t border-line pt-2"><p className="font-display font-bold">{move.title}</p><p className="hint mt-1"><CalendarDays size={11} className="inline"/> {new Date(move.starts_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})}{move.meetup&&<> · <MapPin size={11} className="inline"/> {move.meetup}</>}</p><p className="hint">{move.note}</p><div className="mt-2 flex gap-1"><button className="tag tag-o" onClick={()=>void onRsvp(move.id,"going")}>I’M IN</button><button className="tag" onClick={()=>void onRsvp(move.id,"maybe")}>MAYBE</button><button className="tag" onClick={()=>void onRsvp(move.id,"cant_go")}>CAN’T GO</button></div></div>)}
  </div>
}

function Face({ p, cream }: { p: Pick<Profile, "display_name" | "avatar">; cream?: boolean }) {
  // Hoppers who never dressed up keep the initial, so the list still tells people apart.
  if (!p.avatar) {
    return (
      <span
        className={`grid h-8 w-8 flex-none place-items-center rounded font-display text-xs font-black ${
          cream ? "bg-cream text-ink" : "bg-orange text-ink"
        }`}
        aria-hidden
      >
        {(p.display_name || "H")[0].toUpperCase()}
      </span>
    );
  }
  return (
    <span
      className={`h-9 w-9 flex-none overflow-hidden rounded-full border ${cream ? "border-cream bg-cream" : "border-orange bg-orange"}`}
      aria-hidden
    >
      <Avatar look={p.avatar} crop="head" />
    </span>
  );
}
