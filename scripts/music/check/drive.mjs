/**
 * Checks the music audition page in ONE headless Chrome at 390x844, driven over the DevTools protocol, closed at the end.
 *
 *   node scripts/music/check/drive.mjs          everything (about 70 s): decode, wrap, seam, box test, picks, copy, reload, dusk, hidden, widths
 *   node scripts/music/check/drive.mjs short    decode, offline render and the live wrap capture only (about 40 s)
 *   node scripts/music/check/drive.mjs pad      pretends the phone leaves the MP3 delay and padding in, to run the trim path
 *
 * Needs the phone proxy running (localdb/phone-https/proxy.mjs, port 3443). MUSIC_URL overrides the address;
 * CHROME overrides the Chrome binary; CHECK_OUT is where drive-out.json and shot-top.png go (default: the OS temp folder).
 * Chrome is started with --mute-audio, so nothing is heard. Never run two of these at once.
 * hook.js is injected before the page loads: it records every Web Audio call and taps the live output.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.CHECK_OUT || path.join(os.tmpdir(), "hz-music-check");
fs.mkdirSync(OUT_DIR, { recursive: true });
const PORT = Number(process.env.CHECK_PORT || 9333);
const PROF = path.join(OUT_DIR, "chrome-prof");
const only = process.argv[2] || "all";
const URL = (process.env.MUSIC_URL || "https://localhost:3443/mocks/music") + (only === "pad" ? "?pad=1" : "");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HOOK = fs.readFileSync(path.join(here, "hook.js"), "utf8");
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (k, v) => { out[k] = v; console.log("## " + k + "\n" + (typeof v === "string" ? v : JSON.stringify(v, null, 1))); };

fs.rmSync(PROF, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`,
  "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", "--disable-sync", "--mute-audio",
  "--window-size=390,844", "about:blank",
], { stdio: "ignore" });
let closed = false;
async function shutdown() {
  if (closed) return; closed = true;
  try { await cdpSend("Browser.close"); } catch { /* ignore */ }
  await sleep(500);
  try { chrome.kill("SIGTERM"); } catch { /* ignore */ }
  await sleep(500);
  try { execSync(`pkill -f -- "--user-data-dir=${PROF}"`); } catch { /* none left */ }
  fs.rmSync(PROF, { recursive: true, force: true });
}
const killer = setTimeout(async () => { console.log("TIMEOUT, shutting down"); await shutdown(); process.exit(3); }, 240000);

let ws, nextId = 1; const pending = new Map(); const listeners = [];
function cdpSend(method, params = {}) {
  return new Promise((ok, no) => {
    const id = nextId++; pending.set(id, { ok, no, method });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); no(new Error("cdp timeout " + method)); } }, 60000);
  });
}
async function ev(expr, awaitPromise = true) {
  const r = await cdpSend("Runtime.evaluate", { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error("page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function waitFor(expr, ms = 15000, label = expr) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await ev(expr)) return Date.now() - t; await sleep(100); }
  throw new Error("timeout waiting for " + label);
}
async function click(sel, idx = 0) {
  const r = await ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${idx}]; if (!el) return null;
    el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect();
    const x = b.x + b.width / 2, y = b.y + b.height / 2; const top = document.elementFromPoint(x, y);
    return { x, y, hit: top === el || el.contains(top), dis: !!el.disabled }; })()`);
  if (!r) throw new Error("no element " + sel);
  if (!r.hit) throw new Error("covered: " + sel);
  await cdpSend("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  return r;
}
const consoleMsgs = [];

async function main() {
  let tgt;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); tgt = l.find((x) => x.type === "page"); if (tgt) break; } catch { /* not up */ }
    await sleep(250);
  }
  if (!tgt) throw new Error("chrome did not start");
  ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.no(new Error(p.method + ": " + d.error.message)) : p.ok(d.result); }
    else if (d.method) {
      if (d.method === "Runtime.consoleAPICalled") consoleMsgs.push({ t: d.params.type, text: d.params.args.map((a) => a.value ?? a.description).join(" ") });
      if (d.method === "Runtime.exceptionThrown") consoleMsgs.push({ t: "exception", text: d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text });
      if (d.method === "Log.entryAdded") consoleMsgs.push({ t: "log." + d.params.entry.level, text: d.params.entry.text + " " + (d.params.entry.url || "") });
    }
  };
  for (const m of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"]) await cdpSend(m);
  await cdpSend("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdpSend("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  try { await cdpSend("Browser.grantPermissions", { origin: "https://localhost:3443", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }); } catch (e) { report("grantPermissions", String(e.message)); }
  const t0 = Date.now();
  await cdpSend("Page.navigate", { url: URL });
  await waitFor(`document.readyState === "complete" && !!document.getElementById("list").children.length`, 30000, "page load");
  report("load", { ms: Date.now() - t0, title: await ev("document.title") });

  // layout + state before any tap
  report("before first tap", await ev(`({
    ctxCreated: !!window.__ctx,
    cards: document.querySelectorAll(".trk").length,
    sections: [...document.querySelectorAll(".lane h2")].map((h) => h.textContent),
    overflow: document.documentElement.scrollWidth > innerWidth,
    scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight,
    picksLine: document.getElementById("picks").textContent,
    chk: [...document.querySelectorAll(".chk")].map((c) => c.textContent),
    ls: localStorage.getItem("hz-music-picks"),
  })`));

  const ids = await ev(`[...document.querySelectorAll(".trk")].map((c) => c.id.slice(4))`);
  const keymap = await ev(`(() => { const A = JSON.parse(document.getElementById("audio").textContent); const m = {};
    for (const k of Object.keys(A)) { const s = atob(A[k].slice(A[k].indexOf(",") + 1)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); m[window.__hashBuf(u.buffer)] = k; } return m; })()`);
  const keyOf = Object.fromEntries(Object.entries(keymap).map(([h, k]) => [k, h]));
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, "../../../public/music/try/manifest.json"), "utf8").toString());

  // 1. first tap: Play on card 1, all loops decode
  await click(`#trk-${ids[0]} button[data-act="play"]`);
  await waitFor(`!!window.__ctx && window.__ctx.state === "running"`, 5000, "ctx running");
  const decMs = await waitFor(`[...document.querySelectorAll(".chk")].every((c) => /^Loop check: (exact|this phone added)/.test(c.textContent))`, 40000, "all loops decoded");
  const ctxInfo = await ev(`({ sr: window.__ctx.sampleRate, state: window.__ctx.state, base: window.__ctx.baseLatency, out: window.__ctx.outputLatency })`);
  const dec = await ev(`window.__log.filter((x) => x.e === "decoded")`);
  const sr = ctxInfo.sr;
  report("decode", {
    waitedMs: decMs, ctx: ctxInfo,
    chk: await ev(`[...document.querySelectorAll(".chk")].map((c) => c.textContent)`),
    tracks: ids.map((id) => {
      const d = dec.find((x) => x.key === keyOf[id]); const m = manifest.find((x) => x.name === id);
      const want = Math.round((m.loopSamples / m.sampleRate) * sr);
      return { id, decodedLen: d && d.len, wantLen: want, diff: d && d.len - want, sr: d && d.sr, ch: d && d.ch, manifestSamples: m.loopSamples };
    }),
    boxSounds: Object.keys(keyOf).filter((k) => !ids.includes(k)).map((k) => ({ k, decoded: !!dec.find((x) => x.key === keyOf[k]) })),
  });

  if (only === "pad") {
    await click(`#trk-${ids[0]} button[data-act="play"]`); await sleep(400); // stop
    const live = [];
    for (const id of ids) {
      await ev(`(() => { const r = window.__rec; r.pts.length = 0; r.chunks.length = 0; r.on = true; })()`);
      await click(`#trk-${id} button[data-act="seam"]`);
      await waitFor(`document.querySelector("#trk-${id} .seams").textContent === "Seams passed 1"`, 12000, "seam passed " + id);
      await sleep(3200);
      await ev(`window.__rec.on = false`);
      const an = await ev(`window.__analyze(${JSON.stringify(keyOf[id])}, 0.35)`);
      const st = await ev(`window.__log.filter((x) => x.e === "start" && x.key === ${JSON.stringify(keyOf[id])}).pop()`);
      live.push({ id, ls: st.ls, le: st.le, bufDur: st.bdur, pre: an.pre, post: an.post, shiftDiff: an.shiftDiff, residNear: an.residNear, blockGaps: an.blockGaps });
      await click(`#trk-${id} button[data-act="play"]`); await sleep(400);
    }
    report("padded-buffer fallback", live);
    // page hidden fades the music out
    await click(`#trk-${ids[0]} button[data-act="play"]`); await sleep(800);
    const playing = await ev(`document.querySelector("#trk-${ids[0]} .gol").textContent`);
    await ev(`(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); })()`);
    await sleep(800);
    report("page hidden", { before: playing, after: await ev(`document.querySelector("#trk-${ids[0]} .gol").textContent`), ctxState: await ev(`window.__ctx.state`),
      stops: await ev(`window.__log.filter((x) => x.e === "stop").length`) });
    report("console", consoleMsgs);
    return;
  }

  // 2. Play running: loop params and clock
  const c1 = await ev(`({ ct: window.__ctx.currentTime, w: performance.now() })`);
  await sleep(2000);
  const c2 = await ev(`({ ct: window.__ctx.currentTime, w: performance.now(), btn: document.querySelector("#trk-${ids[0]} .gol").textContent, msg: document.querySelector("#trk-${ids[0]} .msg").textContent, time: document.querySelector("#trk-${ids[0]} .time").textContent })`);
  const s0 = await ev(`window.__log.filter((x) => x.e === "start" && x.loop)[0]`);
  report("play 1", { clockRatio: +((c2.ct - c1.ct) / ((c2.w - c1.w) / 1000)).toFixed(3), btn: c2.btn, msg: c2.msg, time: c2.time, start: s0 });
  await click(`#trk-${ids[0]} button[data-act="play"]`);
  await sleep(500);
  report("after stop", await ev(`({ btn: document.querySelector("#trk-${ids[0]} .gol").textContent, live: window.__log.filter((x) => x.e === "stop").length })`));

  // 3. offline render, bit exactness and step at the wrap, all three
  const offl = [];
  for (const id of ids) {
    const lg = await ev(`window.__log.filter((x) => x.e === "start" && x.key === ${JSON.stringify(keyOf[id])}).pop() || null`);
    offl.push({ id, ...(await ev(`window.__offline(${JSON.stringify(keyOf[id])}, ${lg ? lg.ls : 0}, ${lg ? lg.le : 0})`)) });
  }
  report("offline render", offl);

  // 4. live capture across the seam: Jump to the seam on each loop
  const live = [];
  for (const id of ids) {
    await ev(`(() => { const r = window.__rec; r.pts.length = 0; r.chunks.length = 0; r.on = true; })()`);
    await click(`#trk-${id} button[data-act="seam"]`);
    await waitFor(`document.querySelector("#trk-${id} .seams").textContent === "Seams passed 1"`, 12000, "seam passed " + id);
    const msg = await ev(`document.querySelector("#trk-${id} .msg").textContent`);
    await sleep(3200);
    await ev(`window.__rec.on = false`);
    const an = await ev(`window.__analyze(${JSON.stringify(keyOf[id])}, 0.35)`);
    live.push({ id, msgAtWrap: msg, ...an });
    await click(`#trk-${id} button[data-act="play"]`); // stops it
    await sleep(400);
  }
  report("live seam capture", live);
  if (only === "short") { await shutdown(); return; }

  // 5. box test with the loop stopped
  await ev(`window.__log.length = 0`);
  await click(`#trk-${ids[0]} button[data-act="box"]`);
  await sleep(3400);
  const starts = await ev(`window.__log.filter((x) => x.e === "start")`);
  const nm = (k) => (Object.entries(keymap).find(([h]) => h === k) || [0, k])[1];
  const bx = starts.map((s) => ({ what: nm(s.key), when: +s.when.toFixed(3), t: +s.t.toFixed(3), gain: s.gain, loop: s.loop }));
  const burst = bx.find((b) => b.what === "box_burst_common"); const motif = bx.find((b) => b.what === "hoppaz_three_full");
  report("box test", { starts: bx, burstToMotif: burst && motif ? +(motif.when - burst.when).toFixed(3) : null,
    loopToBurst: burst ? +(burst.when - bx[0].when).toFixed(3) : null, expectGains: { burst: +(0.621 * 0.7).toFixed(3), motif: +(0.708 * 0.7).toFixed(3) } });
  await click(`#trk-${ids[0]} button[data-act="play"]`); await sleep(300);

  // 6. copy before any pick, then picks
  const copyBefore = await (async () => { await ev(`window.__clip.length = 0`); await click("#copy"); await sleep(400); return { clip: await ev(`window.__clip`), btn: await ev(`document.getElementById("copy").textContent`) }; })();
  const pickTargets = [ids[0], ids.find((i) => i.startsWith("play_night")), ids.find((i) => i.startsWith("menu"))];
  for (const id of pickTargets) { await click(`#trk-${id} button[data-act="pick"]`); await sleep(100); }
  await ev(`window.__clip.length = 0`);
  await sleep(2400); // let the Copied label reset
  await click("#copy"); await sleep(400);
  report("copy + picks", {
    copyBeforeAnyPick: copyBefore,
    picksLine: await ev(`document.getElementById("picks").textContent`),
    counts: await ev(`[...document.querySelectorAll(".lane-count")].map((c) => c.textContent)`),
    pressed: await ev(`[...document.querySelectorAll(".pick")].map((b) => b.getAttribute("aria-pressed") + ":" + b.textContent)`),
    jump: await ev(`[...document.querySelectorAll("#jump a")].map((a) => a.textContent)`),
    ls: await ev(`localStorage.getItem("hz-music-picks")`),
    clipAfter: await ev(`window.__clip`), btn: await ev(`document.getElementById("copy").textContent`),
  });
  // one pick per section: pick the same card twice clears it, picking another would replace (only 1 per slot here)
  await click(`#trk-${pickTargets[2]} button[data-act="pick"]`); await sleep(100);
  const cleared = await ev(`document.getElementById("picks").textContent`);
  await click(`#trk-${pickTargets[2]} button[data-act="pick"]`); await sleep(100);
  report("toggle pick", { afterSecondTap: cleared, afterThirdTap: await ev(`document.getElementById("picks").textContent`) });

  // 7. reload: picks persist, no context created
  await cdpSend("Page.reload");
  await sleep(500);
  await waitFor(`document.readyState === "complete" && !!document.getElementById("list").children.length`, 30000, "reload");
  report("after reload", await ev(`({ picksLine: document.getElementById("picks").textContent, ls: localStorage.getItem("hz-music-picks"),
    pressed: [...document.querySelectorAll(".pick")].map((b) => b.getAttribute("aria-pressed")), ctxCreated: !!window.__ctx, hooked: !!window.__hooked })`));

  // 8. dusk: day to night then night to day
  await click(`#trk-${ids[0]} button[data-act="play"]`);
  await waitFor(`[...document.querySelectorAll(".chk")].every((c) => /^Loop check: (exact|this phone added)/.test(c.textContent))`, 40000, "decode again");
  await click(`#trk-${ids[0]} button[data-act="play"]`); await sleep(500); // stop, so dusk starts day from silence
  await ev(`window.__log.length = 0`);
  const dBtn0 = await ev(`document.getElementById("duskgo").textContent`);
  await click("#duskgo");
  await sleep(1000);
  const note1 = await ev(`document.getElementById("duskmsg").textContent`);
  await waitFor(`/^Night is on/.test(document.getElementById("duskmsg").textContent)`, 20000, "day to night done");
  const lg1 = await ev(`window.__log.filter((x) => x.e !== "ctx")`);
  const dBtn1 = await ev(`document.getElementById("duskgo").textContent`);
  const sum = (lg, tag) => {
    const st = lg.filter((x) => x.e === "start" && x.loop).map((s) => ({ key: nm(s.key), when: +s.when.toFixed(4), off: +s.off.toFixed(4), gid: s.gid, bdur: +s.bdur.toFixed(4) }));
    const cv = lg.filter((x) => x.e === "param" && x.m === "setValueCurveAtTime").map((p) => ({ gid: p.gid, n: p.a[0].length, first: +p.a[0][0].toFixed(3), mid: +p.a[0][64].toFixed(3), last: +p.a[0][127].toFixed(3), when: +p.a[1].toFixed(4), dur: p.a[2] }));
    return { tag, starts: st, curves: cv };
  };
  const a = sum(lg1, "day->night");
  const day = a.starts[0], night = a.starts[1];
  const at = a.curves[0] && a.curves[0].when;
  let fracDay = null, fracNight = null;
  if (day && night && at != null) {
    const Ld = day.bdur; const Ln = night.bdur;
    fracDay = (((at - day.when + day.off) % Ld) / Ld); fracNight = night.off / Ln;
  }
  const eq = a.curves.length === 2 ? +(a.curves.find((c) => c.first === 1).mid ** 2 + a.curves.find((c) => c.first === 0).mid ** 2).toFixed(3) : null;
  report("dusk day->night", { btnBefore: dBtn0, noteAt1s: note1, btnAfter: dBtn1, ...a, fadeStartSameForBoth: a.curves.length === 2 && a.curves[0].when === a.curves[1].when,
    fracDay: fracDay && +fracDay.toFixed(5), fracNight: fracNight && +fracNight.toFixed(5), fracDiff: fracDay != null ? +Math.abs(fracDay - fracNight).toExponential(2) : null,
    leadBeforeFade: day && at != null ? +(at - day.when).toFixed(2) : null, equalPowerMid: eq,
    linearRampFallbacks: lg1.filter((x) => x.e === "param" && x.m === "linearRampToValueAtTime" && at != null && Math.abs(x.a[1] - (at + 3)) < 1e-4).length });
  await ev(`window.__log.length = 0`);
  await click("#duskgo");
  await waitFor(`/^Day is on/.test(document.getElementById("duskmsg").textContent)`, 20000, "night to day done");
  const lg2 = await ev(`window.__log.filter((x) => x.e !== "ctx")`);
  const b = sum(lg2, "night->day");
  report("dusk night->day", { btnAfter: await ev(`document.getElementById("duskgo").textContent`), ...b, startsLoop: b.starts.map((s) => s.key) });

  // 9. page hidden fades the music out
  if ((await ev(`document.querySelector("#trk-${ids[0]} .gol").textContent`)) === "Play") { await click(`#trk-${ids[0]} button[data-act="play"]`); await sleep(800); }
  const playing = await ev(`document.querySelector("#trk-${ids[0]} .gol").textContent`);
  await ev(`(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); })()`);
  await sleep(800);
  report("page hidden", { before: playing, after: await ev(`document.querySelector("#trk-${ids[0]} .gol").textContent`), ctxState: await ev(`window.__ctx.state`) });
  await ev(`delete document.hidden`);

  // 10. widths
  const widths = [];
  for (const w of [320, 360, 375, 390, 430]) {
    await cdpSend("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(150);
    widths.push({ w, scrollW: await ev(`document.documentElement.scrollWidth`), overflow: await ev(`document.documentElement.scrollWidth > innerWidth`) });
  }
  report("widths", widths);
  await cdpSend("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(`window.scrollTo(0, 0)`);
  const shot = await cdpSend("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT_DIR, "shot-top.png"), Buffer.from(shot.data, "base64"));

  report("console", consoleMsgs);
}

try { await main(); } catch (e) { console.log("FAILED: " + e.message); out.failed = e.message; if (consoleMsgs.length) console.log("console: " + JSON.stringify(consoleMsgs)); }
finally { clearTimeout(killer); await shutdown(); fs.writeFileSync(path.join(OUT_DIR, "drive-out.json"), JSON.stringify(out, null, 1)); setTimeout(() => process.exit(0), 200); }
