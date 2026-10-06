"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { BADGES } from "./brand";
import { useToast } from "./store";
import type { CheckinClaim, EventRow } from "./types";

export const CHECKIN_RADIUS_M = 1500;

export function useCheckin(userId: string | null, onDone?: () => void) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const say = useToast((s) => s.say);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("checkins").select("event_id").eq("user_id", userId);
      if (!cancelled && data) setDone(new Set(data.map((r) => String(r.event_id))));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const checkIn = useCallback(
    async (event: EventRow, fix: { lat: number; lng: number } | null) => {
      if (!fix) {
        say("SET YOUR LOCATION FIRST");
        return;
      }
      const sb = getSupabase();
      if (!sb || !userId) {
        // Demo mode: let the loop be felt, but say it is not saved anywhere.
        setDone((s) => new Set(s).add(event.id));
        say("CHECKED IN (DEMO, NOT SAVED)");
        return;
      }
      setBusy(event.id);
      const { data, error } = await sb.rpc("claim_checkin", {
        p_event_id: event.id,
        p_lat: fix.lat,
        p_lng: fix.lng,
      });
      setBusy(null);
      if (error) {
        say("COULD NOT CHECK YOU IN, TRY AGAIN");
        return;
      }
      const res = data as CheckinClaim;
      if (!res.ok) {
        if (res.reason === "too_far") {
          say(`TOO FAR · ${Math.round((res.distance_m ?? 0) / 100) / 10} KM OUT`);
        } else if (res.reason === "already") {
          setDone((s) => new Set(s).add(event.id));
          say("ALREADY CHECKED IN HERE");
        } else {
          say("CHECK-IN NOT AVAILABLE");
        }
        return;
      }
      setDone((s) => new Set(s).add(event.id));
      const fresh = res.badges?.[0];
      if (fresh) {
        const b = BADGES.find((x) => x.key === fresh);
        say(`BADGE UNLOCKED · ${(b?.name ?? fresh).toUpperCase()}`, "violet");
      } else {
        say(`CHECKED IN · +${res.xp} XP`);
      }
      onDone?.();
    },
    [userId, say, onDone]
  );

  return { done, busy, checkIn };
}
