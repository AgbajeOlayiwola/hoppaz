/**
 * Small DSP kit for loop.mjs: no dependencies, ffmpeg only for decode, encode and loudness.
 * Everything here works on Float32Array / Float64Array; stereo is interleaved L R L R.
 */
import { spawn } from "node:child_process";

process.env.PATH = `/opt/homebrew/bin:${process.env.PATH ?? ""}`;

/** Runs a binary, feeds optional stdin, returns { stdout: Buffer, stderr: string }. */
export function exec(cmd, argv, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-600)}`));
    });
    p.stdin.on("error", () => {});
    if (stdin) p.stdin.end(stdin);
    else p.stdin.end();
  });
}

export const f32FromBuffer = (b) => {
  const f = new Float32Array(Math.floor(b.length / 4));
  new Uint8Array(f.buffer).set(b.subarray(0, f.length * 4));
  return f;
};
export const bufferFromF32 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength);

/** Decode any audio file to interleaved float32 stereo at `sr`. */
export async function decode(file, sr = 44100) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(sr), "-"]);
  return f32FromBuffer(stdout);
}

export function toMono(st) {
  const n = st.length >> 1;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = 0.5 * (st[2 * i] + st[2 * i + 1]);
  return m;
}

// ---------- FFT ----------
const fftCache = new Map();
export function getFFT(n) {
  if (fftCache.has(n)) return fftCache.get(n);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const fft = (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  };
  const o = { fft, hann, n };
  fftCache.set(n, o);
  return o;
}

/** Magnitude STFT. Returns { data: Float32Array(frames*bins), frames, bins }. */
export function stftMag(x, N, hop, start = 0, end = x.length) {
  const { fft, hann } = getFFT(N);
  const bins = N / 2 + 1;
  const frames = Math.max(0, Math.floor((end - start - N) / hop) + 1);
  const data = new Float32Array(frames * bins);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const o = start + f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) data[f * bins + k] = Math.hypot(re[k], im[k]);
  }
  return { data, frames, bins };
}

// ---------- small numeric helpers ----------
export const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
};
export const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const p = (s.length - 1) * q;
  const i = Math.floor(p);
  return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (p - i);
};
export const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
export const stdev = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

export function rms(x, a, b) {
  let s = 0;
  const lo = Math.max(0, a | 0);
  const hi = Math.min(x.length, b | 0);
  for (let i = lo; i < hi; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, hi - lo));
}

/** Linear-interpolated read of a Float32/64 array at a fractional index. */
export function at(arr, t) {
  if (t < 0 || t >= arr.length - 1) return 0;
  const i = Math.floor(t);
  const f = t - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

/** Subtract a moving average (window `w` frames), clip at 0. */
export function detrend(env, w) {
  const out = new Float32Array(env.length);
  const pre = new Float64Array(env.length + 1);
  for (let i = 0; i < env.length; i++) pre[i + 1] = pre[i] + env[i];
  const h = w >> 1;
  for (let i = 0; i < env.length; i++) {
    const a = Math.max(0, i - h);
    const b = Math.min(env.length, i + h + 1);
    out[i] = Math.max(0, env[i] - (pre[b] - pre[a]) / (b - a));
  }
  return out;
}

/** Normalised cross-correlation of two equal-length vectors (mean removed). */
export function ncc(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0, da = 0, db2 = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db2 += y * y;
  }
  return num / (Math.sqrt(da * db2) + 1e-12);
}

export const cosine = (a, b) => {
  let n = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) {
    n += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return n / (Math.sqrt(x * y) + 1e-12);
};

// ---------- loudness via ffmpeg ebur128 ----------
/** Integrated LUFS, loudness range and true peak of interleaved float32 stereo. */
export async function measureLoudness(st, sr = 44100) {
  const { stderr } = await exec(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-f", "f32le", "-ar", String(sr), "-ac", "2", "-i", "-", "-af", "ebur128=peak=true", "-f", "null", "-"],
    bufferFromF32(st),
  );
  const tail = stderr.slice(stderr.lastIndexOf("Summary:"));
  const grab = (re) => {
    const m = tail.match(re);
    return m ? Number(m[1]) : NaN;
  };
  return {
    lufs: grab(/I:\s+(-?[\d.]+)\s+LUFS/),
    lra: grab(/LRA:\s+(-?[\d.]+)\s+LU/),
    truePeak: grab(/Peak:\s+(-?[\d.]+)\s+dBFS/),
  };
}

export function samplePeakDb(st) {
  let p = 0;
  for (let i = 0; i < st.length; i++) p = Math.max(p, Math.abs(st[i]));
  return db(p);
}
