import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { huntItem } from "@/lib/huntItems";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function adminClient():SupabaseClient|null{const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;}
function authorized(req:Request){const secret=process.env.HOPPAZ_ADMIN_TOKEN??"";const received=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");if(!secret||!received)return false;const a=Buffer.from(secret);const b=Buffer.from(received);return a.length===b.length&&timingSafeEqual(a,b);}
function hash(value:string){return createHash("sha256").update(value).digest("hex");}
const bad=(message:string,status=400)=>NextResponse.json({error:message},{status});
function validDate(value:unknown):string|null{if(typeof value!=="string"||!value)return null;const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString():null;}

export async function GET(req:Request){
  if(!authorized(req))return bad("Unauthorized",401);const sb=adminClient();if(!sb)return bad("Admin service is not configured",503);
  const [events,liveEvents,photos,claims,reports,drops,partners,rules]=await Promise.all([
    sb.from("events").select("id,title,venue_name,area,starts_at,ig_url,created_at").eq("status","pending").order("created_at"),
    sb.from("events").select("id,title,venue_name,area,starts_at").eq("status","live").gte("starts_at",new Date(Date.now()-2*60*60*1000).toISOString()).order("starts_at"),
    sb.from("event_photos").select("id,event_id,user_id,path,created_at,events(title)").eq("moderation_status","pending").order("created_at").limit(50),
    sb.from("quest_claims").select("id,quest_id,user_id,event_id,evidence,claimed_at,quests(title)").eq("status","pending").order("claimed_at").limit(100),
    sb.from("reports").select("id,kind,ref_id,excerpt,reason,created_at,reviewed_at").is("reviewed_at",null).order("created_at",{ascending:false}).limit(100),
    sb.from("game_drops").select("id,title,area,opens_at,closes_at,active,claimed_count,max_claims").order("created_at",{ascending:false}).limit(100),
    sb.from("partners").select("id,name,active").order("name"),
    sb.from("game_score_rules").select("key,score").order("key"),
  ]);
  const pendingPhotos=await Promise.all(((photos.data??[]) as {id:string;event_id:string;user_id:string;path:string;created_at:string;events:unknown}[]).map(async p=>{const {data}=await sb.storage.from("event-photos").createSignedUrl(p.path,900);return {...p,url:data?.signedUrl??null};}));
  return NextResponse.json({events:events.data??[],liveEvents:liveEvents.data??[],photos:pendingPhotos,claims:claims.data??[],reports:reports.data??[],drops:drops.data??[],partners:partners.data??[],rules:rules.data??[]});
}

export async function POST(req:Request){
  if(!authorized(req))return bad("Unauthorized",401);const sb=adminClient();if(!sb)return bad("Admin service is not configured",503);
  let b:Record<string,unknown>;try{b=await req.json();}catch{return bad("Invalid JSON");}
  const action=String(b.action??"");
  if(action==="review_event"){
    if(typeof b.id!=="string"||!(b.status==="live"||b.status==="rejected"))return bad("Event review needs an ID and valid status");
    const patch:Record<string,unknown>={status:b.status};if(b.status==="live"){
      if(typeof b.lat!=="number"||typeof b.lng!=="number"||!Number.isFinite(b.lat)||!Number.isFinite(b.lng)||b.lat<6.3||b.lat>6.8||b.lng<3.05||b.lng>3.95)return bad("Set a verified Lagos venue coordinate before approving this event");
      patch.geog=`SRID=4326;POINT(${b.lng} ${b.lat})`;
    }
    const {error}=await sb.from("events").update(patch).eq("id",b.id);if(error)return bad(error.message,500);return NextResponse.json({ok:true});
  }
  if(action==="review_photo"){
    if(typeof b.id!=="string"||!(b.status==="approved"||b.status==="rejected"))return bad("Photo review needs an ID and valid status");
    const {error}=await sb.from("event_photos").update({moderation_status:b.status,hidden:b.status==="rejected"}).eq("id",b.id);if(error)return bad(error.message,500);return NextResponse.json({ok:true});
  }
  if(action==="review_quest"){
    if(typeof b.id!=="string"||typeof b.approve!=="boolean")return bad("Quest review needs an ID and decision");
    const {data,error}=await sb.rpc("admin_review_quest_claim",{p_claim:b.id,p_approve:b.approve});if(error)return bad(error.message,500);if(!data)return bad("Quest claim already reviewed",409);return NextResponse.json({ok:true});
  }
  if(action==="resolve_report"){
    if(typeof b.id!=="string")return bad("Report ID required");const {error}=await sb.from("reports").update({reviewed_at:new Date().toISOString()}).eq("id",b.id);if(error)return bad(error.message,500);return NextResponse.json({ok:true});
  }
  if(action==="save_quest"){
    if(typeof b.key!=="string"||typeof b.title!=="string"||!(["checkin","photo","qr","insight","group"].includes(String(b.quest_type))))return bad("Quest needs a key, title and supported type");
    const row={key:b.key.slice(0,80),title:b.title.slice(0,100),description:String(b.description??"").slice(0,500),quest_type:b.quest_type,event_id:typeof b.event_id==="string"&&b.event_id?b.event_id:null,starts_at:typeof b.starts_at==="string"?b.starts_at:new Date().toISOString(),ends_at:typeof b.ends_at==="string"&&b.ends_at?b.ends_at:null,repeat_period:["once","daily","weekly","monthly"].includes(String(b.repeat_period))?b.repeat_period:"once",xp_reward:Math.min(10000,Math.max(0,Number(b.xp_reward)||0)),badge_key:typeof b.badge_key==="string"&&b.badge_key?b.badge_key:null,group_size:Math.min(100,Math.max(2,Number(b.group_size)||2)),active:b.active!==false};
    const {data,error}=await sb.from("quests").upsert(row,{onConflict:"key"}).select("id,key,title").single();if(error)return bad(error.message,500);
    let verificationCode: string|undefined;
    if(row.badge_key)await sb.from("badge_catalog").upsert({key:row.badge_key,name:row.title,icon:"✨",description:row.description},{onConflict:"key"});
    if(row.quest_type==="qr"||row.quest_type==="insight") { verificationCode=typeof b.code==="string"&&b.code.trim()?b.code.trim():randomBytes(10).toString("hex");const {error:codeError}=await sb.from("quest_codes").insert({quest_id:data.id,code_hash:hash(verificationCode),valid_from:row.starts_at,valid_until:row.ends_at});if(codeError)return bad(codeError.message,500); }
    return NextResponse.json({quest:data,verification_code:verificationCode});
  }
  if(action==="save_partner"){
    if(typeof b.name!=="string"||b.name.trim().length<2)return bad("Partner name required");const {data,error}=await sb.from("partners").insert({name:b.name.trim().slice(0,100),description:String(b.description??"").slice(0,500),website:typeof b.website==="string"?b.website:null,logo_url:typeof b.logo_url==="string"?b.logo_url:null,active:true}).select("id,name").single();if(error)return bad(error.message,500);return NextResponse.json({partner:data});
  }
  if(action==="create_drop"){
    if(typeof b.title!=="string"||typeof b.opens_at!=="string"||typeof b.closes_at!=="string")return bad("Drop title and opening/closing times required");
    if(!b.reward||typeof b.reward!=="object")return bad("Add at least one reward before creating a drop");
    const opensAt=validDate(b.opens_at),closesAt=validDate(b.closes_at);if(!opensAt||!closesAt||new Date(closesAt)<=new Date(opensAt))return bad("Drop close time must be after its opening time");
    const initialReward=b.reward as Record<string,unknown>;if(!( ["xp","badge","discount","upgrade","ticket","collectible"].includes(String(initialReward.type)))||typeof initialReward.title!=="string"||!initialReward.title.trim())return bad("Add a valid reward type and title");
    const eventId=typeof b.event_id==="string"&&b.event_id?b.event_id:null;const hasCoords=String(b.lat??"").trim()!==""&&String(b.lng??"").trim()!=="";const lat=Number(b.lat),lng=Number(b.lng);const geog=hasCoords&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?`SRID=4326;POINT(${lng} ${lat})`:null;if(!eventId&&!geog)return bad("Choose an event or set a drop location");
    const row={title:b.title.slice(0,100),description:String(b.description??"").slice(0,500),partner_id:typeof b.partner_id==="string"&&b.partner_id?b.partner_id:null,event_id:eventId,area:typeof b.area==="string"?b.area:null,geog,opens_at:opensAt,closes_at:closesAt,radius_m:Math.min(5000,Math.max(25,Number(b.radius_m)||250)),claim_method:["proximity","qr","either"].includes(String(b.claim_method))?b.claim_method:"either",max_claims:b.max_claims?Math.max(1,Number(b.max_claims)):null,reward_model:b.reward_model==="random"?"random":"fixed",active:true};
    const {data,error}=await sb.from("game_drops").insert(row).select("id,title").single();if(error)return bad(error.message,500);
    const r=initialReward;const {data:reward,error:rewardError}=await sb.from("drop_rewards").insert({drop_id:data.id,reward_type:r.type,title:String(r.title).slice(0,100),description:String(r.description??"").slice(0,500),quantity:r.quantity==null||String(r.quantity).trim()===""?null:Math.max(0,Number(r.quantity)||0),weight:Math.max(0.01,Number(r.weight)||1),xp_amount:Math.max(0,Number(r.xp_amount)||0),badge_key:typeof r.badge_key==="string"?r.badge_key:null,collectible_id:typeof r.collectible_id==="string"?r.collectible_id:null}).select("id").single();if(rewardError){await sb.from("game_drops").update({active:false}).eq("id",data.id);return bad(rewardError.message,500);}if(Array.isArray(r.codes)&&reward){const rows=(r.codes as unknown[]).filter((x):x is string=>typeof x==="string"&&x.length<160).map(code=>({reward_id:reward.id,code}));if(rows.length){const {error:codesError}=await sb.from("drop_reward_codes").insert(rows);if(codesError){await sb.from("game_drops").update({active:false}).eq("id",data.id);return bad(codesError.message,500);}}}
    let qrCode:string|undefined;if(row.claim_method!=="proximity"){qrCode=randomBytes(12).toString("hex");const {error:qrError}=await sb.from("drop_qr_codes").insert({drop_id:data.id,code_hash:hash(qrCode),valid_from:row.opens_at,valid_until:row.closes_at,max_uses:row.max_claims??500});if(qrError){await sb.from("game_drops").update({active:false}).eq("id",data.id);return bad(qrError.message,500);}}
    return NextResponse.json({drop:data,qr_code:qrCode});
  }
  if(action==="place_hunt"){
    // Hide one of the 3D collectibles at an event: found by camera, claimed on location, QR as the fallback.
    const item=huntItem(typeof b.hunt_item==="string"?b.hunt_item:null);if(!item)return bad("Pick one of the five hunt items");
    if(typeof b.event_id!=="string"||!b.event_id)return bad("Pick the event to hide it at");
    const {data:ev,error:evError}=await sb.from("events").select("id,title,starts_at,ends_at,status").eq("id",b.event_id).single();if(evError||!ev)return bad("Event not found",404);if(ev.status!=="live")return bad("Only live events can hold a hunt");
    const start=new Date(ev.starts_at).getTime(),end=ev.ends_at?new Date(ev.ends_at).getTime():start+8*3.6e6;
    const opensAt=validDate(b.opens_at)??new Date(start-3.6e6).toISOString(),closesAt=validDate(b.closes_at)??new Date(end+3.6e6).toISOString();if(new Date(closesAt)<=new Date(opensAt))return bad("Close time must be after the opening time");
    const xp=b.xp_amount==null||String(b.xp_amount).trim()===""?item.xp:Math.min(10000,Math.max(0,Number(b.xp_amount)||0));
    const row={title:`Find the ${item.name}`,description:item.blurb,partner_id:typeof b.partner_id==="string"&&b.partner_id?b.partner_id:null,event_id:ev.id,opens_at:opensAt,closes_at:closesAt,radius_m:Math.min(5000,Math.max(25,Number(b.radius_m)||150)),claim_method:"either",max_claims:b.max_claims?Math.max(1,Number(b.max_claims)):null,reward_model:"fixed",hunt_item:item.key,active:true};
    const {data:drop,error}=await sb.from("game_drops").insert(row).select("id,title").single();if(error)return bad(error.message,500);
    const {data:collectible}=await sb.from("collectibles").select("id").eq("key",item.key).maybeSingle();
    const {error:rewardError}=await sb.from("drop_rewards").insert({drop_id:drop.id,reward_type:"collectible",title:item.name,description:`${item.blurb} +${xp} XP`,xp_amount:xp,collectible_id:collectible?.id??null});
    if(rewardError){await sb.from("game_drops").update({active:false}).eq("id",drop.id);return bad(rewardError.message,500);}
    const qrCode=randomBytes(12).toString("hex");const {error:qrError}=await sb.from("drop_qr_codes").insert({drop_id:drop.id,code_hash:hash(qrCode),valid_from:opensAt,valid_until:closesAt,max_uses:row.max_claims??500});if(qrError){await sb.from("game_drops").update({active:false}).eq("id",drop.id);return bad(qrError.message,500);}
    return NextResponse.json({drop,qr_code:qrCode,event:ev.title});
  }
  if(action==="add_drop_reward"){
    if(typeof b.drop_id!=="string"||typeof b.title!=="string"||!(["xp","badge","discount","upgrade","ticket","collectible"].includes(String(b.type))))return bad("Reward type, title and drop required");
    const {data:reward,error}=await sb.from("drop_rewards").insert({drop_id:b.drop_id,reward_type:b.type,title:b.title.slice(0,100),description:String(b.description??"").slice(0,500),quantity:b.quantity==null||String(b.quantity).trim()===""?null:Math.max(0,Number(b.quantity)||0),weight:Math.max(0.01,Number(b.weight)||1),xp_amount:Math.max(0,Number(b.xp_amount)||0),badge_key:typeof b.badge_key==="string"?b.badge_key:null,collectible_id:typeof b.collectible_id==="string"?b.collectible_id:null}).select("id").single();
    if(error)return bad(error.message,500);
    if(Array.isArray(b.codes)){const rows=(b.codes as unknown[]).filter((x):x is string=>typeof x==="string"&&x.length<160).map(code=>({reward_id:reward.id,code}));if(rows.length){const {error:codeError}=await sb.from("drop_reward_codes").insert(rows);if(codeError)return bad(codeError.message,500);}}
    return NextResponse.json({reward});
  }
  if(action==="set_score_rule"){
    if(typeof b.key!=="string")return bad("Rule key required");const {error}=await sb.from("game_score_rules").upsert({key:b.key,score:Math.min(10000,Math.max(0,Number(b.score)||0)),updated_at:new Date().toISOString()},{onConflict:"key"});if(error)return bad(error.message,500);return NextResponse.json({ok:true});
  }
  return bad("Unknown admin action");
}
