"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAccount from "@/components/app/RequireAccount";
import Link from "next/link";
import { MessageSquare, Plus, Search, UserMinus, UserPlus } from "lucide-react";
import { useEventGroups } from "@/lib/chat";
import { areaByName, dayLagos, travelEstimate } from "@/lib/geo";
import { useSession } from "@/lib/useSession";
import { useCrew } from "@/lib/useCrew";
import { useHoppaz, useToast } from "@/lib/store";
import { levelFor } from "@/lib/brand";
import type { Profile } from "@/lib/types";
import { FaceDisc } from "@/components/Avatar";
import Mascot from "@/components/Mascot";
import PageHeader from "@/components/app/PageHeader";
import { useLinger } from "@/components/chat/useLinger";
import { useGroups } from "@/lib/game";
import { useEvents } from "@/lib/useEvents";
import { useTheme } from "@/lib/useTheme";
import CrewPanel from "./CrewPanel";

function CrewPagePage() {
  const { userId, profile, state } = useSession();
  const { crew, loading: crewLoading, add, remove, search } = useCrew(userId);
  const { groups, openGroups, create: createGroup, join: joinGroup, plan, rsvp } = useGroups(userId);
  const { groups: chats, join: joinChat, leave: leaveChat } = useEventGroups(userId);
  const invites = chats.filter((g) => g.status === "invited");
  const joined = chats.filter((g) => g.status === "joined");
  const { fix, look } = useHoppaz();
  const { events } = useEvents(fix, 45);
  const say = useToast((s) => s.say);
  const theme = useTheme();
  // Nothing says "no crews yet" until the lists have had a moment to arrive.
  const settled = useLinger(state !== "loading", 900);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [invite, setInvite] = useState("");
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [moving, setMoving] = useState<string | null>(null);

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

  const createCrew = async () => {
    if (!groupName.trim()) return;
    const id = await createGroup(groupName.trim(), visibility);
    if (id) {
      setGroupName("");
      say("Crew created. Your invite code is ready.", "ok");
    } else {
      say("Couldn't start the crew. Try again.", "error");
    }
  };

  const joinByCode = async () => {
    const ok = await joinGroup(invite);
    say(ok ? "You're in the crew." : "Code not found. Check it and try again.", ok ? "ok" : "error");
    if (ok) setInvite("");
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <PageHeader title="Your crew" caption="Your people and your plans" />

      <section className="card mb-4 p-3" aria-label="Event group chats">
        <div className="flex items-center justify-between gap-2">
          <p className="seclabel">EVENT GROUP CHATS</p>
          <span className={invites.length ? "pill pill-lagoon" : "pill"}>
            {invites.length ? `${invites.length} INVITE${invites.length === 1 ? "" : "S"}` : "STAY IN TOUCH"}
          </span>
        </div>
        {chats.length === 0 && (
          <p className="hint mt-2">Say you&apos;re going to an event and you&apos;re invited to its group chat. Unlike the event room, it stays after the night.</p>
        )}
        {invites.map((g) => (
          <div key={g.event_id} className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display text-[15px] font-semibold">{g.title}</b>
              <span className="hint">{dayLagos(g.starts_at)} · {g.members} in the chat · you&apos;re invited</span>
            </span>
            <button
              className="btn px-3"
              onClick={async () => {
                const ok = await joinChat(g.event_id);
                say(ok ? "You're in the group chat." : "Couldn't join. Try again.", ok ? "ok" : "error");
              }}
            >
              JOIN
            </button>
            <button className="btn btn-ghost px-3" onClick={() => void leaveChat(g.event_id)} aria-label={`No thanks to ${g.title}`}>
              NO
            </button>
          </div>
        ))}
        {joined.map((g) => (
          <Link key={g.event_id} href={`/crew/group/${g.event_id}`} className="mt-3 flex min-h-[44px] items-center gap-3 border-t border-line pt-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line bg-ink-3 text-cream">
              <MessageSquare size={15} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display text-[15px] font-semibold">{g.title}</b>
              <span className="hint block truncate">{g.last_body ?? `${g.members} in the chat · say hi`}</span>
            </span>
            <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">OPEN →</span>
          </Link>
        ))}
      </section>

      <section className="card mb-4 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="seclabel">YOUR CREWS</p>
          <span className="pill">LONG-TERM GROUPS</span>
        </div>

        {groups.length === 0 && settled && (
          <div className="mt-3 flex flex-col items-center px-3 py-3 text-center">
            <Mascot state="oya" size={104} edge={theme === "day" ? "ink" : "ground"} label="The Hoppaz mascot, calling you over" />
            <p className="mt-3 font-display text-[19px] font-black leading-tight">No crews yet.</p>
            <p className="hint mt-1 max-w-[17rem]">A crew is the people you actually go out with. Start one below, or join with a code.</p>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Name a crew" aria-label="Name a crew" maxLength={50} />
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "open")} aria-label="Who can find it" className="max-w-28">
            <option value="private">Private</option>
            <option value="open">Open</option>
          </select>
          <button className="btn w-11 flex-none px-0" aria-label="Create crew" onClick={createCrew}>
            <Plus size={16} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Join with invite code" aria-label="Join with invite code" />
          <button className="btn btn-ghost flex-none px-4" onClick={joinByCode}>JOIN</button>
        </div>

        {groups.map((g) => (
          <CrewPanel
            key={g.id}
            group={g}
            events={events}
            moving={moving === g.id}
            onPlan={() => setMoving(moving === g.id ? null : g.id)}
            onRsvp={rsvp}
            onSubmit={async (form) => {
              const ok = await plan(g.id, form);
              say(ok ? "Move added to the crew." : "Couldn't plan that move. Try again.", ok ? "ok" : "error");
              setMoving(null);
            }}
          />
        ))}

        {openGroups.length > 0 && (
          <>
            <p className="seclabel mb-2 mt-4">OPEN CREWS</p>
            {openGroups.map((g) => (
              <div key={g.id} className="flex items-center gap-2 border-t border-line py-2">
                <span className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{g.name}</span>
                <button
                  className="btn btn-ghost flex-none px-4"
                  onClick={async () => {
                    const ok = await joinGroup(g.id);
                    say(ok ? "You're in the crew." : "Couldn't join. Try again.", ok ? "ok" : "error");
                  }}
                >
                  JOIN
                </button>
              </div>
            ))}
          </>
        )}
      </section>

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
              <div key={h.id} className="card mb-2 flex items-center gap-3 py-3">
                <Face p={h} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-display text-[15px] font-semibold">{h.display_name}</b>
                  <p className="hint">
                    {h.area ?? "somewhere in Lagos"} · {h.xp} XP
                  </p>
                </span>
                <button
                  className="btn btn-ghost w-11 flex-none px-0"
                  aria-label={`Add ${h.display_name ?? "this Hopper"} to your crew`}
                  onClick={async () => {
                    const ok = await add(h.id);
                    say(ok ? `${h.display_name ?? "Hopper"} added.` : "Couldn't add them. Try again.", ok ? "ok" : "error");
                    if (ok) setQ("");
                  }}
                >
                  <UserPlus size={16} aria-hidden />
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
        !crewLoading && (
          <p className="hint mb-6">
            No crew yet. Search a name above and add the people you actually go out with.
          </p>
        )
      ) : (
        <div className="mb-6">
          {crew.map((m) => {
            const here = fix ? { ...fix, side: areaByName(fix.area)?.side } : null;
            const there = areaByName(m.area);
            const trip = here && there ? travelEstimate(here, there) : null;
            return (
              <div key={m.id} className="card mb-2 flex items-center gap-3 py-3">
                <Face p={m} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-display text-[15px] font-semibold">{m.display_name ?? "A Hopper"}</b>
                  {(m.area || trip) && (
                    <p className="hint">
                      {m.area}
                      {trip && `${m.area ? " · " : ""}${trip.km.toFixed(1)} km · ~${trip.minutes} min away`}
                    </p>
                  )}
                </span>
                <button
                  className="btn btn-ghost w-11 flex-none px-0"
                  aria-label={`Remove ${m.display_name ?? "this Hopper"}`}
                  onClick={() => void remove(m.id)}
                >
                  <UserMinus size={16} aria-hidden />
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
          <span className="w-5 flex-none font-mono text-[11px] font-medium tabular-nums text-dim">
            {i + 1}
          </span>
          <Face p={m} />
          <span className="min-w-0 flex-1">
            <b className="block truncate font-display text-[15px] font-semibold">
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

/** One face rule for every row: their look on the neutral circle, or their initial if they never dressed up. */
function Face({ p }: { p: Pick<Profile, "display_name" | "avatar"> }) {
  return <FaceDisc look={p.avatar} initial={p.display_name ?? undefined} size={36} />;
}

/** Needs an account: anonymous Hoppers get the sign-up here instead. */
export default function CrewPage() {
  return (
    <RequireAccount title="Crew up." caption="Make an account to start a crew, plan moves together and keep your group chats.">
      <CrewPagePage />
    </RequireAccount>
  );
}
