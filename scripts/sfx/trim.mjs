/**
 * Trims, normalises and measures the raw candidates, then writes
 * public/sfx/try/manifest.json. Decoding, resampling and encoding go through
 * ffmpeg (/opt/homebrew/bin); the trimming and the measuring are done on the
 * samples here, so every step is exact and repeatable.
 *
 *   node scripts/sfx/trim.mjs              all cues, from the raw folder
 *   node scripts/sfx/trim.mjs --only a,b   just those cues (manifest keeps the rest as is)
 *   node scripts/sfx/trim.mjs --raw DIR    raw folder (or env SFX_RAW_DIR)
 *
 * Per file: mono; the head is cut where the signal first passes -45 dB and the
 * tail where it falls under -50 dB (both against a -1 dBFS peak); the cut is
 * capped by lane (ui 0.35 s, reward 1.2 s, moment 2.5 s); a 15 ms fade out (25 ms
 * when the cap cut it); peak at -1 dBFS. Up to 0.4 s it is a WAV, 22050 Hz 16 bit,
 * so there is no encoder padding. Longer is an MP3, 96 kbps mono 44100 Hz.
 *
 * Measured on the finished file: seconds, bytes, peak (dBFS), lufs (BS.1770
 * K-weighted over the whole clip, no gating, because a gated figure needs 0.4 s),
 * and the silence before the first sample over -45 dB. Flags: near-silent (raw
 * peak under -34 dBFS), clipped (the raw take runs over full scale), late-start, too-short,
 * sustained (a UI tick that is still loud when the raw clip ends) and speech?
 * (a rough guess from the pitch, spectrum and syllable length, so listen to it).
 * A redone variant also records what the first take was flagged for.
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";

const SR = 44100;
const HEAD_DB = -45;
const TAIL_DB = -50;
const PEAK_DB = -1;
const PRE_ROLL = 0.001;
const MAX_GAIN_DB = 36;
const WAV_MAX = 0.4;
const WAV_RATE = 22050;
const CAP = { ui: 0.35, reward: 1.2, moment: 2.5 };
// box_alert is a UI sound, but its cue is three plucks, short short long, which needs about 0.7 s.
const CAP_OVERRIDE = { box_alert: 0.9 };
// Cues that are a run of events, so a clip far shorter than asked for means events are missing.
const PHRASES = new Set([
  "box_legend_phrase",
  "box_shekere_shake",
  "hoppaz_three_full",
  "hoppaz_three_short",
  "play_enter_drum_call",
  "danfo_horn_sss",
  "quest_done_coin",
  "play_exit_drum",
  "streak_stamp",
  "wave_received",
  "hotspot_enter",
  "box_alert",
  "checkin_stamp",
]);
// Shortest believable clip for a single strike, by lane.
const MIN_SINGLE = { ui: 0.05, reward: 0.15, moment: 0.15 };
// A take counts as clipped when this share of its kept samples runs over 0 dBFS.
const OVER_SHARE = 0.02;
// Voices are the point of these two, so the speech guess is skipped for them.
const CROWD = new Set(["levelup_crowd_ehn", "we_outside_ehn"]);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const rawDir = resolve(opt("raw") ?? process.env.SFX_RAW_DIR ?? resolve(tmpdir(), "hoppaz-sfx-raw"));
const inRepo = relative(root, rawDir);
if (!inRepo.startsWith("..") && !isAbsolute(inRepo)) {
  console.log("raw folder must be outside the repo, pass --raw or set SFX_RAW_DIR");
  process.exit(1);
}
const outDir = resolve(root, "public/sfx/try");
const workDir = resolve(rawDir, "_work");
const only = opt("only")?.split(",");

// ---------- ffmpeg ----------

function run(bin, argv, input) {
  return new Promise((done, fail) => {
    const p = spawn(bin, argv);
    const out = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.stdin.on("error", () => {});
    p.on("close", (code) => (code === 0 ? done(Buffer.concat(out)) : fail(new Error(err.trim().slice(-300)))));
    p.stdin.end(input);
  });
}
const ffmpeg = (argv, input) => run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...argv], input);

const toFloats = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const toBytes = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength);

async function decode(file, rate) {
  return toFloats(await ffmpeg(["-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"]));
}
async function resample(x, from, to) {
  return toFloats(await ffmpeg(["-f", "f32le", "-ar", String(from), "-ac", "1", "-i", "-", "-ar", String(to), "-f", "f32le", "-"], toBytes(x)));
}
async function probe(file) {
  const out = await run(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate", "-of", "json", file]);
  return JSON.parse(out).streams[0];
}

// ---------- measuring ----------

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const lin = (d) => Math.pow(10, d / 20);
const maxAbs = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Share of samples over full scale. Hot masters decode past 0 dBFS, which is clipping. */
function overShare(x) {
  let n = 0;
  for (const v of x) if (Math.abs(v) > 1) n++;
  return n / Math.max(1, x.length);
}

/** BS.1770 K-weighting at 48 kHz, mean square over the whole clip. */
function lufs48(x) {
  const stage = (b0, b1, b2, a1, a2) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (v) => {
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      return y;
    };
  };
  const shelf = stage(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
  const rlb = stage(1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);
  let sum = 0;
  for (const v of x) {
    const y = rlb(shelf(v));
    sum += y * y;
  }
  const ms = sum / Math.max(1, x.length);
  return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
}

function leadMs(x, rate) {
  const thr = lin(HEAD_DB);
  const i = x.findIndex((v) => Math.abs(v) >= thr);
  return ((i < 0 ? x.length : i) / rate) * 1000;
}

function rmsAt(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

// ---------- speech guess ----------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const median = (a) => (a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : 0);

/**
 * A rough "is this a voice" test, tuned on macOS `say` clips against the sound
 * set. A voice has a pitch between 90 and 260 Hz in most frames, vowels that hold
 * (the envelope stays within 6 dB of its peak for 150 ms or more), a spectral
 * centroid that moves (formants), and hissy consonants (the zero-crossing rate
 * varies). Struck drums and bells fail at least one. It is a hint, not a verdict.
 */
function voiceLike(y, rate) {
  const N = 276, H = 110, F = 512;
  const lagMin = Math.floor(rate / 350), lagMax = Math.ceil(rate / 70);
  const frames = [];
  for (let s = 0; s + N <= y.length; s += H) frames.push({ s, rms: rmsAt(y, s, s + N) });
  if (frames.length < 6) return null;
  const top = Math.max(...frames.map((f) => f.rms), 1e-9);
  const active = frames.filter((f) => f.rms >= top * lin(-30));
  const f0s = [], centroids = [], zcrs = [];
  for (const f of active) {
    let zc = 0;
    for (let i = 1; i < N; i++) if (y[f.s + i] * y[f.s + i - 1] < 0) zc++;
    zcrs.push(zc / N);
    let best = 0, bestLag = 0;
    const e0 = f.rms * f.rms * N;
    for (let l = lagMin; l <= lagMax; l++) {
      let c = 0, e1 = 0;
      for (let i = 0; i + l < N; i++) { c += y[f.s + i] * y[f.s + i + l]; e1 += y[f.s + i + l] ** 2; }
      const r = c / Math.sqrt(e0 * e1 + 1e-12);
      if (r > best) { best = r; bestLag = l; }
    }
    if (best < 0.55) continue;
    f0s.push(rate / bestLag);
    const re = new Float64Array(F), im = new Float64Array(F);
    for (let i = 0; i < N; i++) re[i] = y[f.s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 2; k < F / 2 && (k * rate) / F <= 4000; k++) {
      const m = Math.hypot(re[k], im[k]);
      num += ((k * rate) / F) * m; den += m;
    }
    if (den > 0) centroids.push(num / den);
  }
  const holds = [];
  const env = frames.map((f) => f.rms);
  for (let k = 1; k < env.length - 1; k++) {
    if (env[k] < top * 0.3 || env[k] < env[k - 1] || env[k] <= env[k + 1]) continue;
    let lo = k, hi = k;
    while (lo > 0 && env[lo - 1] >= env[k] / 2) lo--;
    while (hi < env.length - 1 && env[hi + 1] >= env[k] / 2) hi++;
    holds.push((hi - lo + 1) * ((H / rate) * 1000));
  }
  const avg = (a) => a.reduce((p, q) => p + q, 0) / (a.length || 1);
  const sd = (a) => Math.sqrt(avg(a.map((v) => (v - avg(a)) ** 2)));
  const f0 = median(f0s);
  const voice =
    f0s.length / active.length >= 0.6 && f0 >= 90 && f0 <= 260 &&
    median(holds) >= 150 &&
    sd(centroids) / (avg(centroids) || 1) >= 0.2 &&
    sd(zcrs) >= 0.02;
  return { voice };
}

// ---------- processing ----------

function writeWav(x, rate) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const scale = (x, g) => x.map((v) => v * g);

/** Trim, normalise and fade one raw take, write it to dir, and measure what was written. */
async function treat(rawFile, cue, id, dir) {
  const raw = await decode(rawFile, SR);
  const rawPeak = maxAbs(raw);
  const g0 = Math.min(lin(PEAK_DB) / Math.max(rawPeak, 1e-9), lin(MAX_GAIN_DB));
  const norm = scale(raw, g0);

  const headThr = lin(HEAD_DB);
  const first = norm.findIndex((v) => Math.abs(v) >= headThr);
  const start = Math.max(0, (first < 0 ? 0 : first) - Math.round(PRE_ROLL * SR));
  const win = Math.round(0.005 * SR);
  let end = norm.length;
  while (end - win > start && rmsAt(norm, end - win, end) < lin(TAIL_DB)) end -= win;
  const natural = (end - start) / SR;

  const cap = CAP_OVERRIDE[cue.name] ?? CAP[cue.lane];
  const capped = natural > cap;
  if (capped) end = start + Math.round(cap * SR);
  let seg = norm.slice(start, end);
  seg = scale(seg, lin(PEAK_DB) / Math.max(maxAbs(seg), 1e-9));
  const fade = Math.min(Math.round((capped ? 0.025 : 0.015) * SR), seg.length >> 2);
  for (let i = 0; i < fade; i++) seg[seg.length - fade + i] *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / fade));

  const short = seg.length / SR <= WAV_MAX;
  const ext = short ? "wav" : "mp3";
  const file = resolve(dir, `${id}.${ext}`);
  const rate = short ? WAV_RATE : SR;
  await mkdir(dir, { recursive: true });
  await rm(resolve(dir, `${id}.${short ? "mp3" : "wav"}`), { force: true });

  if (short) {
    let y = await resample(seg, SR, WAV_RATE);
    y = scale(y, lin(PEAK_DB) / Math.max(maxAbs(y), 1e-9));
    await writeFile(file, writeWav(y, WAV_RATE));
  } else {
    // A lossy encode moves the peak a little, so re-gain and keep the closest take to -1 dBFS.
    await mkdir(workDir, { recursive: true });
    let g = 1;
    let best = null;
    for (let pass = 0; pass < 5; pass++) {
      const tmp = resolve(workDir, `${id}.p${pass}.mp3`);
      await ffmpeg(["-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", "96k", "-ar", String(SR), "-ac", "1", tmp], toBytes(scale(seg, g)));
      const off = PEAK_DB - db(maxAbs(await decode(tmp, SR)));
      if (!best || Math.abs(off) < best.err) best = { tmp, err: Math.abs(off) };
      if (best.err < 0.15) break;
      g *= lin(off);
    }
    await copyFile(best.tmp, file);
  }

  const out = await decode(file, rate);
  const k48 = await decode(file, 48000);
  const info = await probe(file);
  const m = {
    file: `${id}.${ext}`,
    seconds: Math.round((out.length / rate) * 1000) / 1000,
    bytes: (await stat(file)).size,
    lufs: Math.round(lufs48(k48) * 10) / 10,
    peak: Math.round(db(maxAbs(out)) * 10) / 10,
    leadMs: Math.round(leadMs(out, rate) * 10) / 10,
    capped,
    natural: Math.round(natural * 1000) / 1000,
    rawPeak: Math.round(db(rawPeak) * 10) / 10,
    over: Math.round(overShare(raw.subarray(start, end)) * 1000) / 10,
    format: `${info.codec_name} ${info.sample_rate} Hz ${info.channels}ch`,
  };

  const flags = [];
  if (rawPeak < lin(-34) || natural < 0.02) flags.push("near-silent");
  if (m.over >= OVER_SHARE * 100 || m.peak > -0.3) flags.push("clipped");
  if (m.leadMs > 15) flags.push("late-start");
  if (natural < (PHRASES.has(cue.name) ? cue.duration_seconds * 0.5 : MIN_SINGLE[cue.lane])) flags.push("too-short");
  if (cue.lane === "ui" && cue.name !== "box_alert") {
    const tail = rmsAt(raw, Math.max(0, raw.length - Math.round(0.03 * SR)), raw.length);
    if (tail > rawPeak * lin(-25)) flags.push("sustained");
  }
  if (!CROWD.has(cue.name)) {
    const sp = voiceLike(await decode(file, 11025), 11025);
    m.speech = sp ? sp.voice : null;
    if (sp?.voice) flags.push("speech?");
  }
  return { ...m, flags };
}

// ---------- run ----------

const cues = JSON.parse(await readFile(resolve(root, "scripts/sfx/cues.json"), "utf8"));
const manifestPath = resolve(outDir, "manifest.json");
const old = await readFile(manifestPath, "utf8").then(JSON.parse, () => []);
const exists = async (p) => (await stat(p).catch(() => null))?.size > 0;
const jobs = [];
for (const cue of cues) {
  if (only && !only.includes(cue.name)) continue;
  for (let n = 1; n <= cue.variants; n++) jobs.push({ cue, n, id: `${cue.name}-${n}` });
}

await mkdir(outDir, { recursive: true });
const results = new Map();
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { cue, n, id } = jobs[next++];
    const rawFile = resolve(rawDir, `${id}.mp3`);
    if (!(await exists(rawFile))) continue;
    try {
      const r = await treat(rawFile, cue, id, outDir);
      const meta = await readFile(resolve(rawDir, `${id}.json`), "utf8").then(JSON.parse, () => null);
      const firstFile = resolve(rawDir, `${id}.first.mp3`);
      if (meta?.redo && (await exists(firstFile))) {
        const was = await treat(firstFile, cue, id, resolve(workDir, "first"));
        r.redone = { prompt: meta.prompt, firstFlags: was.flags };
      }
      results.set(id, { n, ...r });
    } catch (err) {
      console.log(`${id}: failed, ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const manifest = cues.map((cue) => {
  const prior = old.find((c) => c.name === cue.name);
  const variants =
    only && !only.includes(cue.name)
      ? (prior?.variants ?? [])
      : Array.from({ length: cue.variants }, (_, i) => results.get(`${cue.name}-${i + 1}`))
          .filter(Boolean)
          .map(({ n, file, seconds, bytes, lufs, peak, flags, ...extra }) => ({
            n, file, seconds, bytes, lufs, peak, flagged: flags.length > 0, flags, ...extra,
          }));
  return { name: cue.name, moment: cue.moment, lane: cue.lane, prompt: cue.prompt, variants };
});
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const pad = (v, w) => String(v).padEnd(w);
for (const c of manifest) {
  for (const v of c.variants) {
    console.log(
      `${pad(c.name + "-" + v.n, 26)}${pad(v.file.split(".")[1], 4)}${pad(v.seconds.toFixed(3), 7)}${pad(v.bytes, 7)}${pad(v.lufs, 7)}${pad(v.peak, 6)}lead ${pad(v.leadMs, 5)}nat ${pad(v.natural, 6)}raw ${pad(v.rawPeak, 6)}over ${pad(v.over, 5)}${v.capped ? "cap " : "    "}${v.flags.join(",")}${v.redone ? "  [redone, first: " + (v.redone.firstFlags.join(",") || "ok") + "]" : ""}`,
    );
  }
}
const all = manifest.flatMap((c) => c.variants);
console.log(`${all.length} variants, ${all.filter((v) => v.flagged).length} flagged`);
