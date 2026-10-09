"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Camera, Lock, MapPin } from "lucide-react";
import QrScanner from "@/components/QrScanner";
import Reveal, { type RevealItem, type RevealOutcome } from "@/components/reveal/Reveal";
import { sentence } from "@/components/event/copy";
import PerforatedStub from "@/components/me/PerforatedStub";
import Serial from "@/components/me/Serial";
import SpotMascot from "@/components/me/SpotMascot";
import SubHeader from "@/components/me/SubHeader";
import { DEMO, demoDrops, demoEmpty, demoReceipts, demoReveal } from "@/components/me/demo";
import { closesLabel, closingSoon, dropPhase, opensLabel } from "@/components/me/dropTime";
import { useNow } from "@/components/me/useNow";
import { useSession } from "@/lib/useSession";
import { useHoppaz, useToast } from "@/lib/store";
import { useGameDrops, type GameDrop } from "@/lib/game";
import { loadDropReceipts } from "@/lib/useCollectibles";

type Reveal = { reward?: string; description?: string; code?: string; xp?: number };

const HOW: Record<GameDrop["claim_method"], string> = {
  proximity: "Claim it at the venue.",
  qr: "Scan the venue code to claim.",
  either: "Claim at the venue, or scan its code.",
  avatar: "Send your avatar to open it, in Play.",
};

/**
 * Live drops, the rewards that land at venues. A drop that has not opened yet
 * is sealed (a button that says when, and cannot be pressed). An open one
 * shows CLAIM and when it closes. A closed one is gone from the list.
 */
export default function DropsPage() {
  const { userId } = useSession();
  const { fix } = useHoppaz();
  const live = useGameDrops(undefined, { staffOnly: true });
  const say = useToast((s) => s.say);
  const now = useNow(15_000);

  const [demo, setDemo] = useState<GameDrop[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, Reveal>>({});
  /** The drop being opened in the reveal. */
  const [opening, setOpening] = useState<GameDrop | null>(null);
  /** Drops you had already claimed when you opened the page (they sort last and stay put while you claim). */
  const [had, setHad] = useState<Set<string>>(new Set());
  /** Claimed in this visit. */
  const [justNow, setJustNow] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (DEMO) {
      setDemo(demoEmpty() ? [] : demoDrops(Date.now()));
      setHad(new Set(demoReceipts(Date.now()).map((r) => r.drop_id)));
      return;
    }
    let on = true;
    void loadDropReceipts(userId).then((rows) => {
      if (on) setHad(new Set(rows.map((r) => r.drop_id)));
    });
    return () => {
      on = false;
    };
  }, [userId]);

  const drops = DEMO ? demo : live.drops;
  const ready = (DEMO || live.ready) && now !== null;

  const { open, sealed } = useMemo(() => {
    if (now === null) return { open: [] as GameDrop[], sealed: [] as GameDrop[] };
    const by = (a: GameDrop, b: GameDrop, key: "opens_at" | "closes_at") => Date.parse(a[key]) - Date.parse(b[key]);
    return {
      // Closing soonest first; the ones you already have go last.
      open: drops
        .filter((d) => dropPhase(d, now) === "open")
        .sort((a, b) => Number(had.has(a.id)) - Number(had.has(b.id)) || by(a, b, "closes_at")),
      sealed: drops.filter((d) => dropPhase(d, now) === "sealed").sort((a, b) => by(a, b, "opens_at")),
    };
  }, [drops, now, had]);

  /** Runs the claim for the reveal. What you got also stays on the stub once the reveal closes. */
  const claim = async (d: GameDrop): Promise<RevealOutcome> => {
    const result: Reveal & { error?: string } = DEMO ? demoReveal() : await live.claim(d, fix, codes[d.id]);
    if (result.error) return { error: sentence(result.error) };
    setRevealed((r) => ({ ...r, [d.id]: result }));
    setJustNow((c) => new Set(c).add(d.id));
    const items: RevealItem[] = [{ kind: "reward", title: result.reward ?? "Your reward", line: result.description, code: result.code }];
    if (result.xp) items.push({ kind: "xp", title: `+${result.xp} XP`, line: "Added to your XP." });
    return { items };
  };

  const card = (d: GameDrop, phase: "open" | "sealed") => {
    const got = revealed[d.id];
    const done = had.has(d.id) || justNow.has(d.id);
    const soon = phase === "open" && !done && now !== null && closingSoon(d, now);
    return (
      <PerforatedStub
        key={d.id}
        className="mb-3"
        top={
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="seclabel flex min-w-0 items-center gap-2">
                <i aria-hidden className={`h-2 w-2 flex-none rounded-full ${soon || done ? "bg-dim" : "bg-violet"}`} />
                <span className="truncate">{d.partner?.name ?? "HOPPAZ DROP"}</span>
              </p>
              {phase === "sealed" ? (
                <span className="pill flex-none">
                  <Lock size={11} aria-hidden /> SEALED
                </span>
              ) : done ? (
                <span className="pill pill-keke flex-none">CLAIMED</span>
              ) : (
                <span className={`pill flex-none ${soon ? "pill-danfo" : ""}`}>{closesLabel(d.closes_at, now ?? undefined)}</span>
              )}
            </div>
            <h2 className="mt-2.5 font-display text-[21px] font-black leading-tight">{d.title}</h2>
            {d.description && <p className="hint mt-1">{d.description}</p>}
            <p className="mt-3 flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-dim">
              <MapPin size={12} aria-hidden className="flex-none" />
              <span className="truncate">{d.area ?? "At the venue"}</span>
            </p>
            <p className="hint mt-1">{HOW[d.claim_method]}</p>
          </>
        }
        bottom={
          phase === "sealed" ? (
            <button type="button" disabled className="btn w-full border border-line font-mono text-[12px] font-medium tracking-[0.08em]">
              {now === null ? "SEALED" : opensLabel(d.opens_at, now)}
            </button>
          ) : got ? (
            <div>
              <div className="animate-stamp origin-left">
                <p className="seclabel">YOU GOT</p>
                <p className="mt-1 font-display text-[22px] font-black leading-tight">{got.reward ?? "Your reward"}</p>
              </div>
              {got.description && <p className="hint mt-1">{got.description}</p>}
              {got.code && (
                <div className="mt-3 border-t border-dashed border-line pt-3">
                  <Serial code={got.code} />
                </div>
              )}
              {!!got.xp && <p className="mt-3 font-mono text-[10.5px] font-medium tracking-[0.08em] text-dim">+{got.xp} XP</p>}
            </div>
          ) : done ? (
            <Link href="/collection" className="btn btn-ghost w-full">
              SEE IT ON YOUR SHELF
            </Link>
          ) : (
            <>
              {d.claim_method !== "proximity" && (
                <div className="mb-3 flex gap-2">
                  <input
                    placeholder="Venue code"
                    aria-label={`Venue code for ${d.title}`}
                    autoCapitalize="characters"
                    value={codes[d.id] ?? ""}
                    onChange={(e) => setCodes({ ...codes, [d.id]: e.target.value })}
                  />
                  <button type="button" className="btn btn-ghost flex-none px-3" onClick={() => setScanning(d.id)} aria-label="Scan the QR code">
                    <Camera size={18} aria-hidden />
                  </button>
                </div>
              )}
              <button type="button" className="btn w-full" onClick={() => setOpening(d)}>
                OPEN IT
              </button>
            </>
          )
        }
      />
    );
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <SubHeader backHref="/me" backLabel="Me" title="Live drops" caption="REWARDS THAT LAND AT VENUES" />

      {!ready ? (
        <p className="hint">Checking what&apos;s live.</p>
      ) : open.length + sealed.length === 0 ? (
        <div className="flex flex-col items-center px-6 pb-8 pt-8 text-center">
          <SpotMascot state="secret" size={120} label="The Hoppaz mascot, keeping a secret" />
          <p className="mt-4 font-display text-[22px] font-black">No drops live.</p>
          <p className="hint mt-1">They land at the venue.</p>
          <Link href="/discover" className="btn mt-5 px-5 text-[12.5px]">
            SEE TONIGHT
          </Link>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section aria-label="Open now">
              <p className="seclabel mb-2.5">OPEN NOW · {open.length}</p>
              {open.map((d) => card(d, "open"))}
            </section>
          )}
          {sealed.length > 0 && (
            <section aria-label="Coming up" className={open.length ? "mt-6" : undefined}>
              <p className="seclabel mb-2.5">COMING UP · {sealed.length}</p>
              {sealed.map((d) => card(d, "sealed"))}
            </section>
          )}
        </>
      )}

      {opening && (
        <Reveal
          label={opening.title}
          where={opening.partner?.name ?? opening.area}
          open={() => claim(opening)}
          onClose={() => setOpening(null)}
        />
      )}

      {scanning && (
        <QrScanner
          onRead={(value) => {
            setCodes({ ...codes, [scanning]: value });
            setScanning(null);
            say("Code read.", "ok");
          }}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}
