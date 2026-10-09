"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, CalendarDays, CircleUserRound, Crosshair, Layers, Map as MapIcon, MessageSquare, Users, Volume2 } from "lucide-react";
import IntroHost from "@/components/intro/IntroHost";
import { registerIntroAction, runIntroAction } from "@/lib/intro/actions";
import { currentStep, type IntroCtx } from "@/lib/intro/machine";
import { introDevJump, introEvent, introReplay, introReset, introSkip, onIntroEvent, useIntro } from "@/lib/intro/store";
import { STEPS, stepDef, type IntroEventName, type StepId } from "@/lib/intro/steps";

type Screen = "map" | "play" | "today" | "event" | "crew" | "me";

const EVENTS: IntroEventName[] = [
  "map_ready",
  "location_granted",
  "location_denied",
  "location_needed",
  "outside_lagos",
  "play_entered",
  "play_exited",
  "box_opened",
  "welcome_done",
  "install_done",
  "alerts_on",
  "alerts_denied",
  "deck_viewed",
  "event_opened",
  "chat_opened",
  "crew_viewed",
  "me_viewed",
];

/** Which fake screen each step belongs on. */
const SCREEN_FOR: Record<StepId, Screen> = {
  welcome: "map",
  install: "map",
  locate: "map",
  no_location: "map",
  outside: "map",
  face: "map",
  box1: "play",
  box2: "play",
  box_far: "play",
  spawns: "play",
  alerts: "play",
  leave_play: "play",
  deck_go: "map",
  deck: "today",
  chat: "event",
  crew_go: "map",
  crew: "crew",
  me_go: "map",
  me: "me",
};

const EVENT_FOR_SCREEN: Partial<Record<Screen, IntroEventName>> = { play: "play_entered", today: "deck_viewed", event: "event_opened", crew: "crew_viewed", me: "me_viewed" };

const TABS: Array<{ id: Screen | "chat"; label: string; Icon: typeof MapIcon; intro?: string }> = [
  { id: "map", label: "MAP", Icon: MapIcon },
  { id: "today", label: "TODAY", Icon: CalendarDays, intro: "today-tab" },
  { id: "crew", label: "CREW", Icon: Users, intro: "crew-tab" },
  { id: "chat", label: "CHAT", Icon: MessageSquare },
  { id: "me", label: "ME", Icon: CircleUserRound, intro: "me-tab" },
];

/** A small crate in the same cut as the real one, so the ring has something to sit on. */
function MiniCrate({ c, t, r }: { c: string; t: string; r: string }) {
  return (
    <svg viewBox="0 0 48 52" aria-hidden className="block h-full w-full overflow-visible">
      <polygon points="4,16 24,26 24,48 4,38" fill={c} />
      <polygon points="44,16 24,26 24,48 44,38" fill={r} />
      <polygon points="24,6 44,16 24,26 4,16" fill={t} />
      <polygon points="31,9.5 37,12.5 17,22.5 11,19.5" fill="#F5EBDD" opacity=".95" />
    </svg>
  );
}

/** Roads, water and a few dots: enough to look like the map without MapLibre. */
function FakeMap() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink" aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <rect width="400" height="800" fill="rgb(var(--ground))" />
        <path d="M0 640 C90 590 160 650 250 610 C330 575 370 590 400 560 L400 800 L0 800 Z" fill="rgb(var(--lagoon) / .16)" />
        <g stroke="rgb(var(--hairline))" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M-10 120 L410 190" />
          <path d="M-10 300 C100 260 220 330 410 280" />
          <path d="M-10 470 L410 420" />
          <path d="M70 -10 L120 810" />
          <path d="M210 -10 C230 200 190 400 240 810" />
          <path d="M330 -10 L300 810" />
        </g>
        <g stroke="rgb(var(--hairline) / .6)" strokeWidth="1.5" fill="none">
          <path d="M-10 210 L410 250" />
          <path d="M-10 380 L410 360" />
          <path d="M150 -10 L160 810" />
          <path d="M270 -10 L275 810" />
        </g>
        <g fill="#FF4D00">
          <circle cx="102" cy="168" r="6" />
          <circle cx="288" cy="236" r="6" />
          <circle cx="330" cy="392" r="6" />
        </g>
        <g fill="rgb(var(--violet))">
          <circle cx="60" cy="338" r="6" />
          <circle cx="256" cy="480" r="6" />
        </g>
        <g fill="rgb(var(--keke))">
          <circle cx="190" cy="120" r="6" />
          <circle cx="132" cy="520" r="6" />
        </g>
      </svg>
    </div>
  );
}

function FakeSheet({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-x-2 bottom-0 z-40 mx-auto max-h-[78%] max-w-[600px] overflow-y-auto rounded-t-[14px] border border-b-0 border-line bg-ink-2 px-4 pb-6 pt-3 shadow-sheet"
    >
      <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
      <button type="button" onClick={onClose} className="absolute right-3 top-3 font-mono text-[11px] text-dim">
        CLOSE
      </button>
      <h3 className="font-display text-lg font-black">{title}</h3>
      {children}
    </div>
  );
}

export default function DevIntro() {
  const [screen, setScreen] = useState<Screen>("map");
  const [theme, setTheme] = useState<"night" | "day">("night");
  const [panel, setPanel] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [install, setInstall] = useState(false);
  const [ios, setIos] = useState(false);
  const [loc, setLoc] = useState<"granted" | "denied" | "outside">("granted");
  const [log, setLog] = useState<string[]>([]);
  const save = useIntro((s) => s.save);
  const locRef = useRef(loc);
  locRef.current = loc;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const inPlay = screen === "play";
  const path = screen === "today" || screen === "event" ? "/discover" : screen === "crew" ? "/crew" : screen === "me" ? "/me" : "/";

  /* ---- theme: the real app flips it by the Lagos clock; here it is a switch ---- */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const keep = window.setInterval(() => {
      if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
    }, 500);
    return () => window.clearInterval(keep);
  }, [theme]);

  /* ---- a screen change tells the tour what the real page would ---- */
  const go = useCallback((next: Screen) => {
    const prev = screenRef.current;
    setScreen(next);
    if (prev === "play" && next !== "play") introEvent("play_exited");
    const e = EVENT_FOR_SCREEN[next];
    if (e && !(next === "event" && prev === "event")) introEvent(e);
  }, []);

  /* ---- what the buttons do here, in place of the real app ---- */
  useEffect(() => {
    const offs = [
      registerIntroAction("install", () => {
        setInstall(true);
        window.setTimeout(() => setInstall(false), 1800);
      }),
      registerIntroAction("locate", () => {
        window.setTimeout(() => {
          const l = locRef.current;
          if (l === "denied") introEvent("location_denied");
          else if (l === "outside") introEvent("location_granted", { lat: 51.5, lng: -0.12 });
          else introEvent("location_granted", { lat: 6.455, lng: 3.399 });
        }, 900);
      }),
      registerIntroAction("alerts", () => {
        window.setTimeout(() => introEvent("alerts_on"), 500);
      }),
      registerIntroAction("send_avatar", () => {
        window.setTimeout(() => setReveal(true), 1300);
        window.setTimeout(() => {
          setReveal(false);
          introEvent("box_opened");
          introEvent("welcome_done");
        }, 2700);
      }),
    ];
    const offLog = onIntroEvent((n, p) => setLog((l) => [...l.slice(-7), p ? `${n} ${JSON.stringify(p)}` : n]));
    introEvent("map_ready");
    return () => {
      offs.forEach((f) => f());
      offLog();
    };
  }, []);

  /* ---- ?step=... ?theme=... ?panel=1 ?loc= ?ios=1 ---- */
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const q = new URLSearchParams(window.location.search);
    const th = q.get("theme");
    if (th === "day" || th === "night") setTheme(th);
    if (q.get("panel") === "1") setPanel(true);
    if (q.get("ios") === "1") setIos(true);
    const l = q.get("loc");
    if (l === "denied" || l === "outside" || l === "granted") setLoc(l);
    const step = q.get("step") as StepId | null;
    if (step && STEPS.some((s) => s.id === step)) {
      // Give the store a tick to bind to its save, then jump.
      window.setTimeout(() => {
        introDevJump(step, l === "denied" ? { loc: "denied", deferred: true } : l === "outside" ? { loc: "granted", lagos: false } : { loc: "granted", lagos: true });
        setScreen(SCREEN_FOR[step]);
      }, 150);
    }
  }, []);

  const jump = (id: StepId) => {
    introDevJump(id, loc === "denied" ? { loc: "denied", deferred: true } : loc === "outside" ? { loc: "granted", lagos: false } : { loc: "granted", lagos: true, deferred: false });
    setScreen(SCREEN_FOR[id]);
  };

  /* ---- the real Hud's exit arrow gets its data-intro here; the wiring adds it in Hud.tsx ---- */
  const hudExit = useRef<HTMLButtonElement>(null);

  const openBox = (far: boolean) => {
    setReveal(true);
    window.setTimeout(() => {
      setReveal(false);
      introEvent("box_opened");
      if (far) introEvent("welcome_done");
    }, 1500);
  };

  const ctx: IntroCtx = useMemo(() => ({ path, inPlay, standalone: false, ios, pushGranted: false }), [path, inPlay, ios]);
  const now = currentStep(save, ctx);

  const tabBtn = (t: (typeof TABS)[number], i: number) => {
    const on = t.id === screen || (t.id === "today" && screen === "event");
    return (
      <button
        key={i}
        type="button"
        data-intro={t.intro}
        aria-current={on ? "page" : undefined}
        onClick={() => go(t.id === "chat" ? "map" : t.id)}
        className={clsx("flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1", on ? "text-orange" : "text-dim")}
      >
        <t.Icon size={19} strokeWidth={on ? 2.4 : 1.9} aria-hidden />
        <span className="font-mono text-[10px] font-medium tracking-[0.1em]">{t.label}</span>
      </button>
    );
  };

  return (
    <>
      {/* The fake app: covers the real bottom bar and sits under the tour (z 57). */}
      <div className="fixed inset-0 z-[56] flex flex-col overflow-hidden bg-ink text-cream">
        <div className="relative min-h-0 flex-1">
          {(screen === "map" || screen === "play") && <FakeMap />}

          {screen === "map" && (
            <>
              <div className="absolute left-3 right-3 top-[calc(12px+env(safe-area-inset-top,0px))] flex items-center justify-between">
                <span className="rounded-full border border-line bg-ink-2 px-3 py-2 font-mono text-[10.5px] tracking-[0.12em]">LAGOS · TONIGHT</span>
                <button type="button" data-intro="install" className="rounded-full border border-line bg-ink-2 px-3 py-2 font-mono text-[10.5px] tracking-[0.12em] text-dim">
                  ADD TO HOME
                </button>
              </div>
              <button
                type="button"
                data-intro="locate"
                aria-label="Find me"
                onClick={() => introEvent("location_granted", { lat: 6.455, lng: 3.399 })}
                className="absolute right-3 top-[58%] grid h-11 w-11 place-items-center rounded-full border border-line bg-ink-2"
              >
                <Crosshair size={20} aria-hidden />
              </button>
              <button
                type="button"
                data-intro="avatar"
                aria-label="Your avatar. Tap to play."
                onClick={() => go("play")}
                className="absolute left-1/2 top-[44%] -ml-[22px] grid h-11 w-11 place-items-center rounded-full border-2 border-cream/70 bg-ink-3 font-display text-sm font-black"
              >
                JK
                <span className="absolute -bottom-5 rounded bg-violet px-1.5 py-[1px] font-mono text-[8px] tracking-[0.1em] text-brand-cream">PLAY</span>
              </button>
            </>
          )}

          {screen === "play" && (
            <>
              <div className="hz-hud" role="group" aria-label="Play">
                <div className="hz-hud-top">
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      ref={(el) => {
                        hudExit.current = el;
                        el?.setAttribute("data-intro", "play-exit");
                      }}
                      onClick={() => go("map")}
                      aria-label="Back to the events map"
                      className="hz-hud-btn"
                    >
                      <ArrowLeft size={20} strokeWidth={2.2} aria-hidden />
                    </button>
                    <button type="button" aria-label="Sound" className="hz-hud-btn">
                      <Volume2 size={18} strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>
                  <div className="mt-1 flex h-fit gap-1.5 rounded-full border border-line bg-ink-2 px-2.5 py-1.5">
                    {Array.from({ length: 7 }, (_, i) => (
                      <i key={i} className={clsx("block h-2.5 w-2.5 rounded-full border-[1.5px]", i < 3 ? "border-orange bg-orange" : "border-cream/40")} />
                    ))}
                  </div>
                  <button type="button" data-intro="alerts" className="hz-hud-btn" style={{ width: "auto", padding: "0 12px", borderRadius: 9999 }} aria-label="Alerts">
                    <span className="font-mono text-[10px] tracking-[0.12em]">ALERTS</span>
                  </button>
                </div>
                <div className="hz-tray" role="region" aria-label="Your tray">
                  <div className="flex items-center gap-3">
                    <Layers size={24} strokeWidth={1.8} aria-hidden />
                    <div>
                      <span className="num block text-[24px]">0</span>
                      <small className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-dim">Shelf</small>
                    </div>
                  </div>
                  <p className="hz-tray-line">3 welcome boxes for you. Tap one.</p>
                </div>
              </div>
              {/* the player, and three welcome boxes: two near, one far */}
              <span className="absolute left-1/2 top-[50%] -ml-[19px] grid h-11 w-11 place-items-center rounded-full border-2 border-cream/70 bg-ink-3 font-display text-sm font-black">JK</span>
              <button type="button" data-intro="box" aria-label="Welcome box" onClick={() => openBox(false)} className="absolute left-[22%] top-[40%] h-14 w-12">
                <MiniCrate c="#5B2EFF" t="#8A66FF" r="#3A1CB5" />
              </button>
              <button type="button" data-intro="box" aria-label="Welcome box" onClick={() => openBox(false)} className="absolute left-[64%] top-[56%] h-14 w-12">
                <MiniCrate c="#5B2EFF" t="#8A66FF" r="#3A1CB5" />
              </button>
              <button type="button" data-intro="far-box" aria-label="Far welcome box" onClick={() => void runIntroAction("send_avatar")} className="absolute left-[78%] top-[20%] h-14 w-12">
                <MiniCrate c="#F4B728" t="#FFD966" r="#B9830F" />
              </button>
            </>
          )}

          {screen === "today" && (
            <div className="absolute inset-0 overflow-hidden px-4 pt-[calc(16px+env(safe-area-inset-top,0px))]">
              <h2 className="font-display text-2xl font-black">Today</h2>
              <div data-intro="deck" className="mt-4 flex gap-3 overflow-visible">
                {["Detty Sunday", "Rooftop Amapiano", "Comedy Night"].map((t, i) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => go("event")}
                    className="h-[360px] w-[78%] flex-none rounded-[14px] border border-line p-4 text-left"
                    style={{ background: ["#FF4D00", "#5B2EFF", "#1FA847"][i], color: "#0E0B0A" }}
                  >
                    <span className="font-mono text-[10px] tracking-[0.14em]">TAP FOR DETAILS</span>
                    <span className="mt-2 block font-display text-3xl font-black leading-none">{t.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {screen === "event" && (
            <>
              <div className="absolute inset-0 bg-ink px-4 pt-[calc(16px+env(safe-area-inset-top,0px))]">
                <h2 className="font-display text-2xl font-black">Today</h2>
                <div className="mt-4 h-[360px] w-[78%] rounded-[14px] border border-line" style={{ background: "#FF4D00" }} />
              </div>
              <FakeSheet title="Detty Sunday" onClose={() => go("today")}>
                <p className="hint mt-1">Eko Atlantic. Doors 8pm. 3 quests to start.</p>
                <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-hz border border-line bg-line">
                  <button type="button" className="bg-ink-2 px-3 py-3 text-left font-mono text-[11px] tracking-[0.1em]">
                    SHARE
                  </button>
                  <button
                    type="button"
                    data-intro="event-chat"
                    onClick={() => {
                      introEvent("chat_opened");
                    }}
                    className="bg-ink-2 px-3 py-3 text-left font-mono text-[11px] tracking-[0.1em]"
                  >
                    EVENT CHAT
                  </button>
                </div>
              </FakeSheet>
            </>
          )}

          {screen === "crew" && (
            <div className="absolute inset-0 px-4 pt-[calc(16px+env(safe-area-inset-top,0px))]">
              <h2 className="font-display text-2xl font-black">Crew</h2>
              <div className="mt-4 divide-y divide-line overflow-hidden rounded-hz border border-line bg-ink-2">
                {["Ife + Tunde", "Rooftop Gang", "Mainland Boys"].map((n, i) => (
                  <div key={n} className="flex items-center justify-between px-4 py-4">
                    <span className="font-body text-[15px] font-semibold">{n}</span>
                    <span className="num text-lg">{(3 - i) * 120} XP</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {screen === "me" && (
            <div className="absolute inset-0 px-4 pt-[calc(16px+env(safe-area-inset-top,0px))]">
              <h2 className="font-display text-2xl font-black">Me</h2>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["3", "STREAK"],
                  ["12", "SHELF"],
                  ["5", "NIGHTS"],
                ].map(([n, l]) => (
                  <div key={l} className="rounded-hz border border-line bg-ink-2 px-3 py-4">
                    <span className="num block text-3xl">{n}</span>
                    <span className="seclabel mt-1 block">{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* things that must hide the tour */}
          {reveal && (
            <div role="dialog" aria-modal="true" aria-label="Open the box" className="hz-night absolute inset-0 z-50 grid place-items-center bg-ink/90">
              <span className="font-display text-3xl font-black text-orange">LUCKY YOU!</span>
            </div>
          )}
          {sheet && (
            <FakeSheet title="A sheet" onClose={() => setSheet(false)}>
              <p className="hint mt-1">The tour steps aside while any sheet is up, and comes back after.</p>
            </FakeSheet>
          )}
          {install && (
            <div role="dialog" aria-label="Add Hoppaz to your home screen" className="absolute inset-x-0 bottom-0 z-50 border-t border-line bg-ink-2 px-4 pb-8 pt-4">
              <b className="font-display text-xl font-black">Keep Hoppaz on your home screen.</b>
              <p className="hint mt-1">Tap Share, then Add to Home Screen.</p>
            </div>
          )}
        </div>

        {screen !== "play" && (
          <nav aria-label="Main" className="z-30 flex flex-none border-t border-line bg-ink-2" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            {TABS.map(tabBtn)}
          </nav>
        )}
      </div>

      {/* The tour itself, with the fake app's state standing in for the real one. */}
      <IntroHost scope="dev" path={path} inPlay={inPlay} bridges={false} env={{ ios, standalone: false, pushGranted: false }} />

      {/* Controls. Closed by default so screenshots show only the app and the tour. */}
      <button
        type="button"
        onClick={() => setPanel((p) => !p)}
        className="fixed right-2 top-[max(8px,env(safe-area-inset-top,0px))] z-[200] rounded border border-line bg-ink-2 px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-dim"
        style={{ opacity: panel ? 1 : 0.35 }}
      >
        {panel ? "HIDE" : "DEV"}
      </button>
      {panel && (
        <div className="fixed bottom-2 left-2 right-2 top-12 z-[199] mx-auto max-w-[520px] overflow-y-auto rounded-hz border border-line bg-ink-2/95 p-3 text-cream shadow-sheet">
          <p className="seclabel">Now: {now ?? "nothing left"} ({save.status}, {save.mode})</p>

          <p className="seclabel mt-3">Jump to a step</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {STEPS.map((s) => (
              <button key={s.id} type="button" onClick={() => jump(s.id)} className={clsx("chip", now === s.id && "chip-on")}>
                {s.id}
              </button>
            ))}
          </div>

          <p className="seclabel mt-3">Fire an event</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {EVENTS.map((e) => (
              <button
                key={e}
                type="button"
                className="chip"
                onClick={() => introEvent(e, e === "location_granted" ? { lat: 6.455, lng: 3.399 } : undefined)}
              >
                {e}
              </button>
            ))}
          </div>

          <p className="seclabel mt-3">World</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(["map", "play", "today", "event", "crew", "me"] as Screen[]).map((s) => (
              <button key={s} type="button" aria-pressed={screen === s} className="chip" onClick={() => go(s)}>
                screen: {s}
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={theme === "day"} onClick={() => setTheme((t) => (t === "day" ? "night" : "day"))}>
              theme: {theme}
            </button>
            <button type="button" className="chip" aria-pressed={ios} onClick={() => setIos((v) => !v)}>
              iphone not installed
            </button>
            <button type="button" className="chip" aria-pressed={sheet} onClick={() => setSheet((v) => !v)}>
              fake sheet
            </button>
            {(["granted", "denied", "outside"] as const).map((l) => (
              <button key={l} type="button" className="chip" aria-pressed={loc === l} onClick={() => setLoc(l)}>
                locate gives: {l}
              </button>
            ))}
          </div>

          <p className="seclabel mt-3">Tour</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" className="chip" onClick={() => now && introSkip(now)}>
              skip current
            </button>
            <button type="button" className="chip" onClick={() => introReplay()}>
              replay
            </button>
            <button type="button" className="chip" onClick={() => introReset()}>
              reset
            </button>
          </div>

          <p className="seclabel mt-3">Events heard</p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-dim">{log.join("\n") || "none yet"}</pre>
          <p className="seclabel mt-3">Save</p>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-dim">{JSON.stringify({ ...save, updatedAt: undefined })}</pre>
          <p className="hint mt-3">Step def: {now ? stepDef(now).targets.join(", ") || "no target" : "none"}</p>
        </div>
      )}
    </>
  );
}
