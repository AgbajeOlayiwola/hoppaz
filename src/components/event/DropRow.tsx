"use client";

import { useState } from "react";
import Link from "next/link";
import { QrCode } from "lucide-react";
import QrScanner from "@/components/QrScanner";
import Reveal, { type RevealItem, type RevealOutcome } from "@/components/reveal/Reveal";
import { useToast } from "@/lib/store";
import { clockShort } from "@/lib/geo";
import type { GameDrop } from "@/lib/game";
import type { CollectibleDrop } from "@/lib/useCollectibles";
import { sentence } from "./copy";

/* eslint-disable @next/next/no-img-element -- collectible art is organiser or Hoppaz supplied, sizes unknown */

type Got = { id: string; title: string; description: string; code?: string; art?: string | null; toCollection?: boolean };

/**
 * One quiet row for everything hidden at a venue (live drops and event
 * collectibles are the same thing to a Hopper). A violet dot, one sentence.
 * Close enough, it becomes a lip button that opens the drop reveal (four
 * sealed boxes). What you got stays on the card afterwards as a small stamp.
 */
export default function DropRow({
  where,
  closeEnough,
  gameDrops,
  gameBusy,
  onClaimGame,
  collectibles,
  collected,
  collectBusy,
  onCollect,
  openedIds,
  onOpened,
}: {
  /** The event's name, for the reveal's share line. */
  where?: string;
  closeEnough: boolean;
  gameDrops: GameDrop[];
  gameBusy: string | null;
  /** Runs the existing claim. Returns an error line, or the reward. */
  onClaimGame: (drop: GameDrop, code: string) => Promise<{ error?: string; reward?: string; description?: string; code?: string; xp?: number }>;
  collectibles: CollectibleDrop[];
  collected: Set<string>;
  collectBusy: string | null;
  /** Runs the existing collect. Returns the legacy one-line result. */
  onCollect: (drop: CollectibleDrop) => Promise<string>;
  /** Drops you have already opened (earlier visits, and just now). They are not hidden here any more. */
  openedIds: Set<string>;
  onOpened: (id: string) => void;
}) {
  const say = useToast((s) => s.say);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [got, setGot] = useState<Got[]>([]);
  const [reveal, setReveal] = useState<{ kind: "game"; drop: GameDrop } | { kind: "col"; drop: CollectibleDrop } | null>(null);

  const pendingGame = gameDrops.filter((d) => !openedIds.has(d.id));
  const pendingCol = collectibles.filter((d) => !collected.has(d.id) && !openedIds.has(d.id));
  const pending = pendingGame.length + pendingCol.length;
  if (!pending && !got.length) return null;

  /** Runs the claim for the reveal. What you got also stays on the card once the reveal closes. */
  const openGame = async (drop: GameDrop): Promise<RevealOutcome> => {
    const res = await onClaimGame(drop, codes[drop.id] ?? "");
    if (res.error) return { error: sentence(res.error) };
    onOpened(drop.id);
    setGot((g) => [...g, { id: drop.id, title: res.reward ?? "Your reward", description: res.description ?? "", code: res.code }]);
    const items: RevealItem[] = [{ kind: "reward", title: res.reward ?? "Your reward", line: res.description, code: res.code }];
    if (res.xp) items.push({ kind: "xp", title: `+${res.xp} XP`, line: "Added to your XP." });
    return { items };
  };

  const openCollectible = async (drop: CollectibleDrop): Promise<RevealOutcome> => {
    const res = await onCollect(drop);
    if (!/ADDED/.test(res)) return { error: sentence(res) };
    onOpened(drop.id);
    setGot((g) => [
      ...g,
      { id: drop.id, title: drop.collectible.name, description: drop.collectible.description, art: drop.collectible.art_url, toCollection: true },
    ]);
    return { items: [{ kind: "collectible", title: drop.collectible.name, line: drop.collectible.description, art: drop.collectible.art_url }] };
  };

  return (
    <section className="px-5 pt-6" aria-label="Drop">
      {pending > 0 && (
        <>
          <p className="flex items-start gap-2.5 font-body text-[14px] leading-snug text-cream">
            <i aria-hidden className="mt-[7px] h-2 w-2 flex-none rounded-full bg-violet" />
            <span>
              {pending === 1 ? "A drop is hidden here" : `${pending} drops are hidden here`} · open {pending === 1 ? "it" : "them"} at the venue
            </span>
          </p>

          {closeEnough && (
            <div className="mt-3 space-y-3">
              {pendingGame.map((drop) => {
                // The server refuses a claim before the drop opens, so the button waits for it too.
                const opens = Date.parse(drop.opens_at);
                const notYet = Number.isFinite(opens) && opens > Date.now();
                return (
                  <div key={drop.id}>
                    {pending > 1 && <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">{drop.title}</p>}
                    {!notYet && drop.claim_method !== "proximity" && (
                      <div className="mb-2 flex gap-2">
                        <input
                          aria-label="Venue code"
                          value={codes[drop.id] ?? ""}
                          onChange={(e) => setCodes({ ...codes, [drop.id]: e.target.value })}
                          placeholder="Venue code"
                        />
                        <button type="button" className="btn btn-ghost w-11 flex-none px-0" onClick={() => setScanFor(drop.id)} aria-label="Scan the venue code">
                          <QrCode size={18} />
                        </button>
                      </div>
                    )}
                    <button className="btn w-full disabled:border disabled:border-line" disabled={notYet || gameBusy === drop.id} onClick={() => setReveal({ kind: "game", drop })}>
                      {notYet ? `OPENS AT ${clockShort(drop.opens_at)}` : gameBusy === drop.id ? "OPENING…" : "OPEN DROP"}
                    </button>
                  </div>
                );
              })}
              {pendingCol.map((drop) => (
                <div key={drop.id}>
                  {pending > 1 && <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">{drop.collectible.name}</p>}
                  <button className="btn w-full" disabled={collectBusy === drop.id} onClick={() => setReveal({ kind: "col", drop })}>
                    {collectBusy === drop.id ? "OPENING…" : "OPEN DROP"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {got.map((g) => (
        <div key={g.id} role="status" className="mt-3 animate-stamp rounded-hz border border-line bg-ink-3 p-3">
          <p className="flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-dim">
            <i aria-hidden className="h-2 w-2 rounded-full bg-violet" /> YOU GOT
          </p>
          <div className="mt-2 flex items-center gap-3">
            {g.art && <img src={g.art} alt="" className="h-14 w-14 flex-none rounded-hz border border-line object-cover" />}
            <div className="min-w-0">
              <b className="block font-display text-[18px] font-black leading-tight">{g.title}</b>
              {g.description && <p className="hint mt-0.5">{g.description}</p>}
            </div>
          </div>
          {g.code && <p className="mt-2 inline-block rounded-[4px] border border-dashed border-line px-2 py-1 font-mono text-[13px] tracking-[0.12em]">{g.code}</p>}
          {g.toCollection && (
            <p className="mt-2">
              <Link href="/collection" className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline decoration-orange decoration-2 underline-offset-4">
                SEE YOUR COLLECTION
              </Link>
            </p>
          )}
        </div>
      ))}

      {reveal && (
        <Reveal
          label={reveal.kind === "game" ? reveal.drop.title : reveal.drop.collectible.name}
          where={where}
          open={() => (reveal.kind === "game" ? openGame(reveal.drop) : openCollectible(reveal.drop))}
          onClose={() => setReveal(null)}
        />
      )}

      {scanFor && (
        <QrScanner
          onRead={(value) => {
            setCodes({ ...codes, [scanFor]: value });
            setScanFor(null);
            say("Code read.", "ok");
          }}
          onClose={() => setScanFor(null)}
        />
      )}
    </section>
  );
}
