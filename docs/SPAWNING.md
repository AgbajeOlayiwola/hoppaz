# Street box spawning

For Ola and Jae. This is how boxes now appear on their own on the Lagos map, how to
switch it on for the real database, and how to keep it running.

## What it is

Until now every box on the map was set up by hand in the admin desk. Street boxes
are the Pokemon GO version. The database drops a few boxes at real, safe spots
around Lagos on a schedule. Everyone nearby sees the same box. Only the first few
people to reach it can open it. Then it is gone.

A street box is an ordinary `game_drops` row (`kind = 'spawn'`). The map, the open
flow, the rewards and the XP all work as they did. The new parts are the spots, the
schedule and a few extra checks when a box is claimed.

| Kind | Who sees it | Made by | Lives for |
|---|---|---|---|
| `staff` | everyone | the admin desk, as before | whatever staff set |
| `spawn` | everyone | `spawn_boxes()`, every 5 minutes | 30 minutes by default |
| `welcome` | its owner only | `spawn_welcome_boxes()`, once per Hopper | 24 hours |

## The rules

| Rule | What it means |
|---|---|
| Spawn points | Boxes only appear at a known list of public spots: parks, beaches, landmarks, markets, run routes, bus stops, fuel stations, and venues from live events. They are in `spawn_points`. |
| No-spawn zones | Some places never get a box: the Atlantic, the lagoon, creeks and the harbour, military land, the airport, prisons, ports, power plants, landfills, gated estates. They are in `no_spawn_zones`. A spot inside an active zone is never used, and neither is a welcome box position. |
| No box in the water | The database itself refuses a box whose point is in the sea, the lagoon, a creek or any other water zone, from any source: the spawner, a welcome box, a drop made in the admin desk, a script. A street or welcome box is also refused inside any other blocked area. See "No box in the water" below. |
| Night safe | Between 21:00 and 06:00 Lagos time, a rule can only use spots marked `night_safe`. Today that means fuel stations and venues. Parks, beaches and bus stops are day only. |
| One wave at a time | A rule drops `boxes_per_wave` boxes each time it is due. Two boxes in one wave are at least 300 m apart. No box is placed within 50 m of another live street or welcome box. |
| First N | Each box has `max_claims`. The first N people to open it get a reward. After that it is sold out and disappears from the map. |
| Lifetime | A box closes `lifetime_minutes` after it is made, sold out or not. |
| Spot rest | A spot is not used again until its last box has run its lifetime. |
| Rewards | A rule has a list of rewards with weights. Each person who opens a box gets one, drawn by weight (random) or the first in the list (fixed). Types: `xp`, `badge`, `collectible`. |
| Radius | You must be within `radius_m` of the box to open it. Default 80 m. |
| Lagos time | All times in a rule are Lagos time (UTC+1, no daylight saving). Days are ISO weekdays: 1 is Monday, 7 is Sunday. |

A rule whose window crosses midnight uses the weekday it starts on. A 21:00 to 02:00
rule set to Friday also runs Saturday 00:00 to 02:00.

### Welcome boxes

Every Hopper gets 3 personal boxes the first time the app has their GPS location, in
Lagos. A picked area does not count: it is the middle of the area, not where the
Hopper is, and the one-time grant would be spent on a guess. The call waits until
they share their location. They are worth 250 XP in total by day (50, 50 and 150).

| When | Where | Reward |
|---|---|---|
| Day (06:00 to 21:00) | 2 boxes at spots 120 to 450 m away, 1 at a spot 600 to 1500 m away. Radius 60 m. | 50 XP, 50 XP, 150 XP ("Worth the walk") |
| Night (21:00 to 06:00) | 3 boxes 15 to 45 m from the Hopper. Radius 80 m. | 50 XP each |

They last 24 hours and can only be opened once. If no spot fits, the box is placed
at an offset from the Hopper, turning the direction until it clears every no-spawn
zone. That is what keeps a box out of the sea or the lagoon for a Hopper on the
waterfront: the water is a zone. If even that finds nothing clear (the Hopper stands
inside a zone, say on a bridge over the lagoon), no boxes are made and nothing is left
behind: the call answers `no_clear_spot`. The app asks again when the location changes,
and from a clear place the Hopper still gets all three. Outside Lagos the call does
nothing and tries again if the location changes.

A daytime welcome box can sit at a spot that is not night safe (a bus stop, a market)
and stays open for its 24 hours, so it can still be opened after 21:00. The night rule
only applies to shared street boxes. To close that gap, set `closes_at` of day-made
welcome boxes to the next 21:00 Lagos; it is a product call, so it is not done.

Everyone gets them once, including Hoppers who signed up before this shipped.

**Why they are owner-only.** A welcome box sits close to where the Hopper was when
they first opened the app. That is often home. If everyone could see it, the map
would show where people live. So the read policy on `game_drops` hides any row with
an `owner_id` from everyone but its owner, and `claim_game_drop` answers `not_yours`
to anyone else. Do not loosen the policy.

## Files

| File | What it is |
|---|---|
| `supabase/spawning.sql` | Tables, columns, policy, the spawner, welcome boxes, the new `claim_game_drop`, the pg_cron job. Safe to run again. |
| `supabase/spawn_points_lagos.sql` | The Lagos spots and zones from OpenStreetMap (623 spots, 119 zones when it was made, 58 of them water), plus venue spots from live events. Made by the script below. Safe to run again. |
| `scripts/spawn-points/import-osm.mjs` | Makes `spawn_points_lagos.sql`. Node 18 or newer, no packages. |
| `supabase/box_guards.sql` | The water guard: `no_spawn_zones.zone_type`, the trigger that refuses a box in the water, and the 40 m rule for spawn spots. Runs after `spawn_points_lagos.sql`. Safe to run again. |
| `supabase/tests/spawning_test.sql` | Test suite for a local database. Rolls back, keeps nothing. |
| `supabase/tests/box_guards_test.sql` | Tests for the water guard, on the real Lagos data and on zones of its own. Rolls back, keeps nothing. |
| `src/components/admin/SpawnerSection.tsx` | The staff controls on `/admin`. |
| `src/app/api/admin/game/route.ts` | Admin API: reads the spawner, plus the actions `save_spawn_rule`, `toggle_spawn_rule`, `spawn_now`, `add_spawn_point`, `toggle_spawn_point`, `add_no_spawn_zone`, `toggle_no_spawn_zone`, `end_box`. |
| `src/lib/game.ts` | `useGameDrops()` reads boxes, refreshes every 60 seconds (a failed refresh keeps the boxes already on the map), re-reads at once when a claim finds a box sold out or closed, and has friendly copy for the new claim errors. With `{ staffOnly: true }` it lists desk drops only, which is what `/drops` and Me use. |
| `src/lib/useWelcomeBoxes.ts` | Asks for welcome boxes once, and only for a GPS fix. |
| `src/app/page.tsx`, `src/components/map/NightMap.tsx`, `src/components/reveal/BoxSheet.tsx`, `src/components/me/dropTime.ts` | Street pins ("3 LEFT"), welcome pins ("YOURS"), the box sheet text, and the toasts. |

The tables `spawn_points`, `no_spawn_zones` and `spawn_rules` have RLS on and no
policies, and no access for `anon` or `authenticated`. Only the service role and
`postgres` can touch them. The browser never reads them. Staff use the admin desk
or the SQL editor.

## Run order on a real Supabase project

Run these in the SQL editor, in this order:

1. `supabase/schema.sql`
2. `supabase/chat_accounts.sql`
3. `supabase/hunt_items.sql`
4. `supabase/spawning.sql`
5. `supabase/daily_box.sql` (Today's box on Me. It is not a street box feature; it sits
   here because it follows the same run order.)
6. `supabase/spawn_points_lagos.sql`
7. `supabase/box_guards.sql`

Do not run `seed.sql` in production. If the project already has steps 1 to 3, it
only needs steps 4 to 7. If it already has steps 4 and 6, it only needs step 7, and
`spawning.sql` once more first (it changed what a welcome box does when nowhere is clear).
`daily_box.sql` only needs `schema.sql`, and it is safe to run twice.

Rules for this order:

- Run the SQL before you deploy the app. If the app ships first it still works: the
  map falls back to the old columns and the welcome call fails quietly. Street boxes
  just do not appear.
- `spawn_points_lagos.sql` needs `spawning.sql` first (tables, the area trigger and
  `lagos_area_for`). It is about 210 KB (most of it the lagoon and creek outlines). It
  runs inside one transaction and ends with a table of spot counts per kind.
- **If `schema.sql` is ever run again, run `spawning.sql` after it.** `schema.sql`
  puts back the old `drops_read_active` policy and the old `claim_game_drop`. That
  would show welcome boxes to everyone and drop the speed check. Run `daily_box.sql`
  after it too: `schema.sql` puts back the old rank rule, which ranks a Hopper who
  only opened daily boxes.
- **Check the 16 areas exist before step 5.** The `areas` rows are inserted by
  `seed.sql`, which we do not run in production, so confirm they are there with
  `select count(*) from areas;` (it should say 16). Spots get their area from that
  table. With no areas, every spot has area empty and a rule with `areas` set would
  skip all of them. If you add the areas later, fill the gap with
  `update spawn_points set name = name where area is null;`.
- Venue spots come from events with status `live` at the time `spawn_points_lagos.sql`
  runs. Run it again after real events go live to add their venues. Existing rows
  are left alone.
- `box_guards.sql` goes after `spawn_points_lagos.sql`: it types the zones that file
  made, switches off the spots by the water and then guards `game_drops`. Run it again
  after you re-import the spots; it is harmless. The guard also catches a later import,
  because new spots by the water are born switched off.
- No new env vars and no Vercel cron. The spawner runs inside Postgres.

### Turn on pg_cron

The spawner is called by a pg_cron job every 5 minutes. A rule decides for itself
whether it is due, so 5 minutes is just the tick.

1. In Supabase open Database, then Extensions, and enable `pg_cron`.
2. Run `supabase/spawning.sql` again. The last block (re)creates the job. If pg_cron
   is off when you run the file, you get this notice and everything else still
   works: `pg_cron not available: enable it in Supabase (Database, Extensions), then run this file again.`
3. Check the job and its runs:

```sql
select jobid, jobname, schedule, command, active from cron.job where jobname = 'hoppaz-spawn-boxes';

select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'hoppaz-spawn-boxes')
order by start_time desc limit 10;
```

You want one row with `*/5 * * * *` and recent runs with status `succeeded`. A
succeeded run does not mean boxes were made. It means the function ran. Rules can
be off, outside their window, or not due yet.

If pg_cron is not an option, call `select public.spawn_boxes();` from any scheduler
that can reach the database as the service role every 5 minutes. Nothing for that is
built.

## Switching rules on (admin desk)

Open `/admin` and sign in with the staff token. The **Box spawner** cards sit under
"Schedule a drop".

| Card | What you do there |
|---|---|
| Box spawner | The summary line (spots on, blocked areas, boxes live, rules on). Each rule has an ON/OFF switch, **SPAWN NOW**, and **Edit rule**. **New rule** opens an empty form. |
| Spawn spots and blocked areas | Add a spot by name, kind and coordinates. Tick "Safe after 21:00" only for lit, busy places. Block an area with a centre and radius. Switch a blocked area on or off. Zones from OpenStreetMap show as "OpenStreetMap", yours as "Staff". |
| Live street boxes | Street and welcome boxes that are live now, with claimed counts. **END NOW** closes one. |

Both example rules are made inactive by `spawning.sql`:

| Rule | Window (Lagos) | Every | Per wave | Life | First | Kinds |
|---|---|---|---|---|---|---|
| Day street boxes | 07:00 to 21:00 | 30 min | 4 | 30 min | 5 | all kinds |
| Night venue boxes | 21:00 to 02:00 | 45 min | 2 | 40 min | 5 | venue, street |

**SPAWN NOW** is forced. It ignores the day, the window and the spacing, and it works
on a rule that is switched off. It still skips busy spots and blocked areas. It says
how many boxes it made. "Nothing spawned" means no free spot fit that rule.

If the database has not run `spawning.sql`, the desk shows a note to run it instead
of breaking the page.

### Before you switch rules on for real

- Check the first card says spots are on. If it says none, run `spawn_points_lagos.sql`.
- Set `areas` on the day rule (see Tuning). With `areas` empty, the rule uses every
  spot, and about 40 percent of the spots are far from the 16 Hoppaz areas.
- Look at the venue spots. They use the event venue name as the box title. Some event
  venues are street addresses, and those make odd box titles.
- Add the famous spots OpenStreetMap does not tag the way we search (below).
- Watch the first day. Use END NOW on anything that looks wrong.

## Defaults and tuning

Every field on a rule, with its default:

| Field | Default | Allowed | What it does |
|---|---|---|---|
| `active` | off | | On means pg_cron runs it. |
| `areas` | all | area names | Only use spots in these Hoppaz areas. Spots with no area are skipped when this is set. |
| `kinds` | all 7 | street, park, run, beach, landmark, market, venue | Which kinds of spot. |
| `days` | 1 to 7 | 1 to 7 | Lagos weekday the window starts on. |
| `start_minute`, `end_minute` | 420, 1260 | 0 to 1439 | Window in minutes after midnight, Lagos. End before start wraps past midnight. Same value twice means all day. |
| `every_minutes` | 30 | 5 to 1440 | Gap between waves. Rounds up to the next 5 minute tick. |
| `boxes_per_wave` | 3 | 1 to 50 | Boxes per wave. |
| `lifetime_minutes` | 30 | 5 to 1440 | How long a box stays. |
| `max_claims` | 5 | 1 to 1000 | First N people. |
| `radius_m` | 80 | 25 to 500 | How close you must be. |
| `night_from_minute`, `night_until_minute` | 1260, 360 | 0 to 1439 | Inside this window only night safe spots are used. Same value twice turns the night limit off. |
| `reward_model` | random | random, fixed | Random draws by weight. Fixed pays the first reward, so keep one row. |
| `rewards` | 30 / 100 / 300 XP | | See below. |

Default rewards, drawn by weight 80, 18 and 2:

| Reward | XP | Chance |
|---|---|---|
| Street find | 30 | 80% |
| Lucky find | 100 | 18% |
| Jackpot | 300 | 2% |

That pays about 48 XP per opened box on average. At the most, one box pays 5 people.

A reward item is `{type, title, description?, xp_amount?, weight?, badge_key?, collectible_key?, quantity?}`.
`badge` needs a `badge_key` that exists. `collectible` needs a `collectible_key` that
exists. The spawner quietly drops reward items it cannot pay, and skips a rule with
none left (a notice in the logs). The admin desk checks keys when you save.

### How many boxes

Boxes per day is about (window minutes / every minutes) x boxes per wave, if there
are enough free spots.

| Rule | Maths | Boxes per day |
|---|---|---|
| Day street boxes | 840 / 30 = 28 waves x 4 | 112 |
| Night venue boxes | 300 / 45 = 7 waves x 2 | 14 |

To change the feel, change one thing at a time:

| You want | Change |
|---|---|
| Busier map | `boxes_per_wave` up, or `every_minutes` down |
| More of a race | `max_claims` down, `lifetime_minutes` down |
| Easier to catch | `lifetime_minutes` up, `radius_m` up |
| Boxes where the people are | Set `areas` |
| Weekends only | `days = '{5,6,7}'` |
| Less XP | Lower `xp_amount`, or shift weight toward the small reward |

Example, keep the day rule inside the core areas:

```sql
update spawn_rules
set areas = array['Victoria Island','Ikoyi','Lagos Island','Lekki Phase 1','Yaba','Surulere','Ikeja']
where name = 'Day street boxes';
```

The 16 area names are Ajah, Apapa, Festac, Gbagada, Ikeja, Ikoyi, Lagos Island,
Lekki Phase 1, Magodo, Maryland, Mushin, Ogudu, Shomolu, Surulere, Victoria Island
and Yaba. A spot's area is its nearest area within 5 km, filled by a trigger.

Spot weights are on each spot. Landmarks, parks, beaches and run routes are 2,
street spots 1, markets 0.8, venues 1.5. Higher weight means picked more often.

Things in the code, not in a rule. To change them, edit `spawning.sql` (or `box_guards.sql`) and run it again:

| Setting | Where | Value |
|---|---|---|
| Water margin for spawn spots | `spawn_points_keep_off_water()` and the first update in `box_guards.sql` | 40 m |
| Welcome box layout and rewards | `spawn_welcome_boxes_for()` | see above |
| Min distance between boxes in a wave | `spawn_boxes()` | 300 m |
| Free space around a live box | `spawn_boxes()` | 50 m |
| Speed limit, history window, claims per hour | `claim_game_drop()` | 50 m/s, 2 hours, 6 |

### If nothing spawns

| Check | Query |
|---|---|
| Is the rule on, and when did it last run? | `select name, active, last_run_at at time zone 'Africa/Lagos' from spawn_rules;` |
| Is pg_cron running it? | the `cron.job_run_details` query above |
| Force one run and see the error | `select public.spawn_boxes(now(), (select id from spawn_rules where name = 'Day street boxes'), true);` |
| How many spots and zones? | `select public.spawner_summary();` |

A forced run that returns 0 means no free spot fit the rule. Usual reasons: `areas`
is too tight, it is night and the rule has no night safe spots in those areas, or
every spot is busy. A forced run for one rule shows errors. The cron run turns a
broken rule into a warning so the other rules carry on.

## Spots and zones from OpenStreetMap

```bash
node scripts/spawn-points/import-osm.mjs
```

Then run the new `supabase/spawn_points_lagos.sql` in the SQL editor. Options:

| Option | What |
|---|---|
| `--cache=<dir>` | Keep each Overpass answer in a folder and reuse it. Use it while testing. |
| `--out=<file>` | Write somewhere else. |
| `--fallback` | Skip Overpass and write a short hand-made list. |

It asks Overpass (the free OSM query service) for the Lagos box, trying three mirrors
and two rounds each. A full run takes a few minutes, longer when Overpass is busy. Overpass is sometimes slow, and
a mirror can answer with an error page. The script handles that. Please do not put it
in a loop.

What goes in:

| Kind | OSM tags | Weight | Night safe |
|---|---|---|---|
| park | `leisure=park`, named `leisure=garden` | 2 | no |
| run | `leisure=track`, named pedestrian streets, named footbridges and promenades | 2 | no |
| beach | `natural=beach`, `leisure=beach_resort` | 2 | no |
| landmark | attractions, museums, artwork, viewpoints, historic, arts centres, theatres, stadiums | 2 | no |
| market | `amenity=marketplace` | 0.8 | no |
| street | `highway=bus_stop` (best 1500) | 1 | no |
| street | `amenity=fuel` | 1 | yes |
| venue | live events with a location, from the database itself | 1.5 | yes |

What is left out: anything tagged private or no access, names that say "private", and
spots on the sea side of the coastline. Same kind spots within 60 m are merged.

Zones (each buffered by 30 m, or 150 m when OSM only has a single point): military
land, airports, prisons, ports (including the Apapa and Tin Can port areas by name),
power plants (not small solar or wind), landfills and gated private estates. One hand-made
zone, "Lagos harbour mouth (boat only)", keeps Tarkwa Bay, Lighthouse Beach and Snake
Island out, because OSM has no tag for places only a boat reaches.

Water is a zone too, left as drawn (no buffer), so a box never lands in it:

- **The Atlantic.** One zone, "Atlantic Ocean": the OSM coastline (land on its left)
  closed off to the south. A beach spot sits on the sand, above the line, so it stays.
- **The lagoon, creeks and bays.** Lagos Lagoon, Badagry Creek, Five Cowries Creek,
  Commodore Channel, Ologe Lagoon and other `natural=water` shapes of 1 hectare or more
  (lagoon, lake, reservoir, river, canal, or untagged). Ponds, pools and tanks are left
  out, and so is a water relation whose rings do not close, rather than guess its shape.

Because the Hopper's position is the only thing a welcome box is placed from, these
zones are what stop a box landing in the sea for someone standing on the Lekki coast.
Spots that fall in water are switched off by the last step of the file (one market
did, Kara Market, whose centre is in an OSM water shape).

If every mirror fails, the script writes a short hand-made list (about 40 public
spots, a few zones and a thinned copy of the Atlantic coastline) and says so. In that
mode there is no lagoon zone.

Every zone is written with its `zone_type` (see "No box in the water"). The first line of the
file adds the column if it is missing, so the file runs before or after `box_guards.sql`.
The copy of `spawn_points_lagos.sql` made before this change has no types; `box_guards.sql`
fills them in, and the next regeneration carries them.

Re-running is safe. Spots and zones are upserted by `(source, source_ref)`. A staff
on/off switch on an existing OSM spot is kept, except spots inside an active zone,
which are switched off again. Spots and zones with source `staff` are never changed.

### Adding spots by hand

OSM coverage of Lagos is thin. When this was made it had 48 parks and 5 beaches.
Elegushi, Bar, Landmark and Kuramo beaches, Ndubuisi Kanu Park and Johnson Jakande
Tinubu Park were not found by the tags we search. Add them from the admin desk (Spawn
spots and blocked areas, kind and coordinates). They are saved with source `staff`.
The area fills in by itself. Spots are day only unless you tick "Safe after 21:00".

The desk has no list of spots and cannot switch one off. To switch a spot off, use SQL:

```sql
update spawn_points set active = false where name = 'Some spot' and source = 'osm';
```

To block somewhere new, use **BLOCK THIS AREA** on the desk, or SQL:

```sql
select public.add_no_spawn_zone('Name', 'Why', 6.4281, 3.4219, 300);  -- lat, lng, radius in metres
```

## No box in the water

Jae saw boxes in the sea. The spawner already skipped zones, but any other insert could
still land in the water (a staff drop typed with the wrong coordinates, a test script,
a welcome box placed as a last resort), and a beach spot can sit on the waterline.
`supabase/box_guards.sql` closes that in the database, so it does not matter who inserts.

**Zone types.** Every row of `no_spawn_zones` now has a `zone_type`: `water`, `military`,
`airport`, `prison`, `port`, `landfill`, `power`, `estate` or `staff` (a zone drawn by
hand). Water is a type, not a guess from the name: the sea is "Atlantic Ocean", most
creeks are just called "Water". The importer writes the type itself. A zone made without
one gets it from its reason (`water`, `military`, `airport`, `prison`, `port`, `landfill`,
`power plant`, `private estate`, and the sea and the harbour mouth by their `source_ref`);
any other reason is `staff`. So to block a stretch of water by hand, give it the reason
`water` in **BLOCK THIS AREA**.

**The guard** is a trigger on `game_drops`, on insert and on a change of `geog` or `kind`.

| The drop | Result |
|---|---|
| Its point is in an active water zone, any kind | Refused: "That spot is in the water. Pick a spot on land." |
| Kind `spawn` or `welcome`, its point is in any other active zone | Refused: "That spot is in a no-box area (zone name). Pick another spot." |
| A staff drop in a military zone, an estate and so on | Allowed. Staff know what they are doing there. |
| A staff drop tied to an event, with no point of its own | Left alone. It uses the venue. |
| A drop that is already in the table | Not rechecked. Claiming it, renaming it or closing it still works. |

The admin desk shows the message when it refuses a drop. Switching a water zone off in
the desk lifts its guard.

**Spots by the water.** A spawn spot within 40 m of an active water zone is switched off,
when `box_guards.sql` runs and whenever a spot is added or moved, so a re-import cannot
bring one back. Why 40 m: the map tiles and the OSM shapes disagree by a few metres, and
a pin that near the waterline can show in the sea. A beach stays only if it is on the
sand. Staff can still switch such a spot on by hand (it stays on until it is moved or
imported again). On the Lagos data of 2026-10-09 it switched off 8 spots: 3 fuel stations,
a park, and the National Theatre venue (4 event names, one place), each 15 to 40 m from a
small OSM water shape.

## Anti-cheat

| Check | What it stops | Where |
|---|---|---|
| Distance | Opening a box from far away. You must be within the radius. | `claim_game_drop()` |
| First N | A box can only be opened by N people. It is locked per box, so a rush cannot go over. | `claim_game_drop()` |
| One per person | Opening the same box twice. | `drop_claims` unique (drop, user) |
| Speed | Jumping across the city. If a claim made by location is faster than 50 m/s from the same person's last located claim in the past 2 hours, it is refused with `too_fast`. | `claim_game_drop()` |
| Cooldown | Farming. A person can open at most 6 street boxes in any 60 minutes. The seventh is refused with `slow_down`. Staff drops and welcome boxes do not count. | `claim_game_drop()` |
| One at a time | Bursting claims. The speed and cooldown checks read claims that are already saved, so claims from one person sent together would all pass. A claim now takes a lock for that person first, so the second waits for the first and sees it. (Tested with 10 claims at once on 10 boxes far apart: before the lock all but one could succeed, now one does and nine get `too_fast`.) | `claim_game_drop()` |
| Owner | Taking someone else's welcome box. Refused with `not_yours`. | `claim_game_drop()` and RLS |

Every claim now stores the position it was made from (`drop_claims.lat`, `lng`),
which is what the speed check reads.

**Outside Score.** A street or welcome box logs the `street_drop` rule in
`game_score_rules`, not the venue `drop` rule (100). It starts at 0, so boxes pay XP
and rewards but cannot top the monthly board without a night out. Staff can change it
in "Outside Score rules" on the desk. The claim still counts as an active day.

**QR codes.** `claim_game_drop` looks for pgcrypto in the `extensions` schema, where
Supabase keeps it. The old version raised an error on any claim with a code.

**The limits.** Be honest about these.

- The phone tells us where it is. Anyone can fake GPS on a rooted or jailbroken phone
  or with a mock location app. We cannot detect that from here. The speed check
  catches the lazy version (teleporting between far apart boxes), not a careful one
  who moves at a believable speed.
- The speed check only compares with a person's last claim that has a position, in
  the last 2 hours. A person who waits can jump anywhere.
- Hoppers are anonymous accounts. A person can make a new account and get a new set of
  welcome boxes (up to 250 XP) and a fresh cooldown. There is no device or phone check.
- Claims made with a QR code skip the speed check.
- The first N race favours people who are close. That is the idea. It also favours people
  who live next to a spot.
- Anyone signed in can read where a box is (the map needs it), and the phone says where
  the person is. So a script can send a box's own position and open it from anywhere,
  with a fresh account for each of its first N slots. The speed check only compares with
  an earlier claim, and a new account has none. Nothing in the database can tell a real
  position from a made-up one. The lock, the cooldown and the speed check stop one account
  doing it in bulk; they do not stop many accounts. What would: a limit on anonymous
  sign-ups (Supabase Auth, Rate limits, and CAPTCHA protection), a minimum account age
  or a phone check before a street box opens, or a position the phone can prove
  (device attestation). Not built.

So keep street boxes low in value. XP, badges and collectibles are fine. Do not put
money, tickets or vouchers in them until there is real account verification.

## Privacy

- Welcome boxes are placed from the location the Hopper sent. They are hidden from
  everyone else by RLS. The admin desk shows only title and area for them, never the
  owner or coordinates.
- Every claim now stores the exact latitude and longitude it was made from. A person
  can read their own claims. Nobody else can, except through the service role. The
  speed check only looks back 2 hours, so you do not need to keep positions longer than
  that. A purge is not built (see below).
- The public privacy notice should say that Hoppaz stores the location of a box claim,
  and that welcome boxes are placed from the location the Hopper shares. Jae, please
  check the wording before launch.
- Box locations are public by design. They are public spots.
- Spawn spots are public places. Do not add a private home, a school or anywhere else
  you would not want a crowd to turn up.

## OpenStreetMap licence

The spots and zones come from OpenStreetMap. The data is (c) OpenStreetMap
contributors and licensed under the ODbL (https://www.openstreetmap.org/copyright).

- The credit is already on the map. The CARTO basemap shows "CARTO, OpenStreetMap
  contributors" in the bottom left corner, and the generated SQL file carries the
  same notice at the top. If someone sets `NEXT_PUBLIC_MAP_STYLE` to another style,
  check that style still shows the OpenStreetMap credit. Do not hide it.
- Using the data inside the app is fine. If you ever publish the spots list as a file
  or API for other people, the ODbL applies to that published database (share alike).
  Read the licence first.

## How to test

### Local database

Needs a local database with `schema.sql`, `hunt_items.sql` and `spawning.sql` loaded
(and `spawn_points_lagos.sql` plus `box_guards.sql` for the second test).
Never run this on a real project.

```bash
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/spawning_test.sql
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/box_guards_test.sql
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/daily_box_test.sql
```

It runs in one transaction that always rolls back, and it clears the spawn tables
inside that transaction, so nothing is kept and imported data cannot change the
result. The last line is `ALL SPAWNING TESTS PASSED`. If a check fails, it raises
`TEST FAILED` with what it got and what it wanted. It covers: forced waves, windows
and timing (including a window past midnight), night spots, first N, too far, closed,
no session, too fast, slow down, the per-Hopper claim lock, QR code claims, the street
box score, welcome boxes by day and night (including next to a coast and with nowhere
clear), owner-only visibility, privileges and the admin summary.

`box_guards_test.sql` ends with `ALL BOX GUARD TESTS PASSED`. It runs in one transaction
that always rolls back. On the real Lagos data it proves a staff drop in the sea and a
street box in the lagoon are refused, a drop on land is fine, an event drop with no
point is fine, no active spot is within 40 m of water, the forced spawner and welcome
boxes at the coast stay on land. On zones of its own (at open sea east of Lagos) it
checks every rule edge by edge: water against other zones, each kind, the zone edge,
a zone switched off, moving a drop, an old drop already in the water, and spots at 30 m,
60 m, on the waterline and on the sand.

`daily_box_test.sql` (needs `daily_box.sql` loaded) ends with `ALL DAILY BOX TESTS PASSED`
and rolls back the same way. It covers the prize table edges and odds, once a day, the XP
and the streak, this week's days, the Lagos day boundary (22:59:59 and 23:00:00 UTC),
a second call after the row exists, privileges, and the rank rule (a Hopper who only
opened daily boxes is not ranked, on the stats, the report card and the public board).

### In the app

1. Run `spawning.sql`, `spawn_points_lagos.sql` and `box_guards.sql` on your database.
2. In `/admin`, press **SPAWN NOW** on **Day street boxes**. At night it only uses fuel
   stations and venues. To use any spot at night, turn the night limit off on that rule.
3. Open the map with your location set near a spawned box. You see an orange "N LEFT" pin.
   Tap it for the sheet: "STREET BOX", how many are left, and how long it has.
4. Get within the radius and open it.
5. For a welcome box, open the app as a new Hopper with a location in Lagos. You get
   a toast ("3 welcome boxes just dropped near you") and 3 "YOURS" pins. To get them
   again for the same account, delete that account's rows where `kind = 'welcome'`.

In SQL you can run a wave by hand: `select public.spawn_boxes(now(), null, true);`
That is forced and runs every active rule.

## Not built yet

| Missing | Notes |
|---|---|
| Push alerts | In-app toast only. The toast shows when a new street box is within 1.5 km, and only while the app is open. |
| Strava and run routes | The `run` kind exists and uses OSM running tracks and footbridges, but there is no Strava link and no distance or pace challenge. |
| Cards as rewards | Rewards are XP, badges and collectibles. Vouchers, discounts, upgrades, tickets and cards cannot be set from a rule yet. |
| Spot list on the desk | No list of spots and no switch to turn one off (the API action `toggle_spawn_point` exists with no screen). |
| Longer spot rest | A spot can come back as soon as its last box ends. A longer rest or a per-day limit per spot would keep the map less repetitive. |
| Claim position purge | `drop_claims.lat` and `lng` are kept for good. A job to blank them after a day or two is easy to add. |
| Device and account checks | Nothing beyond the checks above. |
| Sponsored street boxes | A partner-paid box at a chosen spot works as a normal staff drop, not as a spawn rule. |

Known quirks: `END NOW` uses the app server's clock, so a box ended within a second
of opening can fail once and works on a retry. A fixed reward rule pays the first
reward row by id, which is why the form says to keep one row.
