# Hoppaz Hotspots

Status: built and open (wave 1), 10 Oct 2026. The plan below was written 9 Oct and updated 10 Oct; section 15 says what the review of 10 Oct found and what was changed. Jae's zone decision of 9 Oct replaces the size classes (section 4): Lagos is cut into 13 zones with one hotspot each, and the zones, junctions and split hints are built as data (`supabase/hotspot_zones.sql`, made by `scripts/hotspots/zones.mjs`, tested by `supabase/tests/hotspot_zones_test.sql`). The database for steps 1, 3, 4 and 6 is built (10 Oct: `supabase/hotspots.sql`, tested by `supabase/tests/hotspots_test.sql`, contract in section 13). The room screen, the 18+ sheet, the reward moment and the admin section are built (10 Oct, section 14); the Play screens live in `src/components/play/hotspots/`. A safety, correctness and phone review of 10 Oct found 26 things; all are fixed or answered (section 15). It sits on top of Play mode ([PLAY-MODE.md](PLAY-MODE.md)) and Ola's chat system (`supabase/chat_accounts.sql`). Jae's rows in [DECISIONS.md](DECISIONS.md) win over any number here.

Jae's words, tidied from his voice note: "Three spots in Yaba that are always open 24/7, a general group that people in Yaba can enter and have conversations and vibe. Anyone anywhere can enter, but it should be closer to the people in that region. When you click Play you see the hotspots near you on the map, you move your avatar there, you enter the conversation and enjoy yourself or interact with people from the same community. Start with three in Yaba, then scale: Phase 1 maybe two, very large areas several. Call them HOTSPOTS. They should always be at junctions."

Then, 9 Oct, replacing the scale idea: "Segment Lagos into zones. Just segment the zones that are very large, and each zone has one room (one hotspot). Then over time, as more people come, we break down the rooms. Keep it simple." Lekki is one zone, from Phase 1 along Lekki down to one side, then cut; Ikoyi has its own zone.

## 1. In three sentences

1. A hotspot is a fixed meeting place for avatars at a real road junction, open 24 hours a day, with a group chat and a crowd of heads.
2. Open Play and you see your zone's hotspot and the ones near you; tap one, your avatar runs there, and you are in the room with whoever else is there. Anyone, from anywhere, can enter.
3. Lagos is cut into 13 big zones with one room each. The zone a Hopper is in is their home hangout (the phone works it out; the server never learns where they are), anyone can visit any room, and nobody's real position is ever shown or sent.

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

## 4. Zones: one room per big zone

Jae, 9 Oct 2026, replacing the size-class rule that stood here: "Segment Lagos into zones. Just segment the zones that are very large, and each zone has one room (one hotspot). Then over time, as more people come, we break down the rooms. Keep it simple." His examples: Lekki is one zone, from Phase 1 along Lekki down to one side, then cut; Ikoyi has its own zone. The zone you are standing in is your hotspot; anyone can still visit any hotspot.

So there is no "3 in Yaba, 2 in Lekki Phase 1" any more, no size classes and no 30 hotspots. There are **13 zones and 13 hotspots**, built as data (`supabase/hotspot_zones.sql`, made by `scripts/hotspots/zones.mjs` from OpenStreetMap, tested by `supabase/tests/hotspot_zones_test.sql`). More rooms come later by breaking a busy zone in two (below), not by planning them now.

### How the zones are cut

- **Real boundaries.** Lagos State (OpenStreetMap `admin_level` 4) and its 20 LGAs (`admin_level` 6). OpenStreetMap has no LCDA or ward shapes for Lagos, so the LGA line is the finest real boundary there is. Zones are groups of whole LGAs, with one exception: Eti Osa (Ikoyi, Victoria Island and all of Lekki) is cut along Admiralty Way (west leg, then Akiogun Road) and Chevron Drive.
- **The lagoon and the creeks are the edge.** A zone never holds land on both sides of the lagoon or a creek: every zone is `mainland` or `island`, and Five Cowries Creek keeps Victoria Island apart from Ikoyi and Lagos Island.
- **Water margin.** Each zone reaches 300 m into the water or sea around it, so a position that drifts on a shoreline is still inside.
- **A hotspot is never on an edge.** LGA lines often run along a major road, so a junction on that road can sit on the line (Jibowu, Ojota and Obalende do). The 150 m around each hotspot belongs to its zone.
- **Nothing left out.** All 2,856 km2 of land in the state is in a zone (about 31,500 m2 of slivers on the state border are not); no two zones overlap (400 m2 of rounding, 1 m2 of it on land); the 16 area centres are each in exactly one zone, on their own side; and all 666 spawn points inside the state are in a zone. 47 spawn points the importer caught on or over the line in Ogun State (Ota, Sango, Ogijo, Agbara) are not, so a phone that is inside no zone treats the nearest zone as its own.
- **Checked again from the database.** The build checks its own shapes; on 10 Oct I read the shapes back out of the `hotspots` table and checked them against the land (`scripts/hotspots/check-land.mjs`, land is the state minus the sea minus the lagoon, from OpenStreetMap). Land in no zone: 31,503 m2 in 131 pieces, every piece within 30 m of the state line, so no gap between two neighbouring zones. Overlap: 398 m2 in all, 1 m2 on land. No zone holds land on both sides of the lagoon, and each is on the side it says. Each hotspot is 148 m or more from its zone edge (the 150 m rule, less the simplification), 177 m or more from water (Ikoyi is the closest) and 537 m or more from a military, prison, port or airport zone (Lagos Island is the closest). The SQL test `supabase/tests/hotspot_zones_test.sql` checks overlap, the lagoon, the no-spawn rules, the area centres and the spawn points inside the database itself, and passes.
- **The phone finds its zone.** The zone shapes are public (the `hotspots` table, about 120 KB of shapes in all). The phone does a point-in-polygon test with its own fix, so the server never learns where anyone is. Hotspots are never worked out from a stored position.

### The 13 zones

Shape km2 includes the water margin; land km2 is land only. "Holds" is which of the 16 areas of the `areas` table have their centre in the zone. Waves are the roll-out order of section 11 (wave 1 is where Hoppaz events are).

See them on a phone: open `/mocks/hotspots` on the phone proxy (`localdb/phone-https/mocks/hotspots.html`). It draws the 13 zones and 13 pins on the app's night map, opens a card per hotspot (name, zone, the two roads, the places in the zone, the first split line, and a short "Check this name" or "Worth knowing" note where section 4 has one), has a "Where am I" button that works out your zone on the phone only, and a toggle that draws each zone's first split line dashed. It is built from the `hotspots` table by `scripts/hotspots/build-map-mock.mjs` (page in `scripts/hotspots/hotspots-map.template.html`); run it again after any change to the zones, with `--deps=<the scratch install and Overpass cache that zones.mjs uses>`. `scripts/hotspots/check-map.mjs` drives the page in one headless Chrome at 390x844 and 375x667 (52 checks: it renders, the tap cards and notes, Where am I for five test points compared with PostGIS, the splits toggle, no location sent anywhere) and kills that Chrome when it ends; run it alone, never twice at once.

| Zone | Side | Wave | Hotspot | Two roads (OpenStreetMap, class) | km2 shape / land | Holds |
|---|---|---|---|---|---|---|
| Yaba | mainland | 1 | Jibowu | Herbert Macaulay Street (trunk) x Murtala Muhammed Way (primary) | 29.6 / 25.6 | Yaba, Shomolu |
| Lekki | island | 1 | Lekki Phase 1 (Admiralty Way) | Admiralty Way (primary) x Fatai Idowu Arobieke Street (tertiary) | 51.8 / 39.9 | Lekki Phase 1 |
| Victoria Island | island | 1 | Adeola Odeku | Akin Adesola Street (primary) x Adeola Odeku Street (secondary) | 24.9 / 19.8 | Victoria Island |
| Ikeja | mainland | 1 | Allen Roundabout | Obafemi Awolowo Way (primary) x Allen Avenue (secondary) | 86.5 / 86.5 | Ikeja, Maryland |
| Surulere, Mushin and Oshodi | mainland | 2 | Ojuelegba | Western Avenue (primary) x Ojuelegba Road (primary) | 83.0 / 82.6 | Surulere, Mushin |
| Ikoyi | island | 2 | Bourdillon (Alexander Avenue) | Bourdillon Road (primary) x Alexander Avenue (primary) | 19.7 / 14.9 | Ikoyi |
| Lagos Island | island | 2 | Obalende | Obalende Road (secondary) x Massey Bamgboshe Street (secondary) | 8.9 / 6.0 | Lagos Island |
| Ojota and Gbagada | mainland | 3 | Ojota | Ikorodu Road (primary) x Ogudu Road (secondary) | 76.0 / 69.9 | Gbagada, Ogudu, Magodo |
| Festac and Apapa | mainland | 3 | Mile 2 | Lagos-Badagry Expressway (primary) x Jakande Estate Road (tertiary) | 172.3 / 135.3 | Festac, Apapa |
| Ajah and beyond | island | 3 | Ajah (Mobil Road) | Lekki-Epe Expressway (trunk) x Mobil Estate Road (tertiary) | 1,051.2 / 933.0 | Ajah |
| Alimosho | mainland | 4 | Ikotun | Idimu - Ikotun Road (primary) x Egbe Road (primary) | 178.9 / 178.8 | none |
| Ojo and Badagry | mainland | 4 | Iyana Iba | Lasu-Isheri Road (primary) x Lagos-Badagry Expressway (primary) | 583.9 / 518.3 | none |
| Ikorodu and Epe | mainland | 4 | Ikorodu Garage | Ikorodu Road (trunk) x Ayangburen Road (primary) | 774.8 / 745.1 | none |

The places in each zone (`zone_label` in the table):

| Zone | Places |
|---|---|
| Yaba | Yaba, Jibowu, Ebute Metta, Akoka, Shomolu, Bariga, Makoko (Lagos Mainland and Shomolu LGAs) |
| Lekki | Lekki Phase 1 to Chevron and Jakande, Ikate, Osapa, Ikota |
| Victoria Island | Victoria Island, Oniru, Maroko, Eko Atlantic |
| Ikeja | Ikeja, Alausa, Opebi, Maryland, Ogba, Ojodu, Agege (Ikeja, Agege and Ifako-Ijaiye LGAs) |
| Surulere, Mushin and Oshodi | Surulere, Mushin, Ojuelegba, Ilupeju, Isolo, Oshodi, Okota (Surulere, Mushin and Oshodi-Isolo LGAs) |
| Ikoyi | Ikoyi, Falomo, Banana Island, Parkview |
| Lagos Island | Marina, CMS, Obalende, Idumota, Onikan |
| Ojota and Gbagada | Ojota, Ketu, Ogudu, Magodo, Gbagada, Anthony, Oworonshoki, Mile 12 (Kosofe LGA) |
| Festac and Apapa | Festac, Mile 2, Amuwo Odofin, Apapa, Ajegunle (Amuwo Odofin, Apapa and Ajeromi-Ifelodun LGAs) |
| Ajah and beyond | Ajah, Sangotedo, Awoyaya, Ibeju-Lekki (east of Chevron Drive, south of the lagoon) |
| Alimosho | Egbeda, Ikotun, Igando, Idimu, Ipaja, Iyana Ipaja (Alimosho LGA) |
| Ojo and Badagry | Ojo, Alaba, Okokomaiko, Iba, Badagry (Ojo and Badagry LGAs) |
| Ikorodu and Epe | Ikorodu, Itoikin, Epe (Ikorodu LGA, and Epe north of the lagoon) |

### Names, checked against OpenStreetMap

Names are as OpenStreetMap spells them, except "Murtula Muhammed Way", which OpenStreetMap misspells and the tables show as Murtala Muhammed Way. The local names (Jibowu, Obalende, Mile 2...) are my reading of the coordinates, so on 10 Oct I checked all 26 junctions (the 13 hotspots and the 13 more in the split hints) against OpenStreetMap with `scripts/hotspots/check-names.mjs`. It prints the evidence for each one.

- **The roads.** For all 26 junctions the two roads meet in OpenStreetMap, and both road names are OpenStreetMap's. 25 meet at a shared node (the furthest is 28 m from the point, most are under 15 m). The 26th, Ikorodu Garage, is a roundabout with no name of its own: the two roads do not share a node, they both reach the same ring, and the point is the middle of it (1 m).
- **The local name.** A name is **backed** when the road at the junction carries it as its own name, or OpenStreetMap has a place of that name within 1 km or a named feature of that name within 500 m. Every word of the name counts. A road named for the two places it runs between (Lekki-Epe Expressway, Ojo - Igbede Road) does not back either place. A name that is not backed is **unsure**.
- **Confirmed.** Backed is not confirmed: `name_confirmed` is false until Jae has looked. On 10 Oct he settled three (below), and `name_confirmed` is true for exactly those three: Mile 2, Bourdillon and Ikorodu Garage. The other ten stay false. `zones.mjs` sets the flag from the `confirmed` field of PICK, and a run again can switch it on but never off.

The 13 hotspots:

| Hotspot | What OpenStreetMap has nearby | Name |
|---|---|---|
| Jibowu (Yaba) | Jibowu (suburb) 229 m | Backed |
| Lekki Phase 1 (Admiralty Way) | Lekki Phase I (town) 720 m; Admiralty Way is one of the roads | Backed |
| Adeola Odeku (Victoria Island) | Victoria Island (town) 246 m; the traffic signals here are named for Akin Adesola and Adeola Odeku, 7 m | Backed |
| Allen Roundabout (Ikeja) | Ikeja (city) 671 m; signals named Obafemi Awolowo/Allen, 26 m | Backed |
| Ojuelegba (Surulere, Mushin and Oshodi) | Ojuelegba (suburb) 125 m | Backed |
| Bourdillon (Ikoyi) | No place within 1.8 km; Bourdillon Road is one of the roads | Backed by the road, confirmed 10 Oct |
| Obalende (Lagos Island) | Obalende (suburb) 111 m; Obalende Motor Park 46 m | Backed |
| Ajah (Mobil Road) | Ajah (town) 436 m; the Lekki-Ajah Flyover meets the expressway 33 m from the point | Backed |
| Mile 2 (Festac and Apapa) | Mile 2 (town) 422 m | Backed, confirmed 10 Oct |
| Ojota | Ojota (suburb) 168 m | Backed |
| Ikotun (Alimosho) | Ikotun (town) 468 m; Ikotun Terminal bus station 14 m | Backed |
| Iyana Iba (Ojo and Badagry) | Iyana-Iba Market 37 m | Backed |
| Ikorodu Garage (Ikorodu and Epe) | Ikorodu (city) 165 m; the Ikorodu Bus Terminal stop position (node 6291068229) carries `loc_name` "Ikorodu Garage", 175 m west of the point on Ikorodu Road | Backed by that `loc_name`, confirmed 10 Oct |

**Jae's three calls, 10 Oct 2026.** Mile 2 was the one unsure hotspot and Ikorodu was the one I could not place. Jae settled both, and kept Bourdillon.

| Hotspot | Jae's call | Final point | Two roads (OpenStreetMap, class) |
|---|---|---|---|
| Mile 2 (Festac and Apapa) | Move it to the real Mile 2 | 6.46019, 3.30985 | Lagos-Badagry Expressway (primary) x Jakande Estate Road (tertiary) |
| Bourdillon (Ikoyi) | Keep it | 6.44491, 3.44976 | Bourdillon Road (primary) x Alexander Avenue (primary) |
| Ikorodu Garage (Ikorodu and Epe) | "The one after Agric" | 6.62045, 3.50345 | Ikorodu Road (trunk) x Ayangburen Road (primary) |

- **Mile 2** moved from the Festac 1st Avenue crossing (6.46018, 3.30115) to the Expressway with Jakande Estate Road, the named crossing nearest OpenStreetMap's Mile 2 place (422 m; the old crossing was 1,362 m from it). It is 961 m east of the old point, in the same zone and in Amuwo Odofin LGA, so the first split child (Festac and Amuwo Odofin) keeps it. It is outside every no-spawn zone, 240 m from water, 702 m from the nearest military zone (Signals Barracks) and 643 m inside the zone edge. The two roads share a node (0 m).
- **Bourdillon** is unchanged, so Ikoyi's hotspot stays Bourdillon Road with Alexander Avenue and Falomo Roundabout stays out under the 100 m military rule (see the flags below). It is 177 m from water, 999 m from the nearest military zone and 323 m inside the zone edge.
- **Ikorodu Garage** replaces the Ayangburen Road and Beach Road crossing (6.61282, 3.50117), which was 885 m south-west of it. The first split child (Ikorodu) keeps it. It is outside every no-spawn zone, 2,419 m from water, 16.4 km from the nearest military zone and 3,199 m inside the zone edge. The evidence follows.

**Ikorodu Garage, the evidence.** No OpenStreetMap feature has Garage in its `name`, `alt_name` or `old_name`. One does in its `loc_name` (the local name): the Ikorodu Bus Terminal stop position (node 6291068229, 6.62113, 3.50202, on Ikorodu Road), 175 m west of the point. A search of the same three tags for "agric" finds only the four Agric bus stops. So the Garage is the Ikorodu Bus Terminal stretch, and the spot is found from Agric, along the road, by what comes next. Coming from Lagos on the Lagos-Ikorodu road (OpenStreetMap: Ikorodu Road, `trunk`, ref A1, a one-way pair), west to east:

1. **Agric.** Four bus stop nodes on Ikorodu Road: "Agric" (node 5674251021, 6.62541, 3.48393), the "Agric" stop position (6291068706), and two "Agric Bus Stop" stop positions (6291068705 at 3.48633 E and 6291068704 at 3.48783 E). They sit either side of where Ikorodu Road crosses Owutu-Isawo Road (6.62571, 3.48467), a tertiary road.
2. **Then nothing big for 1.8 km.** Aruna bus stop (1,272 m before the pick), Benson bus stop (514 m before), then the Ikorodu Bus Terminal (a `bus_station` way and its stop position, the one tagged Ikorodu Garage, 175 to 181 m from the pick). The BRT lane's last mapped point is about 90 m from the pick. Between Agric and the pick, Ikorodu Road meets only residential and service streets, footways and two pairs of slip links, not one other road of class trunk to tertiary.
3. **The next big junction.** An unnamed `trunk` roundabout (way 134580953) at 6.62045, 3.50345, where Ikorodu Road ends and three roads meet: Ikorodu Road comes in from the west, Sagamu Road (the same A1 trunk) carries on to the north-east, and Ayangburen Road (primary, F270) leaves south into the town. Ikorodu (city) is 165 m away. It is 1.8 km from the eastern Agric Bus Stop and 2.2 km from the western Agric stop. The roundabout after it (Sagamu Road with Old Lagos Road, 6.62634, 3.50612) is 718 m beyond it, so it comes second.
4. **The two roads** are Ikorodu Road and Ayangburen Road. Sagamu Road is not named because it is Ikorodu Road's own continuation (the same A1), not a second road.

Why the build missed it before: the ring has no name, so no two named roads share a node there, and the junction finder only looked at shared nodes. `zones.mjs` now reads the roundabouts around an anchor marked "rings" in DISCOVER (the `ikorodu-garage` entry) and counts the named roads that reach one (on the ring, or within 60 m of it) as meeting there. `check-names.mjs` accepts the same. Every other anchor reads exactly as before: the zone shapes in `hotspot_zones.sql` are byte for byte the same, and only the three rows and their split hints changed.

The 13 junctions that appear only in a split hint (below): 7 are backed and 6 are unsure.

| Split junction | What OpenStreetMap has nearby | Name |
|---|---|---|
| Oshodi | Oshodi (town) 206 m | Backed |
| Sangotedo | Sangotedo (town) 497 m | Backed |
| Shasha | Shasha Road is one of the roads | Backed |
| Liverpool (Apapa) | Liverpool Road and Liverpool Roundabout are the roads | Backed |
| Ikoyi (Mobolaji Johnson Road) | Ikoyi (town) 386 m | Backed |
| Balogun (Broad Street) | Balogun Street is one of the roads | Backed |
| Gbagada (Diya Street) | Gbagada (town) 605 m; OpenStreetMap names few Gbagada junctions | Backed |
| **Oniru** | Nothing called Oniru within 1 km (Itirin 1.1 km, Maroko 1.6 km) | **Unsure** |
| **Ikate (Lekki Beach Road)** | The nearest place is Jakande, 255 m away; Ikate is not within 1.6 km | **Unsure** |
| **Agege (Pen Cinema)** | Agege (suburb) is 554 m away, but nothing is mapped as Pen Cinema | **Unsure** |
| **Yaba Market (Commercial Avenue)** | Yaba (suburb) is 264 m away, but no market is mapped | **Unsure** |
| **Epe (Old Lagos Road)** | Epe (city) is 2.7 km away | **Unsure** |
| **Ojo (Igbede Road)** | Ojo (town) is 2.2 km east; the nearest places are Sabo Oniba 727 m and Igbede 1.5 km | **Unsure** |

Backed names that are still worth a look (the name is fine, something else may not be):

| Hotspot | Why |
|---|---|
| Bourdillon (Ikoyi) | Falomo Roundabout is the better-known crossing, but it sits 51 m from the Giwa defence headquarters (a military no-spawn zone), so the 100 m rule of section 5 keeps it out. Jae kept Bourdillon on 10 Oct. OpenStreetMap's Alexander Roundabout is 510 m north of this crossing. |
| Jibowu (Yaba) | OpenStreetMap puts the LGA line through the junction itself (Jibowu is Shomolu LGA; the other side is Mushin LGA), so the 150 m around it is given to Yaba. |
| Ojota (Ojota and Gbagada) | The junction is Ikorodu Road with Ogudu Road, on the line between the Ikeja and Kosofe LGAs; the 150 m around it is given to this zone. Ketu (Ikosi Road x Ikorodu Road) is the alternative. |
| Obalende (Lagos Island) | On the line with Ikoyi; the 150 m around it is given to Lagos Island. |
| Adeola Odeku (Victoria Island) | The nightlife strip is Adeola Odeku Street; the crossing named is with Akin Adesola Street. |
| Ikotun (Alimosho) | OpenStreetMap names few Alimosho junctions. Ikotun is the clearest; Iyana Ipaja and Egbeda are the other big ones. |
| Ikorodu Garage | OpenStreetMap tags the Ikorodu Bus Terminal stop position `loc_name` "Ikorodu Garage", 175 m before this roundabout on Ikorodu Road. This is Jae's call of 10 Oct: the roundabout after the Agric bus stops, where Ikorodu Road ends (evidence above). |

I am sure of Allen Roundabout, Ojuelegba and Lekki Phase 1 on Admiralty Way as crossings as well as names. One correction from the check: an earlier flag said the Ajah roundabout and flyover were a few hundred metres east of the Ajah pick. OpenStreetMap has the Lekki-Ajah Flyover 33 m from it, so that flag was wrong and is gone.

### Breaking a zone down later (the split rule, written as data)

Each zone row has `parent_id` (null for these first zones) and a `split_hint` (jsonb) holding the first cut and the two junctions that would become the new hotspots.

- **When.** The zone's room is busy for a week: 60 or more people at its daily peak, 7 days in a row (`trigger: {"peak_people": 60, "days": 7}` in the hint). The numbers are mine, not Jae's (he said only "as more people come"); they are an open question in section 12. A quiet zone is never paused or merged: it stays the home room of its Hoppers and reads "quiet right now".
- **How.** Staff split it in the admin desk. Two child rows are inserted with `parent_id` set to the parent, the shapes are the two halves of the parent (the union of the named LGAs, or the parent cut by the straight line), and each takes the junction written in the hint. The parent's status becomes `split`: it stays as history and is no longer shown (the app reads only `active` and `planned` rows). The phone finds its zone from the public shapes, so nobody has to be moved.
- **Which cut.** The road or boundary it would be cut along first. Where a zone is several LGAs, the cut is an LGA line (`cut_kind: "lga"`, both halves named). Where it is one LGA, it is a straight line along a named road (`cut_kind: "line"`, `axis` `ns` or `ew`, and `at` the longitude or latitude of the line).
- **Children inherit nothing.** Each child is a new room that starts empty: no messages, no head count, no per-room mutes. The chat history stays with the parent, which is no longer shown and is deleted on the normal 7-day clock (section 7). Nobody is moved or asked anything: the phone works out the zone each time from the public shapes, so a Hopper simply lands in the child whose half they are standing in.
- **Rooms stay 800 m apart.** The two child junctions are at least 800 m apart and each is at least 100 m from a straight cut. A child keeps the parent's junction when it lies in that child's half (a new room at the same crossing, still with no history).

| Zone | First cut | Child 1 and its hotspot | Child 2 and its hotspot |
|---|---|---|---|
| Yaba | Lagos Mainland LGA and Shomolu LGA line | Yaba and Ebute Metta: Yaba Market (Murtala Muhammed Way x Commercial Avenue) | Shomolu and Bariga: Jibowu |
| Lekki | Platinum Way (line, north-south, 3.5024 E) | Lekki Phase 1 (west): Admiralty Way, as the parent | Ikate and Chevron (east): Ikate (Lekki-Epe Expressway x Lekki Beach Road) |
| Victoria Island | Adetokunbo Ademola Street (line, north-south, 3.4304 E) | Victoria Island (west): Adeola Odeku, as the parent | Oniru and Maroko (east): Oniru (Maroko Road x Lekki-Epe Expressway) |
| Ikeja | Ikeja LGA boundary | Ikeja LGA: Allen Roundabout, as the parent | Agege and Ifako-Ijaiye LGAs: Agege (Pen Cinema) (Capitol Road x Alfa Nla Road) |
| Surulere, Mushin and Oshodi | Oshodi-Isolo LGA line | Surulere and Mushin LGAs: Ojuelegba, as the parent | Oshodi and Isolo: Oshodi (Agege Motor Road x Apapa-Oworonshoki Expressway) |
| Ikoyi | MacPherson Avenue (line, north-south, 3.4428 E) | Old Ikoyi (west): Ikoyi (Mobolaji Johnson Road x Murtala Muhammed Drive) | Parkview and Banana Island (east): Bourdillon, as the parent |
| Lagos Island | Nnamdi Azikiwe Street (line, north-south, 3.388 E) | Idumota and Marina (west): Balogun (Broad Street x Balogun Street) | Obalende and Onikan (east): Obalende, as the parent |
| Ojota and Gbagada | Ogudu Road, carried east-west (line, 6.572 N) | Ojota, Ketu and Magodo (north): Ojota, as the parent | Gbagada and Oworonshoki (south): Gbagada (Diya Street x Ajayi Aina Street) |
| Festac and Apapa | Amuwo Odofin LGA line | Festac and Amuwo Odofin: Mile 2, as the parent | Apapa and Ajegunle (Apapa and Ajeromi-Ifelodun LGAs): Liverpool (Liverpool Road x Liverpool Roundabout) |
| Ajah and beyond | Addo Road (line, north-south, 3.5655 E) | Ajah (west): Ajah (Mobil Road), as the parent | Sangotedo and beyond (east): Sangotedo (Lekki-Epe Expressway x Cardinal Okogie Road) |
| Alimosho | Egbeda-Idimu Road, carried south to Egbe Road (line, north-south, 3.285 E) | Ikotun and Igando (west): Ikotun, as the parent | Egbeda and Idimu (east): Shasha (Ejigbo Road x Shasha Road) |
| Ojo and Badagry | A line between Ojo and Iba (north-south, 3.185 E; no named road follows it) | Ojo and Badagry (west): Ojo (Ilogbo Road x Ojo - Igbede Road) | Alaba and Iba (east): Iyana Iba, as the parent |
| Ikorodu and Epe | Ikorodu LGA line | Ikorodu: Ikorodu Garage, as the parent | Epe: Epe (Lekki-Epe Expressway x Old Lagos Road) |

Badagry town has no crossing of two named roads in OpenStreetMap, so Ojo and Badagry is first cut between Ojo and Iba, not at the Badagry LGA line.

### What changed from the starting proposal, and why

The starting proposal was a list of places; the LGA lines say where each place really falls. Changes:

1. **Gbagada and Anthony go with Ojota** (Kosofe LGA), not with Shomolu. The Kosofe and Shomolu LGA line runs between them. Shomolu and Bariga join Yaba (Lagos Mainland and Shomolu LGAs) instead.
2. **Maryland goes with Ikeja** (Ikeja LGA), not with Ojota. The Ojota interchange is on the line, and the 150 m rule gives it to the Ojota zone.
3. **Ilupeju goes with Surulere and Mushin** (Mushin LGA), not with Gbagada and Shomolu.
4. **Surulere and Mushin also holds Oshodi-Isolo LGA** (Oshodi, Isolo, Okota). Without it the proposal left the Oshodi and Isolo land in no zone. The zone is named for the three.
5. **Ikorodu also holds Epe north of the lagoon** ("Ikorodu and Epe"), and **Ajah also holds Ibeju-Lekki and the Epe land south of the lagoon** ("Ajah and beyond"), because the proposal said "Ibeju-Lekki, Epe as one outer zone if needed" and the lagoon is the edge between them.
6. **Jibowu is Yaba's hotspot and Ojuelegba is Surulere's.** Jae's example said "Ojuelegba or Jibowu for Yaba". The OpenStreetMap LGA line puts Ojuelegba in Mushin LGA, so it is in the Surulere zone; Jibowu is in the Yaba zone (the line runs through it). Both are used, in neighbouring zones, 950 m apart.
7. **Ikoyi's hotspot is Bourdillon and Alexander, not Falomo,** because of the 100 m military rule (see the flags). Jae kept it on 10 Oct.
8. **Oniru is in Victoria Island's zone and Phase 1 starts the Lekki zone,** because Eti Osa is cut along Admiralty Way (west leg) and Akiogun Road, and Lekki runs from there to Chevron Drive and Jakande, as Jae said.
9. **13 zones, within the 10 to 14 asked for.** Waves: 1 Yaba, Lekki, Victoria Island, Ikeja; 2 Surulere and Mushin, Ikoyi, Lagos Island; 3 Ojota and Gbagada, Festac and Apapa, Ajah and beyond; 4 Alimosho, Ojo and Badagry, Ikorodu and Epe (the outer zones exist so nobody is left out).

Dropped from the old section 4: the size classes (L, M, S), "add a hotspot at 25 avatars, pause one at fewer than 3", and the starting list of 30. A busy zone is split instead; a quiet one stays.

## 5. Where they go: junctions

**A hotspot sits at a real junction of two named roads.** Not a park, not a market, not a bus stop. One per zone (section 4), picked once by staff and never moved. Hotspots are online: nobody has to stand at the junction, and the app never asks them to (junctions are not safe places to wait).

### Rules for a junction

| Rule | Value |
|---|---|
| Roads | Two roads with different names meeting at one node, or both reaching the same roundabout when the ring has no name of its own (Ikorodu Garage). Classes motorway, trunk, primary, secondary, tertiary (see the finding below) |
| Merge | Junction nodes within 60 m of each other count once (dual carriageways, slip roads) |
| Inside its zone | The point is inside the zone shape. A junction on a zone line is allowed: the 150 m around a hotspot goes to its zone (section 4) |
| Avoid | Inside any active `no_spawn_zones` zone; within 60 m of a water zone; within 100 m of a military, prison, port or airport zone; a node that is only on a bridge or tunnel |
| Prefer busy public junctions | Score: road class of the top two roads (motorway or trunk 4, primary 3, secondary 2, tertiary 1) + 1 for each extra road (up to 2) + 3 if traffic signals within 60 m + 2 for a roundabout + 0.4 per public place within 150 m (bus stop, market, fuel, bank, food, school, worship, clinic; up to 20) |
| Spread | Hotspots are at least 800 m apart (the closest pair of the 13 is Jibowu and Ojuelegba, 950 m); the two child junctions of a split are at least 800 m apart too |

In the zone picks the two roads are named by hand (the best-known crossing) and the score only chooses between nodes of those roads, because OpenStreetMap has few signals and places mapped in Lagos. `scripts/hotspots/zones.mjs` does this, and `--discover` prints the best-scoring junctions around any place.

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

Overpass cannot easily say "nodes shared by two differently named ways", so a short script does the rest: put every node of every way in a map, keep nodes on two or more ways with different names, merge within 60 m, then apply the rules above, with the zone checks run against the local database (`no_spawn_zones` and the zone shapes). That script is `scripts/hotspots/zones.mjs` (build step 0, done). Two more scripts re-check its work from the database and from OpenStreetMap: `scripts/hotspots/check-land.mjs` (gaps, overlap and the lagoon) and `scripts/hotspots/check-names.mjs` (the two roads and the nearest places of every junction). Both take `--deps=<the scratch install and Overpass cache that zones.mjs uses>`.

### What the first query found (Yaba and Lekki Phase 1, before the zones)

Kept as the first shortlist and as a source for later splits. Jibowu, Ojuelegba and Admiralty Way from it are now zone hotspots (Yaba, Surulere and Lekki), and the Yaba market side is the first split child of Yaba (section 4). The rest are alternates.

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

**Does every zone have junctions?** Yes. The 13 picks and the 13 other junctions of the split hints are in section 4 and in `supabase/hotspot_zones.sql`, found by the rules above and all outside every active no-spawn zone (`supabase/tests/hotspot_zones_test.sql` checks this against the local database). OpenStreetMap names few junctions in the outer zones (Alimosho, Ojo and Badagry, Ikorodu and Epe) and in Gbagada, and none in Badagry town, so those picks are flagged in section 4 and staff may add one by hand.

Every candidate above is outside every active no-spawn zone (checked against the 119 zones in the local database). Two junctions near Five Cowries Creek (72 m and 87 m away) passed the 60 m water rule and are in the list, but are not proposed.

### Placing the pin

The coordinates are OpenStreetMap node positions, which sit on the road centre line. The marker is drawn there. Staff can nudge the point by up to 40 m in the admin desk if it lands on the wrong carriageway. A hotspot is never moved after Hoppers start using it, only paused or replaced.

## 6. How they show in Play

### Near you, on the map

1. **Open Play.** The map already centres on the Hopper. The phone finds the Hopper's zone from the public zone shapes (section 4) and marks that zone's hotspot as "Your hotspot"; the other hotspots within 10 km appear as markers too, and if none are that close, the nearest two do and the camera stays on the Hopper. A Hopper inside no zone (over the line in Ogun State, for example) gets the nearest zone as theirs.
2. **The marker is its own thing.** Not a crate (cream, violet, pink, gold) and not a spot ring. A hotspot is a dark disc with a cream crossroads glyph inside an orange ring (`BRAND.orange`), its name under it in the display font ("JIBOWU"), and a small count badge. The ring pulses when 3 or more avatars are there. No emoji.
3. **A "Hotspots near you" row in the tray.** Your hotspot first, then the two nearest others, with a distance only the Hopper sees ("1.2 km") and the count band. Tap one and the camera flies to it. "More hotspots" opens the full list of 13, grouped by island and mainland. The sort and the distance are worked out on the phone from the Hopper's own fix. The hotspot list is public and fixed, so the server never needs the Hopper's position for this.
4. **Hopper not in Lagos, or location off.** Today Play answers "Play is Lagos only for now" and shows nothing. For hotspots it should instead show the 13 hotspots, wave 1 first (Yaba on top), with the map on Lagos, because entering needs no position. Boxes stay Lagos only.
5. **The main events map.** Jae: "maybe they'll be showing on the icon map." Recommended: yes, one small hotspot icon at each junction on the events map; tapping it opens Play at that hotspot's sheet. Boxes still never show there (decision of 9 Oct). Jae to confirm.

### The sheet and entering

1. Tap a marker. A sheet opens: name, the places in the zone, the two road names, "Always open", the count band, ENTER.
2. Guest: ENTER opens the sign-up sheet in place (Ola's `requireAccount`); an account is needed to enter. After Play mode Phase 6 it means a verified account.
3. ENTER sends the avatar. It runs from where it is on the map to the junction. The run is animated on the phone only: 4 to 25 s by distance, with a skip button after the first time. Nothing about the run, the start or the distance goes to the server. This is the relaxation of the 3 km rule: the rule existed so spot prizes could not be farmed from far away, and hotspots have no prizes, so there is nothing to protect and no limit. Steering with the arrows works as in spots, optional.
4. On arrival the phone calls `enter_hotspot(id)`. The room opens as a sheet over the map (Play never navigates away): faces strip, the chat, the composer. On the map the avatar stands at the junction with up to 10 heads around it (6 on low-tier phones).
5. Leaving: Bring avatar home, or sending the avatar to another hotspot or to a spawn spot. One avatar, one place: entering a hotspot removes any spawn-spot visit, and starting a spot trip removes the hotspot visit. Close the app and the head fades 10 to 20 minutes later, a random time, so nobody can read the exact moment you left.

### Deep link

`/?hotspot=yaba` (the zone's slug) opens Play with that sheet. Handy for the WhatsApp Community: "Yaba is on at Jibowu. Come in." Cheap; part of step 2.

## 7. The room

The room is Ola's chat system with one new channel kind, `hotspot:<id>`. Nothing new is invented for talking; the new part is the rules around an always-open room.

### Who is who

| Thing | Rule |
|---|---|
| Name in the room | An alias from `identity_for(user, 'hotspot:<id>', false)`, for example "Jollof Rider 4F". The same alias in the same hotspot every time, so regulars know each other; a different one in every other hotspot, so nobody is followed between rooms. A Hopper can pick a new alias once a day |
| Look | A face drawn from the alias, never the Hopper's avatar. Profiles are readable by everyone, so a real look in a head or a message would link the alias to the profile that owns it (found 10 Oct). The server sends `look: null` and the phone draws the alias face |
| Handle and real name | Never shown. A handle shows to one person after a returned wave or an accepted link up, as in spots |
| Account | Needed to enter and to post (`has_account()`, then a verified email after Phase 6). No account, no entry |

### Chat rules

| Rule | Value |
|---|---|
| Content | Text only. No pictures in v1 (the picture bucket and moderation load wait) |
| Length | 240 characters (Ola's table allows 400; the hotspot trigger is stricter) |
| Speed | At most 5 messages in 30 s and 40 an hour per Hopper in a hotspot. 00:00 to 05:00 Lagos: 1 message every 10 s (slow mode) |
| Filter | A message with a link, an email address, an @name or a phone number is refused ("No numbers or links in hotspots"), and so is one with a word from the staff list. The text is normalised first, so lookalike letters (Cyrillic, Greek, fullwidth, mathematical), zero-width characters, accents, spaced-out letters ("w.h.a.t.s.a.p.p"), digits in other scripts or in words ("zero eight zero...") and "dot com" change nothing. Seven digits with up to three non-letters between each pair is a number. A message with nothing that shows is empty |
| Duplicates | The same text twice inside 60 s is refused |
| Visible | The last 24 hours, only while your avatar is in the room |
| Kept | 7 days, then deleted. Reports keep a 400 character excerpt of the message they name |
| Delivery | Ola's Realtime on `messages` for v1, because a room is capped (below) and it reuses `useRoom`. If load asks, switch to a cursor poll like the spot pulse |
| Size | A soft limit of 100 avatars in a room. At 100, ENTER offers the nearest other hotspot. The limit sits above the split trigger (60 at the daily peak for a week, section 4) so the cap never hides the demand; a room that stays busy is split into two zones, not given lobbies |

### Heads: Wave, Link up, Vibe

Tap a head and PersonCard opens, exactly as in spot rooms (Play mode section 7): Wave, Link up, Vibe, Block, Report. Both people must be in the room (`in_room`), `have_met` is skipped, and the limits are the same (30 waves a day, 10 link-up requests, vibes capped). The only change in Ola's functions is that `hotspot:` counts as a room kind next to `spot:`. They arrive with Play mode Phase 5; if Phase 5 is not built first, hotspots ship with chat, Block and Report only and the heads gain actions later.

### Keeping it safe at 3 a.m.

A 24/7 room with no staff awake needs rules that run by themselves.

| Control | What it does |
|---|---|
| Report | `report_hotspot` (the existing `report('room', ...)` and `report('person', ...)` still work but feed no mutes). Three different people reporting one alias in 24 hours mutes it in that hotspot for an hour. Six mutes it in all hotspots for 12 hours. Only a report that cites a message by that alias from the last 24 hours counts toward a mute, so a few throwaway accounts cannot silence someone who has said nothing; a report on a bare head still goes to staff. Nothing is deleted by the machine |
| Block | A hotspot block (`hotspot_blocks`), both ways: a blocked alias's messages and head disappear for you and yours for them. It applies in hotspots only. A global block would also hide the person in event rooms, waves and DMs, and so link the alias to a handle; and the global blocks are left out of hotspots for the same reason the other way round |
| Staff, in the admin desk | A Hotspots section next to the spawner: pause a hotspot (instant), set its slow mode, clear the last N minutes, mute an alias for N hours, ban an account from hotspots, see the open reports for hotspot messages |
| Pause switch | `status = 'paused'` hides the hotspot everywhere and closes its room |
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

1. No position is stored or sent for a hotspot. Entering needs no fix. The distance shown on the tray is computed on the phone. But a hotspot can only be entered from Play, and `play_tick` keeps running while Play is open (also while a room is), so the privacy page says it plainly: entering a hotspot sends no location of its own; while Play is open it still sends the position described there.
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
| `hotspots` | Built (`supabase/hotspot_zones.sql`): one row per zone with its hotspot. `id, slug, name, zone_label, side, junction, road_a, road_b, lat, lng, geom, zone_geom, area_km2, land_km2, parent_id, split_hint, status, wave, name_confirmed, created_at`. `status` is planned, active, paused or split. Public read of active and planned rows (the list and the shapes are public); writes service role only; the app never writes a position. `slow_seconds` is added with the chat (step 4) |
| `hotspot_visits` | `user_id (primary key, one place at a time), hotspot_id, key (from identity_for), entered_at, last_seen`. RLS on, no policy, nothing granted; only the functions below read it. No coordinates |
| `hotspot_days` | `user_id, play_day, hotspot_id`, primary key `(user_id, play_day, hotspot_id)`. Same lockdown |
| `hotspot_mutes` (step 4) | `hotspot_id, user_id, until` |
| `hotspot_candidates` | Data only, in `supabase/hotspot_candidates.sql`: the Yaba and Lekki Phase 1 shortlist from before the zones. Kept as a source for splits; nothing reads it |

| New function | What |
|---|---|
| `hotspot_list()` | Active hotspots with id, slug, name, zone_label, roads, lat, lng, the zone shape and the count band (never an exact number under 3) |
| `enter_hotspot(id)` | Needs an account. Creates or refreshes the visit, clears any spot visit, returns the key and alias. Rate limited: 30 entries a day |
| `leave_hotspot()` | Deletes the visit |
| `hotspot_pulse(id, cursor)` | Every 10 s while the room is open: heads (key, alias, a null look, ordered by a hash of the key), count band, vibes since the cursor; also refreshes `last_seen`. No times, no arrival order |
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

Unchanged: `play_tick` and `play_fix` (hotspots do not use them), `game_drops`, `spawn_points`, `no_spawn_zones`, `spawn_rules`, claims and the 150 XP ceiling. A junction's zone is the zone shape it is inside (`lagos_area_for` is not used for hotspots any more).

Demo mode keeps working: the hotspot layer reads fixtures from `src/lib/demoData.ts` when there is no Supabase, with made-up counts and a local-only room, like the chat demo does today.

## 11. Build plan

Each step ends with the app playable and tests passing (`supabase/tests/hotspots_*.sql` for the database parts). No step needs Play mode Phases 4 to 6, except where said.

| Step | What | Size | Jae can try |
|---|---|---|---|
| 0 | Done (10 Oct): `scripts/hotspots/zones.mjs` made the 13 zones, their hotspots and split hints; `check-land.mjs` and `check-names.mjs` re-check them from the database and OpenStreetMap (all pass; 6 of the 26 local names, all split junctions, are not backed by OpenStreetMap and are marked unsure). Jae answers section 12 and confirms the local names | S | Look at the 13 zones and junctions on the phone map (`/mocks/hotspots`) |
| 1 | Table, RLS and the 13 rows are done (`supabase/hotspot_zones.sql`, tested by `supabase/tests/hotspot_zones_test.sql`: no overlap, every hotspot in its own zone and clear of no-spawn zones, no zone across the lagoon, all area centres covered, anon reads active and planned rows only). Still to do: `hotspot_list()` and the staff switch that flips a zone from planned to active (wave 1 first) | S | The list in the database |
| 2 | Map layer: marker, near-you row in the tray, sheet (no entering yet), deep link, finding the Hopper's zone on the phone from the public shapes, demo fixtures, the Lagos-only refusal replaced by the full list. Files: `src/components/play/HotspotMarker.tsx`, `HotspotSheet.tsx`, a `useHotspots` hook; edits in `PlayLayer.tsx` and `Tray.tsx` | M | See hotspots near you and tap one |
| 3 | Presence: `hotspot_visits`, `enter_hotspot`, `leave_hotspot`, `hotspot_pulse`, `in_room` branch, the run animation, heads around the junction, Bring avatar home, one avatar one place. Needs the sign-up sheet, not Phase 4 | M | Two phones in one room as heads |
| 4 | Chat: `stamp_message`, `message_visible`, purge edits (Ola reviews), the filter, limits, slow mode, mutes, `RoomView` reuse, the admin Hotspots section, the privacy page line. Tests for every rule | L | Chat in Jibowu from two phones; try to break it |
| 5 | Heads actions: Wave, Link up, Vibe (rides on Play mode Phase 5; only adds the `hotspot:` prefix) | S | Tap a head |
| 6 | Daily reward and Regular badge | S | 10 XP after 5 minutes |
| 7 | Roll out: Yaba alone for a week, then Lekki, then the rest of wave 1 (Victoria Island, Ikeja); watch peak avatars, messages, reports per 100 messages. When a room hits the split trigger (60 at its daily peak, 7 days), split it with its hint | | Real people |
| Later | The zone chip (opt-in, off by default), splitting zones as they fill, hotspot nights, an opt-in alert when a hotspot lights up, Paz prompts | | |

Done 10 Oct: the database half of steps 1, 3, 4 and 6 (section 13). The room screen, the 18+ sheet, the reward moment and the admin section of steps 3, 4 and 6 are built (section 14).

Order matters for safety: do not open step 4's chat to real Hoppers before the filter, limits, report handling, mute and pause switch all exist.

## 12. Open questions

Settled on 10 Oct 2026: Jae said "let it rip" and Ola agreed, so the defaults in the 10 Oct row of [DECISIONS.md](DECISIONS.md) answer these (as built, they are in section 13). The questions stay below as the record of what was asked.

### For Jae

1. **Chat reverses a Play rule.** Play mode section 7 says "No spot chat, ever. Wave, then DM." Hotspots have a group chat. Spot rooms stay chat-free (a 90 minute prize race with heads from within 3 km); hotspots have no prize and no location link, so chat is safe. OK to change that one line when you approve this?
2. **The zones.** Are the 13 zones in section 4 right? The borders follow the LGA lines, so Gbagada and Anthony are in Ojota and Gbagada, Ilupeju and Oshodi are in Surulere, Mushin and Oshodi, Maryland is in Ikeja, and Jibowu is in Yaba. Open Yaba alone first, or wave 1 (Yaba, Lekki, Victoria Island, Ikeja)?
3. **The 13 junctions.** Jibowu (Yaba), Admiralty Way (Lekki), Adeola Odeku (Victoria Island), Allen Roundabout (Ikeja), Ojuelegba (Surulere, Mushin and Oshodi), Bourdillon (Ikoyi), Obalende (Lagos Island), Ojota, Mile 2, Ajah, Ikotun, Iyana Iba, Ikorodu. Please correct the local names and swap any. On 10 Oct Jae settled three: Mile 2 moved to the Jakande Estate Road crossing, Bourdillon kept, and Ikorodu Garage at the roundabout after the Agric bus stops (section 4). OpenStreetMap does not back six of the split junctions; they are marked unsure in section 4. Falomo for Ikoyi would need the 100 m military rule lifted for that one place.
4. **Anyone anywhere.** Section 6 lets a Hopper outside Lagos, or with location off, see and enter hotspots, with an account. OK?
5. **The events map.** A small hotspot icon on the main map that opens Play? Boxes still never show there.
6. **Age.** Is there an age rule (18 and over)? A public chat of strangers needs it.
7. **Area chip.** Opt-in "YABA" tag next to your alias, off by default, from the area the Hopper chose? Or a room line like "mostly from Yaba tonight" with no names? Or neither?
8. **Night.** Slow mode 00:00 to 05:00 and 24/7 otherwise. Who looks at reports in the morning, and how fast must they be answered?
9. **Alias.** The same alias every visit to a hotspot (regulars know each other), or a fresh one each day?
10. **Reward.** 10 XP a day for a 5 minute stay, and a Regular badge at 4 days. Too small, about right?
11. **Names.** Room named after the zone ("Yaba", "Lekki") or after its junction ("Jibowu", "Admiralty Way")? Zone names are in section 4; when a zone splits, its two children are named for their halves ("Shomolu and Bariga").
12. **When to split.** I wrote 60 or more people at a zone's daily peak, 7 days in a row, then staff split it along the cut written in section 4; the two new rooms start empty and the chat history stays with the old one. You said only "as more people come". Is that the right size and speed, or should a person decide each time?

### For Ola

1. **Why was area chat and presence removed?** What did you see that made you drop `presence`, `whos_near` and BASE: location privacy, harassment, moderation load, load on the database, or just scope? Section 3 is my guess from the code.
2. OK to add `hotspot:` branches to `in_room`, `message_visible`, `stamp_message` and `purge_expired_rooms` (listed in section 10)?
3. **Realtime cost.** Every message in a 60 person room is checked against `message_visible` for each subscriber. Fine at that size, or should hotspots poll with a cursor?
4. **Rate limits per channel.** `stamp_message` allows 8 messages in 30 s everywhere. OK to let a channel set its own stricter number?
5. **Account.** Is `has_account()` enough to post in a hotspot, or wait for the verified email from Play mode Phase 6?
6. **Retention.** 7 days for hotspot messages (your event rooms are 3 days after the event). OK?
7. **Moderation.** Where do reports get read today? The plan adds a Hotspots section to the admin desk and a per-alias mute. Do you want to own that, and is a hotspot ban flag in `profile_private` the right place?
8. **Aliases.** `identity_for` gives one alias per user, channel and anon flag for ever. Is a once-a-day re-roll (delete and recreate the row) safe for your reports and blocks, which store the key?


## 13. Database API (built 10 Oct 2026)

`supabase/hotspots.sql` (load last, after `hotspot_zones.sql`; safe to run again; run it again after any run of `chat_accounts.sql` or `schema.sql`). Tests: `supabase/tests/hotspots_test.sql` (ends with `ALL HOTSPOT TESTS PASSED`) and the rerun check in `supabase/tests/sql_rerun_test.sql`.

### Decisions of 10 Oct built in (Jae, with Ola's OK)

Hotspots have group chat (spot rooms stay chat-free). Wave 1 (Yaba, Lekki, Victoria Island, Ikeja) is open; the other nine read "Opening soon" until staff open them. Anyone anywhere can see and enter; entering and chatting need an account (`has_account()`) and a one-time "I'm 18 or older". Rooms are named after the place ("Jibowu"). The same alias every visit. No area tag. Slow mode 00:00 to 05:00 Lagos. Messages kept 7 days. 10 XP a day for a 5 minute stay and "Regular at <place>" after 4 stays. Reports go to the admin desk. Staff can pause a hotspot and mute an alias. The server never learns where a Hopper is: "your hotspot" is worked out on the phone from the public zone shapes (`zone_geojson`), the distances from `lat`/`lng`.

### Conventions

- Every Hopper call is an RPC that returns jsonb: `{ "ok": true, ... }` or `{ "ok": false, "reason": "<code>" }`. Expected refusals never raise.
- Posting is an insert into `messages`; refusals raise, and the code is the error message (`error.message.includes("no_links")`, as in `chatError`).
- Words: **status** is `open`, `planned` or `paused` in the app (the table's `active` reads as `open`). The **channel** of a room is `hotspot:<hotspot id>`. The **room name** is the place (the junction without the road in brackets), the **zone name** is the zone.
- Counts are bands: `quiet` (0), `few` (1 to 2), `some` (3 to 19), `busy` (20 to 59), `packed` (60 or more). The `_n` number is null under 3.
- Nothing here takes or returns a position. The only coordinates are the fixed `lat`/`lng` and shape of each hotspot.

### Hopper calls

| Call | Who | Returns | `reason` codes |
|---|---|---|---|
| `hotspot_list()` | anyone, even signed out | rows, wave then zone name: `id, slug, name, zone_name, zone_label, side, junction, road_a, road_b, lat, lng, wave, status, zone_geojson, here_band, here_n, today_band, today_n`. `name` is the room ("Jibowu"), `zone_geojson` a simplified GeoJSON `Polygon`/`MultiPolygon` (about 40 KB for all 13, lng/lat, 5 decimals) for the phone's point-in-polygon test. Paused rows are returned with `status: 'paused'` (hide the pin, but use it to pick "the nearest open one"); split zones are not returned. Planned and paused rows count 0 | none |
| `confirm_adult()` | signed in with an account | `{ok:true, already:boolean}`. Stores `profile_private.adult_confirmed_at`. A birthday that says under 18 is refused, and stays refused: the first birthday under 18 ever written sets `under_18_at` (a trigger on `profile_private`), and a later birthday does not clear it. Staff clear it by hand | `no_session`, `need_account`, `under_18` |
| `enter_hotspot(p_slug text)` | account + 18+ | `{ok:true, already_here, hotspot:{id,slug,name,zone_name}, channel, key, alias, here_band, slow:{on_now,seconds,from,to}, rules:{max_len:240, burst:5, burst_s:30, per_hour:40, dup_s:60, visible_h:24, keep_days:7, stay_s:300, daily_xp:10, regular_days:4, entries_per_day:30, fade_min_s:600, fade_max_s:1200}}`. Slug is not case sensitive. Takes the avatar out of any other hotspot and any spot room. Entering the room you are already in refreshes it and counts as no entry. Call it when the run animation ends | `no_session`, `need_account`, `need_adult`, `not_found`, `not_open` (planned: "Opening soon"), `paused`, `full` (100 avatars; offer the nearest other), `slow_down` (30 entries today) |
| `leave_hotspot()` | signed in | `{ok:true, left:boolean}` | `no_session` |
| `hotspot_pulse()` | signed in | `{ok:true, slug, here_band, here_n}`. Keeps the avatar in; call about every 30 s while the room is open. Each ping pushes the fade out to a random 10 to 20 minutes | `no_session`, `not_in_hotspot` (faded or never entered: call `enter_hotspot` again), `paused` (the visit is cleared) |
| `hotspot_room(p_slug text)` | in that room | `{ok:true, slug, name, channel, you:{key,alias}, heads:[{key,alias,look}], here_band, here_n, today_band, today_n, slow:{...}}`. At most 100 heads, in an order set by a hash of the key (the same for everyone); hotspot-blocked people are left out. A head is exactly those three fields: `look` is always null (the app draws the alias face), and nothing says who you know. No handle, no name, no user id, no crew or wave flag, no times. Poll about every 15 s. The bands count you: alone in a room it says `few` with no heads, and the app reads that as "Just you" | `no_session`, `not_found`, `not_in_hotspot` |
| `my_hotspot()` | signed in | `{ok:true, has_account, adult, in: null or {slug,name,channel,key,alias,entered_at}}`. For when the app opens | `no_session` |
| `claim_hotspot_daily()` | in a hotspot 5 minutes | `{ok:true, xp: 10 or 0, already, days_here, badge: null or {key,name}}`. 10 XP once a play-day (06:00 to 06:00 Lagos) wherever you are; every 5 minute stay is counted per hotspot; the 4th stay at one hotspot in 30 days awards `regular-<slug>` ("Regular at Jibowu") once and adds it to `badge_catalog`; only its owner can read the badge row. Writes nothing to `activity_log` (not a streak day, no Outside Score). Call it after 5 minutes in the room, e.g. when the timer ends, and again on leaving | `no_session`, `need_account`, `not_in_hotspot`, `too_early` (+ `wait_s`) |
| `report_hotspot(p_ref uuid, p_reason text)` | in that room | `{ok:true}`. `p_ref` is a message id or a head's key. Creates a `reports` row of kind `hotspot` with `hotspot_id`, `alias` and a 400 character excerpt ("Jibowu / Danfo Rider 3F: text") that outlives the message. 3 different people against one alias in 24 hours mute it in that hotspot for 1 hour; 6 mute it in every hotspot for 12 hours; staff lift or lengthen (the plan said "until staff look"; a time box stops six accounts silencing someone for good). Only a report whose `p_ref` is a message by that alias from the last 24 hours counts (`reports.counts`); a report on a bare head or an older message is kept for staff and counts for nothing | `no_session`, `bad_reason`, `gone`, `not_in_hotspot`, `self`, `slow_down` (20 a day), `already` (same alias, same hotspot, 24 hours) |

Existing calls that work on a hotspot key or channel: `my_room_keys(p_channel)`, `block_person(p_key, null, label)` (on a hotspot key it makes a hotspot block, not a global one; `my_blocks()` lists both kinds and `unblock(id)` lifts either), and `report('room', message id, reason)` (use `report_hotspot` instead, it feeds the auto mutes). `add_to_crew(p_key)` answers `not_met` for a hotspot key: crew reads profiles, which everyone can read, so adding a head would put the real profile behind the alias in your crew list. `my_alias(p_channel)` makes an anonymous alias that a hotspot never uses: do not call it for hotspots (the alias comes from `enter_hotspot` and `hotspot_room.you`). `send_wave` answers `not_met` for a hotspot key until Play mode Phase 5 (a first wave would show the sender's handle).

### Chat (the `messages` table)

- Read: `select` with `channel=eq.hotspot:<id>`; the read policy shows a message only to someone whose avatar is in the room, and only for 24 hours. Leaving or fading stops both reads and live events.
- Post: `insert {channel, body}`. Send nothing else: `anon` is ignored (always the room alias), `image_path` is refused. The server sets `author_key` (the alias key), `author_name` (the alias), `author_look` (always null), `author_handle` (always null) and `created_at`. It stores the text with zero-width and hiding characters taken out. A post also keeps the avatar in the room. Posts are counted under a per-Hopper lock (`pg_advisory_xact_lock`), so parallel posts cannot get past the 5 in 30 s limit, the duplicate rule or slow mode.
- Refusals (the error message is exactly one of these, in this order): `need_account`, `need_adult`, `room_closed` (planned, paused or a bad id), `not_in_hotspot`, `muted`, `no_images`, `empty`, `too_long` (over 240), `no_links` (a link, email, @name or phone number: "No numbers or links in hotspots"), `blocked_word` (staff list, or a label like "ig: name"), `duplicate` (same text inside 60 s), `slow_mode` (00:00 to 05:00 Lagos, one every 10 s), `slow_down` (5 in 30 s or 40 an hour).
- Realtime: the same as every room. `supabase.channel('room:hotspot:<id>')` with `postgres_changes` `INSERT` on `public.messages`, `filter: 'channel=eq.hotspot:<id>'` (`useRoom('hotspot:<id>', userId)` already does this). Delivery is per subscriber through the read policy. Heads, counts and the fade are not realtime: poll `hotspot_room` (about 15 s) and `hotspot_pulse` (about 30 s). There is no presence channel and no broadcast.
- Kept 7 days, then deleted (daily by `purge_expired_rooms`, hourly by pg_cron `hoppaz-purge-hotspots`).

### Staff calls (service role only; for the admin desk)

| Call | Does | `reason` codes |
|---|---|---|
| `admin_hotspot_set_status(p_slug, p_status)` | `'open'`, `'planned'` or `'paused'`. Anything but open clears the room at once. Split zones are not touched | `bad_status`, `not_found` |
| `admin_hotspot_set_slow(p_slug, p_seconds, p_from time default null, p_to time default null)` | Slow mode gap 0 to 120 s (0 is off) and its Lagos clock window (default 00:00 to 05:00; the window may cross midnight) | `bad_seconds`, `not_found` |
| `admin_hotspot_mute(p_hotspot uuid or null, p_key uuid, p_hours numeric, p_reason text)` | Mute an alias (from a report or a head) in one hotspot, or in all with null. Stops posting only. Returns `{ok:true, mute}` | `bad_hours`, `not_a_hotspot_alias`, `not_found` |
| `admin_hotspot_unmute(p_mute uuid)` | Lift a mute, staff or automatic | |
| `admin_hotspot_mutes(p_active_only default true)` | `id, hotspot_slug (null: all), alias, key, until, auto, reason, created_at` | |
| `admin_hotspot_reports(p_open_only default true, p_limit default 100)` | `id, hotspot_slug, alias, key, excerpt, reason, created_at, reviewed_at, reporters_24h` (how many people reported a message by that alias in that hotspot in the last day: the ones that count toward a mute). The reports also sit in the existing open reports queue (kind `hotspot`, the excerpt names the place and alias); the CLOSE button sets `reviewed_at` as before | |
| `admin_hotspot_clear(p_slug, p_minutes)` | Delete the last 1 to 1440 minutes of messages. Returns `{ok:true, deleted}` | `bad_minutes`, `not_found` |
| `admin_hotspot_word_add(p_word)` / `admin_hotspot_word_remove(p_word)` | The word list (whole words, any case, a little leet speak undone). Seeded with contact and scam words only (whatsapp, telegram, snapchat, instagram, insta, dm me, inbox me, cashapp, bitcoin, forex, giveaway, send money); staff add the rest | `bad_word` |

Internal (not callable by the app): `hotspot_leave_for(p_user)` (Play mode's spot trip calls it when it starts, so one avatar is in one place; `enter_hotspot` already clears `spot_visits` if that table exists), `purge_hotspot_data()`, `chat_rate_limit(p_channel)` (5 in 30 s and 40 an hour for hotspots; 8 in 30 s for the rest), `hotspot_rules()`.

### What changed in Ola's functions

Each is his body plus a branch that starts `like 'hotspot:%'`; nothing changes for any other channel (the tests run event rooms, group chats, crew moves, waves and DMs before and after). `in_room` (a live visit in an open hotspot), `room_closes_at` (a hotspot never closes by the clock; closed while not open), `message_visible` (in the room, last 24 hours), `stamp_message` (hands hotspot channels to `stamp_hotspot_message`), `purge_expired_rooms` (hotspot messages over 7 days, and the hotspot housekeeping), `log_chat_activity` (a hotspot message is not an active day), `send_wave` and `add_to_crew` (`not_met` for a hotspot key), `block_person` (a hotspot block for a hotspot key), `my_blocks` and `unblock` (list and lift both kinds). Eleven in all. `message_visible` also leaves the global blocks out of a hotspot (only hotspot blocks apply there). One of his policies changes: `badges_read` hides the `regular-%` badges from everyone but their owner (the badge says which named account hangs out at which junction). One trigger is new: `profile_private_remember_minor`. New tables, all with RLS on and nothing granted: `hotspot_visits`, `hotspot_days`, `hotspot_quota`, `hotspot_mutes`, `hotspot_words`, `hotspot_blocks`. Additive columns: `hotspots.slow_seconds/slow_from/slow_to/max_here/opened_at`, `profile_private.adult_confirmed_at/under_18_at`, `reports.hotspot_id/alias/counts` and `'hotspot'` in the `reports.kind` check. The crew policy `crew_rw_own` is left as it is: the Crew page adds friends one-sided by design, and nothing in a hotspot reads `crew` any more.

### Differences from section 10

`hotspot_pulse` takes no arguments and only keeps the avatar in; the heads come from `hotspot_room(slug)`, which is also why `hotspot_pulse(id, cursor)` has no vibes (they arrive with Phase 5). Calls take the slug, not the id. The hotspot's table status stays `active`/`planned`/`paused`; the app-facing word is `open`. `hotspot_days` also holds the "today" count (a row when someone first enters that day) and the stays. The room name is the place, not the zone.


## 14. The room screen and the admin section (built 10 Oct 2026)

The app half of steps 3, 4 and 6 that is not the map: the room Hoppers stand in, the 18+ sheet, the daily reward moment, the staff section and the privacy line. Play's own screens (marker, sheet, tray row, the run) are described by their files in `src/components/play/hotspots/` and `src/lib/hotspots/`.

### Files

| File | What |
|---|---|
| `src/components/play/hotspots/HotspotRoom.tsx` | The room, full screen over Play. `<HotspotRoom slug onLeave name? />`: Play renders it when the avatar arrives and removes it on `onLeave`; `name` only fills the title while the server answers. Default export |
| `.../room/useHotspotRoom.ts` | One visit: the gates, `enter_hotspot`, the pulse and room read, rejoining, the daily reward, leaving |
| `.../room/useHotspotChat.ts` | The room's messages: load, the Realtime feed, post, hide a blocked alias |
| `.../room/Crossroads.tsx`, `room.module.css` | The junction from above with the heads standing around it |
| `.../room/ChatPanel.tsx` | The chat on Ola's pieces, plus the plain state line (rules, slow mode, countdown, refusals) |
| `.../room/HeadCard.tsx`, `AdultSheet.tsx`, `RewardMoment.tsx` | The card for a head or a message (Report, Block), the 18+ sheet, the "+10 XP" and Regular stamp |
| `.../room/api.ts`, `copy.ts`, `demo.ts`, `useKeyboardUp.ts` | The typed calls, every line of copy, the no-database room, the keyboard hook |
| `src/components/play/hotspots/HotspotPointer.tsx` | A chip on the edge of the Play map pointing to your hotspot, with its name and distance, whenever its pin is off the screen (the junction is usually a kilometre or more away at the zoom Play opens on) |
| `src/components/play/hotspots/HotspotsRow.tsx`, `HotspotsAll.tsx` | The tray row (one line of 44 px chips and an "All 13" chip) and the full list (your side first, nearest first when we know where you are) |
| `src/components/admin/HotspotsSection.tsx`, `src/app/api/admin/game/hotspots.ts` | The staff section and the handlers behind it; the route (`route.ts`) only dispatches `hotspot_*` actions and adds `hotspots` to its GET |
| `src/app/privacy/page.tsx` | A "Hotspots" section |
| `src/components/chat/Composer.tsx` | One new prop, `images` (default true): a hotspot turns the picture button off |
| `src/app/dev/hotspot-room`, `src/app/dev/hotspot-admin` | Development only (404 in production): the room over a plain ground, and the admin section fed by a script |

### How the room works

1. **Gates.** `enter_hotspot` is the one call: `need_account` shows an in-room card and opens Ola's sign-up sheet (`requireAccount`, and it enters by itself after sign-up or log-in); `need_adult` opens the 18+ sheet ("I'm 18 or older" calls `confirm_adult`, closing it closes the room, an account whose birthday says under 18 is told so); `not_open`, `paused`, `full`, `slow_down` and a failed call each get a plain card (`room/copy.ts`).
2. **Staying in.** The pulse every 30 s and the room read every 15 s, only while the page is showing; they run once when it shows again. A `not_in_hotspot` answer (the visit faded) rejoins without a flicker, unless `my_hotspot()` says the avatar is in another room (put there from another screen of the same account): then this screen says "You moved on" and gives way, and leaving it does not take the other screen's avatar out. Two screens used to trade the avatar for ever, and every trade was an entry of the 30 a day. `paused` shuts the room screen. Closing the app does not leave on purpose: the pulse stops and the head fades in 10 to 20 minutes. Leaving the screen (the back arrow, Play closing, an unmount) calls `leave_hotspot`, after a 1.5 s wait so a remount (Strict Mode, or the avatar sent to another room) cancels it, and two starts at once share one `enter_hotspot`. A leave also waits for an `enter_hotspot` still on its way, so tapping the arrow while it says "Joining" leaves no visit behind. Play's idle timer (10 minutes without a touch ends Play) does not run while a room is open: reading a chat takes no touches.
3. **Heads.** Up to 10 stand around the junction (6 on a low-tier phone), each in the slot it first took, with the Hopper in the middle inside the orange ring; with more than that, one fewer stand and the last place reads "+N more". A head is an alias (drawn as a face from the alias, never the avatar) and opens a card with Block and Report. Wave, Link up and Vibe come with Play mode Phase 5. Under each head is its alias; the words are cut to fit and the two-character code at the end never is, because the code tells two heads with the same words apart. The pill reads "Just you" when nobody else is in the room (the server's bands count you). The stage hides while the phone's keyboard is up, whichever kind it is (it shrinks the visual viewport, as on iPhone, or it shrinks the window itself, as on Android and in Instagram and Facebook's browsers: a focused text box in a window under 560 px tall), and the pinned rules line steps aside with it.
4. **Chat.** Ola's `RoomMessage` and `Composer` and the same Realtime feed, which only brings new messages: the list is read again every 15 s and replaced, so staff's "clear the last N minutes" reaches an open room within about 15 s. Not his `useRoom`: it asks for `my_alias`, which would make an anonymous alias a hotspot never uses, so `useHotspotChat` does the load, the feed and the post itself. The pinned rules line, then one state line: the standing slow mode notice ("Slow mode until 05:00. One message every 10 seconds."), a countdown after a post under slow mode or after a burst ("Easy. Too many messages. Try again in 7s."), or the last refusal in words (`muted`, `no_links`, `blocked_word`, `duplicate`, `too_long`, `room_closed`). The server decides every refusal; the countdown only stops a second tap from making one.
5. **Report and block.** Tap a message or a head. A message is reported with `report_hotspot(message id)`, a head with `report_hotspot(key)`, and the five reasons of the person card. Block uses `block_person` and hides that alias's messages at once.
6. **Reward.** After the stay (`rules.stay_s`, 5 minutes; at once when the room is entered again while the avatar is still in, and the server says how long is left) it calls `claim_hotspot_daily`. XP above 0 shows "+10 XP" with the check-in thump and the short motif and refreshes the profile, so the XP bar moves; a `badge` shows the Regular stamp with the stamp and the full motif. A repeat day pays nothing and shows nothing. A visit that faded and came back in is timed again from the new visit (the 5 minutes run from when it began). Leaving after a stay the timer has not paid claims on the way out. Entering plays the hotspot sound and buzz once (`already_here` does not).
7. **No database (demo).** A made-up room that lives on the phone: seven heads and three messages, chat is local, nothing is sent.

### The admin section

Four cards after the box spawner: **Hotspots** (counts, one OPEN WAVE button per wave that still has planned rooms, each room with OPEN or PAUSE, and a drawer for slow mode and "delete the last 15 min, 1 h, 6 h"), **Hotspot reports** (the room, alias, message, reason and how many people reported that alias in 24 h; CLOSE, and MUTE ALIAS for 1 h to 7 days in this hotspot or all), **Hotspot mutes** (STAFF or AUTO, until when, LIFT) and **Hotspot word list** (add and remove). PAUSE, OPEN WAVE and the deletes ask twice. Reports also sit in the existing Reports card (kind `hotspot`); closing one closes it in both. Actions: `hotspot_status`, `hotspot_open_wave`, `hotspot_slow`, `hotspot_mute`, `hotspot_unmute`, `hotspot_clear`, `hotspot_word_add`, `hotspot_word_remove`; each is the matching `admin_hotspot_*` call, validated and turned into a line for the desk. Opening a wave opens only rooms that are planned: a paused room stays paused. Staff see aliases and alias keys, never a user id.

### Checks

`node --no-warnings scripts/hotspots/check-security.mjs` replays the review's attacks through the local REST API as signed-in test Hoppers, about a minute, no browser (52 checks, 19 of them ways round the filter): the crew leak, the avatar look, the one-sided crew row, the filter, 60 parallel posts, the block that unmasked, the badge, the birthday and the throwaway reporters. `node --no-warnings scripts/hotspots/check-admin.mjs` runs the handlers against the local database (24 checks, puts everything back). `node --no-warnings scripts/hotspots/check-room.mjs` is the headless run: one Chrome at 390x844, two test Hoppers in two contexts, from the guest gate to the leave, then the admin section's buttons checked against the handlers (74 checks). Neither reads `.env.local`, so the admin route's own staff-token door is not exercised by them; the handlers it calls are.


## 15. The review of 10 Oct 2026, and what was done

Three reviews (safety and privacy, correctness, phone) read the build on 10 Oct and found 25 different things (the crew leak was found twice). All are fixed, except where the last column says why not. "Proved by" is the check that failed before and passes now: the SQL test file (`hotspots_test.sql`), the REST replay (`check-security.mjs`), the headless phone run at 390x844, 390x780 and 360x640 and the two-Hopper flow (`check-room.mjs`, 74 checks, passing).

### Safety and privacy

| # | Found | What was done | Proved by |
|---|---|---|---|
| 1 | `add_to_crew(head key)` put the real profile of any alias in your crew list (`crew` reads `profiles`, which everyone can read) | `add_to_crew` answers `not_met` for a hotspot key | SQL test, REST replay |
| 2 | The real avatar look went out with every head and message; `profiles` is readable, so the look found the profile | `look` and `author_look` are null; the phone draws the alias face; old messages are scrubbed | SQL test, REST replay |
| 3 | A one-sided `crew` row (or a wave) made `hotspot_room` flag the alias a known person was using | `in_crew` and `waved` are gone from the payload and the order (heads are in hash order, the same for everyone). `crew_rw_own` is left alone: the Crew page adds friends one-sided by design and nothing in a hotspot reads `crew` now | SQL test, REST replay |
| 4 | Numbers and contact words got through the filter (spaced dashes, zero-width characters, other scripts' digits, spelled digits, lookalike letters, spaced letters, "dot com", "ig:") | Text is normalised before it is checked; digit runs, the word list and the "label: handle" rule read the normalised text; a body with nothing visible is `empty` | SQL test (every way in the finding), REST replay |
| 5 | Parallel posts got past the 5 in 30 s limit (9, 13 and 7 of 60 got in), the duplicate rule (4 of 10) and slow mode (2 of 16) | `stamp_hotspot_message` takes the Hopper's advisory lock first | REST replay: 5 of 60, 1 of 10, 1 of 16 |
| 6 | Blocking a hotspot alias wrote a global block, so the person's handle vanished from the event lists and the alias was linked to it | Blocks made from a hotspot key go to `hotspot_blocks`, both ways, hotspots only; global blocks no longer hide anyone inside a hotspot (the same leak the other way round); `my_blocks` and `unblock` handle both kinds | SQL test, REST replay |
| 7 | The "Regular at" badge was readable by everyone with the handle and a time | `badges_read` hides `regular-%` badges from everyone but the owner | SQL test, REST replay |
| 8 | An under 18 refusal could be undone by writing a new birthday | The first birthday under 18 sets `under_18_at` (trigger), which `confirm_adult` and the entry gate honour; staff clear a typo by hand | SQL test, REST replay |
| 9 | Three throwaway accounts could mute anyone who had never posted | Only a report that cites a message by that alias from the last 24 hours counts toward a mute (`reports.counts`) | SQL test, REST replay |
| 10 | The privacy page said Hoppaz never learns where you are, and the head card said nobody sees real names | The privacy paragraph says entering sends no location of its own but Play still sends the position described above, and that Regular badges and hotspot blocks are private. The head card line stays: findings 1 to 3 made it true | read |

### Correctness

| # | Found | What was done | Proved by |
|---|---|---|---|
| 1 | Same as safety 1 | | |
| 2 | Play's 10 minute idle timer threw a Hopper out of a room they were only reading | The timer ignores a Play with a room open | headless run (11 simulated idle minutes: the room stays; with no room, Play ends) |
| 3 | Tapping Leave while it said "Joining" left a visit behind | A leave waits for any `enter_hotspot` on its way | headless run (4.5 s delayed enter: no visit left) |
| 4 | The daily reward was not timed again after a rejoin | A rejoin starts a new 5 minute timer | headless run (a new 300 s timer after a forced fade) |
| 5 | Staff "clear the last N minutes" did not reach open rooms | The chat list is read again every 15 s and replaced | headless run (a cleared room empties within 15 s) |
| 6 | Two screens of one account traded the avatar for ever and spent the 30 entries a day | A screen whose avatar is in another room (`my_hotspot()`, or a pulse for another slug) shows "You moved on", does not rejoin and does not leave | headless run (entries unchanged, the other avatar stays) |

### Phone

| # | Found | What was done | Proved by |
|---|---|---|---|
| 1 | On a phone under 800 px tall the camera stayed on one junction after a sheet closed (MapLibre added the sheet's standing padding to the fit's own) | `fitBounds` with `absolutePadding: true` | headless run at 390x780 and 360x640: all four open pins in view, no warning |
| 2 | The hotspots row made the tray 204 px tall | One line of 44 px chips plus an "All 13" chip: the tray is 160 px (19% of 844, 25% of 640); the camera's padding measures the tray | headless run: the avatar is 109 px clear of the tray at 640 (it was 38) |
| 3 | No pin was on the screen when Play opened | A pointer chip on the edge of the map: name, distance, an arrow, tap for the sheet | headless run: shown at both sizes, clear of the HUD and tray |
| 4 | Only a keyboard that shrinks the visual viewport was handled | A focused text box in a window under 560 px tall also counts; the stage can shrink; the rules line steps aside | headless run at 360x360: the list is 181 px (it was 12) and the box is on the screen |
| 5 | "A few here" over "Quiet right now" when alone | "Just you" | headless run |
| 6 | Head labels cut to "Puff-puff Ste..." and clipped | The code at the end of an alias always shows; slots moved so tags fit at 360 wide | headless run: no tag clipped |
| 7 | "More hotspots" was 28 px high | The "All 13" chip is 44 px | headless run |
| 8 | The list put Island first for a mainland Hopper and said every hotspot was always open | Your side first, nearest first; "Open ones run all day and night." | headless run |
| 9 | Five pairs of pins overlapped over all of Lagos | Rooms not open yet are left off while the camera is out over the whole city | headless run: no overlaps |
| 10 | A box could paint over a pin | Pins sit above boxes (z-index 8.5 million). While Play is open the map is its own stacking context, which also puts the HUD, the tray and the pointer above every crate and the avatar (crates used to paint over the tray) | headless run: no crate over the tray, the pointer on top |

### Left, and why

- **A real phone keyboard.** The keyboard cases are simulated (the window shrunk, the visual viewport patched), as in the review. Try it on a phone.
- **Words that look like text.** A single word of 7 letters or more on the staff list also catches it written with a space ("give away" for "giveaway"); a word in one piece inside a longer one ("instagrammer") is left alone. A time range such as "10:30 - 4:00" reads as a number: seven digits with three characters or fewer between them. Both are the price of closing the holes, and the rule is plainly worded for staff to change. A determined person can still get round any filter; reports, mutes and the pause switch are the answer to those.
- **A global block no longer hides someone in a hotspot.** To avoid someone there, block their alias (hotspot blocks). The alias is the same every visit, so one block lasts.
- **A mistyped under 18 birthday** needs staff to clear it (`update profile_private set under_18_at = null`).
- **`play_tick` still runs while a room is open**, so the position goes on being sent every 20 s; the privacy page now says so. Hotspot calls still take no position.
