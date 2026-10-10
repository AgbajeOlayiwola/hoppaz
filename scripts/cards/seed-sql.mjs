// ============================================================================
// Hoppaz: turn a card deck's JSON into a SQL seed
//
//   node scripts/cards/seed-sql.mjs [--in=src/data/cards/s1.json] [--out=supabase/cards_s1_seed.sql]
//
// <in> is what scripts/cards/import-s1.mjs wrote (the manifest and the cards, each with a
// point, a rarity, a copy cap and the paths of its three WebP files). The output is
// supabase/cards_s1_seed.sql: run it in the Supabase SQL editor after cards.sql and
// box_guards.sql (the zone check needs the zones). Safe to run again: sets and cards are
// upserted by key, a card's text, point, rarity, cap and art path follow the deck, and
// status, sign-off, weight and the copies issued are never touched, so a card staff
// retired stays retired and no copy number is reused.
//
// What it checks before it writes anything (it stops on the first failure): no card id
// twice; the rarity counts in the file match the cards; a capped rarity has a cap and
// Common has none; every card has a point inside Lagos State and the three image paths;
// no clearance flag is true and the art is Hoppaz original (docs/CARDS.md, the deck README).
//
// Radius (the Visited circle): place 150 m, a place moved out of a no-spawn zone to a public
// viewpoint 300 m, area 500 m, city-wide none (it stamps from anywhere in Lagos).
// Sets: one per set name; kind campus for the "Campus series" division, city for "City-wide",
// council for the rest.
// No dependencies, Node 18+.
// ============================================================================
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const inPath = resolve(ROOT, args.in || "src/data/cards/s1.json");
const outPath = resolve(ROOT, args.out || "supabase/cards_s1_seed.sql");

const RARITIES = ["common", "rare", "epic", "legendary"];
const GEO_KINDS = ["place", "area", "citywide"];
const CONFIDENCE = ["high", "medium", "low"];
// Lagos State, with room to spare: a point outside is a typo, not a place.
const BOX = { lat: [6.2, 6.95], lng: [2.65, 4.45] };

const fail = (msg) => {
  console.error(`seed-sql: ${msg}`);
  process.exit(1);
};

const deck = JSON.parse(await readFile(inPath, "utf8"));
const cards = deck.cards;
if (!Array.isArray(cards) || cards.length === 0) fail("no cards in the file");

const season = Number(String(deck.season ?? "").replace(/\D/g, ""));
if (!Number.isInteger(season) || season < 1) fail(`cannot read the season from "${deck.season}"`);

// ----------------------------------------------------------------- checks ---
const seen = new Set();
const counts = Object.fromEntries(RARITIES.map((r) => [r, 0]));
for (const c of cards) {
  if (!c.id || seen.has(c.id)) fail(`card id missing or repeated: ${c.id}`);
  seen.add(c.id);
  if (!RARITIES.includes(c.rarity)) fail(`${c.id}: unknown rarity ${c.rarity}`);
  counts[c.rarity] += 1;
  if ((c.rarity === "common") !== (c.copies_per_season == null)) fail(`${c.id}: Common has no cap, every other rarity has one`);
  if (c.numbered && c.copies_per_season == null) fail(`${c.id}: numbered but uncapped`);
  if (!GEO_KINDS.includes(c.geo_kind)) fail(`${c.id}: unknown geo_kind ${c.geo_kind}`);
  if (c.geo_confidence && !CONFIDENCE.includes(c.geo_confidence)) fail(`${c.id}: unknown geo_confidence ${c.geo_confidence}`);
  if (!(c.lat >= BOX.lat[0] && c.lat <= BOX.lat[1] && c.lng >= BOX.lng[0] && c.lng <= BOX.lng[1])) fail(`${c.id}: point is outside Lagos State`);
  for (const k of ["front", "back", "thumb"]) if (!c.art?.[k]) fail(`${c.id}: no ${k} image path`);
  if (c.art.type !== "hoppaz_original") fail(`${c.id}: art is not Hoppaz original`);
  if (Object.values(c.clearance ?? {}).some((v) => v === true)) fail(`${c.id}: a clearance flag is true`);
  if (!c.set || !c.division || !c.name) fail(`${c.id}: set, division and name are required`);
}
if (deck.rarity_counts) {
  for (const r of RARITIES) if ((deck.rarity_counts[r] ?? 0) !== counts[r]) fail(`rarity_counts says ${deck.rarity_counts[r]} ${r}, the cards say ${counts[r]}`);
}
if (deck.card_count != null && deck.card_count !== cards.length) fail(`card_count says ${deck.card_count}, the file holds ${cards.length}`);

// -------------------------------------------------------------------- sql ---
const q = (v) => (v == null || v === "" ? "null" : `'${String(v).replace(/\u0000/g, "").replace(/'/g, "''")}'`);
const num = (v) => (v == null ? "null" : String(Number(v)));
const bool = (v) => (v ? "true" : "false");
const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// A place that was moved to a public viewpoint outside a no-spawn zone gets the wider circle.
const radiusFor = (c) => {
  if (c.geo_kind === "citywide") return null;
  if (c.geo_kind === "area") return 500;
  return /moved .* viewpoint/i.test(c.geo_note ?? "") ? 300 : 150;
};

const sets = new Map();
for (const c of cards) {
  const key = slug(c.set);
  const kind = c.division === "Campus series" ? "campus" : c.division === "City-wide" ? "city" : "council";
  const prev = sets.get(key);
  if (prev && (prev.name !== c.set || prev.division !== c.division)) fail(`set key "${key}" is shared by "${prev.name}" and "${c.set}", or its division differs`);
  sets.set(key, { key, name: c.set, division: c.division, kind });
}
const setRows = [...sets.values()].sort((a, b) => a.key.localeCompare(b.key));
const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id));

const cardRow = (c) =>
  `(${[
    q(c.id), q(slug(c.set)), q(c.division), q(c.name), q(c.category), q(c.rarity), q(c.glyph), q(c.motif),
    q(c.known_for), q(c.lore), q(c.fact), q(c.source_title), q(c.source_url), q(c.question), q(c.home_area),
    num(c.lng), num(c.lat), q(c.geo_kind), q(c.geo_confidence), q(c.geo_source), q(c.geo_note), num(radiusFor(c)),
    num(c.copies_per_season), bool(c.numbered), q(c.art.front), q(c.art.back), q(c.art.thumb), q(c.art.credit),
  ].join(", ")})`;

const counted = RARITIES.map((r) => `${counts[r]} ${r}`).join(", ");
const out = `-- ============================================================================
-- Hoppaz: the cards of ${deck.deck ?? "the deck"}, season ${season}
-- Made by scripts/cards/seed-sql.mjs from ${inPath.startsWith(ROOT) ? inPath.slice(ROOT.length + 1) : inPath}. Do not edit by hand: change the deck and make it again.
-- Run in the Supabase SQL editor after cards.sql and box_guards.sql (the zone check needs
-- the zones). Safe to run again: sets and cards are upserted by key, the text, point,
-- rarity, cap and art paths follow the deck, and status, sign-off, pick weight and the copies
-- issued are never touched.
--
-- ${cards.length} cards (${counted}) in ${setRows.length} sets. Every card is Hoppaz original art with no
-- photograph. The deck has no Legendary: show no rarity the deck does not have.
-- Points (c) OpenStreetMap contributors, ODbL; Wikipedia coordinates where geo_source says so.
-- ============================================================================

begin;

insert into public.card_seasons (season, name, live)
values (${season}, ${q(`Season ${season}`)}, true)
on conflict (season) do nothing;

insert into public.card_sets (key, name, division, kind) values
${setRows.map((s) => `(${q(s.key)}, ${q(s.name)}, ${q(s.division)}, ${q(s.kind)})`).join(",\n")}
on conflict (key) do update set name = excluded.name, division = excluded.division, kind = excluded.kind;

insert into public.cards (key, season, set_id, division, name, category, rarity, glyph, motif, known_for, lore, fact, fact_source, fact_url, question, home_area,
                          geog, geo_kind, geo_confidence, geo_source, geo_note, radius_m, copies_total, numbered, front_path, back_path, thumb_path, art_credit,
                          status, signed_off)
select v.key, ${season}, s.id, v.division, v.name, v.category, v.rarity, v.glyph, v.motif, v.known_for, v.lore, v.fact, v.fact_source, v.fact_url, v.question, v.home_area,
       st_setsrid(st_makepoint(v.lng::double precision, v.lat::double precision), 4326)::geography, v.geo_kind, v.geo_confidence, v.geo_source, v.geo_note, v.radius_m::integer,
       v.copies_total::integer, v.numbered::boolean, v.front_path, v.back_path, v.thumb_path, v.art_credit,
       'live', true
from (values
${sorted.map(cardRow).join(",\n")}
) as v(key, set_key, division, name, category, rarity, glyph, motif, known_for, lore, fact, fact_source, fact_url, question, home_area,
       lng, lat, geo_kind, geo_confidence, geo_source, geo_note, radius_m, copies_total, numbered, front_path, back_path, thumb_path, art_credit)
join public.card_sets s on s.key = v.set_key
on conflict (key) do update set
  set_id = excluded.set_id, division = excluded.division, name = excluded.name, category = excluded.category, rarity = excluded.rarity,
  glyph = excluded.glyph, motif = excluded.motif, known_for = excluded.known_for, lore = excluded.lore, fact = excluded.fact,
  fact_source = excluded.fact_source, fact_url = excluded.fact_url, question = excluded.question, home_area = excluded.home_area,
  geog = excluded.geog, geo_kind = excluded.geo_kind, geo_confidence = excluded.geo_confidence, geo_source = excluded.geo_source,
  geo_note = excluded.geo_note, radius_m = excluded.radius_m, copies_total = excluded.copies_total, numbered = excluded.numbered,
  front_path = excluded.front_path, back_path = excluded.back_path, thumb_path = excluded.thumb_path, art_credit = excluded.art_credit;

commit;

select rarity, count(*) as cards, count(*) filter (where status = 'live') as live
from public.cards where season = ${season} group by rarity order by public.card_rank(rarity);
`;

await writeFile(outPath, out);
console.log(`seed-sql: wrote ${outPath.startsWith(ROOT) ? outPath.slice(ROOT.length + 1) : outPath} (${cards.length} cards, ${setRows.length} sets, ${counted})`);
