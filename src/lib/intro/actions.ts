"use client";

import { useAccountGate } from "@/lib/accountGate";
import { askToInstall, enablePush } from "@/lib/push";
import { useToast } from "@/lib/store";
import { fireInstallPrompt } from "./install";
import { EXTRA } from "./lines";
import { introEvent, introWantLocate } from "./store";
import type { IntroActionName, StepId } from "./steps";

/**
 * What the orange button does on the steps that ask for something.
 *
 * Every action has a working default, so the tour runs on its own. The wiring
 * step can replace any of them (registerIntroAction) when the app already has
 * a better way: the map's own locate function, the Play shell's avatar run.
 *
 * Handlers are called from the Hopper's tap, which is what the browser needs
 * for the location, notification and install questions.
 */
type Handler = (step?: StepId) => void | Promise<void>;
const handlers: Partial<Record<IntroActionName, Handler>> = {};

/** Replace an action. Returns the undo. */
export function registerIntroAction(name: IntroActionName, fn: Handler): () => void {
  handlers[name] = fn;
  return () => {
    if (handlers[name] === fn) delete handlers[name];
  };
}

export const ACTION_EVENT = "hz:intro-action";

const defaults: Record<IntroActionName, Handler> = {
  // Android: the browser's own install prompt, right from the tap. (iPhone has its own card, see "added".)
  install: async () => {
    const outcome = await fireInstallPrompt();
    if (outcome === "accepted") introEvent("install_done");
  },

  // iPhone: nothing tells us the two taps were done, so we take the Hopper's word.
  added: () => introEvent("install_added"),

  // The one sign-up moment, and the alerts rule: Paz asked, the Hopper tapped, so the sheet opens (it never opens on its own during the tour).
  signup: (step) => useAccountGate.getState().show(step === "alerts" ? "keep your boxes and get alerts" : "keep your Golden Danfo"),

  // The host turns the position watch on; the permission question appears and
  // the bridge turns the answer into location_granted or location_denied.
  locate: () => introWantLocate(true),

  alerts: async () => {
    const res = await enablePush();
    if (res.ok) introEvent("alerts_on");
    else if (res.reason === "needs-install") askToInstall();
    else if (res.reason === "no-session" || res.reason === "server") {
      // May pass in a moment: say so and keep the step, so the Hopper can tap again.
      useToast.getState().say(EXTRA.alertsRetry);
    } else {
      // Refused or closed, or this device cannot do alerts at all: the step is done.
      introEvent("alerts_denied");
      useToast.getState().say(EXTRA.alertsRefused);
    }
  },

  // The Play shell owns the avatar run. With no handler registered this just
  // announces itself, so the shell (or the dev page) can listen for it.
  send_avatar: () => {
    try {
      window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: { name: "send_avatar" } }));
    } catch {
      /* no window */
    }
  },
};

export async function runIntroAction(name: IntroActionName, step?: StepId): Promise<void> {
  try {
    await (handlers[name] ?? defaults[name])(step);
  } catch (err) {
    console.warn("[hoppaz] intro action", name, err);
  }
}
