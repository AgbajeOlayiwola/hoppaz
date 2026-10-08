"use client";

import { useState } from "react";
import Link from "next/link";
import { QrCode } from "lucide-react";
import QrScanner from "@/components/QrScanner";
import { useToast } from "@/lib/store";
import type { GameDrop } from "@/lib/game";
import type { CollectibleDrop } from "@/lib/useCollectibles";
import { sentence } from "./copy";

/* eslint-disable @next/next/no-img-element -- collectible art is organiser or Hoppaz supplied, sizes unknown */

type Got = { id: string; title: string; description: string; code?: string; art?: string | null; toCollection?: boolean };

/**
 * One quiet row for everything hidden at a venue (live drops and event
 * collectibles are the same thing to a Hopper). A violet dot, one sentence.
 * Close enough, it becomes a lip button. The result lands as a small stamped
 * card until the full drop reveal exists. Violet is only ever the dot.
 */
export default function DropRow({
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
  closeEnough: boolean;
  gameDrops: GameDrop[];
  gameBusy: string | null;
  /** Runs the existing claim. Returns an error line, or the reward. */
  onClaimGame: (drop: GameDrop, code: string) => Promise<{ error?: string; reward?: string; description?: string; code?: string }>;
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

  const pendingGame = gameDrops.filter((d) => !openedIds.has(d.id));
  const pendingCol = collectibles.filter((d) => !collected.has(d.id) && !openedIds.has(d.id));
  const pending = pendingGame.length + pendingCol.length;
  if (!pending && !got.length) return null;

  const openGame = async (drop: GameDrop) => {
    const res = await onClaimGame(drop, codes[drop.id] ?? "");
    if (res.error) {
      say(sentence(res.error), "error");
      return;
    }
    onOpened(drop.id);
    setGot((g) => [...g, { id: drop.id, title: res.reward ?? "Your reward", description: res.description ?? "", code: res.code }]);
    say("Drop opened.", "violet");
  };

  const openCollectible = async (drop: CollectibleDrop) => {
    const res = await onCollect(drop);
    if (!/ADDED/.test(res)) {
      say(sentence(res), "error");
      return;
    }
    onOpened(drop.id);
    setGot((g) => [
      ...g,
      { id: drop.id, title: drop.collectible.name, description: drop.collectible.description, art: drop.collectible.art_url, toCollection: true },
    ]);
    say("Drop opened.", "violet");
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
              {pendingGame.map((drop) => (
                <div key={drop.id}>
                  {pending > 1 && <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">{drop.title}</p>}
                  {drop.claim_method !== "proximity" && (
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
                  <button className="btn w-full" disabled={gameBusy === drop.id} onClick={() => void openGame(drop)}>
                    {gameBusy === drop.id ? "OPENING…" : "OPEN DROP"}
                  </button>
                </div>
              ))}
              {pendingCol.map((drop) => (
                <div key={drop.id}>
                  {pending > 1 && <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">{drop.collectible.name}</p>}
                  <button className="btn w-full" disabled={collectBusy === drop.id} onClick={() => void openCollectible(drop)}>
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
