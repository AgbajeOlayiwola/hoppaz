/**
 * Generates the raw sound candidates from scripts/sfx/cues.json with the
 * ElevenLabs Sound Effects API: every cue x variant, two requests at a time.
 * Raw mp3 files go OUTSIDE the repo (see rawDir). A file that already exists is
 * skipped, so a rerun costs nothing. The key is read from .env.local inside this
 * process and is never printed, logged or put on a command line.
 *
 *   node scripts/sfx/generate.mjs                 everything that is missing
 *   node scripts/sfx/generate.mjs --dry           the plan and credit estimate only
 *   node scripts/sfx/generate.mjs --only a,b      just those cues
 *   node scripts/sfx/generate.mjs --redo f.json   re-roll named variants once
 *   node scripts/sfx/generate.mjs --budget 4000   credit ceiling for this ledger
 *   node scripts/sfx/generate.mjs --raw DIR       raw folder (or env SFX_RAW_DIR)
 *
 * --redo takes { "<cue>-<n>": { "prompt": "...", "prompt_influence": 0.7 } }.
 * The old take is kept as <cue>-<n>.first.mp3, and a variant is re-rolled once.
 *
 * Credits: 40 per second when duration_seconds is set. Every response's
 * character-cost header is added to <rawDir>/_ledger.json. The run stops before
 * a request that would pass the budget, and aborts if one costs over 1.5x its
 * estimate. The first request runs alone so that check happens before the rest.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const API = "https://api.elevenlabs.io/v1/sound-generation";
// Best first. A plan that cannot use the first one is moved down on the first refusal.
const FORMATS = ["mp3_44100_192", "mp3_44100_128"];
const CREDITS_PER_SECOND = 40;
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 6;
const HARD_CAP = 8000;
const COST_ABORT_RATIO = 1.5;

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
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
const budget = Number(opt("budget") ?? 4000);
if (!(budget > 0) || budget > HARD_CAP) {
  console.log(`budget must be between 1 and ${HARD_CAP}`);
  process.exit(1);
}

async function readKey() {
  const text = await readFile(resolve(root, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => (await stat(p).catch(() => null))?.size > 0;
const estimate = (seconds) => Math.round(seconds * CREDITS_PER_SECOND);

const ledgerPath = resolve(rawDir, "_ledger.json");
const ledger = await readFile(ledgerPath, "utf8").then(JSON.parse, () => ({ format: null, entries: [] }));
const spent = () => ledger.entries.reduce((sum, e) => sum + e.credits, 0);
const saveLedger = () => writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");

const cues = JSON.parse(await readFile(resolve(root, "scripts/sfx/cues.json"), "utf8"));
const only = opt("only")?.split(",");
const redo = opt("redo") ? JSON.parse(await readFile(resolve(opt("redo")), "utf8")) : null;

const jobs = [];
for (const cue of cues) {
  if (only && !only.includes(cue.name)) continue;
  for (let n = 1; n <= cue.variants; n++) {
    const id = `${cue.name}-${n}`;
    const o = redo?.[id];
    if (redo && !o) continue;
    jobs.push({
      id,
      file: resolve(rawDir, `${id}.mp3`),
      prompt: o?.prompt ?? cue.prompt,
      seconds: o?.duration_seconds ?? cue.duration_seconds,
      influence: o?.prompt_influence ?? cue.prompt_influence,
      redo: Boolean(o),
    });
  }
}
if (redo) {
  const unknown = Object.keys(redo).filter((id) => !jobs.some((j) => j.id === id));
  if (unknown.length) console.log(`not in cues.json: ${unknown.join(", ")}`);
}

await mkdir(rawDir, { recursive: true });
const pending = [];
for (const job of jobs) {
  const meta = await readFile(job.file.replace(/\.mp3$/, ".json"), "utf8").then(JSON.parse, () => null);
  const done = (await exists(job.file)) && (!job.redo || meta?.redo);
  if (!done) pending.push(job);
}
const planned = pending.reduce((sum, j) => sum + estimate(j.seconds), 0);
console.log(`${jobs.length} files in scope, ${jobs.length - pending.length} already done, ${pending.length} to generate`);
console.log(`estimate ${planned} credits, ledger ${spent()} spent, budget ${budget}`);
if (has("dry") || !pending.length) process.exit(0);

const key = await readKey().catch(() => "");
if (!key) {
  console.log("no ELEVENLABS_API_KEY found in .env.local");
  process.exit(1);
}

// Short, key-free description of a failed response. Headers are never printed.
async function errorText(res) {
  const body = await res.json().catch(() => null);
  const d = body?.detail;
  const text = typeof d === "string" ? d : [d?.status, d?.message].filter(Boolean).join(": ");
  return String(text || "no detail").split(key).join("[key]").slice(0, 200);
}

function waitFor(res, attempt) {
  const after = Number(res.headers.get("retry-after"));
  if (after > 0) return Math.min(after, 60) * 1000;
  return 2000 * 2 ** (attempt - 1) + Math.random() * 500;
}

async function request(job) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}?output_format=${ledger.format ?? FORMATS[0]}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: job.prompt,
          duration_seconds: job.seconds,
          prompt_influence: job.influence,
          model_id: "eleven_text_to_sound_v2",
        }),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`network error (${err?.cause?.code ?? err?.name})`);
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) {
      const cost = Number.parseInt(res.headers.get("character-cost") ?? "", 10);
      return { bytes: Buffer.from(await res.arrayBuffer()), cost: Number.isFinite(cost) ? cost : null };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await sleep(waitFor(res, attempt));
      continue;
    }
    const text = await errorText(res);
    const current = FORMATS.indexOf(ledger.format ?? FORMATS[0]);
    if ([400, 402, 403, 422].includes(res.status) && /format|tier|plan|upgrade/i.test(text) && current < FORMATS.length - 1) {
      ledger.format = FORMATS[current + 1];
      console.log(`output format refused (${text}), falling back to ${ledger.format}`);
      attempt--;
      continue;
    }
    throw new Error(`HTTP ${res.status} ${text}`);
  }
}

let aborted = false;
let reserved = 0;
let done = 0;
const failed = [];
const skipped = [];
let costSeen = null;

async function run(job) {
  const est = estimate(job.seconds);
  try {
    const { bytes, cost } = await request(job);
    const credits = cost ?? est;
    if (costSeen === null) {
      costSeen = cost !== null;
      console.log(costSeen ? `first response: ${credits} credits against an estimate of ${est}` : "no character-cost header, counting the estimate");
    }
    if (credits > est * COST_ABORT_RATIO) {
      aborted = true;
      console.log(`${job.id}: cost ${credits} is over ${COST_ABORT_RATIO}x the estimate ${est}, stopping`);
    }
    if (job.redo && (await exists(job.file))) {
      await rename(job.file, job.file.replace(/\.mp3$/, ".first.mp3"));
      await rename(job.file.replace(/\.mp3$/, ".json"), job.file.replace(/\.mp3$/, ".first.json")).catch(() => {});
    }
    await writeFile(`${job.file}.part`, bytes);
    await rename(`${job.file}.part`, job.file);
    const meta = {
      prompt: job.prompt,
      seconds: job.seconds,
      influence: job.influence,
      format: ledger.format ?? FORMATS[0],
      credits,
      costHeader: cost !== null,
      redo: job.redo,
      at: new Date().toISOString(),
    };
    await writeFile(job.file.replace(/\.mp3$/, ".json"), JSON.stringify(meta, null, 2) + "\n");
    ledger.entries.push({ id: job.id, credits, redo: job.redo });
    await saveLedger();
    done++;
    console.log(`[${done}/${pending.length}] ${job.id}  ${credits} credits  ${(bytes.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    failed.push(job.id);
    console.log(`${job.id}: failed, ${err.message}`);
  } finally {
    reserved -= est;
  }
}

// Take jobs in cue order. The first one runs alone so its cost is checked early.
const queue = [...pending];
async function step() {
  const job = queue.shift();
  const est = estimate(job.seconds);
  if (spent() + reserved + est > budget) {
    skipped.push(job.id, ...queue.splice(0).map((j) => j.id));
    console.log(`budget ${budget} would be passed at ${job.id}, stopping here`);
    return;
  }
  reserved += est;
  await run(job);
}
async function worker() {
  while (queue.length && !aborted) await step();
}

await step();
if (!aborted) await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`generated ${done}, failed ${failed.length}, not run ${skipped.length}`);
console.log(`ledger ${spent()} credits spent of ${budget}`);
if (failed.length) console.log(`failed: ${failed.join(", ")}`);
if (skipped.length) console.log(`not run: ${skipped.join(", ")}`);
process.exit(aborted || failed.length ? 1 : 0);
