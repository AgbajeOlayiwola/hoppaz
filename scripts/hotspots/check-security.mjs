// ============================================================================
// Hoppaz hotspots: the security review's findings, replayed through the local REST API as signed-in test
// Hoppers (no browser). Each block is the attack that worked before the fixes in supabase/hotspots.sql and
// must now fail:
//
//   1. add_to_crew(a hotspot head's key) put the real profile in your crew list
//   2. the real avatar look was in every head and message, and profiles are readable by everyone
//   3. a one-sided crew row made hotspot_room flag which alias a known person was using
//   4. numbers, links and contact words got through the chat filter
//   5. parallel posts slipped past the 5 in 30 s limit, the duplicate rule and slow mode
//   6. blocking a hotspot alias made the person vanish from the event lists that show their handle
//   7. the Regular badge was readable by anyone, with the handle
//   8. an under 18 birthday could be changed after the refusal
//   9. three throwaway accounts could mute someone who had never posted
//
//   node --no-warnings scripts/hotspots/check-security.mjs
//
// Uses the four test Hoppers of localdb/test_users.env (A to D) and the local database keys of localdb/.status.env,
// both read inside the script and never printed. It changes their rows (messages, visits, reports, mutes, blocks, crew,
// badges, the 18+ flag, the birthday, an avatar, the slow mode of Lekki) and puts every one back. Needs the local
// Supabase in Docker and supabase/hotspots.sql loaded. About a minute. Exit code 1 if any check fails.
// ============================================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALDB = path.resolve(HERE, "../../../localdb");
const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(path.join(LOCALDB, file), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).reverse().map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    })
  );
const users = readEnv("test_users.env");
const keys = readEnv(".status.env");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c", sql], { encoding: "utf8" }).trim();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(keys.API_URL, keys.ANON_KEY, opts);

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};

const WHO = ["A", "B", "C", "D"];
const ids = WHO.map((w) => users[`E2E_${w}_ID`]);
const idList = ids.map((i) => `'${i}'`).join(",");
const SLUG = "lekki";
const hotspotId = psql(`select id from hotspots where slug='${SLUG}'`);
const CHANNEL = `hotspot:${hotspotId}`;
const MARK = `sectest-${Math.random().toString(36).slice(2, 8)}`;
const AVATAR = { hat: MARK, skin: 9 };

// ------------------------------------------------------------------ what is there before, to put back
const before = {
  private: psql(`select coalesce(json_agg(json_build_object('u', user_id, 'a', adult_confirmed_at, 'b', birthday, 'm', under_18_at)), '[]') from profile_private where user_id in (${idList})`),
  avatars: psql(`select coalesce(json_agg(json_build_object('u', id, 'a', avatar)), '[]') from profiles where id in (${idList})`),
  slow: psql(`select slow_seconds||'|'||slow_from||'|'||slow_to||'|'||status from hotspots where slug='${SLUG}'`),
  identities: psql(`select count(*) from room_identities where user_id in (${idList}) and channel='${CHANNEL}'`),
};
const jsonLit = (v) => `'${String(v).replace(/'/g, "''")}'::json`;
const clean = () => {
  psql(`delete from messages where channel='${CHANNEL}' and author_key in (select id from room_identities where user_id in (${idList}))`);
  psql(`delete from hotspot_visits where user_id in (${idList})`);
  psql(`delete from hotspot_mutes where user_id in (${idList})`);
  psql(`delete from reports where kind='hotspot' and (reporter in (${idList}) or target in (${idList}))`);
  psql(`delete from hotspot_days where user_id in (${idList})`);
  psql(`delete from hotspot_quota where user_id in (${idList})`);
  psql(`delete from hotspot_blocks where blocker in (${idList}) or blocked in (${idList})`);
  psql(`delete from blocks where blocker in (${idList}) or blocked in (${idList})`);
  psql(`delete from crew where user_id in (${idList}) or friend_id in (${idList})`);
  psql(`delete from badges where user_id in (${idList}) and key='regular-${SLUG}'`);
};
const restore = () => {
  const steps = [
    clean,
    () => state.checkins.length && psql(`delete from checkins where user_id in (${state.checkins.map((i) => `'${i}'`).join(",")}) and event_id='${state.event}'`),
    () => state.catalog && psql(`delete from badge_catalog where key='regular-${SLUG}'`),
    () => psql(`update profile_private p set adult_confirmed_at = (o->>'a')::timestamptz, birthday = (o->>'b')::date, under_18_at = (o->>'m')::timestamptz from json_array_elements(${jsonLit(before.private)}) o where p.user_id = (o->>'u')::uuid`),
    // a Hopper who had no private row gets no 18+ flag back
    () => psql(`update profile_private set adult_confirmed_at = null, birthday = null, under_18_at = null where user_id in (${idList}) and user_id not in (select (o->>'u')::uuid from json_array_elements(${jsonLit(before.private)}) o)`),
    () => psql(`update profiles p set avatar = case when json_typeof(o->'a') = 'object' then (o->'a')::jsonb end from json_array_elements(${jsonLit(before.avatars)}) o where p.id = (o->>'u')::uuid`),
    () => {
      const [s, f, t, st] = before.slow.split("|");
      psql(`update hotspots set slow_seconds=${s}, slow_from='${f}', slow_to='${t}', status='${st}' where slug='${SLUG}'`);
    },
    () => before.identities === "0" && psql(`delete from room_identities where user_id in (${idList}) and channel='${CHANNEL}'`),
  ];
  // Each step on its own: one that fails must not leave the rest undone.
  for (const step of steps) {
    try {
      step();
    } catch (e) {
      console.log("restore step failed:", String(e.message).split("\n")[0]);
    }
  }
};
const state = { event: null, checkins: [], catalog: false };
let cleaned = false;
const stop = () => {
  if (cleaned) return;
  cleaned = true;
  try {
    restore();
  } catch (e) {
    console.log("restore failed:", e.message);
  }
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

async function login(w) {
  const c = createClient(keys.API_URL, keys.ANON_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email: users[`E2E_${w}_EMAIL`], password: users[`E2E_${w}_PASSWORD`] });
  if (error) throw new Error(`sign in ${w}`);
  return c;
}
const say = async (c, body) => (await c.from("messages").insert({ channel: CHANNEL, body })).error?.message ?? "ok";
const messageCodes = (e) => String(e).replace(/[^a-z_]/g, "");

try {
  clean();
  // all four are adults; nobody has a birthday on file; Lekki is open and its slow mode is off (it is tested on its own below)
  for (const id of ids) {
    psql(`insert into profile_private (user_id, adult_confirmed_at) values ('${id}', now()) on conflict (user_id) do update set adult_confirmed_at = coalesce(profile_private.adult_confirmed_at, now()), birthday = null, under_18_at = null`);
  }
  psql(`update profiles set avatar = ${jsonLit(JSON.stringify(AVATAR))}::jsonb where id = '${ids[0]}'`);
  psql(`update hotspots set status='active', slow_seconds=0 where slug='${SLUG}'`);

  const [A, B, C, D] = await Promise.all(WHO.map(login));
  const enter = async (c) => (await c.rpc("enter_hotspot", { p_slug: SLUG })).data;
  const [ea, eb, ec, ed] = [await enter(A), await enter(B), await enter(C), await enter(D)];
  check("four test Hoppers are in Lekki", [ea, eb, ec, ed].every((e) => e?.ok), [ea, eb, ec, ed].map((e) => e?.ok ?? e?.reason).join(","));
  const roomOf = async (c) => (await c.rpc("hotspot_room", { p_slug: SLUG })).data;

  // ------------------------------------------------------------------ 1. add_to_crew
  const head = (await roomOf(A)).heads.find((h) => h.key === eb.key);
  check("1. A sees B's head and its key", !!head);
  const crewRes = await A.rpc("add_to_crew", { p_key: eb.key });
  check("1. add_to_crew(B's hotspot key) is refused", crewRes.data === "not_met", String(crewRes.data));
  const crewList = await A.from("crew").select("friend:profiles!crew_friend_id_fkey(id,handle,display_name,area,avatar)");
  check("1. A's crew list holds nobody", (crewList.data ?? []).length === 0, `${(crewList.data ?? []).length} rows`);

  // ------------------------------------------------------------------ 2. the real look
  const roomA = await roomOf(B);
  check("2. no head carries a look", roomA.heads.every((h) => h.look === null));
  check("2. A's avatar is nowhere in what B reads of the room", !JSON.stringify(roomA).includes(MARK));
  check("2. a message from A is posted", (await say(A, "hello lekki")) === "ok");
  const read = await B.from("messages").select("*").eq("channel", CHANNEL);
  check("2. and carries no look, handle or avatar", (read.data ?? []).length > 0 && read.data.every((m) => m.author_look === null && m.author_handle === null) && !JSON.stringify(read.data).includes(MARK));

  // ------------------------------------------------------------------ 3. one-sided crew
  const orderBefore = (await roomOf(A)).heads.map((h) => h.key).join(",");
  const crewInsert = await A.from("crew").insert({ user_id: ids[0], friend_id: ids[1] });
  const roomAfter = await roomOf(A);
  check("3. a one-sided crew row (still allowed for the Crew page) changes nothing in the room", roomAfter.heads.map((h) => h.key).join(",") === orderBefore, crewInsert.error ? "insert refused" : "insert allowed");
  check("3. a head is exactly key, alias, look", roomAfter.heads.every((h) => Object.keys(h).sort().join(",") === "alias,key,look"));

  // ------------------------------------------------------------------ 4. the filter
  const refused = {
    "message me on wha​tsapp": "blocked_word",
    "ping me 0801 - 234 - 5678 now": "no_links",
    "tele gram is where I am": "blocked_word",
    "0801/234/5678": "no_links",
    "0801,234,5678": "no_links",
    "0801_234_5678": "no_links",
    "08012​345678": "no_links",
    "０８０１２３４５６７８": "no_links",
    "٠٨٠١٢٣٤٥٦٧٨": "no_links",
    "zero eight zero one two three four five six seven": "no_links",
    "whats­app me": "blocked_word",
    "w.h.a.t.s.a.p.p": "blocked_word",
    "W H A T S A P P": "blocked_word",
    "whаtsapp": "blocked_word",
    dmme: "blocked_word",
    "ig: yabaparty": "blocked_word",
    "yabaparty dot com": "no_links",
    "​": "empty",
    "​ ⁠": "empty",
  };
  for (const [body, want] of Object.entries(refused)) {
    const got = messageCodes(await say(A, body));
    check(`4. refused: ${JSON.stringify(body).slice(0, 44)}`, got === want, got);
  }
  check("4. ordinary talk still goes", (await say(A, "who is outside tonight")) === "ok");

  // ------------------------------------------------------------------ 9. throwaway accounts (B has never posted)
  const reportOn = async (c, ref) => (await c.rpc("report_hotspot", { p_ref: ref, p_reason: "rude" })).data;
  for (const [name, c] of [["A", A], ["C", C], ["D", D]]) {
    const r = await reportOn(c, eb.key);
    check(`9. ${name} reports B's bare head`, r?.ok === true, r?.reason ?? "");
  }
  check("9. three head reports mute nobody: B can still post", (await say(B, "still here")) === "ok");
  check("9. no mute row was made", psql(`select count(*) from hotspot_mutes where user_id='${ids[1]}'`) === "0");
  await sleep(200);
  const first = (await B.from("messages").select("id").eq("channel", CHANNEL).eq("body", "still here").single()).data;
  psql(`delete from reports where kind='hotspot' and reporter in (${idList})`);
  for (const c of [A, C, D]) await reportOn(c, first.id);
  check("9. three reports that cite a message do mute (the rule still works)", psql(`select count(*) from hotspot_mutes where user_id='${ids[1]}' and auto`) === "1");
  check("9. and B is told they are muted", messageCodes(await say(B, "second thing")) === "muted");
  psql(`delete from hotspot_mutes where user_id in (${idList})`);
  psql(`delete from reports where kind='hotspot' and reporter in (${idList})`);

  // ------------------------------------------------------------------ 6. blocking an alias
  state.event = psql("select id from events limit 1");
  for (const id of [ids[0], ids[1]]) {
    if (psql(`select count(*) from checkins where user_id='${id}' and event_id='${state.event}'`) === "0") {
      // triggers off for this one insert: a check-in would otherwise write activity and XP for the test Hopper
      psql(`set session_replication_role = replica; insert into checkins (event_id, user_id) values ('${state.event}', '${id}')`);
      state.checkins.push(id);
    }
  }
  const handles = async () => ((await A.rpc("whos_here", { p_event: state.event })).data ?? []).map((r) => r.handle).sort().join(",");
  const handlesBefore = await handles();
  check("6. A sees B in the event room list", handlesBefore.length > 0, `${handlesBefore.split(",").length} handle(s)`);
  const blocked = await A.rpc("block_person", { p_key: eb.key, p_dm: null, p_label: "x" });
  check("6. A blocks B's hotspot alias", blocked.data === true);
  check("6. B is still in the event list (the block is not global)", (await handles()) === handlesBefore);
  check("6. it is a hotspot block", psql(`select count(*) from hotspot_blocks where blocker='${ids[0]}'`) === "1" && psql(`select count(*) from blocks where blocker='${ids[0]}'`) === "0");
  check("6. A no longer sees B's head", !(await roomOf(A)).heads.some((h) => h.key === eb.key));
  const lifted = await A.rpc("my_blocks");
  await A.rpc("unblock", { p_block: lifted.data?.[0]?.id });
  check("6. unblock lifts it", psql(`select count(*) from hotspot_blocks where blocker='${ids[0]}'`) === "0");

  // ------------------------------------------------------------------ 7. the Regular badge
  state.catalog = psql(`select count(*) from badge_catalog where key='regular-${SLUG}'`) === "0";
  psql(`insert into badge_catalog (key, name, description) values ('regular-${SLUG}', 'Regular at Lekki Phase 1', 'x') on conflict (key) do nothing`);
  psql(`insert into badges (user_id, key) values ('${ids[1]}', 'regular-${SLUG}') on conflict do nothing`);
  const seenByAnon = await anon.from("badges").select("user_id,key").like("key", "regular-%");
  check("7. signed out: no Regular badge can be listed", (seenByAnon.data ?? []).length === 0, `${(seenByAnon.data ?? []).length} rows`);
  const seenByC = await C.from("badges").select("user_id,key").like("key", "regular-%");
  check("7. another Hopper cannot read it either", (seenByC.data ?? []).length === 0);
  const seenByB = await B.from("badges").select("user_id,key").eq("key", `regular-${SLUG}`);
  check("7. its owner can", (seenByB.data ?? []).length === 1);

  // ------------------------------------------------------------------ 8. the birthday
  await D.rpc("set_private_details", { p_birthday: "2012-05-01" });
  const minor = (await D.rpc("confirm_adult")).data;
  check("8. a 2012 birthday is refused", minor?.reason === "under_18", minor?.reason ?? "");
  await D.rpc("set_private_details", { p_birthday: "1990-01-01" });
  const again = (await D.rpc("confirm_adult")).data;
  check("8. changing it to 1990 does not undo the refusal", again?.reason === "under_18", again?.reason ?? "");
  const tryEnter = (await D.rpc("enter_hotspot", { p_slug: SLUG })).data;
  check("8. and entering is still refused", tryEnter?.reason === "need_adult", tryEnter?.reason ?? "");
  psql(`update profile_private set birthday = null, under_18_at = null, adult_confirmed_at = coalesce(adult_confirmed_at, now()) where user_id = '${ids[3]}'`);
  await enter(D);

  // ------------------------------------------------------------------ 5. parallel posts
  const accepted = (results) => results.filter((r) => r === "ok").length;
  const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => say(C, `burst ${i} ${MARK}`)));
  check("5. 60 parallel posts: exactly 5 get through (5 in 30 s)", accepted(burst) === 5, `${accepted(burst)} accepted`);
  const same = await Promise.all(Array.from({ length: 10 }, () => say(D, `the same thing ${MARK}`)));
  check("5. the same text 10 times at once: one gets through", accepted(same) === 1, `${accepted(same)} accepted`);
  psql(`update hotspots set slow_seconds=10, slow_from='00:00', slow_to='24:00' where slug='${SLUG}'`);
  await sleep(11_000);
  const slow = await Promise.all(Array.from({ length: 16 }, (_, i) => say(B, `slow ${i} ${MARK}`)));
  check("5. slow mode on, 16 parallel posts: one gets through", accepted(slow) === 1, `${accepted(slow)} accepted`);
  psql(`update hotspots set slow_seconds=0, slow_from='00:00', slow_to='05:00' where slug='${SLUG}'`);
} catch (e) {
  failed++;
  console.log("FAIL  the run stopped:", e.message);
} finally {
  stop();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL HOTSPOT SECURITY CHECKS PASSED");
process.exit(failed ? 1 : 0);
