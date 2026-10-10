/**
 * Generates the Hoppaz background-music candidates with ElevenLabs Music.
 *
 *   node scripts/music/generate.mjs --dry-run              show what would run and what it would cost
 *   node scripts/music/generate.mjs --wave 1               generate every enabled wave-1 track
 *   node scripts/music/generate.mjs --wave 2               waves 1 and 2 (existing files are skipped)
 *   node scripts/music/generate.mjs --only play_day_afrobeats_bounce
 *   node scripts/music/generate.mjs --regen menu_lofi_highlife [--suffix "extra prompt words"]
 *   node scripts/music/generate.mjs --status               print the credit ledger and exit
 *
 * Options
 *   --max-credits N   hard ceiling for the whole job, probe included (default 3000)
 *   --raw DIR         where raw takes go (default: the scratchpad music-raw folder, outside the repo)
 *   --format F        output format (default: first entry of request.formats_in_order in tracks.json)
 *   --pay-again       generate a track even though the ledger shows it was paid for and only its raw file is missing
 *
 * Rules the script enforces
 *   - Concurrency 1. 429 and 5xx (and network errors) are retried with backoff.
 *   - A file that already exists is skipped, so a rerun never pays twice.
 *   - scripts/music/ledger.json is the credit ledger. The probe spend is in it already. Before every
 *     call the script checks ledger total + estimate against the ceiling and stops if it would pass.
 *   - /v1/music returns no cost header (checked: only song-id), so the charge is read from the
 *     usage endpoint (music credits, before and after) and falls back to 12.5 credits per second.
 *   - The ElevenLabs key is read inside this process and is never printed or written anywhere.
 *
 * Raw takes are saved as lossless 48 kHz 16-bit stereo WAV (pcm_48000 is the best format this key
 * is allowed), so the loop step starts from a clean source and the final 128 kbps MP3 is the first
 * lossy encode.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_RAW_DIR, makeClient, musicCredits, musicDir, parseArgs, readKey, sleep } from "./lib.mjs";

const args = parseArgs();
const ceiling = Number(args.get("max-credits", 3000));
const rawDir = resolve(args.get("raw", process.env.MUSIC_RAW_DIR ?? DEFAULT_RAW_DIR));
const ledgerPath = resolve(musicDir, "ledger.json");
const CREDITS_PER_SECOND = 12.5;

const plan = JSON.parse(await readFile(resolve(musicDir, "tracks.json"), "utf8"));
let ledger;
try {
  ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
} catch {
  ledger = { ceiling, entries: [] };
}
const spent = () => ledger.entries.reduce((a, e) => a + (e.credits || 0), 0);
const saveLedger = () => writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");

if (args.has("status")) {
  console.log(`ledger: ${ledger.entries.length} entries, ${spent()} credits of ${ceiling}`);
  for (const e of ledger.entries) console.log(`  ${String(e.credits).padStart(5)}  ${e.id}${e.note ? "  (" + e.note + ")" : ""}`);
  process.exit(0);
}

const estCredits = (ms) => Math.ceil((ms / 1000) * CREDITS_PER_SECOND);

// Which tracks to run.
const maxWave = Number(args.get("wave", 1));
let todo;
if (args.has("regen")) {
  const id = args.get("regen");
  todo = plan.tracks.filter((t) => t.id === id);
} else if (args.has("only")) {
  const ids = String(args.get("only")).split(",");
  todo = plan.tracks.filter((t) => ids.includes(t.id));
} else {
  todo = plan.tracks.filter((t) => t.enabled && t.wave <= maxWave);
}
if (!todo.length) {
  console.log("nothing to do (check --wave / --only / --regen and the enabled flags in tracks.json)");
  process.exit(0);
}

const formats = args.has("format") ? [args.get("format")] : plan.request.formats_in_order ?? [plan.request.query.output_format];
const wavPath = (id) => resolve(rawDir, `${id}.wav`);
const exists = (p) => stat(p).then(() => true, () => false);

// Plan the run, skipping files that already exist.
const queue = [];
for (const t of todo) {
  const have = (await exists(wavPath(t.id))) || (await exists(resolve(rawDir, `${t.id}.mp3`)));
  if (have && !args.has("regen")) {
    console.log(`skip ${t.id} (raw file exists)`);
    continue;
  }
  // Already paid for but the raw file is gone (the scratch folder was cleared): do not pay for it twice by accident.
  if (!have && !args.has("regen") && !args.has("pay-again") && ledger.entries.some((e) => e.track === t.id)) {
    console.log(`skip ${t.id} (the ledger shows it was already generated and paid for, but its raw take is not in ${rawDir}). Use --regen ${t.id} for a new take on purpose, or --pay-again.`);
    continue;
  }
  queue.push({ t, est: estCredits(t.music_length_ms) });
}
const need = queue.reduce((a, q) => a + q.est, 0);
console.log(`ledger ${spent()} + this run ${need} = ${spent() + need} of ${ceiling} credits`);
if (spent() + need > ceiling) {
  console.log("this run would pass the ceiling, aborting before any call. Trim the queue with --only or raise --max-credits on purpose.");
  process.exit(2);
}
if (args.has("dry-run") || !queue.length) {
  for (const q of queue) console.log(`  would generate ${q.t.id}  ${q.t.seconds} s  ~${q.est} credits`);
  process.exit(0);
}

const key = await readKey();
if (!key) {
  console.log("no ELEVENLABS_API_KEY found in .env.local");
  process.exit(1);
}
const { say, call } = makeClient(key);
await mkdir(rawDir, { recursive: true });

/** One generation with retry. Returns { buf, songId, format } or throws. */
async function generate(track, prompt) {
  let lastErr;
  for (let fi = 0; fi < formats.length; fi++) {
    const format = formats[fi];
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      try {
        res = await call("POST", `/v1/music?output_format=${format}`, {
          body: { ...plan.request.body_fixed, prompt, music_length_ms: track.music_length_ms },
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
      } catch (e) {
        lastErr = `network: ${e?.name ?? "error"}`;
        const wait = 4000 * 2 ** attempt;
        say(`  ${track.id}: ${lastErr}, retry in ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const headers = Object.fromEntries([...res.headers.entries()].filter(([k]) => !/^(set-cookie|authorization)$/i.test(k)));
        return { buf, format, headers };
      }
      const body = (await res.text()).slice(0, 400);
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 4000 * 2 ** attempt;
        lastErr = `HTTP ${res.status}`;
        say(`  ${track.id}: HTTP ${res.status}, retry in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/5)`);
        await sleep(wait);
        continue;
      }
      // Non-retryable. If it is about the output format, fall to the next format; otherwise stop.
      lastErr = `HTTP ${res.status} ${body}`;
      if (/output.?format|tier|plan|subscription|upgrade/i.test(body) && fi < formats.length - 1) {
        say(`  ${track.id}: format ${format} refused (HTTP ${res.status}), trying ${formats[fi + 1]}`);
        break;
      }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr ?? "generation failed");
}

function wrapWav(pcm, sampleRate, channels) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const baseline = await musicCredits(call);
say(`account music credits, last 24 h: ${baseline ?? "unreadable"}`);

for (const { t, est } of queue) {
  if (spent() + est > ceiling) {
    say(`stop: ${t.id} would take the ledger from ${spent()} to ${spent() + est}, past ${ceiling}`);
    break;
  }
  let prompt = t.prompt;
  let take = 1;
  if (args.has("regen")) {
    const suffix = args.get("suffix", t.regen_suffix ?? "");
    if (suffix) prompt = `${prompt} ${suffix}`;
    if (await exists(wavPath(t.id))) {
      while (await exists(resolve(rawDir, `${t.id}.take${take}.wav`))) take++;
      await rename(wavPath(t.id), resolve(rawDir, `${t.id}.take${take}.wav`));
      take++;
    }
  }
  // The take number follows the ledger too, so a regen after a cleared scratch folder does not reuse "take 1".
  take = Math.max(take, 1 + Math.max(0, ...ledger.entries.filter((e) => e.track === t.id).map((e) => e.take || 1)));
  say(`generating ${t.id}  ${t.seconds} s  ~${est} credits  (take ${take})`);
  const before = await musicCredits(call);
  const t0 = Date.now();
  let out;
  try {
    out = await generate(t, prompt);
  } catch (e) {
    say(`  FAILED ${t.id}: ${e.message}`);
    // A failed call is normally free, but check, and ledger whatever the account shows.
    await sleep(6000);
    const after = await musicCredits(call);
    const lost = before != null && after != null ? Math.max(0, after - before) : 0;
    if (lost > 0) {
      ledger.entries.push({ id: `${t.id} (failed call)`, credits: lost, note: "charged on a failed call", ts: new Date().toISOString() });
      await saveLedger();
      say(`  account shows ${lost} credits charged for the failed call, ledgered`);
    }
    process.exitCode = 1;
    break;
  }
  const took = ((Date.now() - t0) / 1000).toFixed(0);
  const isPcm = out.format.startsWith("pcm_");
  const file = isPcm ? wavPath(t.id) : resolve(rawDir, `${t.id}.mp3`);
  await writeFile(file, isPcm ? wrapWav(out.buf, Number(out.format.split("_")[1]), 2) : out.buf);

  // Charge: a cost header if the API ever sends one, else the usage endpoint, else the estimate.
  const headerCost = Object.entries(out.headers).find(([k]) => /cost|credit|character/i.test(k));
  let measured = null;
  for (let i = 0; i < 6 && before != null; i++) {
    await sleep(i === 0 ? 4000 : 5000);
    const after = await musicCredits(call);
    if (after != null && after > before) {
      measured = after - before;
      break;
    }
  }
  let credits = est;
  let how = "estimate (12.5 per second)";
  if (headerCost && Number.isFinite(Number(headerCost[1]))) {
    credits = Number(headerCost[1]);
    how = `header ${headerCost[0]}`;
  } else if (measured != null) {
    if (measured <= est * 3) {
      credits = Math.max(est, measured);
      how = measured === est ? "usage endpoint (matches estimate)" : `usage endpoint (${measured}) vs estimate ${est}, larger kept`;
    } else {
      how = `estimate; usage moved by ${measured}, far above the estimate, so other spend on the account is suspected`;
    }
  } else {
    how = "estimate (usage endpoint showed no change within 29 s)";
  }
  ledger.entries.push({
    id: `${t.id}${take > 1 ? ` take ${take}` : ""}`,
    track: t.id,
    take,
    prompt_suffix: prompt !== t.prompt ? prompt.slice(t.prompt.length).trim() : undefined,
    credits,
    est,
    measured,
    how,
    format: out.format,
    bytes: out.buf.length,
    song_id: out.headers["song-id"] ?? null,
    seconds_requested: t.seconds,
    ts: new Date().toISOString(),
  });
  ledger.ceiling = ceiling;
  await saveLedger();
  say(`  done in ${took}s: ${out.buf.length} bytes ${out.format} -> ${file}`);
  say(`  charged ${credits} credits via ${how}. Ledger ${spent()} of ${ceiling}`);
  if (measured != null && measured > est * 1.25) {
    say("  usage moved more than expected, stopping so the budget can be checked by hand");
    process.exitCode = 3;
    break;
  }
}
say(`ledger total ${spent()} of ${ceiling}`);
