"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { useHoppaz, useToast } from "@/lib/store";
import { useEvents } from "@/lib/useEvents";
import { useQuests, useGameDashboard, useGroups, type Quest } from "@/lib/game";

export default function QuestsPage() {
  const { userId } = useSession();
  const { fix } = useHoppaz();
  const { events } = useEvents(fix, 45);
  const { quests, claims, busy, claim } = useQuests(userId);
  const { stats, board, rules, makeReport, busy: reportBusy } = useGameDashboard(userId);
  const { groups } = useGroups(userId);
  const say = useToast((s) => s.say);
  const [codes,setCodes]=useState<Record<string,string>>({});
  const [evidence,setEvidence]=useState<Record<string,string>>({});
  const [eventIds,setEventIds]=useState<Record<string,string>>({});
  const [crewIds,setCrewIds]=useState<Record<string,string>>({});
  const complete = async (q:Quest) => { const msg=await claim(q,{eventId:eventIds[q.id]||q.event_id,code:codes[q.id],evidence:evidence[q.id],crewId:crewIds[q.id]});say(msg,msg.includes("COMPLETE")?"violet":"orange"); };
  return <div className="h-full overflow-y-auto px-4 pb-6">
    <header className="pad-top flex items-start justify-between gap-3 pb-4"><div><h1 className="font-display text-2xl font-black">Your city progress</h1><p className="seclabel mt-1.5">Quests, streaks and your Outside Score</p></div><Link href="/drops" className="btn btn-ghost flex-none px-3 py-2"><Sparkles size={14}/> REWARDS</Link></header>
    <section className="card mb-4 border-orange/60"><div className="flex items-start justify-between"><div><p className="seclabel text-orange">THIS MONTH · LAGOS</p><p className="mt-1 font-display text-3xl font-black tabular-nums">{String(stats?.outside_score??0)}</p><p className="hint">Outside Score · {String(stats?.verified_outings??0)} verified outings · {String(stats?.active_days??0)} active days</p></div><span className="tag tag-o">{stats?.lagos_rank?`#${stats.lagos_rank}`:"LAGOS"}</span></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="DAILY" value={`${stats?.daily_streak??0} day streak`}/><Metric label="THIS WEEK" value={`${stats?.active_days_this_week??0}/3 days`}/><Metric label="OUTINGS" value={`${stats?.outing_streak??0} week streak`}/></div><button disabled={reportBusy} onClick={async()=>{const token=await makeReport();if(token){const url=`${location.origin}/report/share/${token}`;try{await navigator.clipboard.writeText(url);say("MONTHLY REPORT LINK COPIED","violet");}catch{say(url,"violet");}}}} className="btn btn-ghost mt-4 w-full px-3 py-2">{reportBusy?"MAKING REPORT…":"MAKE LAST MONTH’S REPORT CARD"} <ArrowUpRight size={13}/></button></section>
    <div className="mb-4 rounded border border-line p-3"><p className="seclabel mb-2">LAGOS MONTHLY BOARD</p>{board.slice(0,5).map((p,i)=><div key={`${p.rank}-${i}`} className="flex items-center gap-2 border-t border-line py-2 first:border-0"><span className="w-5 font-mono text-xs text-dim">{p.rank}</span><span className="flex-1 font-display text-sm font-bold">{p.display_name}</span><span className="font-mono text-xs font-bold text-orange">{p.outside_score}</span></div>)}{board.length===0&&<p className="hint">Your Lagos rank appears once verified city activity starts.</p>}</div>
    <div className="mb-3 flex items-center justify-between"><p className="seclabel">AVAILABLE QUESTS</p><span className="tag">{quests.length} LIVE</span></div>
    {!quests.length&&<p className="hint mb-4">No quests are live yet. Hoppaz adds event quests as the calendar fills.</p>}
    {quests.map((q)=><article key={q.id} className="card mb-2 p-3"><div className="flex items-start gap-3"><div className="grid h-9 w-9 flex-none place-items-center rounded bg-orange/15 text-orange"><QuestIcon type={q.quest_type}/></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="font-display font-black">{q.title}</h2><span className="tag tag-o">+{q.xp_reward} XP</span></div><p className="hint mt-1">{q.description}</p><p className="mt-2 font-mono text-[8px] uppercase tracking-widest text-dim">{q.repeat_period} · {q.quest_type}{q.ends_at?` · ENDS ${new Date(q.ends_at).toLocaleString("en-NG",{dateStyle:"short",timeStyle:"short"})}`:""}</p></div></div>
      {(q.quest_type==="qr"||q.quest_type==="insight")&&<input className="mt-3" placeholder={q.quest_type==="qr"?"Enter venue code":"Venue code"} value={codes[q.id]??""} onChange={e=>setCodes({...codes,[q.id]:e.target.value})}/>}
      {q.quest_type==="insight"&&<textarea className="mt-2" maxLength={500} placeholder="Share one thing you learned" value={evidence[q.id]??""} onChange={e=>setEvidence({...evidence,[q.id]:e.target.value})}/>}
      {(q.quest_type==="checkin"||q.quest_type==="photo"||q.quest_type==="group")&&!q.event_id&&<select className="mt-3" value={eventIds[q.id]??""} onChange={e=>setEventIds({...eventIds,[q.id]:e.target.value})}><option value="">Choose an event</option>{events.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select>}
      {q.quest_type==="group"&&<select className="mt-2" value={crewIds[q.id]??""} onChange={e=>setCrewIds({...crewIds,[q.id]:e.target.value})}><option value="">Choose your crew</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
      {q.quest_type==="photo"&&<p className="hint mt-2">Post a photo on the event page first. Hoppaz reviews it before awarding this quest.</p>}
      <button disabled={busy===q.id||!!claims[q.id]||((q.quest_type==="qr"||q.quest_type==="insight")&&!codes[q.id])} onClick={()=>void complete(q)} className="btn mt-3 w-full px-3 py-2">{claims[q.id]==="pending"?<><Clock3 size={13}/> IN REVIEW</>:claims[q.id]?<><CheckCircle2 size={13}/> COMPLETED</>:busy===q.id?"SUBMITTING…":"COMPLETE QUEST"}</button>
    </article>)}
    <details className="mt-5 rounded border border-line p-3"><summary className="font-mono text-[9px] font-bold tracking-widest text-orange">HOW OUTSIDE SCORE WORKS</summary><p className="hint mt-2">Monthly Outside Score adds these verified actions. It resets at the start of each Lagos month; lifetime XP still drives your star level.</p>{rules.map(r=><div key={r.key} className="flex justify-between border-t border-line py-1.5 font-mono text-[9px] uppercase"><span>{r.key.replaceAll("_"," ")}</span><b>{r.score} pts</b></div>)}</details>
    <p className="hint mt-3">Activity is earned from city actions, not app opens. You can keep your streak alive without going to an event every day.</p>
  </div>;
}
function Metric({label,value}:{label:string;value:string}){return <div className="rounded border border-line px-2 py-2"><p className="seclabel">{label}</p><p className="mt-1 font-mono text-[10px] font-bold">{value}</p></div>}
function QuestIcon({type}:{type:string}){return type==="photo"?<span>📸</span>:type==="group"?<span>👥</span>:type==="qr"?<span>▦</span>:type==="insight"?<span>💡</span>:<span>📍</span>}
