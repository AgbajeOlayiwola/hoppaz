# Event planner: keeping events, boxes and quests in sync

Status: proposal, 9 Oct 2026. Nothing here is built yet.

## The problem

Today an event, its quests, its boxes and its camera hunt are four separate
forms on the admin desk (`/admin`). They meet only through an optional
`event_id`, and nothing keeps them together afterwards.

- **Times drift.** A box or hunt copies the event's time when it is made
  (`opens_at`, `closes_at` are fixed timestamps). Move the event and its boxes
  stay behind. Quests start "now" and have no end unless typed.
- **Most events have no game.** On the local database 3 of about 50 events have
  any quest or box. The map shows 20 events but almost nothing to play.
- **No single view.** Staff cannot see one night's plan (events, boxes,
  quests, partners) in one place, or spot an event with nothing on it.
- **No preview.** Staff cannot see an event the way a player will before it
  goes live.
- **Testing is manual.** A box only opens at the right time and place, so
  every test means hand-editing rows.

## What other games do

| Game or tool | How it is built | What we take |
|---|---|---|
| Pokémon GO events | One event is a container: its spawns, its research (quests), its bonuses and its time window live together. Timed research expires with the event. | The event owns its boxes and quests, and they share its clock. |
| Pokémon GO Campfire | Check in at a real meetup and you get that event's Timed Research. | Check in at a Hoppaz event and its quests unlock. We already do this; make it the rule. |
| Pikmin Bloom | Items sit at real places on a map around you. A live city event adds special spots with set rewards, plus a "Challenge Anywhere" version for people who are not there. | Boxes at the venue, plus a city-wide quest for people who can't come. |
| Live-ops tools (Satori, PlayFab) | One event calendar. Each live event has a schedule, an audience, its config and its rewards. Content is planned months ahead. | A calendar of nights, with what each one holds. |
| Geocaching | Every cache has an owner, is reviewed before it goes live, and gets a health score from finds, not-founds and maintenance logs. | Each box has an owner, a draft and live state, and a health check (opened vs not found). |
| Duolingo | Daily quests refresh every 24 hours; a weekly friends quest gives 5 days; 50 quests in a month earns a badge. Rewards come in chests with some chance in them. | City quests that always exist, so there is something to do even on a quiet night. |

## The plan

1. **The event is the container.** In admin, open one event and see
   everything on it: its boxes (open, sealed, hunt), its quests, its partner,
   whether it is a Hop stop. Add or remove from there. One save.
2. **Times follow the event.** A box is stored as "opens 60 min before the
   start, closes 60 min after the end", not as two fixed times. Quests default
   to the event's window. Move the event and everything moves with it.
   Neighbourhood boxes with no event keep fixed times.
   Database: `opens_offset_min` and `closes_offset_min` on `game_drops` and
   `quests`, or a trigger that shifts linked rows when an event's
   `starts_at` changes.
3. **A starter kit on every event.** When an event is approved it gets a kit
   by default: a check-in quest, a photo quest and one box that opens at the
   start. Staff can change or remove it. No pin on the map goes empty.
4. **Draft, scheduled, live, ended.** Players never see a draft. Ended items
   stay for receipts and stats.
5. **The night calendar.** A list by night for the next 20 events: each row
   shows its boxes and quests, with gaps flagged ("no box", "no quest",
   "box closes before the event ends").
6. **Preview as a player.** From an event in admin, open its `/event/[id]`
   page as a player would see it, before it is live.

## How we test it

- **A playtest seed.** One command builds a fresh night near the place you
  pick: three events tonight, each with the kit, one box open now, one sealed
  box opening in 10 minutes, one camera hunt, and their quests. It wipes the
  last playtest first (rows tagged as playtest), so you can run it any time.
- **Time and place overrides, development only** (like `/phone`): `?at=` to
  set the clock, and the area picker for where you stand.
- **The flows to check every time:**
  1. Set a location, boxes appear on the map.
  2. Stand in range of a box, open it, the reveal plays, the receipt is on Me.
  3. Check in, the event's quests unlock, claim one, XP goes up.
  4. In admin, move an event's time, its box moves with it.
  5. A sealed box opens on time without a reload.
- **On phones:** the same seed on the staging database with a preview deploy.

## Open questions

- Who owns a box: Hoppaz staff only, or partners too (with review)?
- Should a lead (an unconfirmed event) get a kit, or only confirmed events?
- How many boxes per night is right? A first guess: one per event, plus two
  neighbourhood boxes per island area on Fridays and Saturdays.

## Sources

- Pokémon GO event structure: https://www.dexerto.com/pokemon/pokemon-go-new-year-2024-timed-research-2451204
- Campfire check-in research: https://www.sportskeeda.com/pokemon/pokemon-go-campfire-check-in-timed-research-all-events-tasks-rewards
- Pikmin Bloom map and city events: https://pikminbloom.com/news/oct24-pikminbloomjourney and https://nintendo.fandom.com/wiki/Pikmin_Bloom
- Satori live-ops calendar: https://heroiclabs.com:443/satori
- Live-ops content calendar: https://brightblack.co/blog/liveops-content-calendar
- Geocaching review and health score: https://gcwiki.atlassian.net/wiki/x/39gI
- Duolingo friends quests: https://blog.duolingo.com/friends-quests/
