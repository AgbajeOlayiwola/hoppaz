"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Camera, MapPin, QrCode, Sparkles } from "lucide-react";
import QrScanner from "@/components/QrScanner";
import { useHoppaz, useToast } from "@/lib/store";
import { useGameDrops } from "@/lib/game";

type Reveal={reward:string;description:string;code?:string;xp?:number};
export default function DropsPage(){
  const {fix}=useHoppaz();const {drops,busy,claim}=useGameDrops();const say=useToast(s=>s.say);
  const [codes,setCodes]=useState<Record<string,string>>({});const [scanning,setScanning]=useState<string|null>(null);const [revealed,setRevealed]=useState<Record<string,Reveal>>({});
  return <div className="h-full overflow-y-auto px-4 pb-6">
    <header className="pad-top flex items-center gap-3 pb-5"><Link href="/" aria-label="Back to map" className="grid h-9 w-9 place-items-center rounded border border-line"><ArrowLeft size={16}/></Link><div><h1 className="font-display text-2xl font-black">Live drops</h1><p className="seclabel mt-1.5">Real-world rewards around Lagos</p></div></header>
    {!drops.length&&<p className="hint">No drops are live right now. Check back when a Hoppaz event or neighborhood partner opens one.</p>}
    {drops.map(d=><article key={d.id} className="card mb-3 border-violet/60">
      <div className="flex items-start gap-3"><span className="grid h-11 w-11 flex-none place-items-center rounded bg-violet/20 text-violet"><Sparkles size={22}/></span><div className="min-w-0 flex-1"><p className="seclabel text-[#A98CFF]">{d.partner?.name??"HOPPAZ DROP"}</p><h2 className="font-display text-lg font-black">{d.title}</h2><p className="hint">{d.description}</p><p className="mt-2 flex items-center gap-1 font-mono text-[9px] font-bold uppercase text-dim"><MapPin size={12}/>{d.area??"Event location"} · opens {new Date(d.opens_at).toLocaleString("en-NG",{dateStyle:"short",timeStyle:"short"})}</p><p className="mt-1 flex items-center gap-1 font-mono text-[9px] text-dim"><QrCode size={12}/>{d.claim_method==="proximity"?"Claim near the location":d.claim_method==="qr"?"Scan or enter the venue QR":"Claim nearby or scan the venue QR"} · {d.reward_model==="random"?"sponsor-selected reward pool":"surprise reward"}</p></div></div>
      {revealed[d.id]?<div className="mt-4 rounded border border-orange p-3"><p className="seclabel text-orange">YOU GOT</p><p className="mt-1 font-display text-xl font-black">{revealed[d.id].reward}</p><p className="hint mt-1">{revealed[d.id].description}{revealed[d.id].xp?` · +${revealed[d.id].xp} XP`:""}</p>{revealed[d.id].code&&<p className="mt-2 break-all rounded bg-ink p-2 font-mono text-xs">{revealed[d.id].code}</p>}</div>:<>
        {d.claim_method!=="proximity"&&<div className="mt-3 flex gap-2"><input placeholder="QR code" value={codes[d.id]??""} onChange={e=>setCodes({...codes,[d.id]:e.target.value})}/><button type="button" className="btn btn-ghost flex-none px-3" onClick={()=>setScanning(d.id)} aria-label="Scan QR"><Camera size={15}/></button></div>}
        <button disabled={busy===d.id} className="btn mt-3 w-full" onClick={async()=>{const result=await claim(d,fix,codes[d.id]);if(result.error){say(result.error);return;}setRevealed({...revealed,[d.id]:result as Reveal});say("DROP CLAIMED · REWARD REVEALED","violet");}}>{busy===d.id?"OPENING…":"CLAIM MYSTERY DROP"}</button>
      </>}
    </article>)}
    {scanning&&<QrScanner onRead={value=>{setCodes({...codes,[scanning]:value});setScanning(null);say("QR CODE READ","violet")}} onClose={()=>setScanning(null)}/>}
  </div>;
}
