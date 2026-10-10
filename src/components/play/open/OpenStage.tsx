"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Reveal, { type RevealItem, type RevealOutcome } from "@/components/reveal/Reveal";
import { canStampHere, preloadCard, stampCard } from "@/lib/cards";
import { sfx } from "@/lib/sound/sfx";
import { useToast } from "@/lib/store";
import { useSessionStore } from "@/lib/useSession";
import s from "./OpenStage.module.css";
import { createOpenEngine, type OpenEngine } from "./engine";
import { emitOpenEvent } from "./events";
import type { ClaimOk, ClaimResult, LandKind, OpenTargets, OpenTier } from "./types";

export type { ClaimOk, ClaimRefused, ClaimResult, LandKind, OpenEvent, OpenTargets, OpenTier } from "./types";
export { onOpenEvent } from "./events";

export type OpenStageProps = {
  /** The box being opened (the shell's own drop object). The stage does not read it. */
  drop?: unknown;
  tier: OpenTier;
  /** Claims the box. Called once, at the swipe start. A refusal is handled quietly on the stage. */
  claim: () => Promise<ClaimResult>;
  /** Where things fly to, as screen rects. A null rect falls back to where the HUD normally sits. */
  target: OpenTargets;
  /** The moment the last thing has landed (or the box was refused). The shell unmounts the stage and refreshes its numbers. */
  onDone: (result: ClaimResult) => void;
  /** The player put the box back before swiping. Nothing was claimed. */
  onCancel: () => void;
  /** Welcome A, the Golden Box and Hop or staff drops: hand off to the four-box Reveal, then fly the result into the tray. */
  fourBox: boolean;

  /* ---- optional extras (the shell may leave these out) ---- */
  /** Where the crate was on screen (client px), so it can rise from there. Default: from low centre. */
  origin?: { x: number; y: number } | null;
  /** Fly the daily stamp to the pips. Default: true when target.pips is a rect, false when it is null. */
  firstOfDay?: boolean;
  /** The player's XP before this box, for the level-up moment. Default: the session profile's xp. */
  xpBefore?: number | null;
  /** Fires as each thing lands, so the shell can tick its own counters at that instant. */
  onLand?: (kind: LandKind, result: ClaimOk) => void;
  /** The four-box Reveal's heading. Default "Welcome box". */
  label?: string;
};

const FAIL = "That didn't open. Try again in a bit.";

/**
 * The open moment: a full-screen layer over the map. The crate rises to the
 * middle (the map dims to 40 percent), the player swipes across the tape (a tap
 * works too), the tape rips and the box bursts by tier, the rewards fan out and
 * fly to the XP bar, the Shelf and the streak pips. Rare, Epic and Legendary
 * add the card flip; Legendary adds 600 ms of silence, rays and a shake. A box that
 * pays a deck card (res.card) shows it face up at its own rarity, any box colour, with
 * NEW on a first copy and "Stamp it" when the player stands inside its circle.
 *
 * The drawing is imperative (see engine.ts): transform and opacity only, no
 * layout reads while it runs, no second WebGL context. The sounds are in
 * src/lib/sound/sfx.ts.
 */
export default function OpenStage(props: OpenStageProps) {
  const { tier, fourBox } = props;
  const latest = useRef(props);
  latest.current = props;

  const [host, setHost] = useState<HTMLElement | null>(null);
  const [live, setLive] = useState("");
  const [gone, setGone] = useState(false);
  const [phase, setPhase] = useState<"reveal" | "stage">(fourBox ? "reveal" : "stage");
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<OpenEngine | null>(null);
  const claimed = useRef<Promise<ClaimResult> | null>(null);
  const resultRef = useRef<ClaimResult | null>(null);
  const doneRef = useRef(false);
  const xp0 = useRef<number | null>(null);

  useEffect(() => {
    setHost(document.body);
    xp0.current = latest.current.xpBefore ?? useSessionStore.getState().profile?.xp ?? null;
  }, []);

  const finishWith = (r: ClaimResult) => {
    if (doneRef.current) return;
    doneRef.current = true;
    latest.current.onDone(r);
    setTimeout(() => setGone(true), 400);
  };

  /* ------------------------------------------------- the stage (own draw) -- */
  useEffect(() => {
    if (!host || phase !== "stage") return;
    const root = rootRef.current;
    const stage = stageRef.current;
    const dim = dimRef.current;
    if (!root || !stage || !dim) return;
    sfx.acquire();
    const eng = createOpenEngine({
      root,
      stage,
      dim,
      tier,
      claim: () => latest.current.claim(),
      targets: () => latest.current.target,
      origin: () => latest.current.origin ?? null,
      firstOfDay: () => latest.current.firstOfDay ?? latest.current.target.pips != null,
      xpBefore: () => xp0.current,
      share: (title) => void shareCard(title),
      stamp: (card) => stampCard(card.id),
      canStamp: (card) => canStampHere(card),
      onLand: (k, r) => latest.current.onLand?.(k, r),
      onDone: finishWith,
      onCancel: () => {
        if (doneRef.current) return;
        doneRef.current = true;
        latest.current.onCancel();
        setTimeout(() => setGone(true), 400);
      },
      say: setLive,
    });
    engineRef.current = eng;
    const r = resultRef.current;
    if (fourBox && r && r.ok) eng.flyOnly(r);
    else eng.start();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        eng.key("escape");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      eng.destroy();
      engineRef.current = null;
      sfx.release();
    };
    // finishWith only reads refs; the engine must not restart when props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, phase, tier]);

  /* ------------------------------------------------------ the four boxes -- */
  const openForReveal = async (): Promise<RevealOutcome> => {
    emitOpenEvent({ type: "open-start", tier });
    const p = (async (): Promise<ClaimResult> => {
      try {
        return await latest.current.claim();
      } catch {
        return { ok: false, reason: "error", message: FAIL };
      }
    })();
    claimed.current = p;
    const r = await p;
    resultRef.current = r;
    emitOpenEvent({ type: "open-claimed", tier, result: r });
    if (!r.ok) return { error: r.message || FAIL };
    const items: RevealItem[] = [{ kind: "xp", title: `${r.xp} XP` }];
    if (r.card) {
      preloadCard(r.card);
      items.push({ kind: "card", title: r.card.name, card: r.card });
    } else if (r.collectible) items.push({ kind: "collectible", title: r.collectible.name });
    return { items };
  };

  const afterReveal = async (didClaim: boolean) => {
    if (doneRef.current) return;
    // Closed while the claim was still on its way: wait for it, it counts.
    const r = resultRef.current ?? (didClaim && claimed.current ? await claimed.current : null);
    if (r && r.ok) setPhase("stage");
    else if (r) {
      emitOpenEvent({ type: "open-done", tier, result: r });
      finishWith(r);
    } else {
      emitOpenEvent({ type: "open-cancel", tier });
      doneRef.current = true;
      latest.current.onCancel();
    }
  };

  if (gone) return null;
  if (fourBox && phase === "reveal") {
    return <Reveal label={props.label ?? "Welcome box"} kicker="WELCOME BOX" doneLine="It's in your tray." open={openForReveal} onClose={(c) => void afterReveal(c)} />;
  }
  if (!host) return null;

  return createPortal(
    <div ref={rootRef} className={s.root} role="dialog" aria-modal="true" aria-label="Open the box">
      <div ref={dimRef} className={s.dim} />
      <div ref={stageRef} className={s.stage} />
      <div className={s.srOnly} role="status" aria-live="polite">
        {live}
      </div>
      <button type="button" className={s.srOnly} onClick={() => engineRef.current?.cancel()}>
        Put the box back
      </button>
    </div>,
    host
  );
}

/** Share the card: the phone's share sheet if it has one, otherwise copy. Quiet on cancel. */
async function shareCard(title: string) {
  const say = useToast.getState().say;
  const text = `I opened ${title} on Hoppaz.`;
  const url = window.location.origin;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Hoppaz", text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    say("Copied. Send it to your people.", "ok");
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    say("Couldn't share that. Try again.", "error");
  }
}
