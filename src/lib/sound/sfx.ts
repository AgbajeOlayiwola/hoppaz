/**
 * The Lagos sounds for the app. Web Audio, generated; a voice can be swapped for a
 * picked sound file (picks.ts, samples.ts) and the synth is always the fallback.
 *
 * Instruments: shekere (beaded gourd), agogo (double iron bell), talking drum
 * (gangan, with the squeeze bend), danfo horn, the crowd's "ehn!", a calabash
 * knock. Everything pitched sits in D major pentatonic.
 *
 * Chain: voices -> lane gain -> master gain -> low-pass -> compressor -> out. At most 6
 * voices at once (lowest priority, then oldest, is dropped first). A voice
 * frees its nodes when its sources end.
 *
 * Lanes (GAMIFY-NEXT 5.4). Every sound belongs to one, and the lane sets the voice's
 * priority and its output gain, so nothing fights:
 *   moment  priority 3, full      box open, level up, the full motif, the danfo horn
 *   reward  priority 2, about 60% check-in, quest, streak, wave, the short motif
 *   ui      priority 1, about 30% tab tick, toast, count-up, the unmute tick
 * The shekere is the one exception: a bed at priority 0, so it goes first and hush() cuts it.
 * One Moment at a time: while a Moment plays, UI sounds are skipped, not queued. The same
 * sound (a cue and its note) never retriggers inside 120 ms, and the UI lane plays at most
 * 4 a second. The motif plays at most once every 8 seconds (the short form waits out the full one too).
 *
 * Samples: sfx.x() plays the picked file for that call if one is decoded and
 * ready, as a voice like any other (same chain, cap, lane, mute); otherwise
 * it runs the synth voice. The files load once, from the first unlock() after a
 * real tap or key press, never on page load.
 *
 * Rules:
 *  - The AudioContext is created and resumed only inside a real user gesture
 *    (pointerdown, touchend, click, keydown). Nothing is fetched or made before one.
 *  - The sound is app-wide: <SoundLane /> in the root layout calls setApp(true), so every
 *    tab and screen can sound, not only Play. Without it, sound runs only while Play is
 *    active (setPlaying(true), or a lease from acquire/release: an open stage, and the Today screen).
 *  - After about 15 s of silence the context is suspended, so the app does not hold the phone's
 *    audio session or battery, and it wakes on the next tap. Play is exempt while it is open.
 *    Nothing sounds while the page is hidden.
 *  - Quiet hours, 23:00 to 07:00 in Lagos (the same window as push): the master drops to
 *    half and the crowd "ehn", the shekere and the horn are skipped. A low-tier phone
 *    (deviceTier()) skips the shekere and the ehn.
 *  - setMuted(boolean) is persisted in localStorage key "hz-sound" ("off" or
 *    "on"). Default is on.
 */

import { deviceTier } from "@/lib/deviceTier";
import type { PickKey } from "./picks";
import { samples, type Lane } from "./samples";

type Ctx = BaseAudioContext;

const KEY = "hz-sound";
const MAXV = 6;
const LEVEL = 0.7;
/** Priority and level per lane. The level is against LEVEL, the master. */
const LANES: Record<Lane, { p: number; g: number }> = {
  moment: { p: 3, g: 1 },
  reward: { p: 2, g: 0.6 },
  ui: { p: 1, g: 0.3 },
};
/** The same sound never retriggers inside this long (ms). */
const COOL = 120;
/** The UI lane plays at most this many sounds in any second (the count-up tick, at most half of them). */
const UI_MAX = 4;
/** The motif is the signature: each form once every 8 s. */
const MOTIF_EVERY = 8000;
/** Silence this long (ms) and the context sleeps. */
const IDLE = 15000;
const PEN = [293.66, 329.63, 369.99, 440, 493.88];
/** The n-th note of D major pentatonic, wrapping up the octaves. */
function pen(i: number) {
  return PEN[((i % 5) + 5) % 5] * Math.pow(2, Math.floor(i / 5));
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Voice = {
  s: number;
  e: number;
  p: number;
  l: Lane;
  out: GainNode;
  add: <T extends AudioNode>(n: T) => T;
  src: (s: AudioScheduledSourceNode, t0: number, t1: number, off?: number) => void;
  free: () => void;
  kill: (t0: number) => void;
};

/* ----------------------------------------------------------------- state -- */
let AC: Ctx | null = null;
let MG: GainNode | null = null;
let NB: AudioBuffer | null = null;
let VO: Voice[] = [];
let gestT = -Infinity;
let tapped = false;
let shk: ReturnType<typeof setInterval> | undefined;
let muted = false;
let playing = false;
let leases = 0;
let app = false;
let offline = false;
/** Dev only: renderOffline plays the picked files too, and may set their trim. */
let offSamples = false;
let offG: number | undefined;
/** The lane of the public call that is running, so the voices it calls inherit it. */
let cur: Lane | null = null;
let mgNow = LEVEL;
const listeners = new Set<() => void>();

try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "off";
} catch {
  /* storage blocked: sound stays on for this visit */
}

const isOff = (a: Ctx): a is OfflineAudioContext => "startRendering" in a;
const isActive = () => app || playing || leases > 0;
const hidden = () => typeof document !== "undefined" && document.hidden;
const emit = () => listeners.forEach((f) => f());

/** 23:00 to 07:00 in Lagos, which is UTC+1 all year. The same window as push (supabase/push.sql). */
const quiet = () => {
  const h = (new Date(Date.now()).getUTCHours() + 1) % 24;
  return h >= 23 || h < 7;
};
/** What the master gain should be right now: off when muted, half in quiet hours. */
const master = () => (muted ? 0 : LEVEL * (quiet() ? 0.5 : 1));

function mkChain(a: Ctx) {
  const g = a.createGain();
  const lp = a.createBiquadFilter();
  const c = a.createDynamicsCompressor();
  const n = Math.floor(a.sampleRate * 1.2);
  const b = a.createBuffer(1, n, a.sampleRate);
  const d = b.getChannelData(0);
  g.gain.value = isOff(a) ? LEVEL : master();
  lp.type = "lowpass";
  lp.frequency.value = 9000;
  lp.Q.value = 0.5;
  c.threshold.value = -16;
  c.knee.value = 14;
  c.ratio.value = 4;
  c.attack.value = 0.005;
  c.release.value = 0.22;
  g.connect(lp);
  lp.connect(c);
  c.connect(a.destination);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return { g, nb: b };
}

/** Moves the master to where it should be (quiet hours start and end, mute). Cheap when nothing changed. */
function syncMaster() {
  if (!AC || !MG || offline) return;
  const v = master();
  if (v === mgNow) return;
  mgNow = v;
  const t = AC.currentTime;
  const g = MG.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(v, t + 0.03);
}

function wake() {
  try {
    const p = (AC as AudioContext | null)?.resume();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* ignore */
  }
}

/** The only places a context is made or resumed: a real gesture, while sound is on (the app lane, or Play). */
function unlock() {
  gestT = performance.now();
  // Not before a real tap or key press: a script's dispatchEvent, or a mount, never makes the context.
  if (muted || !tapped || !isActive()) return;
  try {
    if (!AC) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      AC = new C();
      const k = mkChain(AC);
      MG = k.g;
      NB = k.nb;
      mgNow = master();
    }
    if (AC.state !== "running") wake();
    syncMaster();
    samples.load(AC);
    arm(IDLE);
  } catch {
    /* no audio on this device */
  }
}

/**
 * Sleep. Silence for IDLE ms (nothing started, nothing still ringing) and the context suspends, so the
 * app does not hold the phone's audio session or battery. The next tap wakes it in unlock(). While Play is
 * open it stays awake: its sounds come from timers and polls (a box appears, a box is in reach), not taps.
 */
let idleAt = 0;
let idleT: ReturnType<typeof setTimeout> | undefined;
function arm(ms: number) {
  if (offline) return;
  idleAt = Math.max(idleAt, performance.now() + ms);
  if (idleT) return;
  const check = () => {
    idleT = undefined;
    const left = idleAt - performance.now();
    if (left > 50) idleT = setTimeout(check, left);
    else doze();
  };
  idleT = setTimeout(check, ms);
}
function doze(force?: boolean) {
  if (!AC || offline || isOff(AC) || AC.state !== "running") return;
  if (!force && (playing || leases > 0)) return;
  try {
    void (AC as AudioContext).suspend().catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Without the app lane, outside Play the context is suspended too. It wakes in unlock() on the next gesture
 * while sound is on. With the app lane on, the idle timer above does this.
 */
let parkT: ReturnType<typeof setTimeout> | undefined;
function park() {
  if (isActive()) {
    arm(IDLE);
    return;
  }
  if (parkT) clearTimeout(parkT);
  parkT = setTimeout(() => {
    parkT = undefined;
    if (isActive()) return;
    doze(true);
  }, 400);
}

/** A gesture listener: only a real tap or key (not a script's dispatchEvent) lets the context and the sound files load. */
function onGesture(e: Event) {
  if (e.isTrusted) tapped = true;
  unlock();
}

/** Hidden page: nothing sounds. Voices stop, the context sleeps; it wakes on the next tap (or now, if the browser lets it). */
function onVisibility() {
  if (hidden()) {
    voices.hush();
    const t = AC ? AC.currentTime : 0;
    VO.slice().forEach((v) => v.kill(t));
    doze(true);
  } else if (AC && !muted && isActive()) wake();
}

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  ["pointerdown", "touchend", "click", "keydown"].forEach((n) => document.addEventListener(n, onGesture, true));
  document.addEventListener("visibilitychange", onVisibility);
}
install();

function ac(): Ctx | null {
  if (!AC) return null;
  if (offline) return AC;
  if (muted || !isActive() || hidden()) return null;
  if (AC.state !== "running") {
    wake();
    if (performance.now() - gestT > 500) return null;
  }
  return AC;
}

/**
 * A voice is one sound event: its nodes, its end time and a kill switch. Its lane (given, or the one of the
 * public call it belongs to) sets its priority and its output gain.
 */
function voice(a: Ctx, t: number, d: number, pr?: number, ln?: Lane): Voice {
  const now = a.currentTime;
  const e = t + d;
  const L: Lane = ln ?? cur ?? "moment";
  const P = pr == null ? LANES[L].p : pr;
  let dead = false;
  VO = VO.filter((v) => v.e > now);
  /* cap: at the busiest moment inside this voice's life, drop the lowest priority, oldest voice (or stay silent if all outrank it) */
  for (let g = 0; g < 9; g++) {
    let best: Voice[] = [];
    [t, ...VO.filter((w) => w.s > t && w.s < e).map((w) => w.s)].forEach((pt) => {
      const l = VO.filter((w) => w.s <= pt && w.e > pt);
      if (l.length > best.length) best = l;
    });
    if (best.length < MAXV) break;
    best.sort((x, y) => x.p - y.p || x.s - y.s);
    if (best[0].p > P) {
      dead = true;
      break;
    }
    best[0].kill(now);
  }
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  let count = 0;
  const out = a.createGain();
  out.gain.value = dead ? 0 : LANES[L].g;
  out.connect(MG as GainNode);
  nodes.push(out);
  const v: Voice = {
    s: t,
    e,
    p: P,
    l: L,
    out,
    add: (n) => {
      nodes.push(n);
      return n;
    },
    src: (s, t0, t1, off) => {
      nodes.push(s);
      sources.push(s);
      count++;
      s.onended = () => {
        if (--count <= 0) v.free();
      };
      (s as unknown as { start: (when: number, offset?: number) => void }).start(t0, off || 0);
      s.stop(t1);
    },
    free: () => {
      nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      });
      const i = VO.indexOf(v);
      if (i >= 0) VO.splice(i, 1);
    },
    kill: (t0) => {
      try {
        out.gain.cancelScheduledValues(t0);
        out.gain.setTargetAtTime(0, t0, 0.004);
        sources.forEach((s) => {
          try {
            s.stop(t0 + 0.03);
          } catch {
            /* not started or already stopped */
          }
        });
      } catch {
        /* ignore */
      }
      v.e = t0;
    },
  };
  VO.push(v);
  arm(Math.max(0, e - now) * 1000 + IDLE);
  return v;
}

/** A Moment is sounding (or scheduled to): UI sounds wait it out. */
const momentOn = (a: Ctx) => VO.some((v) => v.l === "moment" && v.e > a.currentTime);

function env(p: AudioParam, t: number, pk: number, at: number, d: number) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(pk, t + at);
  p.exponentialRampToValueAtTime(0.0001, t + d);
}
function bp(a: Ctx, x: Voice, f: number, q: number, type?: BiquadFilterType) {
  const n = x.add(a.createBiquadFilter());
  n.type = type || "bandpass";
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}

/* talking drum phrases. stroke = [start s, pitch Hz, squeeze up (x), release (x), length s, volume] */
type Stroke = readonly [number, number, number, number, number, number];
const DR: Record<string, Stroke[]> = {
  call: [[0, 146.8, 1.4, 0.9, 0.2, 0.36], [0.15, 185, 1.3, 0.9, 0.17, 0.3], [0.29, 146.8, 1.35, 0.88, 0.2, 0.32], [0.45, 220, 1.7, 0.92, 0.34, 0.44]],
  common: [[0, 220, 1.22, 0.92, 0.16, 0.7]],
  rare: [[0, 185, 1.3, 0.9, 0.22, 0.75]],
  epic: [[0, 164.8, 1.4, 0.88, 0.3, 0.85]],
  legendary: [[0, 110, 1.6, 0.82, 0.42, 1]],
  legendPhrase: [[0, 110, 1.6, 0.82, 0.42, 1], [0.32, 146.8, 1.4, 0.9, 0.22, 0.5], [0.58, 164.8, 1.45, 0.9, 0.24, 0.52], [0.84, 146.8, 1.4, 0.88, 0.24, 0.52], [1.12, 220, 1.75, 0.9, 0.5, 0.65]],
  exit: [[0, 220, 1, 0.62, 0.2, 0.34], [0.13, 165, 1, 0.55, 0.28, 0.32]],
};
/* agogo patterns: [pitch, volume, decay s, delay s] */
const AG: ReadonlyArray<ReadonlyArray<readonly [number, number, number, number]>> = [
  [[1174.66, 0.12, 0.5, 0]], // 0 soft high ping: box in range
  [[587.33, 0.16, 0.6, 0]], // 1 low bell
  [[880, 0.1, 0.55, 0], [587.33, 0.1, 0.7, 0.12]], // 2 high-low: streak pip
  [[1318.5, 0.1, 0.16, 0], [1760, 0.1, 0.22, 0.07]], // 3 short tick: coin
];
const ACC = [1, 0.35, 0.6, 0.35, 0.85, 0.35, 0.55, 0.45]; // shekere accents
const TAB = [pen(10), pen(12), pen(13), pen(14), pen(16)]; // tab ticks: D6 F#6 A6 B6 E7, the octave the tab_tick file itself is in

/* ------------------------------------------------------------ the voices -- */
const voices = {
  tone(f: number, d: number, type?: OscillatorType, v?: number, delay?: number, to?: number) {
    const a = ac();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const x = voice(a, t, d + 0.03);
    const o = a.createOscillator();
    const g = x.add(a.createGain());
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    env(g.gain, t, v || 0.05, 0.012, d);
    o.connect(g);
    g.connect(x.out);
    x.src(o, t, t + d + 0.03);
  },
  noise(d: number, v: number, f0: number, f1?: number | null, delay?: number, q?: number, pr?: number) {
    const a = ac();
    if (!a || !NB) return;
    const t = a.currentTime + (delay || 0);
    const x = voice(a, t, d + 0.02, pr);
    const s = a.createBufferSource();
    const f = bp(a, x, f0, q || 1);
    const g = x.add(a.createGain());
    s.buffer = NB;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + d);
    env(g.gain, t, v, Math.min(0.01, d / 3), d);
    s.connect(f);
    f.connect(g);
    g.connect(x.out);
    x.src(s, t, t + d + 0.02, Math.random() * 0.9);
  },

  /** Shekere: band-passed noise grains (bright 5.6 kHz plus body 1.5 kHz) on a swung, accented grid. Builds and speeds up over `ms`, starting `delay` s from now. */
  shekere(ms: number, delay?: number) {
    const a = ac();
    if (!a || !NB) return;
    voices.hush();
    const t0 = a.currentTime + 0.02 + (delay || 0);
    const end = t0 + ms / 1000;
    const look = isOff(a) ? 1e3 : 0.2;
    const base = 0.115 - (Math.min(ms, 2200) / 2200) * 0.04;
    let nt = t0;
    let k = 0;
    const pump = () => {
      const A = ac();
      if (!A || A !== a || !NB) {
        clearInterval(shk);
        return;
      }
      while (nt < end && nt < A.currentTime + look) {
        const p = (nt - t0) / (end - t0);
        const lv = (0.45 + 0.55 * p) * ACC[k % 8] * 0.5;
        const x = voice(A, nt, 0.11, 0, "moment");
        const s = A.createBufferSource();
        s.buffer = NB;
        const at = nt;
        (
          [
            [5600, 1.3, 0.8],
            [1500, 1.7, 1.1],
          ] as const
        ).forEach((b) => {
          const f = bp(A, x, b[0] * (0.92 + Math.random() * 0.16), b[1]);
          const g = x.add(A.createGain());
          const q = g.gain;
          const vv = lv * b[2];
          q.setValueAtTime(0.0001, at);
          q.exponentialRampToValueAtTime(vv, at + 0.004);
          q.exponentialRampToValueAtTime(vv * 0.3, at + 0.02);
          q.exponentialRampToValueAtTime(vv * 0.65, at + 0.027);
          q.exponentialRampToValueAtTime(0.0001, at + 0.1);
          s.connect(f);
          f.connect(g);
          g.connect(x.out);
        });
        x.src(s, at, at + 0.11, Math.random() * 0.9);
        nt += base * (1 - 0.3 * p) * (k % 2 ? 0.85 : 1.15);
        k++;
      }
      if (nt >= end) clearInterval(shk);
    };
    pump();
    if (nt < end) shk = setInterval(pump, 50);
  },
  /** Stops the shekere (priority 0 voices) at once. */
  hush() {
    clearInterval(shk);
    const a = AC;
    if (!a) return;
    VO.filter((v) => v.p === 0).forEach((v) => v.kill(a.currentTime));
  },

  /** Agogo: a double iron bell, a fifth apart, inharmonic partials 1 / 2.76 / 5.4, hard strike. */
  bell(f: number, v: number, d: number, delay?: number) {
    const a = ac();
    if (!a || !NB) return;
    const t = a.currentTime + (delay || 0);
    const x = voice(a, t, d + 0.05);
    (
      [
        [1, 1, 1],
        [2.76, 0.5, 0.5],
        [5.4, 0.22, 0.28],
      ] as const
    ).forEach((p) => {
      const o = a.createOscillator();
      const g = x.add(a.createGain());
      o.frequency.value = f * p[0];
      env(g.gain, t, v * p[1], 0.002, d * p[2]);
      o.connect(g);
      g.connect(x.out);
      x.src(o, t, t + d * p[2] + 0.03);
    });
    const s = a.createBufferSource();
    const h = bp(a, x, 5200, 1.2);
    const g2 = x.add(a.createGain());
    s.buffer = NB;
    env(g2.gain, t, v * 0.35, 0.001, 0.014);
    s.connect(h);
    h.connect(g2);
    g2.connect(x.out);
    x.src(s, t, t + 0.03, Math.random() * 0.9);
  },
  agogo(i: number) {
    (AG[i] || AG[0]).forEach((b) => voices.bell(b[0], b[1], b[2], b[3]));
  },

  /** Talking drum (gangan): membrane tone with the squeeze bend, plus a short noise slap. */
  stroke(f: number, up: number, rel: number, d: number, v: number, delay?: number) {
    const a = ac();
    if (!a || !NB) return;
    const t = a.currentTime + (delay || 0);
    const x = voice(a, t, d + 0.06);
    const lp = bp(a, x, 1400, 0.7, "lowpass");
    const g = x.add(a.createGain());
    lp.connect(g);
    g.connect(x.out);
    env(g.gain, t, v * 0.7, 0.005, d * 1.15);
    (
      [
        ["sine", 1, 1],
        ["triangle", 1, 0.4],
        ["sine", 2, 0.4],
      ] as const
    ).forEach((w) => {
      const o = a.createOscillator();
      const m = x.add(a.createGain());
      const q = o.frequency;
      const k = w[1];
      o.type = w[0];
      m.gain.value = w[2];
      q.setValueAtTime(f * k, t);
      q.exponentialRampToValueAtTime(f * k * up, t + d * 0.4);
      q.exponentialRampToValueAtTime(f * k * rel, t + d);
      o.connect(m);
      m.connect(lp);
      x.src(o, t, t + d * 1.15 + 0.03);
    });
    const s = a.createBufferSource();
    const h = bp(a, x, 1500, 1.3);
    const g2 = x.add(a.createGain());
    s.buffer = NB;
    env(g2.gain, t, v * 0.2, 0.002, 0.035);
    s.connect(h);
    h.connect(g2);
    g2.connect(x.out);
    x.src(s, t, t + 0.05, Math.random() * 0.9);
  },
  /** A named phrase ("common", "rare", "epic", "legendary", "legendPhrase", "call", "exit") or a custom list of strokes. */
  talkingDrum(p?: string | Stroke[]) {
    const s = typeof p === "string" ? DR[p] : p;
    (s || DR.common).forEach((k) => voices.stroke(k[1], k[2], k[3], k[4], k[5], k[0]));
  },

  /** Danfo horn: two detuned tones, low-passed with a nasal band, short-short-long. Exported for the shell (Hop bus near). */
  danfoHorn() {
    const a = ac();
    if (!a) return;
    const t = a.currentTime + 0.01;
    const x = voice(a, t, 0.9);
    const m = x.add(a.createGain());
    const hg = x.add(a.createGain());
    const lp = bp(a, x, 1500, 2.5, "lowpass");
    const na = bp(a, x, 1050, 5);
    const ng = x.add(a.createGain());
    const H = [
      [0, 0.13],
      [0.19, 0.13],
      [0.38, 0.42],
    ];
    m.connect(lp);
    m.connect(na);
    na.connect(ng);
    ng.gain.value = 0.9;
    lp.connect(hg);
    ng.connect(hg);
    hg.connect(x.out);
    const q = hg.gain;
    q.setValueAtTime(0.0001, t);
    H.forEach((h) => {
      q.setValueAtTime(0.0001, t + h[0]);
      q.linearRampToValueAtTime(0.07, t + h[0] + 0.018);
      q.setValueAtTime(0.07, t + h[0] + h[1] - 0.03);
      q.linearRampToValueAtTime(0.0001, t + h[0] + h[1]);
    });
    (
      [
        ["sawtooth", 330],
        ["square", 415 * 1.004],
      ] as const
    ).forEach((w) => {
      const o = a.createOscillator();
      const g = x.add(a.createGain());
      const fq = o.frequency;
      o.type = w[0];
      g.gain.value = w[0] === "square" ? 0.55 : 1;
      H.forEach((h) => {
        fq.setValueAtTime(w[1] * 0.95, t + h[0]);
        fq.exponentialRampToValueAtTime(w[1], t + h[0] + 0.05);
      });
      o.connect(g);
      g.connect(m);
      x.src(o, t, t + 0.85);
    });
  },

  /** Crowd "ehn!": 5 detuned saws through formants 530 / 1840 / 2480 Hz, a quick pitch rise then fall, a breath of noise. `small` is the lighter, shorter one (3 saws) for WE OUTSIDE. */
  crowdEhn(small?: boolean) {
    const a = ac();
    if (!a || !NB) return;
    const t = a.currentTime + 0.01;
    const d = small ? 0.38 : 0.6;
    const x = voice(a, t, d + 0.1);
    const m = x.add(a.createGain());
    const bus = x.add(a.createGain());
    m.gain.setValueAtTime(0.0001, t);
    m.gain.exponentialRampToValueAtTime(1, t + 0.04);
    m.gain.setValueAtTime(1, t + d * 0.55);
    m.gain.exponentialRampToValueAtTime(0.0001, t + d);
    (
      [
        [530, 6, 1, 300],
        [1840, 10, 0.55, 1400],
        [2480, 12, 0.3, 2300],
      ] as const
    ).forEach((F) => {
      const f = bp(a, x, F[0], F[1]);
      const g = x.add(a.createGain());
      const q = f.frequency;
      g.gain.value = F[2] * 0.5;
      q.setValueAtTime(F[0], t);
      q.setValueAtTime(F[0], t + d * 0.6);
      q.linearRampToValueAtTime(F[3], t + d);
      m.connect(f);
      f.connect(g);
      g.connect(bus);
    });
    bus.connect(x.out);
    (small ? [-22, 2, 24] : [-30, -14, 2, 16, 31]).forEach((c, j) => {
      const o = a.createOscillator();
      const g = x.add(a.createGain());
      const ts = t + j * 0.011;
      const f0 = 212 * Math.pow(2, (c + rnd(-6, 6)) / 1200);
      const q = o.frequency;
      o.type = "sawtooth";
      g.gain.value = small ? 0.3 : 0.34;
      q.setValueAtTime(f0 * 0.84, ts);
      q.exponentialRampToValueAtTime(f0 * 1.3, ts + 0.13);
      q.exponentialRampToValueAtTime(f0 * 0.97, ts + d);
      o.connect(g);
      g.connect(m);
      x.src(o, ts, t + d + 0.05);
    });
    const s = a.createBufferSource();
    const h = bp(a, x, 2600, 1);
    const g3 = x.add(a.createGain());
    s.buffer = NB;
    env(g3.gain, t, 0.05, 0.01, 0.12);
    s.connect(h);
    h.connect(g3);
    g3.connect(x.out);
    x.src(s, t, t + 0.15, Math.random() * 0.9);
  },

  /** Wood and gourd: calabash knock (a far box) and a soft click (a card on the Shelf). */
  knock() {
    voices.noise(0.07, 0.3, 520, 260, 0, 2);
    voices.tone(130, 0.16, "sine", 0.26, 0, 88);
  },
  click() {
    voices.noise(0.03, 0.24, 1900, 1200, 0, 4);
    voices.tone(pen(8), 0.07, "sine", 0.16, 0, pen(6));
    voices.tone(190, 0.08, "sine", 0.14, 0, 150);
  },

  /** Small UI voices, same scale. */
  rip() {
    voices.noise(0.18, 0.38, 3000, 900, 0, 0.8);
  },
  swish(big?: boolean) {
    voices.noise(big ? 0.5 : 0.22, big ? 0.24 : 0.17, big ? 2000 : 3000, big ? 300 : 700, 0, 0.8);
  },
  fly() {
    voices.noise(0.14, 0.3, 1000, 2800, 0, 1.2);
  },
  chime(i: number) {
    const n = [pen(6), pen(8), pen(9), pen(11)][((i | 0) % 4 + 4) % 4];
    voices.tone(n, 0.45, "triangle", 0.16);
  },
  coin() {
    voices.agogo(3);
  },
  stamp() {
    voices.agogo(2);
    voices.tone(110, 0.2, "sine", 0.2, 0, 60);
  },
  tick(k?: number) {
    voices.tone(pen(5 + (((k || 0) | 0) % 6)), 0.09, "sine", 0.13);
  },
  flip() {
    voices.tone(330, 0.16, "triangle", 0.12, 0, 740);
  },
  sparkle() {
    [9, 11, 13].forEach((n, i) => voices.tone(pen(n), 0.5, "sine", 0.08, i * 0.08));
  },
  fill() {
    voices.tone(pen(3), 0.5, "sine", 0.08, 0, pen(8));
  },
  rise() {
    voices.tone(pen(0), 0.3, "sine", 0.08, 0, pen(5));
  },

  /**
   * The Hoppaz three (GAMIFY-NEXT 5.3): bells on D5, F#5, A5, short short long (about 120, 120, 420 ms) in the
   * danfo horn's rhythm, with one low drum stroke on D3 landing with the last note. "full" is the signature
   * (a Moment) and adds a short shekere shake, left out in quiet hours and on a low-tier phone; "short" is
   * the last two notes (a Reward).
   */
  motif(form?: "full" | "short") {
    const full = form !== "short";
    const N = full
      ? ([[pen(5), 0, 0.26], [pen(7), 0.12, 0.26], [pen(8), 0.24, 0.8]] as const)
      : ([[pen(7), 0, 0.26], [pen(8), 0.12, 0.8]] as const);
    N.forEach((n) => voices.bell(n[0], full ? 0.14 : 0.1, n[2], n[1]));
    voices.stroke(146.8, 1.4, 0.9, 0.3, full ? 0.18 : 0.1, full ? 0.24 : 0.12);
    if (full && (offline || (!quiet() && deviceTier() !== "low"))) voices.shekere(380, 0.24);
  },
  /** Check-in lands: a low thump, a wood slap and one agogo note. Pairs with motif("short") and the +100 XP count-up. */
  checkin() {
    voices.tone(120, 0.2, "sine", 0.38, 0, 62);
    voices.noise(0.05, 0.28, 1800, 900, 0, 2);
    voices.bell(pen(8), 0.13, 0.5, 0.03);
  },
  /** WE OUTSIDE: the small crowd "ehn". */
  outside() {
    voices.crowdEhn(true);
  },
  /** Someone waves at you: two soft rising pings, a chime. */
  wave() {
    voices.tone(pen(8), 0.4, "triangle", 0.11);
    voices.tone(pen(10), 0.45, "triangle", 0.09, 0.09);
  },
  /** A box alert arrives while the app is open: short, short, long, the shape of the vibration. */
  alert() {
    [[0, 0.07], [0.12, 0.07], [0.24, 0.22]].forEach((b) => voices.tone(pen(8), b[1], "triangle", 0.15, b[0]));
  },
  /** A toast: "ok" is a soft chime, "error" a low gentle knock. */
  toast(kind?: "ok" | "error") {
    if (kind === "error") {
      voices.tone(98, 0.22, "sine", 0.26, 0, 66);
      voices.noise(0.05, 0.12, 450, 220, 0, 2);
    } else {
      voices.tone(pen(8), 0.22, "sine", 0.12);
      voices.tone(pen(10), 0.3, "sine", 0.09, 0.07);
    }
  },
  /** A tab switch: a very quiet wood tick, one pitch per tab (D, F#, A, B, E up the scale, from D6). */
  tabTick(index: number) {
    voices.tone(TAB[(((index | 0) % 5) + 5) % 5], 0.05, "triangle", 0.14);
    voices.noise(0.012, 0.14, 3200, 2400, 0, 3);
  },
  /** You enter a Hotspot: two soft agogo notes with a low drum under. */
  hotspot() {
    voices.bell(pen(8), 0.09, 0.55);
    voices.bell(pen(10), 0.09, 0.6, 0.14);
    voices.stroke(110, 1.2, 0.9, 0.3, 0.08, 0.14);
  },
  /** A vibe sticker arrives: one tiny soft pop. */
  vibe() {
    voices.tone(520, 0.07, "sine", 0.14, 0, 980);
    voices.noise(0.015, 0.08, 3000, 2000, 0, 3);
  },
};

export type VoiceName = keyof typeof voices;

/** Sound must never break the game: a failure is logged, not thrown. */
const wrapped = {} as { [K in VoiceName]: (typeof voices)[K] };
(Object.keys(voices) as VoiceName[]).forEach((k) => {
  const f = voices[k] as (...a: unknown[]) => unknown;
  (wrapped as Record<string, unknown>)[k] = (...args: unknown[]) => {
    try {
      return f(...args);
    } catch (e) {
      console.warn("sfx." + k, e instanceof Error ? e.message : e);
    }
  };
});
// Voices call each other through `voices`; point those calls at the wrapped set too.
Object.assign(voices, wrapped);

/* ---------------------------------------------------------------- samples -- */
/** The notes a stepped voice asks for (Hz), as in chime() and tick() above, so a sample can follow them with playbackRate. */
const NOTE: Partial<Record<VoiceName, (n: number) => number>> = {
  chime: (i) => [pen(6), pen(8), pen(9), pen(11)][(((i | 0) % 4) + 4) % 4],
  tick: (k) => pen(5 + (((k || 0) | 0) % 6)),
  tabTick: (i) => TAB[(((i | 0) % 5) + 5) % 5],
};

/**
 * Plays a picked sample as a voice: same cap, lane, master chain and mute as
 * the synth. Returns false when nothing is picked for `key` or the file is not
 * decoded yet, and the caller plays the synth voice. `hz` steps the pitch of a
 * stepped voice, `max` cuts the file short (the shekere runs for as long as the box asks).
 */
function sample(key: string, hz?: number, max?: number): boolean {
  if (offline && !offSamples) return false;
  const s = samples.get(key);
  if (!s) return false;
  // Nothing sounds while the page is hidden. Muted or asleep, ac() is null and the synth would be silent too.
  if (hidden()) return true;
  const a = ac();
  if (!a) return true;
  if (s.p === 0) voices.hush();
  const r = hz && s.base ? Math.min(4, Math.max(0.25, hz / s.base)) : 1;
  const whole = s.buf.duration / r;
  const d = max != null && max > 0 ? Math.min(whole, max) : whole;
  const gain = offline && offG != null ? offG : s.g;
  const t = a.currentTime;
  const x = voice(a, t, d + 0.02, s.p, s.lane);
  const o = a.createBufferSource();
  const g = x.add(a.createGain());
  o.buffer = s.buf;
  o.playbackRate.value = r;
  g.gain.value = gain;
  if (d < whole - 0.001) {
    // cut short: fade out instead of ending on a click
    g.gain.setValueAtTime(gain, t + Math.max(0, d - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, t + d);
  }
  o.connect(g);
  g.connect(x.out);
  x.src(o, t, t + d + 0.02);
  return true;
}

/** The sample for a public voice call, if one is picked and ready. A custom stroke list, tone(), noise() and bell() never have one. */
function picked(k: VoiceName, a: unknown[]): boolean {
  const n = a[0];
  switch (k) {
    case "talkingDrum":
      return (n == null || typeof n === "string") && sample("talkingDrum:" + (n || "common"));
    case "agogo":
      return sample("agogo:" + n);
    case "shekere":
      return sample(k, undefined, typeof n === "number" ? n / 1000 : undefined);
    case "motif":
      return sample(n === "short" ? "hoppaz_three_short" : "hoppaz_three_full");
    case "checkin":
      return sample("checkin_stamp");
    case "outside":
      return sample("we_outside_ehn");
    case "wave":
      return sample("wave_received");
    case "alert":
      return sample("box_alert");
    case "toast":
      return sample(n === "error" ? "toast_error" : "toast_ok");
    case "hotspot":
      return sample("hotspot_enter");
    case "vibe":
      return sample("vibe_sticker_pop");
    case "tabTick":
      return sample("tab_tick", NOTE.tabTick?.(n as number));
    default:
      return sample(k, NOTE[k]?.(n as number));
  }
}

/* ------------------------------------------------------------------ lanes -- */
/**
 * What the lane of each public call is (the cue's lane in public/sfx/try/manifest.json), and whether it
 * is loud: "noisy" calls (shekere, the crowd) are skipped in quiet hours and on a low-tier phone, "loud"
 * ones (the horn) in quiet hours only.
 */
type Rule = { l: Lane | ((a: unknown[]) => Lane); skip?: "noisy" | "loud" };
const moment: Rule = { l: "moment" };
const reward: Rule = { l: "reward" };
const ui: Rule = { l: "ui" };
const RULE: Record<Exclude<VoiceName, "hush">, Rule> = {
  tone: ui,
  noise: ui,
  shekere: { l: "moment", skip: "noisy" },
  bell: reward,
  agogo: { l: (a) => (a[0] === 3 ? "ui" : "reward") },
  stroke: moment,
  talkingDrum: { l: (a) => (a[0] === "exit" ? "reward" : "moment") },
  danfoHorn: { l: "moment", skip: "loud" },
  crowdEhn: { l: "moment", skip: "noisy" },
  knock: ui,
  click: ui,
  rip: moment,
  swish: moment,
  fly: reward,
  chime: reward,
  coin: reward,
  stamp: reward,
  tick: ui,
  flip: ui,
  sparkle: moment,
  fill: reward,
  rise: reward,
  motif: { l: (a) => (a[0] === "short" ? "reward" : "moment") },
  checkin: reward,
  outside: { l: "reward", skip: "noisy" },
  wave: reward,
  alert: ui,
  toast: ui,
  tabTick: ui,
  hotspot: reward,
  vibe: ui,
};
const laneOf = (r: Rule, a: unknown[]) => (typeof r.l === "function" ? r.l(a) : r.l);

/** Runs `fn` with `l` as the lane of every voice it makes. The outermost call wins, so a voice that calls others keeps its lane. */
function scoped(l: Lane, fn: () => void) {
  const prev = cur;
  if (!prev) cur = l;
  try {
    fn();
  } finally {
    cur = prev;
  }
}

/* The same sound: a call and its first argument (chime(1) is a different note from chime(2), toast("ok") from toast("error")). */
const seen = new Map<string, number>();
let uiAt: number[] = [];
let motifAt = -Infinity;
let shortAt = -Infinity;
let motifTo = 0;

/** The rules of 5.4 that say whether this call sounds at all. Counts it when it does. */
function admit(k: string, a: unknown[], r: Rule, l: Lane): boolean {
  const now = performance.now();
  const n = a[0];
  const key = typeof n === "string" || typeof n === "number" || typeof n === "boolean" ? k + ":" + n : k;
  if (now - (seen.get(key) ?? -Infinity) < COOL) return false;
  if (r.skip && (quiet() || (r.skip === "noisy" && deviceTier() === "low"))) return false;
  if (l === "ui") {
    uiAt = uiAt.filter((t) => now - t < 1000);
    // the count-up tick is chatter (10 a second in the open): it takes at most half the budget, so the flip and the click after it still sound
    if (uiAt.length >= (k === "tick" ? UI_MAX / 2 : UI_MAX) || (AC && momentOn(AC))) return false;
  }
  if (k === "motif") {
    const full = n !== "short";
    // the signature: not twice in one moment, and once every 8 s. The full one has its own clock, so a day-7 streak is
    // never lost to a check-in a few seconds before; the short one waits out both (a quest claimed soon after a check-in gets the coin only).
    if (now < motifTo || now - (full ? motifAt : Math.max(motifAt, shortAt)) < MOTIF_EVERY) return false;
    motifTo = now + (full ? 1300 : 900);
    if (full) motifAt = now;
    else shortAt = now;
  }
  if (l === "ui") uiAt.push(now);
  seen.set(key, now);
  if (seen.size > 80) seen.forEach((t, x) => now - t > 2000 && seen.delete(x));
  return true;
}

/**
 * Every public call comes through here: the context must exist (made in a tap), sound must be on and the
 * page visible, and admit() must say yes. A context that went to sleep wakes in the tap that follows; for a
 * sound that comes from a timer or a message it is asked to wake now, and the sound plays only if it is up
 * within 400 ms, so nothing queues up and bursts out later.
 */
function play(k: string, a: unknown[], r: Rule, fn: () => void) {
  const l = laneOf(r, a);
  if (offline) {
    scoped(l, fn);
    return;
  }
  const ctx = AC as AudioContext | null;
  if (!ctx || muted || !isActive() || hidden()) return;
  const go = () => {
    if (!admit(k, a, r, l)) return;
    syncMaster();
    scoped(l, fn);
  };
  if (ctx.state !== "running" && performance.now() - gestT > 500) {
    const t = performance.now();
    try {
      void ctx.resume().then(
        () => performance.now() - t < 400 && ctx.state === "running" && go(),
        () => {}
      );
    } catch {
      /* cannot wake without a tap */
    }
    return;
  }
  go();
}

/** The public voices: the picked sample, else the synth voice above. The synth set stays as it was for voices that call each other. */
const routed = {} as typeof wrapped;
(Object.keys(wrapped) as VoiceName[]).forEach((k) => {
  const f = wrapped[k] as (...a: unknown[]) => unknown;
  const r = RULE[k as Exclude<VoiceName, "hush">];
  (routed as Record<string, unknown>)[k] = r
    ? (...args: unknown[]) =>
        play(k, args, r, () => {
          try {
            if (picked(k, args)) return;
          } catch (e) {
            console.warn("sfx." + k + " sample", e instanceof Error ? e.message : e);
          }
          f(...args);
        })
    : f;
});

/**
 * The cues that have no voice of their own name (see PICKS), and the public call each one belongs to, so
 * cue() keeps the same lane and rules as sfx.motif(), toast() and the rest. They are the same sounds.
 */
export type CueName = Exclude<PickKey, VoiceName | `${string}:${string}`>;
const CUE_OF: Record<CueName, [Exclude<VoiceName, "hush">, unknown[]]> = {
  hoppaz_three_full: ["motif", ["full"]],
  hoppaz_three_short: ["motif", ["short"]],
  checkin_stamp: ["checkin", []],
  we_outside_ehn: ["outside", []],
  wave_received: ["wave", []],
  hotspot_enter: ["hotspot", []],
  box_alert: ["alert", []],
  toast_ok: ["toast", ["ok"]],
  toast_error: ["toast", ["error"]],
  vibe_sticker_pop: ["vibe", []],
  tab_tick: ["tabTick", [0]],
};
/** The picked file for a cue, or nothing (no synth fallback; sfx.motif() and the rest have one). `hz` steps a stepped cue's pitch. */
function cue(name: CueName, hz?: number) {
  if (!samples.get(name)) return;
  const [k, a] = CUE_OF[name];
  play(k, a, RULE[k], () => {
    try {
      sample(name, hz);
    } catch (e) {
      console.warn("sfx.cue " + name, e instanceof Error ? e.message : e);
    }
  });
}

/* ---------------------------------------------------------------- control -- */
const control = {
  /** Muted by the player. Persisted. Takes effect at once: master to 0, every live voice stopped. */
  setMuted(mute: boolean) {
    if (muted === mute) return;
    const on = mute;
    muted = on;
    try {
      localStorage.setItem(KEY, on ? "off" : "on");
    } catch {
      /* storage blocked */
    }
    if (AC && MG && !offline) {
      syncMaster();
      if (on) {
        const t = AC.currentTime;
        voices.hush();
        VO.slice().forEach((v) => v.kill(t + 0.03));
      }
    }
    if (!on) unlock();
    emit();
  },
  isMuted: () => muted,
  /** For useSyncExternalStore: fires when the mute state changes. */
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /**
   * The root layout calls this with true (<SoundLane />): reward and UI sounds then work on every tab, not
   * only in Play. The context is still made only in a real tap, and it sleeps after about 15 s of silence.
   */
  setApp(on: boolean) {
    app = on;
    if (!on) park();
    else if (AC) arm(IDLE);
  },
  /** The shell calls this with true on entering Play and false on leaving it. Without the app lane, nothing sounds while false. */
  setPlaying(on: boolean) {
    playing = on;
    if (on) {
      // Entering Play is itself a tap: if one just happened, make the context now.
      const ua = typeof navigator !== "undefined" ? (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation : undefined;
      if (ua?.isActive || performance.now() - gestT < 1000) unlock();
    } else {
      voices.hush();
      // Leaving Play stops what Play was playing. With the app lane on, the rest of the app keeps its sounds.
      if (!app) {
        const t = AC ? AC.currentTime : 0;
        VO.slice().forEach((v) => v.kill(t));
      }
      park();
    }
  },
  /** An open stage holds a lease while it is on screen, so it can sound even before the shell flag is set. Balanced by release(). */
  acquire() {
    leases++;
    if (performance.now() - gestT < 1000) unlock();
  },
  release() {
    leases = Math.max(0, leases - 1);
    if (leases === 0) park();
  },
  /** Resume the context from a gesture handler. Safe to call any time. */
  unlock,
  /** Cuts the shekere. */
  hush: () => voices.hush(),
};

export const sfx = Object.assign(routed, control, { cue }) as typeof routed & typeof control & { cue: typeof cue };

/* ---------------------------------------------------- offline rendering -- */
/**
 * Dev and test only: renders one voice (or a function that plays several, to
 * test overlaps) through the real chain into an OfflineAudioContext and reports
 * its peak and RMS, and the samples. A voice name renders the synth in its lane; a function
 * such as () => sfx.chime(1) goes through the public call, and with `opts.samples` plays the
 * picked file (decoded earlier by the real context) at its trim, or at `opts.g` to try another.
 * None of the lane rules (cooldown, Moment skip, quiet hours) apply offline. Not used by the app.
 */
export async function renderOffline(
  name: VoiceName | (() => void),
  args: unknown[] = [],
  seconds = 3,
  rate = 44100,
  opts: { samples?: boolean; g?: number } = {}
): Promise<{ peak: number; rms: number; seconds: number; data: Float32Array }> {
  const off = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const saved = { AC, MG, NB, VO, offline, offSamples, offG, cur };
  AC = off;
  const k = mkChain(off);
  MG = k.g;
  NB = k.nb;
  VO = [];
  offline = true;
  offSamples = !!opts.samples;
  offG = opts.g;
  cur = null;
  let data: Float32Array;
  try {
    if (typeof name === "function") name();
    else {
      const r = RULE[name as Exclude<VoiceName, "hush">];
      scoped(r ? laneOf(r, args) : "moment", () => (voices[name] as (...a: unknown[]) => unknown)(...args));
    }
    const buf = await off.startRendering();
    data = buf.getChannelData(0);
  } finally {
    clearInterval(shk);
    AC = saved.AC;
    MG = saved.MG;
    NB = saved.NB;
    VO = saved.VO;
    offline = saved.offline;
    offSamples = saved.offSamples;
    offG = saved.offG;
    cur = saved.cur;
  }
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sum += data[i] * data[i];
  }
  return { peak, rms: Math.sqrt(sum / data.length), seconds, data };
}
