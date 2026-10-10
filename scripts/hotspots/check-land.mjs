#!/usr/bin/env node
// ============================================================================
// Hoppaz hotspots: checks the zone shapes that are IN THE DATABASE against the land.
//
//   node scripts/hotspots/check-land.mjs --deps=<dir with node_modules and the Overpass cache>
//
// zones.mjs checks its own shapes while it builds them. This reads the shapes back from the
// local database (the `hotspots` table, after simplification and loading) and checks them again
// against land = Lagos State minus the sea minus the lagoon water, from the Overpass answers
// that zones.mjs cached:
//   1. land that is in no zone (it should only be slivers on the state line)
//   2. overlap between zones (on land it should be a few square metres)
//   3. no zone holds land on both sides of the lagoon, and each zone is on its declared side
// Exit code 0 when all three hold, 1 when not. It prints nothing about people: it reads only
// the public zone shapes.
// Data (c) OpenStreetMap contributors, ODbL.
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
if (typeof args.deps !== "string") { console.error("Pass --deps=<dir with node_modules and the Overpass cache>. See the top of zones.mjs."); process.exit(1); }
const DEPS = resolve(args.deps);
const CACHE = resolve(typeof args.cache === "string" ? args.cache : DEPS);
const DB = typeof args.db === "string" ? args.db : "supabase_db_hoppaz-local";
if (!existsSync(join(DEPS, "node_modules"))) { console.error(`No node_modules in ${DEPS}.`); process.exit(1); }
const req = createRequire(join(DEPS, "package.json"));
const turf = req("@turf/turf");
const pc = req("polygon-clipping");
const osmtogeojson = req("osmtogeojson");

const MP = (g) => (!g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : g.type === "GeometryCollection" ? g.geometries.flatMap(MP) : []);
const feat = (mp) => ({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: mp } });
const km2 = (mp) => (mp.length ? turf.area(feat(mp)) / 1e6 : 0);
const U = (...a) => { const xs = a.filter((x) => x && x.length); return xs.length ? pc.union(...xs) : []; };
const I = (a, b) => (a.length && b.length ? pc.intersection(a, b) : []);
const D = (a, b) => (!a.length ? [] : !b.length ? a : pc.difference(a, b));
const cached = (prefix) => {
  const f = readdirSync(CACHE).filter((n) => n.startsWith(prefix + "-") && n.endsWith(".json")).sort().at(-1);
  if (!f) throw new Error(`No ${prefix}-*.json in ${CACHE}. Run zones.mjs once (it fills the Overpass cache).`);
  return JSON.parse(readFileSync(join(CACHE, f), "utf8"));
};
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`); };

// the zone shapes
const rows = execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c",
  "select slug, side, st_asgeojson(zone_geom, 7) from hotspots where status in ('active','planned') order by slug"], { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n");
const zones = rows.map((r) => { const [slug, side, gj] = r.split("|"); return { slug, side, shape: MP(JSON.parse(gj)) }; });
console.log(`${zones.length} zones read from ${DB}`);

// land = the state minus the sea minus the lagoon water (the same recipe as zones.mjs)
const admin = cached("admin-tags");
const stateRel = admin.elements.find((e) => e.tags.admin_level === "4" && /lagos/i.test(e.tags.name));
const state = MP(osmtogeojson(cached("lga-geom")).features.find((f) => f.id === `relation/${stateRel.id}`).geometry);
const ways = cached("coast").elements.filter((w) => w.geometry?.length >= 2);
const key = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
const byStart = new Map(ways.map((w) => [key(w.geometry[0]), w]));
const ends = new Set(ways.map((w) => key(w.geometry.at(-1))));
let cur = ways.find((w) => !ends.has(key(w.geometry[0])));
const chain = [], seen = new Set();
while (cur && !seen.has(cur.id)) { seen.add(cur.id); for (const p of cur.geometry) if (!chain.length || key(chain.at(-1)) !== key(p)) chain.push(p); cur = byStart.get(key(cur.geometry.at(-1))); }
const ring = chain.map((p) => [p.lon, p.lat]);
ring.unshift([ring[0][0] - 0.2, ring[0][1]]); ring.push([ring.at(-1)[0] + 0.2, ring.at(-1)[1]]);
ring.push([ring.at(-1)[0], 5.9], [ring[0][0], 5.9], ring[0]);
const WATER = U(...osmtogeojson(cached("water")).features.filter((f) => /Polygon/.test(f.geometry.type) && turf.area(f) > 5e4).map((f) => MP(f.geometry)));
const LAND = D(D(state, [[ring]]), WATER);
console.log(`state land ${km2(LAND).toFixed(1)} km2`);

// 1. land in no zone
const lost = D(LAND, U(...zones.map((z) => z.shape)));
const inner = MP(turf.buffer(feat(state), -0.03, { units: "kilometers" }).geometry);
const bigOffEdge = lost.filter((p) => km2([p]) * 1e6 >= 400 && km2(D([p], inner)) / km2([p]) < 0.5);
check("land in no zone is only slivers on the state line", km2(lost) * 1e6 < 100000 && bigOffEdge.length === 0,
  `${Math.round(km2(lost) * 1e6)} m2 in ${lost.length} pieces; ${bigOffEdge.length} piece(s) of 400 m2 or more away from the state line`);

// 2. overlap
let ovLand = 0, ovAll = 0;
for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
  const x = I(zones[i].shape, zones[j].shape);
  if (!x.length) continue;
  ovAll += km2(x) * 1e6; ovLand += km2(I(x, LAND)) * 1e6;
}
check("zones overlap by a few square metres at most", ovAll < 2000 && ovLand < 100, `${Math.round(ovAll)} m2 in all, ${Math.round(ovLand)} m2 on land`);

// 3. landmasses: lekki, ikoyi (both island) and mainland; every piece of land takes the mass of the nearest anchor
const ANCH = [
  { mass: "lekki", lat: 6.441, lng: 3.47 }, { mass: "ikoyi", lat: 6.452, lng: 3.436 },
  { mass: "mainland", lat: 6.601, lng: 3.349 }, { mass: "mainland", lat: 6.619, lng: 3.506 }, { mass: "mainland", lat: 6.415, lng: 2.884 },
];
const pieces = LAND.map((p) => [p]);
const pointIn = (lat, lng, mp) => mp.length > 0 && turf.booleanPointInPolygon(turf.point([lng, lat]), feat(mp));
const anchorIdx = ANCH.map((a) => pieces.findIndex((p) => pointIn(a.lat, a.lng, p)));
if (anchorIdx.some((i) => i < 0)) throw new Error("a landmass anchor is not on land");
const sample = (mp) => mp.flatMap((poly) => poly.flatMap((r) => r.filter((_, i) => i % 3 === 0)));
const anchorPts = anchorIdx.map((i) => sample(pieces[i]));
const massOf = pieces.map((p, i) => {
  const ai = anchorIdx.indexOf(i);
  if (ai >= 0) return ANCH[ai].mass;
  let best = null, bd = Infinity;
  const pts = sample(p);
  anchorPts.forEach((ap, k) => { let d = Infinity; for (const q of pts) for (const r of ap) { const dd = Math.abs(q[0] - r[0]) + Math.abs(q[1] - r[1]); if (dd < d) d = dd; } if (d < bd) { bd = d; best = ANCH[k].mass; } });
  return best;
});
const MASS = Object.fromEntries(["lekki", "ikoyi", "mainland"].map((m) => [m, U(...pieces.filter((_, i) => massOf[i] === m))]));
let bad = [];
for (const z of zones) {
  const isl = km2(I(z.shape, MASS.lekki)) + km2(I(z.shape, MASS.ikoyi)), main = km2(I(z.shape, MASS.mainland));
  const wrong = z.side === "island" ? main : isl;
  console.log(`   ${z.slug.padEnd(16)} ${z.side.padEnd(8)} land: island ${isl.toFixed(2)} km2, mainland ${main.toFixed(2)} km2`);
  if (wrong > 0.05) bad.push(z.slug);
}
check("no zone holds land on both sides of the lagoon, and each is on its declared side", bad.length === 0, bad.join(", "));
console.log(failed ? `\n${failed} check(s) failed` : "\nall land checks passed");
process.exit(failed ? 1 : 0);
