// ============================================================================
// Hoppaz hotspots: checks the admin desk's hotspot handlers (src/app/api/admin/game/hotspots.ts) against the
// local Supabase in Docker, with no browser and no staff token: it runs the handlers the route calls, with the
// local service key.
//
//   node scripts/hotspots/check-admin.mjs
//
// Reads the local database keys from localdb/.status.env (private) and never prints them. Needs
// supabase/hotspot_zones.sql and supabase/hotspots.sql loaded. It changes rooms and the word list and puts
// every one back; exit code 1 if any check fails.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(HERE, "../../../localdb/.status.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  })
);
const sb = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { hotspotsData, hotspotAction } = await import("../../src/app/api/admin/game/hotspots.ts");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};
const act = (action, body = {}) => hotspotAction(sb, action, body);
const room = async (slug) => (await hotspotsData(sb)).rooms.find((r) => r.slug === slug);

const before = await hotspotsData(sb);
// Opening a room stamps opened_at once and for good; note it so the test can put it back.
const openedAt = Object.fromEntries(((await sb.from("hotspots").select("slug,opened_at")).data ?? []).map((r) => [r.slug, r.opened_at]));
const original = Object.fromEntries(before.rooms.map((r) => [r.slug, r]));
try {
  check("reads 13 rooms and no error", before.rooms.length === 13 && !before.error, `${before.rooms.length} rooms`);
  check("rooms carry the place name, wave and status", original.yaba?.place === "Jibowu" && original.yaba?.wave === 1 && ["open", "paused"].includes(original.yaba?.status));
  check("reads the word list and the lists", before.words.includes("whatsapp") && Array.isArray(before.reports) && Array.isArray(before.mutes), `${before.words.length} words`);

  check("unknown action returns null (the route carries on)", (await act("spawn_now")) === null);
  check("status: a bad status is a 400", (await act("hotspot_status", { slug: "yaba", status: "sleeping" }))?.status === 400);
  check("status: a bad slug is a 400", (await act("hotspot_status", { slug: "Not A Slug!", status: "open" }))?.status === 400);
  check("status: an unknown slug is a 400 with the database's reason", (await act("hotspot_status", { slug: "nowhere", status: "open" }))?.body.error === "Hotspot not found");

  const paused = await act("hotspot_status", { slug: "ikeja", status: "paused" });
  check("pause a room", paused?.status === 200 && (await room("ikeja")).status === "paused");
  const reopened = await act("hotspot_status", { slug: "ikeja", status: "open" });
  check("open it again", reopened?.status === 200 && (await room("ikeja")).status === "open");

  // Open a wave: planned rooms open, a paused room of the same wave stays paused.
  const wave2 = before.rooms.filter((r) => r.wave === 2);
  await act("hotspot_status", { slug: wave2[0].slug, status: "paused" });
  const opened = await act("hotspot_open_wave", { wave: 2 });
  const planned = wave2.filter((r) => r.status === "planned").length;
  const after = await hotspotsData(sb);
  check("open a wave opens its planned rooms", opened?.status === 200 && opened.body.opened === planned - 1, `opened ${opened?.body.opened}`);
  check("a paused room stays paused through the wave", after.rooms.find((r) => r.slug === wave2[0].slug).status === "paused");
  check("a bad wave is a 400", (await act("hotspot_open_wave", { wave: 0 }))?.status === 400);

  const slow = await act("hotspot_slow", { slug: "yaba", seconds: 15, from: "01:00", to: "04:30" });
  const y = await room("yaba");
  check("slow mode saves seconds and window", slow?.status === 200 && y.slow_seconds === 15 && y.slow_from === "01:00" && y.slow_to === "04:30");
  check("slow mode: 121 seconds is a 400", (await act("hotspot_slow", { slug: "yaba", seconds: 121, from: "00:00", to: "05:00" }))?.status === 400);
  check("slow mode: a bad time is a 400", (await act("hotspot_slow", { slug: "yaba", seconds: 10, from: "25:00", to: "05:00" }))?.status === 400);

  check("mute: a key that is not a uuid is a 400", (await act("hotspot_mute", { key: "nope", hours: 1 }))?.status === 400);
  check("mute: zero hours is a 400", (await act("hotspot_mute", { key: "00000000-0000-4000-8000-000000000000", hours: 0 }))?.status === 400);
  check("mute: a key that is not a hotspot alias is a 400", (await act("hotspot_mute", { key: "00000000-0000-4000-8000-000000000000", hours: 1 }))?.body.error === "That key is not a hotspot alias");
  check("unmute: a missing mute is a 404", (await act("hotspot_unmute", { id: "00000000-0000-4000-8000-000000000000" }))?.status === 404);

  check("clear: nothing to clear is fine", (await act("hotspot_clear", { slug: "yaba", minutes: 1 }))?.body.ok === true);
  check("clear: 0 minutes is a 400", (await act("hotspot_clear", { slug: "yaba", minutes: 0 }))?.status === 400);

  const word = "zzcheckword";
  check("word: add", (await act("hotspot_word_add", { word }))?.status === 200 && (await hotspotsData(sb)).words.includes(word));
  check("word: one letter is a 400", (await act("hotspot_word_add", { word: "a" }))?.status === 400);
  check("word: remove", (await act("hotspot_word_remove", { word }))?.status === 200 && !(await hotspotsData(sb)).words.includes(word));
} finally {
  // Put every room back as it was.
  const st = { open: "open", planned: "planned", paused: "paused" };
  for (const r of Object.values(original)) {
    await act("hotspot_status", { slug: r.slug, status: st[r.status] });
    await act("hotspot_slow", { slug: r.slug, seconds: r.slow_seconds, from: r.slow_from || "00:00", to: r.slow_to || "05:00" });
  }
  await act("hotspot_word_remove", { word: "zzcheckword" });
  for (const [slug, at] of Object.entries(openedAt)) await sb.from("hotspots").update({ opened_at: at }).eq("slug", slug);
  const now = await hotspotsData(sb);
  const same = now.rooms.every((r) => r.status === original[r.slug].status && r.slow_seconds === original[r.slug].slow_seconds && r.slow_from === original[r.slug].slow_from && r.slow_to === original[r.slug].slow_to);
  check("every room is back as it was", same);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL ADMIN HOTSPOT CHECKS PASSED");
process.exit(failed ? 1 : 0);
