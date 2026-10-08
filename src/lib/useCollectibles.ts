"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";

export type Collectible = { id: string; key: string; name: string; description: string; emoji: string; art_url: string | null };
export type CollectibleDrop = { id: string; event_id: string; collectible: Collectible };

/** Fetches a place's active collection drops and the current Hopper's claims. */
export function useEventCollectibles(eventId: string, userId: string | null) {
  const [drops, setDrops] = useState<CollectibleDrop[]>([]);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId || eventId.startsWith("demo-")) return;
    const [{ data: d }, { data: c }] = await Promise.all([
      sb.from("collectible_drops").select("id,event_id,collectible:collectibles!inner(id,key,name,description,emoji,art_url)").eq("event_id", eventId),
      sb.from("collections").select("drop_id").eq("user_id", userId),
    ]);
    setDrops((d ?? []) as unknown as CollectibleDrop[]);
    setClaimed(new Set((c ?? []).map((x) => x.drop_id)));
  }, [eventId, userId]);
  useEffect(() => { void reload(); }, [reload]);
  const collect = useCallback(async (dropId: string, fix: { lat: number; lng: number } | null) => {
    const sb = getSupabase();
    if (!sb || !fix) return "SET YOUR LOCATION FIRST";
    setBusy(dropId);
    const { data, error } = await sb.rpc("claim_collectible", { p_drop_id: dropId, p_lat: fix.lat, p_lng: fix.lng });
    setBusy(null);
    if (error) return "COULD NOT COLLECT";
    const result = data as { ok: boolean; reason?: string; name?: string };
    if (!result.ok) return result.reason === "too_far" ? "GET CLOSER TO THE EVENT" : result.reason === "already" ? "ALREADY IN YOUR COLLECTION" : "THIS COLLECTIBLE IS CLOSED";
    setClaimed((s) => new Set(s).add(dropId));
    return `${result.name?.toUpperCase() ?? "COLLECTIBLE"} ADDED TO YOUR COLLECTION`;
  }, []);
  return { drops, claimed, busy, collect, reload };
}

export type CollectionEntry = { drop_id: string; collected_at: string; event_title: string; collectible: Collectible };

/** The complete collection, including the event where each item was found. */
export async function loadCollection(userId: string | null) {
  const sb = getSupabase();
  if (!sb || !userId) return [] as CollectionEntry[];
  const { data } = await sb.from("collections").select("drop_id,collected_at,drop:collectible_drops!inner(event:events!inner(title),collectible:collectibles!inner(id,key,name,description,emoji,art_url))").eq("user_id", userId).order("collected_at", { ascending: false });
  return ((data ?? []) as unknown as { drop_id: string; collected_at: string; drop: { event: { title: string }; collectible: Collectible } }[]).map((r): CollectionEntry => ({ drop_id: r.drop_id, collected_at: r.collected_at, event_title: r.drop.event.title, collectible: r.drop.collectible }));
}

/** Event IDs with at least one configured collectible, for map discovery markers. */
export function useCollectibleEventIds(eventIds: string[]) {
  const [ids, setIds] = useState<string[]>([]);
  const key = eventIds.join(",");
  useEffect(() => {
    const currentEventIds = key ? key.split(",") : [];
    const sb = getSupabase();
    if (!sb || !currentEventIds.length || currentEventIds.every((id) => id.startsWith("demo-"))) { setIds([]); return; }
    let cancelled = false;
    void Promise.all([sb.from("collectible_drops").select("event_id").in("event_id", currentEventIds),sb.from("game_drops").select("event_id").in("event_id", currentEventIds).eq("active",true).gt("closes_at",new Date().toISOString())]).then(([legacy,live]) => {
      if (!cancelled) setIds([...new Set([...(legacy.data??[]),...(live.data??[])].map((row) => row.event_id).filter((id):id is string=>!!id))]);
    });
    return () => { cancelled = true; };
  }, [key]);
  return ids;
}

export type DropReceipt = { drop_id: string; title: string; partner: string | null; reward: string; description: string; code: string | null; claimed_at: string };
export async function loadDropReceipts(userId: string | null) {
  const sb=getSupabase();if(!sb||!userId)return [] as DropReceipt[];const {data}=await sb.rpc("my_drop_claims");return (data??[]) as DropReceipt[];
}
