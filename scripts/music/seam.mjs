/**
 * Loop construction and seam measurement.
 *
 * buildLoop():   cuts [s, s+L) from the take and blends the material that follows the cut point
 *                (a[s+L ...]) back over the head, so the loop's last sample flows into its first
 *                sample as the take itself would, with no jump.
 * seamReport():  measures the loop point against every other bar line of the same loop.
 */
import { at, clamp, db, getFFT, mean, median, ncc, quantile, rms, stdev } from "./dsp.mjs";

/**
 * Attack envelope: log-spectral flux of a 512-sample window against the window 4 frames earlier,
 * bins 260 Hz to 8.6 kHz. One frame = ATT_HOP samples (44, about 1 ms), so index i is sample
 * i * ATT_HOP plus a small latency (the window has to fill); callers snap that latency out with
 * refineOnsets().
 */
export const ATT_HOP = 44;
export function attackEnv(mono, sr) {
  const hop = ATT_HOP;
  const N = 512;
  const lag = 4;
  const { fft, hann } = getFFT(N);
  const frames = Math.floor((mono.length - N) / hop) + 1;
  const lo = 3, hi = 100;
  const ring = Array.from({ length: lag + 1 }, () => new Float32Array(hi - lo + 1));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const a = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[f * hop + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const cur = ring[f % (lag + 1)];
    for (let k = lo; k <= hi; k++) cur[k - lo] = Math.log1p(30 * Math.hypot(re[k], im[k]));
    if (f >= lag) {
      const old = ring[(f - lag) % (lag + 1)];
      let s = 0;
      for (let k = 0; k <= hi - lo; k++) {
        const d = cur[k] - old[k];
        if (d > 0) s += d;
      }
      a[f] = s;
    }
  }
  return a;
}

/**
 * Sample-accurate onset near each approximate beat: the first 1 ms bin of the pre-emphasised
 * signal that reaches 20% of the loudest bin in [-12 ms, +35 ms]. Returns onset - approx in samples
 * for the beats that have a clear hit (the stronger half).
 */
export function refineOnsets(mono, approx, sr) {
  const bin = Math.round(sr / 1000);
  const offs = [];
  const strengths = [];
  for (const b0 of approx) {
    const a = Math.round(b0 - 0.012 * sr);
    const z = Math.round(b0 + 0.035 * sr);
    if (a < 1 || z + bin >= mono.length) continue;
    const env = [];
    for (let i = a; i < z; i += bin) {
      let mx = 0;
      for (let j = 0; j < bin; j++) mx = Math.max(mx, Math.abs(mono[i + j] - 0.97 * mono[i + j - 1]));
      env.push(mx);
    }
    const peak = Math.max(...env);
    const first = env.findIndex((v) => v >= 0.2 * peak);
    strengths.push(peak);
    offs.push({ off: a + first * bin - b0, peak });
  }
  if (offs.length < 8) return null;
  const cut = median(strengths);
  const strong = offs.filter((o) => o.peak >= cut).map((o) => o.off);
  return { shift: median(strong), spread: stdev(strong), n: strong.length };
}

const BANDS = 32;
const bandEdges = Array.from({ length: BANDS + 1 }, (_, b) => 60 * Math.pow(14000 / 60, b / BANDS));

/** 32 log-spaced bands from 60 Hz to 14 kHz: dB per band for the N-sample frame starting at `start`. */
export function bandVec(mono, sr, start, N = 2048) {
  const { fft, hann } = getFFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    re[i] = (mono[start + i] ?? 0) * hann[i];
    im[i] = 0;
  }
  fft(re, im);
  const v = new Float64Array(BANDS);
  let b = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f < bandEdges[0]) continue;
    if (f >= bandEdges[BANDS]) break;
    while (f >= bandEdges[b + 1]) b++;
    v[b] += re[k] * re[k] + im[k] * im[k];
  }
  return Array.from(v, (x) => 10 * Math.log10(x + 1e-6));
}

/** bandVec for every non-overlapping N frame in [a, a+len). */
export function bandFrames(mono, sr, a, len, N = 2048) {
  const frames = [];
  for (let o = Math.round(a); o + N <= Math.round(a + len) && o + N <= mono.length; o += N) {
    if (o < 0) continue;
    frames.push(bandVec(mono, sr, o, N));
  }
  return frames;
}

/** Mean absolute band difference in dB between two windows, frame by frame. */
export function specDiffDb(mono, sr, aStart, bStart, len) {
  const A = bandFrames(mono, sr, aStart, len);
  const B = bandFrames(mono, sr, bStart, len);
  const n = Math.min(A.length, B.length);
  if (!n) return NaN;
  let s = 0;
  for (let t = 0; t < n; t++) {
    let d = 0;
    for (let b = 0; b < A[t].length; b++) d += Math.abs(A[t][b] - B[t][b]);
    s += d / A[t].length;
  }
  return s / n;
}

/**
 * Lag (in samples, within +-maxFrames att frames) at which the transients of the window at bStart
 * line up best with the window at aStart, from the attack envelope.
 */
export function bestLag(att, aStart, bStart, len, maxFrames = 20) {
  const a0 = Math.round(aStart / ATT_HOP);
  const n = Math.round(len / ATT_HOP);
  const A = Array.from({ length: n }, (_, i) => att[a0 + i] ?? 0);
  const scores = [];
  for (let lag = -maxFrames; lag <= maxFrames; lag++) {
    const b0 = Math.round(bStart / ATT_HOP) + lag;
    const B = Array.from({ length: n }, (_, i) => att[b0 + i] ?? 0);
    scores.push(ncc(A, B));
  }
  let bi = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
  const zero = scores[maxFrames];
  let off = 0;
  if (bi > 0 && bi < scores.length - 1) {
    const y0 = scores[bi - 1], y1 = scores[bi], y2 = scores[bi + 1];
    const den = y0 - 2 * y1 + y2;
    if (den !== 0) off = clamp((0.5 * (y0 - y2)) / den, -0.5, 0.5);
  }
  return { lagSamples: (bi - maxFrames + off) * ATT_HOP, best: scores[bi], zero };
}

/**
 * Cut [s, s+L) and blend the audio that precedes the cut back over the last beat of the loop.
 *
 * The file starts on the clean head a[s]. Over its final x samples the original end of the region is
 * faded out while the x samples before the start, a[s-x .. s), are faded in, so the last sample of
 * the loop is followed by a[s], exactly what the take itself plays after a[s-1]. No jump, no click.
 * (This is the same signal as blending the material after the cut over the head, rotated by one beat,
 * so the loop starts crisp instead of mid-blend.) Needs s >= x.
 *
 * st: interleaved stereo take. Returns interleaved stereo Float32Array of exactly L frames.
 * The blend is amplitude-complementary at correlation 1 and power-complementary at correlation 0.
 */
export function buildLoop(st, s, L, x, rho) {
  if (s < x) throw new Error("not enough audio before the loop start for the blend");
  const out = new Float32Array(L * 2);
  out.set(st.subarray(s * 2, (s + L) * 2));
  const r = clamp(rho, 0, 1);
  for (let n = 0; n < x; n++) {
    const m = L - x + n;
    const w = n / x; // 0: all original end of the loop, 1: all of the lead-in before the start
    const norm = Math.sqrt(w * w + (1 - w) * (1 - w) + 2 * r * w * (1 - w)) || 1;
    const gPre = w / norm;
    const gEnd = (1 - w) / norm;
    for (let c = 0; c < 2; c++) {
      out[2 * m + c] = gEnd * st[2 * (s + m) + c] + gPre * st[2 * (s - x + n) + c];
    }
  }
  return out;
}

/**
 * The other way round, for takes whose clean stretch starts at the very first sample (no lead-in to
 * blend): cut [s, s+L) and blend the audio that FOLLOWS the cut over the first x samples of the loop.
 * out[0] = a[s+L], so the loop's last sample is followed by what the take itself plays next.
 * The file starts inside the blend. Needs s + L + x <= take length.
 */
export function buildLoopPost(st, s, L, x, rho) {
  const out = new Float32Array(L * 2);
  out.set(st.subarray(s * 2, (s + L) * 2));
  const r = clamp(rho, 0, 1);
  for (let n = 0; n < x; n++) {
    const w = n / x; // 0: all audio after the cut, 1: all of the head
    const norm = Math.sqrt(w * w + (1 - w) * (1 - w) + 2 * r * w * (1 - w)) || 1;
    const gHead = w / norm;
    const gTail = (1 - w) / norm;
    for (let c = 0; c < 2; c++) out[2 * n + c] = gHead * st[2 * (s + n) + c] + gTail * st[2 * (s + L + n) + c];
  }
  return out;
}

/** Correlation coefficient of two mono windows (sign-sensitive, used to pick the blend law). */
export function waveCorr(mono, aStart, bStart, len) {
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < len; i++) {
    const x = mono[aStart + i] ?? 0;
    const y = mono[bStart + i] ?? 0;
    num += x * y;
    da += x * x;
    dbb += y * y;
  }
  return num / (Math.sqrt(da * dbb) + 1e-12);
}

/** Two cascaded RBJ high-pass biquads (24 dB per octave) at fc. */
function highpass(x, fc, sr) {
  const w0 = (2 * Math.PI * fc) / sr;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * 0.7071);
  const b0 = (1 + cosw) / 2, b1 = -(1 + cosw), b2 = (1 + cosw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = (b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v;
      out[i] = v;
    }
    y = out;
  }
  return y;
}

/**
 * How visible is the loop point? Everything is measured on the loop played twice.
 *
 *  rms, flux         Level step and band-spectrum step between the 46 ms before and after the
 *                    junction, against the same numbers at every other bar line (p90).
 *  click             Level above 4 kHz in the worst 3 ms window at the junction, against the p95 of 3 ms
 *                    windows anywhere in the loop (a jump in the waveform shows up as a burst there).
 *  blend             Level of the last beat of the loop (where the blend sits) against the beats on
 *                    either side, against the same at every other beat (p90).
 *
 * A ratio at or below 1 means the loop point behaves like any other bar line or beat of the loop.
 * seamScore is 1 for a worst ratio of 1 or less, falling to 0 at a ratio of 2.5.
 */
export function seamReport(mono, L, barSamples, sr, beatWin = 0, blendAt = "end") {
  const z = new Float32Array(L * 2);
  z.set(mono, 0);
  z.set(mono, L);
  const W = 2048;
  const bars = Math.round(L / barSamples);
  const step = L / bars;
  const feats = (p) => {
    const pre = rms(z, p - W, p);
    const post = rms(z, p, p + W);
    const dRms = Math.abs(db(pre) - db(post));
    const A = bandVec(z, sr, p - W, W);
    const B = bandVec(z, sr, p, W);
    let flux = 0;
    for (let b = 0; b < A.length; b++) flux += Math.abs(A[b] - B[b]);
    flux /= A.length;
    return { dRms, flux };
  };
  const J = feats(L);
  // Click test: high-frequency (above 4 kHz) level in 3 ms windows. A cut that jumps shows as a burst
  // there. Compare the worst 3 ms window within +-2 ms of the junction with the p95 of such windows
  // anywhere else in the loop (the loop's own hi-hats and kicks set what is normal).
  const hf = highpass(z, 4000, sr);
  const hw = Math.round(sr * 0.003);
  const hfDb = (p) => db(rms(hf, p - hw / 2, p + hw / 2));
  let Jhf = -200;
  for (let o = -Math.round(sr * 0.002); o <= Math.round(sr * 0.002); o += Math.round(sr * 0.00025)) Jhf = Math.max(Jhf, hfDb(L + o));
  const hfElse = [];
  for (let p = 5000; p < z.length - 5000; p += 997) {
    if (Math.abs(p - L) < sr * 0.1) continue;
    hfElse.push(hfDb(p));
  }
  const hfP95 = quantile(hfElse, 0.95);
  const Jclick = Math.pow(10, (Jhf - hfP95) / 20);
  const others = [];
  for (let m = 1; m < 2 * bars; m++) {
    if (m === bars) continue;
    const p = Math.round(m * step);
    if (p - W < 2 || p + W > z.length - 2) continue;
    others.push(feats(p));
  }
  const p90 = (k) => quantile(others.map((o) => o[k]), 0.9);
  const med = (k) => quantile(others.map((o) => o[k]), 0.5);
  const ratios = {
    rms: (J.dRms + 0.5) / (p90("dRms") + 0.5),
    flux: (J.flux + 1) / (p90("flux") + 1),
    click: Jclick,
  };
  let blend = null;
  if (beatWin > 0) {
    // The blend (if any) sits in the last beat of the loop (pre mode) or the first (post mode).
    const beat = Math.round(beatWin);
    const at0 = blendAt === "end" ? L - beat : L;
    const bump = (p) => {
      const mid = db(rms(z, p, p + beat));
      const nb = 0.5 * (db(rms(z, p - beat, p)) + db(rms(z, p + beat, p + 2 * beat)));
      return Math.abs(mid - nb);
    };
    const j = bump(at0);
    const os = [];
    for (let k = 1; k < 2 * bars * 4 - 2; k++) {
      const p = Math.round(k * (step / 4));
      if (Math.abs(p - at0) < beat * 1.5 || p - beat < 0 || p + 2 * beat > z.length) continue;
      os.push(bump(p));
    }
    blend = { bumpDb: +j.toFixed(2), beatsP90Db: +quantile(os, 0.9).toFixed(2) };
    ratios.blend = (j + 0.5) / (quantile(os, 0.9) + 0.5);
  }
  const worst = Math.max(...Object.values(ratios));
  const out = {
    seamScore: +clamp(1 - Math.max(0, worst - 1) / 1.5, 0, 1).toFixed(3),
    junction: { dRmsDb: +J.dRms.toFixed(2), fluxDb: +J.flux.toFixed(2), hfAbove4kDb: +Jhf.toFixed(1) },
    barLines: {
      dRmsDbMedian: +med("dRms").toFixed(2),
      dRmsDbP90: +p90("dRms").toFixed(2),
      fluxDbMedian: +med("flux").toFixed(2),
      fluxDbP90: +p90("flux").toFixed(2),
      hfAbove4kP95AnyPositionDb: +hfP95.toFixed(1),
    },
    ratios: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, +v.toFixed(2)])),
    n: others.length,
  };
  if (blend) out.blend = blend;
  return out;
}
