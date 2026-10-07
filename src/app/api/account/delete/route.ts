import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(req:Request){
  const bearer=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!bearer||!url||!anon||!service)return NextResponse.json({error:"Account deletion is not configured"},{status:503});
  const userClient=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${bearer}`}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();if(authError||!user)return NextResponse.json({error:"Session expired"},{status:401});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  // Remove the private photo objects and room messages before the identity cascades.
  const {data:dirs}=await admin.storage.from("event-photos").list(user.id,{limit:1000});
  const paths:string[]=[];for(const dir of dirs??[]){if(dir.id===null){const {data:files}=await admin.storage.from("event-photos").list(`${user.id}/${dir.name}`,{limit:1000});(files??[]).forEach(f=>{if(f.id!==null)paths.push(`${user.id}/${dir.name}/${f.name}`)});}else paths.push(`${user.id}/${dir.name}`);}
  if(paths.length){const {error}=await admin.storage.from("event-photos").remove(paths);if(error)return NextResponse.json({error:"Could not remove stored photos"},{status:500});}
  const {data:identities}=await admin.from("room_identities").select("id").eq("user_id",user.id);
  const keys=(identities??[]).map(x=>x.id);if(keys.length){const {error}=await admin.from("messages").delete().in("author_key",keys);if(error)return NextResponse.json({error:"Could not remove chat history"},{status:500});}
  const {error}=await admin.auth.admin.deleteUser(user.id);if(error)return NextResponse.json({error:"Could not delete account"},{status:500});
  return NextResponse.json({ok:true});
}
