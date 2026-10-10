/**
 * A cheap "is there a voice or a chant in this?" screen. No model, no download.
 *
 * Two measures, both on the 300 to 3400 Hz voice band of a gridded, looping instrumental:
 *
 *   offGrid  Music locked to a tempo grid modulates its voice-band level only at multiples of the
 *            bar rate (bpm / 240 Hz). Speech modulates at syllable rate with timing that is not
 *            locked to the grid. offGrid is the share of the 2 to 8 Hz level-modulation energy that
 *            sits away from every multiple of the bar rate (tolerance 0.08 Hz). Plain instrumentals
 *            measure about 0.1; speech 12 dB under the music already reads 0.2 or more.
 *   repeat   Looped instrumentals repeat their voice-band spectrum bar after bar. Shouts, chants and
 *            words do not, even when their onsets sit on the grid, which hides them from offGrid.
 *            repeat is the median similarity between each bar and the bar 2 or 4 bars later
 *            (the larger of the two), from 16 slots per bar of 20 log bands. Instrumentals read 0.9;
 *            a grid-locked random chant 12 dB under the music reads 0.69.
 *
 * Thresholds live in speechVerdict and were checked with scripts/music/calibrate-speech.mjs, which
 * mixes macOS `say` speech and chants into the real takes. It is a screen, not a proof: the request
 * sets force_instrumental, and the final check is a human ear.
 */
import { getFFT, mean, quantile } from "./dsp.mjs";

const FR = 100; // envelope frames per second

function voiceBandEnvelope(mono, sr) {
  const N = 1024;
  const hop = Math.round(sr / FR);
  const { fft, hann } = getFFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const lo = Math.round((300 * N) / sr);
  const hi = Math.round((3400 * N) / sr);
  const frames = Math.floor((mono.length - N) / hop) + 1;
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[f * hop + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    let e = 0;
    for (let k = lo; k <= hi; k++) e += re[k] * re[k] + im[k] * im[k];
    env[f] = 10 * Math.log10(e + 1e-9);
  }
  return env;
}

function modulationSpectrum(env) {
  const n = env.length;
  const M = 16384;
  const { fft } = getFFT(M);
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  const m = mean(Array.from(env));
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
    re[i] = (env[i] - m) * w;
  }
  fft(re, im);
  const df = FR / M;
  const p = new Float64Array(M / 2);
  for (let k = 0; k < M / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, df };
}

/** 16 slots per bar, 20 log bands in 300..3400 Hz, dB. */
function slotVectors(x, bpm, sr) {
  const slot = ((60 / bpm) * sr) / 4;
  const N = 2048;
  const { fft, hann } = getFFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const nb = 20;
  const edges = Array.from({ length: nb + 1 }, (_, b) => 300 * Math.pow(3400 / 300, b / nb));
  const slots = Math.floor((x.length - N) / slot);
  const out = [];
  for (let s = 0; s < slots; s++) {
    const o = Math.round(s * slot);
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const v = new Float64Array(nb);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      if (f < 300 || f >= 3400) continue;
      let b = 0;
      while (f >= edges[b + 1]) b++;
      v[b] += re[k] * re[k] + im[k] * im[k];
    }
    out.push(Array.from(v, (e) => 10 * Math.log10(e + 1e-6)));
  }
  return out;
}

function barSimilarities(slots, lagBars) {
  const bars = Math.floor(slots.length / 16);
  const sims = [];
  for (let b = 0; b + lagBars < bars; b++) {
    const A = [];
    const B = [];
    for (let s = 0; s < 16; s++) {
      A.push(...slots[b * 16 + s]);
      B.push(...slots[(b + lagBars) * 16 + s]);
    }
    const ma = mean(A);
    const mb = mean(B);
    let n = 0, da = 0, dd = 0;
    for (let i = 0; i < A.length; i++) {
      const p = A[i] - ma;
      const q = B[i] - mb;
      n += p * q;
      da += p * p;
      dd += q * q;
    }
    sims.push(n / (Math.sqrt(da * dd) + 1e-12));
  }
  return sims;
}

/** bpm: tempo of the track, which fixes where the bar-rate grid lines sit. */
export function speechScan(mono, sr, bpm) {
  const env = voiceBandEnvelope(mono, sr);
  const { p, df } = modulationSpectrum(env);
  const barHz = bpm / 240;
  let on = 0, all = 0;
  const tol = 0.08;
  for (let k = Math.ceil(2 / df); k <= Math.floor(8 / df); k++) {
    const m = (k * df) / barHz;
    const d = Math.abs(m - Math.round(m)) * barHz;
    all += p[k];
    if (d <= tol) on += p[k];
  }
  const offGrid = 1 - on / (all + 1e-12);
  const slots = slotVectors(mono, bpm, sr);
  const med = (lag) => {
    const s = barSimilarities(slots, lag);
    return s.length ? quantile(s, 0.5) : NaN;
  };
  const repeat = Math.max(med(2), med(4));
  return { offGrid: +offGrid.toFixed(3), repeat: +repeat.toFixed(3) };
}

export const SPEECH_THRESHOLDS = { offGrid: 0.18, repeat: 0.82, repeatClear: 0.88 };

/**
 * Verdict from the measures. A voice-band spectrum that does not repeat bar to bar (repeat under the
 * floor) is enough. Off-grid modulation alone is not: slow 2 or 4 bar patterns put energy between the
 * bar-rate lines, so offGrid only counts when the bars also repeat less than a very tight loop would.
 */
export function speechVerdict(s, t = SPEECH_THRESHOLDS) {
  const reasons = [];
  if (Number.isFinite(s.repeat) && s.repeat < t.repeat) reasons.push(`voice band does not repeat bar to bar (${s.repeat}, floor ${t.repeat})`);
  else if (s.offGrid > t.offGrid && Number.isFinite(s.repeat) && s.repeat < t.repeatClear) {
    reasons.push(`voice-band modulation off the beat grid (${s.offGrid}, limit ${t.offGrid}) and bars repeat only ${s.repeat}`);
  }
  return { likely: reasons.length > 0, reasons };
}
