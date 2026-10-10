// ============================================================================
// Hoppaz: import Season 1 of the card deck (the clean push set)
//
//   node scripts/cards/import-s1.mjs --deck=<deck folder> [--cache=<dir>]
//
// <deck folder> is the push set Jae sent: README.md, data/cards.json, data/HOLDBACK.csv,
// fronts/<ID>.png and backs/<ID>.png (720 x 1152). Run again any time: with the same cache, the same result.
// Options:
//   --cache=<dir>    keep every Nominatim and Wikipedia answer in <dir> and reuse it next time
//                    (default: <tmp>/hoppaz-cards-s1)
//   --db=<name>      the local Postgres container used for the no-spawn check
//                    (default supabase_db_hoppaz-local)
//   --no-db          skip that check (not for a real run)
//   --offline        read the cache only, never ask the network
//   --ua=<string>    the User-Agent to send; add a contact to it if a service asks for one
//   --skip-images    keep the WebP files as they are, redo only s1.json
//   --thumbs-only    redo only the two thumb sizes from the deck's fronts, then stop (no geotagging, no s1.json)
//
// What it writes:
//   public/cards/s1/front/<ID>.webp   720 x 1152, lossy (the art is flat colour, quality 64 stays crisp)
//   public/cards/s1/back/<ID>.webp    720 x 1152, lossless (text on dark: smaller than lossy and exact)
//   public/cards/s1/thumb/<ID>.webp   180 x 288 of the front, for the Collection grid
//   public/cards/s1/thumb/<ID>-2x.webp  360 x 576 of the front: the app's srcset sends it to 3x phones (a tile is 113 px wide
//                                     at 390, so a 180 px file is upscaled 1.9x there). Its URL is the thumb's with -2x
//                                     before .webp (thumbSrcSet in src/lib/cards.ts), so it needs no column.
//   src/data/cards/s1.json            the manifest and the 125 cards, art paths pointing at the WebP
//                                     files, plus lat, lng, geo_kind and geo_confidence on every card
//
// Rules from the deck README it enforces: data/cards.json is the source of truth, nothing from
// data/HOLDBACK.csv ships, every card is Hoppaz original art with no third-party image and no
// person, and the rarity spread is counted from the cards (this season has no Legendary).
//
// Geotag. The deck has no coordinates. Each card gets a point (docs/CARDS.md: every card is tagged
// to a location, standing there stamps it Visited):
//   place     the place itself, found by name in OpenStreetMap (Nominatim, one request a second,
//             every answer cached), else in the Wikipedia article the deck cites or one that matches
//             its name, and checked to sit near its home area (a few were pinned by hand, in PLAN)
//   area      history, culture, food or lore with no single spot: the centre of its set or home area
//   citywide  the City-wide series: the Lagos Island anchor. Not a stampable spot. Treat these as
//             the "anywhere" bucket only and refuse stamp_visit for them.
// geo_confidence: high = the named place was found by name, or a small named area is pinned at its
// centre; medium = the centre of a larger area (a council, a city), a looser name match or a moved
// viewpoint; low = the place was not found and its area centre stands in, or the area itself was not
// found and a neighbour stands in. The low ones are the list to check by hand.
// Every point is checked to be inside Lagos State and outside every active no_spawn_zones row
// (water included, so no point sits in the lagoon or the sea; the same rule cards_guard_geog
// enforces). A landmark that sits inside one (a power station, a barracks, a jetty) is moved to the
// nearest point outside every zone (rings of 16 bearings, 60 m out to 1.3 km), a public viewpoint,
// and says so in geo_note.
// The table of what to look for is PLAN and AREAS below. To fix a point, edit the table and run again.
// Data (c) OpenStreetMap contributors, ODbL; Wikipedia coordinates where used.
// ============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
if (typeof args.deck !== "string") {
  console.error("Pass --deck=<deck folder>. See the top of this file.");
  process.exit(1);
}
const DECK = resolve(args.deck);
const CACHE = resolve(typeof args.cache === "string" ? args.cache : join(tmpdir(), "hoppaz-cards-s1"));
const DB = typeof args.db === "string" ? args.db : "supabase_db_hoppaz-local";
const PUBLIC_DIR = join(ROOT, "public/cards/s1");
const OUT_JSON = join(ROOT, "src/data/cards/s1.json");
const URL_BASE = "/cards/s1";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const WIKIPEDIA = "https://en.wikipedia.org/w/api.php";
const UA = typeof args.ua === "string" ? args.ua : "hoppaz-cards-import/1.0 (Lagos nightlife app; one-off data import)";
// Lagos State box (the state runs from the Seme border at 2.7 E to Ibeju-Lekki at 4.35 E)
const VIEWBOX = "2.69,6.75,4.40,6.36";
const REQUEST_GAP_MS = 1100;
const REF_MILE2 = [6.46019, 3.30985]; // docs/DECISIONS.md, 10 Oct 2026: the real Mile 2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);

// ----------------------------------------------------------------- the deck ---
const manifest = JSON.parse(await readFile(join(DECK, "data/cards.json"), "utf8"));
const cards = manifest.cards;
const ids = cards.map((c) => c.id);
const holdback = new Set(
  (await readFile(join(DECK, "data/HOLDBACK.csv"), "utf8")).split("\n").slice(1).map((l) => l.split(",")[0].trim()).filter(Boolean),
);
const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };
need(cards.length === manifest.card_count && cards.length === 125, `expected 125 cards, found ${cards.length}`);
need(new Set(ids).size === ids.length, "duplicate card ids");
for (const c of cards) {
  need(!holdback.has(c.id), `${c.id} is in HOLDBACK.csv`);
  need(c.art?.type === "hoppaz_original" && !c.art.credit, `${c.id} is not clean Hoppaz art`);
  need(!Object.values(c.clearance ?? { missing: true }).some(Boolean), `${c.id} has a clearance flag`);
  need(["common", "rare", "epic", "legendary"].includes(c.rarity), `${c.id} has rarity ${c.rarity}`);
}
if (problems.length) fail(problems);
const rarityCounts = Object.fromEntries(["common", "rare", "epic", "legendary"].map((t) => [t, cards.filter((c) => c.rarity === t).length]));
log(`${cards.length} cards, ${Object.entries(rarityCounts).map(([t, n]) => `${n} ${t}`).join(", ")}; ${holdback.size} held back (not shipped)`);

function fail(list) {
  console.error("Stopped:\n  " + list.join("\n  "));
  process.exit(1);
}

// ------------------------------------------------------------------- images ---
const QUALITY_FRONT = 64;
const QUALITY_THUMB = 70;
const THUMB = { w: 180, h: 288 };
const THUMB_2X = { w: 360, h: 576 };

async function thumbs(id) {
  const front = join(DECK, "fronts", `${id}.png`);
  await sharp(front).resize(THUMB.w, THUMB.h).webp({ quality: QUALITY_THUMB, effort: 6, smartSubsample: true }).toFile(join(PUBLIC_DIR, "thumb", `${id}.webp`));
  await sharp(front).resize(THUMB_2X.w, THUMB_2X.h).webp({ quality: QUALITY_THUMB, effort: 6, smartSubsample: true }).toFile(join(PUBLIC_DIR, "thumb", `${id}-2x.webp`));
}

async function images() {
  sharp.concurrency(2); // the Mac has crashed under load before
  for (const d of ["front", "back", "thumb"]) {
    await mkdir(join(PUBLIC_DIR, d), { recursive: true });
    for (const f of await readdir(join(PUBLIC_DIR, d))) {
      if (f.endsWith(".webp") && !ids.includes(f.slice(0, -5).replace(/-2x$/, ""))) await unlink(join(PUBLIC_DIR, d, f)); // never leave a stale card
    }
  }
  const one = async (id) => {
    const front = join(DECK, "fronts", `${id}.png`);
    const back = join(DECK, "backs", `${id}.png`);
    for (const f of [front, back]) {
      const m = await sharp(f).metadata();
      if (m.width !== 720 || m.height !== 1152) throw new Error(`${f} is ${m.width} x ${m.height}, expected 720 x 1152`);
    }
    await sharp(front).webp({ quality: QUALITY_FRONT, effort: 6, smartSubsample: true }).toFile(join(PUBLIC_DIR, "front", `${id}.webp`));
    await sharp(back).webp({ lossless: true, effort: 6 }).toFile(join(PUBLIC_DIR, "back", `${id}.webp`));
    await thumbs(id);
  };
  for (let i = 0; i < ids.length; i += 2) await Promise.all(ids.slice(i, i + 2).map(one));
  await sizes();
}
async function sizes() {
  const total = {};
  for (const [d, suffix, key] of [["front", "", "front"], ["back", "", "back"], ["thumb", "", "thumb"], ["thumb", "-2x", "thumb2"]]) {
    total[key] = 0;
    for (const id of ids) total[key] += (await stat(join(PUBLIC_DIR, d, `${id}${suffix}.webp`))).size;
  }
  const mb = (n) => (n / 1048576).toFixed(2);
  log(`images: front ${mb(total.front)} MB, back ${mb(total.back)} MB (${mb(total.front + total.back)} MB for the ${ids.length * 2} full-size files), thumb ${mb(total.thumb)} MB, thumb 2x ${mb(total.thumb2)} MB`);
}
if (args["thumbs-only"]) {
  sharp.concurrency(2); // the Mac has crashed under load before
  await mkdir(join(PUBLIC_DIR, "thumb"), { recursive: true });
  for (let i = 0; i < ids.length; i += 2) await Promise.all(ids.slice(i, i + 2).map(thumbs));
  await sizes();
  process.exit(0);
}
if (!args["skip-images"]) await images();

// ------------------------------------------------------------ geometry & OSM ---
const kmBetween = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const inRing = (x, y, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

let lastRequest = 0;
async function get(url, label) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 48)}-${sha(url)}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {}
  if (args.offline) throw new Error(`not in the cache and --offline is set: ${label}`);
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const json = await res.json();
      await writeFile(file, JSON.stringify(json));
      return json;
    }
    if ((res.status === 429 || res.status === 503) && attempt < 6) {
      const pause = Math.min(Number(res.headers.get("retry-after")) || 15, 60);
      log(`  ${label}: HTTP ${res.status}, waiting ${pause} s`);
      await sleep(pause * 1000 + 500);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${label}`);
  }
}

const search = (q) =>
  get(`${NOMINATIM}/search?` + new URLSearchParams({ q, format: "jsonv2", limit: "6", countrycodes: "ng", viewbox: VIEWBOX, bounded: "1", addressdetails: "0" }), q);

// Wikipedia is the second source: some places OSM has no name for have an article with a coordinate,
// and the deck cites many of those articles itself
const wikiPoints = (j) =>
  (j.query?.pages ?? [])
    .filter((p) => p.coordinates?.length)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ lat: p.coordinates[0].lat, lng: p.coordinates[0].lon, name: p.title, kind: "wikipedia", source: `wikipedia:${p.title.replace(/ /g, "_")}` }));
const wikiSearch = async (q) =>
  wikiPoints(await get(`${WIKIPEDIA}?` + new URLSearchParams({ action: "query", generator: "search", gsrsearch: q, gsrlimit: "4", gsrnamespace: "0", prop: "coordinates", colimit: "4", format: "json", formatversion: "2" }), `wiki-${q}`));
const wikiTitle = async (t) =>
  wikiPoints(await get(`${WIKIPEDIA}?` + new URLSearchParams({ action: "query", titles: t, redirects: "1", prop: "coordinates", format: "json", formatversion: "2" }), `wiki-title-${t}`));
const wikiTitleOf = (url) => (/^https:\/\/en\.wikipedia\.org\/wiki\//.test(url ?? "") ? decodeURIComponent(url.split("/wiki/")[1]).replace(/_/g, " ") : null);

// the outline of Lagos State (simplified to about 10 m)
const stateRes = await get(
  `${NOMINATIM}/search?` + new URLSearchParams({ q: "Lagos State, Nigeria", featureType: "state", format: "jsonv2", limit: "1", countrycodes: "ng", polygon_geojson: "1", polygon_threshold: "0.0001" }),
  "lagos-state-outline",
);
const outline = stateRes[0]?.geojson;
if (!outline || !/Polygon/.test(outline.type)) fail(["Nominatim sent no outline for Lagos State"]);
const STATE = outline.type === "Polygon" ? [outline.coordinates] : outline.coordinates;
const inState = (lat, lng) => STATE.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));

// ------------------------------------------------------------------- the plan ---
// AREAS: a named area and what to ask Nominatim for it (the first answer inside Lagos State wins,
// a settlement beats a boundary beats a road). Nothing there: a Wikipedia article, then the parent.
//   within: [parent, km]  the answer must be within km of the parent, else the parent's point stands in (low)
//   boundary: true       prefer the council boundary's centre to a settlement of the same name
//   conf / cap            set by hand after looking at the answer (cap: the most it can claim)
//   pin:                  [lat, lng] used when nothing is found
const AREAS = {
  "lagos-island": { q: ["Lagos Island, Lagos"] },
  unilag: { q: ["University of Lagos"], conf: "high" },
  yaba: { q: ["Yaba, Lagos"] },
  bariga: { q: ["Bariga, Lagos"] },
  shomolu: { q: ["Bajulaiye Road, Shomolu, Lagos", "Shomolu, Lagos"] },
  igbogbo: { q: ["Igbogbo, Ikorodu, Lagos", "Igbogbo, Lagos"], within: ["ikorodu", 14] },
  baiyeku: { q: ["Baiyeku, Ikorodu, Lagos", "Baiyeku"], within: ["igbogbo", 10] },
  egbin: { q: ["Egbin, Ikorodu, Lagos", "Egbin, Lagos"], within: ["ikorodu", 20], cap: "medium" },
  ijede: { q: ["Ijede, Ikorodu, Lagos", "Ijede, Lagos"], within: ["ikorodu", 20] },
  "oke-eletu": { q: ["Oke Eletu, Ijede, Lagos", "Oke Eletu, Lagos"], within: ["ijede", 8] },
  imota: { q: ["Imota, Ikorodu, Lagos", "Imota, Lagos"], within: ["ikorodu", 20] },
  ikorodu: { q: ["Ikorodu, Lagos"] },
  "ikorodu-north": { q: ["Ikorodu North Local Council Development Area, Lagos", "Ikorodu North, Lagos"], within: ["odogunyan", 20] },
  isiu: { q: ["Isiu, Ikorodu, Lagos", "Isiu"], within: ["ikorodu", 20] },
  odogunyan: { q: ["Odogunyan, Ikorodu, Lagos", "Odogunyan, Lagos"], within: ["ikorodu", 8] },
  ebuwawa: { q: ["Ebuwawa, Ikorodu, Lagos", "Ebuwawa, Lagos"], within: ["ikorodu-north", 12] },
  omigo: { q: ["Omigo, Ikorodu, Lagos", "Omigo, Lagos"], within: ["ikorodu-north", 12] },
  "ikorodu-west": { q: ["Ikorodu West Local Council Development Area, Lagos", "Ikorodu West, Lagos"], within: ["owutu", 20] },
  owutu: { q: ["Owutu, Ikorodu, Lagos", "Owutu, Lagos"], within: ["ikorodu", 12], cap: "medium" },
  isawo: { q: ["Isawo, Ikorodu, Lagos", "Isawo, Lagos"], within: ["ikorodu", 14], cap: "medium" },
  konu: { q: ["Konu, Ikorodu, Lagos", "Konu, Lagos"], within: ["ikorodu-west", 12] },
  igbolomu: { q: ["Igbo Olomu, Ikorodu, Lagos", "Igbolomu, Ikorodu, Lagos", "Igbo-Olomu, Lagos"], within: ["ikorodu-west", 12] },
  agege: { q: ["Agege, Lagos"] },
  "orile-agege": { q: ["Orile Agege, Lagos", "Orile-Agege, Lagos"], within: ["agege", 6] },
  iju: { q: ["Iju, Lagos"], within: ["agege", 8] },
  alimosho: { q: ["Alimosho Local Government Secretariat, Lagos", "Alimosho, Lagos"], boundary: true },
  "ifako-ijaiye": { q: ["Ifako-Ijaiye Local Government Secretariat, Lagos", "Ifako-Ijaiye, Lagos", "Ifako, Lagos"] },
  agbado: { q: ["Agbado, Alimosho, Lagos", "Agbado Railway Station, Lagos"], within: ["alimosho", 16] },
  ayobo: { q: ["Ayobo, Lagos"], within: ["alimosho", 12] },
  egbe: { q: ["Egbe, Alimosho, Lagos", "Egbe, Lagos"], within: ["alimosho", 10] },
  igando: { q: ["Igando, Lagos", "Igando, Alimosho, Lagos"], within: ["alimosho", 10] },
  mosan: { q: ["Mosan, Lagos", "Mosan, Alimosho, Lagos"], within: ["alimosho", 10] },
  "abule-egba": { q: ["Abule Egba, Lagos"], within: ["agege", 8] },
  ojodu: { q: ["Ojodu Berger, Lagos", "Ojodu, Lagos"] },
  onigbongbo: { q: ["Onigbongbo, Lagos", "Allen Avenue, Ikeja, Lagos"] },
  mushin: { q: ["Mushin, Lagos"] },
  oshodi: { q: ["Oshodi, Lagos"] },
  agboyi: { q: ["Agboyi, Lagos", "Agboyi, Ketu, Lagos"] },
  ikosi: { q: ["Ikosi, Ketu, Lagos", "Ikosi Isheri, Lagos", "Ikosi, Lagos"], within: ["ojodu", 12] },
  ojuwoye: { q: ["Ojuwoye, Mushin, Lagos", "Ojuwoye, Lagos"], within: ["mushin", 5] },
  ejigbo: { q: ["Ejigbo, Lagos"] },
  isolo: { q: ["Isolo, Lagos"] },
  apapa: { q: ["Apapa, Lagos"] },
  epetedo: { q: ["Epetedo, Lagos Island, Lagos", "Epetedo, Lagos"], within: ["lagos-island", 5] },
  surulere: { q: ["Surulere, Lagos"] },
  ikoyi: { q: ["Ikoyi, Lagos"] },
  coker: { q: ["Coker, Surulere, Lagos", "Coker, Lagos"], within: ["surulere", 6] },
  aguda: { q: ["Aguda, Surulere, Lagos", "Aguda, Lagos"], within: ["surulere", 6] },
  itire: { q: ["Itire, Lagos"], within: ["surulere", 6] },
  ajegunle: { q: ["Ajegunle, Lagos"] },
  amukoko: { q: ["Amukoko, Lagos"], within: ["ajegunle", 6] },
  mile2: { q: ["Mile 2, Lagos"], pin: REF_MILE2 },
  tradefair: { q: ["Trade Fair Complex, Satellite Town, Lagos", "Trade Fair Complex, Lagos"] },
  ijanikin: { q: ["Ijanikin, Lagos"], within: ["tradefair", 25] },
  oto: { q: ["Oto, Ojo, Lagos", "Oto-Awori, Lagos", "Oto, Lagos"], within: ["ijanikin", 25] },
  obadore: { q: ["Obadore, Lagos", "Iba, Ojo, Lagos"], within: ["tradefair", 25] },
  apa: { q: ["Apa, Badagry, Lagos", "Apa, Lagos"] },
  seme: { q: ["Seme Border, Lagos", "Seme, Badagry, Lagos"] },
  epe: { q: ["Epe, Lagos"] },
  akodo: { q: ["Akodo, Ibeju-Lekki, Lagos", "Akodo, Lagos"] },
  ilara: { q: ["Ilara-Epe, Lagos", "Ilara, Epe, Lagos"], within: ["epe", 20] },
  ejinrin: { q: ["Ejinrin, Epe, Lagos", "Ejinrin, Lagos"], within: ["epe", 20] },
  agbowa: { q: ["Agbowa, Lagos", "Agbowa-Ikosi, Lagos"], within: ["epe", 30] },
  lekki: { q: ["Lekki, Lagos"] },
};

// PLAN: one row a card. [kind, area, queries, options]
//   queries (place only): what to look for, best first; a leading "~" marks a looser or other name (medium at most);
//     the answer must sit within maxKm (default 6) of the area's point
//   options: maxKm; cap "medium" | "low" (the most the card can claim); conf (set by hand after looking at the answer);
//     wiki: false (never use Wikipedia for it) or ["search", ...] (extra Wikipedia searches; a card whose own
//     source is a Wikipedia article uses that article first); pin { at: [lat, lng], source, why, conf } (a point
//     found by hand, used when the queries find nothing); note (replaces the default geo_note when the area stands in)
const PLAN = {
  "UNI-01": ["area", "unilag"],
  "UNI-03": ["place", "unilag", ["University of Lagos"], { maxKm: 3 }],
  "UNI-05": ["area", "unilag"],
  "UNI-07": ["place", "unilag", ["Ade Ajayi Auditorium", "Main Auditorium, University of Lagos"], { maxKm: 3, wiki: false }],
  "UNI-08": ["area", "unilag"],
  "UNI-09": ["place", "unilag", ["UNILAG Radio", "UNILAG 103.1 FM"], { maxKm: 3, wiki: false }],
  "YAB-01": ["place", "yaba", ["Yaba College of Technology, Lagos"]],
  "YAB-03": ["place", "yaba", ["Queen's College, Yaba, Lagos", "Queens College, Lagos"], { wiki: ["Queen's College, Lagos"] }],
  "YAB-04": ["place", "yaba", ["Federal Science and Technical College, Yaba, Lagos", "FSTC Yaba"]],
  "YAB-06": ["place", "yaba", ["St. Finbarr's College, Akoka, Lagos", "~Finbarr"], { wiki: false }],
  "YAB-07": ["place", "yaba", ["Tejuosho Market, Lagos", "Tejuosho"], { conf: "high" }],
  "YAB-10": ["place", "yaba", ["Yaba Bus Terminal, Lagos"]],
  "YAB-11": ["place", "yaba", ["Yaba Railway Station, Lagos", "Yaba Station, Lagos"], { conf: "high" }],
  "YAB-12": ["place", "yaba", ["Co-Creation Hub, Yaba, Lagos", "CcHub, Lagos"], { conf: "high" }],
  "YAB-15": ["area", "yaba"],
  "YAB-16": ["place", "yaba", ["Federal Neuro-Psychiatric Hospital, Yaba, Lagos", "Yaba Psychiatric"], { conf: "high", wiki: false }],

  "IKD-IGB-01": ["area", "igbogbo"],
  "IKD-IGB-03": ["area", "igbogbo"],
  "IKD-IGB-04": ["place", "igbogbo", ["Adeboruwa Palace", "Igbogbo Palace"], { maxKm: 4, wiki: false }],
  "IKD-IGB-05": ["place", "igbogbo", ["Adeboruwa Market", "Igbogbo Market"], { maxKm: 4, wiki: false }],
  "IKD-IGB-06": ["place", "baiyeku", ["Baiyeku Jetty", "~Bayeku"], { maxKm: 4, wiki: false }],
  "IKD-IGB-07": ["area", "igbogbo"],
  "IKD-IGB-09": ["place", "igbogbo", ["Zumratul Grammar School, Igbogbo, Lagos", "Zumratul Islamiyyah Grammar School, Igbogbo, Lagos"], { maxKm: 4, wiki: false }],
  "IKD-IGB-10": ["area", "igbogbo"],

  "IKD-IJD-01": ["place", "egbin", ["Egbin Power Station, Lagos"], { maxKm: 6, wiki: false }],
  "IKD-IJD-02": ["area", "egbin"],
  "IKD-IJD-03": ["place", "ijede", ["Ijede General Hospital, Lagos", "General Hospital Ijede, Lagos"], { maxKm: 6, conf: "high", wiki: false }],
  "IKD-IJD-04": ["place", "ijede", ["Ijede Spring", "Odoro Spring"], { maxKm: 5 }],
  "IKD-IJD-05": ["area", "ijede"],
  "IKD-IJD-06": ["area", "oke-eletu"],
  "IKD-IJD-07": ["place", "egbin", ["Egbin Royal Palace", "Obateru Palace"], { maxKm: 4 }],
  "IKD-IJD-08": ["area", "ijede"],
  "IKD-IJD-09": ["area", "ijede", [], { cap: "medium" }],

  "IKD-IMO-01": ["area", "imota"],
  "IKD-IMO-02": ["area", "imota"],
  "IKD-IMO-03": ["area", "imota"],
  "IKD-IMO-04": ["area", "imota"],
  "IKD-IMO-05": ["area", "imota"],
  "IKD-IMO-08": ["place", "imota", ["Imota Rice Mill", "Rice Mill, Imota"], { maxKm: 10, wiki: false }],
  "IKD-IMO-09": ["place", "imota", ["Caleb University"], { maxKm: 10, wiki: false }],

  "IKD-IKO-01": ["area", "ikorodu"],
  "IKD-IKO-02": ["area", "ikorodu"],
  "IKD-IKO-04": ["place", "ikorodu", ["Ayangburen Palace", "Ikorodu Palace"], { maxKm: 5, conf: "medium", wiki: false }],
  "IKD-IKO-05": ["area", "ikorodu"],
  "IKD-IKO-06": ["area", "ikorodu"],
  "IKD-IKO-07": ["area", "ikorodu"],
  "IKD-IKO-08": ["area", "ikorodu"],
  "IKD-IKO-10": ["area", "ikorodu"],
  "IKD-IKO-11": ["area", "ikorodu"],
  "IKD-IKO-12": ["area", "ikorodu"],
  "IKD-IKO-13": ["area", "ikorodu"],
  "IKD-IKO-14": ["place", "ikorodu", ["Lagos State University of Science and Technology", "LASUSTECH", "~Lagos State Polytechnic, Ikorodu"], { maxKm: 8, wiki: false }],
  "IKD-IKO-17": ["place", "ikorodu", ["Ikorodu City FC", "Ikorodu Stadium"], { maxKm: 8, wiki: ["Ikorodu City F.C."] }],

  "IKD-NTH-01": ["area", "ikorodu-north", [], { cap: "medium" }],
  "IKD-NTH-02": ["area", "isiu"],
  "IKD-NTH-03": ["area", "odogunyan"],
  "IKD-NTH-04": ["place", "ebuwawa", ["Ebuwawa Market", "Ebuwawa"], { maxKm: 6, wiki: false }],
  "IKD-NTH-05": ["area", "omigo"],
  "IKD-WST-01": ["area", "ikorodu-west", [], { cap: "medium" }],
  "IKD-WST-02": ["area", "owutu"],
  "IKD-WST-03": ["area", "isawo"],
  "IKD-WST-04": ["area", "konu"],
  "IKD-WST-05": ["area", "igbolomu"],

  "AGE-03": ["place", "agege", ["Pen Cinema", "~Pen Cinema Bridge"], { maxKm: 5, wiki: false }],
  "AGE-ORI-01": ["area", "orile-agege"],
  "AGE-ORI-02": ["area", "orile-agege"],
  "ALI-01": ["area", "alimosho", [], { cap: "medium" }],
  "IFK-01": ["area", "ifako-ijaiye", [], { cap: "medium" }],
  "IFK-02": ["place", "iju", ["Iju Waterworks", "Iju Water Works"], { maxKm: 5, wiki: false, note: "Iju Water Works is just across the border in Ogun State, so Iju stands in" }],
  "ALI-AGB-02": ["area", "agbado"],
  "ALI-AYO-01": ["area", "ayobo"],
  "ALI-EGB-01": ["place", "egbe", ["Council Street, Egbe"], { maxKm: 4, wiki: false }],
  "ALI-EGB-02": ["area", "egbe"],
  "ALI-IGA-01": ["area", "igando"],
  "ALI-MOS-01": ["area", "mosan"],
  "IFK-OJK-01": ["area", "abule-egba"],
  "IFK-OJK-03": ["place", "agege", ["Oko Oba Abattoir", "~Oko Oba"], { maxKm: 9, wiki: false }],
  "IKJ-OJD-02": ["place", "ojodu", ["Aro Meta"], { maxKm: 3 }],
  "IKJ-ONI-01": ["place", "onigbongbo", ["Kalakuta Museum", "~Gbemisola Street"], { maxKm: 6 }],
  "MSH-01": ["place", "mushin", ["Lagos University Teaching Hospital, Idi-Araba, Lagos"], { maxKm: 6, conf: "high", wiki: false }],
  "MSH-03": ["area", "mushin"],
  "OSH-01": ["area", "oshodi"],
  "SHO-01": ["area", "shomolu"],
  "KSF-AGB-01": ["area", "agboyi"],
  "KSF-AGB-02": ["area", "agboyi"],
  "KSF-IKO-01": ["area", "ikosi"],
  "MSH-ODI-01": ["place", "ojuwoye", ["Ojuwoye Market"], { maxKm: 4, wiki: false }],
  "MSH-ODI-02": ["area", "ojuwoye"],
  "OSH-EJI-01": ["place", "ejigbo", ["Jakande Estate Oke-Afa", "Oke Afa Jakande Estate"], { maxKm: 6, wiki: false }],
  "OSH-EJI-02": ["place", "ejigbo", ["Ifoshi Road, Ejigbo, Lagos"], { maxKm: 6, wiki: false }],
  "OSH-ISO-02": ["place", "isolo", ["Isolo General Hospital, Lagos"], { maxKm: 5, wiki: false }],
  "SHO-BAR-01": ["place", "bariga", ["Federal College of Education Technical Akoka"], { maxKm: 5, conf: "high", wiki: false }],
  "SHO-BAR-02": ["place", "bariga", ["Crown Troupe of Africa", "Bariga Open Air Theatre"], { maxKm: 3, wiki: false }],

  "APP-02": ["place", "apapa", ["Apapa Amusement Park, Lagos"], { maxKm: 5, wiki: false }],
  "APP-03": ["area", "apapa"],
  "LIS-EAS-01": ["area", "epetedo"],
  "LIS-EAS-02": ["place", "epetedo", ["Eleganza Sport Centre", "Eleganza Sports Centre"], { maxKm: 3, wiki: false }],
  "SUR-03": ["area", "surulere"],
  "ETO-IKY-02": ["place", "ikoyi", ["Ikoyi Club 1938, Lagos"], { maxKm: 5, wiki: false }],
  "ETO-IKY-03": ["place", "ikoyi", ["Dodan Barracks, Lagos"], { maxKm: 5, wiki: false }],
  "SUR-COK-01": ["area", "coker"],
  "SUR-COK-02": ["area", "aguda"],
  "SUR-ITI-01": ["area", "itire"],

  "AJR-01": ["place", "ajegunle", ["Maracana Stadium", "Maracana"], { maxKm: 5, wiki: false }],
  "AJR-02": ["area", "ajegunle"],
  "AJR-03": ["place", "ajegunle", ["Tolu Schools Complex", "~Tolu"], { maxKm: 5, wiki: false }],
  "AJR-IFE-01": ["place", "amukoko", ["Dispensary Street, Mosafejo, Amukoko", "~Mosafejo Street"], { maxKm: 4, wiki: false }],
  "AJR-IFE-02": ["place", "amukoko", ["St. Matthew Catholic Church, Amukoko", "St Matthew's Catholic Church, Amukoko"], { maxKm: 4, wiki: false }],
  "AMO-03": ["place", "mile2", ["Mile 2 Railway Station, Lagos", "Mile 2 Blue Line Station, Lagos"], { maxKm: 1.5, pin: { at: REF_MILE2, source: "manual", why: "the Mile 2 point in docs/DECISIONS.md", conf: "medium" }, wiki: false }],
  "AMO-ORI-01": ["place", "tradefair", ["Trade Fair Complex, Satellite Town, Lagos"], { maxKm: 4, wiki: false }],
  "AMO-ORI-02": ["area", "tradefair", [], { cap: "medium" }],

  "OJO-OTO-01": ["area", "oto"],
  "OJO-IBA-02": ["area", "obadore"],
  "OJO-OTO-02": ["place", "ijanikin", ["Federal Government College, Ijanikin, Lagos"], { maxKm: 6, wiki: false }],
  "BDG-WES-01": ["area", "apa"],
  "BDG-WES-02": ["place", "seme", ["Seme Border, Badagry, Lagos"], { maxKm: 5, wiki: false }],

  "EPE-02": ["area", "epe"],
  "EPE-03": ["area", "epe"],
  "IBL-03": ["place", "akodo", ["Eko Tourist Beach Resort, Akodo, Lagos"], { maxKm: 6, wiki: false }],
  "EPE-ERE-02": ["area", "ilara"],
  "EPE-IKO-01": ["place", "ejinrin", ["Ejinrin Market"], { maxKm: 5, wiki: ["Ejinrin"] }],
  "EPE-IKO-02": ["area", "agbowa"],
  "IBL-LEK-01": ["place", "lekki", ["Awolowo Detention Camp"], { maxKm: 60 }],

  "MUS-45": ["citywide", "lagos-island"],
  "MUS-47": ["citywide", "lagos-island"],
};

// --------------------------------------------------------------------- resolve ---
const hitOf = (r) => ({
  lat: +r.lat,
  lng: +r.lon,
  name: r.name || r.display_name.split(",")[0],
  kind: `${r.category}:${r.type}`,
  source: `osm:${r.osm_type}/${r.osm_id}`,
});
// a settlement beats a boundary beats a building beats a road
const settlement = /^place:(suburb|neighbourhood|quarter|village|hamlet|locality)$/;
const pref = (kind) => (settlement.test(kind) || /^place:/.test(kind) ? 0 : /^boundary:/.test(kind) ? 1 : /^(highway|railway):/.test(kind) ? 3 : 2);
const boundaryFirst = (kind) => (/^boundary:/.test(kind) ? -1 : pref(kind));
const rank = { low: 0, medium: 1, high: 2 };
const lower = (a, b) => (rank[a] <= rank[b] ? a : b);
const tokens = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !["the", "lagos", "and", "of"].includes(t)));
// how much of the shorter name is in the other
const sim = (a, b) => {
  const x = tokens(a), y = tokens(b);
  return x.size && y.size ? [...x].filter((t) => y.has(t)).length / Math.min(x.size, y.size) : 0;
};
// every word of the name is in the title
const covers = (title, name) => {
  const y = tokens(title);
  return [...tokens(name)].every((t) => y.has(t));
};
const near = (ref, maxKm) => (h) => inState(h.lat, h.lng) && (!ref || kmBetween([h.lat, h.lng], [ref.lat, ref.lng]) <= maxKm);

// the first Nominatim answer that is inside Lagos State and, when asked, near `ref`
async function find(queries, ref, maxKm, order = pref) {
  for (const raw of queries) {
    const alias = raw.startsWith("~");
    const q = alias ? raw.slice(1) : raw;
    const hits = (await search(q)).map(hitOf).filter(near(ref, maxKm));
    hits.sort((a, b) => order(a.kind) - order(b.kind)); // stable: Nominatim's order breaks ties
    if (hits.length) return { ...hits[0], q, alias };
  }
  return null;
}
// a Wikipedia coordinate: the named articles first, then searches whose title looks like the name
async function wikiFind(titles, searches, ref, maxKm, name) {
  for (const t of titles) {
    const h = (await wikiTitle(t)).find(near(ref, maxKm));
    if (h) return { ...h, own: true };
  }
  for (const q of searches) {
    const h = (await wikiSearch(q)).find((x) => near(ref, maxKm)(x) && covers(x.name, name));
    if (h) return h;
  }
  return null;
}

const label = (key) => (key === "mile2" ? "Mile 2" : key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
const anchors = {};
const missing = [];
async function anchor(key) {
  if (anchors[key]) return anchors[key];
  const def = AREAS[key];
  if (!def) throw new Error(`no area "${key}" in AREAS`);
  const parent = def.within ? await anchor(def.within[0]) : null;
  const maxKm = def.within?.[1];
  let a = await find(def.q, parent, maxKm, def.boundary ? boundaryFirst : pref);
  if (a) a.conf = def.conf ?? (settlement.test(a.kind) ? "high" : "medium");
  else {
    const w = await wikiFind([], [def.q[0].split(",")[0]], parent, maxKm, def.q[0].split(",")[0]);
    if (w) a = { ...w, conf: "medium", q: `wikipedia ${w.name}` };
  }
  if (!a && def.pin) a = { lat: def.pin[0], lng: def.pin[1], name: key, kind: "pin", source: "manual", conf: "high", q: "pin from docs/DECISIONS.md" };
  else if (!a && parent) a = { ...parent, conf: "low", stand: parent.stand ?? def.within[0], q: `(${key} not found, ${parent.stand ?? def.within[0]} stands in)` };
  else if (!a) {
    missing.push(`area ${key} not found: ${def.q.join(" | ")}`);
    a = { lat: NaN, lng: NaN, name: key, kind: "missing", source: "none", conf: "low", q: "missing" };
  }
  if (def.cap) a.conf = lower(a.conf, def.cap);
  return (anchors[key] = a);
}

const geo = {};
for (const c of cards) {
  const row = PLAN[c.id];
  if (!row) fail([`${c.id} is not in PLAN`]);
  const [kind, areaKey, queries = [], opts = {}] = row;
  const area = await anchor(areaKey);
  let g;
  if (kind === "place") {
    const maxKm = opts.maxKm ?? 6;
    const hit = await find(queries, area, maxKm);
    if (hit) {
      const exact = !hit.alias && (sim(hit.name, hit.q) >= 0.5 || sim(hit.name, c.name) >= 0.5);
      g = { kind: "place", lat: hit.lat, lng: hit.lng, conf: opts.conf ?? (exact ? "high" : "medium"), source: hit.source, found: `${hit.name} (${hit.kind}) for "${hit.q}"` };
    } else if (opts.wiki !== false) {
      const own = wikiTitleOf(c.source_url);
      const w = await wikiFind(own ? [own] : [], opts.wiki ?? [], area, maxKm, c.name);
      if (w) g = { kind: "place", lat: w.lat, lng: w.lng, conf: opts.conf ?? (w.own && sim(w.name, c.name) >= 0.5 ? "high" : "medium"), source: w.source, found: `${w.name} (Wikipedia)` };
    }
    if (!g && opts.pin) g = { kind: "place", lat: opts.pin.at[0], lng: opts.pin.at[1], conf: opts.pin.conf, source: opts.pin.source, found: opts.pin.why };
    if (!g) {
      const why = area.stand ? `place and ${label(areaKey)} not found, ${label(area.stand)} stands in` : "place not found, centre of its area";
      g = { kind: "area", lat: area.lat, lng: area.lng, conf: "low", source: area.source, found: `not found, ${areaKey} stands in`, note: opts.note ?? why };
    }
  } else if (kind === "area") {
    g = { kind: "area", lat: area.lat, lng: area.lng, conf: area.conf, source: area.source, found: `${area.name} (${area.kind})` };
    if (area.stand) g.note = `${label(areaKey)} not found, ${label(area.stand)} stands in`;
  } else {
    g = { kind: "citywide", lat: area.lat, lng: area.lng, conf: "high", source: area.source, found: `${area.name} (${area.kind})`, note: "Lagos Island anchor, not a stampable spot" };
  }
  if (opts.cap) g.conf = lower(g.conf, opts.cap);
  geo[c.id] = g;
}
if (missing.length) fail(missing);

// ---------------------------------------------------- the no-spawn check (the DB) ---
function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c", sql], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
}
const pointSql = (lat, lng) => `st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography`;
// the zone types (water, military, ...) an active no_spawn_zones row puts each point in
function zonesAt(points) {
  const values = points.map((p, i) => `(${i}, ${p.lat}, ${p.lng})`).join(",");
  const out = psql(`select v.i, coalesce(string_agg(distinct z.zone_type, ','), '') from (values ${values}) v(i, lat, lng) left join public.no_spawn_zones z on z.active and st_intersects(z.geog, ${pointSql("v.lat", "v.lng")}) group by v.i order by v.i`);
  const res = points.map(() => "");
  for (const line of out.split("\n").filter(Boolean)) {
    const [i, t] = line.split("|");
    res[+i] = t;
  }
  return res;
}
// the nearest point outside every no-spawn zone (a public viewpoint): rings of 16 bearings, wider each time
function stepOut(p) {
  for (const r of [60, 120, 200, 300, 450, 650, 900, 1300]) {
    const cos = Math.cos((p.lat * Math.PI) / 180);
    const around = Array.from({ length: 16 }, (_, i) => ({ lat: p.lat + (r * Math.cos((i * Math.PI) / 8)) / 111320, lng: p.lng + (r * Math.sin((i * Math.PI) / 8)) / (111320 * cos) }))
      .filter((c) => inState(c.lat, c.lng));
    const zones = zonesAt(around);
    const i = zones.findIndex((z) => !z);
    if (i >= 0) return { ...around[i], metres: r };
  }
  return null;
}

if (!args["no-db"]) {
  const zones = zonesAt(ids.map((id) => geo[id]));
  for (const [i, id] of ids.entries()) {
    const g = geo[id];
    g.zone = zones[i];
    if (!g.zone) continue;
    const moved = stepOut(g);
    if (!moved) continue; // reported below
    g.note = `moved about ${moved.metres} m to a viewpoint outside the ${g.zone.split(",").join(" and ")} zone`;
    g.conf = lower(g.conf, "medium");
    g.lat = moved.lat;
    g.lng = moved.lng;
    g.zone = "";
  }
} else {
  log("WARNING: --no-db, so nothing was checked against water and the no-spawn zones");
}

// ---------------------------------------------------------------------- report ---
const tally = (f) => ids.reduce((m, id) => ((m[f(geo[id])] = (m[f(geo[id])] ?? 0) + 1), m), {});
function report() {
  log(`\ngeo by kind ${JSON.stringify(tally((g) => g.kind))}, by confidence ${JSON.stringify(tally((g) => g.conf))}`);
  log("\nid | kind | conf | lat, lng | found | note");
  for (const c of cards) {
    const g = geo[c.id];
    log(`${c.id} | ${g.kind} | ${g.conf} | ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} | ${g.found}${g.note ? " | " + g.note : ""}`);
  }
  const low = cards.filter((c) => geo[c.id].conf === "low");
  log(`\nlow confidence (${low.length}): ${low.map((c) => `${c.id} ${c.name}`).join("; ")}`);
}

// ----------------------------------------------------------------- checks, json ---
const bad = [];
for (const id of ids) {
  const g = geo[id];
  if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) bad.push(`${id}: no point`);
  else if (!inState(g.lat, g.lng)) bad.push(`${id}: ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} is outside Lagos State`);
  else if (g.zone) bad.push(`${id}: still inside a ${g.zone} zone`);
}
if (bad.length) {
  report();
  fail(bad);
}

const round = (n) => Math.round(n * 1e6) / 1e6;
const outCards = cards.map((c) => {
  const g = geo[c.id];
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === "art") {
      out.art = { type: v.type, licence: v.licence, credit: v.credit, format: "webp", front: `${URL_BASE}/front/${c.id}.webp`, back: `${URL_BASE}/back/${c.id}.webp`, thumb: `${URL_BASE}/thumb/${c.id}.webp`, width: v.width, height: v.height };
    } else {
      out[k] = v;
      if (k === "home_area") {
        out.lat = round(g.lat);
        out.lng = round(g.lng);
        out.geo_kind = g.kind;
        out.geo_confidence = g.conf;
        out.geo_source = g.source;
        if (g.note) out.geo_note = g.note;
      }
    }
  }
  return out;
});
const head = { ...manifest };
delete head.cards; // the cards go last, below the manifest
const doc = {
  ...head,
  image_format: "webp",
  image_size: { ...head.image_size, thumb: THUMB },
  rarity_counts: rarityCounts,
  geo: {
    kinds: { place: "the place itself", area: "centre of its set or home area, no single spot", citywide: "City-wide series, Lagos Island anchor, not a stampable spot" },
    confidence: { high: "named place found, or a small area at its centre", medium: "centre of a larger area, a looser name match, or a viewpoint moved out of a no-spawn zone", low: "place not found and its area centre stands in, or the area not found and a neighbour stands in" },
    counts: { kind: tally((g) => g.kind), confidence: tally((g) => g.conf) },
    credit: "Points (c) OpenStreetMap contributors, ODbL, found with Nominatim; Wikipedia coordinates where geo_source says so",
  },
  cards: outCards,
};
await mkdir(dirname(OUT_JSON), { recursive: true });
await writeFile(OUT_JSON, JSON.stringify(doc, null, 2) + "\n");

log(`\nwrote ${OUT_JSON.replace(ROOT + "/", "")}`);
report();
