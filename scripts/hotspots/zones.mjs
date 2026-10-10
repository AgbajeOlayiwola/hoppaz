// ============================================================================
// Hoppaz: hotspot zones for Lagos (one room per zone), from OpenStreetMap
//
//   node scripts/hotspots/zones.mjs --deps=<dir> --cache=<dir>
//
// Spec: docs/HOTSPOTS.md (section 4, Jae's decision of 9 Oct 2026: "Segment Lagos
// into zones. Just segment the zones that are very large, and each zone has one
// room (one hotspot). Then over time, as more people come, we break down the rooms.")
//
// What it does, in order (every Overpass answer is cached, one query at a time):
//   1. Lagos State and its 20 LGAs (boundary=administrative; Lagos uses admin_level 4
//      for the state and 6 for the LGAs; OSM has no LCDA or ward polygons for Lagos),
//      the lagoons and creeks (natural=water), and the Atlantic coastline.
//   2. Land = the state minus the sea minus the water. Every piece of land is put on
//      a landmass: "ikoyi" (Lagos Island and Ikoyi), "lekki" (Victoria Island, the
//      Lekki peninsula, Ibeju-Lekki) or "mainland". The lagoon is the edge.
//   3. A zone is a group of LGA pieces on one landmass (ZONES below). Eti Osa, the one
//      LGA that holds Ikoyi, Victoria Island and Lekki, is cut along Admiralty Way
//      (Akiogun Road) and Chevron Drive. Thin strips of land between two LGA lines go
//      to the zone they touch.
//   4. Each zone grows 300 m into the water or sea around it (GPS drift on a
//      shoreline), the shared edges are simplified together (TopoJSON, about 20 m),
//      and the result is checked: no overlap, no gap on land, one landmass per zone,
//      a table of well-known places (PROBES) each in the zone expected.
//   5. One hotspot per zone (PICK) and the first split of each zone (SPLIT: a cut and
//      two junctions) are found with the rules of docs/HOTSPOTS.md section 5: two
//      named roads of class motorway to tertiary meet, not on a bridge, 60 m from
//      water, and (when the local database runs) outside every no-spawn zone and 100 m
//      from military, prison, port and airport zones. A hotspot's 150 m surroundings
//      then belong to its zone, so no hotspot sits on a zone edge.
//   6. Writes zones.geojson (zones, hotspots, split junctions) and
//      supabase/hotspot_zones.sql (standalone, idempotent).
//
// Packages are NOT in the repo's package.json. Install them once in a scratch dir:
//   mkdir -p /tmp/hz && cd /tmp/hz && npm init -y >/dev/null &&
//   npm i @turf/turf osmtogeojson polygon-clipping jsts topojson-server topojson-simplify topojson-client
//   node scripts/hotspots/zones.mjs --deps=/tmp/hz --cache=/tmp/hz/cache
// The first run asks Overpass for about 80 answers (10 to 40 minutes, it waits for a free
// slot); later runs read the cache and take about a minute.
//
// Options:
//   --deps=<dir>      directory with node_modules (default: the cache dir)
//   --cache=<dir>     where Overpass answers are kept (default: <tmp>/hoppaz-hotspot-zones)
//   --sql=<file>      default supabase/hotspot_zones.sql
//   --geojson=<file>  default <cache>/zones.geojson
//   --stage=geo       stop after the zones (no junctions, no SQL)
//   --reuse           read the zones from the geojson of the last run instead of rebuilding
//   --discover[=a,b]  print the best junctions around the anchors (all, or the keys named) and stop
//   --state-wkt       print the outline of Lagos State as WKT (for supabase/tests/hotspot_zones_test.sql)
//   --mirror          allow the kumi.systems mirror when overpass-api.de is down
//                     (it served older data once; the main server is preferred)
// Data (c) OpenStreetMap contributors, ODbL.
// ============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const CACHE = resolve(typeof args.cache === "string" ? args.cache : join(tmpdir(), "hoppaz-hotspot-zones"));
const DEPS = resolve(typeof args.deps === "string" ? args.deps : CACHE);
const OUT_SQL = resolve(typeof args.sql === "string" ? args.sql : join(REPO, "supabase/hotspot_zones.sql"));
const OUT_GEOJSON = resolve(typeof args.geojson === "string" ? args.geojson : join(CACHE, "zones.geojson"));

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(DEPS, "node_modules"))) {
  console.error(`No node_modules in ${DEPS}. Install the packages listed at the top of this file there, then pass --deps=<dir>.`);
  process.exit(1);
}
const req = createRequire(join(DEPS, "package.json"));
const turf = req("@turf/turf");
const pc = req("polygon-clipping");
const osmtogeojson = req("osmtogeojson");
// jsts only ships as ES modules, so it is imported by path
const jstsImport = (p) => import(pathToFileURL(join(DEPS, "node_modules/jsts/org/locationtech/jts", p)).href);
const { default: GeoJSONReader } = await jstsImport("io/GeoJSONReader.js");
const { default: GeoJSONWriter } = await jstsImport("io/GeoJSONWriter.js");
const { default: GeometryFactory } = await jstsImport("geom/GeometryFactory.js");
const { default: UnaryUnionOp } = await jstsImport("operation/union/UnaryUnionOp.js");
const { default: GeometryPrecisionReducer } = await jstsImport("precision/GeometryPrecisionReducer.js");
const { default: PrecisionModel } = await jstsImport("geom/PrecisionModel.js");
await jstsImport("monkey.js");
const { topology } = req("topojson-server");
const { presimplify, simplify } = req("topojson-simplify");
const { feature: topoFeature } = req("topojson-client");

await mkdir(CACHE, { recursive: true });

// =============================================================== Overpass ===
const MAIN = "https://overpass-api.de/api/interpreter";
const MIRRORS = args.mirror ? ["https://overpass.kumi.systems/api/interpreter"] : [];
const UA = "hoppaz-hotspot-zones/1.0 (Lagos nightlife app; boundary and junction import)";
const ROUNDS = 6;

// Ask the server when a slot is free instead of hammering it (it answers 429 while both slots are busy).
async function waitForSlot() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = await (await fetch(MAIN.replace("interpreter", "status"), { headers: { "User-Agent": UA } })).text();
      const now = t.match(/(\d+) slots? available now/);
      if (now && +now[1] > 0) return;
      const waits = [...t.matchAll(/in (\d+) seconds/g)].map((m) => +m[1]);
      await sleep(((waits.length ? Math.min(...waits) : 4) + 1) * 1000);
    } catch { await sleep(5_000); }
  }
}

async function overpass(label, ql) {
  const file = join(CACHE, `${label}-${createHash("sha1").update(ql).digest("hex").slice(0, 10)}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  for (let round = 0; round < ROUNDS; round++) {
    for (const url of round >= 3 ? [MAIN, ...MIRRORS] : [MAIN]) {
      if (url === MAIN) await waitForSlot();
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(ql),
        });
        if (r.ok) {
          const text = await r.text();
          const json = JSON.parse(text);
          await writeFile(file, text);
          log(`  fetched ${label} (${(text.length / 1024).toFixed(0)} KB)`);
          await sleep(2_000); // one query at a time, politely
          return json;
        }
        console.error(`  ${label}: ${url} answered ${r.status}`);
      } catch (e) {
        console.error(`  ${label}: ${url} ${String(e).slice(0, 80)}`);
      }
    }
    await sleep(round === 0 ? 8_000 : 25_000);
  }
  throw new Error(`Overpass is down for ${label}. Run again later.`);
}

// =========================================================== geometry kit ===
const MP = (g) =>
  !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates
    : g.type === "GeometryCollection" ? g.geometries.flatMap((x) => MP(x)) : [];
const jr = new GeoJSONReader();
const jw = new GeoJSONWriter();
const gf = new GeometryFactory();
// polygon-clipping does the overlays (fast); on the rare shape it chokes on, JSTS redoes that one
// on a 10 cm grid, which makes the overlay robust.
const PM = new PrecisionModel(1e6);
const J = (mp) => jr.read({ type: "MultiPolygon", coordinates: mp });
const JR = (mp) => GeometryPrecisionReducer.reduce(J(mp), PM);
const fromJ = (g) => (!g || g.isEmpty() ? [] : MP(jw.write(g)));
const U = (...a) => {
  const xs = a.filter((x) => x && x.length);
  if (!xs.length) return [];
  try { return xs.length === 1 ? pc.union(xs[0]) : pc.union(...xs); } catch {
    return fromJ(UnaryUnionOp.union(gf.createGeometryCollection(xs.map(JR))));
  }
};
const I = (a, b) => {
  if (!a.length || !b.length) return [];
  try { return pc.intersection(a, b); } catch { return fromJ(JR(a).intersection(JR(b))); }
};
const D = (a, b) => {
  if (!a.length) return [];
  if (!b.length) return a;
  try { return pc.difference(a, b); } catch { return fromJ(JR(a).difference(JR(b))); }
};
const feat = (mp, properties = {}) => ({ type: "Feature", properties, geometry: { type: "MultiPolygon", coordinates: mp } });
const km2 = (mp) => (mp.length ? turf.area(feat(mp)) / 1e6 : 0);
const buffer = (mp, meters) => (mp.length ? fromJ(J(mp).buffer(meters / 111000, 4)) : []);
const HAV = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const pointIn = (lat, lng, mp) => mp.length > 0 && turf.booleanPointInPolygon(turf.point([lng, lat]), feat(mp));
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ============================================================ configuration ===
// The 16 areas of the database (supabase seed) with their sides. The zones must
// hold every one of them, each on its own side of the lagoon.
const AREAS = {
  Ajah: [6.468, 3.565, "island"], Apapa: [6.448, 3.363, "mainland"], Festac: [6.466, 3.286, "mainland"],
  Gbagada: [6.552, 3.396, "mainland"], Ikeja: [6.601, 3.349, "mainland"], Ikoyi: [6.452, 3.436, "island"],
  "Lagos Island": [6.455, 3.399, "island"], "Lekki Phase 1": [6.441, 3.47, "island"], Magodo: [6.616, 3.378, "mainland"],
  Maryland: [6.57, 3.365, "mainland"], Mushin: [6.527, 3.345, "mainland"], Ogudu: [6.577, 3.388, "mainland"],
  Shomolu: [6.54, 3.383, "mainland"], Surulere: [6.497, 3.352, "mainland"], "Victoria Island": [6.429, 3.424, "island"],
  Yaba: [6.509, 3.375, "mainland"],
};

// Landmass anchors: every piece of land takes the landmass of the nearest anchor piece.
const MASS_ANCHORS = [
  { mass: "lekki", lat: 6.441, lng: 3.47 }, // Lekki Phase 1: the Lekki peninsula, Victoria Island, Ibeju-Lekki
  { mass: "ikoyi", lat: 6.452, lng: 3.436 }, // Ikoyi and Lagos Island, cut off from Victoria Island by Five Cowries Creek
  { mass: "mainland", lat: 6.601, lng: 3.349 }, // Ikeja: the central mainland
  { mass: "mainland", lat: 6.619, lng: 3.506 }, // Ikorodu: the north-east mainland (across the lagoon)
  { mass: "mainland", lat: 6.415, lng: 2.884 }, // Badagry: the far west
];
const SIDE_OF_MASS = { lekki: "island", ikoyi: "island", mainland: "mainland" };

// Well-known places, each on land of one side of the lagoon. The build checks that every one is
// on land of the side given, and prints the zone it falls in; supabase/tests/hotspot_zones_test.sql
// holds the same list (paste the table the build prints) to prove that no zone holds land of both sides.
//   [name, lat, lng, side, zone the build puts it in (checked by the test)]
const PROBES = [
  ["Tafawa Balewa Square", 6.4448, 3.4016, "island", "lagos-island"], ["Campbell Street and Broad Street", 6.4471, 3.3985, "island", "lagos-island"],
  ["Falomo Roundabout", 6.4445, 3.4273, "island", "ikoyi"], ["Alexander Roundabout", 6.4497, 3.4492, "island", "ikoyi"],
  ["Akin Adesola Street, Victoria Island", 6.4292, 3.4239, "island", "victoria-island"], ["Oniru", 6.4357, 3.4426, "island", "victoria-island"],
  ["Admiralty Way, Lekki Phase 1", 6.4479, 3.4702, "island", "lekki"], ["Ikate", 6.4367, 3.5078, "island", "lekki"],
  ["Ajah", 6.4656, 3.5616, "island", "ajah"], ["Lagos-Calabar Coastal Highway at Eleko", 6.4424, 3.8542, "island", "ajah"],
  ["Allen Avenue, Ikeja", 6.6072, 3.3492, "mainland", "ikeja"], ["Computer Village", 6.5959, 3.3425, "mainland", "ikeja"],
  ["Agege", 6.6200, 3.3200, "mainland", "ikeja"], ["Ogba", 6.6330, 3.3400, "mainland", "ikeja"],
  ["Ketu", 6.5934, 3.3926, "mainland", "ojota"], ["Gbagada", 6.5530, 3.3905, "mainland", "ojota"], ["Magodo", 6.6160, 3.3830, "mainland", "ojota"],
  ["Yaba market", 6.5058, 3.3734, "mainland", "yaba"], ["Shomolu", 6.5400, 3.3830, "mainland", "yaba"], ["UNILAG, Akoka", 6.5177, 3.3845, "mainland", "yaba"],
  ["Ojuelegba", 6.5101, 3.3632, "mainland", "surulere"], ["Adeniran Ogunsanya Street, Surulere", 6.5000, 3.3560, "mainland", "surulere"],
  ["Mushin", 6.5270, 3.3450, "mainland", "surulere"], ["Oshodi", 6.5560, 3.3490, "mainland", "surulere"], ["Isolo", 6.5360, 3.3190, "mainland", "surulere"],
  ["Apapa", 6.4480, 3.3630, "mainland", "festac"], ["Mile 2", 6.4640, 3.3040, "mainland", "festac"], ["Festac Town", 6.4660, 3.2860, "mainland", "festac"],
  ["Egbeda", 6.5870, 3.2970, "mainland", "alimosho"], ["Ikotun", 6.5500, 3.2500, "mainland", "alimosho"], ["Iyana Ipaja", 6.6100, 3.2650, "mainland", "alimosho"],
  ["Alaba", 6.4680, 3.1930, "mainland", "ojo-badagry"], ["Badagry", 6.4150, 2.8840, "mainland", "ojo-badagry"],
  ["Ikorodu", 6.6190, 3.5060, "mainland", "ikorodu"], ["Epe", 6.5840, 3.9790, "mainland", "ikorodu"],
];

// Cuts across the Lekki peninsula (north to south, [lat, lng]). Both follow real roads
// and carry straight on to the shore, so they split Eti Osa land with no gap.
const CUTS = {
  // Admiralty Way (west leg, below the Ikoyi Bridge Roundabout) then Akiogun Road down to Princely Court Road.
  west: [[6.6, 3.45876], [6.44586, 3.45876], [6.44363, 3.45465], [6.44089, 3.45435], [6.43942, 3.45604], [6.4372, 3.45637],
    [6.43444, 3.45683], [6.43377, 3.45678], [6.43205, 3.45688], [6.42926, 3.45703], [6.42591, 3.45714], [6.3, 3.45714]],
  // Chevron Drive from the lagoon shore to the Lekki-Epe Expressway, then straight on to the beach.
  east: [[6.6, 3.53056], [6.45825, 3.53056], [6.45584, 3.53058], [6.45235, 3.53063], [6.44776, 3.53068], [6.44485, 3.5307],
    [6.44353, 3.53071], [6.44201, 3.53071], [6.44125, 3.53093], [6.3, 3.53093]],
};

// The zones. `parts` are LGA pieces on one landmass (cut: which side of the Eti Osa cuts).
// wave: 1 where Hoppaz events are, 2 and 3 as in the old plan, 4 the outer zones that
// exist so nobody is left out.
const ZONES = [
  { slug: "lagos-island", name: "Lagos Island", label: "Marina, CMS, Obalende, Idumota, Onikan", wave: 2,
    parts: [{ lga: "Lagos Island", mass: "ikoyi" }] },
  { slug: "ikoyi", name: "Ikoyi", label: "Ikoyi, Falomo, Banana Island, Parkview", wave: 2,
    parts: [{ lga: "Eti Osa", mass: "ikoyi" }] },
  { slug: "victoria-island", name: "Victoria Island", label: "Victoria Island, Oniru, Maroko, Eko Atlantic", wave: 1,
    parts: [{ lga: "Eti Osa", mass: "lekki", cut: "west" }] },
  { slug: "lekki", name: "Lekki", label: "Lekki Phase 1 to Chevron and Jakande, Ikate, Osapa, Ikota", wave: 1,
    parts: [{ lga: "Eti Osa", mass: "lekki", cut: "middle" }] },
  { slug: "ajah", name: "Ajah and beyond", label: "Ajah, Sangotedo, Awoyaya, Ibeju-Lekki", wave: 3,
    parts: [{ lga: "Eti Osa", mass: "lekki", cut: "east" }, { lga: "Ibeju Lekki", mass: "lekki" }, { lga: "Epe", mass: "lekki" }] },
  { slug: "ikeja", name: "Ikeja", label: "Ikeja, Alausa, Opebi, Maryland, Ogba, Ojodu, Agege", wave: 1,
    parts: [{ lga: "Ikeja", mass: "mainland" }, { lga: "Agege", mass: "mainland" }, { lga: "Ifako/Ijaye", mass: "mainland" }] },
  { slug: "ojota", name: "Ojota and Gbagada", label: "Ojota, Ketu, Ogudu, Magodo, Gbagada, Anthony, Oworonshoki, Mile 12", wave: 3,
    parts: [{ lga: "Kosofe", mass: "mainland" }] },
  { slug: "yaba", name: "Yaba", label: "Yaba, Jibowu, Ebute Metta, Akoka, Shomolu, Bariga, Makoko", wave: 1,
    parts: [{ lga: "Lagos Mainland", mass: "mainland" }, { lga: "Shomolu", mass: "mainland" }] },
  { slug: "surulere", name: "Surulere, Mushin and Oshodi", label: "Surulere, Mushin, Ojuelegba, Ilupeju, Isolo, Oshodi, Okota", wave: 2,
    parts: [{ lga: "Surulere", mass: "mainland" }, { lga: "Mushin", mass: "mainland" }, { lga: "Oshodi/Isolo", mass: "mainland" }] },
  { slug: "festac", name: "Festac and Apapa", label: "Festac, Mile 2, Amuwo Odofin, Apapa, Ajegunle", wave: 3,
    parts: [{ lga: "Amuwo Odofin", mass: "mainland" }, { lga: "Apapa", mass: "mainland" }, { lga: "Ajeromi/Ifelodun", mass: "mainland" }] },
  { slug: "alimosho", name: "Alimosho", label: "Egbeda, Ikotun, Igando, Idimu, Ipaja, Iyana Ipaja", wave: 4,
    parts: [{ lga: "Alimosho", mass: "mainland" }] },
  { slug: "ojo-badagry", name: "Ojo and Badagry", label: "Ojo, Alaba, Okokomaiko, Iba, Badagry", wave: 4,
    parts: [{ lga: "Ojo", mass: "mainland" }, { lga: "Badagry", mass: "mainland" }] },
  { slug: "ikorodu", name: "Ikorodu and Epe", label: "Ikorodu, Itoikin, Epe", wave: 4,
    parts: [{ lga: "Ikorodu", mass: "mainland" }, { lga: "Epe", mass: "mainland" }] },
];
const SIDE_OF_ZONE = (z) => SIDE_OF_MASS[z.parts[0].mass];
const GROW_M = 300; // how far a zone reaches into the water or sea around it
const GROW_STEP_M = 50;
const DISC_M = 150; // a hotspot's own surroundings (150 m) always belong to its zone, so it is never on a zone edge
const SIMPLIFY_WEIGHT = 4e-8; // degrees squared, about a 20 m wobble on a 60 m stretch

// ========================================================== 1. boundaries ===
const BOX = "6.20,2.65,6.80,4.45"; // the whole state, west to east
const waterRaw = await overpass("water",
  `[out:json][timeout:180];\n(\n  wr["natural"="water"]["water"~"^(lagoon|lake|reservoir|river|canal)$"](${BOX});\n  wr["natural"="water"][!"water"](${BOX});\n  wr["water"="lagoon"](${BOX});\n);\nout geom;`);
const waterFeatures = osmtogeojson(waterRaw).features.filter((f) => /Polygon/.test(f.geometry.type) && turf.area(f) > 5e4);
const WATER = U(...waterFeatures.map((f) => MP(f.geometry)));
log(`   ${waterFeatures.length} water shapes of 5 ha or more, ${km2(WATER).toFixed(0)} km2`);

// the state and its 20 LGAs (admin_level 4 and 6)
async function loadLgas() {
  const LGA_NAMES = ["Agege", "Ajeromi/Ifelodun", "Alimosho", "Amuwo Odofin", "Apapa", "Badagry", "Epe", "Eti Osa", "Ibeju Lekki",
    "Ifako/Ijaye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi/Isolo", "Shomolu", "Surulere"];
  const adminTags = await overpass("admin-tags",
    `[out:json][timeout:120];\nrel["boundary"="administrative"]["admin_level"~"^[4-8]$"](6.30,2.65,6.80,4.45);\nout tags;`);
  const levels = {};
  for (const e of adminTags.elements) (levels[e.tags.admin_level] ??= []).push(e.tags.name);
  log("   admin levels in the box:", Object.entries(levels).map(([l, n]) => `${l}: ${n.length}`).join(", "),
    "(Lagos uses 4 for the state and 6 for the LGAs; no LCDA or ward shapes exist)");
  const stateRel = adminTags.elements.find((e) => e.tags.admin_level === "4" && strip(e.tags.name) === "lagos");
  const lgaRels = LGA_NAMES.map((n) => {
    const e = adminTags.elements.find((x) => x.tags.admin_level === "6" && strip(x.tags.name) === strip(n));
    if (!e) throw new Error(`LGA ${n} not found in OpenStreetMap`);
    return { name: n, id: e.id };
  });
  const lgaRaw = await overpass("lga-geom",
    `[out:json][timeout:180];\nrel(id:${[stateRel.id, ...lgaRels.map((r) => r.id)].join(",")});\nout geom;`);
  const lgaGj = osmtogeojson(lgaRaw);
  const relFeature = (id) => lgaGj.features.find((f) => f.id === `relation/${id}`);
  const statePoly = MP(relFeature(stateRel.id).geometry);
  const LGA = Object.fromEntries(lgaRels.map((r) => [r.name, MP(relFeature(r.id).geometry)]));
  log(`   state ${km2(statePoly).toFixed(0)} km2 (water and a strip of sea included), 20 LGAs ${km2(U(...Object.values(LGA))).toFixed(0)} km2`);
  return { statePoly, LGA };
}
let LGA_ALL = null;

async function buildZones() {
// ========================================================== 1. boundaries ===
log("1. boundaries, water, coast");
const { statePoly, LGA } = (LGA_ALL = await loadLgas());
const coastRaw = await overpass("coast",
  `[out:json][timeout:120];\nway["natural"="coastline"](6.0,2.60,6.8,4.50);\nout geom;`);
const SEA = (() => {
  // OSM draws the coastline with land on its left: along Lagos it runs west to east and the sea is south.
  const ways = coastRaw.elements.filter((w) => w.geometry?.length >= 2);
  const key = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  const byStart = new Map(ways.map((w) => [key(w.geometry[0]), w]));
  const ends = new Set(ways.map((w) => key(w.geometry.at(-1))));
  let cur = ways.find((w) => !ends.has(key(w.geometry[0])));
  const chain = [], seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    for (const p of cur.geometry) if (!chain.length || key(chain.at(-1)) !== key(p)) chain.push(p);
    cur = byStart.get(key(cur.geometry.at(-1)));
  }
  if (seen.size !== ways.length) throw new Error(`the coastline is in ${ways.length - seen.size + 1} pieces, expected one`);
  const ring = chain.map((p) => [p.lon, p.lat]);
  ring.unshift([ring[0][0] - 0.2, ring[0][1]]);
  ring.push([ring.at(-1)[0] + 0.2, ring.at(-1)[1]]);
  ring.push([ring.at(-1)[0], 5.9], [ring[0][0], 5.9], ring[0]);
  return [[ring]];
})();

// ================================================================ 2. land ===
log("2. land and landmasses");
const LAND = D(D(statePoly, SEA), WATER);
const pieces = LAND.map((p) => [p]);
const sample = (mp) => mp.flatMap((poly) => poly.flatMap((ring) => ring.filter((_, i) => i % 3 === 0)));
const anchorIdx = MASS_ANCHORS.map((a) => pieces.findIndex((p) => pointIn(a.lat, a.lng, p)));
if (anchorIdx.some((i) => i < 0)) throw new Error("a landmass anchor is not on land: " + JSON.stringify(anchorIdx));
const anchorPts = anchorIdx.map((i) => sample(pieces[i]));
const massOfPiece = pieces.map((p, i) => {
  const ai = anchorIdx.indexOf(i);
  if (ai >= 0) return MASS_ANCHORS[ai].mass;
  const pts = sample(p);
  let best = null, bestD = Infinity;
  anchorPts.forEach((ap, k) => {
    let d = Infinity;
    for (const q of pts) for (const r of ap) {
      const dd = Math.abs(q[0] - r[0]) + Math.abs(q[1] - r[1]);
      if (dd < d) d = dd;
    }
    if (d < bestD) { bestD = d; best = MASS_ANCHORS[k].mass; }
  });
  return best;
});
const MASS = { lekki: [], ikoyi: [], mainland: [] };
for (const m of Object.keys(MASS)) MASS[m] = U(...pieces.filter((_, i) => massOfPiece[i] === m));
log(`   land ${km2(LAND).toFixed(0)} km2 in ${pieces.length} pieces: ` +
  Object.entries(MASS).map(([m, g]) => `${m} ${km2(g).toFixed(0)} km2`).join(", "));

// ============================================================== 3. zones ===
log("3. zones");
const halfEast = (line) => {
  // the polygon east of a north-to-south line, for splitting land with no gap
  const pts = line.map(([lat, lng]) => [lng, lat]);
  const far = Math.max(...pts.map((p) => p[0])) + 3;
  return [[[...pts, [far, pts.at(-1)[1]], [far, pts[0][1]], pts[0]]]];
};
const EAST_OF_WEST = halfEast(CUTS.west);
const EAST_OF_EAST = halfEast(CUTS.east);
const cutPiece = (mp, cut) =>
  cut === "west" ? D(mp, EAST_OF_WEST)
    : cut === "middle" ? I(D(mp, EAST_OF_EAST), EAST_OF_WEST)
      : cut === "east" ? I(mp, EAST_OF_EAST) : mp;

const zones = ZONES.map((z) => {
  const land = U(...z.parts.map((p) => cutPiece(I(LGA[p.lga], MASS[p.mass]), p.cut)));
  return { ...z, side: SIDE_OF_ZONE(z), land };
});

// checks: no zone pair overlaps on land, and every bit of state land is in a zone
const landUnion = U(...zones.map((z) => z.land));
const lostKm2 = km2(D(LAND, landUnion));
let overlapKm2 = 0;
for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) overlapKm2 += km2(I(zones[i].land, zones[j].land));
log(`   land in zones ${km2(landUnion).toFixed(1)} km2 of ${km2(LAND).toFixed(1)}; land in no zone ${lostKm2.toFixed(2)} km2; overlap ${overlapKm2.toFixed(4)} km2`);
const lost = D(LAND, landUnion);
if (lostKm2 > 0.01) {
  const parts = lost.map((p) => ({ a: km2([p]), c: turf.centroid(feat([p])).geometry.coordinates.map((x) => +x.toFixed(3)) })).sort((a, b) => b.a - a.a).slice(0, 5);
  log("   land that is in no zone (a gap between two LGA lines), biggest:", JSON.stringify(parts));
}
for (const z of zones) {
  const mixed = SIDE_OF_MASS[z.parts[0].mass];
  if (z.parts.some((p) => SIDE_OF_MASS[p.mass] !== mixed)) throw new Error(`${z.slug} mixes landmasses`);
}

// OSM draws neighbouring LGAs a little apart in places, which leaves thin strips of land in no zone.
// Give every strip to the zone on the same landmass that it touches most (60 m reach, then 250 m).
{
  const massAt = (piece) => {
    const [x, y] = turf.pointOnFeature(feat([piece])).geometry.coordinates;
    return Object.keys(MASS).find((m) => pointIn(y, x, MASS[m]));
  };
  const give = new Map();
  let given = 0;
  for (const piece of D(LAND, landUnion)) {
    if (km2([piece]) < 1e-5) continue;
    const mass = massAt(piece);
    let best = null, usedReach = 0;
    for (const reach of [60, 250, 1500, 8000]) {
      usedReach = reach;
      const ring = buffer([piece], reach);
      let bestA = 0;
      for (const z of zones) {
        if (z.parts[0].mass !== mass) continue;
        const a = km2(I(ring, z.land));
        if (a > bestA) { bestA = a; best = z; }
      }
      if (best) break;
    }
    if (!best) throw new Error(`a strip of land at ${JSON.stringify(turf.centroid(feat([piece])).geometry.coordinates)} (${mass}) touches no zone`);
    if (usedReach > 250) log(`   a ${(km2([piece]) * 100).toFixed(1)} ha island of ${mass} land at ${turf.centroid(feat([piece])).geometry.coordinates.map((x) => x.toFixed(3))} is ${usedReach} m or less from ${best.slug}; it goes there`);
    (give.get(best.slug) ?? give.set(best.slug, []).get(best.slug)).push(piece);
    given++;
  }
  for (const z of zones) if (give.has(z.slug)) z.land = U(z.land, give.get(z.slug));
  log(`   gave ${given} strips of land between LGA lines to the zone they touch (${[...give].map(([k, v]) => `${k} ${v.length}`).join(", ")})`);
}

// grow into the water: 50 m at a time, never into land or another zone, so two zones that
// face each other over a creek split the water between them.
const FREE = U(WATER, SEA);
const grown = zones.map((z) => z.land);
const rings = (mp) => mp.reduce((s, p) => s + p.length, 0);
log(`   FREE has ${FREE.length} polygons, ${rings(FREE)} rings; zone land rings: ${grown.map((g) => rings(g)).join(" ")}`);
for (let step = 0; step < GROW_M / GROW_STEP_M; step++) {
  let taken = U(...grown);
  const order = grown.map((_, i) => i);
  if (step % 2) order.reverse();
  for (const i of order) {
    const buf = buffer(grown[i], GROW_STEP_M);
    const add = D(I(buf, FREE), taken);
    if (add.length) {
      grown[i] = U(grown[i], add);
      taken = U(taken, add);
    }
  }
}
zones.forEach((z, i) => { z.mp = grown[i]; });

// simplify all shared edges once so neighbours still fit (TopoJSON), then check again
const topo = topology({ zones: { type: "FeatureCollection", features: zones.map((z) => ({ type: "Feature", id: z.slug, properties: {}, geometry: { type: "MultiPolygon", coordinates: z.mp } })) } }, 1e6);
const simplified = simplify(presimplify(topo), SIMPLIFY_WEIGHT);
const simpGj = topoFeature(simplified, simplified.objects.zones);
const round5 = (x) => Math.round(x * 1e5) / 1e5;
for (const f of simpGj.features) {
  const z = zones.find((q) => q.slug === f.id);
  const before = z.mp.flat(2).length;
  z.mp = MP(f.geometry).map((poly) => poly.map((ring) => ring.map(([x, y]) => [round5(x), round5(y)])));
  z.mp = U(z.mp); // dissolves slivers, repairs rings
  z.points = z.mp.flat(2).length;
  z.pointsBefore = before;
}
for (const z of zones) {
  z.area = km2(z.mp);
  z.landKm2 = km2(I(z.mp, LAND));
}
let overlap2 = 0;
for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) overlap2 += km2(I(zones[i].mp, zones[j].mp));
const gapLand = D(LAND, U(...zones.map((z) => z.mp)));
const gapKm2 = km2(gapLand);
if (gapKm2 > 0.001) {
  const top = gapLand.map((p) => ({ m2: Math.round(km2([p]) * 1e6), at: turf.centroid(feat([p])).geometry.coordinates.map((x) => +x.toFixed(4)) })).sort((a, b) => b.m2 - a.m2);
  log(`   ${top.length} slivers of land outside every zone, biggest (m2, lng/lat): ${JSON.stringify(top.slice(0, 6))}`);
}
log(`   after growing and simplifying: ${zones.reduce((s, z) => s + z.points, 0)} points (was ${zones.reduce((s, z) => s + z.pointsBefore, 0)}), overlap ${overlap2.toFixed(4)} km2, land outside every zone ${gapKm2.toFixed(3)} km2`);

// which of the 16 areas does each zone hold; do the areas sit in zones of their own side
for (const z of zones) z.areas = Object.entries(AREAS).filter(([, [lat, lng]]) => pointIn(lat, lng, z.mp)).map(([n]) => n);
for (const [n, [lat, lng, side]] of Object.entries(AREAS)) {
  const hit = zones.filter((z) => pointIn(lat, lng, z.mp));
  if (hit.length !== 1) throw new Error(`area ${n} is in ${hit.length} zones`);
  if (hit[0].side !== side) throw new Error(`area ${n} (${side}) is in zone ${hit[0].slug} (${hit[0].side})`);
}
// the well-known places: each on land of its side, in the zone we expect
const probeProblems = [];
for (const [name, lat, lng, side, want] of PROBES) {
  const mass = Object.keys(MASS).find((m) => pointIn(lat, lng, MASS[m]));
  const hit = zones.filter((z) => pointIn(lat, lng, z.mp));
  if (!mass) probeProblems.push(`${name} (${lat}, ${lng}) is not on land`);
  else if (SIDE_OF_MASS[mass] !== side) probeProblems.push(`${name} is on ${SIDE_OF_MASS[mass]} land, not ${side}`);
  if (hit.length !== 1) probeProblems.push(`${name} is in ${hit.length} zones`);
  else if (hit[0].slug !== want) probeProblems.push(`${name} is in zone ${hit[0].slug}, expected ${want}`);
}
if (probeProblems.length) throw new Error("well-known places:\n  " + probeProblems.join("\n  "));
log(`   ${PROBES.length} well-known places: all on land of their side and in the zone expected`);
for (const z of zones) log(`   ${z.slug.padEnd(16)} ${z.side.padEnd(9)} polygon ${z.area.toFixed(1).padStart(7)} km2  land ${z.landKm2.toFixed(1).padStart(7)} km2  holds: ${z.areas.join(", ") || "-"}`);


  await writeFile(OUT_GEOJSON, JSON.stringify({ type: "FeatureCollection", features: zones.map((z) => feat(z.mp, { slug: z.slug, name: z.name, side: z.side, area_km2: +z.area.toFixed(1), land_km2: +z.landKm2.toFixed(1) })) }));
  log(`   wrote ${OUT_GEOJSON}`);
  return zones;
}
const loadZones = async () => {
  const gj = JSON.parse(await readFile(OUT_GEOJSON, "utf8"));
  return ZONES.map((z) => {
    const f = gj.features.find((x) => x.properties.slug === z.slug && /Polygon/.test(x.geometry.type));
    const mp = MP(f.geometry);
    return { ...z, side: SIDE_OF_ZONE(z), mp, area: f.properties.area_km2, landKm2: f.properties.land_km2,
      areas: Object.entries(AREAS).filter(([, [lat, lng]]) => pointIn(lat, lng, mp)).map(([n]) => n) };
  });
};
// --state-wkt prints the outline of Lagos State (OpenStreetMap, simplified to about 55 m) as WKT; the
// zone test holds a copy to prove that every spawn point inside the state is inside a zone.
if (args["state-wkt"]) {
  LGA_ALL ??= await loadLgas();
  const st = turf.simplify(feat(LGA_ALL.statePoly), { tolerance: 0.0005, highQuality: false });
  const ring = (r) => "(" + r.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join(",") + ")";
  console.log("MULTIPOLYGON(" + MP(st.geometry).map((poly) => "(" + poly.map(ring).join(",") + ")").join(",") + ")");
  process.exit(0);
}
const zones = args.reuse && existsSync(OUT_GEOJSON) ? await loadZones() : await buildZones();
if (args.stage === "geo") process.exit(0);

// ========================================================== 4. junctions ===
// The rules of docs/HOTSPOTS.md section 5: two roads with different names meet at one node
// (motorway, trunk, primary, secondary, tertiary), nodes within 60 m count once, not only on a
// bridge or tunnel, inside the zone, 60 m or more from water. Score: road class of the top
// two roads + 1 per extra road (2 at most) + 3 for traffic signals within 60 m + 2 for a
// roundabout + 0.4 per public place within 150 m (20 at most). In Lagos OSM the score leans
// on road class (few signals and places are mapped), so each spot below also says which two
// roads it means (`want`), and the script takes the best-scoring junction of exactly those.
const CLASS_W = { motorway: 4, trunk: 4, primary: 3, secondary: 2, tertiary: 1 };
const roadNorm = (s) => strip(s).replace(/\b(road|street|avenue|crescent|close|way|expressway|rd|st|ave|drive)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const waterLines = waterFeatures.map((f) => ({ bbox: turf.bbox(f), lines: MP(f.geometry).flatMap((poly) => poly.map((ring) => turf.lineString(ring))) }));
const waterDistanceM = (lat, lng) => {
  const pt = turf.point([lng, lat]);
  let best = Infinity;
  for (const w of waterLines) {
    const [x0, y0, x1, y1] = w.bbox;
    if (lng < x0 - 0.01 || lng > x1 + 0.01 || lat < y0 - 0.01 || lat > y1 + 0.01) continue;
    for (const l of w.lines) {
      const d = turf.pointToLineDistance(pt, l, { units: "meters" });
      if (d < best) best = d;
    }
  }
  return best;
};

async function junctionsAt(key, lat, lng, r) {
  const around = `(around:${r},${lat},${lng})`;
  const roadsRaw = await overpass(`roads-${key}`,
    `[out:json][timeout:90];\nway${around}["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["name"];\nout body;\n>;\nout skel qt;`);
  const poisRaw = await overpass(`pois-${key}`,
    `[out:json][timeout:90];\n(\n  node${around}["highway"~"^(traffic_signals|bus_stop)$"];\n  node${around}["amenity"~"^(bus_station|marketplace|fuel|bank|restaurant|bar|nightclub|cafe|fast_food|pub|school|university|college|place_of_worship|pharmacy|hospital|clinic|cinema|theatre)$"];\n  node${around}["shop"~"^(mall|supermarket|convenience)$"];\n);\nout body;`);
  const nodes = new Map(roadsRaw.elements.filter((e) => e.type === "node").map((n) => [n.id, n]));
  const ways = roadsRaw.elements.filter((e) => e.type === "way");
  const canon = [];
  const nameKey = (name) => {
    const n = roadNorm(name);
    const hit = canon.find((c) => c === n || lev(c, n) <= (Math.min(c.length, n.length) >= 9 ? 3 : 1));
    if (hit) return hit;
    canon.push(n);
    return n;
  };
  const byNode = new Map();
  for (const w of ways) for (const id of w.nodes) { if (!byNode.has(id)) byNode.set(id, []); byNode.get(id).push(w); }
  const raw = [];
  for (const [id, ws] of byNode) {
    const names = new Map();
    for (const w of ws) { const k = nameKey(w.tags.name); if (!names.has(k)) names.set(k, w); }
    if (names.size >= 2 && nodes.get(id)) raw.push({ id, ...nodes.get(id), ws: [...names.values()], onBridge: ws.some((w) => w.tags.bridge || w.tags.tunnel) });
  }
  const clusters = [];
  for (const n of raw) {
    const c = clusters.find((q) => HAV(q, n) <= 60);
    if (c) { c.items.push(n); c.lat = c.items.reduce((s, x) => s + x.lat, 0) / c.items.length; c.lon = c.items.reduce((s, x) => s + x.lon, 0) / c.items.length; }
    else clusters.push({ lat: n.lat, lon: n.lon, items: [n] });
  }
  const sig = poisRaw.elements.filter((p) => p.tags.highway === "traffic_signals");
  const busy = poisRaw.elements.filter((p) => p.tags.highway !== "traffic_signals");
  const out = [];
  for (const c of clusters) {
    const here = new Map();
    for (const it of c.items) for (const w of it.ws) {
      const k = nameKey(w.tags.name);
      const cur = here.get(k);
      if (!cur || CLASS_W[w.tags.highway] > CLASS_W[cur.class]) here.set(k, { name: w.tags.name, class: w.tags.highway });
    }
    if (here.size < 2) continue;
    const list = [...here.values()].sort((a, b) => CLASS_W[b.class] - CLASS_W[a.class]);
    const onBridge = c.items.every((i) => i.onBridge);
    const signals = sig.filter((s) => HAV(c, s) <= 60).length;
    const roundabout = c.items.some((i) => i.ws.some((w) => w.tags.junction === "roundabout"));
    const poi = busy.filter((p) => HAV(c, p) <= 150).length;
    const score = CLASS_W[list[0].class] + CLASS_W[list[1].class] + Math.min(list.length - 2, 2) + (signals ? 3 : 0) + (roundabout ? 2 : 0) + Math.min(poi, 20) * 0.4;
    const home = zones.find((z) => pointIn(c.lat, c.lon, z.mp));
    out.push({ lat: +c.lat.toFixed(5), lng: +c.lon.toFixed(5), roads: list, a: list[0].name, ac: list[0].class, b: list[1].name, bc: list[1].class,
      signals, roundabout, poi, onBridge, score: +score.toFixed(1), nodes: c.items.map((i) => i.id), zone: home?.slug ?? null, dist: Math.round(HAV({ lat, lon: lng }, c)) });
  }
  out.sort((x, y) => y.score - x.score || x.dist - y.dist);
  return out;
}
const fmtJ = (j) => `${String(j.score).padStart(5)}  ${j.lat},${j.lng}  ${j.roads.slice(0, 3).map((x) => `${x.name} (${x.class})`).join(" x ")}  sig ${j.signals} rb ${j.roundabout ? 1 : 0} poi ${j.poi} d ${j.dist} m  zone ${j.zone ?? "-"}${j.onBridge ? "  BRIDGE" : ""}`;

// -------------------------------------------------------------- discover ---
// Places to look around (name, [lat, lng], radius in m). `--discover` prints the best junctions
// around each, with the zone each one falls in. The PICK and SPLIT tables below use these keys.
const DISCOVER = [
  ["tbs", [6.4448, 3.4016], 700], ["marina", [6.4552, 3.3825], 700], ["obalende", [6.4513, 3.4085], 700], ["falomo", [6.4445, 3.4273], 700],
  ["alexander", [6.4497, 3.4492], 700], ["vi-akin", [6.4292, 3.4239], 700], ["oniru", [6.4357, 3.4426], 700],
  ["lekki-ph1", [6.4479, 3.4702], 900], ["lekki-ikate", [6.4366, 3.5078], 900], ["ajah", [6.4686, 3.5660], 1200],
  ["ibeju-eleko", [6.4560, 3.7900], 2500], ["ibeju-lfz", [6.4400, 3.8700], 2500],
  ["ikeja-allen", [6.6072, 3.3492], 800], ["agege", [6.6200, 3.3200], 1500], ["ogba", [6.6330, 3.3400], 1500],
  ["ketu", [6.5934, 3.3926], 1500], ["ogudu", [6.5790, 3.3880], 1500], ["gbagada", [6.5530, 3.3905], 1500], ["magodo", [6.6160, 3.3830], 1500],
  ["yaba-market", [6.5058, 3.3734], 900], ["jibowu", [6.5167, 3.3686], 700],
  ["ojuelegba", [6.5101, 3.3632], 700], ["oshodi", [6.5560, 3.3490], 1200], ["isolo", [6.5360, 3.3190], 1500], ["surulere-ao", [6.5000, 3.3560], 1200],
  ["festac", [6.4660, 3.2860], 2500], ["mile2", [6.4640, 3.3040], 1200], ["apapa", [6.4480, 3.3630], 1500],
  ["ikotun", [6.5500, 3.2500], 2000], ["iyana-ipaja", [6.6100, 3.2650], 2000], ["egbeda", [6.5870, 3.2970], 2000], ["igando", [6.5360, 3.2330], 2000],
  ["alaba", [6.4680, 3.1930], 2500], ["iyana-iba", [6.4690, 3.2160], 2000], ["badagry", [6.4150, 2.8840], 2500],
  ["ikorodu", [6.6190, 3.5060], 2500], ["epe", [6.5840, 3.9790], 2500],
  ["sangotedo", [6.4700, 3.6300], 2000], ["ojota-int", [6.5885, 3.3795], 700], ["badagry-w", [6.4300, 2.9300], 6000], ["epe-town", [6.5840, 3.9790], 5000],
  ["ojo", [6.4650, 3.1700], 4000], ["badagry-exp", [6.4300, 3.0300], 9000],
];
if (args.discover) {
  const only = typeof args.discover === "string" ? args.discover.split(",") : null;
  for (const [key, [lat, lng], r] of DISCOVER) {
    if (only && !only.includes(key)) continue;
    log(`\n== ${key} (${lat}, ${lng}) r ${r} m`);
    for (const j of (await junctionsAt(key, lat, lng, r)).slice(0, 12)) log("  " + fmtJ(j));
  }
  process.exit(0);
}

// ================================================================ 5. picks ===
// PICK: the hotspot of each zone. SPLIT: how the zone would break in two when its room is busy.
// Both name where to look (an `anchor` from DISCOVER) and the two roads they mean (`want`: one
// pattern for each road, tested on the lower-case name without accents). The script takes the
// best-scoring real junction of those two roads inside the zone and checks it.
//   local   the name people use for the place (my reading of the coordinates; Jae confirms)
//   unsure  the local name is NOT backed by OpenStreetMap (flagged in the report and in docs/HOTSPOTS.md).
//           "Backed" = the road at the junction carries the name as its own (a road named for the
//           places it runs between, like Lekki-Epe Expressway, does not back "Epe"), or OSM has a
//           place of that name within 1 km or a named feature of that name within 500 m; every
//           word of the name counts, so "Yaba Market" needs a market and "Pen Cinema" a cinema
//           (scripts/hotspots/check-names.mjs prints the evidence)
//   note    something else for Jae to look at: a better-known crossing, a junction on a zone line
// SPLIT cuts:
//   { kind: "lga", along: "...", a: [LGA names], b: [LGA names] }   split along an LGA line
//   { kind: "road", along: "Road name as OSM spells it", axis: "ew" | "ns" }
//      axis "ew": the road runs east-west, child a is north of it and child b south
//      axis "ns": the road runs north-south, child a is west of it and child b east
const PICK = {
  "lagos-island": { anchor: "obalende", want: [/obalende road/, /massey|moloney/], local: "Obalende",
    note: "Obalende is on the line with Ikoyi; the 150 m around it goes to Lagos Island" },
  "ikoyi": { anchor: "alexander", want: [/bourdillon/, /alexander avenue/], local: "Bourdillon (Alexander Avenue)",
    note: "Falomo Roundabout is the better-known crossing but sits 51 m from the Giwa defence headquarters, so the 100 m rule keeps it out; Jae can overrule. OSM's Alexander Roundabout is 510 m north of this crossing" },
  "victoria-island": { anchor: "vi-akin", want: [/akin adesola/, /adeola odeku/], local: "Adeola Odeku",
    note: "the nightlife strip is Adeola Odeku Street; the crossing is with Akin Adesola Street (OSM's own signals here are named for both streets)" },
  "lekki": { anchor: "lekki-ph1", want: [/admiralty way/, /fatai idowu/], local: "Lekki Phase 1 (Admiralty Way)" },
  "ajah": { anchor: "ajah", want: [/lekki.epe/, /mobil/], local: "Ajah (Mobil Road)",
    note: "OSM's Lekki-Ajah Flyover meets the expressway 33 m from this point, so this is the Ajah flyover crossing" },
  "ikeja": { anchor: "ikeja-allen", want: [/allen/, /awolowo/], local: "Allen Roundabout" },
  "ojota": { anchor: "ojota-int", want: [/ikorodu road/, /ogudu road/], local: "Ojota",
    note: "Ojota interchange: Ikorodu Road is the zone edge here, so the 150 m around it goes to this zone" },
  "yaba": { anchor: "jibowu", want: [/herbert macaulay/, /murt.la/], local: "Jibowu",
    note: "the LGA line runs through Jibowu; the 150 m around it goes to Yaba" },
  "surulere": { anchor: "ojuelegba", want: [/western avenue/, /ojuelegba road/], local: "Ojuelegba" },
  "festac": { anchor: "mile2", want: [/1st avenue/, /badagry/], local: "Mile 2",
    unsure: "this is the Festac 1st Avenue crossing on the Badagry Expressway. OSM puts its Mile 2 place 1.4 km east of here (6.4588, 3.3134) and Festac Town 2.1 km west. The named crossing nearest OSM's Mile 2 is the Expressway with Jakande Estate Road (6.46019, 3.30985): 960 m east of this one, in the same zone, clear of every rule, the swap if Jae wants the Mile 2 name" },
  "alimosho": { anchor: "ikotun", want: [/idimu.*ikotun/, /egbe road/], local: "Ikotun",
    note: "OSM names few Alimosho junctions; Ikotun is the clearest (Ikotun Terminal is 14 m away). Iyana Ipaja and Egbeda are the other big ones" },
  "ojo-badagry": { anchor: "alaba", want: [/lasu/, /badagry/], local: "Iyana Iba",
    note: "the LASU Road crossing on the Badagry Expressway near Alaba; OSM has Iyana-Iba Market 37 m away" },
  "ikorodu": { anchor: "ikorodu", want: [/ayangburen/, /beach road/], local: "Ikorodu (Ayangburen Road)",
    note: "I could not tell which crossing people call Ikorodu Garage (OSM maps no garage); this is the Ayangburen Road and Beach Road crossing" },
};

const SPLIT = {
  "lagos-island": { cut: { kind: "line", along: "Nnamdi Azikiwe Street", axis: "ns" },
    a: { slug: "lagos-island-west", name: "Idumota and Marina", label: "Idumota, Marina, Apongbon, Isale Eko", side: "west", anchor: "marina", want: [/broad street/, /balogun/], local: "Balogun (Broad Street)", note: "I read this as the Balogun market crossing; Idumota is the usual name for the area, and the waterfront Marina and CMS crossings are under the 60 m water rule" },
    b: { slug: "lagos-island-east", name: "Obalende and Onikan", label: "Obalende, Onikan, Tafawa Balewa Square", side: "east", anchor: "obalende", want: [/obalende road/, /massey|moloney/], local: "Obalende" } },
  "ikoyi": { cut: { kind: "line", along: "MacPherson Avenue", axis: "ns" },
    a: { slug: "ikoyi-west", name: "Old Ikoyi", label: "Old Ikoyi, Awolowo Road, Falomo", side: "west", anchor: "falomo", want: [/mobolaji/, /murtala muhammed drive/], local: "Ikoyi (Mobolaji Johnson Road)", note: "Falomo is the usual name for this end of Ikoyi but is under the 100 m rule" },
    b: { slug: "ikoyi-east", name: "Parkview and Banana Island", label: "Alexander Avenue, Parkview, Banana Island", side: "east", anchor: "alexander", want: [/bourdillon/, /alexander avenue/], local: "Bourdillon (Alexander Avenue)" } },
  "victoria-island": { cut: { kind: "line", along: "Adetokunbo Ademola Street", axis: "ns" },
    a: { slug: "victoria-island-west", name: "Victoria Island", label: "Victoria Island, Adeola Odeku, Eko Atlantic", side: "west", anchor: "vi-akin", want: [/akin adesola/, /adeola odeku/], local: "Adeola Odeku" },
    b: { slug: "victoria-island-east", name: "Oniru and Maroko", label: "Oniru, Maroko, the Lekki gateway", side: "east", anchor: "oniru", want: [/maroko road/, /lekki.epe/], local: "Oniru", unsure: "I read the Maroko Road and Expressway crossing as Oniru; OSM has nothing called Oniru within 1 km (Itirin is 1.1 km, Maroko 1.6 km)" } },
  "lekki": { cut: { kind: "line", along: "Platinum Way", axis: "ns" },
    a: { slug: "lekki-west", name: "Lekki Phase 1", label: "Lekki Phase 1, Admiralty Way, Lekki Phase 2 west", side: "west", anchor: "lekki-ph1", want: [/admiralty way/, /fatai idowu/], local: "Lekki Phase 1 (Admiralty Way)" },
    b: { slug: "lekki-east", name: "Ikate and Chevron", label: "Ikate, Elegushi, Chevron, Jakande", side: "east", anchor: "lekki-ikate", want: [/lekki.epe/, /lekki beach road/], local: "Ikate (Lekki Beach Road)", unsure: "the Lekki Beach Road crossing, which I read as Ikate or Elegushi; OSM's nearest place is Jakande, 255 m away, and Ikate is not within 1.6 km" } },
  "ajah": { cut: { kind: "line", along: "Addo Road", axis: "ns" },
    a: { slug: "ajah-west", name: "Ajah", label: "Ajah, Abraham Adesanya, Badore", side: "west", anchor: "ajah", want: [/lekki.epe/, /mobil/], local: "Ajah (Mobil Road)" },
    b: { slug: "ajah-east", name: "Sangotedo and beyond", label: "Sangotedo, Awoyaya, Ibeju-Lekki, Epe (south of the lagoon)", side: "east", anchor: "sangotedo", want: [/lekki.epe/, /okogie/], local: "Sangotedo", note: "the Cardinal Okogie Road crossing; OSM's Sangotedo is 497 m away" } },
  "ikeja": { cut: { kind: "lga", along: "the Ikeja LGA boundary", a: ["Ikeja"], b: ["Agege", "Ifako/Ijaye"] },
    a: { slug: "ikeja-gra", name: "Ikeja", label: "Ikeja GRA, Alausa, Opebi, Maryland, Ogba", side: "Ikeja LGA", anchor: "ikeja-allen", want: [/allen/, /awolowo/], local: "Allen Roundabout" },
    b: { slug: "agege-ifako", name: "Agege and Ifako-Ijaiye", label: "Agege, Pen Cinema, Ifako, Ijaiye, Alagbado", side: "Agege and Ifako-Ijaiye LGAs", anchor: "agege", want: [/capitol road/, /alfa nla/], local: "Agege (Pen Cinema)", unsure: "I read the Capitol Road and Alfa Nla Road crossing as Pen Cinema; OSM maps no Pen Cinema (Agege is 554 m away)" } },
  "ojota": { cut: { kind: "line", along: "Ogudu Road, carried east-west (about 6.572 N)", axis: "ew", at: 6.572 },
    a: { slug: "ojota-ketu", name: "Ojota, Ketu and Magodo", label: "Ojota, Ketu, Ogudu, Magodo, Mile 12", side: "north", anchor: "ojota-int", want: [/ikorodu road/, /ogudu road/], local: "Ojota" },
    b: { slug: "gbagada-oworonshoki", name: "Gbagada and Oworonshoki", label: "Gbagada, Anthony, Oworonshoki", side: "south", anchor: "gbagada", want: [/diya street/, /ajayi aina/], local: "Gbagada (Diya Street)", note: "OSM has few named Gbagada junctions; this is the Diya Street crossing, 605 m from OSM's Gbagada" } },
  "yaba": { cut: { kind: "lga", along: "the Lagos Mainland and Shomolu LGA line", a: ["Lagos Mainland"], b: ["Shomolu"] },
    a: { slug: "yaba-ebute-metta", name: "Yaba and Ebute Metta", label: "Yaba, Ebute Metta, Makoko, Iddo", side: "Lagos Mainland LGA", anchor: "yaba-market", want: [/murt.la/, /commercial avenue/], local: "Yaba Market (Commercial Avenue)", unsure: "I read the Commercial Avenue crossing as the Yaba market side; OSM maps no market there (Yaba is 264 m away)" },
    b: { slug: "shomolu-bariga", name: "Shomolu and Bariga", label: "Jibowu, Akoka, Shomolu, Bariga, Pedro", side: "Shomolu LGA", anchor: "jibowu", want: [/herbert macaulay/, /murt.la/], local: "Jibowu", note: "OSM puts Jibowu in Shomolu LGA, so the room keeps Jibowu when the zone splits" } },
  "surulere": { cut: { kind: "lga", along: "the Oshodi-Isolo LGA line", a: ["Surulere", "Mushin"], b: ["Oshodi/Isolo"] },
    a: { slug: "surulere-mushin", name: "Surulere and Mushin", label: "Surulere, Mushin, Ojuelegba, Aguda, Itire, Ilupeju", side: "Surulere and Mushin LGAs", anchor: "ojuelegba", want: [/western avenue/, /ojuelegba road/], local: "Ojuelegba" },
    b: { slug: "oshodi-isolo", name: "Oshodi and Isolo", label: "Oshodi, Isolo, Okota, Ejigbo", side: "Oshodi-Isolo LGA", anchor: "oshodi", want: [/agege motor road/, /apapa.oworonshoki/], local: "Oshodi" } },
  "festac": { cut: { kind: "lga", along: "the Amuwo Odofin LGA line", a: ["Amuwo Odofin"], b: ["Apapa", "Ajeromi/Ifelodun"] },
    a: { slug: "festac-amuwo", name: "Festac and Amuwo Odofin", label: "Festac, Mile 2, Satellite Town, Amuwo Odofin", side: "Amuwo Odofin LGA", anchor: "mile2", want: [/1st avenue/, /badagry/], local: "Mile 2" },
    b: { slug: "apapa-ajegunle", name: "Apapa and Ajegunle", label: "Apapa, Ajegunle, Ajeromi, Ifelodun", side: "Apapa and Ajeromi-Ifelodun LGAs", anchor: "apapa", want: [/liverpool road/, /liverpool roundabout/], local: "Liverpool (Apapa)", note: "the Liverpool roundabout in Apapa; the Wharf Road crossing is inside the port zone" } },
  "alimosho": { cut: { kind: "line", along: "Egbeda-Idimu Road, carried straight south to Egbe Road (about 3.285 E)", axis: "ns", at: 3.285 },
    a: { slug: "alimosho-west", name: "Ikotun and Igando", label: "Ikotun, Igando, Ipaja, Iyana Ipaja", side: "west", anchor: "ikotun", want: [/idimu.*ikotun/, /egbe road/], local: "Ikotun" },
    b: { slug: "alimosho-east", name: "Egbeda and Idimu", label: "Egbeda, Idimu, Akowonjo, Shasha", side: "east", anchor: "egbeda", want: [/ejigbo road/, /shasha/], local: "Shasha", note: "the Shasha Road crossing, a tertiary junction" } },
  "ojo-badagry": { cut: { kind: "line", along: "a north-south line at about 3.185 E between Ojo and Iba (no named road runs along it)", axis: "ns", at: 3.185 },
    a: { slug: "badagry-ojo-west", name: "Ojo and Badagry", label: "Ojo, Igbede, Era, Badagry", side: "west", anchor: "ojo", want: [/ilogbo/, /ojo.*igbede/], local: "Ojo (Igbede Road)", unsure: "the Ilogbo Road and Ojo-Igbede Road crossing; OSM's Ojo is 2.2 km east, Sabo Oniba is 727 m and Igbede 1.5 km away" },
    b: { slug: "alaba-iba", name: "Alaba and Iba", label: "Alaba, Iba, Okokomaiko, LASU", side: "east", anchor: "alaba", want: [/lasu/, /badagry/], local: "Iyana Iba" } },
  "ikorodu": { cut: { kind: "lga", along: "the Ikorodu LGA line", a: ["Ikorodu"], b: ["Epe"] },
    a: { slug: "ikorodu-town", name: "Ikorodu", label: "Ikorodu, Itoikin, Imota", side: "Ikorodu LGA", anchor: "ikorodu", want: [/ayangburen/, /beach road/], local: "Ikorodu (Ayangburen Road)" },
    b: { slug: "epe-town", name: "Epe", label: "Epe, Ijebu-Ode road", side: "Epe LGA", anchor: "epe-town", want: [/lekki.epe/, /old lagos road/], local: "Epe (Old Lagos Road)", unsure: "the Old Lagos Road crossing west of Epe town; OSM's Epe is 2.7 km away" } },
};

// Roads that OpenStreetMap misspells, fixed for display only (the matcher uses the OSM spelling).
const SHOW_NAME = { "Murtula Muhammed Way": "Murtala Muhammed Way" };
const shown = (n) => SHOW_NAME[n] ?? n;
const matchWant = (j, want) => {
  const ia = j.roads.findIndex((r) => want[0].test(strip(r.name)));
  const ib = j.roads.findIndex((r, i) => i !== ia && want[1].test(strip(r.name)));
  return ia >= 0 && ib >= 0 ? [j.roads[ia], j.roads[ib]] : null;
};
const anchorOf = (s) => {
  const d = DISCOVER.find((x) => x[0] === s.anchor);
  if (!d) throw new Error(`no anchor ${s.anchor} in DISCOVER`);
  return { key: d[0], lat: d[1][0], lng: d[1][1], r: d[2] };
};

// The local database says whether a point is clean: outside every active no-spawn zone, 60 m or
// more from water, 100 m or more from military, prison, port and airport zones (the rules of
// docs/HOTSPOTS.md section 5). Skipped with a warning when Docker is not running.
let dbWarned = false;
function dbCheck(points) {
  if (!points.length) return [];
  const vals = points.map((p, i) => `(${i}, st_point(${p.lng}, ${p.lat})::geography)`).join(",");
  const sql = `select i, exists(select 1 from no_spawn_zones z where z.active and st_intersects(z.geog, p)),
      coalesce((select round(min(st_distance(z.geog, p)))::int from no_spawn_zones z where z.active and z.zone_type = 'water'), 99999),
      coalesce((select round(min(st_distance(z.geog, p)))::int from no_spawn_zones z where z.active and z.zone_type in ('military','prison','port','airport')), 99999)
    from (values ${vals}) v(i, p) order by i`;
  try {
    const out = execFileSync("docker", ["exec", "-i", "supabase_db_hoppaz-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out.trim().split("\n").map((l) => { const [, inside, water, restricted] = l.split("|"); return { inside: inside === "t", water: +water, restricted: +restricted }; });
  } catch (e) {
    if (!dbWarned) { dbWarned = true; console.error("   (no local database: the no-spawn checks are skipped; supabase/tests/hotspot_zones_test.sql does them)"); }
    return points.map(() => null);
  }
}

// How far a point is from a zone, in metres (0 inside).
const outsideM = (slug, p) => {
  const z = zones.find((q) => q.slug === slug);
  if (pointIn(p.lat, p.lng, z.mp)) return 0;
  const pt = turf.point([p.lng, p.lat]);
  let best = Infinity;
  for (const poly of z.mp) for (const ring of poly) best = Math.min(best, turf.pointToLineDistance(pt, turf.lineString(ring), { units: "meters" }));
  return Math.round(best);
};

async function pickJunction(parent, s, tag) {
  const an = anchorOf(s);
  const all = await junctionsAt(an.key, an.lat, an.lng, an.r);
  const found = all.map((j) => ({ j, m: matchWant(j, s.want) })).filter((x) => x.m && !x.j.onBridge && waterDistanceM(x.j.lat, x.j.lng) >= 60
    && (x.j.zone === parent || (outsideM(parent, x.j) <= DISC_M && (tag === parent || (picks[parent]?.lat === x.j.lat && picks[parent]?.lng === x.j.lng)))));
  if (!found.length) {
    const why = all.map((j) => ({ j, m: matchWant(j, s.want) })).filter((x) => x.m)
      .map((x) => `${x.j.lat},${x.j.lng} zone ${x.j.zone} ${x.j.onBridge ? "bridge " : ""}water ${Math.round(waterDistanceM(x.j.lat, x.j.lng))} m`).join("; ");
    throw new Error(`${tag}: no usable junction of ${s.want.join(" and ")} inside ${parent} near ${s.anchor} (${why || "none match the roads"}). Run --discover=${an.key}`);
  }
  found.sort((x, y) => y.j.score - x.j.score || x.j.dist - y.j.dist);
  const [{ j, m }] = found;
  return { local: s.local, lat: j.lat, lng: j.lng, road_a: shown(m[0].name), class_a: m[0].class, road_b: shown(m[1].name), class_b: m[1].class,
    score: j.score, signals: j.signals, places: j.poi, roundabout: j.roundabout, others: found.length - 1, unsure: s.unsure ?? null, note: s.note ?? null };
}

// Which side of a road is a point on? The road is read from OpenStreetMap (cached) as points. For
// an east-west road the question is whether the point is north or south of the road's latitude at
// the point's own longitude (and the same for a north-south road with longitudes). Where the
// road does not reach that far (a short street), the road is carried on as a straight line at its
// mean position, if it is straight enough (spread under 300 m).
async function roadSide(zone, cut, pt) {
  const ew0 = cut.axis === "ew";
  if (cut.at !== undefined) { // a straight line at a given latitude (ew) or longitude (ns); no road runs along it
    const g = ((ew0 ? pt.lat : pt.lng) - cut.at) * 111000 * (ew0 ? 1 : Math.cos(pt.lat * Math.PI / 180));
    return { side: Math.sign(g), gap: Math.round(Math.abs(g)), how: "line", at: cut.at };
  }
  const bb = turf.bbox(feat(zone.mp));
  const raw = await overpass(`cut-${cut.along.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    `[out:json][timeout:60];\nway["highway"]["name"="${cut.along.replace(/"/g, '\\"')}"](${bb[1]},${bb[0]},${bb[3]},${bb[2]});\nout geom;`);
  const pts = raw.elements.flatMap((w) => w.geometry ?? []).filter((p) => pointIn(p.lat, p.lon, zone.mp));
  if (!pts.length) throw new Error(`the road ${cut.along} is not inside ${zone.slug}`);
  const ew = cut.axis === "ew";
  const k = Math.cos(pt.lat * Math.PI / 180);
  const along = (p) => (ew ? p.lon : p.lat), across = (p) => (ew ? p.lat : p.lon);
  const toM = (d) => d * 111000 * (ew ? 1 : k); // a latitude (ew road) or longitude (ns road) difference in metres
  const near = pts.filter((p) => Math.abs(along(p) - (ew ? pt.lng : pt.lat)) * 111000 * (ew ? k : 1) <= 400);
  let at, how;
  if (near.length) { at = near.reduce((s, p) => s + across(p), 0) / near.length; how = "road"; }
  else {
    const m = pts.reduce((s, p) => s + across(p), 0) / pts.length;
    const sd = Math.sqrt(pts.reduce((s, p) => s + (toM(across(p) - m)) ** 2, 0) / pts.length);
    if (sd > 300) return { side: 0, gap: Infinity, how: `the road does not reach it and bends (spread ${Math.round(sd)} m)` };
    at = m; how = "straight";
  }
  const gap = toM((ew ? pt.lat : pt.lng) - at);
  return { side: Math.sign(gap), gap: Math.round(Math.abs(gap)), how, at };
}

const picks = {};
const splits = {};
const problems = [];
for (const z of zones) {
  if (!PICK[z.slug]) { problems.push(`${z.slug}: no pick yet`); continue; }
  picks[z.slug] = await pickJunction(z.slug, PICK[z.slug], z.slug);
  const sp = SPLIT[z.slug];
  if (!sp) { problems.push(`${z.slug}: no split yet`); continue; }
  const kids = [];
  for (const k of ["a", "b"]) kids.push({ ...sp[k], slug: sp[k].slug, lgas: sp.cut.kind === "lga" ? sp.cut[k] : null, junction: await pickJunction(z.slug, sp[k], `${z.slug}/${k}`) });
  const [ka, kb] = kids;
  const apart = Math.round(HAV({ lat: ka.junction.lat, lon: ka.junction.lng }, { lat: kb.junction.lat, lon: kb.junction.lng }));
  if (apart < 800) problems.push(`${z.slug}: the two child junctions are only ${apart} m apart`);
  if (sp.cut.kind === "lga") {
    LGA_ALL ??= await loadLgas();
    const inGroup = (names, j) => pointIn(j.lat, j.lng, U(...names.map((n) => LGA_ALL.LGA[n])));
    if (!inGroup(sp.cut.a, ka.junction)) problems.push(`${z.slug}: child a is not in ${sp.cut.a.join(" + ")}`);
    if (!inGroup(sp.cut.b, kb.junction)) problems.push(`${z.slug}: child b is not in ${sp.cut.b.join(" + ")}`);
  } else {
    const sa = await roadSide(z, sp.cut, ka.junction), sb = await roadSide(z, sp.cut, kb.junction);
    const want = sp.cut.axis === "ew" ? [1, -1] : [-1, 1];
    if (sa.side !== want[0] || sb.side !== want[1]) problems.push(`${z.slug}: the children are not on the two sides of ${sp.cut.along} (${JSON.stringify([sa, sb])})`);
    else if (sa.gap < 150 || sb.gap < 150) problems.push(`${z.slug}: a child junction is within 150 m of ${sp.cut.along} (${sa.gap} m, ${sb.gap} m)`);
    sp.cut.cutAt = sp.cut.at ?? +((sa.at + sb.at) / 2).toFixed(4);
    sp.cut.how = [sa.how, sb.how];
  }
  splits[z.slug] = { cut: sp.cut, note: sp.note ?? null, kids, apart };
}
// A hotspot's surroundings belong to its zone. LGA lines often run along a major road, so a
// junction on that road (Jibowu is the case) can sit on the line itself; the 150 m around each
// hotspot is given to its zone (and taken from the neighbour) so it is never on an edge.
{
  const moved = [];
  for (const z of zones) {
    const p = picks[z.slug];
    if (!p) continue;
    const disc = MP(turf.circle([p.lng, p.lat], DISC_M, { steps: 32, units: "meters" }).geometry);
    const before = zones.map((q) => q.mp);
    for (const q of zones) q.mp = q.slug === z.slug ? U(q.mp, disc) : D(q.mp, disc);
    const changed = zones.filter((q, i) => Math.abs(km2(q.mp) - km2(before[i])) > 1e-6).map((q) => q.slug);
    if (changed.length > 1) moved.push(`${z.slug} took land from ${changed.filter((c) => c !== z.slug).join(", ")}`);
  }
  for (const z of zones) z.area = km2(z.mp); // (land km2 moves by well under 0.1 km2: not recomputed)
  if (moved.length) log(`   hotspot surroundings (${DISC_M} m): ${moved.join("; ")}`);
}
// the local database check, for every junction at once
{
  const list = [];
  for (const z of zones) {
    if (picks[z.slug]) list.push({ tag: z.slug, p: picks[z.slug] });
    for (const k of splits[z.slug]?.kids ?? []) list.push({ tag: `${z.slug}/${k.slug}`, p: k.junction });
  }
  const res = dbCheck(list.map((x) => x.p));
  list.forEach((x, i) => {
    const r = res[i];
    x.p.db = r;
    if (r && (r.inside || r.water < 60 || r.restricted < 100)) problems.push(`${x.tag}: ${x.p.local} fails the no-spawn rules (${JSON.stringify(r)})`);
  });
}
for (const z of zones) {
  const p = picks[z.slug];
  if (p && !pointIn(p.lat, p.lng, z.mp)) problems.push(`${z.slug}: the pick is outside its zone`);
  if (p && zones.filter((q) => pointIn(p.lat, p.lng, q.mp)).length !== 1) problems.push(`${z.slug}: the pick is in more than one zone`);
}
if (zones.length < 10 || zones.length > 14) problems.push(`${zones.length} zones; the brief asks for 10 to 14`);

log("\n5. one hotspot per zone");
for (const z of zones) {
  const p = picks[z.slug];
  if (!p) continue;
  log(`   ${z.slug.padEnd(16)} ${p.local.padEnd(18)} ${p.road_a} (${p.class_a}) x ${p.road_b} (${p.class_b})  ${p.lat},${p.lng}  score ${p.score} sig ${p.signals} places ${p.places}${p.roundabout ? " roundabout" : ""}${p.unsure ? "  UNSURE: " + p.unsure : ""}${p.note ? "  NOTE: " + p.note : ""}`);
  for (const k of splits[z.slug]?.kids ?? []) {
    const j = k.junction;
    log(`      split ${k.slug.padEnd(20)} ${j.local.padEnd(18)} ${j.road_a} x ${j.road_b}  ${j.lat},${j.lng}${j.unsure ? "  UNSURE: " + j.unsure : ""}${j.note ? "  NOTE: " + j.note : ""}`);
  }
}
if (problems.length) {
  console.error("\nPROBLEMS:\n  " + problems.join("\n  "));
  process.exit(2);
}

// ============================================================== 6. output ===
const q = (t) => `'${String(t).replace(/'/g, "''")}'`; // a SQL string
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const SPLIT_WHEN = { peak_people: 60, days: 7 };

for (const z of zones) {
  z.mpClean = cleanMP(z.mp);
  const g = J(z.mpClean);
  if (!g.isValid() || z.mpClean.some((poly) => poly.some((ring) => ring.length < 4))) throw new Error(`${z.slug}: the final shape is not valid`);
}
const rows = zones.map((z) => {
  const p = picks[z.slug];
  const sp = splits[z.slug];
  const child = (k) => ({
    slug: k.slug, name: k.name, zone_label: k.label,
    junction: k.junction.local, road_a: k.junction.road_a, road_b: k.junction.road_b, lat: k.junction.lat, lng: k.junction.lng,
    side_of_cut: k.side,
  });
  const hint = {
    trigger: SPLIT_WHEN,
    cut_kind: sp.cut.kind,
    cut_along: sp.cut.along,
    ...(sp.cut.kind === "lga" ? { lgas: { a: sp.cut.a, b: sp.cut.b } } : { axis: sp.cut.axis, at: sp.cut.cutAt }),
    children: sp.kids.map(child),
    ...(sp.note ? { note: sp.note } : {}),
  };
  return { z, p, hint };
});

// Final shape of a zone for the database: coordinates on a 1 m grid, no ring with fewer than 4
// points or under 200 m2 (rounding leaves such specks), and valid by JSTS's rules.
function cleanMP(mp) {
  const roundRing = (ring) => {
    const out = [];
    for (const [x, y] of ring) { const p = [r5(x), r5(y)]; if (!out.length || out.at(-1)[0] !== p[0] || out.at(-1)[1] !== p[1]) out.push(p); }
    if (out.length && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) out.push(out[0]);
    return out;
  };
  const ringOk = (ring) => ring.length >= 4 && turf.area(turf.polygon([ring])) >= 200;
  const rounded = mp.map((poly) => poly.map(roundRing)).filter((poly) => ringOk(poly[0])).map((poly) => [poly[0], ...poly.slice(1).filter(ringOk)]);
  let g = J(rounded);
  if (!g.isValid()) g = g.buffer(0);
  return fromJ(g).map((poly) => poly.map((ring) => ring.map(([x, y]) => [r5(x), r5(y)])));
}
const jsonOf = (z) => JSON.stringify({ type: "MultiPolygon", coordinates: z.mpClean });
const sqlRow = ({ z, p, hint }) =>
  `  (${q(z.slug)}, ${q(z.name)}, ${q(z.label)}, ${q(z.side)}, ${q(p.local)}, ${q(p.road_a)}, ${q(p.road_b)}, ${p.lat}, ${p.lng},\n` +
  `   st_multi(st_setsrid(st_geomfromgeojson($g$${jsonOf(z)}$g$), 4326)), ${z.area.toFixed(1)}, ${z.landKm2.toFixed(1)},\n` +
  `   $j$${JSON.stringify(hint)}$j$::jsonb, ${z.wave})`;

const SQL = `-- ============================================================================
-- Hoppaz: hotspot zones (one room per zone, Lagos cut into ${zones.length} zones)
-- Standalone and safe to run again. Needs PostGIS only (schema.sql installs it).
-- Spec: docs/HOTSPOTS.md section 4. Made by scripts/hotspots/zones.mjs from
-- OpenStreetMap (c) OpenStreetMap contributors, ODbL. Do not edit the rows by
-- hand: change the script and run it again.
--
-- Jae, 9 Oct 2026: "Segment Lagos into zones. Just segment the zones that are
-- very large, and each zone has one room (one hotspot). Then over time, as more
-- people come, we break down the rooms. Keep it simple." The zone you stand in
-- is your hotspot; anyone can still visit any hotspot.
--
-- How the zones are cut. Lagos State's 20 LGAs (OpenStreetMap admin_level 6;
-- there are no LCDA or ward shapes) are grouped into zones. Eti Osa, the one LGA
-- that holds Ikoyi, Victoria Island and all of Lekki, is cut along Admiralty Way
-- and Chevron Drive. The lagoon and the creeks are the edge: a zone never holds
-- land on both sides of them (side is 'mainland' or 'island'). Each zone reaches
-- 300 m into the water around it, so a position that drifts on a shoreline is
-- still inside. Zones do not overlap and leave no land of the state out. The
-- 150 m around each hotspot belongs to its zone, so a hotspot is never on an edge
-- (an LGA line often runs along a major road; Jibowu is on one).
--
-- Columns:
--   slug, name, zone_label   what the room is called and the places in it
--   side                     'mainland' or 'island' (the lagoon is the edge)
--   junction, road_a/_b      the one hotspot of the zone: a real crossing of
--                            two named roads (the local name is Jae's to confirm)
--   lat, lng, geom           where that junction is (geom is made from lat, lng)
--   zone_geom                the zone, a MultiPolygon in lng/lat (WGS 84). The
--                            phone works out which zone it is in from this
--                            public shape; the server never learns the position.
--   area_km2, land_km2       zone shape (with its water margin), and land only
--   parent_id                null for these first zones. Set when staff split a
--                            zone: the two child zones point at the parent.
--   split_hint               how the zone would be cut first, as data (jsonb):
--     trigger                {"peak_people": 60, "days": 7}: the room's daily peak
--                            is 60 or more people for 7 days in a row
--     cut_kind               'lga': cut along an LGA line; lgas.a and lgas.b name
--                            the LGAs of child 1 and child 2
--                            'line': a straight line along a named road; axis 'ns'
--                            (child 1 is west of it, child 2 east) or 'ew' (child 1
--                            north, child 2 south) and at = its longitude or latitude
--     cut_along              the road or boundary the cut follows
--     children               two entries: slug, name, zone_label, side_of_cut and the
--                            junction (junction, road_a, road_b, lat, lng) that would
--                            become that child's hotspot. A child keeps the parent's
--                            junction when the junction lies in its half.
--   status                   planned (default), active, paused, split. A split
--                            parent stays as history and is no longer shown.
--   wave                     1 first (where Hoppaz events are) ... 4 the outer zones
--   name_confirmed           false until Jae has confirmed the local names
--
-- Who can read: anyone (anon and signed in) reads the rows whose status is
-- active or planned. Nobody but the service role writes. The app never writes a
-- position here: the table holds fixed places and zone shapes only.
-- ============================================================================

create extension if not exists postgis;

create table if not exists public.hotspots (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  zone_label     text not null default '',
  side           text not null check (side in ('mainland', 'island')),
  junction       text not null default '',
  road_a         text not null,
  road_b         text not null,
  lat            double precision not null check (lat between 6.0 and 7.0),
  lng            double precision not null check (lng between 2.5 and 4.5),
  geom           geometry(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)) stored,
  zone_geom      geometry(MultiPolygon, 4326) not null,
  area_km2       numeric(8, 1) not null default 0,
  land_km2       numeric(8, 1) not null default 0,
  parent_id      uuid references public.hotspots(id) on delete restrict,
  split_hint     jsonb not null default '{}'::jsonb,
  status         text not null default 'planned' check (status in ('planned', 'active', 'paused', 'split')),
  wave           integer not null default 1 check (wave between 1 and 9),
  name_confirmed boolean not null default false,
  created_at     timestamptz not null default now(),
  check (st_isvalid(zone_geom))
);
create index if not exists hotspots_zone_idx on public.hotspots using gist (zone_geom);
create index if not exists hotspots_geom_idx on public.hotspots using gist (geom);

alter table public.hotspots enable row level security;
drop policy if exists hotspots_read on public.hotspots;
create policy hotspots_read on public.hotspots for select to anon, authenticated using (status in ('active', 'planned'));
revoke all on public.hotspots from anon, authenticated;
grant select on public.hotspots to anon, authenticated;
grant all on public.hotspots to service_role;

-- The zones. A run again updates the shapes, names, junctions and split hints but
-- never the status, the parent or the confirmed flag, which staff own.
insert into public.hotspots (slug, name, zone_label, side, junction, road_a, road_b, lat, lng, zone_geom, area_km2, land_km2, split_hint, wave)
values
${rows.map(sqlRow).join(",\n")}
on conflict (slug) do update set
  name = excluded.name, zone_label = excluded.zone_label, side = excluded.side, junction = excluded.junction,
  road_a = excluded.road_a, road_b = excluded.road_b, lat = excluded.lat, lng = excluded.lng,
  zone_geom = excluded.zone_geom, area_km2 = excluded.area_km2, land_km2 = excluded.land_km2,
  split_hint = excluded.split_hint, wave = excluded.wave;
`;
await writeFile(OUT_SQL, SQL);
// zones.geojson: the final zones (after the hotspot surroundings), each hotspot and the split junctions
await writeFile(OUT_GEOJSON, JSON.stringify({
  type: "FeatureCollection",
  features: [
    ...rows.map(({ z, p }) => feat(z.mpClean,
      { kind: "zone", slug: z.slug, name: z.name, side: z.side, wave: z.wave, area_km2: +z.area.toFixed(1), land_km2: +z.landKm2.toFixed(1), hotspot: p.local })),
    ...rows.map(({ z, p }) => ({ type: "Feature", properties: { kind: "hotspot", slug: z.slug, name: p.local, road_a: p.road_a, road_b: p.road_b }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })),
    ...rows.flatMap(({ z, hint }) => hint.children.map((c) => ({ type: "Feature", properties: { kind: "split", slug: c.slug, zone: z.slug, name: c.junction, road_a: c.road_a, road_b: c.road_b }, geometry: { type: "Point", coordinates: [c.lng, c.lat] } }))),
  ],
}));
log(`   wrote ${OUT_GEOJSON}`);
log(`\n6. wrote ${OUT_SQL} (${(SQL.length / 1024).toFixed(0)} KB)`);

// the numbers for docs/HOTSPOTS.md
log("\n| Zone | Side | Hotspot | Roads | km2 | Holds |");
for (const { z, p } of rows) log(`| ${z.name} | ${z.side} | ${p.local} | ${p.road_a} x ${p.road_b} | ${z.area.toFixed(0)} | ${z.areas.join(", ") || "-"} |`);
