"use client";

import { create } from "zustand";
import {
  applyEvent,
  completeStep,
  currentStep,
  emptyFacts,
  newSave,
  pauseSave,
  replaySave,
  settle,
  skipStep,
  type IntroCtx,
  type IntroSave,
} from "./machine";
import { playSeen } from "@/lib/usePlayMode";
import { mirrorDone, profileSaysDone } from "./mirror";
import { STEP_IDS, type IntroEventName, type IntroEventPayload, type StepId } from "./steps";

/**
 * The tour's state and its event bus.
 *
 * The wiring step only needs one function: introEvent("box_opened"). The rest
 * (introSkip, introReplay, ...) are what the card and the Replay row call.
 *
 * Progress is kept per Hopper in localStorage (every read and write is wrapped:
 * a private window just keeps it for the visit). Events that arrive before the
 * save is loaded are queued and replayed, so an early "map_ready" is not lost.
 */

const PREFIX = "hz-intro-v1";
export const INTRO_EVENT = "hz:intro";

type Store = {
  /** The storage key this save belongs to; null until bound. */
  key: string | null;
  save: IntroSave;
  /** The events map has been up this visit. */
  mapReady: boolean;
  /** Location nudge ("Boxes need your location") is asking to show. */
  nudge: boolean;
  /** The locate button was tapped: the host turns the position watch on. */
  wantLocate: boolean;
  /** A box is being opened: the card stays out of the way until it is done. */
  opening: boolean;
};

export const useIntro = create<Store>(() => ({
  key: null,
  save: newSave(),
  mapReady: false,
  nudge: false,
  wantLocate: false,
  opening: false,
}));

const set = useIntro.setState;
const get = useIntro.getState;

/* ------------------------------------------------------------- storage ---- */
function read(key: string): IntroSave | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as IntroSave;
    return s && s.v === 1 && Array.isArray(s.seen) && s.facts ? { ...newSave(), ...s, facts: { ...newSave().facts, ...s.facts } } : null;
  } catch {
    return null;
  }
}

function write(key: string | null, save: IntroSave) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(save));
  } catch {
    /* private mode: it lives for this visit only */
  }
}

/** What this device already knows about Play, so a Hopper who got ahead of the tour is not walked back. */
function deviceFacts(): Partial<IntroSave["facts"]> {
  try {
    const seen = playSeen();
    return { play: seen.enter, boxes: seen.welcome ? 3 : seen.box ? 1 : 0, welcome: seen.welcome };
  } catch {
    return {};
  }
}

function freshSave(scope: string): IntroSave {
  const s = newSave();
  return scope === "dev" ? s : { ...s, facts: { ...s.facts, ...deviceFacts() } };
}

/* ------------------------------------------------------------ the bus ---- */
type Listener = (name: IntroEventName, payload?: IntroEventPayload) => void;
const listeners = new Set<Listener>();

/** Hear every event, for the dev page's log or analytics. Returns the unsubscribe. */
export function onIntroEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let pending: Array<[IntroEventName, IntroEventPayload | undefined]> = [];
let profileRef: { profile: Record<string, unknown> | null; userId: string | null } = { profile: null, userId: null };

/** Applies a save change, writes it, and mirrors the end of the tour once. */
const fingerprint = (s: IntroSave) => JSON.stringify({ ...s, updatedAt: 0 });

function commit(next: IntroSave) {
  const prev = get().save;
  if (next === prev || fingerprint(next) === fingerprint(prev)) return;
  next = { ...next, updatedAt: Date.now() };
  set({ save: next });
  write(get().key, next);
  if (prev.status !== "done" && next.status === "done" && next.mode === "first") mirrorDone(profileRef.profile, profileRef.userId);
}

/**
 * Tell the tour something happened. Safe to call from anywhere, any time,
 * any number of times: events are facts, not steps.
 */
export function introEvent(name: IntroEventName, payload?: IntroEventPayload): void {
  listeners.forEach((fn) => {
    try {
      fn(name, payload);
    } catch {
      /* a bad listener must not stop the tour */
    }
  });
  if (!get().key) {
    pending.push([name, payload]);
    if (name === "map_ready") set({ mapReady: true });
    return;
  }
  handle(name, payload);
}

function handle(name: IntroEventName, payload?: IntroEventPayload) {
  if (name === "map_ready") set({ mapReady: true });
  if (name === "location_needed") {
    if (get().save.deferred) set({ nudge: true });
    return;
  }
  if (name === "location_granted" || name === "location_denied") set({ wantLocate: false, nudge: false });
  const before = get().save;
  let save = applyEvent(before, name, payload);
  if (name === "map_ready" && save.status === "idle") save = { ...save, status: "running" };
  // Location came back after being refused or skipped: the box part is back in the tour, so the tour picks up again.
  if (before.deferred && !save.deferred && save.status === "done" && save.mode === "first") save = { ...save, status: "running" };
  commit(save);
}

/* --------------------------------------------------------------- binding -- */
/**
 * Point the tour at a Hopper's save. Called by the host whenever the user id
 * or the profile changes. A save made while the Hopper was still "anon" moves
 * to their own id (the anonymous user is made a moment after the page opens).
 */
export function bindIntro(opts: { scope: string; userId: string | null; profile?: Record<string, unknown> | null }) {
  const { scope, userId } = opts;
  profileRef = { profile: opts.profile ?? null, userId };
  const key = `${PREFIX}:${scope}:${userId ?? "anon"}`;
  const cur = get();
  if (cur.key === key) {
    if (cur.save.status !== "done" && profileSaysDone(opts.profile)) commit({ ...cur.save, status: "done" });
    return;
  }

  let save = read(key);
  if (!save && cur.key) save = cur.save; // anon -> own id, same person
  if (!save) save = read(`${PREFIX}:${scope}:anon`);
  if (!save) save = freshSave(scope);

  set({ key });
  write(key, save);
  set({ save });

  // Replay what arrived before there was a save.
  const queued = pending;
  pending = [];
  queued.forEach(([n, p]) => handle(n, p));

  let now = get().save;
  if (now.status === "paused" && Date.now() >= now.resumeAfter) now = { ...now, status: "running" };
  if (now.status !== "done" && profileSaysDone(opts.profile)) now = { ...now, status: "done" };
  if (get().mapReady && now.status === "idle") now = { ...now, status: "running" };
  commit(now);
}

/* ------------------------------------------------------------- the card ---- */
/** Finish a step with its button. */
export function introAdvance(id: StepId): void {
  commit(completeStep(get().save, id));
}

/** The small Skip. Saves progress; the tour carries on (or resumes later) from the next unseen step. */
export function introSkip(id: StepId): void {
  commit(skipStep(get().save, id));
}

/** "End the tour": it goes quiet now and comes back later from where it stopped. */
export function introPauseTour(): void {
  commit(pauseSave(get().save));
}

/** The Replay the tour row on Me. */
export function introReplay(): void {
  set({ nudge: false, wantLocate: false });
  commit(replaySave(get().save));
}

/** Development only: wipe the save and start again as a brand new Hopper. */
export function introReset(): void {
  const key = get().key;
  const scope = key?.split(":")[1] ?? "app";
  set({ nudge: false, wantLocate: false, opening: false });
  commit({ ...freshSave(scope), status: get().mapReady ? "running" : "idle" });
}

export function introDismissNudge(): void {
  set({ nudge: false });
}

export function introWantLocate(on: boolean): void {
  set({ wantLocate: on });
}

export function introSetOpening(on: boolean): void {
  if (get().opening !== on) set({ opening: on });
}

/** Mark steps that are already true as seen, and finish a tour with nothing left. Called by the host. */
export function introSettle(ctx: IntroCtx): void {
  const s = get().save;
  const next = settle(s, ctx);
  if (next !== s) commit(next);
}

/**
 * True while Paz's own "Let's find you" is still ahead: a first-run tour that has not asked for the location yet.
 * The map's first-run location sheet leaves the question to her, so a new Hopper meets Paz first and is asked once.
 */
export function introAsksLocation(): boolean {
  const { key, save } = get();
  return !!key && (save.status === "idle" || save.status === "running") && save.mode === "first" && save.loc === "unknown" && !save.seen.includes("locate");
}

/** For the Replay row: true when the Hopper has been through (or ended) the tour. */
export function introHasRun(): boolean {
  const s = get().save;
  return s.status === "done" || s.status === "paused" || s.seen.length > 0;
}

export { currentStep };

/** Development only (the dev page): start the tour right at a step, as if everything before it was done. */
export function introDevJump(id: StepId, keep?: Partial<Pick<IntroSave, "loc" | "lagos" | "deferred">>): void {
  const idx = STEP_IDS.indexOf(id);
  const cur = get().save;
  set({ nudge: false, wantLocate: false, opening: false });
  commit({
    ...cur,
    status: "running",
    mode: "first",
    seen: STEP_IDS.slice(0, Math.max(0, idx)),
    skipped: [],
    facts: emptyFacts(),
    pauses: 0,
    loc: keep?.loc ?? cur.loc,
    lagos: keep?.lagos === undefined ? cur.lagos : keep.lagos,
    deferred: keep?.deferred ?? cur.deferred,
  });
}
