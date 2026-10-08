// usage: node shot.mjs <outdir> <path>[,<path>...] [theme]
import { createRequire } from "module";
const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const [, , out, paths, theme = "night"] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
// Skip the first-run title sequence and intro so screens are reachable.
await page.addInitScript(() => {
  try {
    const k = "hoppaz.v1";
    const cur = JSON.parse(localStorage.getItem(k) || '{"state":{},"version":0}');
    cur.state = { ...cur.state, seenTitle: true, seenIntro: true, fix: { lat: 6.4281, lng: 3.4219, source: "area", area: "Victoria Island" } };
    localStorage.setItem(k, JSON.stringify(cur));
  } catch {}
});
for (const p of paths.split(",")) {
  const url = `http://localhost:3000${p}${p.includes("?") ? "&" : "?"}theme=${theme}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const name = (p.replace(/[\/?=&]/g, "_") || "_root") + `-${theme}.png`;
  await page.screenshot({ path: `${out}/${name}` });
  console.log("shot", name);
}
await browser.close();
