"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import LoadingStub from "@/components/app/LoadingStub";
import { deviceTier } from "@/lib/deviceTier";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import AdultSheet from "./room/AdultSheet";
import ChatPanel from "./room/ChatPanel";
import Crossroads from "./room/Crossroads";
import { closedCopy, hereText, todayText } from "./room/copy";
import HeadCard, { type HeadPerson } from "./room/HeadCard";
import RewardMoment from "./room/RewardMoment";
import { useHotspotChat } from "./room/useHotspotChat";
import { useHotspotRoom } from "./room/useHotspotRoom";
import { useKeyboardUp } from "./room/useKeyboardUp";

/** "yaba" until the server names the place ("Jibowu"). */
const titled = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * The hotspot room, full screen over Play (docs/HOTSPOTS.md section 7). Play renders it when the avatar
 * arrives at the junction and takes it away on `onLeave`. It does everything else itself: the account and
 * 18+ gates, entering, staying in, the heads around the junction, the group chat, the reports, the daily
 * reward, and taking the avatar out again.
 *
 * It never sees a position. The one thing it needs from Play is the slug; `name` only fills the title
 * while the server's answer is on its way.
 */
export default function HotspotRoom({ slug, name, onLeave }: { slug: string; name?: string; onLeave: () => void }) {
  const { phase, entered, room, reward, known, retry, recover, leave, askAccount, readAgain } = useHotspotRoom(slug);
  const { profile } = useSession();
  const storedLook = useHoppaz((s) => s.look);
  const [person, setPerson] = useState<HeadPerson | null>(null);
  const typing = useKeyboardUp();

  const place = entered?.hotspot.name ?? known?.place ?? name ?? titled(slug);
  const chat = useHotspotChat(phase.t === "in" ? entered?.channel ?? null : null, entered?.key ?? null);

  const out = () => {
    leave();
    onLeave();
  };

  const band = room?.here_band ?? entered?.here_band ?? "quiet";
  // The server's bands count you, so alone in a room it says "a few"; the stage says "quiet" because it shows the others.
  const others = room ? room.heads.length : null;
  const alone = others === 0 && room?.here_n == null;
  const today = todayText(room?.today_n ?? null);
  const slow = room?.slow ?? entered?.slow;

  return (
    <div role="region" aria-label={`${place} hotspot`} className="fixed inset-0 z-[45] flex flex-col overflow-hidden bg-ink text-cream animate-fade">
      <header className="pad-top flex flex-none items-start gap-3 px-3 pb-3">
        <button type="button" onClick={out} aria-label="Leave the hotspot" className="hz-hud-btn flex-none">
          <ArrowLeft size={20} strokeWidth={2.2} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="line-clamp-2 font-display text-[24px] font-black uppercase leading-[1.05]">{place}</h1>
          <p className="seclabel mt-1.5 truncate">{entered?.hotspot.zone_name ?? known?.zone ?? "Hotspot"} · Always open</p>
        </div>
        {phase.t === "in" && (
          <div className="flex-none pt-1 text-right">
            <span className={clsx("pill", band !== "quiet" && !alone && "pill-keke")}>{hereText(band, room?.here_n ?? null, others)}</span>
            {today && <p className="mt-1.5 font-mono text-[10px] text-dim">{today}</p>}
          </div>
        )}
      </header>

      {phase.t === "in" && entered && slow ? (
        <>
          {!typing && (
            <Crossroads
              heads={room?.heads ?? []}
              youLook={profile?.avatar ?? storedLook}
              youAlias={entered.alias}
              hereBand={band}
              low={deviceTier() === "low"}
              onPick={(h) => setPerson({ key: h.key, alias: h.alias, look: h.look })}
            />
          )}
          <ChatPanel
            msgs={chat.msgs}
            live={chat.live}
            send={chat.send}
            youKey={entered.key}
            slow={slow}
            rules={entered.rules}
            onPick={setPerson}
            onRejoin={() => void recover()}
            typing={typing}
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {phase.t === "loading" && <LoadingStub label="Joining the room" lines={2} />}
          {phase.t === "account" && (
            <div className="card">
              <h2 className="font-display text-[20px] font-black leading-tight">Make an account to join {place}.</h2>
              <p className="hint mt-1">Hotspots are rooms of real people. You need an account to come in and to chat. It takes 20 seconds.</p>
              <div className="mt-4 grid gap-2">
                <button className="btn w-full" onClick={askAccount}>
                  MAKE AN ACCOUNT
                </button>
                <button className="btn btn-ghost w-full" onClick={out}>
                  NOT NOW
                </button>
              </div>
            </div>
          )}
          {phase.t === "adult" && <p className="hint">One quick question before you come in.</p>}
          {phase.t === "closed" && <Closed reason={phase.reason} place={place} onRetry={retry} onBack={out} />}
        </div>
      )}

      <RewardMoment reward={reward} />
      {phase.t === "adult" && <AdultSheet place={place} onYes={retry} onNo={out} />}
      {person && phase.t === "in" && (
        <HeadCard
          person={person}
          onClose={() => setPerson(null)}
          onBlocked={(key) => {
            chat.hide(key);
            void readAgain();
          }}
        />
      )}
    </div>
  );
}

function Closed({ reason, place, onRetry, onBack }: { reason: string; place: string; onRetry: () => void; onBack: () => void }) {
  const c = closedCopy(reason, place);
  return (
    <div className="card" role="status">
      <h2 className="font-display text-[20px] font-black leading-tight">{c.title}</h2>
      <p className="hint mt-1">{c.body}</p>
      <div className="mt-4 grid gap-2">
        {c.retry && (
          <button className="btn w-full" onClick={onRetry}>
            TRY AGAIN
          </button>
        )}
        <button className={clsx("btn w-full", c.retry && "btn-ghost")} onClick={onBack}>
          BACK TO THE MAP
        </button>
      </div>
    </div>
  );
}
