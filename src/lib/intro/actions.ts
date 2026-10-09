"use client";

import { askToInstall, enablePush } from "@/lib/push";
import { useToast } from "@/lib/store";
import { EXTRA } from "./lines";
import { introEvent, introWantLocate } from "./store";
import type { IntroActionName } from "./steps";

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
type Handler = () => void | Promise<void>;
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
  // Opens Ola's InstallSheet (Share steps on iPhone, the real prompt on Android).
  install: () => askToInstall(),

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

export async function runIntroAction(name: IntroActionName): Promise<void> {
  try {
    await (handlers[name] ?? defaults[name])();
  } catch (err) {
    console.warn("[hoppaz] intro action", name, err);
  }
}
