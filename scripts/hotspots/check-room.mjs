// ============================================================================
// Hoppaz hotspots: headless check of the room screen (src/components/play/hotspots/HotspotRoom.tsx) at
// 390x844, with two test Hoppers in two isolated browser contexts of ONE Chrome.
//
//   node --no-warnings scripts/hotspots/check-room.mjs
//   SHOTS=<dir> to keep the screenshots somewhere (default: a folder in the temp dir)
//   APP=http://localhost:3100 to point at another dev server
//
// What it does, in order: B opens the room as a guest (the account gate), logs in from the sign-up sheet and
// walks in; A logs in on /account, meets the 18+ sheet and walks in. They see each other's heads (no real
// names), chat both ways live, B reports A's message (it lands in the admin handlers' report list), staff mute
// A (A is told, B hears nothing), the mute is lifted, the rate limit and the no-links rule answer in plain
// words, slow mode is forced on and shown, A's stay is back-dated so the +10 XP and the Regular badge moment
// land, and B leaves. It reads the test Hoppers from localdb/test_users.env and the local database keys from
// localdb/.status.env INSIDE the script and never prints them. It does not read .env.local, so the admin
// desk's own token door is not exercised here: the staff steps run the same handlers the route calls
// (src/app/api/admin/game/hotspots.ts) with the local service key.
//
// LOAD RULE: ONE headless Chrome, killed at the end (also on an error or Ctrl-C). Never run two at once.
// It changes a few rows (messages, visits, mutes, reports, two Hoppers' 18+ flag and XP) and puts them back.
// Needs the local Supabase in Docker, supabase/hotspots.sql loaded, and the dev server on APP.
// Nothing here sends or reads a position. Exit code 1 if any check fails.
// ============================================================================
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALDB = path.resolve(HERE, "../../../localdb");
const APP = process.env.APP || "http://localhost:3100";
const SHOTS = path.resolve(process.env.SHOTS || path.join(os.tmpdir(), "hoppaz-room-shots"));
const PORT = 9473;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "hoppaz-room-chrome-"));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(path.join(LOCALDB, file), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).reverse().map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    })
  );
const users = readEnv("test_users.env");
const keys = readEnv(".status.env");
const A = { id: users.E2E_A_ID, email: users.E2E_A_EMAIL, password: users.E2E_A_PASSWORD, name: "A" };
const B = { id: users.E2E_B_ID, email: users.E2E_B_EMAIL, password: users.E2E_B_PASSWORD, name: "B" };
const sb = createClient(keys.API_URL, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { hotspotsData, hotspotAction } = await import("../../src/app/api/admin/game/hotspots.ts");

/** An expression: does the page say this? Case-insensitive, because the CSS shouts some labels. */
const has = (text) => `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;
const psql = (sql) => execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c", sql], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};

// ------------------------------------------------------------------ the database, before
const SLUG = "yaba";
const hotspotId = psql(`select id from hotspots where slug='${SLUG}'`);
const CHANNEL = `hotspot:${hotspotId}`;
const ids = `'${A.id}','${B.id}'`;
const orig = {
  adult: Object.fromEntries(psql(`select user_id||'|'||coalesce(adult_confirmed_at::text,'') from profile_private where user_id in (${ids})`).split("\n").filter(Boolean).map((r) => r.split("|"))),
  xp: psql(`select xp from profiles where id='${A.id}'`),
  catalog: psql(`select count(*) from badge_catalog where key='regular-${SLUG}'`),
  slow: psql(`select slow_seconds||'|'||slow_from||'|'||slow_to from hotspots where slug='${SLUG}'`),
  status: psql(`select status from hotspots where slug='${SLUG}'`),
  identities: psql(`select count(*) from room_identities where user_id in (${ids}) and channel='${CHANNEL}'`),
};
const cleanRows = () => {
  psql(`delete from messages where channel='${CHANNEL}' and author_key in (select id from room_identities where user_id in (${ids}))`);
  psql(`delete from hotspot_visits where user_id in (${ids})`);
  psql(`delete from hotspot_mutes where user_id in (${ids})`);
  psql(`delete from reports where reporter in (${ids}) and kind='hotspot'`);
  psql(`delete from hotspot_days where user_id in (${ids})`);
  psql(`delete from hotspot_quota where user_id in (${ids})`);
  psql(`delete from badges where user_id in (${ids}) and key='regular-${SLUG}'`);
};
const restoreRows = () => {
  cleanRows();
  for (const u of [A, B]) psql(`update profile_private set adult_confirmed_at=${orig.adult[u.id] ? `'${orig.adult[u.id]}'` : "null"} where user_id='${u.id}'`);
  psql(`update profiles set xp=${orig.xp} where id='${A.id}'`);
  if (orig.catalog === "0") psql(`delete from badge_catalog where key='regular-${SLUG}'`);
  if (orig.identities === "0") psql(`delete from room_identities where user_id in (${ids}) and channel='${CHANNEL}'`);
  const [s, f, t] = orig.slow.split("|");
  psql(`update hotspots set slow_seconds=${s}, slow_from='${f}', slow_to='${t}', status='${orig.status}' where slug='${SLUG}'`);
};

// ------------------------------------------------------------------ Chrome
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--disable-background-networking",
  "--window-size=390,844", "about:blank",
], { stdio: "ignore" });
let ws;
const pages = new Map(); // sessionId -> page
let cleaned = false;
const stop = () => {
  if (cleaned) return;
  cleaned = true;
  try { ws?.close(); } catch {}
  try { chrome.kill("SIGTERM"); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  try { restoreRows(); } catch (e) { console.log("restore failed:", e.message); }
};
process.on("exit", stop);
setTimeout(() => { console.log("watchdog: the run took longer than 9 minutes"); process.exit(1); }, 9 * 60_000).unref();
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

try {
  cleanRows();
  check("no rows left over from an earlier run", psql(`select count(*) from hotspot_visits where user_id in (${ids})`) === "0");
  // A must meet the 18+ sheet; B has said yes before.
  for (const u of [A, B]) {
    psql(`insert into profile_private (user_id, adult_confirmed_at) values ('${u.id}', ${u === A ? "null" : "now()"}) on conflict (user_id) do update set adult_confirmed_at=${u === A ? "null" : "coalesce(profile_private.adult_confirmed_at, now())"}`);
  }
  psql(`update hotspots set status='active', slow_seconds=10, slow_from='00:00', slow_to='05:00' where slug='${SLUG}'`);

  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch {}
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("Chrome did not come up");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  let nid = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
    const p = pages.get(d.sessionId);
    if (!p) return;
    if (d.method === "Runtime.exceptionThrown") p.errors.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") p.logs.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
    else if (d.method === "Network.requestWillBeSent") {
      const u = d.params.request.url;
      const hit = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(u);
      if (hit) {
        let body = {};
        try { body = JSON.parse(d.params.request.postData || "{}"); } catch {}
        if (d.params.request.method === "POST") p.rpcs.push({ name: hit[1], keys: Object.keys(body), at: Date.now() });
      }
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++nid;
    pending.set(id, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const newPage = async (name) => {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const p = { name, sid: sessionId, errors: [], logs: [], rpcs: [] };
    pages.set(sessionId, p);
    const cmd = (m, params) => send(m, params, sessionId);
    p.ev = async (expression) => {
      const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
      return r.result.value;
    };
    p.wait = async (expression, ms = 20000, what = expression) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        try { if (await p.ev(expression)) return Date.now() - t0; } catch {}
        await sleep(150);
      }
      throw new Error(`${name}: timed out after ${ms} ms waiting for ${what}`);
    };
    p.has = (text) => p.ev(has(text));
    p.goto = async (url) => { await cmd("Page.navigate", { url }); await sleep(400); };
    p.shot = async (file) => {
      await sleep(450); // let a fade or a stamp finish
      const r = await cmd("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.data, "base64"));
      console.log("   shot", file);
    };
    // Click the first element matching a selector whose text matches the pattern.
    p.click = async (selector, pattern = ".") => {
      const pt = await p.ev(`(()=>{const re=new RegExp(${JSON.stringify(pattern)},'i');const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>re.test((e.innerText||e.getAttribute('aria-label')||'')));if(!el)return null;el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
      if (!pt) throw new Error(`${name}: nothing to click for ${selector} /${pattern}/`);
      await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: pt[0], y: pt[1], button: "left", clickCount: 1 });
      await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt[0], y: pt[1], button: "left", clickCount: 1 });
    };
    p.type = async (selector, text) => {
      await p.ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select&&el.select();return true})()`);
      await cmd("Input.insertText", { text });
    };
    await send("Target.activateTarget", { targetId });
    // The install nudge that follows a first log-in is the app's own business; this run is about the room.
    await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("hoppaz.install",JSON.stringify({stage:2,done:true}))}catch(e){}` });
    await cmd("Runtime.enable"); await cmd("Page.enable"); await cmd("Network.enable");
    await cmd("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cmd("Emulation.setTouchEmulationEnabled", { enabled: true });
    return p;
  };

  const inRoom = `!!document.querySelector('[role="region"][aria-label$="hotspot"] [aria-label="Who is here"]')`;
  const chatText = (t) => `(document.querySelector('[aria-label="Hotspot chat"]')||{innerText:''}).innerText.includes(${JSON.stringify(t)})`;
  const stripText = () => `(()=>{const s=document.querySelector('p[role="status"].flex');return s?s.innerText:''})()`;
  const sendMessage = async (p, text) => {
    await p.type('input[aria-label="Message"]', text);
    await p.click('button[type="submit"]', "^SEND$");
  };
  const login = async (p, who) => {
    await p.type("#su-email", who.email);
    await p.type("#su-pass", who.password);
    await p.click('button[type="submit"]', "LOG IN");
  };
  const aliasOf = (id) => psql(`select alias from room_identities where user_id='${id}' and channel='${CHANNEL}' and not anon`);
  const keyOf = (id) => psql(`select id from room_identities where user_id='${id}' and channel='${CHANNEL}' and not anon`);
  const ROOM_URL = `${APP}/dev/hotspot-room?slug=${SLUG}&auto=1`;

  // ---------------------------------------------------------- 1. B as a guest: the account gate
  const b = await newPage("B");
  await b.goto(ROOM_URL);
  await b.wait(has("Make an account to join"), 90000, "the account gate");
  check("a guest meets the account gate in the room", await b.has("Make an account to join Jibowu."), "Jibowu is the room's name");
  check("the room is full screen at 390 wide and does not scroll sideways", await b.ev("innerWidth===390 && document.documentElement.scrollWidth<=390"));
  await b.shot("01-guest-account-gate.png");
  await b.click("button", "MAKE AN ACCOUNT");
  await b.wait(`!!document.querySelector('[aria-label="Make an account"]')`, 8000, "the sign-up sheet");
  check("MAKE AN ACCOUNT opens the sign-up sheet over the room", true);
  await b.shot("02-guest-signup-sheet.png");
  await b.click("button", "Already have an account");
  await b.wait(`!!document.getElementById('su-pass')`);
  await login(b, B);
  await b.wait(inRoom, 40000, "B in the room after logging in from the sheet");
  check("after logging in from the sheet B walks straight into the room", true);
  check("B was let in (18+ already said), no age sheet", !(await b.has("Are you 18 or older?")));

  // ---------------------------------------------------------- 2. A on /account, the 18+ sheet, the room
  const a = await newPage("A");
  await a.goto(`${APP}/account?mode=login&next=${encodeURIComponent(`/dev/hotspot-room?slug=${SLUG}&auto=1`)}`);
  await a.wait(`!!document.getElementById('su-email')`, 90000, "the login form");
  await login(a, A);
  await a.wait(`!!document.querySelector('[aria-label="Confirm your age"]')`, 40000, "the 18+ sheet");
  check("the 18+ sheet appears once, before the room", (await a.has("Are you 18 or older?")) && !(await a.ev(inRoom)));
  await a.shot("03-adult-sheet.png");
  await a.click("button", "NOT NOW");
  await a.wait(has("Room closed."), 8000, "the room closing on NOT NOW");
  check("NOT NOW closes the room and does not confirm", psql(`select coalesce(adult_confirmed_at::text,'none') from profile_private where user_id='${A.id}'`) === "none");
  await a.click("button", "^ENTER");
  await a.wait(`!!document.querySelector('[aria-label="Confirm your age"]')`, 20000, "the 18+ sheet again");
  await a.click("button", "18 OR OLDER");
  await a.wait(inRoom, 30000, "A in the room");
  check("I'M 18 OR OLDER stores the yes and lets A in", psql(`select (adult_confirmed_at is not null)::text from profile_private where user_id='${A.id}'`) === "true");

  const aliasA = aliasOf(A.id);
  const aliasB = aliasOf(B.id);
  check("both Hoppers have a room alias (Word Word 2 hex), not a name", /^[A-Za-z-]+ [A-Za-z-]+ [0-9A-F]{2}$/.test(aliasA) && /^[A-Za-z-]+ [A-Za-z-]+ [0-9A-F]{2}$/.test(aliasB), `${aliasA} / ${aliasB}`);
  check("the room is named after the place, not the zone", (await a.ev(`document.querySelector('h1').innerText`)).toLowerCase() === "jibowu");
  check("the visit lasts: the Strict Mode remount did not leave (A is still in the database)", psql(`select count(*) from hotspot_visits where user_id='${A.id}' and fades_at>now()`) === "1");
  await sleep(2200);
  check("still in 2 s later, past the delayed-leave window", psql(`select count(*) from hotspot_visits where user_id in (${ids}) and fades_at>now()`) === "2");

  // ---------------------------------------------------------- 3. the heads
  await a.wait(`[...document.querySelectorAll('[aria-label="Who is here"] button')].some(b=>(b.getAttribute('aria-label')||'').startsWith(${JSON.stringify(aliasB)}))`, 25000, "B's head on A's stage (one room read)");
  check("A sees B's head by alias, B sees A's", true);
  await b.wait(`[...document.querySelectorAll('[aria-label="Who is here"] button')].some(b=>(b.getAttribute('aria-label')||'').startsWith(${JSON.stringify(aliasA)}))`, 25000, "A's head on B's stage");
  check("B sees A's head by alias", true);
  const heads = await a.ev(`[...document.querySelectorAll('[aria-label="Who is here"] button')].map(b=>b.getAttribute('aria-label'))`);
  check("a head is an alias and nothing else: no handle, no email, no id in the stage", heads.every((h) => !/@|[0-9a-f]{8}-[0-9a-f]{4}/i.test(h) && !h.includes(users.E2E_B_EMAIL)), JSON.stringify(heads));
  check("the header says how many are here", /HERE|Quiet|few/i.test(await a.ev(`document.querySelector('header').innerText`)), (await a.ev(`document.querySelector('header').innerText`)).replace(/\n/g, " | "));
  await a.shot("04-room-two-heads-A.png");
  await b.shot("05-room-two-heads-B.png");

  // ---------------------------------------------------------- 4. chat both ways, live
  const m1 = "Anyone up for suya after?";
  const t1 = Date.now();
  await sendMessage(a, m1);
  await a.wait(chatText(m1), 8000, "A's own message in A's chat");
  await b.wait(chatText(m1), 8000, "A's message on B's screen (Realtime)");
  check("A to B: the message arrives live", true, `A saw it, B saw it ${Date.now() - t1} ms after the tap`);
  const m2 = "Yes oh, I dey Jibowu";
  const t2 = Date.now();
  await sendMessage(b, m2);
  await b.wait(chatText(m2), 8000, "B's own message");
  await a.wait(chatText(m2), 8000, "B's message on A's screen (Realtime)");
  check("B to A: the message arrives live", true, `${Date.now() - t2} ms`);
  const row = psql(`select author_name||'|'||coalesce(author_handle,'null')||'|'||anon::text from messages where channel='${CHANNEL}' and body='${m1}'`).split("|");
  check("the message carries the room alias, no handle, not anonymous", row[0] === aliasA && row[1] === "null" && row[2] === "false", `${row[0]} / handle ${row[1]}`);
  check("the composer has no picture button (a hotspot is text only)", !(await a.ev(`!!document.querySelector('button[aria-label="Add a picture"]')`)));
  check("the rules line is pinned in the room", await a.has("Be kind. No numbers or links. Report anything that feels off."));
  await a.shot("06-chat-A.png");
  await b.shot("07-chat-B.png");

  // ---------------------------------------------------------- 5. B reports A's message
  await b.click('[aria-label="Hotspot chat"] button', "suya");
  await b.wait(`!!document.querySelector('[role="dialog"][aria-label=${JSON.stringify(aliasA)}]')`, 6000, "A's card");
  check("tapping a message opens a card with the alias and the message, Block and Report only", (await b.has("Report this message")) && (await b.has("Block")) && !(await b.has("WAVE")), "no wave until Play mode phase 5");
  await b.shot("08-head-card-B.png");
  await b.click("button", "Report this message");
  await b.wait(has("What happened"), 4000, "the reasons");
  await b.click("button", "Spam or selling");
  await b.wait(has("Reported. The Hoppaz crew will look at it."), 6000, "the report toast");
  check("the report goes through and says so", true);
  const staff = await hotspotsData(sb);
  const rep = staff.reports.find((r) => r.alias === aliasA);
  check("the report lands in the admin desk's hotspot reports with room, alias, excerpt and reason", !!rep && rep.hotspot_slug === SLUG && (rep.excerpt || "").includes(m1) && rep.reason === "Spam or selling", rep ? `${rep.hotspot_slug} / ${rep.alias} / ${rep.reason}` : "none");
  check("it also sits in the existing open reports queue (kind hotspot)", Number(psql(`select count(*) from reports where kind='hotspot' and reviewed_at is null and reporter='${B.id}'`)) >= 1);
  check("staff see a key to mute, never a user id", !!rep?.key && !JSON.stringify(rep).includes(A.id));

  // ---------------------------------------------------------- 6. staff mute A: A is told, B hears nothing
  const keyA = keyOf(A.id);
  const muted = await hotspotAction(sb, "hotspot_mute", { slug: SLUG, key: keyA, hours: 1, reason: "check-room" });
  check("staff mute A for an hour in this hotspot", muted?.status === 200);
  const m3 = "muted test message";
  await sendMessage(a, m3);
  await a.wait(has("You are muted here for now"), 6000, "the muted line");
  check("A is told plainly that they are muted", true);
  await a.shot("09-muted-A.png");
  await sleep(2500);
  check("B hears nothing from a muted A", !(await b.ev(chatText(m3))));
  check("the muted message was not saved", psql(`select count(*) from messages where channel='${CHANNEL}' and body='${m3}'`) === "0");
  const mute = (await hotspotsData(sb)).mutes.find((m) => m.alias === aliasA);
  check("the mute shows in the desk's mutes list as STAFF for Yaba", !!mute && mute.auto === false && mute.hotspot_slug === SLUG);
  await hotspotAction(sb, "hotspot_unmute", { id: mute.id });
  await a.click('button[type="submit"]', "^SEND$"); // the box still holds the text
  await a.wait(chatText(m3), 8000, "the message after the mute is lifted");
  await b.wait(chatText(m3), 8000, "the message reaching B");
  check("after the mute is lifted the same text goes through, and B gets it live", true);

  // ---------------------------------------------------------- 7. the rules answer in plain words
  await sendMessage(a, "call me on 0801 234 5678");
  await a.wait(has("No numbers or links in hotspots."), 6000, "the no-links line");
  check("a phone number is refused: No numbers or links in hotspots.", true);
  await a.shot("10-no-links-A.png");
  let easy = false;
  for (let i = 1; i <= 9 && !easy; i++) {
    await sendMessage(a, `quick ${i} ${Date.now() % 1000}`);
    await sleep(450);
    easy = await a.has("Too many messages");
  }
  console.log("   quick messages saved before the refusal:", psql(`select count(*) from messages where channel='${CHANNEL}' and body like 'quick %'`));
  check("a burst is refused in plain words: Easy. Too many messages. Try again in Ns.", easy);
  if (easy) {
    await sleep(700);
    check("the send box rests with a countdown, not a dead end", /Too many messages\. Try again in \d+s\./.test(await a.ev(stripText())), await a.ev(stripText()));
    await a.shot("11-rate-limit-A.png");
  }

  // ---------------------------------------------------------- 8. slow mode, forced on
  await hotspotAction(sb, "hotspot_slow", { slug: SLUG, seconds: 10, from: "00:00", to: "23:59" });
  await b.wait(has("Slow mode until 23:59. One message every 10 seconds."), 26000, "the slow mode line on B (one room read)");
  check("slow mode shows on B within one room read: Slow mode until 23:59. One message every 10 seconds.", true);
  await b.shot("12-slow-mode-B.png");
  await sendMessage(b, "slow one");
  await b.wait(chatText("slow one"), 8000, "B's message under slow mode");
  await b.wait(`/Slow mode\\. Next message in \\d+s\\./.test(${stripText()})`, 4000, "the countdown");
  check("after a post the box rests: Slow mode. Next message in Ns.", true, await b.ev(stripText()));
  await sendMessage(b, "slow two");
  await sleep(2500);
  check("a second tap inside the gap sends nothing (the countdown holds it)", !(await a.ev(chatText("slow two"))) && psql(`select count(*) from messages where channel='${CHANNEL}' and body='slow two'`) === "0");
  await b.shot("13-slow-countdown-B.png");
  psql(`update hotspots set slow_seconds=10, slow_from='00:00', slow_to='05:00' where slug='${SLUG}'`);

  // ---------------------------------------------------------- 9. the daily reward and the Regular badge
  const xpBefore = Number(await a.ev(`document.querySelector('[data-xp]').innerText`));
  psql(`update hotspot_visits set entered_at = now() - interval '6 minutes' where user_id='${A.id}'`);
  for (const d of [1, 2, 3]) {
    psql(`insert into hotspot_days (user_id, play_day, hotspot_id, stayed_at) values ('${A.id}', hotspot_play_day() - ${d}, '${hotspotId}', now() - interval '${d} days') on conflict do nothing`);
  }
  await a.goto(ROOM_URL); // the app was closed and opened again: the avatar is still in, so the stay counts at once
  await a.wait(has("+10 XP"), 40000, "+10 XP");
  check("+10 XP lands after the stay (the room entered again while the avatar was still in)", true);
  check("it says how long the stay was", await a.has("5 minutes at Jibowu"));
  await a.shot("14-reward-xp-A.png");
  await a.wait(has("Regular at Jibowu"), 10000, "the Regular badge");
  check("the 4th stay in a month brings the Regular at Jibowu stamp", true);
  await sleep(500);
  await a.shot("15-reward-badge-A.png");
  await a.wait(`Number(document.querySelector('[data-xp]').innerText) === ${xpBefore + 10}`, 8000, "the XP number on the page").catch(() => {});
  check("the XP total on the page moved by 10", Number(await a.ev(`document.querySelector('[data-xp]').innerText`)) === xpBefore + 10, `${xpBefore} to ${await a.ev(`document.querySelector('[data-xp]').innerText`)}`);
  check("the server paid 10 XP once and wrote the badge", psql(`select xp from profiles where id='${A.id}'`) === String(xpBefore + 10) && psql(`select count(*) from badges where user_id='${A.id}' and key='regular-${SLUG}'`) === "1");
  check("nothing went to the activity log (not a streak day)", psql(`select count(*) from activity_log where user_id='${A.id}' and created_at > now() - interval '10 minutes'`) === "0");
  await a.wait(`!(${has("Regular at Jibowu")})`, 8000, "the stamp leaving by itself");
  check("the reward moment leaves by itself and takes no taps", true);

  // ---------------------------------------------------------- 10. leaving
  await b.click("button", "Leave the hotspot");
  await b.wait(has("Room closed."), 6000, "B leaving");
  await sleep(1500);
  check("Leave takes B's avatar out at once", psql(`select count(*) from hotspot_visits where user_id='${B.id}'`) === "0");
  await a.wait(`![...document.querySelectorAll('[aria-label="Who is here"] button')].some(b=>(b.getAttribute('aria-label')||'').startsWith(${JSON.stringify(aliasB)}))`, 25000, "B's head leaving A's stage");
  check("A's stage loses B's head on the next room read", true);
  await a.shot("16-room-after-B-left-A.png");

  // ---------------------------------------------------------- 11. the admin desk's Hotspots section
  // The section runs on a dev page that sends nothing (/dev/hotspot-admin). The script hands it the real data the
  // admin route would read, clicks its buttons, and runs each action it recorded through the same handlers the
  // route calls: the buttons and the handlers are checked against each other, with no staff token involved.
  await b.goto(`${APP}/dev/hotspot-admin`);
  await b.wait(`!!window.__hzAdmin`, 90000, "the admin harness");
  const show = async () => b.ev(`window.__hzAdmin.set(${JSON.stringify(await hotspotsData(sb))})`);
  const lastAct = () => b.ev(`window.__acts[window.__acts.length-1]`);
  const run = async (act) => (await hotspotAction(sb, act.action, act))?.status;
  await show();
  await b.wait(has("Hotspot reports"), 10000, "the section");
  check("the section shows all 13 rooms, each with its slow mode tools", (await b.ev(`[...document.querySelectorAll('summary')].filter(e=>/slow mode and clean up/i.test(e.innerText)).length`)) === 13);
  check("rooms carry the place name and their state", (await b.has("Jibowu")) && (await b.has("Lekki Phase 1")) && (await b.has("Opening soon")) && (await b.has("wave 2")));
  check("a wave can be opened (a button per wave still planned)", (await b.ev(`[...document.querySelectorAll('button')].some(e=>/^OPEN WAVE 2 \\(3\\)$/i.test(e.innerText))`)) && (await b.ev(`[...document.querySelectorAll('button')].some(e=>/^OPEN WAVE 4 \\(3\\)$/i.test(e.innerText))`)));
  check("the reports list shows the room, alias, message and reason", (await b.has(aliasA)) && (await b.has(m1)) && (await b.has("Spam or selling")));
  check("the word list is there and editable", (await b.has("whatsapp ×")) && (await b.has("Add a word or phrase") || (await b.ev(`!!document.querySelector('input[name="word"]')`))));
  check("the page does not scroll sideways at 390", await b.ev("innerWidth===390 && document.documentElement.scrollWidth<=390"));
  await b.shot("17-admin-hotspots.png");
  await b.ev(`[...document.querySelectorAll('h2')].find(h=>/hotspot reports/i.test(h.innerText)).scrollIntoView({block:'start'})`);
  await b.shot("18-admin-reports.png");

  // a wave takes two taps: the first one only asks
  await b.click("button", "^OPEN WAVE 2");
  check("OPEN WAVE asks twice before it opens anything", /OPEN 3 ROOMS\\?/i.test(await b.ev(`[...document.querySelectorAll('button')].map(e=>e.innerText).join('|')`)));

  // mute the reported alias from the report line
  await b.click("button", "^MUTE ALIAS$");
  const muteAct = await lastAct();
  check("MUTE ALIAS sends the alias key, this hotspot and 12 hours", muteAct?.action === "hotspot_mute" && muteAct.key === keyA && muteAct.slug === SLUG && String(muteAct.hours) === "12", JSON.stringify({ ...muteAct, key: muteAct?.key ? "key" : null }));
  check("the handler accepts it", (await run(muteAct)) === 200);
  await show();
  await b.wait(has("Hotspot mutes"), 4000);
  check("the mute shows in Hotspot mutes with a LIFT button", (await b.has(aliasA)) && (await b.ev(`[...document.querySelectorAll('button')].some(e=>/^LIFT$/i.test(e.innerText))`)));
  await b.ev(`[...document.querySelectorAll('h2')].find(h=>/hotspot mutes/i.test(h.innerText)).scrollIntoView({block:'start'})`);
  await b.shot("19-admin-mutes.png");
  await b.click("button", "^LIFT$");
  const liftAct = await lastAct();
  check("LIFT sends the mute id and the handler accepts it", liftAct?.action === "hotspot_unmute" && (await run(liftAct)) === 200);
  await show();
  check("the mute is gone", await b.has("Nobody is muted."));

  // pause and open a room (two taps for a pause: it clears the room)
  await b.click("button", "^PAUSE$");
  check("PAUSE asks first: CLEAR THE ROOM?", await b.ev(`[...document.querySelectorAll('button')].some(e=>/clear the room\\?/i.test(e.innerText))`));
  await b.click("button", "CLEAR THE ROOM");
  const pauseAct = await lastAct();
  check("the second tap sends the status change", pauseAct?.action === "hotspot_status" && pauseAct.status === "paused", `${pauseAct?.slug} ${pauseAct?.status}`);
  check("the handler pauses it", (await run(pauseAct)) === 200 && psql(`select status from hotspots where slug='${pauseAct.slug}'`) === "paused");
  await show();
  check("a paused room reads PAUSED and offers OPEN", (await b.has("PAUSED")) && (await b.ev(`[...document.querySelectorAll('button')].some(e=>/^OPEN$/i.test(e.innerText))`)));
  await b.ev(`window.scrollTo(0,0);document.querySelector('.overflow-y-auto')&&(document.querySelector('.overflow-y-auto').scrollTop=0)`);
  await b.shot("20-admin-room-paused.png");
  await b.click("button", "^OPEN$");
  const openAct = await lastAct();
  check("OPEN sends the status change and the handler opens it again", openAct?.action === "hotspot_status" && openAct.status === "open" && (await run(openAct)) === 200 && psql(`select status from hotspots where slug='${openAct.slug}'`) === "active");

  // the word list
  await b.type('input[name="word"]', "zzcheckword");
  await b.click("button", "^ADD$");
  const addAct = await lastAct();
  check("ADD sends the word and the handler saves it", addAct?.action === "hotspot_word_add" && addAct.word === "zzcheckword" && (await run(addAct)) === 200);
  await show();
  check("the word shows as a chip", await b.has("zzcheckword ×"));
  await b.click("button", "zzcheckword");
  const rmAct = await lastAct();
  check("tapping the chip removes it", rmAct?.action === "hotspot_word_remove" && (await run(rmAct)) === 200);
  await show();
  check("the word is gone", !(await b.has("zzcheckword")));
  check("the admin page threw nothing", b.errors.length === 0, b.errors.slice(0, 2).join(" || "));

  // ---------------------------------------------------------- the calls the room made
  const names = (p) => [...new Set(p.rpcs.map((r) => r.name))].sort();
  const all = [...a.rpcs, ...b.rpcs];
  console.log("   A called:", names(a).join(", "));
  console.log("   B called:", names(b).join(", "));
  check("the room kept the avatar in with hotspot_pulse (about every 30 s) and read the room with hotspot_room", all.some((r) => r.name === "hotspot_pulse") && all.filter((r) => r.name === "hotspot_room").length >= 4, `${all.filter((r) => r.name === "hotspot_pulse").length} pulses, ${all.filter((r) => r.name === "hotspot_room").length} room reads`);
  check("entering sends only the slug", all.filter((r) => r.name === "enter_hotspot").every((r) => r.keys.length === 1 && r.keys[0] === "p_slug"));
  check("no call in the room carries a position or touches Play's ticks or Ola's my_alias", all.every((r) => !["play_tick", "play_fix", "my_alias", "spawn_welcome_boxes"].includes(r.name) && !r.keys.some((k) => /lat|lng|geo|position/i.test(k))));
  const errs = [...a.errors, ...b.errors];
  check("no exception in either page", errs.length === 0, errs.slice(0, 3).join(" || "));
  const logs = [...a.logs, ...b.logs].filter((l) => !/Failed to load resource|favicon|manifest/.test(l));
  if (logs.length) console.log("   page console errors (not failures):", logs.slice(0, 5).join(" || "));
} catch (e) {
  check("the run finished without an error", false, e.message);
  for (const p of pages.values()) {
    console.log(`   page ${p.name} exceptions:`, p.errors.slice(0, 4).join(" || ") || "none", "| console errors:", p.logs.slice(0, 4).join(" || ") || "none");
    try { await p.shot(`fail-${p.name}.png`); } catch {}
  }
}
stop();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} FAILED of ${results.length}` : `\nALL ${results.length} ROOM CHECKS PASSED`);
console.log("screenshots in", SHOTS);
process.exit(bad.length ? 1 : 0);
