#!/usr/bin/env node
// ============================================================================
// Hoppaz hotspots: builds the phone map mock, localdb/phone-https/mocks/hotspots.html
//
// Jae opens it on his phone at /mocks/hotspots (the local phone proxy serves any
// localdb/phone-https/mocks/<name>.html). It is one self-contained file: the zones,
// hotspots, split lines and label points are inlined as JSON, the wordmark is inlined,
// and only MapLibre GL (jsdelivr), the fonts and the CARTO tiles come from the network.
//
// Reads, never writes:
//   - the local database (docker container supabase_db_hoppaz-local): the `hotspots`
//     table made by supabase/hotspot_zones.sql, and the `areas` table
//   - the Overpass answers that scripts/hotspots/zones.mjs cached (admin-tags-*.json and
//     lga-geom-*.json), only to draw the LGA lines a zone would first be cut along
// Writes: the mock html. The page itself is scripts/hotspots/hotspots-map.template.html.
//
//   node scripts/hotspots/build-map-mock.mjs --deps=<dir with node_modules and the Overpass cache>
//
// Options:
//   --deps=<dir>      directory with node_modules (the same install zones.mjs uses). Required.
//   --cache=<dir>     where the cached Overpass answers are (default: --deps)
//   --out=<file>      default <repo>/../localdb/phone-https/mocks/hotspots.html
//   --db=<container>  default supabase_db_hoppaz-local
// Data (c) OpenStreetMap contributors, ODbL.
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
if (typeof args.deps !== "string") {
  console.error("Pass --deps=<dir with node_modules and the Overpass cache>. See the top of this file.");
  process.exit(1);
}
const DEPS = resolve(args.deps);
const CACHE = resolve(typeof args.cache === "string" ? args.cache : DEPS);
const OUT = resolve(typeof args.out === "string" ? args.out : join(REPO, "../localdb/phone-https/mocks/hotspots.html"));
const DB = typeof args.db === "string" ? args.db : "supabase_db_hoppaz-local";
const TEMPLATE = join(here, "hotspots-map.template.html");
const WORDMARK = join(REPO, "public/brand/wordmark-orange.png");

if (!existsSync(join(DEPS, "node_modules"))) {
  console.error(`No node_modules in ${DEPS}. Install the packages listed at the top of zones.mjs there.`);
  process.exit(1);
}
const req = createRequire(join(DEPS, "package.json"));
const turf = req("@turf/turf");
const pc = req("polygon-clipping");
const osmtogeojson = req("osmtogeojson");
const jstsImport = (p) => import(pathToFileURL(join(DEPS, "node_modules/jsts/org/locationtech/jts", p)).href);
const { default: GeoJSONReader } = await jstsImport("io/GeoJSONReader.js");
const { default: GeoJSONWriter } = await jstsImport("io/GeoJSONWriter.js");
const { default: GeometryPrecisionReducer } = await jstsImport("precision/GeometryPrecisionReducer.js");
const { default: PrecisionModel } = await jstsImport("geom/PrecisionModel.js");
await jstsImport("monkey.js");

const log = (...a) => console.log(...a);
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const short = (s) => s.replace(/\s*\(.*\)\s*$/, "");

// ================================================================ the database ===
const SQL = `
select json_agg(row_to_json(t) order by t.wave, t.slug) from (
  select h.slug, h.name as zone_name, h.zone_label, h.side, h.junction, h.road_a, h.road_b, h.lat, h.lng,
         h.area_km2, h.land_km2, h.wave, h.status, h.name_confirmed, h.split_hint,
         ST_AsGeoJSON(h.zone_geom, 5)::json as zone,
         (select coalesce(json_agg(a.name order by a.name), '[]'::json) from areas a where ST_Covers(h.zone_geom, a.centroid::geometry)) as areas
  from hotspots h where h.status in ('active', 'planned')
) t`;
log("1. reading the hotspots table");
let rows;
try {
  const out = execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-c", SQL], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  rows = JSON.parse(out.trim());
} catch (e) {
  console.error(`Could not read the hotspots table from ${DB}. Is the local Supabase up and supabase/hotspot_zones.sql loaded?\n${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
if (!rows?.length) {
  console.error("The hotspots table is empty.");
  process.exit(1);
}
log(`   ${rows.length} zones`);

// ================================================================ geometry kit ===
const MP = (g) =>
  !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates
    : g.type === "GeometryCollection" ? g.geometries.flatMap((x) => MP(x)) : [];
const jr = new GeoJSONReader();
const jw = new GeoJSONWriter();
const PM = new PrecisionModel(1e6); // a 10 cm grid makes the overlays robust
const JR = (geo) => GeometryPrecisionReducer.reduce(jr.read(geo), PM);
const U = (...a) => {
  const xs = a.filter((x) => x && x.length);
  return !xs.length ? [] : xs.length === 1 ? pc.union(xs[0]) : pc.union(...xs);
};
const HAV = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// The point inside a polygon that is farthest from every edge (a small polylabel), for the zone name.
function signedDist(x, y, rings) {
  let inside = false, min = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x1, y1] = r[j], [x2, y2] = r[i];
      if (y2 > y !== y1 > y && x < ((x1 - x2) * (y - y2)) / (y1 - y2) + x2) inside = !inside;
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      const px = x1 + t * dx - x, py = y1 + t * dy - y;
      const d = px * px + py * py;
      if (d < min) min = d;
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(min);
}
function labelPoint(mp) {
  const ringArea = (r) => Math.abs(turf.area(turf.polygon([r])));
  const poly = [...mp].sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0];
  const k = Math.cos((poly[0][0][1] * Math.PI) / 180);
  const rings = poly.map((r) => r.map(([x, y]) => [x * k, y]));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const n = 14, span = Math.max(x1 - x0, y1 - y0);
  let cells = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push({ x: x0 + ((i + 0.5) * (x1 - x0)) / n, y: y0 + ((j + 0.5) * (y1 - y0)) / n, h: span / n / 2 });
  let best = { d: -Infinity, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  for (let it = 0; it < 7; it++) {
    for (const c of cells) { c.d = signedDist(c.x, c.y, rings); if (c.d > best.d) best = c; }
    cells = cells.filter((c) => c.d + c.h * 1.42 > best.d).sort((a, b) => b.d - a.d).slice(0, 12);
    const next = [];
    for (const c of cells) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) next.push({ x: c.x + (dx * c.h) / 2, y: c.y + (dy * c.h) / 2, h: c.h / 2 });
    cells = next;
  }
  for (const c of cells) { c.d = signedDist(c.x, c.y, rings); if (c.d > best.d) best = c; }
  return [r5(best.x / k), r5(best.y)];
}

// ============================================== 2. the cut lines (first split of each zone) ===
log("2. cut lines");
const findCache = (prefix) => {
  const f = readdirSync(CACHE).filter((n) => n.startsWith(prefix) && n.endsWith(".json")).sort();
  if (!f.length) throw new Error(`No ${prefix}*.json in ${CACHE}. Run zones.mjs once (it fills the Overpass cache).`);
  return join(CACHE, f.at(-1));
};
const adminTags = JSON.parse(await readFile(findCache("admin-tags-"), "utf8"));
const lgaGj = osmtogeojson(JSON.parse(await readFile(findCache("lga-geom-"), "utf8")));
const lgaGeo = (name) => {
  const e = adminTags.elements.find((x) => x.tags.admin_level === "6" && strip(x.tags.name) === strip(name));
  if (!e) throw new Error(`LGA ${name} is not in the Overpass cache`);
  const f = lgaGj.features.find((x) => x.id === `relation/${e.id}`);
  if (!f) throw new Error(`LGA ${name} has no geometry in the cache`);
  return MP(f.geometry);
};
const flatLines = (g) => {
  const geo = jw.write(g);
  const parts = geo.type === "GeometryCollection" ? geo.geometries : [geo];
  return parts.flatMap((p) => (p.type === "LineString" ? [p.coordinates] : p.type === "MultiLineString" ? p.coordinates : []));
};
const roundLine = (l) => l.map(([x, y]) => [r5(x), r5(y)]);

const splitLines = [];
for (const h of rows) {
  const sh = h.split_hint;
  const zone = JR({ type: "MultiPolygon", coordinates: h.zone.coordinates });
  let lines;
  if (sh.cut_kind === "line") {
    // a straight line along the named road: north-south at a longitude, or east-west at a latitude
    const ew = sh.axis === "ew";
    const line = ew ? [[2.5, sh.at], [4.6, sh.at]] : [[sh.at, 5.9], [sh.at, 7.1]];
    lines = flatLines(jr.read({ type: "LineString", coordinates: line }).intersection(zone));
  } else if (sh.cut_kind === "lga") {
    // the stretch of the A side's boundary that touches the B side, inside the zone
    const A = JR({ type: "MultiPolygon", coordinates: U(...sh.lgas.a.map(lgaGeo)) });
    const B = JR({ type: "MultiPolygon", coordinates: U(...sh.lgas.b.map(lgaGeo)) });
    lines = flatLines(A.getBoundary().intersection(B.buffer(4e-5)).intersection(zone));
  } else {
    throw new Error(`${h.slug}: unknown cut_kind ${sh.cut_kind}`);
  }
  lines = lines.filter((l) => l.length >= 2);
  if (!lines.length) throw new Error(`${h.slug}: the cut (${sh.cut_along}) draws no line inside the zone`);
  const simple = turf.simplify(turf.multiLineString(lines), { tolerance: 0.00008, highQuality: true });
  const km = turf.length(simple, { units: "kilometers" });
  splitLines.push({
    type: "Feature",
    properties: { slug: h.slug },
    geometry: { type: "MultiLineString", coordinates: simple.geometry.coordinates.map(roundLine) },
  });
  log(`   ${h.slug.padEnd(16)} ${sh.cut_kind.padEnd(4)} ${km.toFixed(1).padStart(6)} km  ${sh.cut_along}`);
}

// ============================================================ 3. words for the card ===
// "splits at ...": the road or boundary the cut follows, cleaned for a phone.
const SPLIT_AT_OVERRIDE = { "ojo-badagry": "a line between Ojo and Iba" };
const splitAt = (h) =>
  SPLIT_AT_OVERRIDE[h.slug] ?? h.split_hint.cut_along.replace(/\s*\(.*$/, "").replace(/,.*$/, "").trim();

// Short notes for the card. kind "name": the local name is not backed by OpenStreetMap ("Check this name").
// kind "note": the name is backed but something else is worth a look, a better-known crossing or a
// junction on a zone line ("Worth knowing"). These are the `unsure` and `note` texts of PICK in
// zones.mjs and the tables of docs/HOTSPOTS.md section 4, shortened for a phone.
const CHECK = {
  festac: { kind: "name", text: "OpenStreetMap puts Mile 2 about 1.4 km east of here. This is the Festac 1st Avenue crossing on the expressway. The Jakande Estate Road crossing, 960 m east, is nearer the Mile 2 that OpenStreetMap maps." },
  ikoyi: { kind: "note", text: "Falomo Roundabout is the famous one, but it sits 51 m from a military site, so the 100 m rule keeps it out. Jae can lift the rule for this one place." },
  yaba: { kind: "note", text: "The LGA line runs through Jibowu, so the 150 m around it is given to Yaba." },
  ojota: { kind: "note", text: "Sits on the Ikeja and Kosofe line, so the 150 m around it is given to this zone. Ketu is the other pick." },
  "lagos-island": { kind: "note", text: "On the line with Ikoyi, so the 150 m around it is given to Lagos Island." },
  "victoria-island": { kind: "note", text: "The nightlife strip is Adeola Odeku Street, but the crossing named is with Akin Adesola Street." },
  alimosho: { kind: "note", text: "OpenStreetMap names few junctions here. Iyana Ipaja and Egbeda are the other big ones." },
  ikorodu: { kind: "note", text: "Not sure which crossing people call Ikorodu Garage. This is Ayangburen Road with Beach Road." },
};

// ===================================================================== 4. the data ===
const zones = [], hotspots = [], labels = [], kids = [];
for (const h of rows) {
  const parent = { lat: h.lat, lng: h.lng };
  const sh = h.split_hint;
  const mp = h.zone.coordinates;
  zones.push({
    type: "Feature",
    properties: { slug: h.slug, name: h.zone_name, wave: h.wave, area: h.area_km2 },
    geometry: { type: "MultiPolygon", coordinates: mp },
  });
  labels.push({
    type: "Feature",
    properties: { slug: h.slug, name: h.zone_name, area: Number(h.area_km2) },
    geometry: { type: "Point", coordinates: labelPoint(mp) },
  });

  // the two child junctions; one that is the parent's own stays out of the "next rooms" dots
  // a child named like its own zone ("Ikoyi" in Ikoyi) keeps the road in its name so the card is not confusing
  const nameOf = (k) => (short(k.junction).toLowerCase() === h.zone_name.toLowerCase() ? k.junction : short(k.junction));
  const ch = (sh.children ?? []).map((k) => ({ ...k, keeps: HAV(parent, k) < 40 }));
  for (const k of ch) {
    if (k.keeps) continue;
    kids.push({
      type: "Feature",
      properties: { zone: h.slug, name: nameOf(k) },
      geometry: { type: "Point", coordinates: [r5(k.lng), r5(k.lat)] },
    });
  }
  const fresh = ch.filter((k) => !k.keeps).map(nameOf);
  const nextRooms =
    ch.some((k) => k.keeps) && fresh.length === 1
      ? `Then ${fresh[0]} gets its own room.`
      : fresh.length === 2
        ? `Then ${fresh[0]} and ${fresh[1]} get a room each.`
        : "";

  hotspots.push({
    type: "Feature",
    properties: {
      slug: h.slug,
      name: h.junction,
      short: short(h.junction),
      zone: h.zone_name,
      places: h.zone_label.split(/,\s*/),
      hoppazAreas: h.areas,
      roadA: h.road_a,
      roadB: h.road_b,
      side: h.side,
      wave: h.wave,
      status: h.status,
      nameConfirmed: h.name_confirmed,
      splitAt: splitAt(h),
      nextRooms,
      check: CHECK[h.slug]?.text ?? "",
      checkKind: CHECK[h.slug]?.kind ?? "",
      areaKm2: Number(h.area_km2),
    },
    geometry: { type: "Point", coordinates: [r5(h.lng), r5(h.lat)] },
  });
}
const data = {
  built: new Date().toISOString().slice(0, 10),
  zones: { type: "FeatureCollection", features: zones },
  hotspots: { type: "FeatureCollection", features: hotspots },
  splits: { type: "FeatureCollection", features: splitLines },
  kids: { type: "FeatureCollection", features: kids },
  labels: { type: "FeatureCollection", features: labels },
};

log("3. the cards say");
for (const f of hotspots) {
  const p = f.properties;
  log(`   ${p.short.padEnd(14)} ${p.zone.padEnd(28)} When it gets busy, splits at ${p.splitAt}. ${p.nextRooms}`);
}

// ================================================================== 5. write the page ===
const template = await readFile(TEMPLATE, "utf8");
const wordmark = `data:image/png;base64,${(await readFile(WORDMARK)).toString("base64")}`;
// "</" inside inline JSON must not close the script tag
const json = JSON.stringify(data).replace(/</g, "\\u003c");
for (const token of ["/*__DATA__*/null", "__WORDMARK__"]) {
  if (!template.includes(token)) throw new Error(`The template has no ${token}`);
}
const html = template.replace("/*__DATA__*/null", () => json).replace("__WORDMARK__", () => wordmark);
if (/[\u2014\u2013]/.test(html)) {
  const at = html.search(/[\u2014\u2013]/);
  throw new Error(`An em or en dash is in the page near: ${html.slice(Math.max(0, at - 60), at + 60)}`);
}
await writeFile(OUT, html);
log(`\nwrote ${OUT} (${(html.length / 1024).toFixed(0)} KB; zones ${(JSON.stringify(data.zones).length / 1024).toFixed(0)} KB)`);
log(`${hotspots.length} hotspots, ${splitLines.length} cut lines, ${kids.length} next-room dots`);
