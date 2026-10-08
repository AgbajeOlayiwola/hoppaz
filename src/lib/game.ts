"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";

export type Quest = { id: string; key: string; title: string; description: string; quest_type: "checkin"|"photo"|"qr"|"insight"|"group"; event_id: string|null; starts_at: string; ends_at: string|null; repeat_period: string; xp_reward: number; badge_key: string|null; group_size: number };
export type GameDrop = { id: string; title: string; description: string; partner_id: string|null; event_id: string|null; area: string|null; geog: unknown; opens_at: string; closes_at: string; radius_m: number; claim_method: "proximity"|"qr"|"either"; reward_model: "fixed"|"random"; partner?: { name: string; logo_url: string|null }|null };
export type CrewGroup = { id: string; name: string; visibility: "open"|"private"; invite_code: string; created_by: string; crew_moves?: CrewMove[] };
export type CrewMove = { id: string; crew_id: string; title: string; meetup: string|null; starts_at: string; note: string; event_id: string|null };

export function useQuests(userId: string|null) {
  const [quests,setQuests]=useState<Quest[]>([]); const [claims,setClaims]=useState<Record<string,string>>({}); const [busy,setBusy]=useState<string|null>(null); const [ready,setReady]=useState(false);
  const reload=useCallback(async()=>{const sb=getSupabase();if(!sb){setReady(true);return;}if(!userId)return;const [{data:q},{data:c}]=await Promise.all([sb.from("quests").select("*").eq("active",true).order("starts_at"),sb.from("quest_claims").select("quest_id,status,period_key,claimed_at").eq("user_id",userId).order("claimed_at",{ascending:false})]);const questRows=(q??[]) as Quest[];setQuests(questRows);const byId=new Map(questRows.map(row=>[row.id,row]));const st:Record<string,string>={};const now=new Date();const lagos=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);const date=new Date(`${lagos}T00:00:00Z`);const monday=new Date(date);monday.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));(c??[]).forEach((r)=>{const quest=byId.get(r.quest_id);if(!quest||st[r.quest_id])return;const key=quest.repeat_period==="daily"?lagos:quest.repeat_period==="weekly"?monday.toISOString().slice(0,10):quest.repeat_period==="monthly"?lagos.slice(0,7):"once";if(r.period_key===key)st[r.quest_id]=r.status;});setClaims(st);setReady(true);},[userId]);
  useEffect(()=>{void reload();},[reload]);
  const claim=useCallback(async(quest:Quest,opts:{eventId?:string|null;code?:string;evidence?:string;crewId?:string|null}={})=>{const sb=getSupabase();if(!sb)return "NOT CONNECTED";setBusy(quest.id);const {data,error}=await sb.rpc("claim_quest",{p_quest:quest.id,p_event:opts.eventId??quest.event_id??null,p_code:opts.code??null,p_evidence:opts.evidence??null,p_crew:opts.crewId??null});setBusy(null);if(error)return "COULD NOT COMPLETE QUEST";const r=data as {ok:boolean;reason?:string;status?:string;xp?:number};if(!r.ok)return ({already:"ALREADY COMPLETED",wrong_event:"THIS QUEST IS FOR ANOTHER EVENT",checkin_required:"CHECK IN AT THE EVENT FIRST",invalid_code:"CODE NOT VALID",crew_required:"JOIN A CREW FIRST",group_not_there:"YOUR CREW NEEDS MORE PEOPLE HERE",closed:"QUEST IS CLOSED"} as Record<string,string>)[r.reason??""]??"QUEST NOT READY";await reload();return r.status==="pending"?"SUBMITTED FOR REVIEW":`QUEST COMPLETE · +${r.xp??0} XP`;},[reload]);
  return {quests,claims,busy,claim,reload,/** The first load has finished, whatever it found. */ready};
}

export function useGameDrops(eventId?:string) {
  const [drops,setDrops]=useState<GameDrop[]>([]); const [busy,setBusy]=useState<string|null>(null); const [ready,setReady]=useState(false);
  const reload=useCallback(async()=>{const sb=getSupabase();if(!sb){setReady(true);return;}let q=sb.from("game_drops").select("id,title,description,partner_id,event_id,area,geog,opens_at,closes_at,radius_m,claim_method,reward_model,partner:partners(name,logo_url)").eq("active",true).gt("closes_at",new Date().toISOString()).order("opens_at");if(eventId)q=q.eq("event_id",eventId);const {data}=await q;setDrops((data??[]) as unknown as GameDrop[]);setReady(true);},[eventId]);
  useEffect(()=>{void reload();},[reload]);
  const claim=useCallback(async(drop:GameDrop,fix:{lat:number;lng:number}|null,code?:string)=>{const sb=getSupabase();if(!sb)return {error:"NOT CONNECTED"};setBusy(drop.id);const {data,error}=await sb.rpc("claim_game_drop",{p_drop:drop.id,p_lat:fix?.lat??null,p_lng:fix?.lng??null,p_code:code?.trim()||null});setBusy(null);if(error)return {error:"COULD NOT CLAIM"};const r=data as {ok:boolean;reason?:string;reward?:string;description?:string;code?:string;xp?:number};if(!r.ok)return {error:({closed:"DROP IS CLOSED",sold_out:"ALL REWARDS HAVE BEEN CLAIMED",invalid_code:"QR CODE NOT VALID",code_required:"SCAN THE DROP QR CODE",location_required:"TURN ON LOCATION TO CLAIM",too_far:"GET CLOSER TO THE DROP",already:"YOU ALREADY CLAIMED THIS DROP"} as Record<string,string>)[r.reason??""]??"COULD NOT CLAIM"};await reload();return {reward:r.reward,description:r.description,code:r.code,xp:r.xp};},[reload]);
  return {drops,busy,claim,reload,/** The first load has finished, whatever it found. */ready};
}

/**
 * Game stats for the signed-in Hopper. Pass `{ lite: true }` when you only need
 * the stats (Me): it skips the monthly board and the score-rule table.
 */
export function useGameDashboard(userId:string|null,opts:{lite?:boolean}={}) {
  const lite=!!opts.lite;
  const [stats,setStats]=useState<Record<string,unknown>|null>(null);const [rules,setRules]=useState<{key:string;score:number}[]>([]);const [board,setBoard]=useState<{rank:number;display_name:string;outside_score:number;avatar:unknown}[]>([]);const [busy,setBusy]=useState(false);const [ready,setReady]=useState(false);
  const reload=useCallback(async()=>{const sb=getSupabase();if(!sb){setReady(true);return;}if(lite&&!userId)return;const [{data:s},{data:b},{data:r}]=await Promise.all([userId?sb.rpc("my_game_stats"):Promise.resolve({data:null} as {data:null}),lite?Promise.resolve({data:null} as {data:null}):sb.rpc("monthly_leaderboard"),lite?Promise.resolve({data:null} as {data:null}):sb.from("game_score_rules").select("key,score")]);setStats((s??null) as Record<string,unknown>|null);setRules((r??[]) as {key:string;score:number}[]);setBoard((b??[]) as {rank:number;display_name:string;outside_score:number;avatar:unknown}[]);setReady(true);},[userId,lite]);
  useEffect(()=>{void reload();},[reload]);
  const makeReport=useCallback(async(month?:string)=>{const sb=getSupabase();if(!sb)return null;setBusy(true);const {data}=month?await sb.rpc("create_monthly_report",{p_month:month}):await sb.rpc("create_monthly_report");setBusy(false);return data?String(data):null;},[]);
  return {stats,board,rules,busy,makeReport,reload,/** The first load has finished, whatever it found. */ready};
}

export function useGroups(userId:string|null) {
  const [groups,setGroups]=useState<CrewGroup[]>([]);const [openGroups,setOpenGroups]=useState<CrewGroup[]>([]);const [busy,setBusy]=useState(false);
  const reload=useCallback(async()=>{const sb=getSupabase();if(!sb||!userId)return;const [{data},{data:open}]=await Promise.all([sb.from("crew_members").select("crew:crews!inner(id,name,visibility,invite_code,created_by)").eq("user_id",userId),sb.from("crews").select("id,name,visibility,invite_code,created_by").eq("visibility","open").limit(50)]);const list=((data??[]) as unknown as {crew:CrewGroup}[]).map(x=>x.crew).filter(Boolean);setOpenGroups(((open??[]) as CrewGroup[]).filter(g=>!list.some(m=>m.id===g.id)));if(list.length){const {data:m}=await sb.from("crew_moves").select("*").in("crew_id",list.map(g=>g.id)).order("starts_at");const by=new Map<string,CrewMove[]>();(m??[]).forEach((x)=>by.set(x.crew_id,[...(by.get(x.crew_id)??[]),x as CrewMove]));list.forEach(g=>g.crew_moves=by.get(g.id)??[]);}setGroups(list);},[userId]);
  useEffect(()=>{void reload();},[reload]);
  const create=useCallback(async(name:string,visibility:"open"|"private")=>{const sb=getSupabase();if(!sb)return null;setBusy(true);const {data}=await sb.rpc("create_crew",{p_name:name,p_visibility:visibility});setBusy(false);await reload();return data?String(data):null;},[reload]);
  const join=useCallback(async(invite:string)=>{const sb=getSupabase();if(!sb)return false;setBusy(true);const {data}=await sb.rpc("join_crew",{p_invite:invite});setBusy(false);if(data)await reload();return !!data;},[reload]);
  const plan=useCallback(async(crewId:string,move:Omit<CrewMove,"id"|"crew_id">)=>{const sb=getSupabase();if(!sb||!userId)return false;const {error}=await sb.from("crew_moves").insert({...move,crew_id:crewId,created_by:userId});if(!error)await reload();return !error;},[userId,reload]);
  const rsvp=useCallback(async(moveId:string,status:"going"|"maybe"|"cant_go")=>{const sb=getSupabase();if(!sb||!userId)return false;const {error}=await sb.from("crew_move_rsvps").upsert({move_id:moveId,user_id:userId,status});return !error;},[userId]);
  return {groups,openGroups,busy,create,join,plan,rsvp,reload};
}
