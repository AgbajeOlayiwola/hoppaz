"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useGeoPermission } from "@/lib/useLivePosition";
import { useSessionStore } from "@/lib/useSession";
import { usePlayMode } from "@/lib/usePlayMode";
import { runIntroAction } from "@/lib/intro/actions";
import { accountReady, makeCtx } from "@/lib/intro/active";
import { useIntroBridges } from "@/lib/intro/bridges";
import { readEnv, type IntroEnv } from "@/lib/intro/env";
import { useInstallPrompt, usePromptWindow } from "@/lib/intro/install";
import { EXTRA, type Line } from "@/lib/intro/lines";
import { currentStep, type IntroCtx } from "@/lib/intro/machine";
import {
  bindIntro,
  introAdvance,
  introDismissNudge,
  introMarkReturning,
  introPauseTour,
  introSettle,
  introSkip,
  useIntro,
} from "@/lib/intro/store";
import { INTRO_QUIET, stepDef, type StepId } from "@/lib/intro/steps";
import { resolveView } from "@/lib/intro/view";
import IntroCard, { type CardProps } from "./IntroCard";
import { useSpotlight } from "./useSpotlight";
import s from "./intro.module.css";

/**
 * Paz's first-run tour, mounted once (layout.tsx). It draws nothing unless a
 * step is current, never takes a tap outside its own card, and steps aside for
 * every sheet, the open stage and the sign-up sheet.
 *
 * Props are for the dev page: `scope` keeps its saves apart, and `path`,
 * `inPlay` and `bridges` let it stand in for the real app.
 */

/** The party moments get a bigger Paz. */
const BIG: StepId[] = ["welcome", "outside", "box2", "me"];

export default function IntroHost({
  scope = "app",
  path: pathProp,
  inPlay: inPlayProp,
  bridges = true,
  env: envProp,
}: {
  scope?: string;
  path?: string;
  inPlay?: boolean;
  bridges?: boolean;
  env?: Partial<IntroEnv>;
}) {
  const pathname = usePathname();
  const path = pathProp ?? pathname ?? "/";
  const playActive = usePlayMode((x) => x.active);
  const inPlay = inPlayProp ?? playActive;
  const userId = useSessionStore((x) => x.userId);
  const profile = useSessionStore((x) => x.profile);
  const email = useSessionStore((x) => x.email);
  const sessionState = useSessionStore((x) => x.state);
  const canPrompt = useInstallPrompt((x) => !!x.prompt);
  const promptWindow = usePromptWindow();
  const save = useIntro((x) => x.save);
  const mapReady = useIntro((x) => x.mapReady);
  const nudge = useIntro((x) => x.nudge);
  const opening = useIntro((x) => x.opening);
  const permission = useGeoPermission();

  const [env, setEnv] = useState<IntroEnv | null>(null);
  const [asked, setAsked] = useState<"locate" | null>(null);

  useEffect(() => {
    setEnv(readEnv());
    const again = () => setEnv(readEnv());
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

  useEffect(() => {
    bindIntro({ scope, userId, profile: (profile as unknown as Record<string, unknown> | null) ?? null });
  }, [scope, userId, profile]);

  useIntroBridges(bridges);

  const standalone = envProp?.standalone ?? env?.standalone ?? false;
  const ios = envProp?.ios ?? env?.ios ?? false;
  const iosBrowser = envProp?.iosBrowser ?? envProp?.ios ?? env?.iosBrowser ?? false;
  const android = envProp?.android ?? env?.android ?? false;
  const pushGranted = envProp?.pushGranted ?? env?.pushGranted ?? false;
  const hasAccount = !!email;
  // With no database (the local demo) or offline there is no account to make, so the tour asks for none.
  const accountOk = accountReady(email, sessionState);
  const ctx: IntroCtx | null = useMemo(
    () => (env ? makeCtx(path, inPlay, { standalone, ios, iosBrowser, android, pushGranted }, accountOk, canPrompt, promptWindow) : null),
    // The Android install step waits a moment for the browser's prompt, so the context is worked out again when the wait ends.
    [env, path, inPlay, standalone, ios, iosBrowser, android, pushGranted, accountOk, canPrompt, promptWindow]
  );

  // An account with XP on a device with no save (the installed iPhone app after a log-in): their boxes are long open.
  const returning = hasAccount && (profile?.xp ?? 0) > 0;
  useEffect(() => {
    if (returning) introMarkReturning();
  }, [returning, save.status]);

  // Steps that are already true are marked seen; a tour with nothing left is done.
  useEffect(() => {
    if (ctx) introSettle(ctx);
  }, [ctx, save]);

  // The location nudge ("Boxes need your location") wins over the next step: the Hopper just ran into it.
  const showNudge = nudge && save.deferred && !!ctx;
  const stepId = ctx && save.status === "running" && !showNudge ? currentStep(save, ctx) : null;
  const view = stepId && ctx ? resolveView(stepId, save, ctx) : null;
  const def = stepId ? stepDef(stepId) : null;

  const nudgeCard: Line = permission === "denied" ? EXTRA.locationBlocked : EXTRA.locationAgain;

  // The step's "busy" ends when the thing it asked for has happened, or after a while.
  useEffect(() => {
    if (!asked) return;
    const t = setTimeout(() => setAsked(null), 15_000);
    return () => clearTimeout(t);
  }, [asked]);
  useEffect(() => {
    if (save.loc !== "unknown") setAsked(null);
  }, [save.loc]);

  const targets = view?.targets ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const active = !!(view || showNudge) && !!ctx;
  const compact = !!view?.compact;
  const geo = useSpotlight({ targets, enabled: active, reserve: !!view?.reserve, rootRef, ringRef, arrowRef });

  const routeOk = !def?.route || def.route.test(path);
  const waitingForMap = stepId === "welcome" && !mapReady;
  // Android: the browser's install prompt has not arrived yet; the step holds for it a moment, then moves on.
  const waitingForPrompt = stepId === "install" && ctx?.install === "wait";
  const waitingForTarget = !!view?.needsTarget && !geo.found;
  const quiet = scope === "app" && INTRO_QUIET.some((re) => re.test(path));
  const hidden = !active || quiet || geo.blocked || opening || (!!view && (!routeOk || waitingForMap || waitingForPrompt || waitingForTarget));

  const onCta = useCallback(() => {
    if (!view?.cta) return;
    if (view.cta.kind === "advance") return introAdvance(view.id);
    const action = view.cta.action;
    const id = view.id;
    const done = runIntroAction(action, id);
    // Android: the browser's own prompt answers (yes or no), then the tour carries on in the same session.
    if (action === "install") void done.then(() => introAdvance(id));
    // iPhone: they did the two taps (said so), so the stop card comes next. Late, from the alerts card, the event does it all.
    else if (action === "added") {
      if (id === "install") introAdvance(id);
    } else if (action === "locate") setAsked("locate");
  }, [view]);

  const onNudgeCta = useCallback(() => {
    if (permission === "denied") return introDismissNudge();
    void runIntroAction("locate");
    setAsked("locate");
    // The answer arrives as location_granted or location_denied, which closes the nudge.
  }, [permission]);

  if (!ctx) return null;

  let card: CardProps | null = null;
  if (view) {
    const locating = view.id === "locate" && asked === "locate" && save.loc === "unknown";
    card = {
      stepKey: `${view.id}:${view.variant}`,
      big: view.variant === "step" && BIG.includes(view.id),
      compact,
      mascot: view.mascot,
      title: view.title,
      line: locating ? EXTRA.locateWaiting : view.line,
      count: view.count,
      cta: view.cta ? { label: locating ? "Waiting" : view.cta.label, onClick: onCta, busy: locating } : undefined,
      yourMove: view.yourMove,
      picture: view.picture,
      skip: view.skip ? { label: view.skip, onClick: () => introSkip(view.id) } : undefined,
      end: view.id === "welcome" || view.id === "me" || view.id === "open_app" ? undefined : introPauseTour,
    };
  } else if (showNudge) {
    card = {
      stepKey: `nudge:${permission}`,
      mascot: "oops",
      title: nudgeCard.title,
      line: nudgeCard.line,
      cta: { label: nudgeCard.cta ?? "Okay", onClick: onNudgeCta, busy: asked === "locate" && save.loc === "unknown" },
      skip: nudgeCard.skip ? { label: nudgeCard.skip, onClick: introDismissNudge } : undefined,
    };
  }

  const at = geo.zone === "lower" ? "top" : "bottom";
  return (
    <div ref={rootRef} className={s.root} data-intro-root data-hidden={hidden} data-paz="left">
      <div ref={ringRef} className={s.ring} aria-hidden>
        <i className={s.halo} />
        <i className={s.ringLine} />
      </div>
      <div ref={arrowRef} className={s.arrow} aria-hidden data-side="above">
        <span className={s.arrowBob}>
          <svg viewBox="0 0 30 36" width="30" height="36" style={{ display: "block", overflow: "visible", transform: geo.zone === "upper" ? "rotate(180deg)" : undefined }}>
            <path d="M15 33 L2 15 H10 V3 H20 V15 H28 Z" fill="#FF4D00" stroke="#0E0B0A" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      {card && (
        <div className={s.dock} data-at={at} data-big={!!card.big} data-compact={compact}>
          <IntroCard {...card} />
        </div>
      )}
    </div>
  );
}
