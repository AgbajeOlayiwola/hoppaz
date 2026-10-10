/**
 * Probes ElevenLabs Music access and measures what a generation costs.
 * The key is read from .env.local inside this process and is never printed,
 * logged, put on a command line or written to a file. Every string that is
 * printed is passed through redact() first.
 *
 *   node scripts/music/probe.mjs                 validation probe + credit position only (free)
 *   node scripts/music/probe.mjs --real          also one real 3 s instrumental generation
 *   node scripts/music/probe.mjs --real --ms 10000   real generation of a chosen length
 *   node scripts/music/probe.mjs --real --model music_v2   real generation on another model
 *   node scripts/music/probe.mjs --usage         credits by model and by product, last 24 h (read only)
 *   node scripts/music/probe.mjs --raw DIR       where the probe mp3 goes (outside the repo)
 *
 * Step 1  POST /v1/music with a body that must fail validation (music_length_ms below the
 *         3000 ms minimum). 422 means the key authenticates; 401 shows the reason.
 * Step 2  GET /v1/user/subscription for tier and credits (needs user_read; skipped if refused).
 * Step 3  (--real) the shortest allowed real call, then read every response header,
 *         look for a cost header, and diff the subscription position before and after.
 *         If the account is also being spent by another job in the same minute the
 *         subscription diff can include that spend, so the cost header wins when present.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const API = "https://api.elevenlabs.io";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const rawDir = resolve(opt("raw") ?? process.env.MUSIC_RAW_DIR ?? resolve(tmpdir(), "hoppaz-music-raw"));
const inRepo = relative(root, rawDir);
if (!inRepo.startsWith("..") && !isAbsolute(inRepo)) {
  console.log("raw folder must be outside the repo, pass --raw or set MUSIC_RAW_DIR");
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

const key = await readKey().catch(() => "");
if (!key) {
  console.log("no ELEVENLABS_API_KEY found in .env.local");
  process.exit(0);
}
const redact = (s) => String(s).split(key).join("[KEY]");
const say = (...a) => console.log(redact(a.join(" ")));

async function call(method, path, { body, headers } = {}) {
  try {
    return await fetch(API + path, {
      method,
      headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    say("network error: could not reach api.elevenlabs.io");
    process.exit(0);
  }
}

async function position() {
  const res = await call("GET", "/v1/user/subscription");
  if (!res.ok) return { ok: false, status: res.status, detail: (await res.text()).slice(0, 300) };
  const j = await res.json();
  return {
    ok: true,
    tier: j.tier,
    status: j.status,
    used: j.character_count,
    limit: j.character_limit,
    resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null,
  };
}

// --usage: read-only look at every endpoint that could expose spend, for keys that
// cannot read /v1/user/subscription. Prints status codes and a few numeric fields only.
if (has("usage")) {
  const now = Math.floor(Date.now() / 1000);
  const tries = [
    ["history", "/v1/history?page_size=5"],
    ["usage by model", `/v1/usage/character-stats?start_unix=${(now - 86400) * 1000}&end_unix=${(now + 3600) * 1000}&aggregation_interval=cumulative&breakdown_type=model&metric=credits`],
    ["usage by product", `/v1/usage/character-stats?start_unix=${(now - 86400) * 1000}&end_unix=${(now + 3600) * 1000}&aggregation_interval=cumulative&breakdown_type=product_type&metric=credits`],
    ["usage by product hourly", `/v1/usage/character-stats?start_unix=${(now - 86400) * 1000}&end_unix=${(now + 3600) * 1000}&aggregation_interval=hour&breakdown_type=product_type&metric=credits`],
    ["user", "/v1/user"],
    ["workspace usage", `/v1/workspace/analytics/query/usage-by-product-over-time`],
  ];
  for (const [name, path] of tries) {
    const res = await call("GET", path);
    const text = await res.text();
    say(`usage ${name}: HTTP ${res.status}`);
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        if (name === "history") {
          for (const h of j.history ?? []) {
            say("  ", JSON.stringify({ t: h.date_unix, model: h.model_id, from: h.character_count_change_from, to: h.character_count_change_to, src: h.source }));
          }
        } else if (name === "usage by product hourly") {
          const times = j.time ?? j.times ?? [];
          for (const [label, vals] of Object.entries(j.usage ?? {})) {
            if (!/music/i.test(label)) continue;
            vals.forEach((v, i) => {
              if (Number(v) > 0) say("  ", label, new Date(Number(times[i]) < 1e12 ? Number(times[i]) * 1000 : Number(times[i])).toISOString(), "=", v);
            });
          }
        } else if (name.startsWith("usage by")) {
          for (const [label, vals] of Object.entries(j.usage ?? {})) {
            say("  ", label, "=", vals.reduce((a, b) => a + (Number(b) || 0), 0), "credits (last 24h)");
          }
        } else say("  ok, keys:", Object.keys(j).join(","));
      } catch {
        say("  non-json body");
      }
    } else {
      try {
        say("  ", JSON.parse(text).detail?.message ?? text.slice(0, 160));
      } catch {
        say("  ", text.slice(0, 160));
      }
    }
  }
  process.exit(0);
}

// Step 1: validation probe. No generation can happen, so it costs nothing.
{
  const res = await call("POST", "/v1/music?output_format=mp3_44100_128", {
    body: {
      prompt: "probe",
      music_length_ms: 1000,
      model_id: "music_v2_5",
      force_instrumental: true,
      ...(opt("mode") ? { generation_mode: opt("mode") } : {}),
    },
  });
  const text = await res.text();
  say("step 1 validation probe: HTTP", res.status);
  say("  body:", text.slice(0, 500));
  if (res.status === 401 || res.status === 403) {
    say("RESULT: no music access with this key (", res.status, "). Stopping.");
    process.exit(0);
  }
}

// Step 2: credit position before.
const before = await position();
say("step 2 subscription before:", JSON.stringify(before));

if (!has("real")) {
  say("dry run done, pass --real for one real generation");
  process.exit(0);
}

// Step 3: shortest allowed real generation.
const ms = Number(opt("ms") ?? 3000);
if (!(ms >= 3000 && ms <= 30000)) {
  say("probe length must be 3000 to 30000 ms");
  process.exit(1);
}
const model = opt("model") ?? "music_v2_5";
const body = {
  prompt:
    "Instrumental only, no vocals. Afrobeats, 112 BPM, D major. Talking drum and agogo bell, warm bass, steady groove.",
  music_length_ms: ms,
  force_instrumental: true,
  model_id: model,
};
const t0 = Date.now();
const res = await call("POST", "/v1/music?output_format=mp3_44100_128", { body });
const took = ((Date.now() - t0) / 1000).toFixed(1);
say("step 3 real call: HTTP", res.status, "in", took, "s");
const hdr = Object.fromEntries([...res.headers.entries()].filter(([k]) => !/^(set-cookie|authorization)$/i.test(k)));
say("  response headers:", JSON.stringify(hdr));
if (!res.ok) {
  const text = await res.text();
  say("  body:", text.slice(0, 600));
  if (res.status === 401 || res.status === 403) say("RESULT: no music access with this key. Stopping.");
  process.exit(0);
}
const buf = Buffer.from(await res.arrayBuffer());
await mkdir(rawDir, { recursive: true });
const out = resolve(rawDir, `probe-${model}-${ms / 1000}s.mp3`);
await writeFile(out, buf);
say("  saved", out, buf.length, "bytes");

const costHeader = Object.entries(hdr).find(([k]) => /cost|credit|character/i.test(k));
say("  cost header:", costHeader ? `${costHeader[0]} = ${costHeader[1]}` : "none present");

try {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=sample_rate,channels,bit_rate",
    "-of", "default=nw=1", out,
  ]);
  say("  ffprobe:", stdout.trim().replace(/\n/g, " | "));
} catch {
  say("  ffprobe unavailable");
}

// Credit position after. Give the counter a moment, then read twice.
await new Promise((r) => setTimeout(r, 4000));
const after = await position();
say("step 4 subscription after:", JSON.stringify(after));
if (before.ok && after.ok) {
  const delta = after.used - before.used;
  say(`  credit delta: ${delta} for ${ms / 1000} s of audio (${(delta / (ms / 1000)).toFixed(1)} per second)`);
  say("  remaining:", after.limit - after.used);
}
if (costHeader) {
  const c = Number(costHeader[1]);
  if (Number.isFinite(c)) say(`  header cost: ${c} credits (${(c / (ms / 1000)).toFixed(1)} per second)`);
}
