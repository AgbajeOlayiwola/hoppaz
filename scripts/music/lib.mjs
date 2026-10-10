/**
 * Shared helpers for the Hoppaz music scripts (generate.mjs, loop.mjs, formats.mjs).
 *
 * The ElevenLabs key is read from .env.local inside this process only. It is never
 * printed, logged, put on a command line or written to a file: every string that
 * leaves a script goes through redact() first.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const musicDir = resolve(root, "scripts/music");
export const tryDir = resolve(root, "public/music/try");
export const API = "https://api.elevenlabs.io";

/** Raw takes live outside the repo. Override with MUSIC_RAW_DIR or --raw. */
export const DEFAULT_RAW_DIR =
  "/private/tmp/claude-501/-Users-gg-Library-Application-Support-Claude-scratch-workspaces-adea8d09-9d8f-43fd-ac95-9dc4a426fe47-b01c9569-7f8c-40d0-bdff-f8d756c78598-scratch-2026-10-07-7f84b2/c23dd8b9-a66d-45cb-8b7c-0472937608f3/scratchpad/music-raw";

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      opts[name] = next;
      i++;
    } else flags.add(name);
  }
  return { flags, opts, has: (n) => flags.has(n) || n in opts, get: (n, d) => opts[n] ?? d };
}

export async function readKey() {
  let text;
  try {
    text = await readFile(resolve(root, ".env.local"), "utf8");
  } catch {
    return "";
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

/** Builds { say, redact, call } bound to one key. */
export function makeClient(key) {
  const redact = (s) => (key ? String(s).split(key).join("[KEY]") : String(s));
  const say = (...a) => console.log(redact(a.join(" ")));
  async function call(method, path, { body, signal } = {}) {
    return fetch(API + path, {
      method,
      headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  }
  return { say, redact, call };
}

/**
 * Music credits spent on the whole account in the last `hours` hours, read from the
 * usage endpoint (needs no user_read). Returns null when the endpoint is refused.
 */
export async function musicCredits(call, hours = 24) {
  const now = Date.now();
  const start = now - hours * 3600 * 1000;
  const qs = new URLSearchParams({
    start_unix: String(start),
    end_unix: String(now + 3600 * 1000),
    aggregation_interval: "cumulative",
    breakdown_type: "product_type",
    metric: "credits",
  });
  try {
    const res = await call("GET", `/v1/usage/character-stats?${qs}`);
    if (!res.ok) return null;
    const j = await res.json();
    let total = 0;
    for (const [label, vals] of Object.entries(j.usage ?? {})) {
      if (/music/i.test(label)) total += vals.reduce((a, b) => a + (Number(b) || 0), 0);
    }
    return total;
  } catch {
    return null;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
