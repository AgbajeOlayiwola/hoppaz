import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const GENDERS=new Set(["female","male","other"]);

/**
 * Turns the Hopper's anonymous user into an account: same user id, so XP,
 * badges, check-ins and chats come along. Name, email and password only (gender is optional here and asked later);
 * everything else is asked for later, a bit at a time. Done here with the
 * service role so it takes effect at once, without a confirmation email.
 */
export async function POST(req:Request){
  const bearer=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;const service=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anon||!service)return NextResponse.json({error:"Accounts are not configured"},{status:503});
  if(!bearer)return NextResponse.json({error:"Session expired, reload and try again"},{status:401});
  const body=await req.json().catch(()=>null) as {name?:unknown;email?:unknown;password?:unknown;gender?:unknown}|null;
  const name=typeof body?.name==="string"?body.name.trim().slice(0,24):"";
  const email=typeof body?.email==="string"?body.email.trim().toLowerCase():"";
  const password=typeof body?.password==="string"?body.password:"";
  const gender=typeof body?.gender==="string"&&GENDERS.has(body.gender)?body.gender:null;
  if(!name)return NextResponse.json({error:"Add your name"},{status:400});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200)return NextResponse.json({error:"That email doesn't look right"},{status:400});
  if(password.length<8||password.length>72)return NextResponse.json({error:"Use at least 8 characters for the password"},{status:400});

  const userClient=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${bearer}`}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();if(authError||!user)return NextResponse.json({error:"Session expired, reload and try again"},{status:401});
  if(user.email)return NextResponse.json({error:"You already have an account"},{status:409});

  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await admin.auth.admin.updateUserById(user.id,{email,password,email_confirm:true,user_metadata:{name}});
  if(error){
    const taken=/already|exists|registered|duplicate|unique/i.test(error.message);
    return NextResponse.json({error:taken?"That email already has an account. Log in instead.":"Could not create the account"},{status:taken?409:500});
  }
  const [profile,details]=await Promise.all([
    admin.from("profiles").update({display_name:name}).eq("id",user.id),
    admin.from("profile_private").upsert({user_id:user.id,gender,account_at:new Date().toISOString(),updated_at:new Date().toISOString()}),
  ]);
  if(profile.error||details.error)console.warn("[hoppaz] account created, details not saved:",profile.error?.message??details.error?.message);
  return NextResponse.json({ok:true});
}
