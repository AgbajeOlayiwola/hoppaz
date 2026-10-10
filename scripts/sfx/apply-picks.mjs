/**
 * Applies the picks: copies each picked take from public/sfx/try/ to
 * public/sfx/<cue>.<ext> and rewrites the table in src/lib/sound/picks.ts, so the
 * app plays the file instead of the synth voice. "synth" puts the synth back and
 * removes the shipped copy.
 *
 * A row of picks.ts is { file, g, aim }. g is the trim and aim is where the cue
 * should sit, as the LUFS of the trimmed file (before the master and the lane). A new
 * take is trimmed to the same aim from its LUFS in manifest.json:
 *   g = 10^((aim - take LUFS) / 20)
 * so a take that is a few dB louder or softer than the last one still lands in the
 * same place. The aim was set by matching the synth voice through the real chain
 * (docs/SOUND-FILES.md, Levels); listen after a new pick and nudge g if it needs it.
 * Synth keeps its aim and goes back to g 1.
 *
 *   node scripts/sfx/apply-picks.mjs "open-common:2 coin:synth"
 *   node scripts/sfx/apply-picks.mjs box_burst_common:2 coin:synth --dry
 *
 * A pick is <name>:<n> (take n of that cue, 1 to 3) or <name>:synth. <name> is a
 * cue from manifest.json (box_burst_common; a hyphen works for an underscore) or a
 * voice key from picks.ts (rip, agogo:0). Voice keys have a colon of their own, so
 * the pick is the part after the last colon: talkingDrum:common:2. Picks are
 * separated by spaces or commas. Everything is checked before anything is written,
 * so a typo changes nothing. Picks not named stay as they are. --dry only prints.
 *
 * Needs no key and no network. It only reads public/sfx/try/ and writes public/sfx/
 * and picks.ts.
 */
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tryDir = resolve(root, "public/sfx/try");
const outDir = resolve(root, "public/sfx");
const picksFile = resolve(root, "src/lib/sound/picks.ts");
const EXTS = [".mp3", ".wav"];

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const tokens = args
  .filter((a) => a !== "--dry")
  .join(" ")
  .split(/[\s,]+/)
  .filter(Boolean);
if (!tokens.length) {
  console.log('usage: node scripts/sfx/apply-picks.mjs "box_burst_common:2 coin:synth" [--dry]');
  process.exit(1);
}

// ---------- the table ----------

// One row of picks.ts:   "talkingDrum:common": { file: "synth", g: 1, aim: -24 }, // box_burst_common
const ROW = /^(\s*)("?)([\w:]+)\2: \{ file: "([^"]*)", g: ([\d.]+), aim: (-?[\d.]+) \},(\s*\/\/\s*)([a-z0-9_]+)\s*$/;
const lines = (await readFile(picksFile, "utf8")).split("\n");
const rows = new Map();
lines.forEach((line, i) => {
  const m = ROW.exec(line);
  if (m) rows.set(m[3], { i, m, cue: m[8], file: m[4], g: Number(m[5]), aim: Number(m[6]) });
});
if (!rows.size) {
  console.log("no rows found in src/lib/sound/picks.ts, is the format changed?");
  process.exit(1);
}
const byCue = new Map([...rows].map(([key, r]) => [r.cue, key]));
const manifest = JSON.parse(await readFile(resolve(tryDir, "manifest.json"), "utf8"));

// ---------- check every pick first ----------

const plan = new Map();
const errors = [];
for (const tok of tokens) {
  const at = tok.lastIndexOf(":");
  const name = tok.slice(0, at);
  const v = tok.slice(at + 1);
  if (at < 1 || !/^(synth|\d+)$/.test(v)) {
    errors.push(`${tok}: expected <name>:<n> or <name>:synth, a voice key needs its pick after it (talkingDrum:common:2)`);
    continue;
  }
  const key = rows.has(name) ? name : (byCue.get(name) ?? byCue.get(name.replace(/-/g, "_")));
  if (!key) {
    errors.push(rows.has(tok) ? `${tok}: a voice key needs its pick after it (${tok}:2 or ${tok}:synth)` : `${tok}: no cue or voice called "${name}"`);
    continue;
  }
  const { cue } = rows.get(key);
  if (v === "synth") {
    plan.set(key, { key, cue, file: "synth", g: 1 });
    continue;
  }
  const entry = manifest.find((c) => c.name === cue);
  const take = entry?.variants.find((x) => x.n === Number(v));
  if (!take) {
    errors.push(`${tok}: ${cue} has no take ${v}${entry ? ` (it has ${entry.variants.map((x) => x.n).join(", ")})` : " in manifest.json"}`);
    continue;
  }
  const from = resolve(tryDir, take.file);
  if (!((await stat(from).catch(() => null))?.size > 0)) {
    errors.push(`${tok}: public/sfx/try/${take.file} is missing`);
    continue;
  }
  // the same place as the last pick of this cue: its aim, from this take's own loudness
  const g = Math.round(Math.pow(10, (rows.get(key).aim - take.lufs) / 20) * 1000) / 1000;
  plan.set(key, { key, cue, file: cue + extname(take.file), from, take, g });
}
if (errors.length) {
  console.log(errors.join("\n"));
  console.log("nothing changed");
  process.exit(1);
}

// ---------- apply ----------

const kb = (n) => (n / 1024).toFixed(1) + " KB";
if (!dry) await mkdir(outDir, { recursive: true });
for (const p of plan.values()) {
  const { i, m } = rows.get(p.key);
  if (!dry) {
    // the shipped copy of this cue under another extension, or none when it goes back to the synth
    for (const e of EXTS) if (p.file !== p.cue + e) await rm(resolve(outDir, p.cue + e), { force: true });
    if (p.from) await copyFile(p.from, resolve(outDir, p.file));
    lines[i] = `${m[1]}${m[2]}${m[3]}${m[2]}: { file: "${p.file}", g: ${p.g}, aim: ${m[6]} },${m[7]}${m[8]}`;
  }
  if (p.from) {
    const note = p.take.flagged ? `  (flagged: ${p.take.flags.join(", ")})` : "";
    const warn = p.g > 2 ? "  (trim above 2: it needs a lot of gain, check it is not clipping)" : "";
    console.log(`${p.key.padEnd(26)}${p.take.file} -> public/sfx/${p.file}  ${kb(p.take.bytes)}  g ${p.g}${note}${warn}`);
  } else {
    console.log(`${p.key.padEnd(26)}synth`);
  }
}
if (!dry) await writeFile(picksFile, lines.join("\n"));

// ---------- what ships ----------

const now = new Map([...rows].map(([key, r]) => [key, plan.get(key)?.file ?? r.file]));
const want = new Set([...now.values()].filter((f) => f !== "synth"));
if (dry) {
  console.log(`dry run, nothing written. ${want.size} of ${now.size} would play a file`);
} else {
  const shipped = (await readdir(outDir)).filter((f) => EXTS.includes(extname(f)));
  let bytes = 0;
  for (const f of shipped) bytes += (await stat(resolve(outDir, f))).size;
  console.log(`${want.size} of ${now.size} play a file, ${shipped.length} in public/sfx/ (${kb(bytes)})`);
  const orphans = shipped.filter((f) => !want.has(f));
  if (orphans.length) console.log(`in public/sfx/ but not in picks.ts, delete if unused: ${orphans.join(", ")}`);
}
