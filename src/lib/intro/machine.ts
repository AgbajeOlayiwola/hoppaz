import { inLagos } from "./env";
import { STEPS, STEP_IDS, stepDef, type IntroEventName, type IntroEventPayload, type StepId } from "./steps";

/**
 * The step machine, pure: no storage, no React, no DOM. The store (store.ts)
 * keeps the save and calls these.
 *
 * What the tour shows next is derived, never stored: the first step that
 *   1. applies to this Hopper (not in Lagos, no location: the box steps are out),
 *   2. has not been seen or skipped, and
 *   3. is not already true (they entered Play on their own: "tap your face" is done).
 * Events only record facts. They can arrive in any order.
 */

export type Facts = {
  play: boolean;
  /** Boxes opened so far (counts to 3). */
  boxes: number;
  welcome: boolean;
  installed: boolean;
  alerts: null | "on" | "denied";
  deck: boolean;
  event: boolean;
  chat: boolean;
  crew: boolean;
  me: boolean;
};

export const emptyFacts = (): Facts => ({
  play: false,
  boxes: 0,
  welcome: false,
  installed: false,
  alerts: null,
  deck: false,
  event: false,
  chat: false,
  crew: false,
  me: false,
});

export type IntroStatus = "idle" | "running" | "paused" | "done";

export type IntroSave = {
  v: 1;
  /** idle: never started. running. paused: "end the tour" for now, back after resumeAfter. done: finished for good. */
  status: IntroStatus;
  /** replay: from the Replay the tour row; the boxes are open already, so box steps just talk. */
  mode: "first" | "replay";
  /** Steps finished or skipped. */
  seen: StepId[];
  /** The subset that was skipped (kept so Replay and any later nudge can tell). */
  skipped: StepId[];
  loc: "unknown" | "granted" | "denied";
  /** null until a position says; false means not in Lagos. */
  lagos: boolean | null;
  /** The box part is parked: location was refused or skipped. A later "location granted" brings it back. */
  deferred: boolean;
  facts: Facts;
  /** How many times the whole tour was ended early. */
  pauses: number;
  resumeAfter: number;
  updatedAt: number;
};

export const newSave = (): IntroSave => ({
  v: 1,
  status: "idle",
  mode: "first",
  seen: [],
  skipped: [],
  loc: "unknown",
  lagos: null,
  deferred: false,
  facts: emptyFacts(),
  pauses: 0,
  resumeAfter: 0,
  updatedAt: 0,
});

/** Where the Hopper is right now, and what the device says. */
export type IntroCtx = {
  path: string;
  inPlay: boolean;
  standalone: boolean;
  ios: boolean;
  pushGranted: boolean;
};

const BOX_PART: StepId[] = ["face", "box1", "box2", "box_far", "spawns", "alerts", "leave_play"];

/** Does this step belong in this Hopper's tour at all? */
export function applicable(id: StepId, save: IntroSave): boolean {
  const away = save.lagos === false;
  switch (id) {
    case "install":
    case "locate":
      return !away;
    case "no_location":
      return save.loc === "denied" && !away;
    case "outside":
      return away;
    default:
      if (BOX_PART.includes(id)) return !away && !save.deferred && save.loc !== "denied";
      return true;
  }
}

/** Is it already true, so the step needs no showing? */
export function satisfied(id: StepId, save: IntroSave, ctx: IntroCtx): boolean {
  const f = save.facts;
  switch (id) {
    case "install":
      return ctx.standalone || f.installed;
    case "locate":
      return save.loc !== "unknown";
    case "face":
      return ctx.inPlay || f.play;
    case "box1":
      return f.boxes >= 1;
    case "box2":
      return f.boxes >= 2;
    case "box_far":
      return f.welcome;
    case "alerts":
      return ctx.pushGranted || f.alerts !== null;
    case "leave_play":
      return !ctx.inPlay;
    case "deck_go":
      return f.deck || /^\/discover/.test(ctx.path);
    case "deck":
      return f.event;
    case "chat":
      return f.chat;
    case "crew_go":
      return f.crew || /^\/crew/.test(ctx.path);
    case "me_go":
      return f.me || /^\/me/.test(ctx.path);
    default:
      return false; // welcome, no_location, outside, spawns, crew, me wait for their button
  }
}

/** The step to show now, or null when the tour has nothing left. */
export function currentStep(save: IntroSave, ctx: IntroCtx): StepId | null {
  for (const id of STEP_IDS) {
    if (save.seen.includes(id) || !applicable(id, save)) continue;
    // Replay: the Hopper has opened their boxes already, so only what they do again counts.
    if (satisfied(id, save, ctx)) continue;
    return id;
  }
  return null;
}

/** "3 of 14", for the little counter on the card. Total counts the steps that apply to this Hopper. */
export function progress(save: IntroSave, id: StepId): { n: number; total: number } {
  const list = STEP_IDS.filter((s) => applicable(s, save) && s !== "leave_play");
  const at = list.indexOf(id);
  const n = at >= 0 ? at + 1 : Math.min(list.length, list.filter((s) => save.seen.includes(s)).length + 1);
  return { n, total: list.length };
}

/* ------------------------------------------------------------- changes ---- */

const withSeen = (save: IntroSave, ids: StepId[], skipped: boolean): IntroSave => {
  const seen = [...save.seen];
  const skip = [...save.skipped];
  ids.forEach((id) => {
    if (!seen.includes(id)) seen.push(id);
    if (skipped && !skip.includes(id)) skip.push(id);
  });
  return { ...save, seen, skipped: skip };
};

/** The Hopper finished this step (its button, or the thing it asked for). */
export function completeStep(save: IntroSave, id: StepId): IntroSave {
  return withSeen(save, [id], false);
}

/** The Hopper skipped it. Steps that make no sense alone go with it; skipping location parks the box part. */
export function skipStep(save: IntroSave, id: StepId): IntroSave {
  let next = withSeen(save, [id, ...(stepDef(id).skipAlso ?? [])], true);
  if (id === "locate" && next.loc === "unknown") next = { ...next, deferred: true };
  return next;
}

/** Record something that happened. */
export function applyEvent(save: IntroSave, name: IntroEventName, p: IntroEventPayload = {}): IntroSave {
  const f = save.facts;
  switch (name) {
    case "location_granted": {
      const lagos = typeof p.lat === "number" && typeof p.lng === "number" ? inLagos(p.lat, p.lng) : save.lagos;
      return { ...save, loc: "granted", deferred: false, lagos };
    }
    case "location_denied":
      return { ...save, loc: "denied", deferred: true };
    case "outside_lagos":
      return { ...save, lagos: false };
    case "play_entered":
      return { ...save, facts: { ...f, play: true } };
    case "box_opened":
      return { ...save, facts: { ...f, boxes: Math.min(3, f.boxes + 1) } };
    case "welcome_done":
      return { ...save, facts: { ...f, welcome: true, boxes: 3 } };
    case "install_done":
      return { ...save, facts: { ...f, installed: true } };
    case "alerts_on":
      return { ...save, facts: { ...f, alerts: "on" } };
    case "alerts_denied":
      return { ...save, facts: { ...f, alerts: f.alerts ?? "denied" } };
    case "deck_viewed":
      return { ...save, facts: { ...f, deck: true } };
    case "event_opened":
      return { ...save, facts: { ...f, event: true } };
    case "chat_opened":
      return { ...save, facts: { ...f, chat: true } };
    case "crew_viewed":
      return { ...save, facts: { ...f, crew: true } };
    case "me_viewed":
      return { ...save, facts: { ...f, me: true } };
    default:
      return save; // map_ready, play_exited, location_needed: heard, nothing to remember
  }
}

/**
 * Tidy up after any change: steps that are already true are marked seen, and
 * a tour with nothing left is done.
 */
export function settle(save: IntroSave, ctx: IntroCtx): IntroSave {
  if (save.status !== "running") return save;
  let next = save;
  for (let guard = 0; guard < STEPS.length + 2; guard++) {
    const id = currentStep(next, ctx);
    if (!id) return { ...next, status: "done" };
    if (!satisfied(id, next, ctx)) return next;
    next = withSeen(next, [id], false);
  }
  return next;
}

/** "Replay the tour": everything again, from the top. Location and install state are the device's, so they stay. */
export function replaySave(prev: IntroSave): IntroSave {
  return {
    ...newSave(),
    status: "running",
    mode: "replay",
    loc: prev.loc,
    lagos: prev.lagos,
    deferred: prev.deferred,
    updatedAt: Date.now(),
  };
}

const PAUSE_MS = 20 * 60 * 60 * 1000;
/** After this many "end the tour" taps the tour stops coming back. */
export const MAX_PAUSES = 2;

/** "End the tour": hide it, come back after a while, and stop for good after a few times. */
export function pauseSave(save: IntroSave, now = Date.now()): IntroSave {
  const pauses = save.pauses + 1;
  return pauses > MAX_PAUSES
    ? { ...save, status: "done", pauses }
    : { ...save, status: "paused", pauses, resumeAfter: now + PAUSE_MS };
}
