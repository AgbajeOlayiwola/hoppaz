import type { MascotState } from "@/components/Mascot";
import { EXTRA, LINES, type Line } from "./lines";
import { progress, type IntroCtx, type IntroSave } from "./machine";
import { stepDef, type IntroActionName, type IntroTarget, type StepId } from "./steps";

/**
 * What the card shows for the current step, worked out from where the Hopper
 * is: the step's own words, or a nudge when they are somewhere else than the
 * step expects (a box step with Play closed, an events step with Play open,
 * alerts on an iPhone that is not installed yet).
 */
export type StepView = {
  id: StepId;
  variant: "step" | "backIn" | "leavePlay" | "needInstall";
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
};

/** In a replay these wait on something the Hopper cannot do again (open a welcome box), so they get a plain button. */
const REPLAY_BUTTON: StepId[] = ["face", "box1", "box2", "box_far", "chat", "deck"];

const ctaOf = (line: Line, kind: "advance"): StepView["cta"] =>
  line.cta ? { label: line.cta, kind } : undefined;

export function resolveView(id: StepId, save: IntroSave, ctx: IntroCtx): StepView {
  const def = stepDef(id);
  const base = LINES[id];
  const count = id === "me" ? undefined : progress(save, id);
  let line: Line = base;
  let variant: StepView["variant"] = "step";
  let targets = def.targets;
  let mascot = def.mascot;
  let cta: StepView["cta"] =
    def.cta?.kind === "action" ? { label: base.cta ?? "Go", kind: "action", action: def.cta.action } : def.cta ? ctaOf(base, "advance") : undefined;
  let needsTarget = !!def.needsTarget;

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
    variant = "needInstall";
    line = EXTRA.alertsNeedInstall;
    targets = ["install"];
    mascot = "oya";
    cta = { label: EXTRA.alertsNeedInstall.cta!, kind: "action", action: "install" };
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
  };
}
