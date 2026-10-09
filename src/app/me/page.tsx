"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAccount from "@/components/app/RequireAccount";
import { useRouter } from "next/navigation";
import { FileText, Gift, Link2, Ticket } from "lucide-react";
import Sheet from "@/components/Sheet";
import AreaPicker from "@/components/AreaPicker";
import type { MascotState } from "@/components/Mascot";
import MeHeader from "@/components/me/MeHeader";
import NumberTiles, { type TileKey } from "@/components/me/NumberTiles";
import BadgeShelf, { shelfBadges } from "@/components/me/BadgeShelf";
import WaysToEarn from "@/components/me/WaysToEarn";
import YourNights, { type Visit } from "@/components/me/YourNights";
import SettingsGroup from "@/components/me/SettingsGroup";
import { RowButton, RowGroup, RowLink } from "@/components/me/Rows";
import { DEMO, demoBadges, demoEmpty, demoProfile, demoStats, demoVisits } from "@/components/me/demo";
import { dropPhase } from "@/components/me/dropTime";
import { readJSON, writeJSON } from "@/components/me/seen";
import { useNow } from "@/components/me/useNow";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { useHoppaz, useToast } from "@/lib/store";
import { BADGES, levelFor, statusFor } from "@/lib/brand";
import { useGameDashboard, useGameDrops } from "@/lib/game";
import { GENDERS, useNextAsk } from "@/lib/account";
import type { Profile } from "@/lib/types";

type CatalogBadge = { key: string; name: string; icon: string; description: string };
type Seen = { streak: number; xp: number; hot: TileKey; level: string };

const SEEN_KEY = "hoppaz.me.seen";
const BADGES_KEY = "hoppaz.me.badges";
const WAVE_KEY = "hoppaz.me.wave";
const DAY_MS = 24 * 3.6e6;

/** Today's date in Lagos, for "first open of the day". */
const lagosToday = () => new Date(Date.now() + 3.6e6).toISOString().slice(0, 10);

function MePagePage() {
  const session = useSession();
  const { userId, email, hasAccount, state } = session;
  const ask = useNextAsk(userId, hasAccount);
  const { stats, makeReport, busy: reportBusy, ready: statsReady } = useGameDashboard(userId, { lite: true });
  const { drops, ready: dropsReady } = useGameDrops();
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
  const [picking, setPicking] = useState(false);
  const [earnOpen, setEarnOpen] = useState(false);
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
      const [b, bc, c] = await Promise.all([
        sb.from("badges").select("key, earned_at").eq("user_id", userId),
        sb.from("badge_catalog").select("key,name,icon,description"),
        sb
          .from("checkins")
          .select("event_id, created_at, events(title, venue_name, area)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      if (cancelled) return;
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

  // The one that moved since you last looked is orange, and stamps in once.
  const [hot, setHot] = useState<TileKey>("streak");
  const [stamp, setStamp] = useState<Partial<Record<TileKey | "level", boolean>>>({});
  useEffect(() => {
    if (!numbersReady) return;
    const prev = readJSON<Seen | null>(SEEN_KEY, null);
    let nextHot: TileKey = prev?.hot ?? "streak";
    const moved: Partial<Record<TileKey | "level", boolean>> = {};
    if (prev) {
      // A streak only moves once a day, so when both moved it is the news.
      if (xp !== prev.xp) {
        nextHot = "xp";
        moved.xp = true;
      }
      if (streak !== prev.streak) {
        nextHot = "streak";
        moved.streak = true;
      }
      if (lvl.name !== prev.level) moved.level = true;
    }
    setHot(nextHot);
    setStamp(moved);
    writeJSON(SEEN_KEY, { streak, xp, hot: nextHot, level: lvl.name } satisfies Seen);
  }, [numbersReady, streak, xp, lvl.name]);

  /* -------------------------------------------------------- badges ---- */
  const badges = useMemo(() => shelfBadges(catalog), [catalog]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!loaded) return;
    const keys = Object.keys(owned);
    const seen = readJSON<string[] | null>(BADGES_KEY, null);
    // The first time on a phone nothing stamps: only badges earned since the last look do.
    setFresh(new Set(seen ? keys.filter((k) => !seen.includes(k)) : []));
    writeJSON(BADGES_KEY, keys);
  }, [loaded, owned]);

  const hopBadges = Object.keys(owned).filter((k) => k === "hop" || /^hop[-_]/.test(k)).length;
  const status = statusFor(hopBadges);
  const stamps = loaded ? Object.keys(owned).length : null;

  /* --------------------------------------------------------- mascot ---- */
  const [waving, setWaving] = useState(false);
  useEffect(() => {
    // It waves once, on the first open of each day.
    if (readJSON<string | null>(WAVE_KEY, null) === lagosToday()) return;
    setWaving(true);
    const t = setTimeout(() => {
      setWaving(false);
      writeJSON(WAVE_KEY, lagosToday());
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

  const makeCard = async () => {
    const token = await makeReport();
    if (!token) {
      say("Couldn't make your card. Try again.", "error");
      return;
    }
    const url = `${location.origin}/report/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      say("Link copied.", "ok");
    } catch {
      say(url);
    }
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
      <MeHeader
        look={profile?.avatar ?? look}
        name={profile?.display_name || "Hopper"}
        level={lvl.name}
        status={status}
        stamps={stamps}
        mascot={waving ? "wave" : mood}
        stampLevel={!!stamp.level}
      />

      <NumberTiles
        streak={streak}
        xp={xp}
        hot={hot}
        stamp={stamp}
        ready={numbersReady}
        onXp={() => setEarn(true)}
      />

      <BadgeShelf badges={badges} earned={owned} fresh={fresh} />

      <section aria-label="More" className="mt-7">
        <RowGroup>
          <RowButton
            icon={FileText}
            title="Month report card"
            hint={reportBusy ? "Making your card." : "Last month, as a link you can send."}
            disabled={reportBusy}
            trailing={<Link2 size={18} aria-hidden className="flex-none text-dim" />}
            onClick={() => void makeCard()}
          />
          <RowLink
            href="/drops"
            title="Live drops"
            hint={dropsHint}
            lead={<Gift size={19} strokeWidth={1.9} aria-hidden className={liveDrops ? "flex-none text-violet" : "flex-none text-dim"} />}
          />
          <RowLink href="/collection" icon={Ticket} title="Your shelf" hint="Collectibles and rewards you've claimed." />
        </RowGroup>
      </section>

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

      <YourNights visits={visits} loaded={loaded} />

      <SettingsGroup
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
    </div>
  );
}

/** Needs an account: anonymous Hoppers get the sign-up here instead. */
export default function MePage() {
  return (
    <RequireAccount title="Make it yours." caption="Your nights, XP, badges and your Hopper live here.">
      <MePagePage />
    </RequireAccount>
  );
}
