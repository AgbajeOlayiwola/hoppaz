/**
 * The picked sound files for Play (see picks.ts and docs/SOUND-FILES.md).
 *
 * This file only loads them and says what each one needs. sfx.ts plays them as
 * its own voices, so a sample goes through the same master gain, low-pass and
 * compressor, counts against the same 6-voice cap, keeps the priority of the synth
 * voice it replaces, and follows the same mute and Play rules.
 *
 * Nothing is fetched until load() runs, and sfx.ts runs it once, from the first real
 * tap or key press once the engine is on. So there is no network on page load, and
 * while every pick is "synth" there is nothing to fetch at all. A file that is not
 * decoded yet, or failed, is simply not here: get() returns null and sfx.ts plays the
 * synth voice. A failure is logged once and never thrown.
 */
import { PICKS, type PickKey } from "./picks";

const BASE = "/sfx/";

type Meta = {
  /** Voice priority, the same as the synth voice it replaces (shekere 0, bells, drums, horn and crowd 2, the rest 1). */
  p: number;
  /** Level of the file (see META). */
  g: number;
  /** The note the file was made at (Hz), for the voices whose pitch steps with playbackRate. */
  base?: number;
};
export type Sample = Meta & { buf: AudioBuffer };

/*
 * g is where each file sits next to the synth voice it replaces. The files are peak-normalised
 * to -1 dBFS and the synth is far quieter, so every g is below 1: measured as loudness over the
 * first 3 s through the same chain (master, low-pass, compressor), the three takes averaged,
 * peak and RMS both weighed. A cue with no synth voice is set by lane (GAMIFY-NEXT 5.4: moments
 * full, rewards about 60%, small UI about 30%). A different take can be a few dB off, so tune by ear.
 */
const META: Record<PickKey, Meta> = {
  // the box opens
  "talkingDrum:common": { p: 2, g: 0.45 },
  "talkingDrum:rare": { p: 2, g: 0.45 },
  "talkingDrum:epic": { p: 2, g: 0.65 },
  "talkingDrum:legendary": { p: 2, g: 0.55 },
  "talkingDrum:legendPhrase": { p: 2, g: 0.9 },
  rip: { p: 1, g: 0.15 },
  shekere: { p: 0, g: 0.25 },
  swish: { p: 1, g: 0.08 },
  // level up
  crowdEhn: { p: 2, g: 0.25 },
  sparkle: { p: 1, g: 0.3 },
  // Play, the bus, the Hoppaz three
  "talkingDrum:call": { p: 2, g: 0.75 },
  "talkingDrum:exit": { p: 2, g: 0.55 },
  danfoHorn: { p: 2, g: 0.25 },
  hoppaz_three_full: { p: 2, g: 0.65 },
  hoppaz_three_short: { p: 2, g: 0.4 },
  // rewards
  chime: { p: 1, g: 0.12, base: 880 },
  fly: { p: 1, g: 0.06 },
  fill: { p: 1, g: 0.06 },
  stamp: { p: 2, g: 0.4 },
  coin: { p: 2, g: 0.3 },
  checkin_stamp: { p: 2, g: 0.45 },
  we_outside_ehn: { p: 2, g: 0.2 },
  wave_received: { p: 1, g: 0.25 },
  hotspot_enter: { p: 2, g: 0.2 },
  rise: { p: 1, g: 0.04 },
  "agogo:0": { p: 2, g: 0.15 },
  // small UI
  click: { p: 1, g: 0.2 },
  flip: { p: 1, g: 0.08 },
  tick: { p: 1, g: 0.08, base: 987.77 },
  knock: { p: 1, g: 0.25 },
  "agogo:3": { p: 2, g: 0.4 },
  box_alert: { p: 1, g: 0.15 },
  toast_ok: { p: 1, g: 0.18 },
  toast_error: { p: 1, g: 0.13 },
  vibe_sticker_pop: { p: 1, g: 0.13 },
  tab_tick: { p: 1, g: 0.1, base: 587.33 },
};

const ready = new Map<string, Sample>();
let started = false;

/** decodeAudioData in both of its forms: iPhone Safari before 14.1 and webkitAudioContext take callbacks and return nothing. */
function decode(a: BaseAudioContext, data: ArrayBuffer) {
  return new Promise<AudioBuffer>((ok, no) => {
    const fail = (e: unknown) => no(e instanceof Error ? e : new Error("cannot decode"));
    const p = a.decodeAudioData(data, ok, fail);
    if (p && p.then) p.then(ok, fail);
  });
}

async function grab(a: BaseAudioContext, key: PickKey, file: string) {
  try {
    const r = await fetch(BASE + file);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const buf = await decode(a, await r.arrayBuffer());
    ready.set(key, { ...META[key], buf });
  } catch (e) {
    console.warn("sfx sample " + file, e instanceof Error ? e.message : e);
  }
}

export const samples = {
  /** Fetch and decode every picked file, once, with the context sfx.ts made inside a tap. Never throws. */
  load(a: BaseAudioContext) {
    if (started) return;
    started = true;
    try {
      const todo = (Object.keys(PICKS) as PickKey[]).filter((k) => PICKS[k] !== "synth");
      // four at a time, so a slow phone connection is not flooded
      const run = async () => {
        for (let k = todo.shift(); k; k = todo.shift()) await grab(a, k, PICKS[k]);
      };
      for (let i = 0; i < Math.min(4, todo.length); i++) void run();
    } catch (e) {
      console.warn("sfx samples", e instanceof Error ? e.message : e);
    }
  },
  /** The decoded sample for a PICKS key, or null: not picked, not loaded yet, or failed. */
  get(key: string): Sample | null {
    return ready.get(key) || null;
  },
};
