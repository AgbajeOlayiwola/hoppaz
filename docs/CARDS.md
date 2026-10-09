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

**Supply.** 12-week season. At 1,000 Hoppers a day Epic runs about 290 a week: 4,000 copies last 14 weeks, 120 Legendary last 5, then fall a tier.

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

## Open question for Ola

Who cuts the WebP: a script or an edge function?
