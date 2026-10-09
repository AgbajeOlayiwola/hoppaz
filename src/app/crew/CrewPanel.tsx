"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Copy, MapPin, MessageSquare } from "lucide-react";
import { useToast } from "@/lib/store";
import { dayLabel } from "@/lib/filters";
import { clockShort } from "@/lib/geo";
import { themeForEvent } from "@/lib/theme";
import type { CrewGroup, CrewMove } from "@/lib/game";

export type Rsvp = "going" | "maybe" | "cant_go";

const RSVPS: Array<{ status: Rsvp; label: string; said: string }> = [
  { status: "going", label: "I'M IN", said: "You're in. Here's the chat." },
  { status: "maybe", label: "MAYBE", said: "Marked as maybe." },
  { status: "cant_go", label: "CAN'T GO", said: "Marked as can't go." },
];

/**
 * One crew: its name, its invite code printed like a ticket serial, the form to
 * plan a move, and every planned move as a ticket stub with its RSVP chips.
 * I'M IN puts you in the move's chat with everyone else who's in, and opens it.
 */
export default function CrewPanel({
  group,
  events,
  moving,
  onPlan,
  onSubmit,
  onRsvp,
}: {
  group: CrewGroup;
  events: { id: string; title: string }[];
  moving: boolean;
  onPlan: () => void;
  onSubmit: (move: { title: string; meetup: string | null; starts_at: string; note: string; event_id: string | null }) => void;
  onRsvp: (moveId: string, status: Rsvp) => Promise<boolean>;
}) {
  const say = useToast((s) => s.say);
  const router = useRouter();
  // Your saved answer comes with the move; this holds a tap until the reload brings it back.
  const [chosen, setChosen] = useState<Record<string, Rsvp>>({});

  const answer = async (move: CrewMove, status: Rsvp, said: string) => {
    const ok = await onRsvp(move.id, status);
    if (ok) setChosen((c) => ({ ...c, [move.id]: status }));
    say(ok ? said : "Couldn't save that. Try again.", ok ? "ok" : "error");
    if (ok && status === "going") router.push(`/crew/move/${move.id}`);
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-display text-[19px] font-black leading-tight">{group.name}</h2>
        <span className="pill flex-none">{group.visibility}</span>
      </div>

      <InviteSerial code={group.invite_code} />

      <button
        type="button"
        className={clsx("btn mt-3 w-full", moving && "btn-ghost")}
        aria-expanded={moving}
        onClick={onPlan}
      >
        PLAN A MOVE
      </button>

      {moving && (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onSubmit({
              title: String(f.get("title")),
              meetup: String(f.get("meetup") || "") || null,
              starts_at: new Date(String(f.get("starts_at"))).toISOString(),
              note: String(f.get("note") || ""),
              event_id: String(f.get("event_id") || "") || null,
            });
          }}
        >
          <input name="title" required placeholder="What’s the move?" aria-label="What's the move?" />
          <input name="meetup" placeholder="Where to meet" aria-label="Where to meet" />
          <input name="starts_at" required type="datetime-local" aria-label="When" />
          <select name="event_id" aria-label="Which event">
            <option value="">General crew move</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
          <input name="note" placeholder="Extra details" aria-label="Extra details" />
          <button className="btn w-full">SAVE THE MOVE</button>
        </form>
      )}

      {(group.crew_moves ?? []).map((move) => (
        <MoveStub key={move.id} move={move} chosen={chosen[move.id] ?? move.mine ?? undefined} onAnswer={(status, said) => void answer(move, status, said)} />
      ))}
    </div>
  );
}

/**
 * The invite code, printed like the serial on a ticket: DM Mono, spaced out,
 * on a dashed tear line, with a copy button. Same job as before: copy it, say COPIED.
 */
function InviteSerial({ code }: { code: string }) {
  const say = useToast((s) => s.say);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      say("Couldn't copy. Hold the code to copy it.", "error");
    }
  };

  return (
    <div className="mt-3 flex items-center gap-3 rounded-hz border border-dashed border-line px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="seclabel">Invite code</p>
        <p className="mt-0.5 select-all truncate font-mono text-[16px] font-medium tracking-[0.18em]">{code}</p>
      </div>
      <button type="button" onClick={copy} className="btn btn-ghost flex-none px-3 text-[12px]" aria-label={`Copy invite code ${code}`}>
        <Copy size={13} aria-hidden /> {copied ? "COPIED" : "COPY"}
      </button>
    </div>
  );
}

/** "SAT 18 OCT · 10PM", Lagos time, also for moves that are already behind you. */
function whenLabel(startsAt: string) {
  const label = dayLabel(startsAt);
  if (label !== "ENDED") return label;
  const day = new Date(startsAt)
    .toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" })
    .toUpperCase()
    .replace(",", "");
  return `${day} · ${clockShort(startsAt)}`;
}

/** The y of the tear line, so the two punched notches sit on it like a real ticket. */
function useTearY() {
  const stub = useRef<HTMLElement>(null);
  const tear = useRef<HTMLDivElement>(null);
  const [y, setY] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (tear.current) setY(Math.round(tear.current.offsetTop + tear.current.offsetHeight / 2));
    };
    measure();
    const el = stub.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { stub, tear, y };
}

/** A planned move as a ticket stub. It follows its own start time: cream card by day, dark by night. */
function MoveStub({
  move,
  chosen,
  onAnswer,
}: {
  move: CrewMove;
  chosen?: Rsvp;
  onAnswer: (status: Rsvp, said: string) => void;
}) {
  const theme = themeForEvent(move.starts_at);
  const past = dayLabel(move.starts_at) === "ENDED";
  const { stub, tear, y } = useTearY();

  return (
    <article
      ref={stub}
      className={clsx("stub mt-3 px-4 pt-4", theme === "day" ? "stub-day" : "stub-night bg-ink-3")}
      style={y == null ? undefined : ({ "--notch-y": `${y}px` } as React.CSSProperties)}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-display text-[18px] font-black leading-tight">{move.title}</h3>
        {past && <span className="pill flex-none">PAST</span>}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] uppercase tracking-[0.06em] text-dim">
        <span>{whenLabel(move.starts_at)}</span>
        {move.meetup && (
          <>
            <span aria-hidden>·</span>
            <MapPin size={11} aria-hidden />
            <span className="min-w-0 break-words">{move.meetup}</span>
          </>
        )}
      </p>
      {move.note && <p className="hint mt-1.5">{move.note}</p>}
      <div ref={tear} className="mt-3 border-t border-dashed border-line" />
      {chosen === "going" && (
        <Link href={`/crew/move/${move.id}`} className="btn mt-3 w-full">
          <MessageSquare size={15} aria-hidden /> OPEN THE CHAT{move.going ? ` · ${move.going} IN` : ""}
        </Link>
      )}
      <div className="flex gap-2 py-3" role="group" aria-label={`Are you in for ${move.title}?`}>
        {RSVPS.map(({ status, label, said }) => (
          <button
            key={status}
            type="button"
            className="chip min-h-[44px] flex-1 px-1"
            aria-pressed={chosen === status}
            onClick={() => onAnswer(status, said)}
          >
            {label}
          </button>
        ))}
      </div>
    </article>
  );
}
