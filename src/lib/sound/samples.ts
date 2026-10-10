/**
 * The picked sound files for Play (see picks.ts and docs/SOUND-FILES.md).
 *
 * This file only loads them and says what each one needs. sfx.ts plays them as
 * its own voices, so a sample goes through the same master gain, low-pass and
 * compressor, counts against the same 6-voice cap, sits in the same lane as the
 * synth voice it replaces (lane gain and priority), and follows the same mute and
 * quiet-hour rules.
 *
 * Nothing is fetched until load() runs, and sfx.ts runs it once, from the first real
 * tap or key press once the engine is on. So there is no network on page load, and
 * while every pick is "synth" there is nothing to fetch at all. A file that is not
 * decoded yet, or failed, is simply not here: get() returns null and sfx.ts plays the
 * synth voice. A failure is logged once and never thrown.
 */
import { PICKS, type PickKey } from "./picks";

const BASE = "/sfx/";

/** The three lanes of GAMIFY-NEXT 5.4. sfx.ts gives each its priority and level. */
export type Lane = "moment" | "reward" | "ui";

type Meta = {
  /** The lane of the synth voice it replaces, and of the cue in manifest.json. */
  lane: Lane;
  /** Voice priority when it is not the lane's own: the shekere is a bed (0), dropped first and cut by hush(). */
  p?: number;
  /** The note the file was made at (Hz), for the voices whose pitch steps with playbackRate. Measured, see docs/SOUND-FILES.md. */
  base?: number;
};
export type Sample = Meta & {
  /** The trim from picks.ts: where the file sits next to the synth voice it replaces, before the lane. */
  g: number;
  buf: AudioBuffer;
};

/*
 * What each sound needs besides its trim (which is in picks.ts, next to the pick). The lane is the
 * cue's lane in manifest.json. base is the file's own pitch, measured with an FFT on the decoded
 * file, so the stepped voices land on the notes chime(), tick() and tabTick() ask for.
 */
const META: Record<PickKey, Meta> = {
  // the box opens
  "talkingDrum:common": { lane: "moment" },
  "talkingDrum:rare": { lane: "moment" },
  "talkingDrum:epic": { lane: "moment" },
  "talkingDrum:legendary": { lane: "moment" },
  "talkingDrum:legendPhrase": { lane: "moment" },
  rip: { lane: "moment" },
  shekere: { lane: "moment", p: 0 },
  swish: { lane: "moment" },
  // level up
  crowdEhn: { lane: "moment" },
  sparkle: { lane: "moment" },
  // Play, the bus, the Hoppaz three
  "talkingDrum:call": { lane: "moment" },
  "talkingDrum:exit": { lane: "reward" },
  danfoHorn: { lane: "moment" },
  hoppaz_three_full: { lane: "moment" },
  hoppaz_three_short: { lane: "reward" },
  // rewards
  chime: { lane: "reward", base: 440.4 },
  fly: { lane: "reward" },
  fill: { lane: "reward" },
  stamp: { lane: "reward" },
  coin: { lane: "reward" },
  checkin_stamp: { lane: "reward" },
  we_outside_ehn: { lane: "reward" },
  wave_received: { lane: "reward" },
  hotspot_enter: { lane: "reward" },
  rise: { lane: "reward" },
  "agogo:0": { lane: "reward" },
  // small UI
  click: { lane: "ui" },
  flip: { lane: "ui" },
  tick: { lane: "ui", base: 987.77 },
  knock: { lane: "ui" },
  "agogo:3": { lane: "ui" },
  box_alert: { lane: "ui" },
  toast_ok: { lane: "ui" },
  toast_error: { lane: "ui" },
  vibe_sticker_pop: { lane: "ui" },
  tab_tick: { lane: "ui", base: 1190 },
};

const ready = new Map<string, Sample>();
let started = false;

/** decodeAudioData in both of its forms: iPhone Safari before 14.1 and webkitAudioContext take callbacks and return nothing. */
export function decode(a: BaseAudioContext, data: ArrayBuffer) {
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
    ready.set(key, { ...META[key], g: PICKS[key].g, buf });
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
      const todo = (Object.keys(PICKS) as PickKey[]).filter((k) => PICKS[k].file !== "synth");
      // four at a time, so a slow phone connection is not flooded
      const run = async () => {
        for (let k = todo.shift(); k; k = todo.shift()) await grab(a, k, PICKS[k].file);
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
