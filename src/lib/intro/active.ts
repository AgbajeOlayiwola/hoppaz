"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useToast } from "@/lib/store";
import { supabaseConfigured } from "@/lib/supabase/client";
import { usePlayMode } from "@/lib/usePlayMode";
import { useSessionStore } from "@/lib/useSession";
import { readEnv, type IntroEnv } from "./env";
import { promptWindowOpen, useInstallPrompt } from "./install";
import { EXTRA } from "./lines";
import { currentStep, type InstallKind, type IntroCtx, type IntroSave } from "./machine";
import { INTRO_QUIET, stepDef, type StepId } from "./steps";
import { useIntro } from "./store";

/**
 * "Is the tour running right now?" The one flag Ola's gates read (the sign-up
 * sheet, the Crew and Me walls, the install sheet, the first-run location
 * sheet), so Paz's tour is not a string of pop-ups.
 *
 * It is true only while Paz is really with the Hopper: the tour is running and
 * the step it is on belongs on this screen. A Hopper who wandered off to a page
 * the step does not expect, ended the tour, finished it, or sits on the iPhone
 * "open Hoppaz from your home screen" stop card gets Ola's normal behaviour.
 */

/**
 * Does this Hopper count as having an account, as far as the tour is concerned? An email, or no account to be had:
 * with no database (the local demo) or offline nothing is gated (RequireAccount says the same), so no sign-up is asked for either.
 */
export const accountReady = (email: string | null, state: "loading" | "ready" | "offline"): boolean =>
  !!email || !supabaseConfigured() || state === "offline";

/** What this device is and has, as the machine's context. */
export function makeCtx(
  path: string,
  inPlay: boolean,
  env: IntroEnv,
  hasAccount: boolean,
  canPrompt: boolean,
  /** Still inside the window where the browser's install prompt may arrive. Left out: asked of the clock. */
  promptMayCome: boolean = promptWindowOpen()
): IntroCtx {
  // iPhone in-app browsers (Instagram and friends) can add nothing to the home screen: no install step there.
  // Android without the browser's prompt yet: hold the step for it a moment ("wait"), then skip it.
  const install: InstallKind = env.standalone
    ? "none"
    : env.iosBrowser
      ? "ios"
      : env.android
        ? canPrompt
          ? "android"
          : promptMayCome
            ? "wait"
            : "none"
        : "none";
  return { path, inPlay, standalone: env.standalone, ios: env.ios, pushGranted: env.pushGranted, hasAccount, install };
}

function stepFor(key: string | null, save: IntroSave, nudge: boolean, ctx: IntroCtx): StepId | null {
  if (!key || INTRO_QUIET.some((re) => re.test(ctx.path))) return null;
  // The "Boxes need your location" card is Paz too.
  if (nudge && save.deferred) return "locate";
  if (save.status !== "running") return null;
  const id = currentStep(save, ctx);
  if (!id) return null;
  const def = stepDef(id);
  if (def.stop || (def.route && !def.route.test(ctx.path))) return null;
  return id;
}

/** The step Paz is on, if she is with the Hopper on this screen. Not for render: use useIntroActive there. */
export function introStepNow(path?: string): StepId | null {
  if (typeof window === "undefined") return null;
  const p = path ?? window.location.pathname;
  const { key, save, nudge } = useIntro.getState();
  const { email, state } = useSessionStore.getState();
  const ctx = makeCtx(p, usePlayMode.getState().active, readEnv(), accountReady(email, state), !!useInstallPrompt.getState().prompt);
  return stepFor(key, save, nudge, ctx);
}

/** For gates and handlers (not render). */
export const introActive = (path?: string): boolean => introStepNow(path) !== null;

const noSubscribe = () => () => {};

/**
 * For render: true while Paz's tour is with the Hopper here. False on the server and while hydrating (the device
 * is only known in the browser); a page the Hopper navigates to later already knows on its first render.
 */
export function useIntroActive(): boolean {
  const path = usePathname();
  const key = useIntro((s) => s.key);
  const save = useIntro((s) => s.save);
  const nudge = useIntro((s) => s.nudge);
  const email = useSessionStore((s) => s.email);
  const sessionState = useSessionStore((s) => s.state);
  const playing = usePlayMode((s) => s.active);
  const canPrompt = useInstallPrompt((s) => !!s.prompt);
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!client) return false;
  return stepFor(key, save, nudge, makeCtx(path ?? "/", playing, readEnv(), accountReady(email, sessionState), canPrompt)) !== null;
}

/**
 * A gated action was tried while Paz is touring. The sign-up sheet stays shut;
 * a short line says so instead. (On the "keep your Golden Danfo" card the line
 * points at her card, where the one sign-up moment is.)
 */
export function introNeedAccount(): void {
  useToast.getState().say(introStepNow() === "keep" ? EXTRA.signupOnCard : EXTRA.signupLater);
}
