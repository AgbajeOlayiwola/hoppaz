"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, UserMinus, UserPlus } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { useCrew } from "@/lib/useCrew";
import { useHoppaz, useToast } from "@/lib/store";
import { areaByName, travelEstimate } from "@/lib/geo";
import { levelFor } from "@/lib/brand";
import type { Profile } from "@/lib/types";
import Avatar from "@/components/Avatar";

export default function CrewPage() {
  const { userId, profile } = useSession();
  const { crew, add, remove, search } = useCrew(userId);
  const { fix, look } = useHoppaz();
  const say = useToast((s) => s.say);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      setHits(await search(q));
      setSearching(false);
    }, 280);
    return () => clearTimeout(t);
  }, [q, search]);

  const board = useMemo(() => {
    const me = {
      id: userId ?? "me",
      display_name: profile?.display_name ?? "You",
      area: profile?.area ?? fix?.area ?? null,
      xp: profile?.xp ?? 0,
      is_admin: false,
      avatar: profile?.avatar ?? look,
      mine: true,
    };
    return [...crew.map((c) => ({ ...c, mine: false })), me].sort((a, b) => b.xp - a.xp);
  }, [crew, userId, profile, fix, look]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <header className="pad-top pb-4">
        <h1 className="font-display text-2xl font-black leading-none">Your crew</h1>
        <p className="seclabel mt-1.5">Who is out and where they are</p>
      </header>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-3.5 text-dim" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a Hopper by name"
          className="pl-9"
          autoComplete="off"
          aria-label="Find a Hopper by name"
        />
      </div>

      {q.trim().length >= 2 && (
        <div className="mb-5">
          <p className="seclabel mb-2">{searching ? "Looking…" : `${hits.length} found`}</p>
          {hits
            .filter((h) => h.id !== userId && !crew.some((c) => c.id === h.id))
            .map((h) => (
              <div key={h.id} className="mb-2 flex items-center gap-3 card py-3">
                <Face p={h} />
                <span className="min-w-0 flex-1">
                  <b className="font-display font-black">{h.display_name}</b>
                  <p className="hint">
                    {h.area ?? "somewhere in Lagos"} · {h.xp} XP
                  </p>
                </span>
                <button
                  className="btn btn-ghost flex-none px-3 py-2"
                  onClick={async () => {
                    const ok = await add(h.id);
                    say(ok ? `${(h.display_name ?? "HOPPER").toUpperCase()} ADDED` : "COULD NOT ADD");
                    if (ok) setQ("");
                  }}
                >
                  <UserPlus size={14} />
                </button>
              </div>
            ))}
          {!searching && hits.length === 0 && (
            <p className="hint">
              Nobody by that name yet. Hoppers only appear here once they have set a name on the Me
              tab.
            </p>
          )}
        </div>
      )}

      {crew.length === 0 ? (
        <p className="hint mb-6">
          No crew yet. Add the people you actually go out with, then flip the crew button on the
          map and their pins show up where they are.
        </p>
      ) : (
        <div className="mb-6">
          {crew.map((m) => {
            const here = fix ? { ...fix, side: areaByName(fix.area)?.side } : null;
            const there = areaByName(m.area);
            const trip = here && there ? travelEstimate(here, there) : null;
            return (
              <div key={m.id} className="mb-2 flex items-center gap-3 card py-3">
                <Face p={m} cream />
                <span className="min-w-0 flex-1">
                  <b className="font-display font-black">{m.display_name ?? "A Hopper"}</b>
                  <p className="hint">
                    {m.area ?? "somewhere in Lagos"}
                    {trip && ` · ${trip.km.toFixed(1)} km · ~${trip.minutes} min away`}
                  </p>
                </span>
                <button
                  className="btn btn-ghost flex-none px-3 py-2"
                  aria-label={`Remove ${m.display_name ?? "this Hopper"}`}
                  onClick={() => void remove(m.id)}
                >
                  <UserMinus size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-3 h-px bg-line" />
      <p className="seclabel mb-2">Crew leaderboard</p>
      {board.map((m, i) => (
        <div key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
          <span className="w-5 flex-none font-mono text-[11px] font-bold tabular-nums text-dim">
            {i + 1}
          </span>
          <Face p={m} cream={!m.mine} />
          <span className="min-w-0 flex-1">
            <b className="font-display font-black">
              {m.display_name ?? "A Hopper"}
              {m.mine && " (you)"}
            </b>
            <p className="hint">
              {levelFor(m.xp).name} · {m.xp} XP{m.area ? ` · ${m.area}` : ""}
            </p>
          </span>
        </div>
      ))}
    </div>
  );
}

function Face({ p, cream }: { p: Pick<Profile, "display_name" | "avatar">; cream?: boolean }) {
  // Hoppers who never dressed up keep the initial, so the list still tells people apart.
  if (!p.avatar) {
    return (
      <span
        className={`grid h-8 w-8 flex-none place-items-center rounded font-display text-xs font-black ${
          cream ? "bg-cream text-ink" : "bg-orange text-ink"
        }`}
        aria-hidden
      >
        {(p.display_name || "H")[0].toUpperCase()}
      </span>
    );
  }
  return (
    <span
      className={`h-9 w-9 flex-none overflow-hidden rounded-full border ${cream ? "border-cream bg-cream" : "border-orange bg-orange"}`}
      aria-hidden
    >
      <Avatar look={p.avatar} crop="head" />
    </span>
  );
}
