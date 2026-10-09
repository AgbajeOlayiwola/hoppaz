import type { MascotState } from "@/components/Mascot";
import { EXTRA, LINES, type Line } from "./lines";
import { installKind, progress, type IntroCtx, type IntroSave } from "./machine";
import { stepDef, type IntroActionName, type IntroTarget, type StepId } from "./steps";

/**
 * What the card shows for the current step, worked out from where the Hopper
 * is: the step's own words, or a nudge when they are somewhere else than the
 * step expects (a box step with Play closed, an events step with Play open,
 * alerts on an iPhone that is not installed yet, or in another app's browser),
 * and the iPhone install cards (two taps with a picture, then "open Hoppaz from
 * your home screen").
 */
export type StepView = {
  id: StepId;
  variant: "step" | "backIn" | "leavePlay" | "needInstall" | "needSignup" | "needSafari";
  title: string;
  line: string;
  cta?: { label: string; kind: "advance" } | { label: string; kind: "action"; action: IntroActionName };
  skip?: string;
  mascot: MascotState;
  targets: IntroTarget[];
  needsTarget: boolean;
  /** "3 of 14" for the counter; absent on the closing card. */
  count?: { n: number; total: number };
  /** A small Paz that only peeks over the card. */
  compact: boolean;
  /** The screen keeps room for the card while this step shows. */
  reserve: boolean;
  /** A picture under the words: the two taps in Safari, or the icon on the home screen. */
  picture?: "taps" | "home";
  /** "Your move" under the words (no button, the Hopper does the thing). Not on a stop card. */
  yourMove: boolean;
};

/** In a replay these wait on something the Hopper cannot do again (open a welcome box), so they get a plain button. */
const REPLAY_BUTTON: StepId[] = ["face", "box1", "box2", "box_far", "chat", "deck"];

const ctaOf = (line: Line, kind: "advance"): StepView["cta"] =>
  line.cta ? { label: line.cta, kind } : undefined;

export function resolveView(id: StepId, save: IntroSave, ctx: IntroCtx): StepView {
  const def = stepDef(id);
  const base = LINES[id];
  const count = id === "me" || id === "keep" || id === "open_app" ? undefined : progress(save, id, ctx);
  let line: Line = base;
  let variant: StepView["variant"] = "step";
  let targets = def.targets;
  let mascot = def.mascot;
  let cta: StepView["cta"] =
    def.cta?.kind === "action" ? { label: base.cta ?? "Go", kind: "action", action: def.cta.action } : def.cta ? ctaOf(base, "advance") : undefined;
  let needsTarget = !!def.needsTarget;
  let picture: StepView["picture"];

  if (save.mode === "replay" && REPLAY_BUTTON.includes(id)) {
    cta = { label: EXTRA.replayCta, kind: "advance" };
    needsTarget = false;
  }

  if (def.needsPlay && !ctx.inPlay && save.mode === "first") {
    variant = "backIn";
    line = EXTRA.backIn;
    targets = ["avatar"];
    mascot = "point";
    cta = undefined;
  } else if (def.part === "events" && ctx.inPlay) {
    variant = "leavePlay";
    line = EXTRA.leavePlay;
    targets = ["play-exit"];
    mascot = "point";
    cta = undefined;
    needsTarget = false;
  } else if (id === "alerts" && ctx.ios && !ctx.standalone) {
    // Alerts only work from the home screen. Sign up first (the account and the boxes come along), then the two taps.
    targets = [];
    mascot = "oya";
    if (installKind(ctx) !== "ios") {
      // Another app's browser (Instagram, TikTok): no home screen to add to from here. Say where to go, and move on.
      variant = "needSafari";
      line = EXTRA.alertsNeedSafari;
      cta = { label: EXTRA.alertsNeedSafari.cta!, kind: "advance" };
    } else if (ctx.hasAccount === false) {
      variant = "needSignup";
      line = EXTRA.alertsNeedSignup;
      cta = { label: EXTRA.alertsNeedSignup.cta!, kind: "action", action: "signup" };
    } else {
      variant = "needInstall";
      line = EXTRA.alertsNeedInstall;
      cta = { label: EXTRA.alertsNeedInstall.cta!, kind: "action", action: "added" };
      picture = "taps";
    }
  } else if (id === "locate" && ctx.standalone && save.mode === "first" && save.pauses === 0) {
    // The first card in the installed app: the Hopper came over from the browser, so say hello to that.
    line = EXTRA.arrived;
  } else if (id === "install" && installKind(ctx) === "ios") {
    line = EXTRA.installIos;
    cta = { label: EXTRA.installIos.cta!, kind: "action", action: "added" };
    picture = "taps";
  } else if (id === "open_app") {
    line = ctx.hasAccount === false ? base : EXTRA.openAppMember;
    picture = "home";
  }

  const own = variant === "step";
  return {
    id,
    variant,
    title: line.title,
    line: line.line,
    cta,
    skip: line.skip ?? base.skip,
    mascot,
    targets,
    needsTarget,
    count,
    compact: own && !!def.compact,
    reserve: own && !!def.reserve,
    picture,
    yourMove: !cta && !def.stop,
  };
}
