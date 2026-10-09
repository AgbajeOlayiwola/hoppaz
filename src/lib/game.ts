"use client";

import { NEED_ACCOUNT, requireAccount } from "./accountGate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "./supabase/client";

export type Quest = {
  id: string;
  key: string;
  title: string;
  description: string;
  quest_type: "checkin" | "photo" | "qr" | "insight" | "group";
  event_id: string | null;
  starts_at: string;
  ends_at: string | null;
  repeat_period: string;
  xp_reward: number;
  badge_key: string | null;
  group_size: number;
};
export type GameDrop = {
  id: string;
  title: string;
  description: string;
  partner_id: string | null;
  event_id: string | null;
  area: string | null;
  geog: unknown;
  opens_at: string;
  closes_at: string;
  radius_m: number;
  claim_method: "proximity" | "qr" | "either" | "avatar";
  reward_model: "fixed" | "random";
  /** Set when the drop is a camera hunt for one of the 3D items (huntItems.ts). */
  hunt_item?: string | null;
  /**
   * staff = desk drop, spawn = street box (shared, first N), welcome = personal box.
   * near and special are Play's own boxes (play_tick hands them out; the app never lists them). Missing on older databases.
   */
  kind?: "staff" | "spawn" | "welcome" | "near" | "special";
  /** Set on welcome boxes: only this Hopper can see them. */
  owner_id?: string | null;
  max_claims?: number | null;
  claimed_count?: number;
  partner?: { name: string; logo_url: string | null } | null;
};
/** How many people can still open a box (first N), or null when there is no cap. Never below 0. */
export const dropsLeft = (d: Pick<GameDrop, "max_claims" | "claimed_count">) =>
  d.max_claims != null ? Math.max(0, d.max_claims - (d.claimed_count ?? 0)) : null;
export type CrewGroup = {
  id: string;
  name: string;
  visibility: "open" | "private";
  invite_code: string;
  created_by: string;
  crew_moves?: CrewMove[];
};
export type CrewMove = {
  id: string;
  crew_id: string;
  title: string;
  meetup: string | null;
  starts_at: string;
  note: string;
  event_id: string | null;
  /** Your answer, if you gave one. */
  mine?: "going" | "maybe" | "cant_go" | null;
  /** How many said I'M IN: the move's chat. */
  going?: number;
};

export function useQuests(userId: string | null) {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    if (!userId) return;
    const [{ data: q }, { data: c }] = await Promise.all([
      sb.from("quests").select("*").eq("active", true).order("starts_at"),
      sb
        .from("quest_claims")
        .select("quest_id,status,period_key,claimed_at")
        .eq("user_id", userId)
        .order("claimed_at", { ascending: false }),
    ]);
    const questRows = (q ?? []) as Quest[];
    setQuests(questRows);
    const byId = new Map(questRows.map((row) => [row.id, row]));
    const st: Record<string, string> = {};
    const now = new Date();
    const lagos = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const date = new Date(`${lagos}T00:00:00Z`);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    (c ?? []).forEach((r) => {
      const quest = byId.get(r.quest_id);
      if (!quest || st[r.quest_id]) return;
      const key =
        quest.repeat_period === "daily"
          ? lagos
          : quest.repeat_period === "weekly"
            ? monday.toISOString().slice(0, 10)
            : quest.repeat_period === "monthly"
              ? lagos.slice(0, 7)
              : "once";
      if (r.period_key === key) st[r.quest_id] = r.status;
    });
    setClaims(st);
    setReady(true);
  }, [userId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const claim = useCallback(
    async (
      quest: Quest,
      opts: { eventId?: string | null; code?: string; evidence?: string; crewId?: string | null } = {}
    ) => {
      const sb = getSupabase();
      if (!sb) return "NOT CONNECTED";
      if (!requireAccount("complete quests and earn XP")) return NEED_ACCOUNT;
      setBusy(quest.id);
      const { data, error } = await sb.rpc("claim_quest", {
        p_quest: quest.id,
        p_event: opts.eventId ?? quest.event_id ?? null,
        p_code: opts.code ?? null,
        p_evidence: opts.evidence ?? null,
        p_crew: opts.crewId ?? null,
      });
      setBusy(null);
      if (error) return "COULD NOT COMPLETE QUEST";
      const r = data as { ok: boolean; reason?: string; status?: string; xp?: number };
      if (!r.ok)
        return (
          (
            {
              already: "ALREADY COMPLETED",
              wrong_event: "THIS QUEST IS FOR ANOTHER EVENT",
              checkin_required: "CHECK IN AT THE EVENT FIRST",
              invalid_code: "CODE NOT VALID",
              crew_required: "JOIN A CREW FIRST",
              group_not_there: "YOUR CREW NEEDS MORE PEOPLE HERE",
              closed: "QUEST IS CLOSED",
            } as Record<string, string>
          )[r.reason ?? ""] ?? "QUEST NOT READY"
        );
      await reload();
      return r.status === "pending" ? "SUBMITTED FOR REVIEW" : `QUEST COMPLETE · +${r.xp ?? 0} XP`;
    },
    [reload]
  );
  return {
    quests,
    claims,
    busy,
    claim,
    reload,
    /** The first load has finished, whatever it found. */
    ready,
  };
}

/** Development only: the play-test button teleports, and the server's speed check needs explaining. */
const IS_DEV = process.env.NODE_ENV !== "production";
const DROP_COLS =
  "id,title,description,partner_id,event_id,area,geog,opens_at,closes_at,radius_m,claim_method,reward_model,hunt_item,partner:partners(name,logo_url)";
// Street box columns (spawning.sql). A database that has not run it yet rejects them, so the read falls back to DROP_COLS.
const SPAWN_COLS = ",kind,owner_id,max_claims,claimed_count";
/** The boxes list re-reads this often while the tab is visible, so new street boxes and sold-out ones show up on their own. */
const DROPS_REFRESH_MS = 60_000;

/**
 * `staffOnly` keeps only desk drops (venue rewards): street boxes and welcome boxes belong on the
 * map, where the sold-out ones are hidden, and not in the lists of venue drops (/drops, Me).
 */
export function useGameDrops(eventId?: string, opts: { staffOnly?: boolean } = {}) {
  const staffOnly = !!opts.staffOnly;
  const [all, setAll] = useState<GameDrop[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const drops = useMemo(() => (staffOnly ? all.filter((d) => !d.kind || d.kind === "staff") : all), [all, staffOnly]);
  const reload = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    const mine = ++latest.current;
    const read = (cols: string) => {
      let q = sb
        .from("game_drops")
        .select(cols)
        .eq("active", true)
        .gt("closes_at", new Date().toISOString())
        .order("opens_at");
      if (eventId) q = q.eq("event_id", eventId);
      return q;
    };
    let res = await read(DROP_COLS + SPAWN_COLS);
    if (res.error) res = await read(DROP_COLS);
    if (mine !== latest.current) return;
    // a newer read is already on its way, so this one is stale
    setReady(true);
    if (res.error) return;
    // offline, or a phone still waking up: keep the boxes already on the map
    setAll((res.data ?? []) as unknown as GameDrop[]);
    setLoaded(true);
  }, [eventId]);
  useEffect(() => {
    void reload();
    if (!getSupabase()) return;
    const tick = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = setInterval(tick, DROPS_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);
  const claim = useCallback(
    async (drop: GameDrop, fix: { lat: number; lng: number } | null, code?: string) => {
      const sb = getSupabase();
      if (!sb) return { error: "NOT CONNECTED" };
      if (drop.kind !== "welcome" && !requireAccount("claim this reward")) return { error: NEED_ACCOUNT };
      setBusy(drop.id);
      const { data, error } = await sb.rpc("claim_game_drop", {
        p_drop: drop.id,
        p_lat: fix?.lat ?? null,
        p_lng: fix?.lng ?? null,
        p_code: code?.trim() || null,
      });
      setBusy(null);
      if (error) return { error: "COULD NOT CLAIM" };
      const r = data as {
        ok: boolean;
        reason?: string;
        reward?: string;
        description?: string;
        code?: string;
        xp?: number;
      };
      if (!r.ok) {
        // the list is stale: someone emptied it, or it closed. Re-read so the pin goes now, not in a minute.
        if (r.reason === "sold_out" || r.reason === "closed" || r.reason === "already") void reload();
        // a street or welcome box is a box on the street, not a venue drop: it says so
        const onStreet = drop.kind === "spawn" || drop.kind === "welcome";
        return {
          error:
            (
              {
                closed: onStreet ? "TOO LATE. THAT BOX IS GONE" : "DROP IS CLOSED",
                sold_out:
                  drop.kind === "spawn" ? "SOMEONE BEAT YOU TO IT. THE BOX IS GONE" : "ALL REWARDS HAVE BEEN CLAIMED",
                invalid_code: "QR CODE NOT VALID",
                code_required: "SCAN THE DROP QR CODE",
                location_required: "TURN ON LOCATION TO CLAIM",
                too_far: "YOU'RE TOO FAR AWAY. GET CLOSER TO OPEN IT",
                already: "YOU ALREADY CLAIMED THIS DROP",
                not_yours: "THIS BOX IS SOMEONE ELSE'S",
                too_fast: `THAT WAS TOO FAST TO BE ON FOOT${IS_DEV ? ". DEV: THE SERVER REFUSES A HOP OVER 50 M/S BETWEEN CLAIMS, SO TRY A CLOSER BOX OR WAIT A FEW MINUTES" : ""}`,
                slow_down: "TAKE A BREATHER, THEN TRY AGAIN",
              } as Record<string, string>
            )[r.reason ?? ""] ?? "COULD NOT CLAIM",
        };
      }
      await reload();
      return { reward: r.reward, description: r.description, code: r.code, xp: r.xp };
    },
    [reload]
  );
  return {
    drops,
    busy,
    claim,
    reload,
    /** The first load has finished, whatever it found. */
    ready,
    /** At least one read worked, so `drops` is real and not just empty because the network was down. */ loaded,
  };
}

/**
 * Game stats for the signed-in Hopper. Pass `{ lite: true }` when you only need
 * the stats (Me): it skips the monthly board and the score-rule table.
 */
export function useGameDashboard(userId: string | null, opts: { lite?: boolean } = {}) {
  const lite = !!opts.lite;
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [rules, setRules] = useState<{ key: string; score: number }[]>([]);
  const [board, setBoard] = useState<{ rank: number; display_name: string; outside_score: number; avatar: unknown }[]>(
    []
  );
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    if (lite && !userId) return;
    const [{ data: s }, { data: b }, { data: r }] = await Promise.all([
      userId ? sb.rpc("my_game_stats") : Promise.resolve({ data: null } as { data: null }),
      lite ? Promise.resolve({ data: null } as { data: null }) : sb.rpc("monthly_leaderboard"),
      lite ? Promise.resolve({ data: null } as { data: null }) : sb.from("game_score_rules").select("key,score"),
    ]);
    setStats((s ?? null) as Record<string, unknown> | null);
    setRules((r ?? []) as { key: string; score: number }[]);
    setBoard((b ?? []) as { rank: number; display_name: string; outside_score: number; avatar: unknown }[]);
    setReady(true);
  }, [userId, lite]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const makeReport = useCallback(async (month?: string) => {
    const sb = getSupabase();
    if (!sb) return null;
    setBusy(true);
    const { data } = month
      ? await sb.rpc("create_monthly_report", { p_month: month })
      : await sb.rpc("create_monthly_report");
    setBusy(false);
    return data ? String(data) : null;
  }, []);
  return {
    stats,
    board,
    rules,
    busy,
    makeReport,
    reload,
    /** The first load has finished, whatever it found. */
    ready,
  };
}

export function useGroups(userId: string | null) {
  const [groups, setGroups] = useState<CrewGroup[]>([]);
  const [openGroups, setOpenGroups] = useState<CrewGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const [{ data }, { data: open }] = await Promise.all([
      sb
        .from("crew_members")
        .select("crew:crews!inner(id,name,visibility,invite_code,created_by)")
        .eq("user_id", userId),
      sb.from("crews").select("id,name,visibility,invite_code,created_by").eq("visibility", "open").limit(50),
    ]);
    const list = ((data ?? []) as unknown as { crew: CrewGroup }[]).map((x) => x.crew).filter(Boolean);
    setOpenGroups(((open ?? []) as CrewGroup[]).filter((g) => !list.some((m) => m.id === g.id)));
    if (list.length) {
      const { data: m } = await sb
        .from("crew_moves")
        .select("*")
        .in(
          "crew_id",
          list.map((g) => g.id)
        )
        .order("starts_at");
      const moves = (m ?? []) as CrewMove[];
      // Your answer and the I'M IN count for each move (crew members can read their crew's RSVPs).
      if (moves.length) {
        const { data: r } = await sb
          .from("crew_move_rsvps")
          .select("move_id,user_id,status")
          .in(
            "move_id",
            moves.map((x) => x.id)
          );
        const rows = (r ?? []) as { move_id: string; user_id: string; status: CrewMove["mine"] }[];
        moves.forEach((x) => {
          x.mine = rows.find((y) => y.move_id === x.id && y.user_id === userId)?.status ?? null;
          x.going = rows.filter((y) => y.move_id === x.id && y.status === "going").length;
        });
      }
      const by = new Map<string, CrewMove[]>();
      moves.forEach((x) => by.set(x.crew_id, [...(by.get(x.crew_id) ?? []), x]));
      list.forEach((g) => (g.crew_moves = by.get(g.id) ?? []));
    }
    setGroups(list);
  }, [userId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const create = useCallback(
    async (name: string, visibility: "open" | "private") => {
      const sb = getSupabase();
      if (!sb) return null;
      setBusy(true);
      const { data } = await sb.rpc("create_crew", { p_name: name, p_visibility: visibility });
      setBusy(false);
      await reload();
      return data ? String(data) : null;
    },
    [reload]
  );
  const join = useCallback(
    async (invite: string) => {
      const sb = getSupabase();
      if (!sb) return false;
      setBusy(true);
      const { data } = await sb.rpc("join_crew", { p_invite: invite });
      setBusy(false);
      if (data) await reload();
      return !!data;
    },
    [reload]
  );
  const plan = useCallback(
    async (crewId: string, move: Omit<CrewMove, "id" | "crew_id">) => {
      const sb = getSupabase();
      if (!sb || !userId) return false;
      const { error } = await sb.from("crew_moves").insert({ ...move, crew_id: crewId, created_by: userId });
      if (!error) await reload();
      return !error;
    },
    [userId, reload]
  );
  const rsvp = useCallback(
    async (moveId: string, status: "going" | "maybe" | "cant_go") => {
      const sb = getSupabase();
      if (!sb || !userId) return false;
      const { error } = await sb
        .from("crew_move_rsvps")
        .upsert({ move_id: moveId, user_id: userId, status, updated_at: new Date().toISOString() });
      if (!error) await reload();
      return !error;
    },
    [userId, reload]
  );
  return { groups, openGroups, busy, create, join, plan, rsvp, reload };
}
