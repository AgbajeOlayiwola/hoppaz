import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/**
 * Daily (vercel.json): event rooms are deleted for good three days after the
 * event. The database deletes the messages and
 * hands back their picture paths; Storage files can only be removed from here.
 * Vercel Cron sends Authorization: Bearer $CRON_SECRET.
 */
export async function GET(req:Request){
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Not allowed"},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const service=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!service)return NextResponse.json({error:"Not configured"},{status:503});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.rpc("purge_expired_rooms");
  if(error)return NextResponse.json({error:error.message},{status:500});
  const paths=((data??[]) as {path:string}[]).map(r=>r.path).filter(Boolean);
  // The messages are already gone, so a failed file removal only leaves an unreachable file: log it, carry on.
  for(let i=0;i<paths.length;i+=100){const {error:rm}=await admin.storage.from("chat-images").remove(paths.slice(i,i+100));if(rm)console.warn("[hoppaz] purge: could not remove pictures:",rm.message);}
  return NextResponse.json({ok:true,pictures:paths.length});
}
