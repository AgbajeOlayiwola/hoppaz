"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { areaByName } from "./geo";
import type { Profile } from "./types";

export type CrewMember = Profile & { lat: number; lng: number; initial: string };

function place(p: Profile): CrewMember {
  // Friends with no home area, or one the app does not know, stay in the list: they just have no area line.
  const a = areaByName(p.area) ?? { lat: 6.5244, lng: 3.3792 };
  return {
    ...p,
    // Offset so two Hoppers in the same area do not stack into one dot.
    lat: a.lat + (hash(p.id) % 17) / 2200 - 0.0035,
    lng: a.lng + (hash(p.id + "x") % 17) / 2200 - 0.0035,
    initial: (p.display_name || "H")[0].toUpperCase(),
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function useCrew(userId: string | null) {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) {
      setCrew([]);
      return;
    }
    setLoading(true);
    const { data } = await sb
      .from("crew")
      .select("friend:profiles!crew_friend_id_fkey(id, display_name, area, xp, is_admin, avatar)")
      .eq("user_id", userId);
    setLoading(false);
    const rows = ((data ?? []) as unknown as { friend: Profile }[])
      .map((r) => r.friend)
      .filter(Boolean)
      .map(place);
    setCrew(rows);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(
    async (friendId: string) => {
      const sb = getSupabase();
      if (!sb || !userId || friendId === userId) return false;
      const { error } = await sb.from("crew").insert({ user_id: userId, friend_id: friendId });
      if (!error) await load();
      return !error;
    },
    [userId, load]
  );

  const remove = useCallback(
    async (friendId: string) => {
      const sb = getSupabase();
      if (!sb || !userId) return;
      await sb.from("crew").delete().eq("user_id", userId).eq("friend_id", friendId);
      await load();
    },
    [userId, load]
  );

  const search = useCallback(async (q: string): Promise<Profile[]> => {
    const sb = getSupabase();
    if (!sb || q.trim().length < 2) return [];
    const { data } = await sb
      .from("profiles")
      .select("id, display_name, area, xp, is_admin, avatar")
      .ilike("display_name", `%${q.trim()}%`)
      .not("display_name", "is", null)
      .limit(12);
    return (data ?? []) as Profile[];
  }, []);

  return { crew, loading, add, remove, search, reload: load };
}
