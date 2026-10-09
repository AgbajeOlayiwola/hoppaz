"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import OpenStage, { type ClaimResult, type OpenTier } from "@/components/play/open/OpenStage";
import { onOpenEvent } from "@/components/play/open/events";
import { renderOffline, sfx } from "@/lib/sound/sfx";
import { levelFor } from "@/lib/brand";

type Mode = { tier: OpenTier; fourBox: boolean; refuse: boolean; slow: boolean; xp: number; collectible: boolean; first: boolean };

const TIERS: OpenTier[] = ["common", "rare", "epic", "legendary"];
const XP: Record<OpenTier, number> = { common: 10, rare: 60, epic: 60, legendary: 150 };

/**
 * A stand-in for the Play shell: a plain ground, a fake HUD to fly things into
 * (pips, XP bar, Shelf), and buttons that open each kind of box.
 */
export default function DevOpen() {
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [xp, setXp] = useState(495);
  const [shelf, setShelf] = useState(12);
  const [streak, setStreak] = useState(3);
  const [log, setLog] = useState<string[]>([]);
  const xpRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const pipsRef = useRef<HTMLDivElement>(null);
  const xpBefore = useRef(495);
  const [run, setRun] = useState(0);

  const note = useCallback((t: string) => setLog((l) => [...l.slice(-7), t]), []);

  useEffect(() => {
    sfx.setPlaying(true); // the shell does this on entering Play
    (window as unknown as { __hz: unknown }).__hz = { sfx, renderOffline };
    const off = onOpenEvent((e) => note(e.type + " " + e.tier));
    return () => {
      off();
      sfx.setPlaying(false);
    };
  }, [note]);

  const open = (m: Partial<Mode> & { tier: OpenTier }) => {
    xpBefore.current = xp;
    setRun((n) => n + 1);
    setMode({ fourBox: false, refuse: false, slow: false, collectible: m.tier !== "common" || false, first: true, xp: XP[m.tier], ...m });
    sfx.unlock();
  };

  const claim = async (m: Mode): Promise<ClaimResult> => {
    await new Promise((r) => setTimeout(r, m.slow ? 3500 : 90));
    if (m.refuse) return { ok: false, reason: "sold_out", message: "Somebody got there first." };
    return { ok: true, xp: m.xp, title: m.tier === "legendary" ? "Golden Box" : "Special box", ...(m.collectible ? { collectible: { key: "hop", name: "Golden Hop" } } : {}) };
  };

  const lv = levelFor(xp);
  const rect = (r: React.RefObject<HTMLDivElement | null>) => r.current?.getBoundingClientRect() ?? null;

  return (
    <main className="absolute inset-0 overflow-y-auto bg-ink px-4 pb-10 pt-3 text-cream" style={{ backgroundImage: "radial-gradient(120% 80% at 50% 40%, #2a1f19 0, #0e0b0a 70%)" }}>
      {/* the fake HUD the things fly into */}
      <div className="mx-auto flex max-w-xl items-start justify-between gap-3">
        <div ref={pipsRef} data-testid="pips" className="mt-1 flex gap-1.5 rounded-full border border-line bg-ink-2 px-2.5 py-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className={`block h-2.5 w-2.5 rounded-full border-[1.5px] ${i < streak ? "border-orange bg-orange" : "border-cream/40"}`} />
          ))}
        </div>
        <div className="w-28">
          <div className="mb-1 flex items-baseline justify-between font-mono text-[9px] tracking-[0.08em]">
            <span>LV {lv.index + 1} {lv.name}</span>
            <b className="font-display text-[13px] font-black">{xp}</b>
          </div>
          <div ref={xpRef} data-testid="xpbar" className="h-[9px] overflow-hidden rounded-full border border-cream/10 bg-cream/15">
            <i className="block h-full rounded-full bg-orange transition-[width] duration-500" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
          </div>
        </div>
      </div>

      <section className="mx-auto mt-10 max-w-xl">
        <h1 className="font-display text-2xl font-black">Play: open</h1>
        <p className="mt-1 font-body text-sm text-dim">Dev page. The open moment over a plain ground. XP starts at 495, so a 10 XP box crosses into REGULAR.</p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {TIERS.map((t) => (
            <button key={t} id={`open-${t}`} type="button" className="btn btn-ghost" onClick={() => open({ tier: t, collectible: false })}>
              Open {t}
            </button>
          ))}
          {TIERS.slice(1).map((t) => (
            <button key={t + "c"} id={`open-${t}-card`} type="button" className="btn btn-ghost" onClick={() => open({ tier: t, collectible: true })}>
              {t} with card
            </button>
          ))}
          <button id="open-common-card" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", collectible: true })}>
            common with card
          </button>
          <button id="open-fourbox" type="button" className="btn" onClick={() => open({ tier: "rare", fourBox: true, xp: 50, collectible: true })}>
            Four-box (welcome A)
          </button>
          <button id="open-refused" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", refuse: true })}>
            Refused claim
          </button>
          <button id="open-slow" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", slow: true })}>
            Slow claim (3.5 s)
          </button>
          <button id="open-nostamp" type="button" className="btn btn-ghost" onClick={() => open({ tier: "common", first: false })}>
            Common, not first of day
          </button>
          <button id="mute" type="button" className="btn btn-ghost" aria-pressed={muted} onClick={() => sfx.setMuted(!muted)}>
            {muted ? "Sound off" : "Sound on"}
          </button>
        </div>

        <div className="mt-6 flex items-center gap-4">
          <div ref={shelfRef} data-testid="shelf" className="flex items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2">
            <span className="h-6 w-5 rounded-[3px] border border-cream bg-ink" />
            <span className="font-display text-xl font-black">{shelf}</span>
            <small className="font-mono text-[9px] uppercase tracking-[0.1em] text-dim">Shelf</small>
          </div>
        </div>

        <pre data-testid="log" className="mt-6 whitespace-pre-wrap font-mono text-[11px] leading-5 text-dim">{log.join("\n")}</pre>
      </section>

      {mode && (
        <OpenStage
          key={run}
          drop={{ id: "dev" }}
          tier={mode.tier}
          fourBox={mode.fourBox}
          claim={() => claim(mode)}
          target={{ xp: rect(xpRef), shelf: rect(shelfRef), pips: mode.first ? rect(pipsRef) : null }}
          xpBefore={xpBefore.current}
          onLand={(k, r) => {
            note("land " + k);
            if (k === "xp") setXp((v) => v + r.xp);
            if (k === "collectible") setShelf((v) => v + 1);
            if (k === "stamp") setStreak((v) => Math.min(7, v + 1));
          }}
          onDone={(r) => {
            note("done " + (r.ok ? "ok" : "refused " + r.reason));
            setMode(null);
          }}
          onCancel={() => {
            note("cancel");
            setMode(null);
          }}
        />
      )}
    </main>
  );
}
