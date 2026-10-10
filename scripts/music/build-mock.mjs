/**
 * Builds the phone audition page for the music candidates: one self-contained HTML file with the
 * loops embedded as base64 data URIs, served at /mocks/music by localdb/phone-https/proxy.mjs
 * (the proxy cannot read the repo, so everything it needs is inside the file).
 *
 *   node scripts/music/build-mock.mjs                    build localdb/phone-https/mocks/music.html
 *   node scripts/music/build-mock.mjs --out FILE         build somewhere else
 *   node scripts/music/build-mock.mjs --max-mb 12        size ceiling for the page (default 12)
 *
 * Reads public/music/try/manifest.json and the MP3s next to it, the two box sounds in public/sfx/,
 * and scripts/music/mock/music.template.html. Tracks appear in manifest order inside their slot, so a
 * track added later (say play_day_amapiano_log) shows up as number 2 in Play (day) after a rebuild.
 *
 * If the page would pass the ceiling, every loop is re-encoded at 96 kbps CBR (ffmpeg, libmp3lame, so the
 * gapless tag is written again) and the page is built from those copies. The files in public/ are not touched.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = resolve(arg("--out", resolve(repo, "../localdb/phone-https/mocks/music.html")));
const MAX_BYTES = Number(arg("--max-mb", "12")) * 1024 * 1024;

const SECTIONS = [
  { slot: "play_day", title: "Play (day)", note: "On the map in daylight. The one people hear most." },
  { slot: "play_night", title: "Play (night)", note: "Takes over after dark. Same world, lights down. Hear the handover in Dusk, above." },
  { slot: "menu", title: "Menus", note: "Under Today, Me and Crew. Soft, so people can read." },
];
const BLURBS = {
  play_day_afrobeats_bounce: "Loud, bright, cheeky. Talking drum and agogo trade phrases over a bouncing groove.",
  play_night_afrobeats_dim: "Same streets after dark. Soft kick, deep bass, a kalimba hook.",
  menu_lofi_highlife: "Calm and a little sleepy. Soft highlife guitar and a warm Rhodes. Built to sit under a voice note.",
};
// The app plays a box sound at its file trim (src/lib/sound/picks.ts) x lane level 1 x master 0.7.
const SFX = {
  box_burst_common: { file: "box_burst_common.mp3", g: 0.621 },
  hoppaz_three_full: { file: "hoppaz_three_full.mp3", g: 0.708 },
};
const MASTER = 0.7;
const MOTIF_AT = 0.7; // seconds after the burst

const manifest = JSON.parse(readFileSync(resolve(repo, "public/music/try/manifest.json"), "utf8"));
const wanted = new Set(SECTIONS.map((s) => s.slot));
const entries = manifest.filter((m) => wanted.has(m.slot) && existsSync(resolve(repo, "public/music/try", `${m.name}.mp3`)));
if (!entries.length) throw new Error("No loops found in public/music/try.");

const b64 = (file) => `data:audio/mpeg;base64,${readFileSync(file).toString("base64")}`;
const sizeOf = (files) => files.reduce((n, f) => n + Math.ceil((statSync(f).size * 4) / 3), 0);

let files = entries.map((m) => resolve(repo, "public/music/try", `${m.name}.mp3`));
const sfxFiles = Object.values(SFX).map((s) => resolve(repo, "public/sfx", s.file));
let tmp = null;
let kbps = entries[0].bitrateKbps;
if (sizeOf([...files, ...sfxFiles]) + 60_000 > MAX_BYTES) {
  tmp = mkdtempSync(join(tmpdir(), "hz-music-96-"));
  files = entries.map((m, i) => {
    const out = join(tmp, `${m.name}.mp3`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", files[i], "-c:a", "libmp3lame", "-b:a", "96k", "-ar", "44100", out]);
    return out;
  });
  kbps = 96;
}

const slotCount = {};
const tracks = entries.map((m) => {
  slotCount[m.slot] = (slotCount[m.slot] || 0) + 1;
  return {
    id: m.name,
    slot: m.slot,
    n: slotCount[m.slot],
    name: m.flavour || m.name,
    bpm: m.bpmPlanned || Math.round(m.bpm),
    key: m.key,
    hook: m.hook || "",
    blurb: BLURBS[m.name] || m.flavour || m.name,
    sec: m.seconds,
    samples: m.loopSamples,
    rate: m.sampleRate,
  };
});
const meta = {
  sections: SECTIONS,
  tracks,
  sfx: {
    burst: { g: +(SFX.box_burst_common.g * MASTER).toFixed(3) },
    motif: { g: +(SFX.hoppaz_three_full.g * MASTER).toFixed(3), at: MOTIF_AT },
  },
};
const audio = {};
entries.forEach((m, i) => { audio[m.name] = b64(files[i]); });
Object.entries(SFX).forEach(([k, s]) => { audio[k] = b64(resolve(repo, "public/sfx", s.file)); });

// JSON inside a script tag: keep "<" out of it so nothing can close the tag early.
const inline = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
const template = readFileSync(resolve(here, "mock/music.template.html"), "utf8");
const html = template.replace("__META__", () => inline(meta)).replace("__AUDIO__", () => inline(audio));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
if (tmp) rmSync(tmp, { recursive: true, force: true });

console.log(`${OUT}\n  ${tracks.length} loops at ${kbps} kbps, ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB (ceiling ${(MAX_BYTES / 1048576).toFixed(1).replace(/\.0$/, "")} MB)`);
