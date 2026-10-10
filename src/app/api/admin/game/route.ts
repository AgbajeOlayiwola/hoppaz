import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { huntItem } from "@/lib/huntItems";
import { hotspotAction, hotspotsData } from "./hotspots";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function adminClient():SupabaseClient|null{const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;}
function authorized(req:Request){const secret=process.env.HOPPAZ_ADMIN_TOKEN??"";const received=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");if(!secret||!received)return false;const a=Buffer.from(secret);const b=Buffer.from(received);return a.length===b.length&&timingSafeEqual(a,b);}
function hash(value:string){return createHash("sha256").update(value).digest("hex");}
const bad=(message:string,status=400)=>NextResponse.json({error:message},{status});
function validDate(value:unknown):string|null{if(typeof value!=="string"||!value)return null;const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString():null;}

// Street box spawner helpers (supabase/spawning.sql).
const SPOT_KINDS=["street","park","run","beach","landmark","market","venue"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
function num(v:unknown){return typeof v==="number"||(typeof v==="string"&&v.trim()!=="")?Number(v):NaN;}
function whole(v:unknown,min:number,max:number){const n=num(v);return Number.isInteger(n)&&n>=min&&n<=max?n:null;}
/** "HH:MM" to minutes after midnight (0..1439); a missing value takes the fallback. */
function minuteOf(v:unknown,fallback:string){const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v==null||v===""?fallback:v).trim());return m?Number(m[1])*60+Number(m[2]):null;}
function lagosPoint(lat:unknown,lng:unknown){const la=num(lat),lo=num(lng);return Number.isFinite(la)&&Number.isFinite(lo)&&la>=6.3&&la<=6.8&&lo>=3.05&&lo<=3.95?{lat:la,lng:lo}:null;}
const SPAWN_LIVE_COLUMNS="id,title,area,kind,closes_at,claimed_count,max_claims";

/** Validates a whole rule (a save replaces every field; missing ones take the table default) and turns it into a row. */
async function parseRule(sb:SupabaseClient,b:Record<string,unknown>):Promise<{row:Record<string,unknown>}|{error:string}>{
  const name=typeof b.name==="string"?b.name.trim():"";if(name.length<2||name.length>80)return {error:"Rule name needs 2 to 80 characters"};
  const kinds=Array.isArray(b.kinds)?[...new Set(b.kinds.map(String))]:[];if(!kinds.length||!kinds.every(k=>SPOT_KINDS.includes(k)))return {error:"Pick at least one valid spot kind"};
  const days=Array.isArray(b.days)?[...new Set(b.days.map(Number))].sort((x,y)=>x-y):[];if(!days.length||!days.every(d=>Number.isInteger(d)&&d>=1&&d<=7))return {error:"Pick at least one day"};
  const start=minuteOf(b.start,"07:00"),end=minuteOf(b.end,"21:00"),nightFrom=minuteOf(b.night_from,"21:00"),nightUntil=minuteOf(b.night_until,"06:00");
  if(start===null||end===null||nightFrom===null||nightUntil===null)return {error:"Times need the form HH:MM"};
  const every=whole(b.every_minutes??30,5,1440);if(every===null)return {error:"Run every 5 to 1440 minutes"};
  const wave=whole(b.boxes_per_wave??3,1,50);if(wave===null)return {error:"Boxes per wave: 1 to 50"};
  const life=whole(b.lifetime_minutes??30,5,1440);if(life===null)return {error:"Box life: 5 to 1440 minutes"};
  const claims=whole(b.max_claims??5,1,1000);if(claims===null)return {error:"First how many: 1 to 1000"};
  const radius=whole(b.radius_m??80,25,500);if(radius===null)return {error:"Radius: 25 to 500 metres"};
  if(b.reward_model!=null&&b.reward_model!=="fixed"&&b.reward_model!=="random")return {error:"Reward model is fixed or random"};
  if(b.active!=null&&typeof b.active!=="boolean")return {error:"Active is true or false"};
  let areas:string[]|null=null;
  if(b.areas!=null){
    if(!Array.isArray(b.areas))return {error:"Areas must be a list"};
    const list=[...new Set(b.areas.map(String))];
    if(list.length){const {data,error}=await sb.from("areas").select("name").in("name",list);if(error)return {error:error.message};const known=new Set((data??[]).map(a=>a.name as string));const unknown=list.filter(a=>!known.has(a));if(unknown.length)return {error:`Unknown area: ${unknown.join(", ")}`};areas=list;}
  }
  if(!Array.isArray(b.rewards)||!b.rewards.length||b.rewards.length>20)return {error:"Add 1 to 20 rewards"};
  const rewards:Record<string,unknown>[]=[];
  for(const raw of b.rewards){
    const r=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
    const type=String(r.type);if(!["xp","badge","collectible"].includes(type))return {error:"A street box can pay XP, a badge or a collectible"};
    const title=String(r.title??"").trim();if(!title||title.length>100)return {error:"Every reward needs a title (100 characters max)"};
    const xp=r.xp_amount==null||r.xp_amount===""?0:whole(r.xp_amount,0,10000);if(xp===null)return {error:"XP amount: 0 to 10000"};
    if(type==="xp"&&xp<1)return {error:"An XP reward needs an XP amount"};
    const weight=r.weight==null||r.weight===""?1:num(r.weight);if(!(weight>=0.01&&weight<=10000))return {error:"Reward weight: 0.01 to 10000"};
    const item:Record<string,unknown>={type,title,xp_amount:xp,weight};
    const description=String(r.description??"").trim();if(description)item.description=description.slice(0,500);
    if(r.quantity!=null&&r.quantity!==""){const q=whole(r.quantity,1,100000);if(q===null)return {error:"Reward stock: 1 to 100000"};item.quantity=q;}
    if(type==="badge"){const key=String(r.badge_key??"").trim();if(!/^[a-z0-9][a-z0-9_-]{0,59}$/i.test(key))return {error:"A badge reward needs a badge key"};item.badge_key=key;}
    if(type==="collectible"){const key=String(r.collectible_key??"").trim();if(!/^[a-z0-9][a-z0-9_-]{0,59}$/i.test(key))return {error:"A collectible reward needs a collectible key"};item.collectible_key=key;}
    rewards.push(item);
  }
  // spawn_boxes quietly skips rewards it cannot pay, so refuse unknown keys here.
  const badgeKeys=rewards.filter(r=>r.type==="badge").map(r=>r.badge_key as string),collectibleKeys=rewards.filter(r=>r.type==="collectible").map(r=>r.collectible_key as string);
  if(badgeKeys.length){const {data}=await sb.from("badge_catalog").select("key").in("key",badgeKeys);const known=new Set((data??[]).map(x=>x.key as string));const missing=badgeKeys.find(k=>!known.has(k));if(missing)return {error:`Unknown badge key: ${missing}`};}
  if(collectibleKeys.length){const {data}=await sb.from("collectibles").select("key").in("key",collectibleKeys);const known=new Set((data??[]).map(x=>x.key as string));const missing=collectibleKeys.find(k=>!known.has(k));if(missing)return {error:`Unknown collectible key: ${missing}`};}
  const row:Record<string,unknown>={name,areas,kinds,days,start_minute:start,end_minute:end,every_minutes:every,boxes_per_wave:wave,lifetime_minutes:life,max_claims:claims,radius_m:radius,night_from_minute:nightFrom,night_until_minute:nightUntil,reward_model:b.reward_model??"random",rewards};
  if(typeof b.active==="boolean")row.active=b.active;
  return {row};
}

/** Street box drops without game_drops.kind (a database that has not run spawning.sql yet) show every drop. */
async function staffDrops(sb:SupabaseClient){const q=()=>sb.from("game_drops").select("id,title,area,opens_at,closes_at,active,claimed_count,max_claims").order("created_at",{ascending:false}).limit(100);const r=await q().eq("kind","staff");return r.error?.code==="42703"?await q():r;}

/** Everything the Box spawner section needs. A database without spawning.sql gets an error note, not a broken desk. */
async function spawnerData(sb:SupabaseClient){
  const now=new Date().toISOString();
  const [summary,rules,zones,spawn,welcome,areas]=await Promise.all([
    sb.rpc("spawner_summary"),
    sb.from("spawn_rules").select("*").order("name"),
    sb.from("no_spawn_zones").select("id,name,reason,active,source").order("source",{ascending:false}).order("created_at",{ascending:false}).limit(200),
    sb.from("game_drops").select(SPAWN_LIVE_COLUMNS).eq("kind","spawn").eq("active",true).gt("closes_at",now).order("created_at",{ascending:false}).limit(100),
    // Welcome boxes are one per new Hopper; a small slice keeps them from burying the street boxes.
    sb.from("game_drops").select(SPAWN_LIVE_COLUMNS).eq("kind","welcome").eq("active",true).gt("closes_at",now).order("created_at",{ascending:false}).limit(20),
    sb.from("areas").select("name").order("name"),
  ]);
  const failed=[summary,rules,zones,spawn,welcome,areas].find(r=>r.error);
  if(failed?.error)return {summary:null,rules:[],zones:[],live:[],areas:[],error:failed.error.message};
  return {summary:summary.data,rules:rules.data??[],zones:zones.data??[],live:[...(spawn.data??[]),...(welcome.data??[])],areas:(areas.data??[]).map(a=>a.name as string)};
}

export async function GET(req:Request){
  if(!authorized(req))return bad("Unauthorized",401);const sb=adminClient();if(!sb)return bad("Admin service is not configured",503);
  const [events,liveEvents,photos,claims,reports,drops,partners,rules]=await Promise.all([
    sb.from("events").select("id,title,venue_name,area,starts_at,ig_url,created_at").eq("status","pending").order("created_at"),
    sb.from("events").select("id,title,venue_name,area,starts_at").eq("status","live").gte("starts_at",new Date(Date.now()-2*60*60*1000).toISOString()).order("starts_at"),
    sb.from("event_photos").select("id,event_id,user_id,path,created_at,events(title)").eq("moderation_status","pending").order("created_at").limit(50),
    sb.from("quest_claims").select("id,quest_id,user_id,event_id,evidence,claimed_at,quests(title)").eq("status","pending").order("claimed_at").limit(100),
    sb.from("reports").select("id,kind,ref_id,excerpt,reason,created_at,reviewed_at").is("reviewed_at",null).order("created_at",{ascending:false}).limit(100),
    staffDrops(sb),
    sb.from("partners").select("id,name,active").order("name"),
    sb.from("game_score_rules").select("key,score").order("key"),
  ]);
  // Say what failed rather than showing empty queues (a bad service key fails every query).
  const failed=[events,liveEvents,photos,claims,reports,drops,partners,rules].find(r=>r.error);if(failed?.error)return bad(`Database error: ${failed.error.message}`,500);
  const pendingPhotos=await Promise.all(((photos.data??[]) as {id:string;event_id:string;user_id:string;path:string;created_at:string;events:unknown}[]).map(async p=>{const {data}=await sb.storage.from("event-photos").createSignedUrl(p.path,900);return {...p,url:data?.signedUrl??null};}));
  return NextResponse.json({events:events.data??[],liveEvents:liveEvents.data??[],photos:pendingPhotos,claims:claims.data??[],reports:reports.data??[],drops:drops.data??[],partners:partners.data??[],rules:rules.data??[],spawner:await spawnerData(sb),hotspots:await hotspotsData(sb)});
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
  if(action==="save_spawn_rule"){
    // One rule per call: with an id it replaces that rule's settings, without one it adds a rule (switched off unless active is true).
    if(b.id!=null&&b.id!==""&&!isId(b.id))return bad("Bad rule ID");
    const parsed=await parseRule(sb,b);if("error" in parsed)return bad(parsed.error);
    const res=isId(b.id)?await sb.from("spawn_rules").update(parsed.row).eq("id",b.id).select("id,name,active").maybeSingle():await sb.from("spawn_rules").insert(parsed.row).select("id,name,active").single();
    if(res.error)return res.error.code==="23505"?bad("A rule with that name already exists",409):bad(res.error.message,500);
    if(!res.data)return bad("Rule not found",404);return NextResponse.json({rule:res.data});
  }
  if(action==="toggle_spawn_rule"){
    if(!isId(b.id)||typeof b.active!=="boolean")return bad("Rule ID and on/off required");
    const {data,error}=await sb.from("spawn_rules").update({active:b.active}).eq("id",b.id).select("id").maybeSingle();if(error)return bad(error.message,500);if(!data)return bad("Rule not found",404);return NextResponse.json({ok:true});
  }
  if(action==="spawn_now"){
    // Ignores the rule's days, window and spacing (and works on a rule that is switched off). Without a rule it runs every active rule.
    const ruleId=b.rule_id==null||b.rule_id===""?null:b.rule_id;if(ruleId!==null&&!isId(ruleId))return bad("Bad rule ID");
    if(ruleId){const {data:rule,error:ruleError}=await sb.from("spawn_rules").select("id").eq("id",ruleId).maybeSingle();if(ruleError)return bad(ruleError.message,500);if(!rule)return bad("Rule not found",404);}
    const {data,error}=await sb.rpc("spawn_boxes",{p_rule:ruleId,p_force:true});if(error)return bad(error.message,500);return NextResponse.json({spawned:Number(data)||0});
  }
  if(action==="add_spawn_point"){
    const name=typeof b.name==="string"?b.name.trim():"";if(name.length<2||name.length>100)return bad("Spot name needs 2 to 100 characters");
    if(!SPOT_KINDS.includes(String(b.kind)))return bad("Pick a spot kind");
    const at=lagosPoint(b.lat,b.lng);if(!at)return bad("Spot must be inside Lagos (latitude 6.3 to 6.8, longitude 3.05 to 3.95)");
    if(b.night_safe!=null&&typeof b.night_safe!=="boolean")return bad("Night safe is true or false");
    // The area is filled in by a trigger: the nearest Lagos area within 5 km, else empty.
    const {data,error}=await sb.from("spawn_points").insert({name,kind:b.kind,geog:`SRID=4326;POINT(${at.lng} ${at.lat})`,night_safe:b.night_safe===true,source:"staff"}).select("id,name,area").single();if(error)return bad(error.message,500);return NextResponse.json({spot:data});
  }
  if(action==="toggle_spawn_point"){
    if(!isId(b.id)||typeof b.active!=="boolean")return bad("Spot ID and on/off required");
    const {data,error}=await sb.from("spawn_points").update({active:b.active}).eq("id",b.id).select("id").maybeSingle();if(error)return bad(error.message,500);if(!data)return bad("Spot not found",404);return NextResponse.json({ok:true});
  }
  if(action==="add_no_spawn_zone"){
    const name=typeof b.name==="string"?b.name.trim():"";if(name.length<2||name.length>100)return bad("Area name needs 2 to 100 characters");
    const at=lagosPoint(b.lat,b.lng);if(!at)return bad("Area must be inside Lagos (latitude 6.3 to 6.8, longitude 3.05 to 3.95)");
    const radius=whole(b.radius_m,25,5000);if(radius===null)return bad("Radius: 25 to 5000 metres");
    const {data,error}=await sb.rpc("add_no_spawn_zone",{p_name:name,p_reason:String(b.reason??"").trim().slice(0,200),p_lat:at.lat,p_lng:at.lng,p_radius_m:radius});if(error)return bad(error.message,500);return NextResponse.json({zone:{id:data}});
  }
  if(action==="toggle_no_spawn_zone"){
    if(!isId(b.id)||typeof b.active!=="boolean")return bad("Area ID and on/off required");
    const {data,error}=await sb.from("no_spawn_zones").update({active:b.active}).eq("id",b.id).select("id").maybeSingle();if(error)return bad(error.message,500);if(!data)return bad("Area not found",404);return NextResponse.json({ok:true});
  }
  if(action==="end_box"){
    // Street and welcome boxes only: closing a staff drop happens through its own tools.
    if(!isId(b.id))return bad("Box ID required");
    const {data,error}=await sb.from("game_drops").update({closes_at:new Date().toISOString()}).eq("id",b.id).in("kind",["spawn","welcome"]).select("id").maybeSingle();
    if(error)return error.code==="23514"?bad("That box only just opened. Try again in a second.",409):bad(error.message,500);
    if(!data)return bad("Street or welcome box not found",404);return NextResponse.json({ok:true});
  }
  if(action.startsWith("hotspot_")){
    // Hotspots (supabase/hotspots.sql): open, pause, slow mode, mutes, the word list. Closing a report is resolve_report above.
    const out=await hotspotAction(sb,action,b);if(out)return NextResponse.json(out.body,{status:out.status});
  }
  return bad("Unknown admin action");
}
