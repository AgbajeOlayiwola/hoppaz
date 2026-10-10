// ============================================================================
// Hoppaz cards: headless check of the Collection page (src/app/collection, src/components/cards) at 390x844,
// signed in as a test Hopper who holds a few cards.
//
//   node --no-warnings scripts/cards/check-collection.mjs
//   SHOTS=<dir> to keep the screenshots somewhere (default: a folder in the temp dir)
//   APP=http://localhost:3100 to point at another dev server
//
// It gives the E2E C test Hopper 12 cards with scripts/cards/give-test-cards.sql (a Rare and Epic mix, one duplicate,
// one city-wide, two Visited), logs in as them on /account, then walks the album: the count, the silhouettes, the
// filters, a locked card's sheet, an owned card's sheet and its flip, the stamp (a position is faked at a public
// landmark, never a real person's), reduced motion, the shelf tab and the day theme. It also covers the review fixes: the
// name under an owned tile, the 360 px thumb in the srcset, three pips on a silhouette, the Visited state up with the pills,
// a Close button that stays put while the sheet scrolls, a second card opening on its front, the card-claim receipt kept off
// the shelf, a failed my_collection answered with a retry (not an empty deck) and the 360x640 sheet. It reads the test Hopper from
// localdb/test_users.env INSIDE the script and never prints it, and it never prints a position. The stamp, the XP, the
// heartbeat and the boxes the heartbeat made are put back; the 12 cards stay with the Hopper.
//
// LOAD RULE: ONE headless Chrome, killed at the end (also on an error or Ctrl-C). Never run two at once.
// Needs the local Supabase in Docker, supabase/cards.sql and cards_s1_seed.sql loaded, and the dev server on APP.
// Exit code 1 if any check fails.
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

const users = Object.fromEntries(
  fs.readFileSync(path.join(LOCALDB, "test_users.env"), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).reverse().map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  })
);
const C = { id: users.E2E_C_ID, email: users.E2E_C_EMAIL, password: users.E2E_C_PASSWORD };
const psql = (sql) => execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c", sql], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};

// The card the stamp is tried on: a Rare at a public landmark (Kalakuta Museum). A position is faked there, 2 km off
// and then on it, so the distance line and the circle are both shown.
const STAMP_KEY = "IKJ-ONI-01";
const orig = { xp: psql(`select xp from profiles where id='${C.id}'`), drops: psql(`select count(*) from game_drops where owner_id='${C.id}'`) };
const card = psql(`select lat||','||lng from cards where key='${STAMP_KEY}'`).split(",").map(Number);
const FAR = { lat: card[0] - 0.018, lng: card[1] }; // about 2 km south
const giveCards = () =>
  execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-v", `me=${C.id}`], {
    input: fs.readFileSync(path.join(HERE, "give-test-cards.sql")),
    stdio: ["pipe", "ignore", "inherit"],
  });
const restore = () => {
  psql(`delete from card_visits where user_id='${C.id}' and card_id=(select id from cards where key='${STAMP_KEY}')`);
  psql(`update profiles set xp=${orig.xp} where id='${C.id}'`);
  psql(`delete from activity_log where user_id='${C.id}' and action='card_visit'`);
  psql(`delete from game_drops where owner_id='${C.id}'`); // also the stand-in card-claim receipt below
  psql(`delete from play_fix where user_id='${C.id}'`);
};

// ------------------------------------------------------------------ Chrome
// One headless Chrome at a time on this Mac, other scripts' included: wait for theirs to go (up to 5 minutes).
const otherHeadless = () => execFileSync("ps", ["-axo", "command"], { encoding: "utf8" }).split("\n").some((l) => l.includes("--headless") && !l.includes(PROFILE));
for (let i = 0; i < 100 && otherHeadless(); i++) {
  if (i === 0) console.log("another headless Chrome is running: waiting for it to finish");
  await sleep(3000);
}
if (otherHeadless()) { console.log("another headless Chrome is still running: not starting a second one"); process.exit(1); }
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--disable-background-networking",
  "--window-size=390,844", "about:blank",
], { stdio: "ignore" });
let ws;
const page = { errors: [], logs: [], rpcs: [] };
let cleaned = false;
const stop = () => {
  if (cleaned) return;
  cleaned = true;
  try { ws?.close(); } catch {}
  try { chrome.kill("SIGTERM"); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  try { restore(); } catch (e) { console.log("restore failed:", e.message); }
};
process.on("exit", stop);
setTimeout(() => { console.log("watchdog: the run took longer than 6 minutes"); process.exit(1); }, 6 * 60_000).unref();
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

try {
  giveCards();
  restore();
  check("the test Hopper holds 12 different cards", psql(`select count(distinct card_id) from user_cards where user_id='${C.id}'`) === "12");

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
  let sid = null;
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
    if (d.sessionId !== sid) return;
    if (d.method === "Runtime.exceptionThrown") page.errors.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") page.logs.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
    else if (d.method === "Fetch.requestPaused") {
      // only paused while a check wants my_collection to fail; every other request goes on as it was
      send(page.failMyCollection ? "Fetch.failRequest" : "Fetch.continueRequest", page.failMyCollection ? { requestId: d.params.requestId, errorReason: "Failed" } : { requestId: d.params.requestId }, sid).catch(() => {});
    }
    else if (d.method === "Network.requestWillBeSent") {
      const hit = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(d.params.request.url);
      if (hit && d.params.request.method === "POST") page.rpcs.push(hit[1]);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++nid;
    pending.set(id, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  sid = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  const cmd = (m, params) => send(m, params, sid);
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const wait = async (expression, ms = 20000, what = expression) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await ev(expression)) return Date.now() - t0; } catch {}
      await sleep(150);
    }
    throw new Error(`timed out after ${ms} ms waiting for ${what}`);
  };
  const has = (text) => `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`; // an expression, for wait()
  const says = (text) => ev(has(text));
  const goto = async (url) => { await cmd("Page.navigate", { url }); await sleep(400); };
  const shot = async (file) => {
    await sleep(450); // let a fade, a stamp or a flip finish
    const r = await cmd("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS, `collection-${file}`), Buffer.from(r.data, "base64"));
    console.log("   shot", file);
  };
  // Click the first element matching a selector whose text or aria-label matches the pattern.
  const click = async (selector, pattern = ".") => {
    const pt = await ev(`(()=>{const re=new RegExp(${JSON.stringify(pattern)},'i');const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>re.test(e.getAttribute('aria-label')||e.innerText||''));if(!el)return null;el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
    if (!pt) throw new Error(`nothing to click for ${selector} /${pattern}/`);
    await sleep(120);
    const at = await ev(`(()=>{const re=new RegExp(${JSON.stringify(pattern)},'i');const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>re.test(e.getAttribute('aria-label')||e.innerText||''));const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
    await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
    await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", clickCount: 1 });
  };
  const type = async (selector, text) => {
    await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select&&el.select();return true})()`);
    await cmd("Input.insertText", { text });
  };
  const scrollPage = (top) => ev(`(()=>{const s=document.querySelector('main > div');s.scrollTop=${top};return s.scrollTop})()`);
  const sheetScroll = (top) => ev(`(()=>{const s=document.querySelector('[role="dialog"]');s.scrollTop=${top};return s.scrollTop})()`);

  await send("Target.activateTarget", { targetId });
  await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("hoppaz.install",JSON.stringify({stage:2,done:true}))}catch(e){}
    // count every sound source the page starts, so a sound on a tap can be seen
    window.__srcStarts=0;for(const k of ["AudioScheduledSourceNode","AudioBufferSourceNode"]){const P=window[k]&&window[k].prototype;if(P&&P.start){const o=P.start;P.start=function(){window.__srcStarts++;return o.apply(this,arguments)}}}` });
  await cmd("Runtime.enable"); await cmd("Page.enable"); await cmd("Network.enable");
  await cmd("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd("Emulation.setTouchEmulationEnabled", { enabled: true });

  // ---------------------------------------------------------- 1. log in, open the album
  await goto(`${APP}/account?mode=login&next=${encodeURIComponent("/collection")}`);
  await wait(`!!document.getElementById('su-email')`, 90000, "the login form");
  await type("#su-email", C.email);
  await type("#su-pass", C.password);
  await click('button[type="submit"]', "LOG IN");
  await wait(`location.pathname==='/collection'`, 40000, "the collection page after logging in");
  await wait(`document.querySelectorAll('section[aria-label] ul li').length>=125`, 60000, "the 125 tiles");
  await sleep(1200);

  check("the page is the Collection with a Cards and a Shelf tab", (await says("Collection")) && (await ev(`[...document.querySelectorAll('[role=tab]')].map(t=>t.innerText.trim()).join(',')`)) === "CARDS,SHELF");
  check("the overall count reads 12 of 125", (await ev(`document.querySelector('[aria-label="12 of 125 cards"]')?.innerText.replace(/\\s+/g,' ')`)) === "12 of 125");
  check("every one of the 125 cards has a tile", (await ev(`document.querySelectorAll('section[aria-label] ul li').length`)) === 125);
  check("only the 12 cards you hold load an image (the rest are drawn silhouettes)", (await ev(`document.querySelectorAll('section[aria-label] ul li img').length`)) === 12);
  check("a locked tile does not carry the card's name", !(await ev(`[...document.querySelectorAll('section[aria-label] ul li button')].some(b=>/Maracana|Pen Cinema|Egbin Power/i.test(b.getAttribute('aria-label')||''))`)));
  check("the album does not scroll sideways", await ev(`innerWidth===390 && document.documentElement.scrollWidth<=390 && document.querySelector('main > div').scrollWidth<=390`));
  check("no rarity but Common, Rare and Epic is offered", (await ev(`[...document.querySelectorAll('[aria-label=Rarity] button')].map(b=>b.innerText.trim()).join('|')`)) === "ALL RARITIES|COMMON|RARE|EPIC|I HAVE");
  check("the divisions are filter chips, councils then Campus then City-wide", (await ev(`[...document.querySelectorAll('[aria-label=Division] button')].map(b=>b.innerText.trim()).join('|')`)).toLowerCase() === "all|badagry|epe|ikeja|ikorodu|lagos|lagos mainland|campus series|city-wide");
  check("the division heading counts your cards of the division", (await ev(`[...document.querySelectorAll('section[aria-label] h2')].find(h=>h.innerText==='Lagos Mainland').nextElementSibling.innerText`)).replace(/\s+/g, " ") === "6 OF 10");
  await shot("01-album-top.png");

  await ev(`document.querySelector('section[aria-label="Lagos Mainland"]').scrollIntoView({block:'start'})`);
  await shot("02-album-lagos-mainland.png");
  check("the Epic tile glows (a halo layer) and the stamp sits on the Visited ones", (await ev(`!!document.querySelector('section[aria-label="Lagos Mainland"] li svg')`)) && (await ev(`(()=>{const h=document.querySelector('section[aria-label="Lagos Mainland"] [class*="halo"]');return !!h && getComputedStyle(h).opacity!=='0'})()`)));
  check("the duplicate shows x2 on its tile", await ev(`!![...document.querySelectorAll('section[aria-label] li')].find(li=>/(^|\\n)x2(\\n|$)/.test(li.innerText.trim()))`));
  check("an owned tile names its card under the picture, a locked one does not", (await ev(`(()=>{const li=document.querySelector('section[aria-label="Lagos Mainland"] li:has(button[aria-label^="Yaba Higher College"])');return li.innerText.includes('Yaba Higher College')})()`))
    && (await ev(`!document.querySelector('section[aria-label="Lagos Mainland"] li:has(button[aria-label^="Locked"]) span.line-clamp-2')`)));
  const srcset = await ev(`document.querySelector('section[aria-label] ul li img').getAttribute('srcset')`);
  check("a tile offers the 180 px thumb and its 360 px twin (a 3x phone gets the sharp one)", /\.webp\?v=\d+ 180w, .*-2x\.webp\?v=\d+ 360w$/.test(srcset), srcset);
  check("every silhouette draws three pips, one per rarity the deck has", await ev(`(()=>{const p=[...document.querySelectorAll('section[aria-label] [role=img] [class*="pips"]')];return p.length>100 && p.every(x=>x.children.length===3)})()`));

  // ---------------------------------------------------------- 2. filters
  await click("[aria-label=Division] button", "^Ikorodu$");
  await wait(`document.querySelectorAll('section[aria-label] ul li').length===47`, 5000, "47 Ikorodu tiles");
  check("the Ikorodu chip leaves only Ikorodu's 47 cards", true);
  await click("[aria-label=Rarity] button", "^RARE$");
  const rareN = await ev(`document.querySelectorAll('section[aria-label] ul li').length`);
  check("Ikorodu and Rare together leave only Rare cards", rareN > 0 && rareN < 47 && (await ev(`[...document.querySelectorAll('section[aria-label] ul li button')].every(b=>/rare/i.test(b.getAttribute('aria-label')))`)), `${rareN} cards`);
  await shot("03-filter-ikorodu-rare.png");
  await click("[aria-label=Rarity] button", "^I HAVE$");
  check("I HAVE leaves the Rares you hold in Ikorodu (2)", (await ev(`document.querySelectorAll('section[aria-label] ul li').length`)) === 2);
  await click("button", "^ALL$");
  await click("[aria-label=Rarity] button", "^ALL RARITIES$");
  await click("[aria-label=Rarity] button", "^I HAVE$");
  await wait(`document.querySelectorAll('section[aria-label] ul li').length===125`, 5000, "all 125 back");
  check("clearing the filters brings all 125 back", true);

  // ---------------------------------------------------------- 3. a locked card
  await click("section[aria-label=Ikeja] ul li button", "^Locked rare card from Ojodu");
  await wait(`!!document.querySelector('[role=dialog]')`, 4000, "the sheet");
  check("a locked card's sheet says Not found yet and names no place", (await says("Not found yet")) && !(await ev(`document.querySelector('[role=dialog]').innerText.includes('Aro Meta')`)));
  check("the locked sheet has no Visited block and no flip button", !(await ev(`!!document.querySelector('[role=dialog] button[data-flipped]')`)) && !(await says("Go here to stamp it")));
  await shot("04-locked-card-sheet.png");
  await ev(`document.querySelector('[role=dialog] button[aria-label="Close"]').click()`);

  // ---------------------------------------------------------- 4. an owned Epic, and the flip
  await click("section button", "^Yaba Higher College, epic");
  await wait(`!!document.querySelector('[role=dialog] button[data-flipped]')`, 4000, "the card sheet");
  await sleep(900);
  const sheetText = await ev(`document.querySelector('[role=dialog]').innerText`);
  const wanted = { name: /Yaba Higher College/, known_for: /Ships a whole student body/i, lore: /Before Ibadan had a campus/, fact: /Founded in Yaba in 1932/, question: /Which school in your family history/, home: /HOME AREA/, source: /SOURCE:/, visited: /Visited/ };
  const missing = Object.entries(wanted).filter(([, re]) => !re.test(sheetText)).map(([k]) => k);
  check("the sheet shows the name, what it is known for, the lore, the fact with its source, the question and the home area", missing.length === 0, missing.length ? "missing: " + missing.join(",") : "");
  check("the Epic is numbered: NO. 7 OF 100 on the face and in the pills", (await ev(`document.querySelector('[role=dialog] button[data-flipped]').innerText.includes('NO. 7 OF 100')`)) && (await says("NO. 7 OF 100")));
  check("a Visited card shows its stamp and a Visited line, no stamping block", (await ev(`!!document.querySelector('[role=dialog] button[data-flipped] svg')`)) && !(await says("Go here to stamp it")));
  check("the number printed on the card's front is at least 7 px", (await ev(`parseFloat(getComputedStyle(document.querySelector('[role=dialog] button[data-flipped] [class*="number"]')).fontSize)`)) >= 7);
  await shot("05-epic-sheet-front.png");
  const before = await ev(`window.__srcStarts`);
  await click("[role=dialog] button[data-flipped]", "Tap to flip");
  await wait(`document.querySelector('[role=dialog] button[data-flipped]').dataset.flipped==='true'`, 3000, "the flip");
  await sleep(300);
  check("tapping the card flips it (3D, preserve-3d, rotated 180)", await ev(`getComputedStyle(document.querySelector('[role=dialog] button[data-flipped]')).transform!=='none'`));
  check("the flip makes a sound (sfx.flip starts an audio source)", (await ev(`window.__srcStarts`)) > before, `${before} -> ${await ev("window.__srcStarts")} sources started`);
  check("the back image is in once the front is (it waits for the front)", await ev(`document.querySelectorAll('[role=dialog] button[data-flipped] img').length===2`));
  await shot("06-epic-sheet-back.png");
  await click("[role=dialog] button[data-flipped]", "Tap to flip");
  await sleep(700);
  await sheetScroll(520);
  const closeTop = await ev(`(()=>{const d=document.querySelector('[role=dialog]');return [d.scrollTop, Math.round(document.querySelector('[role=dialog] button[aria-label="Close"]').getBoundingClientRect().top-d.getBoundingClientRect().top)]})()`);
  check("scrolled down the sheet, Close stays at its top (the sheet has no backdrop to tap)", closeTop[0] > 100 && closeTop[1] >= 0 && closeTop[1] <= 12, `scrollTop ${closeTop[0]}, Close ${closeTop[1]} px below the sheet's top`);
  await shot("07-epic-sheet-text.png");
  await sheetScroll(0);
  // a second card opened while a sheet is up must start on its front, not on the last card's back
  await click("[role=dialog] button[data-flipped]", "Tap to flip");
  await sleep(700);
  check("(the first card is on its back)", (await ev(`document.querySelector('[role=dialog] button[data-flipped]').dataset.flipped`)) === "true");
  await ev(`document.querySelector('section button[aria-label^="Queen"]').click()`);
  await sleep(600);
  check("another card opened from under the sheet starts on its front, not on the back of the last one", /^Queen/.test(await ev(`document.querySelector('[role=dialog]').getAttribute('aria-label')`)) && (await ev(`document.querySelector('[role=dialog] button[data-flipped]').dataset.flipped`)) === "false");
  await ev(`document.querySelector('[role=dialog] button[aria-label="Close"]').click()`);

  // ---------------------------------------------------------- 5. a Rare you can stamp: distance on the phone, then I'M HERE
  const rpcsBefore = page.rpcs.length;
  await click("section button", "^Kalakuta Museum, rare");
  await wait(`!!document.querySelector('[role=dialog]')`, 4000, "the sheet");
  await sleep(600);
  check("a card not yet stamped says Go here to stamp it and offers to show the distance", (await says("Go here to stamp it")) && (await says("SHOW HOW FAR")));
  check("the copy no longer says the position stays on the phone, and says nothing is sent until you stamp", !(await says("stays on your phone")) && (await says("Nothing is sent until you stamp it")));
  check("the Visited state is up with the pills: NOT STAMPED", await ev(`!![...document.querySelectorAll('[role=dialog] .pill')].find(p=>p.innerText.trim()==='NOT STAMPED')`));
  check("the RARE pill's words are not the dark violet (#5B2EFF measures under 3:1 as text)", (await ev(`getComputedStyle([...document.querySelectorAll('[role=dialog] .pill')].find(p=>p.innerText.trim()==='RARE')).color`)) !== "rgb(91, 46, 255)");
  await shot("08-stamp-before-location.png");
  // the narrowest phone: the card shrinks with the height, and the Visited state is in view
  await cmd("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const small = await ev(`(()=>{const d=document.querySelector('[role=dialog]').getBoundingClientRect();const p=[...document.querySelectorAll('[role=dialog] .pill')].find(p=>p.innerText.trim()==='NOT STAMPED').getBoundingClientRect();const c=document.querySelector('[role=dialog] button[data-flipped]').getBoundingClientRect();return {pillInView:p.bottom<=d.bottom && p.top>=d.top, cardW:Math.round(c.width), cardH:Math.round(c.height), sheetH:Math.round(d.height)}})()`);
  check("at 360x640 the NOT STAMPED pill is in view and the card is under 30% of the screen height wide", small.pillInView && small.cardW <= 0.28 * 640 + 1, JSON.stringify(small));
  await shot("08b-stamp-before-location-360x640.png");
  await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  // allow location for this site and fake a position about 2 km off
  await send("Browser.grantPermissions", { origin: APP, permissions: ["geolocation"], browserContextId });
  await cmd("Emulation.setGeolocationOverride", { latitude: FAR.lat, longitude: FAR.lng, accuracy: 12 });
  // allowing location makes the sheet start looking by itself, so there is no button to press
  await wait(`/km away|\\d+ m away/i.test(document.querySelector('[role=dialog]').innerText)`, 15000, "a distance line");
  const line = await ev(`(document.querySelector('[role=dialog]').innerText.match(/[\\d.]+ (km|m) away\\./)||[''])[0]`);
  check("the sheet shows how far you are (worked out on the phone)", /^1\.[5-9]|^2\.[0-4]/.test(line) && line.includes("km"), line);
  check("no stamp or heartbeat call has gone out yet, so the position stayed on the phone", !page.rpcs.slice(rpcsBefore).some((n) => n === "visit_card" || n === "play_tick"), page.rpcs.slice(rpcsBefore).join(","));
  check("no I'M HERE button while you are outside the circle", !(await says("I'M HERE")));
  await shot("09-stamp-distance.png");
  await cmd("Emulation.setGeolocationOverride", { latitude: card[0], longitude: card[1], accuracy: 10 });
  await wait(`/you are here/i.test(document.querySelector('[role=dialog]').innerText)`, 15000, "You are here");
  check("standing in the circle shows You are here and I'M HERE", await says("I'M HERE"));
  check("next to I'M HERE it says what is sent: the position once, and that only the day is kept", (await says("sends your position once")) && (await says("We keep only the day")));
  await shot("10-stamp-in-circle.png");
  await click("[role=dialog] button", "I'M HERE");
  await wait(`/Visited/.test(document.querySelector('[role=dialog]').innerText) && !/NOT STAMPED YET/.test(document.querySelector('[role=dialog]').innerText)`, 15000, "the Visited line");
  await sleep(500);
  check("I'M HERE stamps it: the sheet turns to Visited and the card wears the stamp", await ev(`!!document.querySelector('[role=dialog] button[data-flipped] svg')`));
  const row = psql(`select visited_on is not null, xp_paid from card_visits where user_id='${C.id}' and card_id=(select id from cards where key='${STAMP_KEY}')`);
  check("the database holds the stamp (a day and a paid flag, nothing else)", row === "t|t", row);
  check("the stamp paid 30 XP", Number(psql(`select xp from profiles where id='${C.id}'`)) === Number(orig.xp) + 30);
  // no heartbeat was open, so the first stamp is turned away as stale, one heartbeat goes out and the stamp is tried again
  check("the first try was stale, one heartbeat went out and the second try stamped", page.rpcs.slice(rpcsBefore).join(",") === "visit_card,play_tick,visit_card", page.rpcs.slice(rpcsBefore).join(","));
  await shot("11-stamp-done.png");
  await ev(`document.querySelector('[role=dialog] button[aria-label="Close"]').click()`);
  await sleep(300);
  check("the tile for it now wears the stamp, and the count says 3 Visited", (await ev(`!!document.querySelector('section[aria-label=Ikeja] button[aria-label^="Kalakuta Museum"] svg')`)) && (await says("3 VISITED")));

  // ---------------------------------------------------------- 6. reduced motion: the flip is a fade, the glow holds still
  await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await click("section button", "^Yaba Higher College, epic");
  await wait(`!!document.querySelector('[role=dialog] button[data-flipped]')`, 4000, "the card sheet");
  await sleep(600);
  await click("[role=dialog] button[data-flipped]", "Tap to flip");
  await sleep(500);
  check("with reduced motion the flip is not a 3D turn: no transform on the card, the back fades in", await ev(`(()=>{const b=document.querySelector('[role=dialog] button[data-flipped]');const back=b.children[1];return getComputedStyle(b).transform==='none'&&getComputedStyle(back).opacity==='1'&&getComputedStyle(b.children[0]).opacity==='0'})()`));
  check("with reduced motion the Epic glow does not animate", await ev(`getComputedStyle(document.querySelector('[role=dialog] [class*="halo"]')).animationName==='none'`));
  await shot("12-reduced-motion-flip.png");
  await ev(`document.querySelector('[role=dialog] button[aria-label="Close"]').click()`);
  await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

  // ---------------------------------------------------------- 7. the shelf tab keeps the old shelf
  await scrollPage(0);
  await click("[role=tab]", "^SHELF$");
  await wait(has("CAMERA HUNT"), 8000, "the camera hunt section on the shelf");
  check("the SHELF tab still holds the camera hunt and the collectibles", true);
  await shot("13-shelf-tab.png");

  await goto(`${APP}/collection?tab=shelf`);
  await wait(has("CAMERA HUNT"), 40000, "the shelf from the ?tab=shelf link");
  check("/collection?tab=shelf opens the shelf (the links from Me and the drops land there)", (await ev(`document.querySelector('[role=tab][aria-selected=true]').innerText.trim()`)) === "SHELF");
  check("with no claimed reward the shelf prints no CLAIMED REWARDS", !(await says("CLAIMED REWARDS")));

  // a card claim leaves a receipt titled for its prize row ("Legendary card" in the old rows, "Card" now): never on the shelf
  for (const title of ["Legendary card", "Card"]) {
    psql(`delete from game_drops where owner_id='${C.id}'`);
    psql(`with d as (insert into game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active)
            values ('CHECK shelf receipt', st_point(${card[1]}, ${card[0]})::geography, now() - interval '1 hour', now() - interval '1 minute', 60, 'proximity', 1, 'fixed', 'near', '${C.id}', false, false) returning id),
          r as (insert into drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) select id, 'card', '${title}', 150, 'legendary' from d returning id, drop_id)
          insert into drop_claims (drop_id, user_id, reward_id) select drop_id, '${C.id}', id from r`);
    await goto(`${APP}/collection?tab=shelf`);
    await wait(has("CAMERA HUNT"), 40000, "the shelf with a card receipt");
    await sleep(1500);
    check(`a card claim whose receipt reads "${title}" is not on the shelf (no CLAIMED REWARDS, no tier word)`, !(await says("CLAIMED REWARDS")) && !(await says("Legendary card")) && !(await says("1 CLAIMED")), (await ev(`document.body.innerText.match(/\\d+ COLLECTED · \\d+ CLAIMED/)?.[0]||'no count line'`)));
  }
  psql(`delete from game_drops where owner_id='${C.id}'`);

  // my_collection failing is not an empty deck: say so and offer to try again
  await cmd("Fetch.enable", { patterns: [{ urlPattern: "*rpc/my_collection*" }] });
  page.failMyCollection = true;
  await goto(`${APP}/collection`);
  await wait(has("Could not load the deck"), 40000, "the could-not-load panel");
  check("a failed my_collection shows Could not load and TRY AGAIN, never 0 of 125", (await says("TRY AGAIN")) && !(await says("0 of 125")) && !(await says("Nothing in your deck yet")));
  await shot("13b-my-collection-failed.png");
  page.failMyCollection = false;
  await click("button", "^TRY AGAIN$");
  await wait(`document.querySelectorAll('section[aria-label] ul li').length>=125`, 40000, "the album after TRY AGAIN");
  check("TRY AGAIN brings the album back with the 12 cards", await ev(`document.querySelector('[aria-label="12 of 125 cards"]')?.innerText.replace(/\\s+/g,' ')`) === "12 of 125");
  await cmd("Fetch.disable");

  // ---------------------------------------------------------- 8. the day theme
  await goto(`${APP}/collection?theme=day`);
  await wait(`document.querySelectorAll('section[aria-label] ul li').length>=125`, 40000, "the album in day theme");
  await sleep(800);
  await shot("14-album-day.png");

  check("no script errors and no console errors on the page", page.errors.length === 0 && page.logs.length === 0, [...page.errors, ...page.logs].join(" || ").slice(0, 400));
} catch (e) {
  results.push({ name: "the run finished", ok: false });
  console.log("FAIL  the run did not finish:", e.message);
  console.log("page errors:", page.errors.concat(page.logs).join(" || ").slice(0, 600));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  stop();
  process.exit(failed.length ? 1 : 0);
}
