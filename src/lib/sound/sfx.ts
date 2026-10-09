/**
 * The Lagos sounds for Play. Pure Web Audio, generated, no files.
 *
 * Instruments: shekere (beaded gourd), agogo (double iron bell), talking drum
 * (gangan, with the squeeze bend), danfo horn, the crowd's "ehn!", a calabash
 * knock. Everything pitched sits in D major pentatonic.
 *
 * Chain: voices -> master gain -> low-pass -> compressor -> out. At most 6
 * voices at once (lowest priority, then oldest, is dropped first). A voice
 * frees its nodes when its sources end.
 *
 * Rules:
 *  - The AudioContext is created and resumed only inside a real user gesture
 *    (pointerdown, touchend, click, keydown), and only while Play is active, so
 *    nothing plays or takes the phone's audio session outside Play.
 *  - Play is active while the shell has called setPlaying(true), or while an
 *    open stage holds a lease (acquire/release).
 *  - setMuted(boolean) is persisted in localStorage key "hz-sound" ("off" or
 *    "on"). Default is on.
 */

type Ctx = BaseAudioContext;

const KEY = "hz-sound";
const MAXV = 6;
const LEVEL = 0.7;
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
let gestT = 0;
let shk: ReturnType<typeof setInterval> | undefined;
let muted = false;
let playing = false;
let leases = 0;
let offline = false;
const listeners = new Set<() => void>();

try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "off";
} catch {
  /* storage blocked: sound stays on for this visit */
}

const isOff = (a: Ctx): a is OfflineAudioContext => "startRendering" in a;
const isActive = () => playing || leases > 0;
const emit = () => listeners.forEach((f) => f());

function mkChain(a: Ctx) {
  const g = a.createGain();
  const lp = a.createBiquadFilter();
  const c = a.createDynamicsCompressor();
  const n = Math.floor(a.sampleRate * 1.2);
  const b = a.createBuffer(1, n, a.sampleRate);
  const d = b.getChannelData(0);
  g.gain.value = LEVEL;
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

function wake() {
  try {
    const p = (AC as AudioContext | null)?.resume();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* ignore */
  }
}

/** The only places a context is made or resumed: a real gesture, while Play is active. */
function unlock() {
  gestT = performance.now();
  if (muted || !isActive()) return;
  try {
    if (!AC) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      AC = new C();
      const k = mkChain(AC);
      MG = k.g;
      NB = k.nb;
    }
    if (AC.state !== "running") wake();
  } catch {
    /* no audio on this device */
  }
}

/**
 * Outside Play the context is suspended, so the app does not hold the phone's audio session. It wakes in unlock() on
 * the next gesture while Play is active.
 */
let parkT: ReturnType<typeof setTimeout> | undefined;
function park() {
  if (parkT) clearTimeout(parkT);
  parkT = setTimeout(() => {
    parkT = undefined;
    if (isActive() || !AC || offline || isOff(AC) || AC.state !== "running") return;
    try {
      void (AC as AudioContext).suspend().catch(() => {});
    } catch {
      /* ignore */
    }
  }, 400);
}

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  ["pointerdown", "touchend", "click", "keydown"].forEach((n) => document.addEventListener(n, unlock, true));
}
install();

function ac(): Ctx | null {
  if (!AC) return null;
  if (offline) return AC;
  if (muted || !isActive()) return null;
  if (AC.state !== "running") {
    wake();
    if (performance.now() - gestT > 500) return null;
  }
  return AC;
}

/** A voice is one sound event: its nodes, its end time and a kill switch. */
function voice(a: Ctx, t: number, d: number, pr?: number): Voice {
  const now = a.currentTime;
  const e = t + d;
  const P = pr == null ? 1 : pr;
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
  if (dead) out.gain.value = 0;
  out.connect(MG as GainNode);
  nodes.push(out);
  const v: Voice = {
    s: t,
    e,
    p: P,
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
  return v;
}

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

  /** Shekere: band-passed noise grains (bright 5.6 kHz plus body 1.5 kHz) on a swung, accented grid. Builds and speeds up over `ms`. */
  shekere(ms: number) {
    const a = ac();
    if (!a || !NB) return;
    voices.hush();
    const t0 = a.currentTime + 0.02;
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
        const x = voice(A, nt, 0.11, 0);
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
    const x = voice(a, t, d + 0.05, 2);
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
    const x = voice(a, t, d + 0.06, 2);
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
    const x = voice(a, t, 0.9, 2);
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

  /** Crowd "ehn!": 5 detuned saws through formants 530 / 1840 / 2480 Hz, a quick pitch rise then fall, a breath of noise. */
  crowdEhn() {
    const a = ac();
    if (!a || !NB) return;
    const t = a.currentTime + 0.01;
    const d = 0.6;
    const x = voice(a, t, d + 0.1, 2);
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
    [-30, -14, 2, 16, 31].forEach((c, j) => {
      const o = a.createOscillator();
      const g = x.add(a.createGain());
      const ts = t + j * 0.011;
      const f0 = 212 * Math.pow(2, (c + rnd(-6, 6)) / 1200);
      const q = o.frequency;
      o.type = "sawtooth";
      g.gain.value = 0.34;
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
    voices.noise(0.07, 0.3, 520, 260, 0, 2, 1);
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
      const t = AC.currentTime;
      const g = MG.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(on ? 0 : LEVEL, t + 0.03);
      if (on) {
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
  /** The shell calls this with true on entering Play and false on leaving it. Nothing sounds while false. */
  setPlaying(on: boolean) {
    playing = on;
    if (on) {
      // Entering Play is itself a tap: if one just happened, make the context now.
      const ua = typeof navigator !== "undefined" ? (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation : undefined;
      if (ua?.isActive || performance.now() - gestT < 1000) unlock();
    } else {
      voices.hush();
      const t = AC ? AC.currentTime : 0;
      VO.slice().forEach((v) => v.kill(t));
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

export const sfx = Object.assign(wrapped, control) as typeof wrapped & typeof control;

/* ---------------------------------------------------- offline rendering -- */
/**
 * Dev and test only: renders one voice (or a function that plays several, to
 * test overlaps) through the real chain into an OfflineAudioContext and reports
 * its peak and RMS. Not used by the app.
 */
export async function renderOffline(
  name: VoiceName | (() => void),
  args: unknown[] = [],
  seconds = 3,
  rate = 44100
): Promise<{ peak: number; rms: number; seconds: number }> {
  const off = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const saved = { AC, MG, NB, VO, offline };
  AC = off;
  const k = mkChain(off);
  MG = k.g;
  NB = k.nb;
  VO = [];
  offline = true;
  let data: Float32Array;
  try {
    if (typeof name === "function") name();
    else (voices[name] as (...a: unknown[]) => unknown)(...args);
    const buf = await off.startRendering();
    data = buf.getChannelData(0);
  } finally {
    clearInterval(shk);
    AC = saved.AC;
    MG = saved.MG;
    NB = saved.NB;
    VO = saved.VO;
    offline = saved.offline;
  }
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sum += data[i] * data[i];
  }
  return { peak, rms: Math.sqrt(sum / data.length), seconds };
}
