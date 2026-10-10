/**
 * Independent re-measure of the loops in public/music/try: loudness, true peak, length, tempo and the loop join.
 * Its own implementation (imports nothing from scripts/music), decodes with ffmpeg. Prints JSON and compares with the manifest.
 *
 *   node scripts/music/check/measure.mjs        takes a few seconds, writes nothing
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/music/try");
const manifest = JSON.parse(fs.readFileSync(DIR + "/manifest.json", "utf8"));
const SR = 44100;

function decode(file) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"], { maxBuffer: 1 << 29 });
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const n = f.length / 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return { L, R, n };
}
function ebur(file, times) {
  // loudness of the loop played `times` times back to back, as the app plays it
  const filt = times > 1 ? `aloop=loop=${times - 1}:size=2147483647,ebur128=peak=true` : "ebur128=peak=true";
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", filt, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const t = r.stderr;
  const tail = t.slice(t.lastIndexOf("Summary:"));
  const g = (re) => { const m = tail.match(re); return m ? Number(m[1]) : null; };
  return { lufs: g(/I:\s+(-?[\d.]+) LUFS/), lra: g(/LRA:\s+(-?[\d.]+) LU/), truePeak: g(/Peak:\s+(-?[\d.]+) dBFS/) };
}
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
// small real FFT magnitude via naive radix-2
function fftMag(x, a, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); re[i] = x[a + i] * w; }
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len; const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const out = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}
// 1/3-octave-ish bands (log spaced), mean abs dB difference between the 46 ms before and after a point
function bandsDb(x, a, N, w) {
  const m = fftMag(x, a, N);
  const edges = []; for (let f = 80; f < 16000; f *= Math.pow(2, 1 / 3)) edges.push(f);
  const out = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const k0 = Math.max(1, Math.floor((edges[b] * N) / SR)), k1 = Math.max(k0 + 1, Math.floor((edges[b + 1] * N) / SR));
    let s = 0; for (let k = k0; k < k1; k++) s += m[k] * m[k];
    out.push(10 * Math.log10(s / (k1 - k0) + 1e-12));
  }
  return out;
}
function percentile(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

const WIN = 2048; // 46 ms
function joinMetrics(mono, pos, n) {
  // audio before `pos` (wrapping) versus audio after it
  const get = (i) => mono[((i % n) + n) % n];
  const before = new Float32Array(WIN), after = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) { before[i] = get(pos - WIN + i); after[i] = get(pos + i); }
  const dRms = Math.abs(20 * Math.log10((rms(after, 0, WIN) + 1e-9) / (rms(before, 0, WIN) + 1e-9)));
  const A = bandsDb(before, 0, WIN), B = bandsDb(after, 0, WIN);
  let flux = 0; for (let i = 0; i < A.length; i++) flux += Math.abs(A[i] - B[i]); flux /= A.length;
  // click: biggest second difference in 7 samples across the join
  let click = 0; for (let i = -3; i <= 3; i++) { const d2 = get(pos + i + 1) - 2 * get(pos + i) + get(pos + i - 1); click = Math.max(click, Math.abs(d2)); }
  return { dRms, flux, click };
}

const names = manifest.map((m) => m.name);
const results = [];
for (const name of names) {
  const m = manifest.find((x) => x.name === name);
  const file = `${DIR}/${name}.mp3`;
  const { L, R, n } = decode(file);
  const mono = new Float32Array(n); for (let i = 0; i < n; i++) mono[i] = 0.5 * (L[i] + R[i]);
  const once = ebur(file, 1);
  const twice = ebur(file, 2);
  // tempo from the exact length: 16 bars of 4 beats
  const bpmFromLen = (m.bars * 4 * 60) / (n / SR);
  const barSamples = n / m.bars;
  // bar lines: 0 is the seam
  const bars = []; for (let b = 0; b < m.bars; b++) bars.push(joinMetrics(mono, Math.round(b * barSamples), n));
  const seam = bars[0], rest = bars.slice(1);
  const col = (k) => rest.map((r) => r[k]);
  // global click rank: max |d2| in 7-sample windows along the loop (every 7th window)
  const clicks = []; for (let i = 8; i < n - 8; i += 7) { let c = 0; for (let j = -3; j <= 3; j++) { const d2 = mono[i + j + 1] - 2 * mono[i + j] + mono[i + j - 1]; c = Math.max(c, Math.abs(d2)); } clicks.push(c); }
  const clickRank = clicks.filter((c) => c <= seam.click).length / clicks.length;
  // sample step across the seam against all steps
  const steps = new Float32Array(n - 1); for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(mono[i] - mono[i - 1]);
  const seamStep = Math.abs(mono[0] - mono[n - 1]);
  const stepRank = steps.reduce((c, s) => c + (s <= seamStep ? 1 : 0), 0) / steps.length;
  // peak
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  results.push({
    name, samples: n, manifestSamples: m.loopSamples, lengthMatches: n === m.loopSamples,
    sec: +(n / SR).toFixed(3), bpmFromLength: +bpmFromLen.toFixed(3), manifestBpm: m.bpm, bpmPlanned: m.bpmPlanned,
    lufs: once.lufs, lufsManifest: m.lufs, lufsLoopedTwice: twice.lufs, lra: once.lra, lraManifest: m.lra,
    truePeakFfmpeg: once.truePeak, truePeakManifest: m.truePeakDb, samplePeakDb: +(20 * Math.log10(pk)).toFixed(2),
    seam: {
      dRmsDb: +seam.dRms.toFixed(2), dRmsBarMedian: +percentile(col("dRms"), 0.5).toFixed(2), dRmsBarP90: +percentile(col("dRms"), 0.9).toFixed(2),
      fluxDb: +seam.flux.toFixed(2), fluxBarMedian: +percentile(col("flux"), 0.5).toFixed(2), fluxBarP90: +percentile(col("flux"), 0.9).toFixed(2),
      ratioRms: +(seam.dRms / percentile(col("dRms"), 0.5)).toFixed(2), ratioFlux: +(seam.flux / percentile(col("flux"), 0.5)).toFixed(2),
      clickD2: +seam.click.toExponential(2), clickRankInLoop: +clickRank.toFixed(4), seamStep: +seamStep.toExponential(2), seamStepRank: +stepRank.toFixed(4),
    },
    manifestSeamScore: m.seamScore,
  });
}
console.log(JSON.stringify(results, null, 1));
// One line per loop: does the independent measure agree with the manifest?
for (const r of results) {
  const ok = r.lengthMatches && Math.abs(r.lufs - r.lufsManifest) <= 0.1 && Math.abs(r.truePeakFfmpeg - r.truePeakManifest) <= 0.1 && Math.abs(r.bpmFromLength - r.manifestBpm) <= 0.01;
  console.log(`${ok ? "AGREES" : "DIFFERS"}  ${r.name}: ${r.samples} samples, ${r.lufs} LUFS (manifest ${r.lufsManifest}), true peak ${r.truePeakFfmpeg} (manifest ${r.truePeakManifest}), ${r.bpmFromLength} BPM`);
}
