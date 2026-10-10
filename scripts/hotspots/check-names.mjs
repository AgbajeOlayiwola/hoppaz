#!/usr/bin/env node
// ============================================================================
// Hoppaz hotspots: checks the names of the 13 hotspots and the 13 split junctions against OpenStreetMap.
//
//   node scripts/hotspots/check-names.mjs --deps=<dir with the Overpass cache>
//
// For every junction (the hotspots table, and the children in each split_hint) it prints:
//   roads   do the two roads really meet? (a shared node within 70 m, in the cached road answers; or both
//           reach the same unnamed roundabout within 70 m, from the cached rings-*.json answers, as at
//           Ikorodu Garage), with the OSM spelling and class of each
//   places  the four nearest OSM place nodes (suburb, town, ...), from ONE Overpass query that is
//           cached (places-*.json in the cache dir; one query at a time, politely)
//   named   named features within 400 m (bus stations, markets, signals, banks, ...) from the cached POI answers
// A local name is BACKED when the road at the junction carries it as its own name (a road named
// for the places it runs between, like Lekki-Epe Expressway or Ojo - Igbede Road, does not back
// "Epe" or "Ojo"), or OSM has a place of that name within 1 km or a named feature of that name
// within 500 m; every word of the name counts, so "Yaba Market" needs a market and "Pen Cinema" a
// cinema. Not backed means "unsure": the `unsure` text in PICK and SPLIT in zones.mjs and the
// tables of docs/HOTSPOTS.md section 4 say which. The judgement stays with a person, so this script
// prints the evidence and fails (exit 1) only when two roads do not meet.
// Data (c) OpenStreetMap contributors, ODbL.
// ============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
if (typeof args.deps !== "string" && typeof args.cache !== "string") { console.error("Pass --deps=<dir with the Overpass cache that zones.mjs filled>."); process.exit(1); }
const CACHE = resolve(typeof args.cache === "string" ? args.cache : args.deps);
const DB = typeof args.db === "string" ? args.db : "supabase_db_hoppaz-local";
const UA = "hoppaz-hotspot-zones/1.0 (Lagos nightlife app; boundary and junction import)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c", sql], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();

// the hotspots and the split junctions (unique by coordinates; a child that keeps the parent's junction is not repeated)
const pts = new Map();
const add = (kind, slug, name, junction, a, b, lat, lng) => {
  const k = `${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
  if (!pts.has(k)) pts.set(k, { kind, slug, name, junction, a, b, lat: +lat, lng: +lng });
};
for (const r of psql("select slug, name, junction, road_a, road_b, lat, lng from hotspots where status in ('active','planned') order by wave, slug").split("\n")) add("hotspot", ...r.split("|"));
for (const r of psql("select slug, c->>'name', c->>'junction', c->>'road_a', c->>'road_b', c->>'lat', c->>'lng' from hotspots, jsonb_array_elements(split_hint->'children') c where status in ('active','planned') order by slug").split("\n")) add("split", ...r.split("|"));
const list = [...pts.values()];
console.log(`${list.length} junctions (${list.filter((p) => p.kind === "hotspot").length} hotspots, ${list.filter((p) => p.kind === "split").length} split-only)`);

// roads and POIs from the cache
const ways = new Map(), nodes = new Map(), pois = [], rings = [];
for (const f of readdirSync(CACHE)) {
  if (/^roads-.*\.json$/.test(f)) {
    for (const e of JSON.parse(readFileSync(join(CACHE, f), "utf8")).elements) {
      if (e.type === "way" && e.tags?.name) ways.set(e.id, e);
      else if (e.type === "node" && e.lat != null) nodes.set(e.id, e);
    }
  } else if (/^rings-.*\.json$/.test(f)) {
    const els = JSON.parse(readFileSync(join(CACHE, f), "utf8")).elements;
    const rn = new Map(els.filter((e) => e.type === "node").map((n) => [n.id, n]));
    for (const w of els.filter((e) => e.type === "way")) rings.push(w.nodes.map((id) => rn.get(id)).filter(Boolean));
  } else if (/^pois-.*\.json$/.test(f)) {
    for (const e of JSON.parse(readFileSync(join(CACHE, f), "utf8")).elements) if (e.type === "node" && e.tags?.name) pois.push(e);
  }
}
if (!ways.size) { console.error(`No roads-*.json in ${CACHE}. Run zones.mjs once (it fills the Overpass cache).`); process.exit(1); }
const HAV = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const lev = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };

function roadCheck(p) {
  const near = new Set([...nodes.values()].filter((n) => HAV(p, { lat: n.lat, lng: n.lon }) < 70).map((n) => n.id));
  const hit = (name) => [...ways.values()].filter((w) => lev(norm(w.tags.name), norm(name)) <= 2 && w.nodes.some((n) => near.has(n)));
  let best = null;
  for (const x of hit(p.a)) for (const y of hit(p.b)) {
    if (x.id === y.id) continue;
    for (const n of x.nodes.filter((n) => y.nodes.includes(n) && nodes.has(n))) {
      const d = HAV(p, { lat: nodes.get(n).lat, lng: nodes.get(n).lon });
      if (!best || d < best.d) best = { d, x, y };
    }
  }
  if (best) return best;
  // no shared node: both roads reach the same roundabout (a node on the ring, or within 60 m of one), and the point is on it
  for (const ring of rings) {
    const mid = { lat: ring.reduce((s, r) => s + r.lat, 0) / ring.length, lng: ring.reduce((s, r) => s + r.lon, 0) / ring.length };
    if (HAV(p, mid) > 70) continue;
    const reaches = (w) => w.nodes.some((n) => nodes.has(n) && ring.some((r) => HAV({ lat: r.lat, lng: r.lon }, { lat: nodes.get(n).lat, lng: nodes.get(n).lon }) <= 60));
    const xs = hit(p.a).filter(reaches), ys = hit(p.b).filter(reaches);
    if (xs.length && ys.length && xs[0].id !== ys[0].id) return { d: HAV(p, mid), x: xs[0], y: ys[0], ring: true };
  }
  return null;
}

// OSM places near all junctions: one cached Overpass query
const q = `[out:json][timeout:120];\n(\n${list.map((p) => `  node(around:3000,${p.lat},${p.lng})["place"~"^(city|town|village|suburb|neighbourhood|quarter|hamlet|locality|city_block|island)$"];`).join("\n")}\n);\nout body;`;
const file = join(CACHE, `places-${createHash("sha1").update(q).digest("hex").slice(0, 10)}.json`);
let places;
if (existsSync(file)) places = JSON.parse(readFileSync(file, "utf8"));
else {
  for (let round = 0; round < 6 && !places; round++) {
    try {
      await sleep(2000);
      const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
      if (r.ok) { const text = await r.text(); places = JSON.parse(text); writeFileSync(file, text); console.log(`fetched places (${(text.length / 1024).toFixed(0)} KB)`); }
      else { console.error("Overpass answered", r.status); await sleep(15000); }
    } catch (e) { console.error(String(e).slice(0, 100)); await sleep(15000); }
  }
  if (!places) { console.error("Overpass is down. Run again later."); process.exit(1); }
}
const placeNodes = places.elements.filter((e) => e.tags?.name);

let broken = 0;
for (const p of list) {
  const rc = roadCheck(p);
  if (!rc) broken++;
  const ps = placeNodes.map((n) => ({ n, d: HAV(p, { lat: n.lat, lng: n.lon }) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const pp = pois.map((n) => ({ n, d: HAV(p, { lat: n.lat, lng: n.lon }) })).filter((x) => x.d < 400).sort((a, b) => a.d - b.d).slice(0, 4);
  console.log(`\n[${p.kind}] ${p.slug} / ${p.name} / "${p.junction}"`);
  console.log(`  roads:  ${p.a} x ${p.b} -> ` + (rc ? `meet at ${rc.ring ? "the same roundabout (its middle is" : "a shared node"} ${Math.round(rc.d)} m away${rc.ring ? ")" : ""}; OSM says "${rc.x.tags.name}" (${rc.x.tags.highway}) x "${rc.y.tags.name}" (${rc.y.tags.highway})` : "NO SHARED NODE within 70 m"));
  console.log(`  places: ` + ps.map((x) => `${x.n.tags.name} [${x.n.tags.place}] ${Math.round(x.d)} m`).join("; "));
  console.log(`  named:  ` + (pp.map((x) => `${x.n.tags.name} [${x.n.tags.amenity || x.n.tags.highway || x.n.tags.shop || ""}] ${Math.round(x.d)} m`).join("; ") || "none within 400 m"));
}
console.log(broken ? `\n${broken} junction(s) whose two roads do not meet` : "\nall junctions: the two roads meet");
process.exit(broken ? 1 : 0);
