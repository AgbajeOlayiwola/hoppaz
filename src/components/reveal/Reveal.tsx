"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Share2, X } from "lucide-react";
import Mascot, { type MascotState } from "@/components/Mascot";
import Serial from "@/components/me/Serial";
import { useToast } from "@/lib/store";
import { artUrl, cardLabel, copyLine, type WonCard } from "@/lib/cards";
import { haptics } from "@/lib/haptics";
import { RARITY } from "@/lib/huntItems";
import { sfx } from "@/lib/sound/sfx";
import { flyStarsToMe } from "./starFlight";

/* eslint-disable @next/next/no-img-element -- collectible art is Hoppaz or partner supplied, sizes unknown */

/** One thing that comes out of the box, face up. A "card" is a deck card: `card` is what the claim answered. */
export type RevealItem = {
  kind: "reward" | "xp" | "collectible" | "card";
  title: string;
  line?: string;
  code?: string;
  art?: string | null;
  card?: WonCard;
};
/** What opening the box came to: the things inside, or why it would not open. */
export type RevealOutcome = { items: RevealItem[] } | { error: string };

type Phase = "sealed" | "chosen" | "torn" | "pulled" | "done" | "failed";

const BOXES = [0, 1, 2, 3];
/** Each box sits a few degrees off square, the same way every time. */
const TILT = [-3, 2, 1.5, -2];
/** How far across the tape a drag has to go before it tears. */
const TEAR_AT = 0.62;
/** How far a card has to be thrown before it counts as flicked away. */
const FLICK_AT = 90;
/** The Common drum rings about 0.8 s, and a UI tick is skipped while a Moment sounds: the first card counts up after it. */
const DRUM_MS = 850;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The drop reveal, the one extravagance in the app. Four frames:
 *   sealed: four sealed boxes, pick one;
 *   chosen: the box comes forward, drag across its tape to tear it;
 *   torn: the tape splits, the lid comes off;
 *   pulled: what is inside comes out face up, one at a time; flick each away.
 * Then the summary, one share action, and the stars fly to the Me tab.
 *
 * The four boxes are a ritual, not a lottery: the reward is decided on the
 * server (open), whichever box you pick, and the others are never opened.
 * The mascot keeps the secret before the reveal and wins after it.
 *
 * Built for partner drops and collectibles now, and deck cards (a box that pays a card shows it face up, NEW on a
 * first copy); the daily box reuses it, with
 * its own words for the top bar, the last frame and the share line (it is not a
 * drop, and nothing lands on the shelf).
 *
 * It is loud on purpose, a first box is the first reward (GAMIFY-NEXT 5.2): a click
 * on pick, the rip on the tear, the Common drum as the first card comes out, a tick
 * as an XP number counts up, a flip on each flick. Every one is on a tap or a drag,
 * none on load, and each sits with a picture and a buzz (haptics.ts).
 */
export default function Reveal({
  label,
  where,
  kicker,
  doneLine,
  shareLine,
  open,
  onClose,
}: {
  /** What is being opened: "Free round on the house", "Night box". */
  label: string;
  /** Where it was found: the venue or the partner. Goes in the share line. */
  where?: string | null;
  /** The top bar label. Default "DROP · <label>". */
  kicker?: string;
  /** What the last frame says under "In the bag." Default says it is on the shelf. */
  doneLine?: string;
  /** The share text, given what was pulled. Default "I pulled <what> at <where> on Hoppaz." */
  shareLine?: (what: string) => string;
  /** Claims the drop. Called once, the moment a box is picked. */
  open: () => Promise<RevealOutcome>;
  /** claimed: the drop was opened (even if the Hopper closed before seeing it all). */
  onClose: (claimed: boolean) => void;
}) {
  const say = useToast((s) => s.say);
  const [phase, setPhase] = useState<Phase>("sealed");
  const [picked, setPicked] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<RevealOutcome | null>(null);
  const [tear, setTear] = useState(0);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [gone, setGone] = useState<{ dx: number; dy: number } | null>(null);
  const tearFrom = useRef<{ x: number; w: number } | null>(null);
  const flickFrom = useRef<{ x: number; y: number } | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Sound runs while the reveal is on screen, even where the app lane is off.
  useEffect(() => {
    sfx.acquire();
    return () => sfx.release();
  }, []);

  const items = outcome && "items" in outcome ? outcome.items : [];
  const claimed = items.length > 0;
  const error = outcome && "error" in outcome ? outcome.error : null;

  /* ------------------------------------------------------------- frames -- */
  const pick = (i: number) => {
    if (started.current) return;
    started.current = true;
    setPicked(i);
    setPhase("chosen");
    haptics.buzz("pick");
    sfx.click();
    // The claim goes off now, so the result is usually in before the tape is torn.
    void open()
      .then(setOutcome)
      .catch(() => setOutcome({ error: "That didn't open. Try again in a bit." }));
  };

  // A refusal (too far, closed, sold out) shows on the sealed box: there is nothing to tear.
  useEffect(() => {
    if (error) setPhase("failed");
  }, [error]);

  const finishTear = () => {
    setTear(1);
    setPhase("torn");
    haptics.buzz("tear");
    sfx.rip();
  };

  // Torn and the result is in: the tape flies off, then the first thing comes out.
  useEffect(() => {
    if (phase !== "torn" || !claimed) return;
    const t = setTimeout(
      () => {
        sfx.talkingDrum("common");
        setPhase("pulled");
      },
      reduced() ? 0 : 520
    );
    return () => clearTimeout(t);
  }, [phase, claimed]);

  const next = (to: { dx: number; dy: number } = { dx: 0, dy: -420 }) => {
    if (gone) return; // the card is already leaving: one flip, one buzz
    setGone(to);
    setDrag(null);
    haptics.buzz("snap");
    sfx.flip();
    setTimeout(
      () => {
        setGone(null);
        if (index + 1 < items.length) setIndex(index + 1);
        else setPhase("done");
      },
      reduced() ? 0 : 220
    );
  };

  // Closed between picking a box and the answer coming back: the claim is already on its way, so it counts as opened
  // (the map must not reopen the box's sheet for a box that is being claimed). A refusal that has come back does not.
  const close = () => onClose(claimed || (started.current && !error));

  const done = async () => {
    const r = summary.current?.getBoundingClientRect();
    onClose(true);
    if (r) await flyStarsToMe({ x: r.left + r.width / 2, y: r.top + r.height / 3 });
  };

  const share = async () => {
    const what = items.find((x) => x.kind !== "xp")?.title ?? label;
    const text = shareLine ? shareLine(what) : `I pulled ${what}${where ? ` at ${where}` : ""} on Hoppaz.`;
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
  };

  // Escape closes, except mid-tear and mid-flick where a stray key should not lose the moment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "sealed" || phase === "failed" || phase === "done") onClose(claimed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, claimed, onClose]);

  /* -------------------------------------------------------------- words -- */
  const mascot: MascotState = phase === "failed" ? "oops" : phase === "pulled" ? "win" : phase === "done" ? "celebrate" : "secret";
  const head =
    phase === "sealed"
      ? "Pick a box."
      : phase === "chosen"
        ? "Tear it open."
        : phase === "torn"
          ? claimed
            ? "Here it comes."
            : "Opening..."
          : phase === "pulled"
            ? "You got"
            : phase === "done"
              ? "In the bag."
              : "Not this time.";
  const sub =
    phase === "sealed"
      ? "Four sealed. Whichever you pick is yours."
      : phase === "chosen"
        ? "Drag across the tape."
        : phase === "pulled"
          ? items.length > 1
            ? `${index + 1} of ${items.length}. Flick it away for the next.`
            : "Flick it away when you're done looking."
          : phase === "done"
            ? (doneLine ?? "It's on your shelf. The bus keeps count.")
            : phase === "failed"
              ? error
              : "";

  /* ------------------------------------------------------------- render -- */
  const item = items[index];
  const cardMove = gone ?? drag;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={kicker ?? `Drop: ${label}`} className="hz-night hz-reveal fixed inset-0 z-[60] flex flex-col bg-ink text-cream">
      <div aria-hidden className="hz-grain pointer-events-none absolute inset-0" />

      {/* -------------------------------------------------------- top bar -- */}
      <div className="pad-top relative flex flex-none items-center justify-between gap-3 px-4">
        <p className="seclabel flex min-w-0 items-center gap-2 pt-1">
          <i aria-hidden className="h-2 w-2 flex-none rounded-full bg-violet" />
          <span className="truncate">{kicker ?? `DROP · ${label}`}</span>
        </p>
        <button type="button" onClick={close} aria-label="Close" className="-mr-2 grid h-11 w-11 flex-none place-items-center text-dim hover:text-cream">
          <X size={20} />
        </button>
      </div>

      <div className="relative px-5 pt-3">
        <h2 className="font-display text-[34px] font-black leading-none tracking-[-0.01em]" aria-live="polite">
          {head}
        </h2>
        {sub && <p className="mt-2 min-h-[20px] font-body text-[15px] leading-snug text-dim">{sub}</p>}
      </div>

      {/* ---------------------------------------------------------- stage -- */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-5">
        {phase === "sealed" && (
          <div className="grid grid-cols-2 gap-5">
            {BOXES.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => pick(i)}
                aria-label={`Box ${i + 1} of 4`}
                className="hz-box-in rounded-[10px] focus-visible:outline-offset-4"
                style={{ ["--d" as string]: `${i * 70}ms`, rotate: `${TILT[i]}deg` }}
              >
                <Box size={128} />
              </button>
            ))}
          </div>
        )}

        {(phase === "chosen" || phase === "torn" || phase === "failed") && picked !== null && (
          <div className="relative grid place-items-center">
            {/* The sun behind the box, the brand's one flat disc. */}
            <span aria-hidden className={clsx("hz-sun absolute h-64 w-64 rounded-full bg-orange", phase === "failed" && "opacity-20")} />
            <div
              className={clsx(
                "relative",
                phase === "chosen" && "hz-box-forward",
                phase === "torn" && !claimed && "hz-box-shake",
                phase === "failed" && "hz-box-shake-once"
              )}
              style={{ rotate: `${TILT[picked]}deg` }}
            >
              <Box
                size={208}
                tear={tear}
                torn={phase === "torn"}
                onTearStart={(x, w) => {
                  if (phase !== "chosen") return;
                  tearFrom.current = { x, w };
                }}
                onTearMove={(x) => {
                  const f = tearFrom.current;
                  if (!f || phase !== "chosen") return;
                  const t = Math.max(0, Math.min(1, (x - f.x) / f.w));
                  setTear(t);
                  if (t >= TEAR_AT) {
                    tearFrom.current = null;
                    finishTear();
                  }
                }}
                onTearEnd={() => {
                  if (!tearFrom.current) return;
                  tearFrom.current = null;
                  setTear(0);
                }}
              />
            </div>
          </div>
        )}

        {phase === "pulled" && item && (
          <div
            key={index}
            className="hz-pull-in relative touch-none select-none"
            style={{
              transform: cardMove ? `translate(${cardMove.dx}px, ${cardMove.dy}px) rotate(${cardMove.dx / 14}deg)` : undefined,
              transition: gone ? "transform .22s cubic-bezier(.4,0,1,1), opacity .22s" : drag ? "none" : "transform .2s ease-out",
              opacity: gone ? 0 : 1,
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              flickFrom.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const f = flickFrom.current;
              if (f) setDrag({ dx: e.clientX - f.x, dy: e.clientY - f.y });
            }}
            onPointerUp={() => {
              const d = drag;
              flickFrom.current = null;
              if (d && (Math.abs(d.dx) > FLICK_AT || d.dy < -FLICK_AT)) next({ dx: d.dx * 4, dy: d.dy * 4 });
              else setDrag(null);
            }}
            onPointerCancel={() => {
              flickFrom.current = null;
              setDrag(null);
            }}
          >
            <PulledCard item={item} wait={index === 0 ? DRUM_MS : 300} />
          </div>
        )}

        {phase === "done" && (
          <div ref={summary} className="hz-pull-in stub stub-day w-[min(100%,300px)] px-4 pb-4 pt-3.5" style={{ ["--notch-y" as string]: "calc(100% - 46px)" }}>
            <p className="seclabel">FROM {(where ?? label).toUpperCase()}</p>
            <ul className="mt-2 space-y-1.5">
              {items.map((x, i) => (
                <li key={i} className="font-display text-[18px] font-black leading-tight">
                  {x.title}
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-dashed border-line pt-3">
              <button type="button" onClick={() => void share()} className="flex min-h-[32px] items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream">
                <Share2 size={14} className="text-orange" aria-hidden /> SHARE WHAT YOU PULLED
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------- mascot and actions -- */}
      <div className="pad-bottom relative flex flex-none items-end gap-3 px-4 pb-4">
        <div className="hz-scrap grid h-[92px] w-[84px] flex-none place-items-center">
          <Mascot state={mascot} size={70} edge="ink" label="The Hoppaz mascot" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
          {phase === "chosen" && (
            <button type="button" className="btn btn-ghost w-full" onClick={finishTear}>
              TEAR IT OPEN
            </button>
          )}
          {phase === "pulled" && (
            <button type="button" className="btn btn-ghost w-full" onClick={() => next()}>
              {index + 1 < items.length ? "NEXT" : "THAT'S IT"}
            </button>
          )}
          {phase === "done" && (
            <button type="button" className="btn w-full" onClick={() => void done()}>
              DONE
            </button>
          )}
          {phase === "failed" && (
            <button type="button" className="btn btn-ghost w-full" onClick={close}>
              BACK
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * A sealed Hoppaz box: cream, square, the H mark on its face, a violet tape
 * across the middle with an ember lip under it. Drag along the tape to tear it.
 */
function Box({
  size,
  tear = 0,
  torn = false,
  onTearStart,
  onTearMove,
  onTearEnd,
}: {
  size: number;
  tear?: number;
  torn?: boolean;
  onTearStart?: (x: number, width: number) => void;
  onTearMove?: (x: number) => void;
  onTearEnd?: () => void;
}) {
  const live = !!onTearStart;
  return (
    <span className={clsx("hz-box relative block", torn && "hz-box-torn")} style={{ width: size, height: size }}>
      <span aria-hidden className="hz-box-lid absolute inset-x-0 top-0 h-[22%]" />
      <span aria-hidden className="hz-box-mark absolute left-1/2 top-[63%] h-[26%] w-[22%] -translate-x-1/2 -translate-y-1/2" />
      <span
        className={clsx("hz-box-tape absolute inset-x-0 top-[34%] h-[17%]", live && "cursor-grab touch-none")}
        onPointerDown={(e) => {
          if (!live) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          onTearStart?.(e.clientX, r.width);
        }}
        onPointerMove={(e) => onTearMove?.(e.clientX)}
        onPointerUp={() => onTearEnd?.()}
        onPointerCancel={() => onTearEnd?.()}
      >
        {/* The two halves of the tape: they part along the tear and fly off when it goes. */}
        <span aria-hidden className="hz-tape-l absolute inset-y-0 left-0" style={{ width: `${(tear || 0) * 100}%` }} />
        <span aria-hidden className="hz-tape-r absolute inset-y-0 right-0" style={{ width: `${(1 - (tear || 0)) * 100}%` }} />
        <span aria-hidden className="hz-tape-word pointer-events-none absolute inset-0 grid place-items-center">
          SEALED · HOPPAZ
        </span>
      </span>
    </span>
  );
}

/** One thing out of the box, face up: a ticket stub for a reward, art for a collectible, a big number for XP. `wait` is how long the XP number holds at 0 before it counts up. */
function PulledCard({ item, wait }: { item: RevealItem; wait: number }) {
  if (item.kind === "card" && item.card) return <PulledDeckCard card={item.card} />;
  if (item.kind === "xp") {
    const xp = /^(\+?)(\d+)\s*XP$/i.exec(item.title);
    return (
      <div className="stub stub-night grid w-[min(80vw,280px)] place-items-center px-6 py-9 text-center">
        <p className="num text-[84px] leading-none text-orange">{xp ? <CountUp sign={xp[1]} to={Number(xp[2])} wait={wait} /> : item.title.replace(/\s*XP$/i, "")}</p>
        <p className="seclabel mt-3">XP</p>
        {item.line && <p className="hint mt-2">{item.line}</p>}
      </div>
    );
  }
  return (
    <div className="stub stub-day w-[min(80vw,300px)] overflow-hidden" style={{ ["--notch-y" as string]: item.code ? "calc(100% - 74px)" : "60%" }}>
      {item.art ? (
        <img src={item.art} alt="" draggable={false} className="h-40 w-full border-b border-line object-cover" />
      ) : (
        <div aria-hidden className="hz-pulled-art h-24 border-b border-line" />
      )}
      <div className="px-4 pb-4 pt-3">
        <p className="seclabel">{item.kind === "collectible" ? "FOR YOUR SHELF" : "YOU GOT"}</p>
        <p className="mt-1.5 font-display text-[26px] font-black leading-[1.05]">{item.title}</p>
        {item.line && <p className="hint mt-1.5">{item.line}</p>}
      </div>
      {item.code && (
        <div className="border-t border-dashed border-line px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
          <Serial code={item.code} />
        </div>
      )}
    </div>
  );
}

/**
 * A deck card out of the box: its own front image in an edge of its rarity colour, NEW stuck on the corner of a first copy,
 * and what this copy was under it. If the image cannot load, a plate with the name and rarity stands in.
 */
function PulledDeckCard({ card }: { card: WonCard }) {
  const [broken, setBroken] = useState(false);
  const color = RARITY[card.rarity].color;
  const tags = [copyLine(card, card.copyNo), card.lifted ? `Guaranteed ${card.rarity}` : null, card.isNew ? null : "Another copy", card.visited ? "Visited" : null].filter(Boolean);
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[min(58vw,224px)] overflow-visible" style={{ aspectRatio: "5 / 8" }}>
        <div
          className="absolute inset-0 overflow-hidden rounded-[14px] bg-ink-2"
          style={{ boxShadow: `0 0 0 3px ${color}, 0 0 34px ${color}66` }}
        >
          {broken ? (
            <div className="grid h-full place-content-center gap-2 px-4 text-center">
              <p className="font-display text-[20px] font-black leading-tight">{card.name}</p>
              <p className="seclabel" style={{ color }}>
                {RARITY[card.rarity].label}
              </p>
            </div>
          ) : (
            <img src={artUrl(card, "front")} alt={cardLabel(card)} draggable={false} decoding="async" onError={() => setBroken(true)} className="h-full w-full object-cover" />
          )}
        </div>
        {card.isNew && (
          <span className="absolute -left-3 -top-4 -rotate-6 rounded-[6px] bg-orange px-2 py-1 font-mono text-[10px] font-medium tracking-[0.14em] text-brand-ink shadow-chunk-sm">
            NEW
          </span>
        )}
      </div>
      {tags.length > 0 && <p className="seclabel mt-3.5 text-center">{tags.join(" · ")}</p>}
    </div>
  );
}

/**
 * The XP number counting up from 0 in 50 ms steps, as the "+30" under the XP bar does in the open, with the
 * same rising tick. With reduced motion it is just the number. Screen readers get the whole number, not the count.
 */
function CountUp({ sign, to, wait }: { sign: string; to: number; wait: number }) {
  const still = reduced() || to <= 0;
  const [n, setN] = useState(still ? to : 0);

  useEffect(() => {
    if (still) return;
    const steps = Math.max(2, Math.min(to, 10));
    let i = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      iv = setInterval(() => {
        i++;
        setN(Math.round((to * i) / steps));
        // the UI lane lets two ticks through a second, so they go partway and on the number landing
        if (i === steps || i === steps - 4) sfx.tick(Math.ceil(i / 2));
        if (i >= steps) clearInterval(iv);
      }, 50);
    }, wait);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [still, to, wait]);

  return (
    <>
      <span className="sr-only">
        {sign}
        {to}
      </span>
      <span aria-hidden>
        {sign}
        {n}
      </span>
    </>
  );
}
