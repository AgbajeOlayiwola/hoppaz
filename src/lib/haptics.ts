/**
 * The one place the app buzzes (GAMIFY-NEXT 5.5). Android Chrome can vibrate;
 * iPhone Safari cannot, so there the sound and the picture carry every moment
 * and nothing here does anything. There is no iPhone workaround on purpose.
 *
 * Named patterns, in milliseconds (a number is one pulse, a list is
 * on, off, on...). Callers say what happened, not how long to shake:
 * haptics.buzz("checkin").
 *
 * Rules:
 *  - Only after the person has touched the screen (navigator.userActivation),
 *    never while the page is hidden.
 *  - At most one buzz every 400 ms. A second one inside the window is dropped,
 *    not queued.
 *  - No pattern over 400 ms except the horn (the Hop bus).
 *  - No buzz for tab switches or scrolling: nothing calls it from there.
 *  - The Buzz switch turns all of it off. It is saved in localStorage under
 *    "hz-buzz" ("off" or "on"), default on, and is separate from the Sound
 *    switch ("hz-sound") unless a caller chooses to follow both (the deck tick does).
 */

const KEY = "hz-buzz";
const GAP = 400;
const MAX = 400;

const PATTERNS = {
  // GAMIFY-NEXT 5.5
  snap: 6, // deck snap, small taps
  pick: 8, // choosing a box
  stampSmall: 25, // a badge stamp, a pip
  checkin: 30, // check-in landed
  quest: [12, 40, 12], // quest done
  outside: [10, 30, 14], // WE OUTSIDE
  streak: [10, 30, 18], // streak kept
  wave: [8, 40, 8], // a wave arrives
  hotspot: 14, // enter a Hotspot
  levelUp: [20, 40, 30], // level up
  horn: [60, 50, 60, 50, 200], // the Hop bus; also the push `vibrate` option in public/sw.js
  // the box open and the drop reveal, as the engine and Reveal already had them
  tear: 18, // the tape tears
  burstBig: [60, 30, 90], // the legendary burst
  crateShake: [20, 40, 30, 40, 50], // the legendary crate shakes before it opens
  refused: 12, // a box that would not open
  cardUp: [20, 60, 20], // the big card turns up
} as const satisfies Record<string, number | readonly number[]>;

export type HapticName = keyof typeof PATTERNS;

const total = (p: number | readonly number[]) => (typeof p === "number" ? p : p.reduce((a, b) => a + b, 0));

let on = true;
let last = -Infinity;
const listeners = new Set<() => void>();

try {
  on = typeof localStorage === "undefined" || localStorage.getItem(KEY) !== "off";
} catch {
  /* storage blocked: buzz stays on for this visit */
}

export const haptics = {
  /** Buzz a named pattern, if the phone can, the Buzz switch is on and the rules above allow it. */
  buzz(name: HapticName) {
    try {
      if (!on || typeof navigator === "undefined" || typeof document === "undefined" || !navigator.vibrate) return;
      if (document.hidden || !navigator.userActivation?.hasBeenActive) return;
      const p = PATTERNS[name];
      if (name !== "horn" && total(p) > MAX) return;
      const now = performance.now();
      if (now - last < GAP) return;
      last = now;
      navigator.vibrate(p as number | number[]);
    } catch {
      /* no vibration on this phone (iPhone): the sound and the picture carry it */
    }
  },
  /** The Buzz switch. Persisted. Turning it off cuts a buzz that is running. */
  setOn(next: boolean) {
    if (on === next) return;
    on = next;
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    try {
      if (!next) navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
    listeners.forEach((f) => f());
  },
  isOn: () => on,
  /** For useSyncExternalStore: fires when the switch changes. */
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
