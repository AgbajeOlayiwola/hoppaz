/**
 * Calibrates the speech heuristic in speech.mjs without spending credits.
 *
 *   node scripts/music/calibrate-speech.mjs [rawId] [bpm]
 *
 * Negatives: the finished loops in public/music/try (instrumental), tiled twice exactly as loop.mjs
 * scans them. Positives: the same loops with macOS `say` speech mixed in at three levels, and with
 * chants locked to the beat grid (the hard case, because a chant on the grid hides from the off-grid
 * measure). Prints the measures for each so the thresholds in speech.mjs can be checked against them.
 * Needs macOS `say`; writes only to the raw folder.
 */
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decode, exec, f32FromBuffer, rms, toMono } from "./dsp.mjs";
import { speechScan, speechVerdict } from "./speech.mjs";
import { DEFAULT_RAW_DIR, tryDir } from "./lib.mjs";

const SR = 44100;
const raw = process.env.MUSIC_RAW_DIR ?? DEFAULT_RAW_DIR;
await mkdir(raw, { recursive: true });

const TEXT =
  "Lagos is loud tonight and the bus is rolling. Hop on, find your crew, grab a seat by the window. " +
  "Nobody is going home early, the road is long and the music is good. Tell your friends to meet us at the junction, " +
  "we are collecting boxes all around the island. Who is coming with us? Come on, come on, let us go. " +
  "The danfo is full, the night is young, and the whole street knows our name. Keep moving, keep smiling, keep the energy up.";

async function say(voice, text, name) {
  const out = resolve(raw, `speechtest-${name}.wav`);
  await exec("say", ["-v", voice, "-o", out, "--data-format=LEI16@44100", text]);
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-i", out, "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"]);
  return f32FromBuffer(stdout);
}

function mixAt(music, voice, gainDb, repeatToFill = true, offset = 0) {
  const out = Float32Array.from(music);
  const r = rms(music, 0, music.length);
  const rv = rms(voice, 0, voice.length) || 1;
  const g = (r / rv) * Math.pow(10, gainDb / 20);
  for (let i = 0; i < music.length; i++) {
    const j = repeatToFill ? (i + offset) % voice.length : i - offset;
    if (j < 0 || j >= voice.length) continue;
    out[i] += voice[j] * g;
  }
  return out;
}

const manifest = JSON.parse(await readFile(resolve(tryDir, "manifest.json"), "utf8"));
const only = process.argv[2];
const bpmArg = Number(process.argv[3]);
const rows = [];
const voices = [["Daniel", "daniel"], ["Samantha", "samantha"], ["Aman", "aman"]];
const speech = {};
for (const [v, n] of voices) speech[n] = await say(v, TEXT, n);

for (const m of manifest) {
  const id = m.name;
  if (only && id !== only) continue;
  const bpm = bpmArg || m.bpm;
  const once = toMono(await decode(resolve(tryDir, `${id}.mp3`), SR));
  const music = new Float32Array(once.length * 2);
  music.set(once, 0);
  music.set(once, once.length);
  rows.push([id, "music only", speechScan(music, SR, bpm)]);
  for (const gain of [-12, -6, 0]) {
    for (const [, n] of voices) {
      rows.push([id, `+ ${n} speech ${gain} dB`, speechScan(mixAt(music, speech[n], gain), SR, bpm)]);
    }
  }
  // Chants locked to the beat grid: the same "hey" on every beat, and random words on random beats.
  const beat = Math.round((60 / bpm) * SR);
  const words = ["hey", "ho", "yeah", "oh", "go", "wah", "eh"];
  const clips = {};
  for (const w of words) clips[w] = await say("Daniel", w, `w-${w}`);
  const hey = clips.hey;
  const same = new Float32Array(music.length);
  for (let k = 0; k * beat + hey.length < music.length; k++) for (let i = 0; i < hey.length; i++) same[k * beat + i] += hey[i];
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const rand = new Float32Array(music.length);
  for (let k = 0; k * beat < music.length - SR; k++) {
    if (rnd() < 0.55) {
      const c = clips[words[Math.floor(rnd() * words.length)]];
      for (let i = 0; i < c.length && k * beat + i < rand.length; i++) rand[k * beat + i] += c[i];
    }
  }
  for (const gain of [-12, -6]) {
    rows.push([id, `+ identical "hey" chant ${gain} dB`, speechScan(mixAt(music, same, gain, false), SR, bpm)]);
    rows.push([id, `+ random-word chant ${gain} dB`, speechScan(mixAt(music, rand, gain, false), SR, bpm)]);
  }
}

for (const [id, what, s] of rows) {
  const v = speechVerdict(s);
  console.log(`${id.padEnd(28)} ${what.padEnd(34)} offGrid ${String(s.offGrid).padEnd(6)} repeat ${String(s.repeat).padEnd(6)} ${v.likely ? "FLAGGED" : "clean"}`);
}
