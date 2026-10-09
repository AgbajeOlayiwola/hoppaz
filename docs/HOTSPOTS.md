# Hoppaz Hotspots

Status: plan only, 9 Oct 2026. Nothing below is built. It sits on top of Play mode ([PLAY-MODE.md](PLAY-MODE.md)) and Ola's chat system (`supabase/chat_accounts.sql`). Jae's rows in [DECISIONS.md](DECISIONS.md) win over any number here.

Jae's words, tidied from his voice note: "Three spots in Yaba that are always open 24/7, a general group that people in Yaba can enter and have conversations and vibe. Anyone anywhere can enter, but it should be closer to the people in that region. When you click Play you see the hotspots near you on the map, you move your avatar there, you enter the conversation and enjoy yourself or interact with people from the same community. Start with three in Yaba, then scale: Phase 1 maybe two, very large areas several. Call them HOTSPOTS. They should always be at junctions."

## 1. In three sentences

1. A hotspot is a fixed meeting place for avatars at a real road junction, open 24 hours a day, with a group chat and a crowd of heads.
2. Open Play and you see the hotspots near you; tap one, your avatar runs there, and you are in the room with whoever else is there. Anyone, from anywhere, can enter.
3. Each area gets a few (three in Yaba, two in Lekki Phase 1), so a Hopper has a home hangout, and nobody's real position is ever shown or sent.

If a feature does not fit in those three sentences, it is not in v1.

## 2. Hotspot or spawn spot

They look alike on the map and are different things. Keep both words.

| | Spawn spot (Play mode section 4) | Hotspot |
|---|---|---|
| What it is | A place a box lights up for a while | A fixed hangout |
| Where | Any of the `spawn_points` (parks, markets, bus stops), picked at random | A named road junction, picked by staff once, same place forever |
| When | 90 minutes, a few times a day, then gone | Always open, 24/7, never closes |
| Prize | A box with 10 random prizes, first 10 avatars | No box. A small daily visit reward (section 8) |
| Who can send an avatar | A verified account within about 3 km of its last fix | Any verified account, anywhere. No distance limit (section 6) |
| Travel | Random 10 to 60 s, the server checks the trip | A run the phone animates; the server is told nothing about where you are |
| Talk | Heads only: Wave, Link up, Vibe. "No spot chat, ever" | A group chat, plus the same heads. This is the one place the "no chat" rule changes (section 7) |
| The server learns your position | Yes, one rounded fix (`play_fix`) | No. Entering a hotspot needs no position at all |
| Count shown | Under 3 reads "a few" | Same rule, and 0 reads "quiet right now" |

Same machinery where it can be: the map layer, the sheet, aliases, heads, Wave, Link up, Vibe, blocks and reports are reused, not rebuilt.

## 3. Why Ola removed area chat (found in the git history)

Short answer: nothing in the repo says why. I looked, and here is what is there.

| What I checked | What it shows |
|---|---|
| `git log -S"whos_near"`, `-S"ping_presence"` | One commit only: `beea696`, Ola, 8 Oct 2026, titled "update". In it the names appear only inside `drop function if exists` lines. The area chat and presence code was never committed in a working form; it lived in his own database as a draft. |
| `git log -S"area:"` | Same commit adds the last traces: `message_visible` returns false for any `area:` channel, `purge_expired_rooms` deletes `area:%` messages, and the Chat page ignores a `?c=area:...` link. |
| The comment he left in `chat_accounts.sql` | "An earlier draft had a NEARBY room for everyone in your area. Rooms are for the event only now; this clears that draft away if it was run." It drops `presence`, `ping_presence(text)`, `whos_near(text)` and `is_near(...)`. |
| The same commit | Also removed the city-wide BASE room (the old default `channel 'base'`, a room anyone could post in). Replaced it with event rooms (you must be checked in), event group chats (you said you are going and joined) and crew move chats. Rooms are temporary: gone for good three days after the event, deleted by a daily job (`/api/cron/purge-rooms`). His README line for the Chat page changed to "The people at your party tonight." |
| Docs and commit messages | 12 of his 14 commits are titled "update" (the others are "first commit" and "Show event leads on the map"). No doc mentions the reason. |

My reading, clearly marked as a guess, from what the code protects:

1. A table of who is near each area is a live "who is near you" feed. It tells strangers where people are.
2. A room open to a whole area has nothing to anchor it: no check-in, no shared night, no proof anyone is there. It is a public room of strangers with no event to bound it, and BASE was the same.
3. He made every room temporary and deletable. An always-open room needs a keeping and deleting rule he had not written.

How hotspots answer each one (this is the design, and the question for Ola in section 12 is whether he agrees):

| His likely worry | Hotspot answer |
|---|---|
| A presence feed tells where people are | There is no position anywhere in the hotspot flow. The server never learns where you are when you enter. The room shows aliases of avatars that chose to be there, and a count. The list of hotspots is public and fixed, so "near you" is worked out on the phone. |
| Open room of strangers, nothing to anchor it | An account is needed to enter and to post. Alias only, never the handle. Text only. Rate limits, a link and phone-number filter, block, report, staff mute and ban, and a pause switch per hotspot. |
| Keeping messages | 24 hours visible, deleted after 7 days. Reports keep their own excerpt, so deleting does not erase evidence. |

## 4. How many hotspots, by scale

The `areas` table has only a centre point for each of the 16 areas, no outline, so the area's size cannot be measured from the database. I tried a "walkable land within 3 km, minus water and no-spawn zones" measure; the 3 km cap made Lekki Phase 1 look as big as Surulere, so it does not match Jae's own judgement and I dropped it. The rule is therefore plain and set by Jae.

**Rule.** Each area gets a size class. The class sets the starting number. Data then moves it.

| Class | Meaning | Hotspots at start |
|---|---|---|
| L (large) | A district many people live in or travel to, or a nightlife hub | 3 |
| M (medium) | Known, smaller | 2 |
| S (small) | Quiet, mostly homes or industry | 1 |

Moving it, from the hotspot's own numbers:

- Add one when the busiest hotspot in the area has 25 or more avatars at once in its peak hour on average, for 14 days. At most 4 in an area in v1.
- Pause one when its peak hour has fewer than 3 avatars at once, for 14 days. Pausing is `active = false`; nothing is deleted.
- Hotspots are at least 800 m apart in one area, and at least 500 m from one in the next area, so two rooms never split the same crowd.
- Never fake a crowd. Empty rooms are honest ("quiet right now"). A quiet hotspot is the biggest risk to this feature (section 7), so we do not open them all at once.

**Starting list (proposal, Jae to change any class).** Yaba 3 and Lekki Phase 1 2 are Jae's. The rest follow his scale idea ("very large areas several").

| Area | Side | Class | Hotspots | Wave |
|---|---|---|---|---|
| Yaba | mainland | L | 3 | 1 |
| Lekki Phase 1 | island | M | 2 | 1 |
| Victoria Island | island | L | 3 | 1 |
| Ikeja | mainland | L | 3 | 1 |
| Surulere | mainland | L | 3 | 2 |
| Ikoyi | island | M | 2 | 2 |
| Lagos Island | island | M | 2 | 2 |
| Mushin | mainland | M | 2 | 3 |
| Festac | mainland | M | 2 | 3 |
| Ajah | island | M | 2 | 3 |
| Magodo | mainland | S | 1 | 3 |
| Maryland | mainland | S | 1 | 3 |
| Gbagada | mainland | S | 1 | 3 |
| Ogudu | mainland | S | 1 | 3 |
| Shomolu | mainland | S | 1 | 3 |
| Apapa | mainland | S | 1 | 3 |
| Total | | | 30 | |

Waves: wave 1 (Yaba, Lekki Phase 1, Victoria Island, Ikeja) is 11 hotspots and where Hoppaz events are. Wave 2 and 3 open when wave 1's rooms are alive. Launch with Yaba alone if Jae prefers: three busy rooms beat thirty empty ones.

I could not use the number of Hoppers per area: the local database has none with an area set, and I do not have production counts.

## 5. Where they go: junctions

**A hotspot sits at a real junction of two named roads.** Not a park, not a market, not a bus stop. Picked once by staff from a short list and never moved. Hotspots are online: nobody has to stand at the junction, and the app never asks them to (junctions are not safe places to wait).

### Rules for a junction

| Rule | Value |
|---|---|
| Roads | Two roads with different names meeting at one node. Classes motorway, trunk, primary, secondary, tertiary (see the finding below) |
| Merge | Junction nodes within 60 m of each other count once (dual carriageways, slip roads) |
| Inside its area | `lagos_area_for(point)` equals the area (nearest centre within 5 km) |
| Avoid | Inside any active `no_spawn_zones` zone; within 60 m of a water zone; within 100 m of a military, prison, port or airport zone; a node that is only on a bridge or tunnel |
| Prefer busy public junctions | Score: road class of the top two roads (motorway or trunk 4, primary 3, secondary 2, tertiary 1) + 1 for each extra road (up to 2) + 3 if traffic signals within 60 m + 2 for a roundabout + 0.4 per public place within 150 m (bus stop, market, fuel, bank, food, school, worship, clinic; up to 20) |
| Spread | Keep the best first, drop any other within 250 m of one kept; pick hotspots at least 800 m apart |

**Finding: the first ask (named primary, secondary, tertiary) misses the big roads.** In Lagos OpenStreetMap tags Herbert Macaulay Way and Street (trunk), Agege Motor Road (trunk), Lekki-Epe Expressway (trunk), Ikorodu Road and Western Avenue (partly motorway). With only the three classes the first run found no Herbert Macaulay junction in Yaba at all. I added motorway and trunk. OpenStreetMap also misspells some names ("Murtula Muhammed Way" is Murtala Muhammed Way); the matcher allows a small typo so a road is not counted as meeting itself.

### The Overpass query

Roads (the same call for any area; change the centre; 3 km radius; send a `User-Agent`; the main server answers 504 now and then, so retry after a short wait and fall back to `overpass.kumi.systems`):

```
[out:json][timeout:90];
way(around:3000,6.5090,3.3750)
  ["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["name"];
out body;
>;
out skel qt;
```

Public places and signals, used for the score:

```
[out:json][timeout:90];
(
  node(around:3000,6.5090,3.3750)["highway"~"^(traffic_signals|bus_stop)$"];
  node(around:3000,6.5090,3.3750)["amenity"~"^(bus_station|marketplace|fuel|bank|restaurant|bar|nightclub|cafe|fast_food|pub|school|university|college|place_of_worship|pharmacy|hospital|clinic|cinema|theatre)$"];
  node(around:3000,6.5090,3.3750)["shop"~"^(mall|supermarket|convenience)$"];
);
out body;
```

Overpass cannot easily say "nodes shared by two differently named ways", so a short script does the rest: put every node of every way in a map, keep nodes on two or more ways with different names, merge within 60 m, then apply the rules above, with the zone checks run against the local database (`no_spawn_zones`, `lagos_area_for`). The script is not in the repo yet (this task writes docs only); build step 0 adds it as `scripts/hotspots/find-junctions.mjs` next to the spawn-points importer.

### What the query found (Yaba and Lekki Phase 1)

| Area | Raw junction nodes | After merging | In the area, clean, 250 m apart |
|---|---|---|---|
| Yaba | 75 | 46 | 18 |
| Lekki Phase 1 | 76 | 39 | 23 |

OpenStreetMap is thin on places in Lagos (Yaba has only 20 traffic signals and 90 public places in 3 km), so the score leans on road class. Treat the ranking as a shortlist and Jae's eye as the decision. Local names below are my reading of the coordinates and need Jae to confirm them.

**Yaba, best candidates** (full list of 18 in `supabase/hotspot_candidates.sql`)

| Rank | Place (to confirm) | Lat, lng | Road A x Road B (OSM spelling) | Signals | Places | Pick |
|---|---|---|---|---|---|---|
| 1 | Jibowu | 6.51670, 3.36862 | Herbert Macaulay Street (trunk) x Murtula Muhammed Way (primary) | 3 | 0 | Yes |
| 2 | Ojuelegba | 6.51006, 3.36317 | Western Avenue (primary) x Ojuelegba Road (primary) | 4 | 0 | Yes |
| 7 | Yaba market side | 6.50575, 3.37336 | Murtula Muhammed Way (primary) x Commercial Avenue (tertiary) | 0 | 4 | Yes |
| 9 | UNILAG Akoka gate | 6.51767, 3.38445 | Akoka Road (primary) x University Road (secondary) | 0 | 0 | Alternate |
| 3 | Jibowu, west side | 6.51671, 3.36537 | Herbert Macaulay Street (trunk) x Agege Motor Road (trunk) | 0 | 0 | |
| 6 | Murtala Muhammed Way north | 6.51885, 3.36778 | Murtula Muhammed Way (primary) x Ikorodu Road (primary) | 0 | 0 | |
| 10 | Makoko side | 6.49604, 3.38696 | Makoko Road (tertiary) x Church Street (tertiary) | 0 | 6 | |
| 4 | Ebute Metta side | 6.49136, 3.38229 | Herbert Macaulay Way (trunk) x Wright Street (trunk) | 0 | 0 | |

Proposed three: Jibowu, Ojuelegba, Yaba market side. Distances: Jibowu to Ojuelegba 950 m, Ojuelegba to Yaba market side 1.2 km, Jibowu to Yaba market side 1.3 km, so all three are over 800 m apart and spread north, west and centre. The UNILAG gate is the swap if Jae wants the east (students) covered; it is 1.7 km from the nearest of the three.

**Lekki Phase 1, best candidates** (full list of 23 in the SQL file)

| Rank | Place (to confirm) | Lat, lng | Road A x Road B (OSM spelling) | Signals | Places | Pick |
|---|---|---|---|---|---|---|
| 11 | Phase 1 Admiralty Way | 6.44787, 3.47021 | Admiralty Way (primary) x Fatai Idowu Arobieke Street (tertiary) | 0 | 3 | Yes |
| 1 | Phase 1 Freedom Way | 6.43307, 3.48222 | Lekki-Epe Expressway (trunk) x Freedom Way (primary) | 4 | 4 | Yes |
| 4 | Admiralty Way, west end | 6.43723, 3.45666 | Admiralty Way (primary) x Bisola Durosimi Etti Drive (secondary) | 0 | 3 | Alternate |
| 5 | Expressway at Remi Olowude Way | 6.43076, 3.46809 | Lekki-Epe Expressway (trunk) x Remi Olowude Way (secondary) | 0 | 2 | |
| 3 | Ikoyi Bridge roundabout | 6.44677, 3.46119 | Ikoyi Bridge Roundabout (primary) x Admiralty Way (primary) | 0 | 1 | |
| 14 | Phase 1 centre | 6.43711, 3.46879 | Bisola Durosimi Etti Drive (secondary) x Adewunmi Adebimpe Street (secondary) | 0 | 0 | |

Proposed two: Admiralty Way at Fatai Idowu Arobieke Street (the Phase 1 spine, 760 m north of the area centre) and the Expressway at Freedom Way (the busiest signalled junction, 1.6 km south-east). They are 2.1 km apart. Rank 2 and the ones east of Freedom Way (longitude 3.49) look like Lekki Phase 2 and were not proposed.

**Does every area have enough junctions?** I ran the road query and the same rules for the other 14 areas too (no places or signals, so no ranking, only counts). "Spaced" is how many junctions fit when hotspots must be 800 m apart. Every area has at least as many as section 4 plans. The ranked shortlists for them (with signals and places) are not made yet (build step 0).

| Area | Planned | Clean junctions (250 m apart) | Spaced at 800 m |
|---|---|---|---|
| Yaba | 3 | 18 | 7 |
| Lekki Phase 1 | 2 | 23 | 13 |
| Victoria Island | 3 | 29 | 8 |
| Ikeja | 3 | 23 | 13 |
| Surulere | 3 | 19 | 11 |
| Ikoyi | 2 | 27 | 10 |
| Lagos Island | 2 | 14 | 6 |
| Mushin | 2 | 30 | 14 |
| Festac | 2 | 8 | 6 |
| Ajah | 2 | 6 | 5 |
| Magodo | 1 | 14 | 9 |
| Maryland | 1 | 19 | 10 |
| Gbagada | 1 | 4 | 3 |
| Ogudu | 1 | 9 | 5 |
| Shomolu | 1 | 12 | 7 |
| Apapa | 1 | 10 | 7 |

Gbagada and Ajah have the fewest named junctions in OpenStreetMap, so staff may need to add one by hand.

Every candidate above is outside every active no-spawn zone (checked against the 119 zones in the local database). Two junctions near Five Cowries Creek (72 m and 87 m away) passed the 60 m water rule and are in the list, but are not proposed.

### Placing the pin

The coordinates are OpenStreetMap node positions, which sit on the road centre line. The marker is drawn there. Staff can nudge the point by up to 40 m in the admin desk if it lands on the wrong carriageway. A hotspot is never moved after Hoppers start using it, only paused or replaced.

## 6. How they show in Play

### Near you, on the map

1. **Open Play.** The map already centres on the Hopper. Hotspots within 10 km appear as markers; if none are that close, the nearest two appear and the camera stays on the Hopper.
2. **The marker is its own thing.** Not a crate (cream, violet, pink, gold) and not a spot ring. A hotspot is a dark disc with a cream crossroads glyph inside an orange ring (`BRAND.orange`), its name under it in the display font ("JIBOWU"), and a small count badge. The ring pulses when 3 or more avatars are there. No emoji.
3. **A "Hotspots near you" row in the tray.** The three nearest, with a distance only the Hopper sees ("1.2 km") and the count band. Tap one and the camera flies to it. "More hotspots" opens the full list grouped by area. The sort and the distance are worked out on the phone from the Hopper's own fix. The hotspot list is public and fixed, so the server never needs the Hopper's position for this.
4. **Hopper not in Lagos, or location off.** Today Play answers "Play is Lagos only for now" and shows nothing. For hotspots it should instead show the full list, Yaba first, with the map on Lagos, because entering needs no position. Boxes stay Lagos only.
5. **The main events map.** Jae: "maybe they'll be showing on the icon map." Recommended: yes, one small hotspot icon at each junction on the events map; tapping it opens Play at that hotspot's sheet. Boxes still never show there (decision of 9 Oct). Jae to confirm.

### The sheet and entering

1. Tap a marker. A sheet opens: name, area, the two road names, "Always open", the count band, ENTER.
2. Guest: ENTER opens the sign-up sheet in place (Ola's `requireAccount`); an account is needed to enter. After Play mode Phase 6 it means a verified account.
3. ENTER sends the avatar. It runs from where it is on the map to the junction. The run is animated on the phone only: 4 to 25 s by distance, with a skip button after the first time. Nothing about the run, the start or the distance goes to the server. This is the relaxation of the 3 km rule: the rule existed so spot prizes could not be farmed from far away, and hotspots have no prizes, so there is nothing to protect and no limit. Steering with the arrows works as in spots, optional.
4. On arrival the phone calls `enter_hotspot(id)`. The room opens as a sheet over the map (Play never navigates away): faces strip, the chat, the composer. On the map the avatar stands at the junction with up to 10 heads around it (6 on low-tier phones).
5. Leaving: Bring avatar home, or sending the avatar to another hotspot or to a spawn spot. One avatar, one place: entering a hotspot removes any spawn-spot visit, and starting a spot trip removes the hotspot visit. Close the app and the head fades 10 to 20 minutes later, a random time, so nobody can read the exact moment you left.

### Deep link

`/?hotspot=yaba-jibowu` opens Play with that sheet. Handy for the WhatsApp Community: "Yaba is on at Jibowu. Come in." Cheap; part of step 2.

## 7. The room

The room is Ola's chat system with one new channel kind, `hotspot:<id>`. Nothing new is invented for talking; the new part is the rules around an always-open room.

### Who is who

| Thing | Rule |
|---|---|
| Name in the room | An alias from `identity_for(user, 'hotspot:<id>', false)`, for example "Jollof Rider 4F". The same alias in the same hotspot every time, so regulars know each other; a different one in every other hotspot, so nobody is followed between rooms. A Hopper can pick a new alias once a day |
| Look | The Hopper's avatar look, as in spot rooms |
| Handle and real name | Never shown. A handle shows to one person after a returned wave or an accepted link up, as in spots |
| Account | Needed to enter and to post (`has_account()`, then a verified email after Phase 6). No account, no entry |

### Chat rules

| Rule | Value |
|---|---|
| Content | Text only. No pictures in v1 (the picture bucket and moderation load wait) |
| Length | 240 characters (Ola's table allows 400; the hotspot trigger is stricter) |
| Speed | At most 5 messages in 30 s and 40 an hour per Hopper in a hotspot. 00:00 to 05:00 Lagos: 1 message every 10 s (slow mode) |
| Filter | A message with a link, an email address or a phone number is refused ("No numbers or links in hotspots"). A short staff word list can be added later |
| Duplicates | The same text twice inside 60 s is refused |
| Visible | The last 24 hours, only while your avatar is in the room |
| Kept | 7 days, then deleted. Reports keep a 400 character excerpt of the message they name |
| Delivery | Ola's Realtime on `messages` for v1, because a room is capped (below) and it reuses `useRoom`. If load asks, switch to a cursor poll like the spot pulse |
| Size | A soft limit of 60 avatars in a room. At 60, ENTER offers the nearest other hotspot. Lobbies of 50 for one hotspot ("Jibowu 2") come later if the data asks |

### Heads: Wave, Link up, Vibe

Tap a head and PersonCard opens, exactly as in spot rooms (Play mode section 7): Wave, Link up, Vibe, Block, Report. Both people must be in the room (`in_room`), `have_met` is skipped, and the limits are the same (30 waves a day, 10 link-up requests, vibes capped). The only change in Ola's functions is that `hotspot:` counts as a room kind next to `spot:`. They arrive with Play mode Phase 5; if Phase 5 is not built first, hotspots ship with chat, Block and Report only and the heads gain actions later.

### Keeping it safe at 3 a.m.

A 24/7 room with no staff awake needs rules that run by themselves.

| Control | What it does |
|---|---|
| Report | The existing `report('room', message)` and `report('person', key)`. Three different people reporting one alias in 24 hours mutes it in that hotspot for an hour. Six hides it from all hotspots until staff look. Nothing is deleted by the machine |
| Block | The existing both-way block. A blocked person's messages and head disappear for you |
| Staff, in the admin desk | A Hotspots section next to the spawner: pause a hotspot (instant), set its slow mode, clear the last N minutes, mute an alias for N hours, ban an account from hotspots, see the open reports for hotspot messages |
| Pause switch | `active = false` hides the hotspot everywhere and closes its room |
| Room rules | A fixed line at the top of every room: "Be kind. No numbers or links. Report anything that feels off." It is not a message in the table |
| Not a meet-up | A line in the sheet: "Hotspots are online. You do not need to be at this junction." |

### The empty-room problem

The biggest risk is not abuse. It is a hotspot with nobody in it. Rules: count bands are honest; a new arrival makes the ring pulse; the numbers "here now" and "today" (a day total, no names) show in the sheet so a quiet room still looks like a place that has been alive. We do not post fake people. We start with a few rooms (section 4) and light them from the WhatsApp Community and event nights.

## 8. A small daily reward (cheap, optional)

| Rule | Value |
|---|---|
| Reward | 10 XP, once per play-day (06:00 to 06:00 Lagos), the first time you have stayed in any hotspot for 5 minutes |
| Account | Verified |
| Counts as | Not a streak day, not an outside day, not inside the 150 XP box ceiling. A separate flat 10 XP a day at most, so hopping between hotspots pays nothing extra |
| Regular badge | The same hotspot on 4 different days gives "Regular at Jibowu", using the venue-badge idea already in DECISIONS (4 visits makes you a Regular) and `badge_catalog` |
| Server | `claim_hotspot_daily()` checks the visit row (entered at least 5 minutes ago, still present), writes one row to `hotspot_days (user_id, play_day, hotspot_id)`, adds the XP. Day rows older than 30 days are deleted |

Gamification beyond this (prompts from Paz, hotspot nights, crew battles) is a separate piece of work and not part of this plan.

## 9. Privacy and safety

1. No position is stored or sent for a hotspot. Entering needs no fix. The distance shown on the tray is computed on the phone. The privacy page needs one line: "Hotspots: your avatar and a room name are visible to others in the room. We do not use your location for hotspots."
2. The one new place data about a Hopper is `hotspot_visits` (which hotspot your avatar is in now) and `hotspot_days` (which hotspot, which day, for 30 days). Neither holds a coordinate. A visit row is deleted when you leave or 20 minutes after your last ping.
3. The server never gives a client another Hopper's id, handle, name or home area. Only keys, aliases and looks, as in Ola's rooms.
4. Profiles stay as the lockdown in Play mode section 10 plans: the home area is hidden. A "show my area" chip ("YABA" next to your alias) is possible but off by default and needs Jae's yes (open question 7).
5. Messages: 24 hours visible, deleted at 7 days, a staff excerpt kept on report. The privacy page says so.
6. Backups hold deleted rows until they expire; the launch checklist already asks for that number.
7. Age: Hoppaz is a nightlife app. If there is an age rule, a public chat of strangers needs it stated and enforced. Open question 6.
8. What is left, plainly: an always-open public room will get some abuse. The controls make it slow, noisy and reversible; they do not make it zero.

## 10. How it fits the existing tables

Smallest change: one new table of places, one for who is there, one for the daily reward, and a few lines in Ola's functions.

| New | What |
|---|---|
| `hotspots` | `id, slug, name, area (references areas), geog, road_a, road_b, osm_ref, active, slow_seconds, created_at`. Public read of active rows (the list is public); writes service role only |
| `hotspot_visits` | `user_id (primary key, one place at a time), hotspot_id, key (from identity_for), entered_at, last_seen`. RLS on, no policy, nothing granted; only the functions below read it. No coordinates |
| `hotspot_days` | `user_id, play_day, hotspot_id`, primary key `(user_id, play_day, hotspot_id)`. Same lockdown |
| `hotspot_mutes` (step 4) | `hotspot_id, user_id, until` |
| `hotspot_candidates` | Data only, in `supabase/hotspot_candidates.sql`. Staff turn a candidate into a `hotspots` row |

| New function | What |
|---|---|
| `hotspot_list()` | Active hotspots with id, name, area, roads, lat, lng and the count band (never an exact number under 3) |
| `enter_hotspot(id)` | Needs an account. Creates or refreshes the visit, clears any spot visit, returns the key and alias. Rate limited: 30 entries a day |
| `leave_hotspot()` | Deletes the visit |
| `hotspot_pulse(id, cursor)` | Every 10 s while the room is open: heads (key, alias, look, ordered linked and waved first, then by a hash of the key), count band, vibes since the cursor; also refreshes `last_seen`. No times, no arrival order |
| `claim_hotspot_daily()` | Section 8 |
| Staff: `admin_hotspot_*` | Pause, slow mode, mute, ban, clear. Service role |

| Edit to Ola's files (same style as Play mode section 18) | When |
|---|---|
| `chat_accounts.sql` `in_room`: a `hotspot:%` branch (a visit row, `last_seen` within 20 minutes) | Step 3 |
| `chat_accounts.sql` `message_visible`: `hotspot:%` visible only to people in the room and only for 24 hours | Step 4 |
| `chat_accounts.sql` `stamp_message`: a hotspot branch (account needed, 240 characters, the speed and duplicate rules, the filter, alias and look instead of handle, mute check) | Step 4 |
| `chat_accounts.sql` `purge_expired_rooms`: delete `hotspot:%` messages older than 7 days | Step 4 |
| `chat_accounts.sql` `send_wave`, `my_waves`, and the Phase 5 link-up and vibe functions: treat `hotspot:` like `spot:` | Step 5 |
| Client `src/lib/chat.ts`: a `hotspot` kind in `PeopleOf` and `usePeople`; `RoomView` reused with new copy | Step 3 |

Unchanged: `play_tick` and `play_fix` (hotspots do not use them), `game_drops`, `spawn_points`, `no_spawn_zones`, `spawn_rules`, claims and the 150 XP ceiling. `lagos_area_for` is used when picking a junction's area.

Demo mode keeps working: the hotspot layer reads fixtures from `src/lib/demoData.ts` when there is no Supabase, with made-up counts and a local-only room, like the chat demo does today.

## 11. Build plan

Each step ends with the app playable and tests passing (`supabase/tests/hotspots_*.sql` for the database parts). No step needs Play mode Phases 4 to 6, except where said.

| Step | What | Size | Jae can try |
|---|---|---|---|
| 0 | Jae answers section 12. Add `scripts/hotspots/find-junctions.mjs`, run the full ranking for the other 14 areas, load `hotspot_candidates.sql` | S | Pick the hotspots from the shortlist |
| 1 | `supabase/hotspots.sql`: table, RLS, `hotspot_list()`, seed with the picks (Yaba 3 and Lekki Phase 1 2 first). Tests: no pick inside a no-spawn zone, anon reads active rows only | S | The list in the database |
| 2 | Map layer: marker, near-you row in the tray, sheet (no entering yet), deep link, demo fixtures, the Lagos-only refusal replaced by the full list. Files: `src/components/play/HotspotMarker.tsx`, `HotspotSheet.tsx`, a `useHotspots` hook; edits in `PlayLayer.tsx` and `Tray.tsx` | M | See hotspots near you and tap one |
| 3 | Presence: `hotspot_visits`, `enter_hotspot`, `leave_hotspot`, `hotspot_pulse`, `in_room` branch, the run animation, heads around the junction, Bring avatar home, one avatar one place. Needs the sign-up sheet, not Phase 4 | M | Two phones in one room as heads |
| 4 | Chat: `stamp_message`, `message_visible`, purge edits (Ola reviews), the filter, limits, slow mode, mutes, `RoomView` reuse, the admin Hotspots section, the privacy page line. Tests for every rule | L | Chat in Jibowu from two phones; try to break it |
| 5 | Heads actions: Wave, Link up, Vibe (rides on Play mode Phase 5; only adds the `hotspot:` prefix) | S | Tap a head |
| 6 | Daily reward and Regular badge | S | 10 XP after 5 minutes |
| 7 | Roll out: Yaba alone for a week, then Lekki Phase 1, then wave 1; watch peak avatars, messages, reports per 100 messages | | Real people |
| Later | Lobbies of 50, the area chip, hotspot nights, an opt-in alert when a hotspot lights up, Paz prompts | | |

Order matters for safety: do not open step 4's chat to real Hoppers before the filter, limits, report handling, mute and pause switch all exist.

## 12. Open questions

### For Jae

1. **Chat reverses a Play rule.** Play mode section 7 says "No spot chat, ever. Wave, then DM." Hotspots have a group chat. Spot rooms stay chat-free (a 90 minute prize race with heads from within 3 km); hotspots have no prize and no location link, so chat is safe. OK to change that one line when you approve this?
2. **The starting list.** Is Yaba 3, Lekki Phase 1 2 and the table in section 4 right? Open Yaba alone first, or wave 1?
3. **The first five junctions.** Jibowu, Ojuelegba, Yaba market side for Yaba; Phase 1 Admiralty Way and Phase 1 Freedom Way for Lekki Phase 1. Please correct the local names and swap any (UNILAG gate for Yaba market side, say).
4. **Anyone anywhere.** Section 6 lets a Hopper outside Lagos, or with location off, see and enter hotspots, with an account. OK?
5. **The events map.** A small hotspot icon on the main map that opens Play? Boxes still never show there.
6. **Age.** Is there an age rule (18 and over)? A public chat of strangers needs it.
7. **Area chip.** Opt-in "YABA" tag next to your alias, off by default, from the area the Hopper chose? Or a room line like "mostly from Yaba tonight" with no names? Or neither?
8. **Night.** Slow mode 00:00 to 05:00 and 24/7 otherwise. Who looks at reports in the morning, and how fast must they be answered?
9. **Alias.** The same alias every visit to a hotspot (regulars know each other), or a fresh one each day?
10. **Reward.** 10 XP a day for a 5 minute stay, and a Regular badge at 4 days. Too small, about right?
11. **Names.** Room named after the place ("Jibowu") or the area ("Yaba 1, 2, 3")?

### For Ola

1. **Why was area chat and presence removed?** What did you see that made you drop `presence`, `whos_near` and BASE: location privacy, harassment, moderation load, load on the database, or just scope? Section 3 is my guess from the code.
2. OK to add `hotspot:` branches to `in_room`, `message_visible`, `stamp_message` and `purge_expired_rooms` (listed in section 10)?
3. **Realtime cost.** Every message in a 60 person room is checked against `message_visible` for each subscriber. Fine at that size, or should hotspots poll with a cursor?
4. **Rate limits per channel.** `stamp_message` allows 8 messages in 30 s everywhere. OK to let a channel set its own stricter number?
5. **Account.** Is `has_account()` enough to post in a hotspot, or wait for the verified email from Play mode Phase 6?
6. **Retention.** 7 days for hotspot messages (your event rooms are 3 days after the event). OK?
7. **Moderation.** Where do reports get read today? The plan adds a Hotspots section to the admin desk and a per-alias mute. Do you want to own that, and is a hotspot ban flag in `profile_private` the right place?
8. **Aliases.** `identity_for` gives one alias per user, channel and anon flag for ever. Is a once-a-day re-roll (delete and recreate the row) safe for your reports and blocks, which store the key?
