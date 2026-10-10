"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requireAccount } from "@/lib/accountGate";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import { claimDaily, enterHotspot, leaveHotspot, myHotspot, pulseHotspot, readRoom, POLL_MS, PULSE_MS, type Entered, type RoomState } from "./api";
import { demoEntered, demoRoom } from "./demo";
import type { Reward } from "./RewardMoment";

/** Where the screen is: asking the server, needs an account, needs the 18+ yes, shut, or in the room. */
export type Phase = { t: "loading" } | { t: "account" } | { t: "adult" } | { t: "closed"; reason: string } | { t: "in" };

/**
 * A leave waits a moment. A remount (React Strict Mode, or an avatar sent on to another room) starts with
 * enter_hotspot and cancels it, instead of a late leave taking the new visit out.
 */
let pendingLeave: ReturnType<typeof setTimeout> | null = null;
const cancelLeave = () => {
  if (pendingLeave) clearTimeout(pendingLeave);
  pendingLeave = null;
};

/**
 * Two starts at once (Strict Mode, or the session settling) share one enter_hotspot, so the call that makes the visit
 * is the one the screen hears about: a second call would answer "already here" and the arrival would pass in silence.
 */
const entering = new Map<string, Promise<Awaited<ReturnType<typeof enterHotspot>>>>();
function enterOnce(slug: string) {
  let p = entering.get(slug);
  if (!p) {
    p = enterHotspot(slug).finally(() => entering.delete(slug));
    entering.set(slug, p);
  }
  return p;
}

/**
 * Take the avatar out, but only once any enter_hotspot still on its way has landed: a leave that gets there first finds no
 * visit to remove, and the late enter then leaves a head nobody pulses (counted as "here" for 10 to 20 minutes).
 */
const leaveNow = () => Promise.allSettled([...entering.values()]).then(() => leaveHotspot());
const leaveSoon = () => {
  cancelLeave();
  pendingLeave = setTimeout(() => {
    pendingLeave = null;
    void leaveNow();
  }, 1500);
};

/**
 * One visit to a hotspot room, start to finish: the gates (account, then 18+), enter_hotspot, the keep-alive
 * pulse (about every 30 s) and the room read (about every 15 s) while the page is showing, rejoining if the
 * avatar faded, and the daily reward after the stay. Nothing here sends or reads a position.
 *
 * Closing the app does not leave on purpose: the pulse just stops and the head fades 10 to 20 minutes later
 * (a random time, so nobody can read the exact moment you went). Leaving the screen (Leave, the back arrow,
 * Play closing) does leave.
 */
export function useHotspotRoom(slug: string) {
  const { userId, state, refresh } = useSession();
  const say = useToast((s) => s.say);
  const [phase, setPhase] = useState<Phase>({ t: "loading" });
  const [entered, setEntered] = useState<Entered | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [reward, setReward] = useState<Reward | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The place's name before the server has let us in, for the gate cards and the title: "Jibowu", not "Yaba".
  const [known, setKnown] = useState<{ place: string; zone: string } | null>(null);
  // The avatar may be in this room: taking the screen away takes it out.
  const inside = useRef(false);
  // The avatar is in another room, put there from another screen of this account: leaving here must not take it out.
  const away = useRef(false);
  // When this phone's visit began, and whether the 5 minute stay has been paid.
  const since = useRef(0);
  const claimed = useRef(false);
  // Counts the times the avatar came back in after it faded, so the 5 minute stay is timed again from the new visit.
  const [visit, setVisit] = useState(0);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let dead = false;
    void sb.from("hotspots").select("name, junction").eq("slug", slug).maybeSingle().then(({ data }) => {
      if (dead || !data) return;
      // The same rule as the database's room name: "Lekki Phase 1 (Admiralty Way)" is "Lekki Phase 1".
      const place = String(data.junction ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || String(data.name);
      setKnown({ place, zone: String(data.name) });
    });
    return () => {
      dead = true;
    };
  }, [slug]);

  // The gates and the way in.
  useEffect(() => {
    cancelLeave();
    setPhase({ t: "loading" });
    claimed.current = false;
    away.current = false;
    if (!getSupabase()) {
      const e = demoEntered(slug);
      setEntered(e);
      setRoom(demoRoom(e));
      setPhase({ t: "in" });
      return;
    }
    if (!userId) return; // the session is still starting
    let dead = false;
    inside.current = true;
    void (async () => {
      const r = await enterOnce(slug);
      if (dead) return;
      if (!r.ok) {
        if (r.reason === "need_account") return setPhase({ t: "account" });
        if (r.reason === "need_adult") return setPhase({ t: "adult" });
        return setPhase({ t: "closed", reason: r.reason });
      }
      since.current = Date.now();
      setEntered(r);
      const rm = await readRoom(slug);
      if (dead) return;
      if (rm.ok) setRoom(rm);
      setPhase({ t: "in" });
      if (!r.already_here) {
        sfx.hotspot();
        haptics.buzz("hotspot");
      }
    })();
    return () => {
      dead = true;
      if (inside.current) {
        inside.current = false;
        leaveSoon();
      }
    };
  }, [slug, userId, attempt]);

  // The session may never start (anonymous sign-in switched off): say so rather than wait for ever.
  useEffect(() => {
    if (!userId && state === "offline" && getSupabase()) setPhase({ t: "closed", reason: "error" });
  }, [userId, state]);

  // The visit faded (a long sleep, a bad connection) or the server says the avatar is not in the room:
  // come back in without a flicker. A refusal now means the door is shut.
  const rejoin = useCallback(async () => {
    const r = await enterHotspot(slug);
    if (r.ok) {
      since.current = Date.now();
      claimed.current = false;
      setVisit((n) => n + 1);
      return true;
    }
    setPhase({ t: "closed", reason: r.reason === "need_account" || r.reason === "need_adult" ? "error" : r.reason });
    return false;
  }, [slug]);

  // One avatar, one place, across screens: if this account's avatar was sent to another room from another device, that
  // room has it now. Coming back in here would pull it out again, and the two screens would trade it for ever (each trade
  // is an entry, and 30 a day are allowed). So this screen gives way instead of rejoining.
  const movedOn = useCallback(async () => {
    const m = await myHotspot();
    if (!m.ok || !m.in || m.in.slug === slug) return false;
    inside.current = false;
    away.current = true;
    setPhase({ t: "closed", reason: "elsewhere" });
    return true;
  }, [slug]);

  // Staying in: the pulse and the room read, only while the page is showing.
  useEffect(() => {
    if (phase.t !== "in" || !entered || !getSupabase()) return;
    let dead = false;
    const showing = () => document.visibilityState === "visible";
    const poll = async () => {
      const r = await readRoom(slug);
      if (dead) return;
      if (r.ok) return setRoom(r);
      if (r.reason === "not_in_hotspot" && !(await movedOn()) && !dead && (await rejoin())) {
        const again = await readRoom(slug);
        if (!dead && again.ok) setRoom(again);
      }
    };
    const pulse = async () => {
      const r = await pulseHotspot();
      if (dead) return;
      // The pulse answers for the account's one avatar: another slug means another screen has it in another room.
      if (r.ok) {
        if (r.slug !== slug) await movedOn();
        return;
      }
      if (r.reason === "paused") setPhase({ t: "closed", reason: "paused" });
      else if (r.reason === "not_in_hotspot" && !(await movedOn())) await rejoin();
    };
    const a = setInterval(() => showing() && void pulse(), PULSE_MS);
    const b = setInterval(() => showing() && void poll(), POLL_MS);
    const onShow = () => {
      if (!showing()) return;
      void pulse();
      void poll();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      clearInterval(a);
      clearInterval(b);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [phase.t, entered, slug, rejoin, movedOn]);

  // The daily reward: after the stay (5 minutes), ask once. A room entered again while the avatar was still in
  // has probably been here a while, so it asks at once and the server says how long is left.
  useEffect(() => {
    if (phase.t !== "in" || !entered || !getSupabase()) return;
    let dead = false;
    let t: ReturnType<typeof setTimeout>;
    let errors = 0;
    const claim = async () => {
      const r = await claimDaily();
      if (dead) return;
      if (!r.ok) {
        if (r.reason === "too_early") t = setTimeout(claim, (r.wait_s ?? 10) * 1000 + 500);
        else if (r.reason === "error" && ++errors < 3) t = setTimeout(claim, 30_000);
        return;
      }
      claimed.current = true;
      void refresh();
      if (r.xp > 0 || r.badge) {
        setReward({ id: Date.now(), xp: r.xp, badge: r.badge, place: entered.hotspot.name, minutes: Math.round(entered.rules.stay_s / 60) });
      }
    };
    // Timed from when this visit began: the first one, or the one made when the avatar came back in after fading.
    const stayMs = entered.rules.stay_s * 1000;
    const wait = visit === 0 && entered.already_here ? 0 : Math.max(0, since.current + stayMs - Date.now());
    t = setTimeout(claim, wait);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [phase.t, entered, refresh, visit]);

  /** Take the avatar out (the visit is over). A stay the timer has not paid yet is claimed on the way out. */
  const leave = useCallback(() => {
    inside.current = false;
    if (!getSupabase() || away.current) return;
    const owed = !claimed.current && !!entered && since.current > 0 && Date.now() - since.current >= entered.rules.stay_s * 1000;
    const last = owed
      ? claimDaily().then((r) => {
          if (!r.ok) return;
          void refresh();
          if (r.xp > 0) say(`+${r.xp} XP for the visit.`, "ok");
        })
      : Promise.resolve();
    void last.then(() => leaveNow());
  }, [entered, refresh, say]);

  /** The sign-up sheet, and back in once there is an account. */
  const askAccount = useCallback(() => {
    if (requireAccount("join hotspots and chat", retry)) retry();
  }, [retry]);

  /** The server said the avatar is not in this room: come back in, unless another screen has it somewhere else. */
  const recover = useCallback(async () => {
    if (!(await movedOn())) await rejoin();
  }, [movedOn, rejoin]);

  const readAgain = useCallback(async () => {
    const r = await readRoom(slug);
    if (r.ok) setRoom(r);
  }, [slug]);

  return { phase, entered, room, reward, known, retry, recover, leave, askAccount, readAgain };
}
