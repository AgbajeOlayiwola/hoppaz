// ============================================================================
// Hoppaz: Lagos spawn spots from OpenStreetMap
//
// Run again any time (Node 18+, no packages):
//   node scripts/spawn-points/import-osm.mjs
// It writes supabase/spawn_points_lagos.sql. Run that file in the Supabase SQL
// editor after spawning.sql, then run box_guards.sql. Safe to run again: spots and zones are upserted by
// (source, source_ref), and a staff on/off switch on an existing spot is kept
// (except spots inside an active zone, which are switched off again).
// Options:
//   --out=<file>    write somewhere else
//   --cache=<dir>   keep each Overpass answer in <dir> and reuse it next time
//   --fallback      skip Overpass, write the small hand-made Lagos list
//
// What it does: asks Overpass (one query per group, 120 s timeout, next mirror
// on 429, 5xx or timeout, two rounds) for parks, runs, beaches, landmarks,
// markets, bus stops and fuel stations in the Lagos box, and for the places that
// never get a box (military, airport, prison, port, power plant, landfill, gated
// estates). Water is a zone too, so nothing (a welcome box included) is placed in
// the lagoon, a creek or the Atlantic: the sea is the coastline closed off to the
// south, the rest are the OSM water shapes of 1 ha or more. Spots in the sea are
// dropped, same-kind spots within 60 m are merged and bus stops are capped to the
// best 1500. A hand-made boat-only zone (Lagos harbour mouth) is added. Venue
// spots from live events come from the database itself, inside the generated SQL.
//
// If every mirror fails it writes a short hand-made list of well-known Lagos
// spots and zones instead and says so.
//
// Every zone is written with a zone_type (water, military, airport, prison, port,
// landfill, power, estate, staff). supabase/box_guards.sql uses it: a box is
// refused inside a water zone, and a spot within 40 m of one is switched off.
// Data (c) OpenStreetMap contributors, ODbL.
// ============================================================================
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const OUT = resolve(args.out && args.out !== true ? args.out : resolve(here, "../../supabase/spawn_points_lagos.sql"));
const CACHE = args.cache && args.cache !== true ? resolve(args.cache) : null;

const BBOX = { s: 6.38, w: 3.05, n: 6.72, e: 3.75 };
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const UA = "hoppaz-spawn-points-import/1.0 (Lagos nightlife app; one-off data import)";
const TIMEOUT_S = 120;
const ROUNDS = 2;
const ROUND_PAUSE_S = 30;
const DEDUPE_M = 60;
const BUS_CAP = 1500;
const ZONE_BUFFER_M = 30;
const NODE_ZONE_M = 150;
const SHORE_M = 30;
const WATER_MIN_M2 = 10_000;
const WATER_TOL_M = 12;
const SEA_SOUTH = 5.9;
const WEIGHT = { landmark: 2, park: 2, beach: 2, run: 2, street: 1, market: 0.8 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- Overpass ---
class OverpassDown extends Error {}

// With a global bbox, Overpass also cuts the members of a relation at the box, so a lagoon
// would come back as open pieces. A group with `wide` filters each line by the box instead.
async function overpass(label, body, tail, wide = false) {
  const ql = `[out:json][timeout:${TIMEOUT_S}]${wide ? "" : `[bbox:${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}]`};\n(\n${body}\n);\n${tail}\n`;
  const file = CACHE ? resolve(CACHE, `${label}-${createHash("sha1").update(ql).digest("hex").slice(0, 10)}.json`) : null;
  if (file) {
    try {
      const hit = JSON.parse(await readFile(file, "utf8"));
      log(`  ${label}: ${hit.length} elements (cache)`);
      return hit;
    } catch {}
  }
  const errors = [];
  const tries = Array.from({ length: ROUNDS * MIRRORS.length }, (_, i) => MIRRORS[i % MIRRORS.length]);
  for (const [i, url] of tries.entries()) {
    if (i > 0 && i % MIRRORS.length === 0) {
      log(`  ${label}: every mirror failed, waiting ${ROUND_PAUSE_S} s before one more round`);
      await sleep(ROUND_PAUSE_S * 1000);
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "application/json" },
        body: "data=" + encodeURIComponent(ql),
        signal: AbortSignal.timeout((TIMEOUT_S + 30) * 1000),
      });
      if (res.status === 400) throw Object.assign(new Error(`bad query: ${(await res.text()).slice(0, 300)}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.trimStart().startsWith("<")) throw new Error(text.replace(/<[^>]*>/g, " ").match(/(?:runtime )?error:[^.]{0,120}/i)?.[0]?.trim() ?? "Overpass sent an error page");
      const json = JSON.parse(text);
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      const els = json.elements ?? [];
      log(`  ${label}: ${els.length} elements (${new URL(url).host})`);
      if (file) {
        await mkdir(CACHE, { recursive: true });
        await writeFile(file, JSON.stringify(els));
      }
      return els;
    } catch (err) {
      if (err.fatal) throw err;
      const why = err?.name === "TimeoutError" ? "timeout" : (err?.message ?? String(err));
      errors.push(`${new URL(url).host}: ${why}`);
      log(`  ${label}: ${new URL(url).host} failed (${why}), trying the next mirror`);
      await sleep(4000);
    }
  }
  throw new OverpassDown(`${label}: every Overpass mirror failed\n  ${errors.join("\n  ")}`);
}

// One combined query per group.
const BOX = `(${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e})`;
const GROUPS = {
  green: {
    body: `
  nwr["leisure"="park"];
  nwr["leisure"="garden"];
  nwr["leisure"="track"];
  nwr["highway"="pedestrian"];
  way["highway"="footway"]["name"]["bridge"];
  way["highway"~"^(footway|pedestrian|path)$"]["name"~"promenade|walkway|boardwalk",i];
  nwr["natural"="beach"];
  nwr["leisure"="beach_resort"];`,
    tail: "out tags center;",
  },
  places: {
    body: `
  nwr["tourism"~"^(attraction|museum|artwork|viewpoint)$"];
  nwr["historic"];
  nwr["amenity"~"^(arts_centre|theatre)$"];
  nwr["leisure"="stadium"];
  nwr["amenity"="marketplace"];`,
    tail: "out tags center;",
  },
  street: {
    body: `
  nwr["amenity"="fuel"];
  node["highway"="bus_stop"];`,
    tail: "out tags center;",
  },
  zones: {
    body: `
  nwr["landuse"="military"];
  nwr["military"];
  nwr["aeroway"="aerodrome"];
  nwr["amenity"="prison"];
  nwr["landuse"="port"];
  nwr["industrial"="port"];
  nwr["power"="plant"];
  nwr["landuse"="landfill"];
  nwr["landuse"="residential"]["access"="private"];
  nwr["landuse"="industrial"]["name"~"^(Port of |Tin ?can)",i];`,
    // "out geom" (not "out geom tags"): only the full output lists the members of a relation.
    tail: "out geom;",
  },
  water: {
    wide: true,
    body: `
  wr["natural"="water"]["water"~"^(lagoon|lake|reservoir|river|canal)$"]${BOX};
  wr["natural"="water"][!"water"]${BOX};
  wr["natural"="bay"]${BOX};
  wr["water"="lagoon"]${BOX};`,
    tail: "out geom;",
  },
  coast: {
    body: `
  way["natural"="coastline"];`,
    tail: "out geom;",
  },
};

// ------------------------------------------------------------------- spots ---
const clean = (s) =>
  String(s)
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ref = (el) => `${el.type}/${el.id}`;

function centreOf(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  return el.center ?? null;
}

// Which spot kind an element is, or null. Private and closed-off places never count.
function classify(t) {
  if (t.access === "private" || t.access === "no") return null;
  if (t.amenity === "fuel") return { kind: "street", cat: "fuel", fallback: "Fuel station", night: true };
  if (t.highway === "bus_stop") return { kind: "street", cat: "bus", fallback: "Bus stop" };
  if (t.natural === "beach" || t.leisure === "beach_resort") return { kind: "beach", cat: "beach", fallback: "Beach" };
  if (t.leisure === "park") return { kind: "park", cat: "park", fallback: "Park" };
  if (t.leisure === "garden") return t.name ? { kind: "park", cat: "garden", fallback: "Garden" } : null;
  if (t.leisure === "track") {
    if (/horse|motor|kart|cycling|equestrian/.test(t.sport ?? "")) return null;
    return { kind: "run", cat: "track", fallback: "Running track" };
  }
  if (t.highway === "pedestrian") return t.name ? { kind: "run", cat: "pedestrian", fallback: "Pedestrian street" } : null;
  if (t.highway === "footway" || t.highway === "path") {
    if (!t.name) return null;
    return { kind: "run", cat: /promenade|walkway|boardwalk/i.test(t.name) ? "promenade" : "footbridge", fallback: "Walkway" };
  }
  if (t.amenity === "marketplace") return { kind: "market", cat: "market", fallback: "Market" };
  if (t.leisure === "stadium") return { kind: "landmark", cat: "stadium", fallback: "Stadium" };
  if (t.amenity === "theatre") return { kind: "landmark", cat: "theatre", fallback: "Theatre" };
  if (t.amenity === "arts_centre") return { kind: "landmark", cat: "arts", fallback: "Arts centre" };
  if (t.tourism === "museum") return { kind: "landmark", cat: "museum", fallback: "Museum" };
  if (t.tourism === "viewpoint") return { kind: "landmark", cat: "viewpoint", fallback: "Viewpoint" };
  // Artwork, attractions and heritage are only worth a box when they have a name.
  if (t.tourism === "attraction" || t.tourism === "artwork" || t.historic) return t.name ? { kind: "landmark", cat: "landmark", fallback: "Landmark" } : null;
  return null;
}

// OSM names that are placeholders or notes ("bbc", "open space", "proposed ...") are dropped,
// so the spot gets the plain fallback name or, when it needs a name, is skipped.
function junkName(n) {
  const words = n.trim().split(/\s+/);
  return n.trim().length < 3 || /proposed|unnamed|noname|\btest\b|^n\/?a$|^none$/i.test(n) || (/^[a-z]/.test(n.trim()) && words.length <= 2 && n.trim().length <= 14);
}

function spotFrom(el) {
  const tags = { ...(el.tags ?? {}) };
  const rawName = tags.name ?? tags["name:en"];
  if (rawName && /\bprivate\b/i.test(rawName)) return null;
  if (rawName && junkName(rawName)) {
    delete tags.name;
    delete tags["name:en"];
  }
  const t = tags;
  const c = classify(t);
  const p = centreOf(el);
  if (!c || !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  const raw = t.name ?? t["name:en"] ?? (c.cat === "fuel" ? (t.brand ?? t.operator) : null);
  return {
    ref: ref(el),
    name: clean(raw ?? c.fallback) || c.fallback,
    named: !!raw,
    kind: c.kind,
    cat: c.cat,
    night: !!c.night,
    weight: WEIGHT[c.kind],
    lat: r6(p.lat),
    lon: r6(p.lon),
    comfort: (t.shelter === "yes" ? 1 : 0) + (t.bench === "yes" ? 1 : 0) + (t.public_transport ? 1 : 0),
  };
}

// Metres between two points, flat-earth is fine at this scale.
const M_LAT = 110574;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
function dist(a, b) {
  const dy = (a.lat - b.lat) * M_LAT;
  const dx = (a.lon - b.lon) * mLon((a.lat + b.lat) / 2);
  return Math.hypot(dx, dy);
}

// Greedy dedupe: the first spot in the list wins, others of the same kind within DEDUPE_M go.
function dedupe(spots) {
  const cell = (s) => [Math.floor((s.lat * M_LAT) / DEDUPE_M), Math.floor((s.lon * mLon(6.5)) / DEDUPE_M)];
  const grid = new Map();
  const out = [];
  for (const s of spots) {
    const [cy, cx] = cell(s);
    let clash = false;
    for (let dy = -1; dy <= 1 && !clash; dy++) {
      for (let dx = -1; dx <= 1 && !clash; dx++) {
        for (const o of grid.get(`${s.kind}:${cy + dy}:${cx + dx}`) ?? []) {
          if (dist(s, o) < DEDUPE_M) {
            clash = true;
            break;
          }
        }
      }
    }
    if (clash) continue;
    const key = `${s.kind}:${cy}:${cx}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(s);
    out.push(s);
  }
  return out;
}

const idNum = (s) => Number(s.ref.split("/")[1]);
const byPriority = (a, b) =>
  Number(b.night) - Number(a.night) || Number(b.named) - Number(a.named) || b.comfort - a.comfort || idNum(a) - idNum(b);

// -------------------------------------------------------------------- coast ---
// OSM draws the coastline with land on its left. A spot on the right of the
// nearest coastline segment, and not on the shore itself, is in the sea.
function makeSeaTest(coastWays) {
  const segs = [];
  for (const w of coastWays) {
    for (let i = 0; i < (w.geometry?.length ?? 0) - 1; i++) segs.push([w.geometry[i], w.geometry[i + 1]]);
  }
  return (p) => {
    const kx = mLon(p.lat);
    const px = p.lon * kx, py = p.lat * M_LAT;
    let best = Infinity, cross = 0;
    for (const [a, b] of segs) {
      const ax = a.lon * kx, ay = a.lat * M_LAT, dx = b.lon * kx - ax, dy = b.lat * M_LAT - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) { best = d; cross = dx * (py - ay) - dy * (px - ax); }
    }
    return segs.length > 0 && cross < 0 && best > SHORE_M;
  };
}

// ------------------------------------------------------------------- zones ---
function segDist(p, a, b) {
  const kx = mLon(p[1]);
  const ax = a[0] * kx, ay = a[1] * M_LAT, bx = b[0] * kx, by = b[1] * M_LAT, px = p[0] * kx, py = p[1] * M_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Douglas-Peucker, tolerance in metres. Keeps the ends, so rings stay closed.
function simplify(pts, tol = 4) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > max) { max = d; at = i; }
    }
    if (at > 0 && max > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function zoneReason(t) {
  if (t.landuse === "military" || t.military) return { reason: "military", fallback: "Military area" };
  if (t.aeroway === "aerodrome") return { reason: "airport", fallback: "Airport" };
  if (t.amenity === "prison") return { reason: "prison", fallback: "Prison" };
  if (t.landuse === "port" || t.industrial === "port" || (t.landuse === "industrial" && /^(port of |tin ?can)/i.test(t.name ?? ""))) return { reason: "port", fallback: "Port" };
  // Rooftop and small solar or wind installs are tagged power=plant too: not a security risk, skipped.
  if (t.power === "plant") return /solar|wind/.test(t["plant:source"] ?? "") || t["plant:method"] === "photovoltaic" ? null : { reason: "power plant", fallback: "Power plant" };
  if (t.landuse === "landfill") return { reason: "landfill", fallback: "Landfill" };
  if (t.landuse === "residential" && t.access === "private") return { reason: "private estate", fallback: "Private estate" };
  return null;
}

const ll = (pts) => pts.map((p) => `${r6(p[0])} ${r6(p[1])}`).join(",");
const ptsOf = (geom) => geom.map((g) => [g.lon, g.lat]);
const grown = (geog, m) => (m > 0 ? `st_buffer(${geog},${m})` : geog);

// Returns the SQL geography expression for a zone, or null when the shape cannot be used.
// buffer 0 keeps the shape as drawn (water). Water never falls back to a convex hull,
// which would swallow the land around a river, so it needs rings that close.
function zoneExpr(el, buffer = ZONE_BUFFER_M) {
  if (el.type === "node") return grown(`st_setsrid(st_makepoint(${r6(el.lon)},${r6(el.lat)}),4326)::geography`, NODE_ZONE_M);
  if (el.type === "way") {
    const pts = ptsOf(el.geometry ?? []);
    if (pts.length < 4) return null;
    const a = pts[0], b = pts[pts.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) return null; // an open line is not an area
    const ring = simplify(pts, buffer === 0 ? WATER_TOL_M : 4);
    if (ring.length < 4) return null;
    return grown(`st_makevalid(st_geomfromtext('POLYGON((${ll(ring)}))',4326))::geography`, buffer);
  }
  const raw = (el.members ?? []).filter((m) => m.type === "way" && m.geometry?.length >= 2).map((m) => ptsOf(m.geometry));
  if (!raw.length) return null;
  if (buffer === 0 && !ringsClose(raw)) return null;
  const lines = raw.map((l) => simplify(l, buffer === 0 ? WATER_TOL_M : 4));
  const multi = `st_geomfromtext('MULTILINESTRING(${lines.map((l) => `(${ll(l)})`).join(",")})',4326)`;
  const area = buffer === 0 ? "st_buildarea(g)" : "coalesce(st_buildarea(g),st_convexhull(g))";
  return grown(`(select st_makevalid(${area}) from (select ${multi} g) s)::geography`, buffer);
}

// Do these lines join up into closed rings? Every end point must be met an even number of times.
function ringsClose(lines) {
  const n = new Map();
  for (const l of lines) for (const e of [l[0], l[l.length - 1]]) n.set(`${r6(e[0])},${r6(e[1])}`, (n.get(`${r6(e[0])},${r6(e[1])}`) ?? 0) + 1);
  return [...n.values()].every((c) => c % 2 === 0);
}

// Area in square metres of a ring (flat-earth is fine here).
function ringM2(pts) {
  const lat0 = pts[0][1], kx = mLon(lat0);
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += (pts[i][0] * kx) * (pts[i + 1][1] * M_LAT) - (pts[i + 1][0] * kx) * (pts[i][1] * M_LAT);
  return Math.abs(a) / 2;
}

// Water bigger than a pond, left as drawn: the lagoon, creeks, bays. Points (labels) and
// small ponds, pools and wastewater tanks do not count. Returns { name, expr } or null.
function waterZone(el) {
  const t = el.tags ?? {};
  if (el.type === "node" || /^(pond|wastewater|basin|pool|fountain)$/.test(t.water ?? "")) return null;
  if (el.type === "way") {
    const pts = ptsOf(el.geometry ?? []);
    if (pts.length < 4 || ringM2(pts) < WATER_MIN_M2) return null;
  }
  const expr = zoneExpr(el, 0);
  return expr ? { name: clean(t.name ?? t["name:en"] ?? "Water") || "Water", expr } : null;
}

// The Atlantic as one zone. OSM draws the coastline with land on its left, so along the
// Lagos coast (running west to east) the sea is to the south: join the coastline ways into
// one chain and close it off at lat SEA_SOUTH. Left exactly on the coastline, so a box never
// lands in the surf (a beach spot sits on the sand, above the line).
function seaZone(coastWays) {
  const ways = coastWays.filter((w) => w.geometry?.length >= 2 && w.nodes?.length >= 2);
  const ends = new Set(ways.map((w) => w.nodes[w.nodes.length - 1]));
  const byStart = new Map(ways.map((w) => [w.nodes[0], w]));
  const chains = [];
  for (const first of ways.filter((w) => !ends.has(w.nodes[0]))) {
    const pts = [];
    for (let w = first; w; w = byStart.get(w.nodes[w.nodes.length - 1])) pts.push(...ptsOf(w.geometry).slice(pts.length ? 1 : 0));
    chains.push(pts);
  }
  const chain = chains.sort((a, b) => b.length - a.length)[0];
  if (!chain) return null;
  if (chains.length > 1) console.error(`WARNING: ${chains.length} separate coastlines, only the longest becomes the sea zone.`);
  if (chain[0][0] >= chain[chain.length - 1][0]) {
    console.error("WARNING: the coastline runs west to east the wrong way round, no sea zone made.");
    return null;
  }
  return seaFrom(simplify(chain, 4));
}

function seaFrom(chain, ref = "derived/sea") {
  const a = chain[0], b = chain[chain.length - 1];
  const ring = [...chain, [b[0], SEA_SOUTH], [a[0], SEA_SOUTH], a];
  return {
    name: "Atlantic Ocean",
    reason: "water",
    ref,
    expr: `st_geogfromtext('SRID=4326;POLYGON((${ll(ring)}))')`,
  };
}

// ------------------------------------------------------------ fallback list ---
// Used only when every Overpass mirror fails. Coordinates were copied from
// OpenStreetMap on 2026-10-09 (a place's own point or the centre of its shape),
// so each sits on its place. No night_safe spots: a night run needs live venues.
const FALLBACK_SPOTS = [
  // kind, name, lat, lon
  ["park", "Freedom Park", 6.448935, 3.39655],
  ["park", "Muri Okunola Park", 6.43786, 3.42505],
  ["park", "Tinubu Square", 6.45386, 3.38931],
  ["park", "Lekki Conservation Centre", 6.43623, 3.53566],
  ["park", "Ikoyi Park", 6.458611, 3.445556],
  ["park", "Lagos Polo Club", 6.445421, 3.421747],
  ["park", "Gani Fawehinmi Park", 6.593534, 3.381519],
  ["landmark", "Tafawa Balewa Square", 6.44709, 3.4011],
  ["landmark", "National Arts Theatre", 6.476473, 3.369492],
  ["landmark", "National Museum", 6.444419, 3.403518],
  ["landmark", "Lagos National Stadium", 6.497077, 3.364976],
  ["landmark", "Teslim Balogun Stadium", 6.49971, 3.36077],
  ["landmark", "Terra Kulture", 6.425261, 3.426649],
  ["landmark", "African Artists' Foundation", 6.441775, 3.419352],
  ["landmark", "Didi Museum", 6.432619, 3.423568],
  ["landmark", "Nike Art Gallery", 6.43152, 3.48185],
  ["landmark", "National Gallery of Modern Art", 6.47687, 3.3693],
  ["landmark", "Omenka Art Gallery", 6.46382, 3.43434],
  ["landmark", "New Afrika Shrine", 6.622865, 3.356885],
  ["landmark", "Ikeja City Mall", 6.61432, 3.3578],
  ["landmark", "Maryland Mall", 6.56716, 3.36732],
  ["landmark", "Palms Shopping Mall", 6.43602, 3.45108],
  ["landmark", "Silverbird Galleria", 6.42829, 3.4085],
  ["landmark", "Landmark Centre", 6.42321, 3.44535],
  ["landmark", "Yaba College of Technology", 6.51857, 3.37424],
  ["landmark", "The Jazzhole", 6.44309, 3.42184],
  ["landmark", "Ikoyi Club", 6.4523, 3.4284],
  ["run", "Allen Avenue", 6.60146, 3.3521],
  ["run", "Eko Atlantic", 6.41305, 3.41805],
  ["beach", "Elegushi Beach", 6.42537, 3.48037],
  ["beach", "Kuramo Beach", 6.42328, 3.42849],
  ["market", "Computer Village", 6.5943, 3.34044],
  ["market", "Tejuosho Market", 6.50815, 3.36975],
  ["market", "Jankara Market", 6.461086, 3.392964],
  ["market", "Ebute Ero Market", 6.462674, 3.384591],
  ["market", "Iponri Market", 6.484933, 3.364343],
  ["market", "Mile 12 Market", 6.608956, 3.39326],
  ["market", "Jakande Market", 6.43493, 3.50797],
  ["market", "Ketu Market", 6.597159, 3.383667],
  ["market", "Ladipo Market", 6.544177, 3.341788],
].map(([kind, name, lat, lon]) => ({ kind, name, lat, lon, night: false, weight: WEIGHT[kind] }));

// Circles roughly the size of the shapes OpenStreetMap draws for each place.
const FALLBACK_ZONES = [
  // name, reason, lat, lon, radius in metres
  ["Murtala Muhammed Airport", "airport", 6.5741, 3.3207, 2800],
  ["Dodan Barracks", "military", 6.4498, 3.4179, 350],
  ["Ikeja Cantonment", "military", 6.5662, 3.3594, 1300],
  ["Bonny Camp", "military", 6.4365, 3.4066, 600],
  ["Kirikiri Prisons", "prison", 6.4437, 3.305, 650],
  ["Port of Apapa", "port", 6.4525, 3.3731, 1500],
  ["Tin Can Island Port", "port", 6.435, 3.3486, 1200],
];

// Hand-made zones added in both modes. OpenStreetMap has no tag for "only a boat
// goes there", so the Lagos harbour mouth (Tarkwa Bay, Lighthouse Beach, Snake
// Island) is boxed in by hand. Staff can switch it off in no_spawn_zones.
const HAND_ZONES = [
  {
    name: "Lagos harbour mouth (boat only)",
    reason: "water",
    ref: "lagos-core/harbour-mouth",
    wkt: "POLYGON((3.30 6.38,3.405 6.38,3.405 6.4205,3.30 6.4205,3.30 6.38))",
  },
].map((z) => ({ name: z.name, reason: z.reason, ref: z.ref, expr: `st_geogfromtext('SRID=4326;${z.wkt}')`, source: "staff" }));

// The Atlantic coastline from west to east across the Lagos box (land on the left), copied
// from OpenStreetMap on 2026-10-09 and thinned to 20 m. Fallback mode closes it into the sea zone.
const FALLBACK_COAST = [
  [2.9142, 6.39499], [2.94787, 6.39618], [3.00213, 6.39713], [3.07226, 6.39989], [3.107, 6.40041], [3.13691, 6.40132],
  [3.13914, 6.40169], [3.14934, 6.40197], [3.16463, 6.40294], [3.18149, 6.4032], [3.19406, 6.4038], [3.23747, 6.40403],
  [3.2526, 6.40442], [3.27283, 6.40414], [3.29487, 6.40336], [3.31495, 6.40239], [3.3259, 6.40154], [3.36091, 6.39815],
  [3.38232, 6.39563], [3.39758, 6.39331], [3.39947, 6.39178], [3.3997, 6.39207], [3.39595, 6.39556], [3.39382, 6.39851],
  [3.3931, 6.39993], [3.39357, 6.40038], [3.39548, 6.40133], [3.3967, 6.40156], [3.39712, 6.40144], [3.39739, 6.40082],
  [3.40249, 6.4004], [3.40292, 6.39763], [3.40373, 6.39595], [3.40345, 6.39719], [3.41333, 6.40252], [3.4234, 6.40691],
  [3.43114, 6.40923], [3.4428, 6.41124], [3.45035, 6.41197], [3.46805, 6.41212], [3.46786, 6.41238], [3.46446, 6.41267],
  [3.46446, 6.41354], [3.46397, 6.41393], [3.45874, 6.41391], [3.45705, 6.41439], [3.45642, 6.41686], [3.45581, 6.4177],
  [3.45579, 6.4184], [3.45529, 6.41885], [3.4556, 6.42117], [3.45624, 6.42149], [3.4605, 6.42043], [3.46599, 6.41989],
  [3.46629, 6.41954], [3.46613, 6.41839], [3.46629, 6.41814], [3.46721, 6.41811], [3.4672, 6.41767], [3.46771, 6.41711],
  [3.47055, 6.41785], [3.47119, 6.41778], [3.47101, 6.41595], [3.47023, 6.41481], [3.47045, 6.41457], [3.47142, 6.41643],
  [3.4715, 6.42138], [3.47233, 6.42198], [3.47329, 6.4221], [3.47402, 6.4221], [3.47478, 6.42168], [3.47696, 6.42207],
  [3.47886, 6.42175], [3.48039, 6.42221], [3.48222, 6.42169], [3.48394, 6.42211], [3.48588, 6.42153], [3.48771, 6.42182],
  [3.48947, 6.4215], [3.49129, 6.42182], [3.49316, 6.42147], [3.49409, 6.42206], [3.49523, 6.42209], [3.49696, 6.42165],
  [3.49832, 6.42201], [3.50061, 6.42166], [3.50218, 6.42203], [3.50388, 6.42177], [3.5056, 6.42205], [3.50757, 6.42176],
  [3.50893, 6.42227], [3.51176, 6.42202], [3.51177, 6.42231], [3.51286, 6.42259], [3.51371, 6.42258], [3.51518, 6.42202],
  [3.51643, 6.42259], [3.51932, 6.42212], [3.5206, 6.42252], [3.52246, 6.4222], [3.52424, 6.42264], [3.52643, 6.42226],
  [3.52786, 6.42279], [3.52968, 6.42243], [3.53123, 6.4229], [3.53369, 6.42264], [3.53511, 6.42309], [3.5373, 6.42274],
  [3.53731, 6.42344], [3.53807, 6.42373], [3.55591, 6.42341], [3.56023, 6.42358], [3.56727, 6.42322], [3.5962, 6.42436],
  [3.64421, 6.4246], [3.65428, 6.42492], [3.66578, 6.42475], [3.67277, 6.42503], [3.68592, 6.42611], [3.71427, 6.42749],
  [3.72317, 6.42877], [3.74441, 6.4312], [3.77681, 6.43591], [3.80364, 6.43874], [3.81578, 6.43909], [3.83287, 6.43846],
  [3.84323, 6.43862], [3.8509, 6.43802],
];

// -------------------------------------------------------------- SQL writing ---
const HEADER = (mode, counts) => `-- ============================================================================
-- Hoppaz: Lagos spawn spots and no-spawn zones
-- Made by scripts/spawn-points/import-osm.mjs. Run in the Supabase SQL editor
-- after spawning.sql, then run box_guards.sql. Safe to run again (upserts by source and source_ref; a
-- staff on/off switch on an existing spot is kept, except spots inside an active
-- zone, which are switched off again).
--
${
  mode === "osm"
    ? "-- Data (c) OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).\n"
    : "-- Overpass was unreachable when this was made, so this is the small hand-made\n-- list of well-known Lagos spots and zones (coordinates copied from OpenStreetMap on 2026-10-09).\n"
}-- Made ${new Date().toISOString().slice(0, 10)}. ${counts}
-- ============================================================================`;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function spotsSql(spots, source, refOf) {
  return chunk(spots, 400)
    .map((part) => {
      const rows = part
        .map((s) => `(${q(s.name)},'${s.kind}',${s.lon},${s.lat},${s.night},${s.weight},${q(refOf(s))})`)
        .join(",\n");
      return `insert into public.spawn_points (name, kind, geog, night_safe, weight, source, source_ref)
select v.name, v.kind, st_setsrid(st_makepoint(v.lon, v.lat), 4326)::geography, v.night_safe, v.weight, '${source}', v.ref
from (values
${rows}
) as v(name, kind, lon, lat, night_safe, weight, ref)
on conflict (source, source_ref) do update set name = excluded.name, kind = excluded.kind, geog = excluded.geog, night_safe = excluded.night_safe, weight = excluded.weight, area = null;`;
    })
    .join("\n\n");
}

// What a zone is, from its reason. Same words as no_spawn_zone_type() in box_guards.sql.
const ZONE_TYPE = {
  water: "water",
  military: "military",
  airport: "airport",
  prison: "prison",
  port: "port",
  landfill: "landfill",
  "power plant": "power",
  "private estate": "estate",
};
const zoneType = (z) => z.type ?? ZONE_TYPE[z.reason] ?? "staff";

function zonesSql(zones, source) {
  return chunk(zones, 25)
    .map((part) => {
      const rows = part.map((z) => `(${q(z.name)},${q(z.reason)},${z.expr},'${z.source ?? source}',${q(z.ref)},${q(zoneType(z))})`).join(",\n");
      return `insert into public.no_spawn_zones (name, reason, geog, source, source_ref, zone_type) values
${rows}
on conflict (source, source_ref) do update set name = excluded.name, reason = excluded.reason, geog = excluded.geog, zone_type = excluded.zone_type;`;
    })
    .join("\n\n");
}

// box_guards.sql adds the column too. Adding it here lets this file run before or after that one.
const ZONE_TYPE_SQL = `-- What each zone is (water, military, ...). box_guards.sql adds this column as well, so run order does not matter.
alter table public.no_spawn_zones add column if not exists zone_type text;`;

const VENUES_SQL = `-- Venues from live events: a safe, lit place with people at night.
insert into public.spawn_points (name, kind, geog, night_safe, weight, source, source_ref)
select distinct on (lower(e.venue_name)) e.venue_name, 'venue', e.geog, true, 1.5, 'venue', lower(e.venue_name)
from public.events e
where e.status = 'live' and e.geog is not null
order by lower(e.venue_name), e.starts_at desc
on conflict (source, source_ref) do nothing;`;

const markInactive = (all) => `-- Spots inside an active no-spawn zone are switched off.
update public.spawn_points sp set active = false
where sp.active${all ? "" : " and sp.source in ('osm', 'venue')"}
  and exists (select 1 from public.no_spawn_zones z where z.active and st_intersects(z.geog, sp.geog));`;

const SUMMARY_SQL = `select kind, count(*) as total, count(*) filter (where active) as active, count(*) filter (where active and night_safe) as night_safe
from public.spawn_points group by kind order by kind;`;

// ----------------------------------------------------------------- the run ---
async function viaOverpass() {
  log(`Asking Overpass for Lagos (${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e})`);
  const got = {};
  for (const [name, g] of Object.entries(GROUPS)) {
    try {
      got[name] = await overpass(name, g.body, g.tail, g.wide);
    } catch (err) {
      // The coastline and the water shapes only add zones and a filter, so the import can go on without them.
      if ((name !== "coast" && name !== "water") || !(err instanceof OverpassDown)) throw err;
      console.error(`WARNING: no ${name === "coast" ? "coastline, spots in the sea are NOT filtered and there is no sea zone" : "water shapes, the lagoon and creeks are NOT zones"}.\n${err.message}`);
      got[name] = [];
    }
    await sleep(CACHE ? 0 : 3000);
  }

  // spots
  const seen = new Set();
  const all = [];
  const stats = {};
  for (const el of [...got.green, ...got.places, ...got.street]) {
    const key = ref(el);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = spotFrom(el);
    if (!s) continue;
    stats[s.cat] = (stats[s.cat] ?? 0) + 1;
    all.push(s);
  }
  log("Raw spots by category:", JSON.stringify(stats));
  const inSea = makeSeaTest(got.coast);
  const onLand = all.filter((s) => !inSea(s));
  log(`In the sea, dropped: ${all.length - onLand.length}`);
  onLand.sort(byPriority);
  const deduped = dedupe(onLand);
  log(`After ${DEDUPE_M} m dedupe: ${deduped.length} of ${onLand.length}`);
  const buses = deduped.filter((s) => s.cat === "bus");
  const keepBuses = new Set(buses.slice(0, BUS_CAP).map((s) => s.ref));
  const spots = deduped.filter((s) => s.cat !== "bus" || keepBuses.has(s.ref));
  if (buses.length > BUS_CAP) log(`Bus stops capped to ${BUS_CAP} of ${buses.length}`);

  // zones
  const zones = [];
  let skipped = 0;
  for (const el of got.zones) {
    const t = el.tags ?? {};
    const z = zoneReason(t);
    if (!z) continue;
    const expr = zoneExpr(el);
    if (!expr) {
      skipped++;
      log(`  skipped zone ${ref(el)} ${t.name ?? ""} (not a closed shape)`);
      continue;
    }
    zones.push({ name: clean(t.name ?? t["name:en"] ?? z.fallback) || z.fallback, reason: z.reason, expr, ref: ref(el) });
  }
  zones.sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true }));
  log(`Zones: ${zones.length} (${skipped} skipped, not a closed shape)`);

  // water: the lagoon, creeks and bays as drawn, then the sea
  const water = [];
  for (const el of got.water) {
    const w = waterZone(el);
    if (w) water.push({ name: w.name, reason: "water", expr: w.expr, ref: ref(el) });
    else if (el.type === "relation") log(`  skipped water ${ref(el)} ${el.tags?.name ?? ""} (its rings do not close)`);
  }
  water.sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true }));
  const sea = seaZone(got.coast);
  if (sea) water.push(sea);
  log(`Water zones: ${water.length}${sea ? " (including the sea)" : " (NO sea zone)"}`);

  const counts = Object.entries(
    spots.reduce((m, s) => ({ ...m, [s.kind]: (m[s.kind] ?? 0) + 1 }), {}),
  )
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const sql = [
    HEADER("osm", `${spots.length} spots (${counts}), ${zones.length + water.length + HAND_ZONES.length} zones.`),
    "begin;",
    ZONE_TYPE_SQL,
    zones.length ? `-- No-spawn zones from OpenStreetMap, each buffered by ${ZONE_BUFFER_M} m.\n` + zonesSql(zones, "osm") : "",
    water.length ? "-- Water from OpenStreetMap, as drawn: the lagoon, creeks and bays, and the sea south of the coastline.\n" + zonesSql(water, "osm") : "",
    "-- Hand-made zone: places only a boat reaches.\n" + zonesSql(HAND_ZONES, "staff"),
    `-- Spawn spots. night_safe is true only for fuel stations.\n` + spotsSql(spots, "osm", (s) => s.ref),
    VENUES_SQL,
    markInactive(false),
    "commit;",
    SUMMARY_SQL,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { sql, spots: spots.length, zones: zones.length + water.length + HAND_ZONES.length };
}

function viaFallback() {
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const zones = FALLBACK_ZONES.map(([name, reason, lat, lon, r]) => ({
    name,
    reason,
    expr: `st_buffer(st_setsrid(st_makepoint(${lon},${lat}),4326)::geography,${r})`,
    ref: `lagos-core/${slug(name)}`,
  }));
  const sql = [
    HEADER("fallback", `${FALLBACK_SPOTS.length} spots, ${zones.length + HAND_ZONES.length + 1} zones.`),
    "begin;",
    ZONE_TYPE_SQL,
    "-- No-spawn zones as circles, plus the hand-made boat-only zone and the sea.\n" + zonesSql([...zones, ...HAND_ZONES, seaFrom(FALLBACK_COAST, "lagos-core/sea")], "staff"),
    "-- Spawn spots.\n" + spotsSql(FALLBACK_SPOTS, "staff", (s) => `lagos-core/${slug(s.name)}`),
    VENUES_SQL,
    markInactive(true),
    "commit;",
    SUMMARY_SQL,
  ].join("\n\n");
  return { sql, spots: FALLBACK_SPOTS.length, zones: zones.length + HAND_ZONES.length + 1 };
}

let result;
let mode = "osm";
if (args.fallback) {
  mode = "fallback";
  result = viaFallback();
} else {
  try {
    result = await viaOverpass();
  } catch (err) {
    if (!(err instanceof OverpassDown)) throw err;
    console.error(err.message);
    console.error("\nOverpass is unreachable. Writing the hand-made list of well-known Lagos spots instead.");
    mode = "fallback";
    result = viaFallback();
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, result.sql + "\n");
log(`\nWrote ${OUT}`);
log(`${mode === "osm" ? "OpenStreetMap" : "Fallback list"}: ${result.spots} spots, ${result.zones} zones, ${(Buffer.byteLength(result.sql) / 1024).toFixed(0)} KB`);
