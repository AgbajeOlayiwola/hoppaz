# Cards: note for Ola

9 Oct 2026. For Ola and the front end. Jae's calls: `docs/DECISIONS.md`. Deck: `docs/Hoppaz-Game-Plan.md` sections 3, 4, 12. Cards are mainly places, Nomad List style: a card says what to see there, and standing at its point stamps it **Visited**.

## Decision and fields

`collectibles` has no tier, set, copies or point, and `drop_rewards`, hunt items and `collections` (event-bound `collectible_drops`) depend on it. So: new tables, plus one new `drop_rewards` type as glue.

Columns: the Game Plan's "every card carries" list plus `visit_tip`.

- Place: `geog`, `radius_m` (landmark 75 m, street 150, area 500, viewpoint 300). Copies a season: Legendary 10, Epic 100, Rare 1,000, Common null. A person card sits on a public place tied to them, never a home.
- Trigger `cards_guard_geog`, copied from `game_drops_guard_geog`, refuses a point in any active `no_spawn_zones` row. A landmark in one gets a public viewpoint point. `import-deck.mjs` checks too.

## Which boxes pay cards

`game_drops.card_max_tier` (null: no cards, as for small and welcome boxes). A trigger refuses it from `anon` and `authenticated`, so organisers cannot mint cards; only definer functions (Play's special box) and the service role set it.

- Special, staff: legendary. Event: legendary, only for staff-approved, venue-verified events (Play phase 8), `event_card_cap` each.
- Spot (avatar): rare, and only once `is_verified()` exists (Play phase 6; `has_account()` takes any email).

## How a box picks a card

1. **Tier.** A card prize is a `drop_rewards` row (type `card`, `card_tier`, XP 10, 25, 60, 150). The special box holds four rows, weights 84, 13, 2.7, 0.3 (existing picker), replacing "tier fixed by kind" in `docs/PLAY-MODE.md` sections 1 and 3. Golden Box: Epic 97, Legendary 3, XP stays 150. A spot box writes 10 rows at spawn, tiers drawn 87 Common to 13 Rare ("all different" means cards).
2. **Pity.** `card_pity` counts card claims since a Rare and an Epic. At 9 and 59 the grant lifts to that tier, within the box cap, XP topped up. Rare or better zeroes `since_rare`; Epic or better zeroes both. Replaces "no pity timer" there.
3. **Bucket.** Distance from box point to `cards.geog`: under 3 km 30%, 3 to 8 km 30%, rest 40%. Empty buckets pass their share on (Epic and Legendary act city-wide); no box point means far. Staff tune shares (`far_min` 15%). **Jae to OK:** this replaces "home area 3x", which gives a Yaba box only 6% Yaba cards (3 Commons a council). Add a row to `docs/DECISIONS.md`.
4. **Card.** Live (signed off, not on hold) cards of the tier in the bucket, by `weight`, halved if owned, none this drop already gave.
5. **Sold out.** Capped tiers bump `copies_issued` only below `copies_total`; no row means re-pick. Tier empty: one tier down, then XP only.
6. **Copy.** Insert `card_copies` and the `album` row. Only capped tiers get `copy_no` ("7 of 10") and a counter write; copy 1 is the first finder forever. Duplicates count, pay nothing.

**Supply.** 12-week season. At 1,000 Hoppers a day Epic runs about 290 a week: 4,000 copies last 14 weeks, 120 Legendary last 5, then fall a tier. That was for a full deck. Season 1 has 2 Epics and no Legendary: see "Season 1 on the odds" below.

## Visited

`stamp_visit` (below): hold a copy; GPS inside `radius_m` plus accuracy (cap 30 m).

- **Today:** `claim_game_drop`'s advisory lock (key `hashtextextended('claim:'||uid,0)`) and 50 m/s from your last `drop_claims` position; `play.sql` adds `play_fix.at`, so require a fix under 2 minutes old. **Later in Play:** 25 m/s, accuracy cap.
- A walked box auto-stamps its card (no extra XP) if the claim's lat and lng are in the radius. Avatar claims have none.
- First stamp pays `visit_xp` (propose 30): once per card, if `radius_m` is 150 or less, 3 a play-day, nothing within 300 m of a card stamped today.
- A paid stamp counts as an outside day, like the special box. `game_score_rules` row `card_visit` = 0: streak yes, board no.
- **Privacy.** `album.visited_on` is a play-day date: no coordinates, no times, owner-only. Public: set title and counts. Shares carry no date or time. Privacy page: "we keep which places you stamped, by day, only for you."

## Card box and sets

- The album shows sets, copies, stamps and a new-art dot (`album.seen_art_version < cards.art_version`; tap shows old art, new art and credit; `my_card(card, true)` clears it). A first card in a set adds up to 2 Common starters. The map lights up in the client from static GeoJSON or a pin per set.
- Sets: 57 councils plus city-wide. Complete = every live Common and Rare in the set; Epic and Legendary are optional (copies run out). Titles never expire.
- Completion pays 500 XP, `award_badge('set:'||key)` (insert its `badge_catalog` row with the set; badges are public by design), the title ("Yaba Local") and a `set_completions` row, `completion_no` from `card_sets.completions` bumped in the same statement. The foil is drawn from that row, not a copy.

## Wanted: your shot (phase B, after A ships)

**On hold (10 Oct 2026).** Nothing here is built, and Season 1 ships without it: the deck README forbids a photograph on these cards ("the moment one goes on, the card stops being clean"), and every Season 1 card is Hoppaz original art (`art_kind` `owned`, no credit). So there is no ribbon, no `card_shots` table, no art credit and no `art_version` bump in this build. A winning Hopper photo would make that card a different, non-clean card: Jae's call, and a new row in `DECISIONS.md`, before anyone builds it.

Ribbon only if `art_kind` is map or generated, `radius_m` is 150 or less, `person` and `sensitive` are false.

- **Submit.** App camera only, re-encoded by `shrink()` (strips EXIF). You hold the card, stand inside `radius_m`, are verified; one shot per card per week, 3 open. Store `terms_version`, `consent_at`. Credit is opt-in. No identifiable faces of living people. Camera-only is UX; the real checks are the file hash and staff.
- **Storage, review.** Private `card-shots`, path `<uid>/<file_key>.jpg`, policies as `event-photos`; tables hold `file_key` only, a route signs URLs. Shots start `pending` in the admin queue; `report()` gets a `card_shot` branch.
- **Likes** run a Lagos week (`week_key`). Holders of the card only, not your own shot. A hint beside account age in admin.
- **Winner.** Staff confirm the top shot after a reverse-image check; one paid win per user per week. A 4 to 10 KB WebP goes to public `card-art/<card>/v2.webp`. It sets `art_path`, `art_kind 'photo'` (contest closed; reopen once a season), `art_credit`, `art_version + 1`. The photographer gets a foil copy and 150 XP (propose).
- **Credit.** `art_credit` is snapshot text on the card back and album footer: a handle (opt-in), "a Hopper", or the licence line ("© OpenStreetMap contributors" for map art). Never a date or time. Account deletion nulls `user_id` and resets it to "a Hopper".

## What Ola adds

`pk` = uuid primary key; `->t` = references t, cascade unless noted; `a|b|c` = check in.

```sql
card_sets (id pk, key unique, name, title, kind council|city|campus, live bool, completions int)
cards (id pk, key unique, set_id ->card_sets, person bool, name, fact, fact_source,
  lore, known_for, question, visit_tip, tier common|rare|epic|legendary, tier_reason, founders_call bool,
  geog geography(point), radius_m int 25..500, weight numeric, copies_total int, copies_issued int,
  art_kind map|generated|photo|owned, art_path, art_version int, art_credit,
  status draft|live|retired, signed_off bool, sensitive bool, campaign_hold bool,
  check (status <> 'live' or signed_off), check ((tier = 'common') = (copies_total is null)))  -- gist on geog
card_copies (id pk, card_id ->cards, user_id ->profiles, copy_no int, foil_no int, drop_id ->game_drops set null)  -- unique (card_id,copy_no) and (card_id,foil_no), where set
album (user_id ->profiles, card_id ->cards, visited_on date, xp_paid bool, seen_art_version int, pk (user_id,card_id))
card_pity (user_id pk ->profiles, since_rare int, since_epic int)
set_completions (user_id ->profiles, set_id ->card_sets, completion_no int, unique (user_id,set_id), unique (set_id,completion_no))
card_shots (id pk, card_id ->cards, user_id ->profiles set null, file_key uuid unique, file_hash unique, credit_as handle|hopper,
  week_key, terms_version, consent_at timestamptz, status pending|approved|rejected|won, unique (card_id,user_id,week_key))
card_shot_likes (shot_id ->card_shots, user_id ->profiles, pk (shot_id,user_id))
card_rules (key pk, value jsonb)  -- shares, odds, XP, caps
drop_rewards.card_tier text  -- 'card' joins the reward_type check
game_drops.card_max_tier text

drop_claims_grant_card()  after-insert trigger on drop_claims, calls grant_card
grant_card(user uuid, drop uuid, reward uuid) returns void  -- service role
stamp_visit(card uuid, lat, lng, accuracy float8) returns jsonb  -- {ok, reason, xp, outside}
my_album(), my_card(card uuid, seen bool default false) returns jsonb
submit_card_shot(card uuid, lat, lng, accuracy float8, file_key uuid, hash, credit_as, terms text) returns jsonb  -- {ok, reason}
like_card_shot(shot uuid, on bool) returns jsonb  -- {ok, likes}
card_shots_for(card uuid) returns jsonb  -- anon too
admin_confirm_card_shot(shot uuid, rights_checked bool) returns jsonb  -- service role
```

The trigger runs inside the claim: `claim_game_drop` needs no edit, and neither Play's rewrite nor a schema.sql re-run undoes it. It grants only if `card_max_tier` is set, clamping the tier to it. Box point: `coalesce(d.geog, events.geog)`.

**Lock down.** Functions: `security definer set search_path = public, extensions`; revoke from `public, anon, authenticated`; grant `service_role` (`grant_card`, `admin_*`, triggers) or `authenticated` (the rest). Tables: revoke from `anon, authenticated`; `select` only as below; `for insert with check (false)`.

- Owner-only select: `card_copies`, `album`, `card_pity`, `set_completions`, `card_shots`, `card_shot_likes`.
- Public: view `cards_public` (live, signed off, no `weight` or counters) and live `card_sets`.
- No Hopper uuid reaches a client through cards, shots, credits or foils; this does not wait for Play's profile lockdown.

**Edits to existing code**

- `spawn_boxes`: add `card_tier` to its fixed-column reward insert, and allow type `card` in its filter.
- `/api/admin/game/route.ts` and `SpawnerSection.tsx` accept only xp, badge, collectible. Add `card`.
- Widen checks with the DO-block in `daily_box.sql`, never a bare drop and add: `activity_log.action` + `card_visit`; `reports.kind` + `card_shot`, Play's `spot`, `vibe`.

## What the front end does

- `src/components/cards/CardFace.tsx`: all drawn in code ("7 of 10" too) except the art window (map art plus the Wanted ribbon until a shot wins). The back adds the question, tip, credit and events within 1.5 km (`events_near`).
- `src/components/reveal/Reveal.tsx`: a card step after the XP, read from `card_copies` by `drop_id`. `/collection` Cards tab: sets, card page (I'M HERE, shots, camera).
- `src/components/admin/CardsSection.tsx`: shot queue, winner. Scripts: `import-deck.mjs`, `make-map-art.mjs`.

Not in v1: trading and gifting (alts could funnel cards), Gist, foils fusing, Card of the Day, Season 2 reprints.

## As built (10 Oct 2026)

`supabase/cards.sql` (after `play.sql`), `supabase/cards_s1_seed.sql` (made by `scripts/cards/seed-sql.mjs` from `src/data/cards/s1.json`), `supabase/tests/cards_test.sql`. Built for Ola's review; where it differs from "What Ola adds":

| Plan | Built | Why |
|---|---|---|
| `card_copies` | `user_cards` (one row per copy; `copy_no` for capped cards, `got_on` a play-day date, `drop_id`, `source`) | the task's name; no time kept |
| `album` | `card_visits (user_id, card_id, visited_on, xp_paid)` | only the Visited part; no art-version dot yet |
| `cards.copies_issued`, `weight` | table `card_stock (card_id, weight, copies_issued)`, service role only | the catalogue stays public by RLS with no counters or weights in it, so no `cards_public` view |
| `cards.tier` | `cards.rarity`; boxes keep `drop_rewards.card_tier` and `game_drops.card_max_tier` | the deck says rarity |
| `cards.art_path` | `front_path`, `back_path`, `thumb_path` | three WebP files per card |
| `card_sets (kind, live, completions)` | `card_sets (key, name, division, kind)` and `card_seasons (season, live)` | set completion is not built; a season is live or not |
| after-insert trigger on `drop_claims` | `claim_game_drop` and `open_daily_box` call `grant_card()` | the claim answers with the card, and the top-up XP is paid in the same call; one extra line in each |
| `stamp_visit`, `my_album`, `my_card` | `visit_card`, `my_collection`, `card_catalog` | the task's names; a card's detail is a read of `cards` by key (RLS) or the owned entry in `my_collection` |
| `cards_guard_geog`, `card_max_tier` guard | same | copied as planned |

Rules staff tune live in `card_rules` (never overwritten by a re-run): `tier_xp`, `odds` (special, golden, spot), `flat_xp`, `distance_mix`, `pick`, `pity`, `visit`, `daily_box`.

Calls the app makes (all RPC with the signed-in session): `card_catalog()`, `my_collection()`, `visit_card(p_card, p_lat, p_lng, p_accuracy)`, and the `card` key of `claim_game_drop` and `open_daily_box`. Staff and the special-box code call `add_card_prizes(drop, 'special' | 'golden' | 'spot')` to write a box's prize rows and cap (service role).

Choices the plan left open, for Jae and Ola to OK:

- **The 40% bucket is "the rest"** (beyond 8 km), as in "How a box picks a card" step 3, so the near bucket is exactly 30%. If "from anywhere" should mean the whole deck, the third bucket becomes the whole pool and the near share rises to about 30% plus 40% of the deck's near fraction.
- **The Visited heartbeat check applies inside Play's box only** (lat 6.30 to 6.80, lng 3.05 to 3.95). Season 1 has cards in Badagry, Seme and Apa (west of it) and Epe (east); there `play_tick` refuses, so no heartbeat exists and none is asked for. Widening Play's box makes the check apply there too. **Since the review (10 Oct), only a stamp the heartbeat backed pays XP**: outside Play's box a stamp is free (`xp_skipped` `unverified`, no outside day), so a card in Badagry or Epe stamps for the memory.
- **City-wide cards** (the Music series) stamp from anywhere in Lagos State, as the task asked, and pay no XP. To refuse them instead, set `card_rules` `visit` `citywide` to `"refuse"` (the answer is `not_stampable`).
- **Today's box on Me pays XP only** until `card_rules` `daily_box` is set (a guest could otherwise farm cards with throwaway sessions).
- **A card prize row is titled "Card"**, not "Epic card" (the receipt text reaches clients through `my_drop_claims` and `claim_game_drop`, and the card that lands can be another tier than the row). Rows written before the change are renamed when `cards.sql` runs. Screens leave a card prize's receipt out of the rewards (`isCardPrize` in `src/lib/cards.ts`: "Card", or the old "Epic card"); it must stay in `my_drop_claims`, because the event cards use the receipts to know which drops you opened.
- **A card below its prize tier pays its own tier's XP** (a Legendary row that rolled down to Epic pays 60, not 150; an Epic row that fell to a Rare pays 25), never more than the row. A box whose card rows all pay one flat XP (the Golden Box, `flat_xp`) keeps it. Jae to OK: the rule is the one `case` in `grant_card` ("when final < base and not flat"), delete that line to go back to paying the row.
- **A spot box is capped at Rare** whatever its ten rows came out as (the cap is the top tier the odds can pay), so the Rare guarantee can lift an all-Common spot box. It used to follow the rows, which left a quarter of spot boxes Common-only.
- **Not built:** set completion, Wanted: your shot (on hold, see above), the new-art dot, the `spawn_boxes` card filter and `/api/admin/game` card type (Phase 4 and the admin work; `add_card_prizes` is the interim path for staff boxes).

## Front end: cards in the game (10 Oct 2026)

Built on `src/lib/cards.ts` (the shapes, `toWonCard`, `stampCard`, `useCards`) and the deck's own WebP art. Nothing here draws a card in code: the front, back and thumb already carry the name and rarity.

- **The open moment** (`src/components/play/open`). `ClaimOk` has `card` (a `WonCard`: the card plus `copyNo`, `isNew`, `lifted`, `visited`). A box that pays a card is celebrated at the **card's rarity**, whatever colour the crate was: the burst, the tier drum and the turn-up follow the card (a Golden crate that pays an Epic card plays the Epic). Every card, Common too, comes up face up (flip, `cardUp` buzz) and is tapped onto the Shelf. A first copy gets a NEW tag; a numbered card (Epic) says "No. 7 of 100"; a Rare says nothing of its number; a repeat says "Another copy"; a guarantee says "Guaranteed rare". A walked box that stamped it on the spot shows VISITED with the stamp sound.
- **Stamp it** shows under the card only when a fresh reading puts the Hopper inside its circle (`canStampHere`). It calls `stampCard`: `visit_card` with the position, and when the answer is `location_stale` one `play_tick` with the same reading and a second try. Plays `sfx.stamp` and the small buzz, adds the XP to the profile in memory. The position is used for those calls only and is stored nowhere. With Stamp it showing, the card waits 20 s instead of 6.5 s to be kept.
- **The four-box reveal** (`Reveal.tsx`): `RevealItem` has kind `"card"`; the card comes out face up with NEW and its number. Welcome boxes pay no card (Play, section 13), so this is for the Golden Box (Phase 3) and Today's box when staff switch cards on (`card_rules` `daily_box`): `useDailyBox.open` passes `card` through and Me shows it in the reveal.
- **Me** (`ShelfStrip.tsx`): your newest 12 cards lead the strip (the deck's thumbnails, a stamped one carries the Visited stamp; a tap opens the card sheet), then the hunt items, collectibles and rewards. A line under it: "CARDS 12 OF 125 · 3 VISITED". A card prize's claim receipt ("Card", or the old "Epic card") is not shown as a second tile, nor on the Shelf tab.
- **Dev:** `/dev/open` has a button per case (stand-in cards, "near it", the four-box with a card). `?real=<drop id>&at=lat,lng&walk` adds "Real box": it claims that box through `claim_game_drop` with the signed-in session and walks onto the card. `scripts/cards/check-open.mjs` runs the lot headless and restores what it touches.

## Front end: card face and Collection (10 Oct 2026)

- **`CardFace`** (`src/components/cards/CardFace.tsx`): one card from a `DeckCard`. `mode="tile"` is the 180x288 thumb, still (the album grid and the Me strip). `mode="full"` is the 720x1152 front; tap flips it to the back in 3D with `sfx.flip` and the small buzz. Over the deck's art, in code: the rarity edge (Rare violet glow, Epic pink glow that breathes), "NO. 7 OF 100" on a numbered card (small on the front, the big number on the back's empty top), the Visited stamp (`VisitedStamp.tsx`: struck in with the 180 ms stamp when `stampIn`, the day round the rim) and "x2" on a tile. `locked` is a dark silhouette drawn in code: no image is loaded, rarity pips, the rarity word and the copies line. Images are lazy and the back waits for the front. Reduced motion: the flip is a fade and the Epic glow holds still. A tile is spans only, so it can sit in a button.
- **`CardSheet`** (`CardSheet.tsx`): the card you can flip, its set and rarity, the name, what it is known for, Visited or "Go here to stamp it", the lore, the fact with its source link, the question for the back ("Talk about it"), home area and your count of the set. Not yet stamped: with location allowed it shows "2.4 km away" worked out on the phone from the live reading (nothing is sent), "You are here" and I'M HERE inside the circle (radius plus accuracy up to 30 m, the server's rule), which calls `stampCard`. With location not yet allowed it offers SHOW HOW FAR, which is what asks. A city-wide card says "Stamp it from anywhere". OPEN IN MAPS sends the card's point (never yours). A card you do not hold shows the silhouette, "Not found yet", its set and division and its copies, no name.
- **Collection** (`src/app/collection/page.tsx`, `CardsTab.tsx`): tabs CARDS and SHELF (the old shelf: camera hunt, collectibles, claimed rewards; `/collection?tab=shelf` opens it, and the links from Me and the drops pages go there). Cards: "12 of 125", copies and Visited, filter chips for division and rarity (only the deck's rarities: none for Legendary) and "I have", then every division with its count, every set with its count, cards in tiles best rarity first. Counts on headings are the whole set's, not the filtered view's.
- **Locked names** are hidden, following the Game Plan's locked silhouette slot. One switch, `SHOW_LOCKED_NAMES` in `src/lib/deck.ts`, draws every name instead. `deck.ts` also holds `card_catalog()` (read once a page load), `useDeck`, the rarity look and the distance maths.
- **Check:** `scripts/cards/check-collection.mjs` (headless, 390x844, signed in as the E2E C test Hopper with `scripts/cards/give-test-cards.sql`): the counts, silhouettes, filters, both sheets, the flip and its sound, the stamp with a faked position at a public landmark, reduced motion, the shelf tab and the day theme. It waits for any other headless Chrome to finish first.

## Season 1: the import and the geotags (10 Oct 2026)

Jae's push set (`scratch-in/push`; its README is binding): `data/cards.json` is the source of truth. 125 cards (94 Common, 29 Rare, 2 Epic, 0 Legendary) in 48 sets (46 councils, 1 campus series, 1 city-wide). The 162 cards in `data/HOLDBACK.csv` are not in the repo, the seed or `public/cards`. All art is Hoppaz original: no licence, no credit, no photograph.

- `scripts/cards/import-s1.mjs --deck=<push folder>` checks the deck against those rules, cuts `public/cards/s1/front|back|thumb/<ID>.webp` (front 720x1152 lossy, back lossless, thumb 180x288) and `thumb/<ID>-2x.webp` (360x576, for 3x phones: the app's `srcset`), geotags every card and writes `src/data/cards/s1.json`. `--thumbs-only` redoes just the two thumbs.
- `scripts/cards/seed-sql.mjs` turns that file into `supabase/cards_s1_seed.sql` (a second run is byte-identical). Load order: `play.sql`, `cards.sql`, `cards_s1_seed.sql`.
- **Images** are served with `Cache-Control: public, max-age=31536000, immutable` (`next.config.ts`), because every URL the app builds carries `?v=<art_version>`. **To change an image, bump `cards.art_version` for that card** (the seed does not touch it), or phones that have the old one keep it for a year.
- **The geotags** (docs above: every card is tagged to a location). 31 place cards: 20 high confidence (found by name), 11 medium, 3 of them moved to a public viewpoint within 300 m because the landmark sits in a no-spawn zone (ETO-IKY-03, IKD-IGB-06, IKD-IJD-01). 92 area cards (history, culture, food or lore with no single spot): the centre of their set or home area, circle 500 m; 27 high, 32 medium and 33 low, where the area itself was not found and a neighbour stands in. 2 city-wide cards (the Music series): the Lagos Island anchor, stamped from anywhere in Lagos State, no XP. 122 points come from OpenStreetMap (ODbL, the credit line is in the importer header) and 3 from Wikipedia. Every point is inside Lagos State and outside every no-spawn zone, water included.
- **The 33 low-confidence area points to check by hand:** AGE-03, AJR-01, AJR-IFE-02, ALI-EGB-01, ALI-MOS-01, EPE-ERE-02, EPE-IKO-01, IBL-03, IBL-LEK-01, IFK-02, IKD-IGB-04, IKD-IGB-05, IKD-IJD-04, IKD-IJD-07, IKD-IKO-17, IKD-IMO-08, IKD-NTH-01, IKD-NTH-04, IKD-NTH-05, IKD-WST-01, IKD-WST-04, IKD-WST-05, IKJ-OJD-02, LIS-EAS-01, LIS-EAS-02, MSH-ODI-01, OJO-OTO-01, OSH-EJI-01, SHO-BAR-02, SUR-COK-02, UNI-07, UNI-09, YAB-04. To fix one, edit its entry in the PLAN or AREAS table at the top of `import-s1.mjs` and run it again.
- The deck's own front art prints a four-dot rarity strip in its corner. That is the deck's drawing, not ours (the silhouettes in the app draw three), so a fourth tier is hinted at on every card face. Not ours to change without a new push from Jae.

## Season 1 on the odds: two Epics, no Legendary

- **The roll-down.** The special box keeps its four prize rows (84, 13, 2.7, 0.3). With no Legendary card, the 0.3 row finds none and rolls one tier down to Epic, so Epic is 3.0% of special-box claims (measured 3,000 claims: 2,510 Common, 407 Rare, 83 Epic). The Golden Box (Epic 97, Legendary 3) is an Epic every time while there is one, at the flat 150 XP. The app shows only the three rarities the deck has (`card_catalog().tiers`): no Legendary chip, three pips on a silhouette.
- **Epic is scarce.** YAB-01 and YAB-03, 100 copies each: 200 in all. At 3.0% of special-box claims that is about 6,700 claims, then an Epic row falls to Rare (29 Rares at 1,000 each) and a Golden Box pays a Rare at 150 XP. Add Epic cards before launch if the plan is a 12-week season.
- **The Epic guarantee with none left.** The 60th claim since an Epic is owed one; when none is left, the claim falls back to its prize tier (a Rare only if a Rare is owed too, at the 10th). It used to step down to Rare on every claim after the 60th. `cards_test.sql` covers it (`cccccccccrcc`: nine Commons, the Rare on the 10th).
- **Rare** is guaranteed by the 10th card claim, Epic by the 60th, per Hopper, within the box's cap.

## Review fixes (10 Oct 2026)

Rules-safety and phone UX reviews of the cards work, all fixed in this build:

- **Back end** (`cards.sql`, tests in `cards_test.sql`): the sold-out Epic guarantee above; prize rows titled "Card"; a rolled-down row pays its own tier's XP; a spot box's cap; a paid stamp's `activity_log` row is dated to the start of the play-day (06:00 Lagos), not to the minute (the streak needs only the day); only a heartbeat-backed stamp pays XP.
- **Front end:** the Shelf tab and strip leave card receipts out (`isCardPrize`); a failed `my_collection` shows "Could not load the deck" with TRY AGAIN, never "0 of 125" (`readShelf`, `useCards.failed`); a second card starts on its front (`key` on `CardSheet`); the shared `Sheet` keeps its handle and Close at the top while it scrolls (`sticky`, and its top spacing moved into that header); the sheet's card shrinks on a short screen and a NOT STAMPED or VISITED pill sits with the rarity pill; Rare words use the theme's readable violet (`RARITY_LOOK.text` and `.onDark`), borders keep #5B2EFF; the silhouette draws one pip per rarity the deck has; the 360 px thumb in a `srcset`, and the name under an owned tile; the Me strip has room for the Rare and Epic glow; the number on a card's front is 3.6cqw; Stamp it is 44 px tall with 11 px type, and the chips and notes keep 10 px, in the open moment.
- **Copy.** The old line "Your position stays on your phone" was only true until you pressed I'M HERE. Now: "Tap to see how far you are. Nothing is sent until you stamp it." and, beside I'M HERE, "I'M HERE sends your position once, to check you are at the card. We keep only the day."
- **Checks:** `check-collection.mjs` (56) and `check-open.mjs` (33) cover the new behaviour, including the failed-call retry, the 360x640 sheet and Stamp it's size.

## Known limits, and changes other owners still need to make

1. **The heartbeat has no speed rule yet (Play's phase, `play_tick_for`).** `visit_card` checks speed against a heartbeat the same client wrote, so a client can send a heartbeat at a card's point right after one far away and then stamp. Bounded: 3 paid stamps and 90 XP a play-day, and you must hold the card; free stamps are unlimited. Until Play ships "speed rule v2", do not pay set completion on Visited stamps alone. The planned rule, for `play_tick_for` in `play.sql` just after the `too_soon` check (a refused tick leaves the old fix, so a GPS glitch is ignored and a real jump clears itself as time passes):
   ```sql
   if had_fix and greatest(st_distance(st_point(fx.lng, fx.lat)::geography, st_point(p_lng, p_lat)::geography) - 300, 0)
        / greatest(extract(epoch from now() - fx.at), 1) > 50 then
     return jsonb_build_object('ok', false, 'reason', 'too_fast');
   end if;
   ```
   It breaks two cases in `play_test.sql` that move 2.2 km in 20 seconds (step `age_fix` back 60 s there), and `usePlayTick.ts` should treat `too_fast` like `too_soon` (keep what is on the map). It was not made here because it changes Play's behaviour and its tests.
2. **Privacy page** (`src/app/privacy/page.tsx`, the Hotspots owner's file): add a section. "Cards. When you press I'M HERE, your phone sends your position once to check you are at the card. Hoppaz keeps only the day you stamped it and whether it paid XP, only for you. If Play was not open, that press also sends the usual Play location update."
3. **Admin** (`src/app/api/admin/game/route.ts`, `SpawnerSection.tsx`): cards are not creatable there yet. The small change: when a reward of type `card` is chosen, insert no `drop_rewards` row; after the drop insert call `sb.rpc("add_card_prizes", { p_drop: drop.id, p_odds: "special" })` (or `"golden"`, `"spot"`). It is service role only, writes the prize rows and sets `card_max_tier`. `spawn_boxes` needs the same for waves.
4. **`PlayLayer.tsx` and `Tray.tsx`: nothing more.** `PlayLayer` already forwards `card: toWonCard(r.card)` and bumps the Shelf count on a new card; `Tray` only shows the number.

## Open question for Ola

Who cuts the WebP: a script or an edge function?
