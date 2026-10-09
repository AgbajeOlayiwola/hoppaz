/**
 * Prints the ElevenLabs credit position: character_count, character_limit, tier.
 * Nothing else. The key is read from .env.local inside this process and is never
 * printed, logged or passed on a command line. If the key cannot read the
 * subscription (restricted key, 401), it says so and exits 0 so the planner can
 * fall back to a conservative estimate.
 *
 *   node scripts/sfx/credits.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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

let res;
try {
  res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
    headers: { "xi-api-key": key },
  });
} catch {
  console.log("network error: could not reach api.elevenlabs.io");
  process.exit(0);
}

if (res.status === 401 || res.status === 403) {
  console.log(`subscription not readable with this key (HTTP ${res.status}, restricted key). Use a conservative estimate.`);
  process.exit(0);
}
if (!res.ok) {
  console.log(`subscription read failed (HTTP ${res.status}). Use a conservative estimate.`);
  process.exit(0);
}

const s = await res.json().catch(() => ({}));
const used = Number(s.character_count);
const limit = Number(s.character_limit);
console.log(`character_count: ${Number.isFinite(used) ? used : "unknown"}`);
console.log(`character_limit: ${Number.isFinite(limit) ? limit : "unknown"}`);
console.log(`tier: ${typeof s.tier === "string" ? s.tier : "unknown"}`);
if (Number.isFinite(used) && Number.isFinite(limit)) console.log(`credits_remaining: ${Math.max(0, limit - used)}`);
