"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useGeoPermission } from "@/lib/useLivePosition";
import { useSessionStore } from "@/lib/useSession";
import { usePlayMode } from "@/lib/usePlayMode";
import { runIntroAction } from "@/lib/intro/actions";
import { useIntroBridges } from "@/lib/intro/bridges";
import { readEnv, type IntroEnv } from "@/lib/intro/env";
import { EXTRA, type Line } from "@/lib/intro/lines";
import { currentStep, type IntroCtx } from "@/lib/intro/machine";
import {
  bindIntro,
  introAdvance,
  introDismissNudge,
  introPauseTour,
  introSettle,
  introSkip,
  useIntro,
} from "@/lib/intro/store";
import { stepDef, type StepId } from "@/lib/intro/steps";
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

/** Where a tour card is never right: public posters and staff tools. */
const QUIET = [/^\/report\//, /^\/admin/, /^\/dev\/intro/];
/** After "Add it" the install sheet takes a moment to rise; the card stays out of its way. */
const SHEET_WAIT_MS = 2800;
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
  const save = useIntro((x) => x.save);
  const mapReady = useIntro((x) => x.mapReady);
  const nudge = useIntro((x) => x.nudge);
  const opening = useIntro((x) => x.opening);
  const permission = useGeoPermission();

  const [env, setEnv] = useState<IntroEnv | null>(null);
  const [asked, setAsked] = useState<"locate" | null>(null);
  const [holdUntil, setHoldUntil] = useState(0);
  const [now, setNow] = useState(0);

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
  const pushGranted = envProp?.pushGranted ?? env?.pushGranted ?? false;
  const ctx: IntroCtx | null = useMemo(
    () => (env ? { path, inPlay, standalone, ios, pushGranted } : null),
    [env, path, inPlay, standalone, ios, pushGranted]
  );

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

  // A short clock so "hold" and "quiet" windows end without anything else re-rendering.
  useEffect(() => {
    if (!holdUntil) return;
    setNow(Date.now());
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, holdUntil - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [holdUntil]);
  const holding = holdUntil > now;

  const targets = view?.targets ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const active = !!(view || showNudge) && !!ctx;
  const compact = !!view?.compact;
  const geo = useSpotlight({ targets, enabled: active, reserve: !!view?.reserve, rootRef, ringRef, arrowRef });

  const routeOk = !def?.route || def.route.test(path);
  const waitingForMap = stepId === "welcome" && !mapReady;
  const waitingForTarget = !!view?.needsTarget && !geo.found;
  const quiet = scope === "app" && QUIET.some((re) => re.test(path));
  const hidden = !active || quiet || geo.blocked || opening || holding || (!!view && (!routeOk || waitingForMap || waitingForTarget));

  const onCta = useCallback(() => {
    if (!view?.cta) return;
    if (view.cta.kind === "advance") return introAdvance(view.id);
    const action = view.cta.action;
    void runIntroAction(action);
    if (action === "install") {
      // The install sheet rises a moment after the tap. A real install step is done once it has been offered.
      setHoldUntil(Date.now() + SHEET_WAIT_MS);
      if (view.variant !== "needInstall") introAdvance(view.id);
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
      yourMove: !view.cta,
      skip: view.skip ? { label: view.skip, onClick: () => introSkip(view.id) } : undefined,
      end: view.id === "welcome" || view.id === "me" ? undefined : introPauseTour,
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
