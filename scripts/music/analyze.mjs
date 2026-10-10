/**
 * Tempo, beat grid, downbeat and structure analysis for one generated take.
 * Pure Node (no aubio or librosa on this machine): a spectral-flux onset envelope,
 * a comb-filter tempo and phase search around the planned BPM, a robust line fit through
 * the strongest onset near every grid beat, and a downbeat vote from kick strength and
 * chord change. Used by loop.mjs.
 */
import { at, clamp, db, detrend, getFFT, mean, median, quantile, rms, stdev, stftMag } from "./dsp.mjs";

const N = 2048;
const HOP = 512;

/** Band onset envelopes (low = kick and bass, all = everything), one value per HOP samples. */
export function onsetEnvelopes(mono, sr) {
  const { data, frames, bins } = stftMag(mono, N, HOP);
  const binHz = sr / N;
  const band = (a, b) => [Math.max(1, Math.round(a / binHz)), Math.min(bins - 1, Math.round(b / binHz))];
  const bands = { low: band(30, 250), mid: band(250, 2500), high: band(2500, 12000) };
  const flux = { low: new Float32Array(frames), mid: new Float32Array(frames), high: new Float32Array(frames) };
  const prev = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    for (const [name, [a, b]] of Object.entries(bands)) {
      let s = 0;
      for (let k = a; k <= b; k++) {
        const l = Math.log1p(10 * data[f * bins + k]);
        const d = l - prev[k];
        if (d > 0 && f > 0) s += d;
      }
      flux[name][f] = s;
    }
    for (let k = 0; k < bins; k++) prev[k] = Math.log1p(10 * data[f * bins + k]);
  }
  const norm = (a) => {
    const q = quantile(a, 0.95) || 1;
    return a.map((v) => v / q);
  };
  const low = norm(flux.low);
  const mid = norm(flux.mid);
  const high = norm(flux.high);
  const all = new Float32Array(frames);
  for (let i = 0; i < frames; i++) all[i] = low[i] + mid[i] + high[i];
  const fr = sr / HOP;
  return { all: detrend(all, Math.round(fr * 0.5)), low: detrend(low, Math.round(fr * 0.5)), fr, frames, hop: HOP, n: N };
}

/** Comb search: best BPM and phase (in frames) in [lo, hi]. */
export function combSearch(env, fr, lo, hi, step, phaseStep = 0.5) {
  let best = { score: -1, bpm: lo, phase: 0 };
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += step) {
    const P = (60 * fr) / bpm;
    const nb = Math.floor((env.length - 2 - P) / P);
    for (let phase = 0; phase < P; phase += phaseStep) {
      let s = 0;
      for (let k = 0; k < nb; k++) s += at(env, phase + k * P);
      s /= nb;
      if (s > best.score) best = { score: s, bpm, phase, P };
    }
  }
  return best;
}

/** Robust line fit through the strongest onset near each grid beat. */
export function fitBeats(env, fr, bpm, phase, from = 0, to = env.length) {
  const P = (60 * fr) / bpm;
  const pts = [];
  for (let k = 0; phase + k * P < to - 2; k++) {
    const c = phase + k * P;
    if (c < from) continue;
    const a = Math.max(1, Math.ceil(c - 0.18 * P));
    const b = Math.min(env.length - 2, Math.floor(c + 0.18 * P));
    if (b <= a) continue;
    let bi = a;
    for (let i = a; i <= b; i++) if (env[i] > env[bi]) bi = i;
    // parabolic refinement
    const y0 = env[bi - 1], y1 = env[bi], y2 = env[bi + 1];
    const den = y0 - 2 * y1 + y2;
    const off = den !== 0 ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
    pts.push({ k, t: bi + off, s: y1 });
  }
  if (pts.length < 8) return null;
  const sMed = median(pts.map((p) => p.s));
  let use = pts.filter((p) => p.s >= sMed);
  let fit;
  for (let iter = 0; iter < 4; iter++) {
    const n = use.length;
    const mk = mean(use.map((p) => p.k));
    const mt = mean(use.map((p) => p.t));
    let sxy = 0, sxx = 0;
    for (const p of use) {
      sxy += (p.k - mk) * (p.t - mt);
      sxx += (p.k - mk) ** 2;
    }
    const slope = sxy / sxx;
    const icpt = mt - slope * mk;
    const res = pts.map((p) => p.t - (icpt + slope * p.k));
    const mad = median(res.map((r) => Math.abs(r))) || 0.5;
    fit = { slope, icpt, n, res };
    use = pts.filter((p, i) => Math.abs(res[i]) <= Math.max(2.5 * 1.4826 * mad, 0.4)).filter((p) => p.s >= sMed * 0.5);
    if (use.length < 8) break;
  }
  const inl = fit.res.filter((r) => Math.abs(r) < 1.5);
  return {
    periodFrames: fit.slope,
    bpm: (60 * fr) / fit.slope,
    t0Frames: fit.icpt,
    wobbleMs: (stdev(inl) / fr) * 1000,
    beats: pts.length,
    inliers: inl.length,
  };
}

/** 12-bin chroma per beat segment (band 130 to 2000 Hz) from a long-window STFT. */
function beatChroma(mono, sr, beatStarts, beatLen) {
  const NN = 8192;
  const { fft, hann } = getFFT(NN);
  const re = new Float64Array(NN);
  const im = new Float64Array(NN);
  const out = [];
  for (const s of beatStarts) {
    const c = Math.round(s + beatLen / 2 - NN / 2);
    const v = new Float64Array(12);
    if (c >= 0 && c + NN <= mono.length) {
      for (let i = 0; i < NN; i++) {
        re[i] = mono[c + i] * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 1; k < NN / 2; k++) {
        const f = (k * sr) / NN;
        if (f < 130 || f > 2000) continue;
        const m = Math.hypot(re[k], im[k]);
        const pc = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
        v[pc] += m * m;
      }
    }
    const t = Math.sqrt(v.reduce((a, b) => a + b, 0)) || 1;
    out.push(v.map((x) => Math.sqrt(x) / t));
  }
  return out;
}

const cos12 = (a, b) => {
  let n = 0, x = 0, y = 0;
  for (let i = 0; i < 12; i++) {
    n += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return n / (Math.sqrt(x * y) + 1e-12);
};
export { beatChroma, cos12 };

/**
 * Full analysis. `planned` is the BPM the prompt asked for.
 * Returns the beat grid in samples: beatSamples (float), the downbeat phase and the bar length.
 */
export function analyzeTake(mono, sr, planned) {
  const env = onsetEnvelopes(mono, sr);
  const { fr } = env;
  // Combined evidence: low band counts double, kicks carry the pulse.
  const comb = new Float32Array(env.all.length);
  for (let i = 0; i < comb.length; i++) comb[i] = env.all[i] + env.low[i];

  // Global tempo, 60 to 200 BPM, scored by beat contrast (on-beat energy over off-beat energy).
  let global = { bpm: planned, contrast: 0 };
  for (let bpm = 60; bpm <= 200; bpm += 0.25) {
    const P = (60 * fr) / bpm;
    const nb = Math.floor((comb.length - 2 - P) / P);
    let bestOn = 0, bestC = 0;
    for (let phase = 0; phase < P; phase += 1) {
      let on = 0, off = 0;
      for (let k = 0; k < nb; k++) {
        on += at(comb, phase + k * P);
        off += at(comb, phase + (k + 0.5) * P);
      }
      const c = on / nb - 0.5 * (off / nb);
      if (c > bestC) {
        bestC = c;
        bestOn = on / nb;
      }
    }
    if (bestC > global.contrast) global = { bpm, contrast: bestC };
  }

  // Refined tempo near the plan.
  const coarse = combSearch(comb, fr, planned * 0.94, planned * 1.06, 0.02);
  let fit = fitBeats(comb, fr, coarse.bpm, coarse.phase);
  if (fit) fit = fitBeats(comb, fr, fit.bpm, fit.t0Frames - Math.floor(fit.t0Frames / fit.periodFrames) * fit.periodFrames) ?? fit;
  const bpm = fit?.bpm ?? coarse.bpm;
  const P = (60 * fr) / bpm;

  // Tempo per half of the take, for drift.
  const mid = Math.floor(comb.length / 2);
  const f1 = fitBeats(comb, fr, bpm, fit?.t0Frames ?? coarse.phase, 0, mid);
  const f2 = fitBeats(comb, fr, bpm, fit?.t0Frames ?? coarse.phase, mid, comb.length);

  // Beat grid in samples.
  const t0 = fit ? fit.t0Frames - Math.floor(fit.t0Frames / fit.periodFrames) * fit.periodFrames : coarse.phase;
  const beatSamples = [];
  // Start one beat early so a downbeat at the very first sample is not lost.
  // Frame f spans [f*hop, f*hop+N); an onset registers about N/3 into it. The offset is only a first
  // guess: loop.mjs snaps the grid to the real transients (calibrateGrid) before using it.
  for (let k = -1; t0 + k * P < comb.length - 1; k++) beatSamples.push((t0 + k * P) * env.hop + env.n / 3);

  const beatLen = (60 / bpm) * sr;
  // Downbeat vote among the 4 beat phases.
  const chroma = beatChroma(mono, sr, beatSamples, beatLen);
  const votes = [0, 1, 2, 3].map((j) => ({ low: [], all: [], nov: [] }));
  const win = Math.max(1, Math.round(0.12 * P));
  for (let k = 1; k < beatSamples.length - 1; k++) {
    const c = (beatSamples[k] - env.n / 3) / env.hop;
    let lo = 0, al = 0;
    for (let i = Math.round(c - win); i <= Math.round(c + win); i++) {
      lo = Math.max(lo, env.low[i] ?? 0);
      al = Math.max(al, env.all[i] ?? 0);
    }
    const v = votes[k % 4];
    v.low.push(lo);
    v.all.push(al);
    if (chroma[k - 1].some((q) => q > 0)) v.nov.push(1 - cos12(chroma[k - 1], chroma[k]));
  }
  const z = (arr) => {
    const m = mean(arr), s = stdev(arr) || 1;
    return arr.map((x) => (x - m) / s);
  };
  const lowM = votes.map((v) => mean(v.low));
  const allM = votes.map((v) => mean(v.all));
  const novM = votes.map((v) => (v.nov.length ? mean(v.nov) : 0));
  // Chord changes land on the bar line more reliably than any one drum does, so they weigh most.
  const score = z(lowM).map((a, j) => a * 0.5 + z(allM)[j] * 0.5 + z(novM)[j] * 1.5);
  let phase4 = 0;
  for (let j = 1; j < 4; j++) if (score[j] > score[phase4]) phase4 = j;

  // First downbeat at or after the start of the take.
  const barBeats = 4;
  const firstDown = beatSamples.findIndex((b, k) => k % 4 === phase4 && b > -0.02 * sr);
  const barSamples = beatLen * barBeats;
  const downSamples = [];
  for (let k = firstDown; k < beatSamples.length; k += 4) downSamples.push(beatSamples[k]);

  // Per-bar level and onset density.
  const barRms = [];
  for (let i = 0; i + 1 < downSamples.length; i++) barRms.push(db(rms(mono, downSamples[i], downSamples[i] + barSamples)));
  const barOnsets = [];
  for (let i = 0; i + 1 < downSamples.length; i++) {
    const a = Math.round(((downSamples[i] - env.n / 2) / env.hop));
    const b = Math.round(((downSamples[i + 1] - env.n / 2) / env.hop));
    let s = 0;
    for (let f = Math.max(0, a); f < Math.min(env.all.length, b); f++) s += env.all[f];
    barOnsets.push(s);
  }

  return {
    sr,
    planned,
    bpm,
    bpmGlobal: global.bpm,
    bpmFirstHalf: f1?.bpm ?? NaN,
    bpmSecondHalf: f2?.bpm ?? NaN,
    wobbleMs: fit?.wobbleMs ?? NaN,
    beatInliers: fit ? `${fit.inliers}/${fit.beats}` : "n/a",
    beatSamples,
    phase4,
    downSamples,
    beatLen,
    barSamples,
    barRms,
    barOnsets,
    downbeatScores: score,
    env,
    chroma,
  };
}
