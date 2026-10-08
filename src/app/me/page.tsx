"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import Avatar from "@/components/Avatar";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { useHoppaz, useToast } from "@/lib/store";
import { BADGES, levelFor } from "@/lib/brand";
import { dayLagos } from "@/lib/geo";
import AreaPicker from "@/components/AreaPicker";
import { useGameDashboard } from "@/lib/game";
import { useNextAsk } from "@/lib/account";

type Visit = { event_id: string; created_at: string; title: string; venue: string; area: string | null };

export default function MePage() {
  const { userId, email, hasAccount, profile, patchProfile, state } = useSession();
  const ask = useNextAsk(userId, hasAccount);
  const [birthday, setBirthday] = useState("");
  const { stats: gameStats } = useGameDashboard(userId);
  const { fix, look, setSeenTitle } = useHoppaz();
  const say = useToast((s) => s.say);
  const router = useRouter();

  const [owned, setOwned] = useState<string[]>([]);
  const [extraBadges,setExtraBadges]=useState<{key:string;name:string;icon:string;description:string}[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let cancelled = false;
    (async () => {
      const [b, bc, c] = await Promise.all([
        sb.from("badges").select("key").eq("user_id", userId),
        sb.from("badge_catalog").select("key,name,icon,description"),
        sb
          .from("checkins")
          .select("event_id, created_at, events(title, venue_name, area)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      if (cancelled) return;
      setOwned(((b.data ?? []) as { key: string }[]).map((r) => r.key));
      setExtraBadges(((bc.data ?? []) as {key:string;name:string;icon:string;description:string}[]).filter(x=>!BADGES.some(badge=>badge.key===x.key)));
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
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const xp = profile?.xp ?? 0;
  const lvl = levelFor(xp);
  const hopBadge = owned.includes("hop");
  const hopCount = visits.length ? Math.min(4, owned.filter((k) => k === "hop").length) : 0;
  const captainProgress = hopBadge ? Math.max(hopCount, 1) : 0;

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <header className="pad-top pb-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href="/me/avatar"
            aria-label="Edit your look"
            className="relative h-16 w-16 flex-none overflow-hidden rounded-full border-2 border-orange bg-orange"
          >
            <Avatar look={profile?.avatar ?? look} crop="head" />
          </Link>
          <div className="min-w-0 flex-1 self-center">
            <h1 className="truncate font-display text-2xl font-black leading-none">
              {profile?.display_name || "Hopper"}
            </h1>
            {profile?.handle && <p className="mt-1 truncate font-mono text-[10px] font-bold text-orange">@{profile.handle}</p>}
            <p className="seclabel mt-1.5">
              {lvl.name} · {xp} XP · {visits.length} check-ins
            </p>
          </div>
          <button
            className="btn btn-ghost flex-none px-3 py-2 text-[10px]"
            onClick={() => {
              setDraft(profile?.display_name ?? "");
              setEditing(true);
            }}
          >
            EDIT
          </button>
        </div>
      </header>

      {editing && (
        <div className="card mb-4">
          <label className="label" htmlFor="nm">
            What should the bus call you
          </label>
          <input
            id="nm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={24}
            autoComplete="off"
          />
          <p className="hint mt-2">
            The name is what your crew searches for. In chat you also show as @{profile?.handle ?? "your handle"}, so people know it&apos;s you.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn flex-1"
              onClick={async () => {
                await patchProfile({ display_name: draft.trim().slice(0, 24) || null });
                setEditing(false);
                say("SAVED");
              }}
            >
              SAVE
            </button>
            <button className="btn btn-ghost flex-none" onClick={() => setEditing(false)}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {ask.next?.key === "birthday" && (
        <form
          className="card mb-4 border-orange/60"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!birthday) return;
            say((await ask.answer({ birthday })) ? "SAVED · WE'LL REMEMBER IT" : "THAT DATE DIDN'T WORK");
          }}
        >
          <p className="font-display font-black">When&apos;s your birthday?</p>
          <p className="hint mt-0.5">So the bus can do something for it. Only you see this.</p>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} max={new Date().toISOString().slice(0, 10)} aria-label="Your birthday" className="mt-3 [color-scheme:dark]" />
          <div className="mt-3 flex gap-2">
            <button type="submit" className="btn flex-1" disabled={!birthday}>SAVE</button>
            <button type="button" className="btn btn-ghost flex-none" onClick={ask.later}>LATER</button>
          </div>
        </form>
      )}

      {state !== "loading" && (hasAccount ? (
        <Link href="/account" className="card mb-4 flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <p className="label mb-0.5">Account</p>
            <p className="truncate font-display text-sm font-black">{email}</p>
          </span>
          <span className="flex-none font-mono text-[9px] font-bold tracking-widest text-dim">MANAGE →</span>
        </Link>
      ) : (
        <Link href="/account" className="card mb-4 flex items-center gap-3 border-orange/60">
          <span className="min-w-0 flex-1">
            <p className="font-display font-black">Make an account</p>
            <p className="hint mt-0.5">Wave at people, add them to your crew and chat privately. Your XP comes with you.</p>
          </span>
          <span className="flex-none font-mono text-[9px] font-bold tracking-widest text-orange">SIGN UP →</span>
        </Link>
      ))}

      <Link href="/me/avatar" className="card mb-4 flex items-center gap-3 overflow-hidden py-0 pr-0">
        <div className="min-w-0 flex-1 py-4">
          <p className="font-display font-black">Your look</p>
          <p className="hint mt-0.5">
            Dress your Hopper in Lagos labels. Your crew sees it on the map.
          </p>
          <span className="mt-3 inline-block border-b border-orange pb-px font-mono text-[9px] font-bold tracking-widest text-orange">
            EDIT LOOK
          </span>
        </div>
        <span className="relative h-32 w-24 flex-none self-end">
          <span aria-hidden className="absolute -bottom-10 -right-6 h-32 w-32 rounded-full bg-orange" />
          <span className="relative block h-full w-full pt-2">
            <Avatar look={profile?.avatar ?? look} />
          </span>
        </span>
      </Link>

      <div className="card mb-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display font-black">{captainProgress >= 4 ? "CAPTAIN" : "HOPPER"}</p>
            <p className="hint mt-0.5">
              {captainProgress >= 4
                ? "Inner circle. You can captain a bus."
                : `${4 - captainProgress} more Hop${4 - captainProgress === 1 ? "" : "s"} to make Captain`}
            </p>
          </div>
          <span className="grid h-8 w-8 flex-none place-items-center rounded bg-violet font-display text-xs font-black text-cream">
            {captainProgress}
          </span>
        </div>
        <span className="mt-3 block h-1 overflow-hidden rounded-full bg-line">
          <i className="block h-full bg-orange" style={{ width: `${(captainProgress / 4) * 100}%` }} />
        </span>
      </div>

      <div className="card mb-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="label mb-0.5">Home area</p>
          <p className="truncate font-display text-sm font-black">
            {profile?.area || fix?.area || "Not set"}
          </p>
        </div>
        <button className="btn btn-ghost flex-none px-3 py-2 text-[10px]" onClick={() => setPicking(true)}>
          CHANGE
        </button>
      </div>

      <p className="seclabel mb-2">Badges</p>
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
        {BADGES.map((b) => {
          const got = owned.includes(b.key);
          return (
            <div
              key={b.key}
              title={b.how}
              className={clsx(
                "rounded-md border bg-ink-2 px-2 py-3 text-center",
                got ? "border-orange" : "border-line"
              )}
            >
              <div className={clsx("text-xl leading-tight", !got && "opacity-30 grayscale")}>
                {b.icon}
              </div>
              <div
                className={clsx(
                  "mt-1 font-mono text-[8px] font-bold uppercase tracking-[0.08em]",
                  got ? "text-cream" : "text-dim"
                )}
              >
                {b.name}
              </div>
            </div>
          );
        })}
        {extraBadges.map(b=>{const got=owned.includes(b.key);return <div key={b.key} title={b.description} className={clsx("rounded-md border bg-ink-2 px-2 py-3 text-center",got?"border-orange":"border-line")}><div className={clsx("text-xl leading-tight",!got&&"opacity-30 grayscale")}>{b.icon}</div><div className={clsx("mt-1 font-mono text-[8px] font-bold uppercase tracking-[0.08em]",got?"text-cream":"text-dim")}>{b.name}</div></div>})}
      </div>

      <section className="mb-3 rounded border border-orange/50 bg-orange/10 p-3">
        <div className="flex items-start justify-between gap-3">
          <div><p className="seclabel text-orange">OUTSIDE SCORE · THIS MONTH</p><p className="mt-1 font-display text-2xl font-black">{String(gameStats?.outside_score ?? 0)}</p></div>
          <span className="tag tag-o">{gameStats?.lagos_rank ? `LAGOS #${gameStats.lagos_rank}` : "LAGOS"}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-orange/20 pt-2">
          <p className="hint">{String(gameStats?.verified_outings ?? 0)} outings · {String(gameStats?.active_days_this_week ?? 0)}/3 days this week · {String(gameStats?.outing_streak ?? 0)} week outing streak</p>
          <Link href="/quests" className="flex-none font-mono text-[9px] font-bold tracking-wider text-orange">DETAILS →</Link>
        </div>
      </section>
      <Link href="/collection" className="mb-5 flex items-center gap-3 rounded border border-violet/50 bg-violet/10 p-3">
        <span className="text-2xl" aria-hidden>✨</span><span className="flex-1"><b className="font-display">Found on the map</b><p className="hint">Collectibles from events you visit</p></span><span className="font-mono text-[9px] font-bold text-orange">OPEN →</span>
      </Link>

      <div className="mb-3 h-px bg-line" />
      <p className="seclabel mb-2">Your nights</p>
      {visits.length === 0 ? (
        <p className="hint mb-5">
          Nothing yet. Get within 1.5 km of a party on the map and check in.
        </p>
      ) : (
        <div className="mb-5">
          {visits.map((v) => (
            <div key={v.event_id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="grid h-8 w-8 flex-none place-items-center rounded bg-orange text-ink">
                ◆
              </span>
              <span className="min-w-0 flex-1">
                <b className="font-display font-black">{v.title}</b>
                <p className="hint">
                  {v.venue} · {v.area} · {dayLagos(v.created_at)}
                </p>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 h-px bg-line" />
      <p className="seclabel mb-2">The ladder</p>
      <p className="hint">
        Join and you are a Hopper. Ride a Hop and you collect a Badge, the stamp that proves you
        were on the bus. Four badges and you are a Captain, the inner circle. The bus never waits:
        hop or stay.
      </p>

      <div className="mt-6 border-t border-line pt-4">
        <p className="seclabel mb-2">Account & community</p>
        <div className="flex flex-wrap gap-3 font-mono text-[9px] font-bold tracking-wider">
          <Link href="/privacy" className="text-orange underline">PRIVACY</Link><Link href="/community" className="text-orange underline">COMMUNITY RULES</Link><Link href="/admin" className="text-dim underline">STAFF</Link>
        </div>
        <button className="mt-4 border-b border-red-500 pb-px font-mono text-[9px] font-bold tracking-widest text-red-400" onClick={async()=>{if(!userId||!window.confirm("Delete your Hoppaz account, activity, chats and uploaded photos? This cannot be undone."))return;const sb=getSupabase();const {data}=await sb?.auth.getSession()??{data:{session:null}};const token=data.session?.access_token;if(!token){say("SESSION EXPIRED · REOPEN HOPPAZ");return;}const response=await fetch("/api/account/delete",{method:"POST",headers:{authorization:`Bearer ${token}`}});if(!response.ok){say("ACCOUNT COULD NOT BE DELETED");return;}await sb?.auth.signOut();localStorage.removeItem("hoppaz.v1");window.location.replace("/");}}>DELETE MY ACCOUNT</button>
      </div>

      <button
        className="mt-5 border-b border-orange pb-px font-mono text-[9px] font-bold tracking-widest text-orange"
        onClick={() => {
          setSeenTitle(false);
          router.push("/");
        }}
      >
        REPLAY THE INTRO
      </button>

      {state === "offline" && (
        <p className="mt-5 border-l-2 border-violet pl-3 font-mono text-[11px] leading-relaxed text-[#A98CFF]">
          Running without a database. XP, badges and check-ins are not being saved. Add the Supabase
          keys and turn on anonymous sign-ins to make this real.
        </p>
      )}

      <AreaPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPicked={(area) => void patchProfile({ area })}
      />
    </div>
  );
}
