"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { loadCollection, loadDropReceipts, type Collectible, type DropReceipt } from "@/lib/useCollectibles";

type Entry = { drop_id: string; collected_at: string; event_title: string; collectible: Collectible };

export default function CollectionPage() {
  const { userId } = useSession();
  const [items, setItems] = useState<Entry[]>([]);
  const [receipts,setReceipts]=useState<DropReceipt[]>([]);
  useEffect(() => { let live = true; void Promise.all([loadCollection(userId),loadDropReceipts(userId)]).then(([rows,claims]) => { if (live) {setItems(rows);setReceipts(claims);} }); return () => { live = false; }; }, [userId]);
  return <div className="h-full overflow-y-auto px-4 pb-6">
    <header className="pad-top flex items-center gap-3 pb-5"><Link href="/me" aria-label="Back to profile" className="grid h-9 w-9 place-items-center rounded border border-line"><ArrowLeft size={16}/></Link><div><h1 className="font-display text-2xl font-black leading-none">Found on the map</h1><p className="seclabel mt-1.5">Your event collection · {items.length} found</p></div></header>
    {items.length===0&&receipts.length===0&&<div className="card"><p className="font-display font-black">Your collection starts out here.</p><p className="hint mt-1">Look for event collectibles or live partner drops when you are nearby. Each claim is tied to a real place and can be collected once.</p><Link href="/" className="mt-4 inline-block border-b border-orange pb-px font-mono text-[9px] font-bold tracking-widest text-orange">OPEN THE MAP →</Link></div>}
    {items.length>0&&<><p className="seclabel mb-2">EVENT COLLECTIBLES · {items.length}</p><div className="mb-5 grid grid-cols-2 gap-2">{items.map((item) => <article key={item.drop_id} className="card p-3"><div className="grid h-16 place-items-center rounded bg-violet/10 text-4xl">{item.collectible.emoji}</div><h2 className="mt-2 font-display text-sm font-black">{item.collectible.name}</h2><p className="hint mt-1">{item.collectible.description}</p><p className="mt-3 border-t border-line pt-2 font-mono text-[8px] font-bold uppercase tracking-wider text-orange">{item.event_title}</p></article>)}</div></>}
    {receipts.length>0&&<><p className="seclabel mb-2">LIVE DROP REWARDS · {receipts.length}</p>{receipts.map(r=><article key={r.drop_id} className="card mb-2 p-3"><p className="seclabel text-orange">{r.partner??"HOPPAZ"} · {r.title}</p><h2 className="mt-1 font-display text-lg font-black">{r.reward}</h2><p className="hint mt-1">{r.description}</p>{r.code&&<p className="mt-2 select-all break-all rounded bg-ink p-2 font-mono text-xs">{r.code}</p>}<p className="hint mt-2">{new Date(r.claimed_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})}</p></article>)}</>}
  </div>;
}
