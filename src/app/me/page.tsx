"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAccount from "@/components/app/RequireAccount";
import { useRouter } from "next/navigation";
import { FileText, Gift, Link2 } from "lucide-react";
import Sheet from "@/components/Sheet";
import AreaPicker from "@/components/AreaPicker";
import type { MascotState } from "@/components/Mascot";
import Reveal, { type RevealOutcome } from "@/components/reveal/Reveal";
import MeHeader from "@/components/me/MeHeader";
import MonthCard, { useMonthCard } from "@/components/me/MonthCard";
import NumberTiles, { type TileKey } from "@/components/me/NumberTiles";
import TodaysBox from "@/components/me/TodaysBox";
import ShelfStrip from "@/components/me/ShelfStrip";
import BadgeShelf, { shelfBadges } from "@/components/me/BadgeShelf";
import WaysToEarn from "@/components/me/WaysToEarn";
import YourNights, { type Visit } from "@/components/me/YourNights";
import SettingsGroup from "@/components/me/SettingsGroup";
import { RowButton, RowGroup, RowLink } from "@/components/me/Rows";
import { DEMO, demoBadges, demoEmpty, demoProfile, demoStats, demoVisits } from "@/components/me/demo";
import { dropPhase } from "@/components/me/dropTime";
import { lagosDate, weekDates } from "@/components/me/lagosDay";
import { readJSON, writeJSON } from "@/components/me/seen";
import { useNow } from "@/components/me/useNow";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { useHoppaz, useToast } from "@/lib/store";
import { BADGES, levelFor, statusFor } from "@/lib/brand";
import { useGameDashboard, useGameDrops } from "@/lib/game";
import { useDailyBox } from "@/lib/useDailyBox";
import { GENDERS, useNextAsk } from "@/lib/account";
import type { Profile } from "@/lib/types";
import { introEvent } from "@/lib/intro";

type CatalogBadge = { key: string; name: string; icon: string; description: string };
type Seen = { streak: number; xp: number; level: string };

const SEEN_KEY = "hoppaz.me.seen";
const BADGES_KEY = "hoppaz.me.badges";
const WAVE_KEY = "hoppaz.me.wave";
/**
 * "What did I last see" is one person's: a second account on the same phone must not read the first one's, or its whole
 * shelf and its streak would stamp in as new (now with sound). No account yet (the sample Hopper, offline) keeps the plain key.
 */
const lastSeen = (key: string, userId: string | null) => (userId ? `${key}.${userId}` : key);
const DAY_MS = 24 * 3.6e6;

function MePagePage() {
  const session = useSession();
  const { userId, email, hasAccount, state } = session;
  const ask = useNextAsk(userId, hasAccount);
  const { stats, makeReport, busy: reportBusy, ready: statsReady, reload: reloadStats } = useGameDashboard(userId, { lite: true });
  const daily = useDailyBox(userId, { demo: DEMO });
  const { drops, ready: dropsReady } = useGameDrops(undefined, { staffOnly: true });
  const { fix, look, setSeenTitle } = useHoppaz();
  const say = useToast((s) => s.say);
  const router = useRouter();
  const now = useNow(60_000);

  // Sample Hopper in local development without a database; the real one otherwise.
  const [demoMe, setDemoMe] = useState<Profile | null>(null);
  const profile = DEMO ? demoMe : session.profile;
  const patchProfile = useCallback(
    async (patch: { display_name?: string | null; area?: string | null }) => {
      if (DEMO) setDemoMe((p) => (p ? { ...p, ...patch } : p));
      else await session.patchProfile(patch);
    },
    [session]
  );

  const [owned, setOwned] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<CatalogBadge[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The nights and badges could not be read (a dropped connection). `loaded` stays false: it means "we know what you have",
  // and the badge stamps and the mascot's mood must not read an empty answer as the truth.
  const [loadFailed, setLoadFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [earnOpen, setEarnOpen] = useState(false);
  const [revealing, setRevealing] = useState(false);
  /** Bumped when today's box paid a card, so the shelf strip reads its cards again. */
  const [shelfKey, setShelfKey] = useState(0);
  const [birthday, setBirthday] = useState("");

  useEffect(() => {
    if (DEMO) {
      const t = Date.now();
      setDemoMe(demoProfile());
      setOwned(demoEmpty() ? {} : Object.fromEntries(demoBadges(t).map((b) => [b.key, b.earned_at])));
      setVisits(demoEmpty() ? [] : demoVisits(t));
      setLoaded(true);
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setLoaded(true);
      return;
    }
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const got = await Promise.all([
        sb.from("badges").select("key, earned_at").eq("user_id", userId),
        sb.from("badge_catalog").select("key,name,icon,description"),
        sb
          .from("checkins")
          .select("event_id, created_at, events(title, venue_name, area)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(40),
      ]).catch(() => null);
      if (cancelled) return;
      if (!got || got[0].error || got[2].error) {
        setLoadFailed(true);
        return;
      }
      const [b, bc, c] = got;
      setLoadFailed(false);
      setOwned(Object.fromEntries(((b.data ?? []) as { key: string; earned_at: string }[]).map((r) => [r.key, r.earned_at])));
      setCatalog(((bc.data ?? []) as CatalogBadge[]).filter((x) => !BADGES.some((badge) => badge.key === x.key)));
      setVisits(
        ((c.data ?? []) as unknown as {
          event_id: string;
          created_at: string;
          events: { title: string; venue_name: string; area: string | null } | null;
        }[])
          .filter((r) => r.events)
          .map((r) => ({
            event_id: r.event_id,
            created_at: r.created_at,
            title: r.events!.title,
            venue: r.events!.venue_name,
            area: r.events!.area,
          }))
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /* ---------------------------------------------------- the numbers ---- */
  const xp = profile?.xp ?? 0;
  const streak = DEMO ? demoStats().daily_streak : Number(stats?.daily_streak ?? 0);
  const lvl = levelFor(xp);
  const numbersReady = DEMO ? !!demoMe : (state !== "loading" && (state === "offline" || (!!profile && statsReady)));

  // A number that moved since you last looked stamps in once.
  const [stamp, setStamp] = useState<Partial<Record<TileKey | "level", boolean>>>({});
  useEffect(() => {
    if (!numbersReady) return;
    const prev = readJSON<Seen | null>(lastSeen(SEEN_KEY, userId), null);
    const moved: Partial<Record<TileKey | "level", boolean>> = {};
    if (prev) {
      if (xp !== prev.xp) moved.xp = true;
      if (streak !== prev.streak) moved.streak = true;
      if (lvl.name !== prev.level) moved.level = true;
    }
    setStamp(moved);
    writeJSON(lastSeen(SEEN_KEY, userId), { streak, xp, level: lvl.name } satisfies Seen);
  }, [numbersReady, streak, xp, lvl.name, userId]);

  // This week's seven dots: the days that counted toward the streak.
  const today = now === null ? null : lagosDate(now);
  const week = useMemo(() => (today ? weekDates(today) : null), [today]);
  const weekDone = useMemo(() => {
    const done = new Set(daily.week);
    // Development without a database: the sample streak, so the dots have something to show.
    if (DEMO && week && today) {
      const at = week.indexOf(today);
      week.forEach((d, i) => i < at && i >= at - 4 && done.add(d));
    }
    return done;
  }, [daily.week, week, today]);

  /* -------------------------------------------------------- badges ---- */
  const badges = useMemo(() => shelfBadges(catalog), [catalog]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!loaded) return;
    const keys = Object.keys(owned);
    const seen = readJSON<string[] | null>(lastSeen(BADGES_KEY, userId), null);
    // The first time this account looks on a phone nothing stamps: only badges earned since the last look do.
    setFresh(new Set(seen ? keys.filter((k) => !seen.includes(k)) : []));
    writeJSON(lastSeen(BADGES_KEY, userId), keys);
  }, [loaded, owned, userId]);

  const hopBadges = Object.keys(owned).filter((k) => k === "hop" || /^hop[-_]/.test(k)).length;
  const status = statusFor(hopBadges);

  /* --------------------------------------------------------- mascot ---- */
  const [waving, setWaving] = useState(false);
  useEffect(() => {
    // It waves once, on the first open of each day.
    if (readJSON<string | null>(WAVE_KEY, null) === lagosDate(Date.now())) return;
    setWaving(true);
    const t = setTimeout(() => {
      setWaving(false);
      writeJSON(WAVE_KEY, lagosDate(Date.now()));
    }, 2400);
    return () => clearTimeout(t);
  }, []);
  const last = visits[0] ? Date.parse(visits[0].created_at) : null;
  let mood: MascotState = "idle";
  if (loaded && now !== null) {
    if (last === null || now - last > 14 * DAY_MS) mood = "sleep";
    else if (now - last <= 7 * DAY_MS && streak >= 2) mood = "celebrate";
  }

  /* ---------------------------------------------------- ways to earn ---- */
  useEffect(() => {
    const sync = () => setEarnOpen(window.location.hash === "#earn");
    sync();
    // A client-side visit to /me#earn can land a tick before the address bar updates.
    const t = setTimeout(sync, 60);
    window.addEventListener("hashchange", sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const setEarn = useCallback((open: boolean) => {
    setEarnOpen(open);
    const url = `${window.location.pathname}${open ? "#earn" : ""}`;
    try {
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* the sheet still opens and closes */
    }
  }, []);

  /* ----------------------------------------------------------- rows ---- */
  const liveDrops = now === null ? 0 : drops.filter((d) => dropPhase(d, now) === "open").length;
  const dropsHint = !dropsReady || now === null ? "Rewards that land at venues." : liveDrops ? `${liveDrops} open now` : "None open. They land at the venue.";

  // The report card: make it, copy the link (as it always did), and from the month card open it too.
  const makeCard = async (andOpen = false) => {
    const token = await makeReport();
    if (!token) {
      say("Couldn't make your card. Try again.", "error");
      return;
    }
    const path = `/report/share/${token}`;
    const url = `${location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      say("Link copied.", "ok");
    } catch {
      say(url);
    }
    if (andOpen) router.push(path);
  };
  const month = useMonthCard(userId, now, Object.values(owned));

  /* ------------------------------------------------------ today's box ---- */
  const boxShown = DEMO || (state !== "offline" && daily.status !== "unavailable");
  const openDaily = async (): Promise<RevealOutcome> => {
    const r = await daily.open();
    if ("error" in r) return r;
    if (r.already) return { error: "You already opened today's box. Back tomorrow." };
    if (DEMO) setDemoMe((p) => (p ? { ...p, xp: p.xp + r.box.xp } : p));
    if (r.card) setShelfKey((k) => k + 1);
    return {
      items: [
        { kind: "reward", title: r.box.title, line: "Your box for today." },
        // a card only when staff have switched cards on for today's box
        ...(r.card ? [{ kind: "card" as const, title: r.card.name, card: r.card }] : []),
        { kind: "xp", title: `+${r.box.xp} XP`, line: "Added to your XP. Streak kept." },
      ],
    };
  };
  const closeDaily = () => {
    setRevealing(false);
    // What the box paid shows up on the tiles, the dots and the card.
    void daily.reload();
    void reloadStats();
    session.refresh();
  };

  const deleteAccount = async () => {
    if (!userId) return;
    const sb = getSupabase();
    const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) {
      say("Your session ran out. Reopen Hoppaz.", "error");
      return;
    }
    const response = await fetch("/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) {
      say("Couldn't delete the account. Try again.", "error");
      return;
    }
    await sb?.auth.signOut();
    localStorage.removeItem("hoppaz.v1");
    window.location.replace("/");
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      {month.card && (
        <div className="pad-top">
          <MonthCard card={month.card} busy={reportBusy} onOpen={() => void makeCard(true)} onDismiss={month.dismiss} />
        </div>
      )}

      <MeHeader
        look={profile?.avatar ?? look}
        name={profile?.display_name || "Hopper"}
        levelNo={lvl.index + 1}
        level={lvl.name}
        status={status}
        mascot={waving ? "wave" : mood}
        stampLevel={!!stamp.level}
        belowCard={!!month.card}
      />

      <NumberTiles
        streak={streak}
        xp={xp}
        level={lvl}
        stamp={stamp}
        ready={numbersReady}
        week={week}
        weekDone={weekDone}
        today={today}
        onXp={() => setEarn(true)}
      />

      {boxShown && (
        <TodaysBox
          status={daily.status === "unavailable" ? "loading" : daily.status}
          box={daily.box}
          onOpen={() => setRevealing(true)}
        />
      )}

      <ShelfStrip key={shelfKey} userId={userId} offline={state === "offline"} />

      <BadgeShelf badges={badges} earned={owned} fresh={fresh} />

      {ask.next?.key === "gender" && (
        <div className="card mt-4">
          <p className="font-display font-black">One quick one: your gender?</p>
          <p className="hint mt-0.5">Helps us plan nights for everyone. Only you see this.</p>
          <div role="group" aria-label="Your gender" className="mt-3 flex flex-wrap gap-1.5">
            {GENDERS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="chip min-h-[44px] px-4"
                onClick={async () => {
                  const saved = await ask.answer({ gender: k });
                  say(saved ? "Saved. Thanks." : "That didn't save. Try again.", saved ? "ok" : "error");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="mt-2 min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4" onClick={ask.later}>
            Later
          </button>
        </div>
      )}

      {ask.next?.key === "birthday" && (
        <form
          className="card mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!birthday) return;
            const saved = await ask.answer({ birthday });
            say(saved ? "Saved. We'll remember it." : "That date didn't work.", saved ? "ok" : "error");
          }}
        >
          <p className="font-display font-black">When&apos;s your birthday?</p>
          <p className="hint mt-0.5">So the bus can do something for it. Only you see this.</p>
          <input
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            aria-label="Your birthday"
            className="mt-3"
          />
          <div className="mt-3 flex gap-2">
            <button type="submit" className="btn flex-1" disabled={!birthday}>SAVE</button>
            <button type="button" className="btn btn-ghost flex-none" onClick={ask.later}>LATER</button>
          </div>
        </form>
      )}

      <YourNights visits={visits} loaded={loaded} failed={!DEMO && (loadFailed || state === "offline")} />

      <section aria-label="More" className="mt-7">
        <p className="seclabel mb-2.5">MORE</p>
        <RowGroup>
          <RowLink
            href="/drops"
            title="Live drops"
            hint={dropsHint}
            lead={<Gift size={19} strokeWidth={1.9} aria-hidden className={liveDrops ? "flex-none text-violet" : "flex-none text-dim"} />}
          />
          <RowButton
            icon={FileText}
            title="Month report card"
            hint={reportBusy ? "Making your card." : "Last month, as a link you can send."}
            disabled={reportBusy}
            trailing={<Link2 size={18} aria-hidden className="flex-none text-dim" />}
            onClick={() => void makeCard()}
          />
        </RowGroup>
      </section>

      <SettingsGroup
        className="mt-3"
        name={profile?.display_name ?? null}
        handle={profile?.handle ?? null}
        area={profile?.area || fix?.area || "Not set"}
        hasAccount={hasAccount}
        email={email}
        accountReady={state !== "loading" && state !== "offline"}
        isAdmin={!!profile?.is_admin}
        onSaveName={async (name) => {
          await patchProfile({ display_name: name });
          say("Saved.", "ok");
        }}
        onChangeArea={() => setPicking(true)}
        onReplayIntro={() => {
          setSeenTitle(false);
          router.push("/");
        }}
        onDelete={deleteAccount}
      />

      {state === "offline" && (
        <p className="mt-5 flex items-start gap-2.5 font-body text-[13px] leading-snug text-dim">
          <i aria-hidden className="mt-[5px] h-2 w-2 flex-none rounded-full bg-dim" />
          You&apos;re offline. Your nights will save when you&apos;re back.
        </p>
      )}

      <Sheet open={earnOpen} onClose={() => setEarn(false)} label="Ways to earn">
        <WaysToEarn userId={userId} xp={xp} />
      </Sheet>

      <AreaPicker open={picking} onClose={() => setPicking(false)} onPicked={(area) => void patchProfile({ area })} />

      {revealing && (
        <Reveal
          label="Today's box"
          kicker="TODAY'S BOX"
          doneLine="XP added. Streak kept."
          shareLine={(what) => `I opened today's box on Hoppaz and pulled ${what}.`}
          open={openDaily}
          onClose={closeDaily}
        />
      )}
    </div>
  );
}

/** Needs an account: anonymous Hoppers get the sign-up here instead. */
export default function MePage() {
  // Paz's tour: here, even behind the sign-up wall, so the last step still shows.
  useEffect(() => {
    introEvent("me_viewed");
  }, []);
  return (
    <RequireAccount preview title="Make it yours." caption="Your nights, XP, badges and your Hopper live here.">
      <MePagePage />
    </RequireAccount>
  );
}
