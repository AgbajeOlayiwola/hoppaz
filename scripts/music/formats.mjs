/**
 * Which output formats does this key accept for /v1/music?
 *
 *   node scripts/music/formats.mjs            free: invalid-length requests only, nothing is generated
 *   node scripts/music/formats.mjs --real F   one real 3 s generation in format F (about 38 credits)
 *
 * The free pass sends music_length_ms=1000 (below the 3000 minimum). A format the plan
 * cannot use may be refused before the length check; one that passes shows the length 422.
 * That ordering is not documented, so the free pass is a hint and --real is the proof.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_RAW_DIR, makeClient, parseArgs, readKey } from "./lib.mjs";

const run = promisify(execFile);
const args = parseArgs();
const key = await readKey();
if (!key) {
  console.log("no ELEVENLABS_API_KEY found in .env.local");
  process.exit(0);
}
const { say, call } = makeClient(key);
const rawDir = resolve(args.get("raw", process.env.MUSIC_RAW_DIR ?? DEFAULT_RAW_DIR));

const FORMATS = [
  "pcm_48000", "pcm_44100", "mp3_48000_320", "mp3_48000_240", "mp3_48000_192", "mp3_44100_192",
  "mp3_48000_128", "mp3_44100_128", "opus_48000_192",
];

if (args.has("real")) {
  const fmt = args.get("real");
  if (!FORMATS.includes(fmt)) {
    say("unknown format", fmt);
    process.exit(1);
  }
  const res = await call("POST", `/v1/music?output_format=${fmt}`, {
    body: {
      prompt: "Instrumental only, no vocals. Afrobeats, 112 BPM, D major. Talking drum and agogo bell, warm bass, steady groove.",
      music_length_ms: 3000,
      force_instrumental: true,
      model_id: "music_v2_5",
    },
  });
  say(`real 3 s call in ${fmt}: HTTP ${res.status}`);
  const names = [...res.headers.keys()].filter((k) => !/^(set-cookie|authorization)$/i.test(k));
  say("  response header names:", names.join(", "));
  if (!res.ok) {
    say("  body:", (await res.text()).slice(0, 400));
    process.exit(0);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(rawDir, { recursive: true });
  const ext = fmt.split("_")[0] === "pcm" ? "pcm" : fmt.split("_")[0];
  const out = resolve(rawDir, `format-${fmt}.${ext}`);
  await writeFile(out, buf);
  say("  saved", out, buf.length, "bytes");
  if (ext !== "pcm") {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,bit_rate:stream=sample_rate,channels", "-of", "default=nw=1", out]);
    say("  ffprobe:", stdout.trim().replace(/\n/g, " | "));
  }
  process.exit(0);
}

for (const fmt of FORMATS) {
  const res = await call("POST", `/v1/music?output_format=${fmt}`, {
    body: { prompt: "probe", music_length_ms: 1000, model_id: "music_v2_5", force_instrumental: true },
  });
  const text = await res.text();
  let msg = text.slice(0, 140);
  try {
    const d = JSON.parse(text).detail;
    msg = Array.isArray(d) ? d.map((x) => x.msg ?? JSON.stringify(x)).join("; ").slice(0, 160) : (d?.message ?? JSON.stringify(d)).slice(0, 160);
  } catch {}
  say(`${fmt.padEnd(14)} HTTP ${res.status}  ${msg}`);
}
