// ============================================================================
// Hoppaz cards in the game: headless check of the open moment, the four-box reveal, Stamp it and the Me shelf
// at 390x844 (src/components/play/open, src/components/reveal, src/components/me/ShelfStrip.tsx).
//
//   node --no-warnings scripts/cards/check-open.mjs
//   SHOTS=<dir>  where the screenshots go (default: a folder in the temp dir)
//   APP=http://localhost:3100  another dev server
//
// Part 1 (no login): /dev/open with stand-in claim results that carry a card: a first Epic (No. 7 of 100), a first
// Common, a repeat, a guaranteed Rare, one stamped on the spot, an Epic crate that pays a Common card, a Golden crate
// that pays an Epic card, "near it" with Stamp it, and the four-box reveal with a card.
// Part 2 (test Hopper D, real database): one special box that pays an Epic card is made, the Hopper logs in on /account,
// opens it through claim_game_drop (/dev/open?real=...), walks up to the card, presses Stamp it (visit_card, with
// play_tick when the heartbeat is old), and the Me page shows the card in the shelf strip and in its sheet.
// It reads the test Hoppers from localdb/test_users.env and the local keys from localdb/.status.env INSIDE the script
// and never prints them. The one position used is a card's own public place, plus a point 170 m from it.
//
// LOAD RULE: ONE headless Chrome, killed at the end (also on an error or Ctrl-C). It changes a few rows (a box, a claim,
// a copy, a stamp, XP, one card put on hold for the run) and puts every one back. Needs the local Supabase in Docker with
// cards.sql and cards_s1_seed.sql loaded, and the dev server on APP. Exit code 1 if any check fails.
// ============================================================================
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALDB = path.resolve(HERE, "../../../localdb");
const APP = process.env.APP || "http://localhost:3100";
const SHOTS = path.resolve(process.env.SHOTS || path.join(os.tmpdir(), "hoppaz-cards-shots"));
const PORT = 9474;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "hoppaz-cards-chrome-"));
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
const D = { id: users.E2E_D_ID, email: users.E2E_D_EMAIL, password: users.E2E_D_PASSWORD };

const psql = (sql) => execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c", sql], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};
const has = (text) => `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;

// ------------------------------------------------------------------ the database, before
const YAB = psql(`select lat||','||lng from cards where key='YAB-01'`).split(",").map(Number);
const keys = { yab03: psql(`select status from cards where key='YAB-03'`) };
const before = {
  xp: psql(`select xp from profiles where id='${D.id}'`),
  cards: psql(`select coalesce(string_agg(id::text, ','), '') from user_cards where user_id='${D.id}'`),
  visits: psql(`select coalesce(string_agg(card_id::text, ','), '') from card_visits where user_id='${D.id}'`),
  pity: psql(`select since_rare||'|'||since_epic from card_pity where user_id='${D.id}'`),
  stock: psql(`select string_agg(card_id||'|'||copies_issued, ',') from card_stock where card_id in (select id from cards where key in ('YAB-01','YAB-03'))`),
  acts: psql(`select coalesce(string_agg(id::text, ','), '') from activity_log where user_id='${D.id}'`),
  fix: psql(`select lat||'|'||lng||'|'||accuracy||'|'||at from play_fix where user_id='${D.id}'`),
  recent: psql(`select coalesce(string_agg(id::text, ','), '') from drop_claims where user_id='${D.id}' and lat is not null and claimed_at > now() - interval '2 hours'`),
};
let dropId = null;
// a list for "not in (...)": an empty list must not read as null
const list = (csv) => csv.split(",").filter(Boolean).map((x) => `'${x}'`).join(",") || "'00000000-0000-0000-0000-000000000000'";
const restoreRows = () => {
  if (dropId) {
    psql(`delete from drop_claims where drop_id='${dropId}'`);
    psql(`delete from drop_rewards where drop_id='${dropId}'`);
    psql(`delete from game_drops where id='${dropId}'`);
    dropId = null;
  }
  psql(`delete from user_cards where user_id='${D.id}' and id not in (${list(before.cards)})`);
  psql(`delete from card_visits where user_id='${D.id}' and card_id not in (${list(before.visits)})`);
  psql(`delete from activity_log where user_id='${D.id}' and id not in (${list(before.acts)})`);
  psql(`delete from card_pity where user_id='${D.id}'`);
  if (before.pity) {
    const [r, e] = before.pity.split("|");
    psql(`insert into card_pity (user_id, since_rare, since_epic) values ('${D.id}', ${r}, ${e})`);
  }
  for (const row of (before.stock || "").split(",").filter(Boolean)) {
    const [id, n] = row.split("|");
    psql(`update card_stock set copies_issued=${n} where card_id='${id}'`);
  }
  psql(`update profiles set xp=${before.xp} where id='${D.id}'`);
  psql(`update cards set status='${keys.yab03}' where key='YAB-03'`);
  psql(`delete from play_fix where user_id='${D.id}'`);
  if (before.fix) {
    const [lat, lng, acc, at] = before.fix.split("|");
    psql(`insert into play_fix (user_id, lat, lng, accuracy, at) values ('${D.id}', ${lat}, ${lng}, ${acc}, '${at}')`);
  }
  if (before.recent) psql(`update drop_claims set claimed_at = claimed_at + interval '3 hours' where id in (${list(before.recent)})`);
};

// ------------------------------------------------------------------ Chrome
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--disable-background-networking",
  "--window-size=390,844", "about:blank",
], { stdio: "ignore" });
let ws;
let page;
const errors = [];
let cleaned = false;
const stop = () => {
  if (cleaned) return;
  cleaned = true;
  try { ws?.close(); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  try { execFileSync("pkill", ["-9", "-f", `remote-debugging-port=${PORT}`]); } catch {} // its helpers too
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  try { restoreRows(); } catch (e) { console.log("restore failed:", e.message); }
};
process.on("exit", stop);
setTimeout(() => { console.log("watchdog: the run took longer than 8 minutes"); process.exit(1); }, 8 * 60_000).unref();
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

try {
  // the claim speed rule looks 2 hours back: move D's recent located claims out of that window for the run
  if (before.recent) psql(`update drop_claims set claimed_at = claimed_at - interval '3 hours' where id in (${list(before.recent)})`);
  // one Epic card in the pool, so the real box always pays Yaba Higher College
  psql(`update cards set status='retired' where key='YAB-03'`);

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
  const rpcs = [];
  let sid;
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
    else if (d.method === "Network.requestWillBeSent") {
      const hit = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(d.params.request.url);
      if (hit && d.params.request.method === "POST") {
        let body = {};
        try { body = JSON.parse(d.params.request.postData || "{}"); } catch {}
        rpcs.push({ name: hit[1], keys: Object.keys(body) });
      }
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++nid;
    pending.set(id, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true }));
  const cmd = (m, p) => send(m, p, sid);
  page = {
    ev: async (expression) => {
      const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
      return r.result.value;
    },
  };
  page.wait = async (expression, ms = 20000, what = expression) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await page.ev(expression)) return Date.now() - t0; } catch {}
      await sleep(120);
    }
    throw new Error(`timed out after ${ms} ms waiting for ${what}`);
  };
  page.has = (t) => page.ev(has(t));
  page.goto = async (url) => { await cmd("Page.navigate", { url }); await sleep(500); };
  page.shot = async (file, wait = 350) => {
    await sleep(wait);
    const r = await cmd("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.data, "base64"));
    console.log("   shot", file);
  };
  const center = (selector, pattern = ".") => page.ev(`(()=>{const re=new RegExp(${JSON.stringify(pattern)},'i');const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>re.test((e.innerText||e.getAttribute('aria-label')||'')));if(!el)return null;el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  page.click = async (selector, pattern = ".") => {
    const pt = await center(selector, pattern);
    if (!pt) throw new Error(`nothing to click for ${selector} /${pattern}/`);
    await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: pt[0], y: pt[1], button: "left", buttons: 1, clickCount: 1 });
    await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt[0], y: pt[1], button: "left", buttons: 0, clickCount: 1 });
  };
  page.swipe = async (selector) => {
    const pt = await center(selector);
    if (!pt) throw new Error(`nothing to swipe for ${selector}`);
    await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: pt[0], y: pt[1], button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i++) await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt[0] + i * 20, y: pt[1], button: "left", buttons: 1 });
    await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt[0] + 80, y: pt[1], button: "left", buttons: 0, clickCount: 1 });
  };
  page.type = async (selector, text) => {
    await page.ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select&&el.select();return true})()`);
    await cmd("Input.insertText", { text });
  };
  await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("hoppaz.install",JSON.stringify({stage:2,done:true}))}catch(e){}` });
  await cmd("Runtime.enable"); await cmd("Page.enable"); await cmd("Network.enable");
  await cmd("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const doneCount = () => page.ev(`window.__hzDone||0`);
  const CRATE = '[role="button"][aria-label^="Open the box"]';
  const CARD = '[role="button"][aria-label*="Tap to keep it"]';

  /** Open one box on /dev/open: swipe, wait for the card, and hand back what the stage says. */
  const openCard = async (buttonId, name, shot, { keep = true } = {}) => {
    const n0 = await doneCount();
    await page.click(`#${buttonId}`);
    await page.wait(`!!document.querySelector('${CRATE}')`, 8000, `${name}: the crate`);
    await sleep(450); // the crate rises, the swipe hint comes
    await page.swipe(CRATE);
    await page.wait(`!!document.querySelector('${CARD}')`, 12000, `${name}: the card turning up`);
    await sleep(1500); // the flip, then the tag and the chips
    if (shot) await page.shot(shot);
    const said = await page.ev(`(document.querySelector('[role=dialog][aria-label="Open the box"]')?.innerText||'')`);
    const label = await page.ev(`document.querySelector('${CARD}').getAttribute('aria-label')`);
    const img = await page.ev(`document.querySelector('${CARD} img')?.naturalWidth||0`);
    if (keep) await landed(n0, name);
    return { said: said.toLowerCase(), label, img, n0 };
  };
  const landed = async (n0, name) => {
    await page.click(CARD);
    await page.wait(`(window.__hzDone||0) > ${n0}`, 9000, `${name}: the card landing`);
  };

  // ---------------------------------------------------------- 1. stand-in cards on /dev/open
  await page.goto(`${APP}/dev/open`);
  await page.wait(`!!document.getElementById('deck-epic')`, 90000, "the dev open page");
  check("the dev open page loads at 390 wide with no sideways scroll", await page.ev("innerWidth===390 && document.documentElement.scrollWidth<=390"));

  let r = await openCard("deck-epic", "Epic", "01-epic-new-numbered.png");
  check("an Epic card turns up face up with NEW and its number, and the stage announces it", r.said.includes("new") && r.said.includes("no. 7 of 100") && /epic card/.test(r.label), r.label);
  check("no Stamp it is offered far from the card's place", !r.said.includes("stamp it"));
  check("the card's own front image loaded (720 wide)", r.img === 720, `naturalWidth ${r.img}`);
  check("tapping the card sent it to the Shelf: the shell was told a card landed", await page.ev(`(document.querySelector('[data-testid=log]')?.innerText||'').includes('land card')`));

  r = await openCard("deck-common", "Common", "02-common-new.png");
  check("a Common card gets the same turn-up with NEW and no number", r.said.includes("new") && !r.said.includes("no. ") && /common card/.test(r.label), r.label);

  r = await openCard("deck-again", "repeat", "03-rare-repeat.png");
  check("a repeat says Another copy and has no NEW", r.said.includes("another copy") && !/\bnew\b/.test(r.said.replace("another copy", "")));

  r = await openCard("deck-lifted", "guaranteed", "04-rare-guaranteed.png");
  check("a card the guarantee lifted says so", r.said.includes("guaranteed rare"));

  await page.ev(`window.__stamps=0;(()=>{const s=window.__hz.sfx;const f=s.stamp;s.stamp=(...a)=>{window.__stamps++;return f.apply(s,a)}})()`);
  r = await openCard("deck-visited", "stamped on the spot", "05-epic-stamped-on-the-spot.png");
  check("a card stamped on the spot shows VISITED and plays the stamp sound", r.said.includes("visited") && (await page.ev("window.__stamps")) >= 1, `sfx.stamp x${await page.ev("window.__stamps")}`);

  r = await openCard("deck-mismatch", "Epic crate, Common card", "06-epic-crate-common-card.png");
  check("an Epic crate that pays a Common card is celebrated as Common (the card decides)", /common card/.test(r.label));

  r = await openCard("deck-golden", "Golden crate, Epic card", "07-golden-crate-epic-card.png");
  check("a Golden crate that pays an Epic card turns it up", /epic card/.test(r.label) && r.said.includes("new"));

  r = await openCard("deck-epic-near", "near it", "08-epic-near-stamp-it.png", { keep: false });
  check("near the card's place Stamp it is offered", r.said.includes("stamp it"));
  const stampBtn = () => page.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^stamp it$/i.test(x.innerText.trim()));if(!b)return null;const r=b.getBoundingClientRect();return {h:Math.round(r.height*10)/10,w:Math.round(r.width),font:parseFloat(getComputedStyle(b).fontSize),bottom:Math.round(r.bottom),vh:innerHeight}})()`);
  let sb = await stampBtn();
  check("Stamp it is a 44 px tap target with 11 px type at 390x844", sb && sb.h >= 44 && sb.font >= 11, JSON.stringify(sb));
  rpcs.length = 0;
  await page.click("button", "^stamp it$");
  await page.wait(`(()=>{const t=(document.querySelector('[role=dialog][aria-label="Open the box"]')?.innerText||'').toLowerCase();return /deck any more|didn.t stamp|sign|stamped|turn on your location|moment/.test(t)})()`, 25000, "the stamp answer");
  await page.shot("09-stamp-answer-for-a-stand-in-card.png");
  check("Stamp it called visit_card (a stand-in card is not in the database, so it is refused in words)", rpcs.some((c) => c.name === "visit_card"), rpcs.map((c) => c.name).join(","));
  await landed(r.n0, "near it");

  // the narrowest phone we design for: the same button, and the stack under the card still fits the screen
  await cmd("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
  await page.goto(`${APP}/dev/open`);
  r = await openCard("deck-epic-near", "near it at 360x640", "08b-epic-near-stamp-it-360x640.png", { keep: false });
  sb = await stampBtn();
  check("at 360x640 Stamp it is still 44 px tall, 11 px type, and the note under it still fits the screen", sb && sb.h >= 44 && sb.font >= 11 && sb.bottom + 36 <= sb.vh, JSON.stringify(sb));
  await landed(r.n0, "near it at 360x640");
  await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.goto(`${APP}/dev/open`);

  // the four-box reveal with a card (the Golden Box goes this way)
  const n1 = await doneCount();
  await page.click("#deck-fourbox");
  await page.wait(`!!document.querySelector('button[aria-label="Box 1 of 4"]')`, 8000, "the four boxes");
  await page.click('button[aria-label="Box 1 of 4"]');
  await page.wait(`[...document.querySelectorAll('button')].some(b=>/tear it open/i.test(b.innerText))`, 8000, "the tear button");
  await page.click("button", "tear it open");
  await page.wait(`[...document.querySelectorAll('button')].some(b=>/^next$/i.test(b.innerText))`, 12000, "the first thing out of the box");
  await page.click("button", "^next$");
  await page.wait(`!!document.querySelector('[role=dialog] img[alt*="card"]')`, 8000, "the card in the reveal");
  await sleep(700);
  await page.shot("10-fourbox-reveal-card.png");
  check("the four-box reveal pulls the card face up, with NEW", (await page.has("NEW")) && (await page.has("1 of 2") || await page.has("2 of 2")));
  await page.click("button", "that's it");
  await page.wait(has("In the bag"), 8000, "the summary");
  check("the summary lists the card by name", await page.has("Yaba Higher College"));
  await page.shot("11-fourbox-summary.png");
  await page.click("button", "^done$");
  await page.wait(`(window.__hzDone||0) > ${n1}`, 12000, "the card flying to the tray");
  check("after the reveal the card flies to the tray (the shell is told)", await page.ev(`(document.querySelector('[data-testid=log]')?.innerText||'').includes('land card')`));
  check("no exception on the open page", errors.length === 0, errors.slice(0, 2).join(" || "));

  // ---------------------------------------------------------- 2. a real box, a real stamp, the Me shelf
  const OFF = 170 / 111320; // 170 m north: outside the 150 m circle, so the box does not stamp it on the spot
  dropId = psql(`insert into game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active)
    values ('check card box', st_point(${YAB[1]}, ${YAB[0]})::geography, now() - interval '1 minute', now() + interval '1 hour', 500, 'proximity', 1, 'random', 'special', '${D.id}', true, true) returning id`).split("\n")[0];
  psql(`insert into drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) values ('${dropId}', 'card', 'Epic card', 60, 'epic')`);
  psql(`update game_drops set card_max_tier='epic' where id='${dropId}'`);
  psql(`delete from play_fix where user_id='${D.id}'`); // an old heartbeat: Stamp it must send one

  const devUrl = `/dev/open?real=${dropId}&tier=epic&at=${YAB[0] + OFF},${YAB[1]}&walk=1`;
  await page.goto(`${APP}/account?mode=login&next=${encodeURIComponent(devUrl)}`);
  await page.wait(`!!document.getElementById('su-email')`, 90000, "the login form");
  await page.type("#su-email", D.email);
  await page.type("#su-pass", D.password);
  await page.click('button[type="submit"]', "LOG IN");
  await page.wait(`!!document.getElementById('open-real')`, 60000, "the real box button after logging in");
  const xp0 = Number(psql(`select xp from profiles where id='${D.id}'`));
  rpcs.length = 0;
  await page.ev(`window.__stamps=0;(()=>{const s=window.__hz.sfx;const f=s.stamp;s.stamp=(...a)=>{window.__stamps++;return f.apply(s,a)}})()`);
  await page.click("#open-real");
  await page.wait(`!!document.querySelector('${CRATE}')`, 8000, "the real crate");
  await sleep(450);
  await page.swipe(CRATE);
  await page.wait(`!!document.querySelector('${CARD}')`, 15000, "the real card turning up");
  await sleep(1700);
  const real = await page.ev(`(document.querySelector('[role=dialog][aria-label="Open the box"]')?.innerText||'').toLowerCase()`);
  const realLabel = await page.ev(`document.querySelector('${CARD}').getAttribute('aria-label')`);
  await page.shot("12-real-claim-card.png");
  check("a real claim_game_drop answer carries the card, and the stage shows it (NEW, No. 1 of 100)", /yaba higher college/i.test(realLabel) && real.includes("new") && /no\. \d+ of 100/.test(real), realLabel);
  check("the claim was in the database: one copy of the card for the Hopper", psql(`select count(*) from user_cards where user_id='${D.id}' and drop_id='${dropId}'`) === "1");
  check("the card was not stamped by the claim (the claim point is 170 m away), so Stamp it is offered once at the place", real.includes("stamp it"));
  await sleep(7000); // the speed rule: the walk from the claim point to the card must be believable
  rpcs.length = 0;
  await page.ev("window.__stamps=0"); // the daily stamp on the pips has played its own by now: count the Stamp it sound alone
  await page.click("button", "^stamp it$");
  await page.wait(`(document.querySelector('[role=dialog][aria-label="Open the box"]')?.innerText||'').toLowerCase().includes('stamped')`, 25000, "the stamp answer");
  await page.shot("13-real-stamped.png");
  const calls = rpcs.map((c) => c.name);
  check("Stamp it called visit_card (and play_tick first when the heartbeat was old)", calls.includes("visit_card"), calls.join(" > "));
  check("the stamp call sent only the card and the position fields, nothing stored locally", rpcs.filter((c) => c.name === "visit_card").every((c) => c.keys.sort().join() === "p_accuracy,p_card,p_lat,p_lng"));
  check("sfx.stamp played once for the stamp", (await page.ev("window.__stamps")) === 1, `x${await page.ev("window.__stamps")}`);
  check("the stamp is in the database: Visited, paid (30 XP), no position", psql(`select xp_paid::text from card_visits where user_id='${D.id}' and card_id=(select id from cards where key='YAB-01')`) === "true");
  check("the XP is 60 for the box and 30 for the stamp", Number(psql(`select xp from profiles where id='${D.id}'`)) - xp0 === 90, `${Number(psql(`select xp from profiles where id='${D.id}'`)) - xp0} XP`);
  check("the stored stamp row has only a day and a paid flag", psql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='card_visits' and table_schema='public'`) === "user_id,card_id,visited_on,xp_paid");
  check("nothing about the position is in localStorage or sessionStorage", await page.ev(`!/6\\.5\\d{3}/.test(JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)))`));
  await page.click(CARD);
  await sleep(1500);

  // the Me page: the card in the shelf strip, then its sheet
  await page.goto(`${APP}/me`);
  await page.wait(`!!document.querySelector('section[aria-label="Your shelf"] button[aria-label*="Yaba Higher College"]')`, 60000, "the card in the shelf strip");
  await page.ev(`document.querySelector('section[aria-label="Your shelf"]').scrollIntoView({block:'center'})`);
  await page.shot("14-me-shelf-strip.png", 700);
  const strip = await page.ev(`document.querySelector('section[aria-label="Your shelf"]').innerText`);
  check("the Me shelf strip has the deck line (1 of 124, 1 visited: one card is on hold for this run)", /1 of 124/i.test(strip) && /1 visited/i.test(strip), strip.replace(/\n/g, " | ").slice(0, 160));
  check("the card is the first tile, and its claim receipt is not a second REWARD tile", (await page.ev(`document.querySelector('section[aria-label="Your shelf"] li button')?.getAttribute('aria-label')`)).startsWith("Yaba Higher College") && !/REWARD/.test(strip), `shelf count line: ${strip.split("\n")[0]}`);
  await page.click('section[aria-label="Your shelf"] button[aria-label*="Yaba Higher College"]');
  await page.wait(`!!document.querySelector('[role=dialog][aria-label="Yaba Higher College"]')`, 8000, "the card sheet");
  await sleep(600);
  await page.shot("15-me-card-sheet.png");
  check("tapping the card opens its sheet, stamped (Visited)", await page.ev(`/visited/i.test(document.querySelector('[role=dialog][aria-label="Yaba Higher College"]').innerText)`));
  check("no exception on any page", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (e) {
  check("the run finished without an error", false, e.message);
  console.log("   page exceptions:", errors.slice(0, 3).join(" || ") || "none");
  try { await page.shot("fail.png"); } catch {}
}
stop();
const bad = results.filter((x) => !x.ok);
console.log(bad.length ? `\n${bad.length} FAILED of ${results.length}` : `\nALL ${results.length} CARD CHECKS PASSED`);
console.log("screenshots in", SHOTS);
process.exit(bad.length ? 1 : 0);
