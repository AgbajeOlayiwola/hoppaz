// ============================================================================
// Hoppaz hotspots: headless check of the phone map mock (/mocks/hotspots) at 390x844 and 375x667.
//
//   node scripts/hotspots/check-map.mjs
//   MOCK_URL=https://localhost:3443/mocks/hotspots node scripts/hotspots/check-map.mjs   (self-signed: cert errors are ignored for localhost)
//   SHOTS=<dir> to keep the screenshots somewhere (default: a folder in the temp dir)
//
// LOAD RULE: it starts ONE headless Chrome, runs its steps one after another in that one page, and
// always kills it at the end (also on an error or Ctrl-C). Never run two of these at once.
// Needs the local Supabase in Docker (supabase_db_hoppaz-local) with supabase/hotspot_zones.sql
// loaded: the page's answers are compared with PostGIS.
// Geolocation is mocked with the DevTools protocol: public junction coordinates (and one point over
// the Ogun State line), never a real person's location. Exit code 1 if any check fails.
// ============================================================================
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOTS = path.resolve(process.env.SHOTS || path.join(os.tmpdir(), "hoppaz-hotspot-shots"));
const PORT = 9461;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "hoppaz-hotspot-chrome-"));
const URL_ = process.env.MOCK_URL || "http://127.0.0.1:3444/mocks/hotspots";
const ORIGIN = new URL(URL_).origin;
const LOCAL_TLS = new URL(URL_).protocol === "https:" && ["localhost", "127.0.0.1"].includes(new URL(URL_).hostname);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`); };

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--disable-background-networking",
  ...(LOCAL_TLS ? ["--ignore-certificate-errors"] : []),
  ...(process.env.SWIFTSHADER ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
  "--window-size=390,844", "about:blank",
], { stdio: "ignore" });
let ws;
const stop = () => { try { ws?.close(); } catch {} try { chrome.kill("SIGTERM"); } catch {} try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} };
process.on("exit", stop);
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("Chrome did not come up");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  let nid = 0;
  const pending = new Map();
  var consoleSeen = [], requests = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") consoleSeen.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
    else if (d.method === "Runtime.consoleAPICalled" && ["warning", "error"].includes(d.params.type)) consoleSeen.push(d.params.type + " " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    else if (d.method === "Network.requestWillBeSent") requests.push({ url: d.params.request.url, method: d.params.request.method, hasBody: !!d.params.request.postData });
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++nid;
    pending.set(i, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const tap = async (x, y) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(40);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const tapEl = async (sel) => {
    const r = await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
    await tap(r[0], r[1]);
  };
  const idle = () => ev(`new Promise(r=>{const m=__hz.map;const done=()=>r(true);if(!m.isMoving()&&m.loaded())return setTimeout(done,150);m.once('idle',()=>setTimeout(done,150));setTimeout(done,9000)})`);
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const f = path.join(SHOTS, name);
    fs.writeFileSync(f, Buffer.from(r.data, "base64"));
    return f;
  };
  const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);

  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  try { await send("Browser.grantPermissions", { permissions: ["geolocation"], origin: ORIGIN }); } catch (e) { console.log("grantPermissions on page target:", e.message); }

  // ------------------------------------------------------------------ 1. load
  const t0 = Date.now();
  await send("Page.navigate", { url: URL_ });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { await sleep(500); try { ready = await ev("!!(window.__hz&&window.__hz.ready)"); } catch {} }
  check("page loads and the map is ready", ready, `${Date.now() - t0} ms`);
  if (!ready) { console.log(consoleSeen.join("\n")); throw new Error("not ready"); }
  await idle();
  const baseOk = await ev("!/did not load/.test(document.getElementById('credit').textContent)");
  check("basemap tiles loaded (CARTO dark-matter, app night paint)", baseOk);
  check("viewport is 390 wide and the page does not scroll sideways", await ev("innerWidth===390 && document.documentElement.scrollWidth<=390"), await ev("innerWidth+' / '+document.documentElement.scrollWidth"));
  check("title and counter", (await ev("document.title")) === "Hoppaz hotspots" && (await ev("document.getElementById('countN').textContent+' '+document.getElementById('countT').textContent")) === "13 hotspots across Lagos", await ev("document.getElementById('countN').textContent+' '+document.getElementById('countT').textContent"));

  // ------------------------------------------------------------------ 2. every zone and pin renders
  const rendered = await ev(`(()=>{const m=__hz.map;const u=(l)=>[...new Set(m.queryRenderedFeatures({layers:[l]}).map(f=>f.properties.slug||f.properties.zone))];
    return {zones:u('zone-fill'),lines:u('zone-line'),pins:u('pins'),names:m.queryRenderedFeatures({layers:['zone-names']}).length,layers:['zone-fill','zone-line','zone-names','pins','split-line'].map(id=>id+':'+!!m.getLayer(id)).join(' ')}})()`);
  check("all 13 zones are drawn (fill)", rendered.zones.length === 13, `${rendered.zones.length}`);
  check("all 13 zone outlines are drawn", rendered.lines.length === 13, `${rendered.lines.length}`);
  check("all 13 pins are drawn", rendered.pins.length === 13, `${rendered.pins.length}`);
  console.log("   zone names placed (collision hides the rest at this zoom):", rendered.names);
  const shotOverview = await shot("hotspots-map.png");
  console.log("   shot", shotOverview);

  // ------------------------------------------------------------------ 3. tap a pin
  const pinXY = (slug) => ev(`(()=>{const s=__hz.spots.get('${slug}');const p=__hz.map.project([s.lng,s.lat]);return [p.x,p.y-18]})()`); // the head, 18 px above the tip
  let [px, py] = await pinXY("surulere");
  await tap(px, py);
  await sleep(300); await idle();
  check("tap a pin opens its card", (await ev("__hz.selected")) === "surulere", await ev("__hz.selected"));
  const card = await text("#card");
  check("the selected hotspot's name is drawn on the map", (await ev(`[...new Set(__hz.map.queryRenderedFeatures({layers:['pin-names']}).map(f=>f.properties.slug))]`)).includes("surulere"), (await ev(`__hz.map.queryRenderedFeatures({layers:['pin-names']}).length`)) + " pin names drawn at zoom " + (await ev("__hz.map.getZoom().toFixed(1)")));
  check("card: hotspot name", /OJUELEGBA|Ojuelegba/.test(await text("#card h2")), await text("#card h2"));
  check("card: zone label", /Surulere, Mushin and Oshodi zone/i.test(card));
  check("card: the junction's two roads", /Western Avenue/.test(card) && /Ojuelegba Road/.test(card));
  check("card: areas in the zone", /Surulere/.test(card) && /Okota/.test(card) && /Hoppaz areas here: Mushin, Surulere/.test(card));
  check("card: first split line", /When it gets busy, splits at the Oshodi-Isolo LGA line\./.test(card), (card.match(/When it gets busy[^\n]*/) || [""])[0]);
  check("card fits above the buttons without covering them", await ev(`(()=>{const c=document.getElementById('card').getBoundingClientRect(),w=document.getElementById('where').getBoundingClientRect();return c.bottom<=w.top+1})()`));
  check("selected zone is highlighted", (await ev(`JSON.stringify(__hz.map.getFilter('zone-sel-line'))`)).includes("surulere"));
  const shotCard = await shot("hotspots-map-card.png");

  // close with the X (touch)
  await tapEl("#cardX"); await sleep(250);
  check("card closes with its X", (await ev("__hz.selected")) === null && (await ev("document.getElementById('card').hidden")) === true);

  // the notes: since 10 Oct no name is "Check this name" (Mile 2, Bourdillon and Ikorodu Garage are Jae's calls);
  // Ikoyi and Ikorodu have a "Worth knowing" note, Mile 2 and Ajah have none
  for (const [slug, want] of [["festac", ""], ["ikoyi", "Worth knowing"], ["ikorodu", "Worth knowing"], ["ajah", ""]]) {
    await ev(`(__hz.map.jumpTo({center:[__hz.spots.get('${slug}').lng,__hz.spots.get('${slug}').lat],zoom:12.5}),0)`);
    await idle();
    const [qx, qy] = await pinXY(slug);
    await tap(qx, qy); await sleep(300); await idle();
    const label = await ev("(document.querySelector('#card .check em')||{}).textContent||''");
    check(`card note for ${slug}: "${want || "none"}"`, (await ev("__hz.selected")) === slug && label === want, `selected ${await ev("__hz.selected")}, note "${label}"`);
    await tapEl("#cardX"); await sleep(200);
  }

  // ------------------------------------------------------------------ 4. tap a zone (away from every pin)
  await tapEl("#reset"); await sleep(300); await idle();
  const findSpot = (z) => ev(`(()=>{const m=__hz.map,pins=[...__hz.spots.values()].map(s=>m.project([s.lng,s.lat]));
    const top=document.getElementById('top').getBoundingClientRect().bottom+8,bot=document.getElementById('dock').getBoundingClientRect().top-8;
    let best=null,bd=1e9;const c=__hz.spots.get('${z}'),cp=m.project([c.lng,c.lat]);
    for(let y=top;y<bot;y+=4)for(let x=8;x<innerWidth-8;x+=4){
      const ll=m.unproject([x,y]);if(__hz.zoneAt(ll.lng,ll.lat)!=='${z}')continue;
      if(pins.some(q=>Math.abs(q.x-x)<=38&&y>=q.y-56&&y<=q.y+50))continue;   // outside every pin's tap box, with a margin
      const d=Math.hypot(x-cp.x,y-cp.y);if(d<bd){bd=d;best=[x,y]}}
    return best})()`);
  const spot = await findSpot("alimosho");
  check("found an empty spot inside the Alimosho zone to tap", !!spot, JSON.stringify(spot));
  if (spot) { await tap(spot[0], spot[1]); await sleep(300); await idle(); }
  check("tap a zone opens its card", (await ev("__hz.selected")) === "alimosho" && /Ikotun/i.test(await text("#card h2")), `${await ev("__hz.selected")} / ${await text("#card h2")}`);
  check("zone card shows roads and split line", /Idimu - Ikotun Road/.test(await text("#card")) && /Egbe Road/.test(await text("#card")) && /splits at Egbeda-Idimu Road/.test(await text("#card")), (await text("#card")).replace(/\n+/g, " | ").slice(0, 160));
  // and the other big zone, Ikorodu, from the overview
  await tapEl("#reset"); await sleep(300); await idle();
  const spot2 = await findSpot("ikorodu");
  if (spot2) { await tap(spot2[0], spot2[1]); await sleep(300); await idle(); }
  check("tap the Ikorodu zone opens its card", !!spot2 && (await ev("__hz.selected")) === "ikorodu", `${await ev("__hz.selected")}`);
  await tapEl("#reset"); await sleep(300); await idle();

  // ------------------------------------------------------------------ 5. Show future splits
  await tapEl("#splits"); await sleep(400); await idle();
  const sp = await ev(`(()=>{const m=__hz.map;return {on:document.getElementById('splits').getAttribute('aria-checked'),vis:m.getLayoutProperty('split-line','visibility'),kids:m.getLayoutProperty('kids','visibility'),
    slugs:[...new Set(m.queryRenderedFeatures({layers:['split-line']}).map(f=>f.properties.slug))],legend:!document.getElementById('legend').hidden,
    dash:JSON.stringify(m.getPaintProperty('split-line','line-dasharray'))}})()`);
  check("toggle turns future splits on (dashed lines shown)", sp.on === "true" && sp.vis === "visible" && sp.legend && sp.dash === "[2.2,1.6]", JSON.stringify({ on: sp.on, vis: sp.vis, dash: sp.dash }));
  const totalCuts = await ev("__hz.map.getSource('splits')._data.features.length");
  check("every zone has a dashed split line in the data", totalCuts === 13, `${totalCuts}`);
  console.log("   split lines inside the overview frame:", sp.slugs.length, sp.slugs.join(","));
  const shotSplits = await shot("hotspots-map-splits.png");
  await tapEl("#splits"); await sleep(300);
  check("toggle turns them off again", (await ev("__hz.map.getLayoutProperty('split-line','visibility')")) === "none");

  // ------------------------------------------------------------------ 6. Where am I with mocked points
  const mkExpect = (lat, lng) => {
    const q = `select coalesce((select slug from hotspots where st_covers(zone_geom, st_setsrid(st_makepoint(${lng},${lat}),4326)) order by slug limit 1),'-') || '|' || (select slug from hotspots order by st_distance(zone_geom::geography, st_setsrid(st_makepoint(${lng},${lat}),4326)::geography) limit 1)`;
    const out = execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c", q], { encoding: "utf8" }).trim();
    const [covers, nearest] = out.split("|");
    return covers !== "-" ? { slug: covers, covered: true } : { slug: nearest, covered: false };
  };
  // Three of these are junctions that sit on an LGA line (Jibowu, Obalende, Ojota): the 150 m rule must give each to its own zone.
  const points = [
    { label: "at the Jibowu junction (mock)", lat: 6.5167, lng: 3.36862, shortExpect: "Jibowu" },
    { label: "at the Obalende junction (mock)", lat: 6.44931, lng: 3.40712, shortExpect: "Obalende" },
    { label: "at the Ojota junction (mock)", lat: 6.58853, lng: 3.37953, shortExpect: "Ojota" },
    { label: "at the Ajah Mobil Road junction (mock)", lat: 6.46563, lng: 3.5616, shortExpect: "Ajah" },
    { label: "over the line in Ogun State (mock)", lat: 6.78, lng: 3.2, shortExpect: null },
  ];
  let shotWhere = null;
  for (const p of points) {
    await send("Emulation.setGeolocationOverride", { latitude: p.lat, longitude: p.lng, accuracy: 25 });
    const before = requests.length;
    await ev("document.getElementById('foundX').click()"); await sleep(100);
    await tapEl("#where");
    let said = "";
    for (let i = 0; i < 40 && !said; i++) { await sleep(250); said = await ev("document.getElementById('found').hidden?'':document.getElementById('foundMain').innerText"); }
    await sleep(400); await idle();
    const exp = mkExpect(p.lat, p.lng); const slug = exp.slug; p.covered = exp.covered;
    const want = await ev(`__hz.spots.get('${slug}').short`);
    const gotSlug = await ev("__hz.selected");
    check(`Where am I, ${p.label}: "${said}"`, said === `Your hotspot: ${want}` && gotSlug === slug && (await ev("__hz.mine&&__hz.mine.slug")) === slug, `expected ${slug} (${want}), got ${gotSlug}; PostGIS agrees`);
    const youTag = await ev("!!document.querySelector('#card .tag.you')");
    check(`  card carries the YOUR HOTSPOT tag, ${p.label}`, youTag);
    const sent = requests.slice(before).filter((r) => r.method !== "GET" || r.hasBody || r.url.includes(String(p.lat).slice(0, 5)) || r.url.includes(String(p.lng).slice(0, 5)));
    check(`  the location went nowhere (no request carries it), ${p.label}`, sent.length === 0, `${requests.length - before} requests since the tap, ${sent.length} suspicious`);
    if (p.shortExpect === "Jibowu") shotWhere = await shot("hotspots-map-where.png");
    p.sub = await text("#foundSub");
  }
  const outside = points.filter((p) => !p.covered);
  check("at least one mock point is outside every zone (the nearest-zone branch runs)", outside.length >= 1, `${outside.length} of ${points.length}`);
  check("outside every zone: it says so and uses the nearest zone", outside.every((p) => /over the line/i.test(p.sub)) && points.filter((p) => p.covered).every((p) => !/over the line/i.test(p.sub)), outside.map((p) => p.sub).join(" | "));
  await ev("document.getElementById('foundX').click()");
  check("dismissing the answer clears the dot and the halo", (await ev("__hz.map.getSource('you')._data.features.length")) === 0 && (await ev("__hz.mine")) === null);

  // denied location: no stub of success
  await send("Emulation.setGeolocationOverride", {});
  // ------------------------------------------------------------------ 7. point-in-polygon parity with PostGIS (400 pseudo-random points over the zones' box, not real locations)
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pts = Array.from({ length: 400 }, () => [3.12 + rnd() * 0.66, 6.35 + rnd() * 0.40]);
  const mine = await ev(`${JSON.stringify(pts)}.map(p=>__hz.zoneAt(p[0],p[1]))`);
  const values = pts.map((p, i) => `(${i},st_setsrid(st_makepoint(${p[0]},${p[1]}),4326))`).join(",");
  const out = execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c",
    `select i, coalesce((select string_agg(slug,',' order by slug) from hotspots h where st_covers(h.zone_geom, p)),'-') from (values ${values}) v(i,p) order by i`], { encoding: "utf8", maxBuffer: 1 << 26 });
  const pg = out.trim().split("\n").map((l) => l.split("|")[1]);
  let bad = 0, inside = 0;
  pts.forEach((_, i) => { const covers = pg[i] === "-" ? [] : pg[i].split(","); if (covers.length) inside++; const ok = covers.length === 0 ? mine[i] === null : covers.includes(mine[i]); if (!ok) { bad++; if (bad < 5) console.log("   mismatch", i, mine[i], pg[i]); } });
  check("point-in-polygon in the page matches PostGIS on 400 test points", bad === 0, `${inside} inside a zone, ${400 - inside} outside, ${bad} mismatches`);

  // ------------------------------------------------------------------ 8. touch targets at 390
  const targets = await ev(`[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>{const r=b.getBoundingClientRect();return b.id+':'+Math.round(r.width)+'x'+Math.round(r.height)}).join(' ')`);
  const small = await ev(`[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).filter(b=>{const r=b.getBoundingClientRect();return r.width<44||r.height<44}).map(b=>b.id)`);
  check("touch targets are 44 px or bigger (390 wide)", small.length === 0, targets);

  // ------------------------------------------------------------------ 9. 375 wide
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
  await ev("(__hz.map.resize(), 0)"); await sleep(400);
  await tapEl("#reset"); await sleep(300); await idle();
  [px, py] = await pinXY("lekki"); await tap(px, py); await sleep(300); await idle();
  const lay = await ev(`(()=>{const q=(s)=>document.querySelector(s).getBoundingClientRect();const rect=(s)=>{const r=q(s);return {width:r.width,height:r.height,right:r.right}};return {sw:document.documentElement.scrollWidth,w:innerWidth,top:q('#top').bottom,dock:q('#dock').top,dockH:q('#dock').height,card:q('#card').height,wh:rect('#where'),sp:rect('#splits'),sel:__hz.selected}})()`);
  check("375 px: no sideways scroll", lay.sw <= 375 && lay.w === 375, `${lay.sw} / ${lay.w}`);
  check("375 px: header and dock leave map showing", lay.dock - lay.top > 120, `map visible ${Math.round(lay.dock - lay.top)} px of 667 (dock ${Math.round(lay.dockH)} px, card ${Math.round(lay.card)} px)`);
  check("375 px: both buttons fit side by side and stay 44 px tall", lay.wh.width >= 100 && lay.sp.width >= 100 && lay.wh.height >= 44 && lay.sp.height >= 44 && lay.wh.right <= 375 && lay.sp.right <= 375, `where ${Math.round(lay.wh.width)}x${Math.round(lay.wh.height)}, splits ${Math.round(lay.sp.width)}x${Math.round(lay.sp.height)}`);
  const shot375 = await shot("hotspots-map-375.png");

  // ------------------------------------------------------------------ console
  const errs = consoleSeen.filter((l) => /^EXCEPTION|^error/.test(l));
  check("no script errors in the console", errs.length === 0, errs.slice(0, 3).join(" || "));
  if (consoleSeen.length) console.log("   console:", consoleSeen.slice(0, 6).join("\n            "));
  console.log("\nshots:", [shotOverview, shotCard, shotSplits, shotWhere, shot375].filter(Boolean).map((f) => f + " " + fs.statSync(f).size + " B").join("\n       "));
} catch (e) {
  console.log("ERROR", e.message);
  try { console.log("console:", consoleSeen.slice(0, 8).join("\n         ")); } catch {}
  results.push({ name: "harness", ok: false, detail: e.message });
} finally {
  stop();
  await sleep(500);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
