/**
 * Turns raw generated takes into seamless, loudness-matched loops for the app.
 *
 *   node scripts/music/loop.mjs                  every track that has a raw take
 *   node scripts/music/loop.mjs --only id,id     some of them
 *   node scripts/music/loop.mjs --analyze        analysis and candidate table only, writes nothing
 *   node scripts/music/loop.mjs --bars 16        loop length in bars (default 16; falls back to 12 then 8
 *                                                if the take has no clean stretch that long)
 *   node scripts/music/loop.mjs --take 1         use <name>.take1.wav (an earlier take kept by --regen)
 *
 * For each take:
 *   1. Tempo and beat grid: spectral-flux onset envelope, comb-filter search around the planned BPM,
 *      robust line fit through the strongest onset near every beat; the grid is then snapped to the
 *      real transients (sample accurate). Downbeat: kick strength plus chord change vote.
 *   2. Intro, fade, dropout: a start whose bars are quieter or sparser than the track is intro; a drop
 *      in the last bars of the stretch is a fade; a bar 10 dB under the track is a dropout. None of
 *      those may be inside the loop.
 *   3. Loop point: the start is a downbeat (3 ms before its transient so the first play starts clean),
 *      the length is a whole number of bars. Every legal start is scored by how alike the two pieces of
 *      audio that get joined are (attack pattern, chroma, band spectrum), 4-bar phrase starts get a
 *      small bonus, and the best few are built and measured. A transient-alignment lag of up to 20 ms
 *      is applied to the cut when it clearly improves the match.
 *   4. Seam. The join is a blend that starts and ends on the take's own audio, so the last sample of the
 *      loop is followed by what the take itself plays next. No jump, no click.
 *        pre   (default) the last beat of the loop is blended with the audio just before the start; the
 *              file starts on the clean downbeat. Needs a lead-in before the start.
 *        post  the audio that follows the cut is blended over the first beat of the loop. Used when the
 *              clean stretch begins at the first sample of the take.
 *      Blend lengths from one beat down to 8 ms are tried (equal power, or equal amplitude where the two
 *      sides are in phase) and the one with the best seam measures wins; at a section edge a short blend
 *      beats a long one.
 *   5. Loudness: one gain for the whole loop to -16 LUFS (menu -19), a look-ahead limiter to keep the
 *      true peak under -1.5 dBTP (run on three tiled copies so it wraps cleanly), 44.1 kHz stereo
 *      MP3 128 kbps CBR via libmp3lame with the Xing/LAME gapless tag. The MP3 is decoded again and
 *      everything below is measured on that decoded file, what the app will actually play.
 *   6. Measures and flags go to public/music/try/manifest.json.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bufferFromF32, clamp, db, decode, exec, f32FromBuffer, measureLoudness, median, ncc, quantile, rms, samplePeakDb, toMono,
} from "./dsp.mjs";
import { analyzeTake, beatChroma, cos12 } from "./analyze.mjs";
import { ATT_HOP, attackEnv, bestLag, buildLoop, buildLoopPost, refineOnsets, seamReport, specDiffDb, waveCorr } from "./seam.mjs";
import { SPEECH_THRESHOLDS, speechScan, speechVerdict } from "./speech.mjs";
import { DEFAULT_RAW_DIR, musicDir, parseArgs, tryDir } from "./lib.mjs";

const SR = 44100;
const args = parseArgs();
const rawDir = resolve(args.get("raw", process.env.MUSIC_RAW_DIR ?? DEFAULT_RAW_DIR));
const outDir = resolve(args.get("out", tryDir));
const BARS = Number(args.get("bars", 16));
const analyzeOnly = args.has("analyze");

const plan = JSON.parse(await readFile(resolve(musicDir, "tracks.json"), "utf8"));
const only = args.has("only") ? String(args.get("only")).split(",") : null;
const exists = (p) => stat(p).then(() => true, () => false);

const take = args.has("take") ? `.take${args.get("take")}` : "";
async function rawFileFor(id) {
  for (const ext of ["wav", "mp3"]) {
    const p = resolve(rawDir, `${id}${take}.${ext}`);
    if (await exists(p)) return p;
  }
  return null;
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

function scale(st, gainDb) {
  const g = Math.pow(10, gainDb / 20);
  const out = new Float32Array(st.length);
  for (let i = 0; i < st.length; i++) out[i] = st[i] * g;
  return out;
}

/** Look-ahead limiter on three tiled copies so the loop wraps; returns the middle copy. */
async function limitLoop(st, ceilDb) {
  const n = st.length;
  const tiled = new Float32Array(n * 3);
  tiled.set(st, 0);
  tiled.set(st, n);
  tiled.set(st, 2 * n);
  const lin = Math.pow(10, ceilDb / 20);
  const { stdout } = await exec(
    "ffmpeg",
    ["-v", "error", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", "-", "-af", `alimiter=limit=${lin.toFixed(5)}:attack=5:release=60:level=false:latency=true`, "-f", "f32le", "-"],
    bufferFromF32(tiled),
  );
  const out = f32FromBuffer(stdout);
  return out.slice(n, 2 * n);
}

async function encodeMp3(st, file) {
  await exec(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", "-", "-c:a", "libmp3lame", "-b:a", "128k", "-ar", String(SR), "-ac", "2", "-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", file],
    bufferFromF32(st),
  );
  return decode(file, SR);
}

/** Gain, limiter, encode, decode, measure; iterate until loudness and true peak both land. */
async function finalise(loop, targetLufs, file) {
  const m0 = await measureLoudness(loop, SR);
  const peak0 = samplePeakDb(loop);
  let gainDb = targetLufs - m0.lufs;
  let ceilDb = -2.0;
  const maxLimiting = 4; // dB of peak shaving we accept before we would rather be quieter
  let best = null;
  for (let it = 0; it < 7; it++) {
    gainDb = Math.min(gainDb, ceilDb - peak0 + maxLimiting);
    let y = scale(loop, gainDb);
    const pk = samplePeakDb(y);
    const limitedBy = Math.max(0, pk - ceilDb);
    if (limitedBy > 0) y = await limitLoop(y, ceilDb);
    const dec = await encodeMp3(y, file);
    const m = await measureLoudness(dec, SR);
    const rec = { gainDb, ceilDb, limitedBy, lufs: m.lufs, lra: m.lra, truePeak: m.truePeak, dec, iterations: it + 1 };
    const okTp = m.truePeak <= -1.55;
    const dl = m.lufs - targetLufs;
    if (okTp && (!best || Math.abs(dl) < Math.abs(best.lufs - targetLufs))) best = rec;
    if (okTp && Math.abs(dl) <= 0.35) break;
    if (!okTp) ceilDb -= m.truePeak + 1.5 + 0.1;
    if (Math.abs(dl) > 0.35) gainDb -= dl;
  }
  if (!best) throw new Error("could not get under -1.5 dBTP");
  // The file on disk must be the best one, not the last one tried.
  if (best.iterations !== undefined) {
    let y = scale(loop, best.gainDb);
    if (samplePeakDb(y) > best.ceilDb) y = await limitLoop(y, best.ceilDb);
    best.dec = await encodeMp3(y, file);
  }
  return best;
}

/**
 * Every legal start (a downbeat, 3 ms early) with its evidence, in one or both blend modes.
 *
 *   pre   the last beat of the loop is blended with the beat before the start (needs a one beat lead-in).
 *         What must match is the audio before s and the audio before s+L. The file starts on the clean
 *         downbeat.
 *   post  the first beat of the loop is blended with the audio after the cut (needs a tail after s+L).
 *         What must match is the audio after s and the audio after s+L. Used when the clean stretch of
 *         the take begins at the very first sample and there is no lead-in.
 *
 * Evidence: attack pattern, chroma and band spectrum over one bar (or all there is).
 */
function candidateTable({ mono, att, A, shiftSamples, L, x, lead, bars }) {
  const bar = Math.round(A.barSamples);
  const beat = A.beatLen;
  const medRms = median(A.barRms);
  const medOn = median(A.barOnsets);
  const rows = [];
  for (let i = 0; i < A.downSamples.length - 1; i++) {
    const D = A.downSamples[i] + shiftSamples;
    const s = Math.max(0, Math.round(D - lead));
    if (D - lead < -0.02 * SR || s + L > mono.length) continue;
    const intro = A.barRms[i] < medRms - 2.5 || A.barOnsets[i] < 0.75 * medOn;
    const region = A.barRms.slice(i, i + bars);
    const half = region.slice(0, Math.ceil(region.length / 2));
    const lastThree = region.slice(-3);
    const fade = lastThree.length > 0 && Math.min(...lastThree) < median(half) - 4;
    const dropout = region.some((v) => v < medRms - 10);
    const spread = Math.max(...region) - Math.min(...region);
    const steady = 1 - clamp((spread - 1) / 3, 0, 1);
    const evidence = (a0s, b0s, w) => {
      const sd = specDiffDb(mono, SR, a0s, b0s, w);
      const nBeats = Math.max(1, Math.floor(w / beat));
      const startsA = Array.from({ length: nBeats }, (_, k) => a0s + k * beat);
      const startsB = startsA.map((v) => v + (b0s - a0s));
      const avg = (arr) => arr[0].map((_, j) => arr.reduce((acc, v) => acc + v[j], 0) / arr.length);
      const chromaSim = cos12(avg(beatChroma(mono, SR, startsA, beat)), avg(beatChroma(mono, SR, startsB, beat)));
      const nF = Math.round(w / ATT_HOP);
      const envCorr = ncc(Array.from(att.subarray(Math.round(a0s / ATT_HOP), Math.round(a0s / ATT_HOP) + nF)), Array.from(att.subarray(Math.round(b0s / ATT_HOP), Math.round(b0s / ATT_HOP) + nF)));
      return { sd, chromaSim, envCorr };
    };
    const common = { i, s, intro, fade, dropout, spread };
    const bonus = i % 4 === 0 ? 0.02 : 0;
    if (s >= x) {
      const w = Math.min(bar, s);
      const e = evidence(s - w, s + L - w, w);
      rows.push({ ...common, mode: "pre", ...e, score: 0.4 * e.envCorr + 0.3 * e.chromaSim + 0.3 * (1 - clamp(e.sd / 10, 0, 1)) + 0.1 * steady + bonus });
    }
    const tail = mono.length - (s + L);
    if (tail >= 0.008 * SR) {
      const w = Math.min(bar, tail);
      const e = w >= beat * 0.5 ? evidence(s, s + L, w) : { sd: 10, chromaSim: 0.5, envCorr: 0 };
      rows.push({ ...common, mode: "post", tail, ...e, score: 0.4 * e.envCorr + 0.3 * e.chromaSim + 0.3 * (1 - clamp(e.sd / 10, 0, 1)) + 0.1 * steady + bonus - 0.01 });
    }
  }
  return rows;
}

let ledger = { entries: [] };
try {
  ledger = JSON.parse(await readFile(resolve(musicDir, "ledger.json"), "utf8"));
} catch {}
/** The prompt that made the take on disk: the plan's prompt plus the regeneration wording if one was used. */
function promptUsed(t) {
  if (take) return { prompt: t.prompt, take: Number(args.get("take")) };
  const mine = ledger.entries.filter((e) => e.track === t.id);
  const last = mine[mine.length - 1];
  return { prompt: last?.prompt_suffix ? `${t.prompt} ${last.prompt_suffix}` : t.prompt, take: last?.take ?? 1 };
}

const results = [];
let foundRaw = 0;
const todo = plan.tracks.filter((t) => !only || only.includes(t.id));
for (const t of todo) {
  const rawFile = await rawFileFor(t.id);
  if (!rawFile) continue;
  foundRaw++;
  console.log(`\n=== ${t.id}  (${t.slot}, planned ${t.bpm} BPM) ===`);
  const st = await decode(rawFile, SR);
  const mono = toMono(st);
  const takeSec = mono.length / SR;

  // 1. tempo and grid
  const A = analyzeTake(mono, SR, t.bpm);
  const att = attackEnv(mono, SR);
  const ref = refineOnsets(mono, A.beatSamples.filter((b) => b > 0.02 * SR && b < mono.length - SR), SR);
  const cal = { shiftSamples: ref ? ref.shift : 0, shiftMs: ref ? (ref.shift / SR) * 1000 : 0, spreadMs: ref ? (ref.spread / SR) * 1000 : NaN, n: ref ? ref.n : 0 };
  const driftPct = (Math.abs(A.bpmFirstHalf - A.bpmSecondHalf) / A.bpm) * 100;
  console.log(
    `tempo ${fmt(A.bpm, 3)} BPM (planned ${t.bpm}, global search ${fmt(A.bpmGlobal, 2)}), halves ${fmt(A.bpmFirstHalf, 3)} / ${fmt(A.bpmSecondHalf, 3)} drift ${fmt(driftPct, 2)}%, ` +
      `beat wobble ${fmt(A.wobbleMs, 1)} ms, inliers ${A.beatInliers}, grid snapped ${fmt(cal.shiftMs, 1)} ms to the real transients (spread ${fmt(cal.spreadMs, 1)} ms over ${cal.n} hits), downbeat vote ${A.downbeatScores.map((v) => fmt(v, 1)).join(" ")}`,
  );

  // 2. candidates. If the take has no clean stretch of BARS bars (a long quiet intro, a fade), fall back to
  // 12 and then 8 bars and flag it.
  const barSamples = A.barSamples;
  const beatN = Math.round(A.beatLen);
  const lead = Math.round(0.003 * SR);
  console.log(`bar RMS dB: ${A.barRms.map((v) => fmt(v, 1)).join(" ")}`);
  let nbars = BARS;
  let L0, rows, usable;
  for (const nb of [BARS, 12, 8].filter((v, i, arr) => v <= BARS && arr.indexOf(v) === i)) {
    nbars = nb;
    L0 = Math.round(nb * barSamples);
    rows = candidateTable({ mono, att, A, shiftSamples: cal.shiftSamples, L: L0, x: beatN, lead, bars: nb });
    usable = rows.filter((r) => !r.intro && !r.fade && !r.dropout);
    console.log(`candidates for ${nb} bars (bar index, mode, start s, score | attack-corr chroma specDiff dB | level spread dB | intro fade dropout):`);
    for (const r of rows) {
      console.log(`  bar ${String(r.i).padStart(2)} ${r.mode.padEnd(4)} ${fmt(r.s / SR, 3)} s  score ${fmt(r.score, 3)} | ${fmt(r.envCorr, 2)} ${fmt(r.chromaSim, 3)} ${fmt(r.sd, 2)} | ${fmt(r.spread, 1)} | ${r.intro ? "INTRO" : "-"} ${r.fade ? "FADE" : "-"} ${r.dropout ? "DROP" : "-"}`);
    }
    if (usable.length) break;
  }
  const shortened = nbars < BARS;
  const pool = usable.length ? usable : rows;
  if (!pool.length) {
    console.log("no legal loop start, the take is too short for this many bars");
    results.push({ name: t.id, slot: t.slot, flagged: true, flags: ["no legal loop start"], regenerate: true });
    continue;
  }
  const pickedAllBad = !usable.length;
  const ranked = [...pool].sort((p, q) => q.score - p.score);
  const shortlist = [...ranked.filter((r) => r.mode === "pre").slice(0, 3), ...ranked.filter((r) => r.mode === "post").slice(0, 2)];

  // 3. For the best few starts: align the cut to the transients, then try blend lengths from a beat down
  // to a few ms and keep whichever the seam metrics like best. A long blend is only right when the audio
  // next to the join looks like the other side of it; at a section edge a short blend beats it.
  const xOptions = [Math.round(A.beatLen), Math.round(A.beatLen / 2), Math.round(A.beatLen / 4), Math.round(0.03 * SR), Math.round(0.008 * SR)];
  const plans = [];
  for (const cand of shortlist) {
    const post = cand.mode === "post";
    // Alignment: transients just before the start against transients just before the end (pre), or
    // just after the start against just after the cut (post).
    const w2 = post ? Math.min(2 * Math.round(barSamples), cand.tail) : Math.min(2 * Math.round(barSamples), cand.s);
    const canAlign = w2 >= A.beatLen;
    const winA = (Lx) => (post ? [cand.s, cand.s + Lx] : [cand.s - w2, cand.s + Lx - w2]);
    let Lc = L0;
    let lagMs = 0;
    let lagApplied = 0;
    let lagInfo = { zero: NaN, best: NaN };
    if (canAlign) {
      const [aS, bS] = winA(L0);
      lagInfo = bestLag(att, aS, bS, w2, 20);
      lagMs = (lagInfo.lagSamples / SR) * 1000;
      if (Math.abs(lagMs) >= 0.75 && lagInfo.best - lagInfo.zero > 0.04) {
        lagApplied = lagMs;
        Lc = L0 + Math.round(lagInfo.lagSamples);
      }
    }
    let residMs = 0;
    let alignScore = 1;
    if (canAlign) {
      const [aS, bS] = winA(Lc);
      const resid = bestLag(att, aS, bS, w2, 20);
      residMs = (resid.lagSamples / SR) * 1000;
      alignScore = clamp(1 - (Math.abs(residMs) - 3) / 10, 0, 1);
      cand.alignCorr = resid.zero;
    }
    for (const xTry of xOptions) {
      if (post ? mono.length - (cand.s + Lc) < xTry : cand.s < xTry) continue;
      if (cand.s + Lc > mono.length) continue;
      const rhoTry = post ? waveCorr(mono, cand.s, cand.s + Lc, xTry) : waveCorr(mono, cand.s - xTry, cand.s + Lc - xTry, xTry);
      const lp = (post ? buildLoopPost : buildLoop)(st, cand.s, Lc, xTry, rhoTry);
      const sr = seamReport(toMono(lp), Lc, Lc / nbars, SR, A.beatLen, post ? "start" : "end");
      // How alike are the two pieces of audio that get blended? A level or spectrum gap matters in
      // proportion to how long the blend lasts (a 8 ms blend is only a declick).
      const [mA, mB] = post ? [cand.s, cand.s + Lc] : [cand.s - xTry, cand.s + Lc - xTry];
      const dLevel = Math.abs(db(rms(mono, mA, mA + xTry)) - db(rms(mono, mB, mB + xTry)));
      const dSpec = xTry >= 2048 ? specDiffDb(mono, SR, mA, mB, xTry) : 0;
      const weight = Math.min(1, xTry / (A.beatLen / 2));
      const matchScore = 1 - weight * Math.max(clamp((dLevel - 2) / 4, 0, 1), clamp((dSpec - 6) / 8, 0, 1));
      plans.push({ cand, L: Lc, x: xTry, rho: rhoTry, lagMs, lagApplied, lagInfo, residMs, alignScore, matchScore, dLevel, dSpec, canAlign, w2, sr, total: Math.min(sr.seamScore, alignScore, matchScore) });
    }
  }
  console.log("blend options tried (bar, mode, blend ms, total | seam ratios rms flux hf blend | blended pieces differ by dB level, dB spectrum):");
  for (const q of plans) {
    console.log(`  bar ${String(q.cand.i).padStart(2)} ${q.cand.mode.padEnd(4)} ${fmt((q.x / SR) * 1000, 0).padStart(4)} ms  total ${fmt(q.total, 3)} | ${q.sr.ratios.rms} ${q.sr.ratios.flux} ${q.sr.ratios.click} ${q.sr.ratios.blend} | ${fmt(q.dLevel, 1)} ${fmt(q.dSpec, 1)}`);
  }
  if (!plans.length) {
    console.log("no blend option fits");
    results.push({ name: t.id, slot: t.slot, flagged: true, flags: ["no blend option fits"], regenerate: true });
    continue;
  }
  const bestTotal = Math.max(...plans.map((q) => q.total));
  const plan_ = plans
    .filter((q) => q.total >= bestTotal - 0.03)
    .sort((p, q) => (p.cand.mode === q.cand.mode ? 0 : p.cand.mode === "pre" ? -1 : 1) || q.cand.score - p.cand.score || q.x - p.x)[0];
  const pick = plan_.cand;
  const L = plan_.L;
  const x = plan_.x;
  const lagMs = plan_.lagMs;
  const lagApplied = plan_.lagApplied;
  const w2 = plan_.w2;
  console.log(
    `picked bar ${pick.i} ${pick.mode} (start ${fmt(pick.s / SR, 3)} s), loop ${nbars} bars = ${L} samples (${fmt(L / SR, 3)} s); blend ${fmt((x / SR) * 1000, 0)} ms; ` +
      (plan_.canAlign
        ? `transient lag at the cut ${fmt(lagMs, 2)} ms (corr ${fmt(plan_.lagInfo.zero, 3)} -> ${fmt(plan_.lagInfo.best, 3)}), ${lagApplied ? "applied" : "not applied"}`
        : "too little audio next to the join to check transient alignment"),
  );
  if (analyzeOnly) continue;

  // 4. build the loop
  const rho = plan_.rho;
  const post = pick.mode === "post";
  const loop = (post ? buildLoopPost : buildLoop)(st, pick.s, L, x, rho);
  const naive = st.slice(pick.s * 2, (pick.s + L) * 2);
  console.log(`blend ${x} samples (${fmt((x / SR) * 1000, 0)} ms) of the loop end with the audio before the start, waveform correlation of the two sides ${fmt(rho, 2)}`);

  // 5. loudness, limiter, encode
  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, `${t.id}.mp3`);
  const target = t.slot === "menu" ? -19 : -16;
  const fin = await finalise(loop, target, file);
  const bytes = (await stat(file)).size;
  const decMono = toMono(fin.dec);
  const effBpmEarly = (nbars * 4 * 60) / (L / SR);
  const gaplessOk = fin.dec.length / 2 === L;

  // 6. measures
  const barL = L / nbars;
  const seam = seamReport(decMono, Math.min(decMono.length, L), barL, SR, A.beatLen, post ? "start" : "end");
  const seamNaive = seamReport(toMono(naive), L, barL, SR, A.beatLen, post ? "start" : "end");
  // Rhythmic continuity: how far apart are the transients 16 bars apart, after the cut is chosen.
  const residMs = plan_.residMs;
  const alignScore = plan_.alignScore;
  seam.alignment = plan_.canAlign
    ? { residualMs: +residMs.toFixed(2), attackCorrelation: +(pick.alignCorr ?? NaN).toFixed(3), score: +alignScore.toFixed(3) }
    : { residualMs: null, note: "too little audio next to the join to measure" };
  seam.seamScore = +Math.min(seam.seamScore, alignScore).toFixed(3);
  const tiled = new Float32Array(decMono.length * 2);
  tiled.set(decMono, 0);
  tiled.set(decMono, decMono.length);
  const sp = speechScan(tiled, SR, effBpmEarly);
  const verdict = speechVerdict(sp, SPEECH_THRESHOLDS);
  const takeTail = db(rms(mono, mono.length - SR * 1.5, mono.length)) - median(A.barRms);
  const effBpm = (nbars * 4 * 60) / (L / SR);

  const flags = [];
  const hard = [];
  if (Math.abs(A.bpm - t.bpm) / t.bpm > 0.015) hard.push(`tempo ${fmt(A.bpm, 2)} BPM against planned ${t.bpm}`);
  if (driftPct > 1) hard.push(`tempo drift ${fmt(driftPct, 2)}% between halves`);
  if (A.wobbleMs > 20) hard.push(`loose timing, beats wander ${fmt(A.wobbleMs, 0)} ms`);
  if (pickedAllBad) hard.push("every legal loop start is intro, fade or dropout");
  else if (shortened) hard.push(`no clean stretch of ${BARS} bars (intro, fade or dropout), loop shortened to ${nbars} bars`);
  if (pick.fade) hard.push("fade-out inside the loop region");
  if (pick.dropout) hard.push("level dropout inside the loop region");
  if (verdict.likely) hard.push(`vocals or chant suspected: ${verdict.reasons.join("; ")}`);
  if (seam.seamScore < 0.6) hard.push(`seam score ${seam.seamScore}`);
  if (!gaplessOk) flags.push(`decoded length ${fin.dec.length / 2} differs from ${L} samples`);
  if (Math.abs(fin.lufs - target) > 1) flags.push(`loudness ${fmt(fin.lufs, 1)} LUFS, target ${target}`);
  if (fin.truePeak > -1.5) flags.push(`true peak ${fmt(fin.truePeak, 2)} dBTP`);
  const notes = [];
  if (takeTail < -4) notes.push(`the take ends with a fade or ending (last 1.5 s is ${fmt(-takeTail, 1)} dB under the median bar); the loop does not use it`);
  const allFlags = [...hard, ...flags];

  const entry = {
    name: t.id,
    slot: t.slot,
    prompt: promptUsed(t).prompt,
    take: promptUsed(t).take,
    bpm: +effBpm.toFixed(3),
    bars: nbars,
    seconds: +(L / SR).toFixed(3),
    lufs: +fin.lufs.toFixed(1),
    bytes,
    seamScore: seam.seamScore,
    flagged: allFlags.length > 0,
    flags: allFlags,
    notes,
    regenerate: hard.length > 0,
    flavour: t.flavour,
    key: t.key,
    hook: t.hook,
    bpmPlanned: t.bpm,
    bpmFound: +A.bpm.toFixed(3),
    truePeakDb: +fin.truePeak.toFixed(2),
    lra: +fin.lra.toFixed(1),
    loopSamples: L,
    sampleRate: SR,
    channels: 2,
    bitrateKbps: 128,
    loopStartSec: +(pick.s / SR).toFixed(3),
    loopStartBar: pick.i,
    blendMs: +((x / SR) * 1000).toFixed(0),
    blendMode: pick.mode,
    gapless: gaplessOk,
    gainDb: +fin.gainDb.toFixed(2),
    limiterShaveDb: +fin.limitedBy.toFixed(2),
    seam: { ...seam, naiveHardCutScore: seamNaive.seamScore, naiveRatios: seamNaive.ratios },
    speech: { ...sp, thresholds: SPEECH_THRESHOLDS },
    tempoWobbleMs: +A.wobbleMs.toFixed(1),
    tempoDriftPct: +driftPct.toFixed(2),
    takeSeconds: +takeSec.toFixed(2),
    takeFile: rawFile.split('/').pop(),
  };
  results.push(entry);
  console.log(
    `RESULT ${t.id}: ${fmt(L / SR, 2)} s, ${nbars} bars @ ${fmt(effBpm, 3)} BPM, ${fmt(fin.lufs, 1)} LUFS, TP ${fmt(fin.truePeak, 2)} dBTP, ${bytes} bytes, ` +
      `seam ${seam.seamScore} (hard cut would be ${seamNaive.seamScore}; ratios rms ${seam.ratios.rms} flux ${seam.ratios.flux} hf ${seam.ratios.click} blend ${seam.ratios.blend}; transients ${plan_.canAlign ? fmt(residMs, 2) + " ms apart" : "alignment n/a"}), ` +
      `speech offGrid ${sp.offGrid} repeat ${sp.repeat}, gapless ${gaplessOk}, ${allFlags.length ? "FLAGS: " + allFlags.join(" | ") : "no flags"}`,
  );
}

if (!foundRaw) {
  console.log(
    `No raw takes found in ${rawDir}\n` +
      `The raw 48 kHz WAV takes were kept outside the repo, in a scratch folder, and that folder has since been cleared. ` +
      `Nothing was changed: public/music/try/manifest.json and the MP3 loops are as they were. ` +
      `Point --raw (or MUSIC_RAW_DIR) at a folder that holds <track id>.wav. Making new takes costs credits: see scripts/music/README.md.`,
  );
  process.exitCode = 1;
}

if (!analyzeOnly && results.length) {
  const mpath = resolve(outDir, "manifest.json");
  let old = [];
  try {
    old = JSON.parse(await readFile(mpath, "utf8"));
  } catch {}
  const byName = new Map(old.map((e) => [e.name, e]));
  for (const r of results) byName.set(r.name, r);
  const order = plan.tracks.map((t) => t.id);
  const merged = [...byName.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  await writeFile(mpath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nmanifest: ${merged.length} tracks -> ${mpath}`);
}
