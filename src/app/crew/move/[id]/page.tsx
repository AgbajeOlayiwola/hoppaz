"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, MapPin } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { useToast } from "@/lib/store";
import { moveChannel } from "@/lib/chat";
import { dayLabel } from "@/lib/filters";
import RoomView from "@/components/chat/RoomView";

type Move = { id: string; title: string; starts_at: string; meetup: string | null; crew: { name: string } | null };

/**
 * A crew move's chat: everyone in the crew who said I'M IN. Saying MAYBE or
 * CAN'T GO on the move takes you out of it; the server decides who's in.
 */
export default function MoveChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const say = useToast((s) => s.say);
  const { userId, hasAccount } = useSession();
  const [move, setMove] = useState<Move | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const [m, r] = await Promise.all([
      sb.from("crew_moves").select("id,title,starts_at,meetup,crew:crews(name)").eq("id", id).maybeSingle(),
      sb.from("crew_move_rsvps").select("status").eq("move_id", id).eq("user_id", userId).maybeSingle(),
    ]);
    // Not in the crew, the move is invisible (RLS): treat it as gone.
    if (!m.data) return setState("missing");
    setMove(m.data as unknown as Move);
    setMine((r.data as { status: string } | null)?.status ?? null);
    setState("ready");
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const imIn = async () => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    setBusy(true);
    const { error } = await sb
      .from("crew_move_rsvps")
      .upsert({ move_id: id, user_id: userId, status: "going", updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) return say("Couldn't save that. Try again.", "error");
    setMine("going");
    say("You're in.", "ok");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4">
      <header className="pad-top flex flex-none items-center gap-1 pb-4">
        <button onClick={() => router.push("/crew")} aria-label="Back to crew" className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream">
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[22px] font-black leading-tight">{move?.title ?? "Crew move"}</h1>
          <p className="seclabel flex items-center gap-1.5 truncate">
            {move ? (
              <>
                {move.crew?.name ? `${move.crew.name.toUpperCase()} · ` : ""}
                {dayLabel(move.starts_at)}
                {move.meetup && (
                  <>
                    <MapPin size={11} aria-hidden className="flex-none" />
                    <span className="truncate">{move.meetup}</span>
                  </>
                )}
              </>
            ) : (
              "CREW MOVE CHAT"
            )}
          </p>
        </div>
      </header>

      {state === "loading" ? (
        <p className="hint">Opening the chat…</p>
      ) : state === "missing" ? (
        <p className="hint">This move isn&apos;t in any of your crews. Join the crew with its invite code first.</p>
      ) : mine !== "going" ? (
        <div className="card">
          <p className="font-display text-sm font-black">This chat is for everyone who&apos;s in</p>
          <p className="hint mt-1">Say I&apos;M IN to the move and you&apos;re in the chat with the rest of the crew who are coming.</p>
          <button className="btn mt-3 w-full" disabled={busy} onClick={() => void imIn()}>
            {busy ? "SAVING…" : "I'M IN"}
          </button>
        </div>
      ) : (
        <RoomView
          channel={moveChannel(id)}
          people={{ kind: "move", id }}
          userId={userId}
          hasAccount={hasAccount}
          note="EVERYONE WHO'S IN"
          empty="You're in. Sort out where you're meeting."
          noPeople="Nobody else is in yet. Nudge the crew."
          placeholder="Message everyone who's in"
        />
      )}
    </div>
  );
}
