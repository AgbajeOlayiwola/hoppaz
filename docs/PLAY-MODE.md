# Hoppaz Play mode v2.1

Status: final plan for Jae's build, 9 Oct 2026, after the security review. Replaces PLAY-MODE-v2.md where they differ. Jae's rows in docs/DECISIONS.md win over any number here. Phase 1 (the Play shell, the open moment with the Lagos sounds, and push alerts) is built on the ui-refresh branch; later phases are not. Push quiet hours are 23:00 to 07:00 Lagos (Jae, 9 Oct 2026), one setting (`set_push_config`).

Unchanged from v2: the four-thing HUD (its tray shows no Gist count until a Gist system exists), the open sequence and its timings, tier colours (Common cream, Rare violet, Epic pink, Legendary gold), the Lagos sounds, the 7 streak pips and the Golden Box, the 21:00 safety night, overlay mode on the same map, performance rules, the Ola merge plan, and the security fixes found in the code (open profiles, any-email accounts, the 1.5 km check-in, open hop_riders). The old tier-based "first 5/3/2/1" pips are gone: a spot shows one bar of 10 prize pips.

## Play in three sentences

1. Tap your avatar and the map becomes a small world around you: little boxes appear near you and your avatar runs out to open them, and once a day one special box appears that only you can see and you walk to it yourself.
2. A few times a day a pickup spot lights up for 90 minutes: you get an alert, send your avatar (it runs there by itself in 10 to 60 seconds, up to about 3 km away), and the first 10 avatars to tap the spot box each get a different random reward.
3. Avatars at the same spot see each other in a small room and can wave, link up (a friend request) or send a vibe sticker, and nobody ever sees where anyone really is.

If a feature does not fit in those three sentences, it is not in v1.

## 1. What is in Play

| Thing | Who sees it | How you open it | Pays (XP now; XP plus cards once the deck exists) |
|---|---|---|---|
| Small box | only you | tap it, your avatar runs there, no walking | 10 XP (Common, cream), XP only, ever |
| Special box | only you | walk 400 to 1,500 m, get within 60 m | 60 XP (Epic, pink), plus a card once the deck exists. Day-7 Golden Box: 150 XP (Legendary, gold) |
| Spot box | the avatars at that spot | send your avatar to the spot, tap the box. First 10 only | one random reward each, all different (section 4) |
| Check-in | people at a venue | check in at the event venue (real GPS) | the check-in XP already in DECISIONS.md, and the event box it unlocks |

Rules that keep it honest:

- Every box is a `game_drops` row, including a spot box. One reveal, one claim function, one wave system.
- The tier of a small, special or event box is fixed by its kind. A spot box draws from its prize pool (section 4). There is no pity timer in v1.
- **One box-XP ceiling: 150 XP per play-day** across welcome boxes A and B, small boxes and spot boxes (Jae's rule in DECISIONS.md). Small boxes use at most 100 of it, so a spot box always has room for at least 50. Special box, Golden Box and check-ins stay outside the ceiling as the going-out rewards. When the ceiling leaves less room than the prize pays, the claim pays what is left. When no room is left, a spot claim is refused before the tape rips ("Box XP is full today. Back at 06:00") so the slot stays free for someone else.
- Small boxes and welcome boxes A and B never pay a card, a collectible, a voucher or anything tradeable. They pay XP only. That keeps the couch from becoming a farm for things that matter.
- Spot boxes may pay collectibles and cards because they are limited to 10 verified accounts, rate limited, and need a sent avatar (sections 4, 11, 12). This is the one place v2.1 loosens v2. Vouchers and tickets are never in a random pool.
- Rewards until the deck exists: XP, the collectibles that already exist, and Gist only if a Gist system exists. Gist does not exist anywhere in the code today, so Gist is off. When the deck ships, cards join the pools. XP keeps coming either way.
- **Collectibles need a delivery path.** Today `claim_game_drop` pays XP and badges only, and the `collections` table needs an event drop. Phase 2 adds `user_collectibles (user_id, collectible_id, claim_id)`, written by the claim function for a `collectible` prize and read on the Collection page. A test checks that a collectible claim creates a row.

## 2. Small boxes (send your avatar)

Unchanged from v2 except the daily count, which drops from 15 to 10 so the 150 XP ceiling leaves room for spots.

- Three live around you, 60 to 150 m away by day, 20 to 60 m at night. Open one and a replacement rises 40 to 90 s later.
- Tap the crate and your avatar runs to it (40 m/s, clamped 0.9 to 3.5 s), then the swipe-and-open. The run is cosmetic. No radius check, no walking, no position stored.
- 10 per play-day (06:00 to 06:00 Lagos), then "Tomorrow's box is sealed". Small boxes pay at most 100 XP a day.
- Needs a verified account (after the three welcome boxes, section 13).

## 3. Special box (take the walk)

- One per play-day, unique to you, only you see it. You walk to it yourself with real GPS. This is the only box the avatar can never open for you.
- **Unlock: 4 hours after sign-up.** Sign-up means the moment your email code is confirmed. That moment is stored as `profile_private.account_at` from the first build (before the code step exists it is the account creation time), so the source never changes between phases. Until it passes, the special box shows as a locked pink crate with an honest line ("Opens at 14:10"). There is no 24 hour wait on anything.
- **Night-safety exception to "4 hours exactly".** A box is created only between 06:00 and 19:00 and closes at 22:00, so it always has at least 3 hours. After 18:00 only the near range (250 to 600 m) is used. If you unlock after 19:00, the crate says "Opens tomorrow 06:00". Jae can choose instead to keep the old 18:00 cut-off with a closing time of 21:00 (a longer wait for some people). This is Jae's call (section 20).
- Placed on a real `spawn_point` in your own area (`lagos_area_for`), 400 to 1,500 m away, outside every no-spawn zone, and the straight line to it must not cross water or a zone. If nothing fits, try 250 to 600 m. If still nothing, skip the day: the streak is safe (a small box lights the pip) and the Golden Box waits.
- Needs real GPS within 60 m plus your reported accuracy (capped at 30 m), and the located-claim speed rule (section 11).
- **There is no proof-of-approach check.** v2 had one (a record of being far away first). It added columns and did not stop a faker, who can report a far fix, wait a minute, then a near one. It is cut. The special box is protected only by the radius, the accuracy cap, the speed rule and one box a day. A person faking GPS can still take 60 XP a day with extra effort, and we say so.
- Bigger reward, and it stamps an outside day (derived, section 14). Golden Box on streak day 7 with 2 or more outside days in the last 7, at most once per 7 days.
- Night limits: nobody is sent on a dark walk. Welcome boxes and small boxes sit closer at night (section 13).

## 4. Pickup spots and the spot box

**A spot is where a box spawns.** Several times a day a spot lights up for 90 minutes. Two sources in v1:

1. **Random spots, ON from launch.** The spawn rule runs on the 623 `spawn_points` with scarcity limits so each one keeps its value (below).
2. **Staff-lit spots.** SPAWN NOW in the admin desk (a Hop stop, a launch day, a Saturday in a park). Ignores the limits, as today.

Events as big spots (a live event with a venue becomes a room) move to a Phase 8 after launch. Staff-lit spots already cover launch days.

**Scarcity limits for random spots** (rule fields, so Jae can tune them without code):

- Life: the existing `lifetime_minutes` field, set to 90.
- At most 1 live random spot per area (16 areas). An area rests 2 hours after its spot closes (`area_rest_minutes`). A given point rests 12 hours (`point_rest_hours`).
- About 18 random spots a day citywide (`max_per_day`), between 07:00 and 21:00. That is roughly 2 lit at a time. Raise it from data, never by feel.
- Because nobody walks to a spot any more, the 07:00 to 21:00 window is a taste choice, not a safety one. It can widen by changing the rule's two minute fields.

**Launch gate.** The random rule stays inactive in every build until the Phase 6 launch gate is passed (email verification, push alerts and the anti-farm controls). Phases 4 and 5 are tested with staff-lit spots only, so cheap accounts cannot farm a feature that is not protected yet.

**How a spot looks.** A soft ring on the map with its name in the tray, "Open until 14:30", a count and nothing else visible from outside. Beyond the screen edge, a glint on the rim. From outside the room you see a count, never faces. **Counts under 3 read "a few avatars here"; from 3 up they are exact.** Prizes left show as a bar of 10 pips that goes dark one by one, never which prizes remain. These rules live in the server functions, not the client.

**Sending your avatar.** Tap the spot, tap SEND. The avatar runs there by itself in 10 to 60 seconds, or you steer it. Section 5 has the rules. Nobody has to be there physically.

**The spot box.** One box per spot, open for the whole spot window.

- A `game_drops` row: `kind 'spawn'`, `is_spot true`, `claim_method 'avatar'`, `max_claims 10`, `reward_model 'random'`.
- **The first 10 avatars to tap it each get a random reward, and they are all different.** At spawn the server writes 10 `drop_rewards` rows with `quantity 1` from the rule's `rewards` list (the existing picker then gives distinct prizes with no new code). Each claim takes one at random from what is left. Being first decides who gets one, not who gets the best.
- Launch ladder (Jae to tune): XP 15, 20, 25, 30, 35, 40, 45, 50, plus **at most 2** collectibles that already exist (if fewer exist, XP prizes of 18 and 28 fill the places). The ladder is XP and common collectibles only. Cards join with the deck. Vouchers and tickets are never in a random pool.
- **Why a race is safe now:** everyone in it is an avatar. Nobody runs across a road to win, and the crowd tells a thief nothing, because avatars say nothing about where real people are.
- Who may claim: a verified account, an avatar that has arrived (a visit row seen in the last 10 minutes), one claim per spot, at most 2 spot claims per hour and 6 per play-day (this replaces today's 6 an hour for `spawn` boxes when the box is a spot), and room under the 150 XP ceiling. A person who has hit a limit is told so before the tape rips, so they never waste one of the 10 slots.
- **No radius check.** For `claim_method 'avatar'` the visit row is the proof, so the function skips the distance check, the speed check and the located-claim path, and stores no coordinates. The 10-claim cap is exact because the function already locks the drop row.
- Sold out ("All 10 taken") still leaves the room open for waving, linking and vibes until the spot closes.
- **The 3 km rule and "arrival" are user experience, not security.** The position comes from the phone, so a script can post any fix and start a trip. The real protection is the account controls in section 11 and 12 (verified and unique email, CAPTCHA, limits, small prizes, a watch on who wins). The docs say this plainly.

## 5. The avatar journey (server-side)

The client animates. The server decides what counts. The tables hold no route and no start point.

**Position the server uses.** `play_fix`: one row per user, written by the heartbeat, holding your last real fix rounded to about 110 m, accuracy and time, plus small counters (trip starts, rooms entered, alerts). No policy lets anyone read it; only server functions do. It is overwritten every 20 s while Play is open and deleted after 24 hours without Play. This is the single place the server keeps your position, and it exists because the 3 km rule and alerts need it (section 10).

**Hard rule: "en route" is never shown, counted or sent.** Nothing tells anyone that an avatar is travelling, how long it has been travelling or when it will arrive.

**Starting.** `start_trip(spot, mode)` where mode is `auto` or `steer`:

- The spot must be live and must not close before the trip, plus its delay, would end.
- Your `play_fix` must be under 2 minutes old ("finding you" otherwise), and the spot must be within **3 km** of it. The distance is checked and then thrown away.
- One trip at a time (a new start cancels the old). At most 6 starts an hour and 20 a play-day, and **at most 8 rooms entered per play-day** (counters on `play_fix`).
- **The travel time is not the distance.** For `auto`, the server picks `eta_s` as a random whole number from 10 to 60, whatever the distance. The client animates over that time. A watcher cannot turn "appeared 15 seconds after the alert" into "lives within 700 m".
- The server stores the visit (user, spot, mode, started_at, eta_s) and never your start point. While travelling, nobody sees your avatar anywhere.

**Auto run.** The avatar moves to the spot over `eta_s` seconds (10 to 60). **Steer.** You guide it with four on-screen arrows across the real map at a fixed client speed, like the mock (road snapping comes later, Phase 7). The server cannot check a path and does not try, and never accepts a path from the client. Steering is cosmetic; the only thing it changes is the time.

**Arriving.** `arrive_trip(trip)` is called when the avatar reaches the last 150 m of its run (the client then walks it into the room). The server accepts when:

- the trip is yours and still running;
- for `auto`, the time since start is at least `eta_s - 3` seconds (never under 7 s), so calling it early fails with `too_fast` and the avatar keeps running, and at most 60 s plus 10 s of network grace;
- for `steer`, the time since start is between 10 s and 180 s plus 10 s grace (the server has no distance to compare with and does not need one);
- the spot is still live.

Later than the window and the trip has `expired`: you start again (it counts toward your hourly starts).

On success it sets `arrived_at` and a **`visible_from`** on the visit. That row is what "your avatar is within 150 m of the spot" means. It is not your GPS and it is not derived from it.

**When others see you.** Your claim works from the true arrival, but your head appears to others only from `visible_from`:

- `auto`: `arrived_at` plus a random 0 to 20 s.
- `steer`: the later of `arrived_at` and `started_at` plus 90 s, plus a random 0 to 20 s. The client steers at a fixed speed fast enough that any run within 3 km finishes inside 90 s, so steering speed tells nobody anything.

This small delay is a privacy choice (section 20). The server never returns `arrived_at`, `started_at` or `visible_from` to any client.

**What others see.** Once your head is visible, everyone else whose avatar is at that spot sees your **room name** (an alias, section 6) and look, nothing more. The only position anybody ever receives is "this avatar is at this spot".

**Staying and leaving.** The avatar stays while Play is open (the heartbeat and the room pulse refresh `last_seen`). After you stop refreshing, the head is removed at a random time 10 to 20 minutes later, so a watcher cannot read the exact moment you closed the app. It leaves at once when you tap "Bring avatar home", when you send it to another spot (one avatar, one place), or when the spot closes. Sending your avatar does not move you: your home avatar, small boxes and special box carry on untouched. A visit is a visit.

What this does and does not prove, plainly: it proves a verified account with a recent fix within about 3 km sent an avatar and waited a plausible time. It does not prove the person is there, and it is not meant to. A GPS faker can send an avatar anywhere. What they gain is what an honest player at home gains: an avatar in a room, and a chance at one of 10 small prizes.

## 6. The room: spot presence for avatars

- One table, `spot_visits`, holds the trip and the presence together: user, spot, mode, state, started_at, eta_s, arrived_at, visible_from, last_seen, and a key. One running or arrived visit per user. No coordinates, ever. Rows die one day after the spot closes. No server-side visit history (the per-day counters on `play_fix` are all that remain).
- `key` and the room name come from `identity_for(user, 'spot:<drop id>', false)`: a fresh key and a fresh alias (for example "Jollof Rider") per spot instance. Nobody can follow a key or a name from spot to spot or day to day.
- **Rooms show the alias and the look, never the handle.** The handle is shown to one person only after a wave is returned or a link-up is accepted. This is what stops a stalker from following one handle across spots and shrinking the "home area" (section 10).
- **Who sees the room:** only avatars that are in it. "In the room" means a visit row whose `visible_from` has passed and whose head has not been removed. A spot you have not reached shows a count and the prize pips, never faces.
- On the map the room is a small ring around the spot with up to 10 heads. Linked people and people you have waved with come first; the rest are placed by a hash of their key, not by anything real or by arrival time. The spot sheet lists everyone in the same order (up to 40, then "and 31 more"). **No list or call ever returns a time or an arrival order.**
- Hard rule: a head carries no position, no distance, no travel time, no last-seen time. An alias and a cartoon avatar, nothing else.
- If 3 distinct people report an account's behaviour in rooms, its avatar is hidden from rooms until staff look. Nothing is deleted automatically.

## 7. Heads: Wave, Link up, Vibe

Tap a head and PersonCard opens in place (Play never navigates away). Three buttons, plus Block and Report. Guests see the sign-up sheet in place.

**Both people must be in the room for every one of these.** For a `spot:` channel, `send_wave`, `send_link` (from a head) and `send_vibe` all require `in_room` for BOTH the sender and the receiver (or the linger). They skip `have_met` entirely, because `have_met` counts `hop_riders` and anyone could fake a shared Hop today.

**Wave** (Ola's poke, reused as shipped, with spot rules). If they wave back, or already waved you, his system opens the DM as a sheet and both sides see handles. If a DM exists the button reads OPEN CHAT. Waves carry where it happened ("Met at Freedom Park"). Until it is returned, the receiver sees the sender's room name, not the handle (an edit to `my_waves`, section 18). 30 a day stays. A declined or unanswered wave can be sent again after 7 days.

**Link up** (a friend request, mutual). Tap it and they get a request ("Jollof Rider wants to link up. Met at Freedom Park."). If they accept, you are in each other's crew (handles and names now shown to each other) and a chat opens. If they already requested you, it links at once. Declined or ignored requests can be sent again after 7 days. Blocked senders get "sent" and nothing else, as with waves. Server: new `link_requests` table (kept separate from `waves`, so Ola's wave logic is not branched) with `send_link`, `respond_link`, `my_links`. On accept it writes both crew rows and opens the DM through a small helper (`open_dm` takes a `waves` row, so the helper wraps the same insert). The old one-way `add_to_crew` and the client's direct insert on `crew` are closed. The Crew page's add-by-search sends the same request by exact handle only (`send_link_by_handle`, with the same daily limits and block rules).

Link up must not leak anything. Today `src/app/crew/page.tsx` shows each friend's home area and distance, and `src/lib/useCrew.ts` draws friends at their area. Both go: crew shows handle, name, XP and look, no area, no distance, no map dots. The crew board (Jae's decision) counts check-ins only, so linking up alone cannot raise a crew's rank.

**Vibe** (a quick animated sticker). Tap Vibe, pick one of 10 drawn stickers (SVG, no emoji; first draft: WE OUTSIDE, SHARP GUY, NO WAHALA, LET'S GO, BIG VIBES, OMO, FRESH, ON THE WAY, WELL DONE, CHOP LIFE; Jae signs off the copy). It pops over their head for about 3 seconds for everyone in the room, and the person it went to sees who sent it (the room name). A vibe is a sticker id and nothing else: never chat text.

- Server: `spot_vibes (id, drop_id, from_user, to_user, sticker, created_at)`, written only by `send_vibe(key, sticker)`. The sticker id must exist in the catalogue.
- **Delivery:** the sender sees the sticker on their own phone at once. Everyone else gets it from the room pulse (`spot_pulse`, every 6 s while the room is open and visible, 10 s above 20 avatars) and the pop plays when it arrives. The pulse takes a cursor, so most calls return nothing. A table plus RPC, not a client broadcast, because a broadcast cannot be rate limited or filtered for blocks. Realtime for the receiver only (policy `to_user = auth.uid()`, cheap) is a Phase 7 upgrade if polling load asks for it.
- Receiver-side caps: at most 5 vibes a minute and 30 an hour arriving at one person. Settings has a "Mute vibes" switch.
- Rows are deleted 2 hours after the spot closes.

**No spot chat, ever.** Wave, then DM. In `message_visible`, `spot:%` and `hop-%` read false and `stamp_message` refuses them.

**Blocks work both ways.** A blocked pair never see each other's head, waves, link ups or vibes. Blocked list with unblock in Settings.

## 8. Events (check-in only in v1)

The security fix that is on Jae's list stays. The rest of the v2 event work moves to Phase 8, after launch.

- **Check-in tightening (v1).** Today's check-in accepts anyone within 1.5 km. For events with a venue location it becomes 300 m plus your accuracy (capped at 100 m), inside the event window, 3 per play-day, distance logged. Events without a venue location keep today's rules. The XP check-in pays is whatever DECISIONS.md says; this plan changes no XP amounts.
- The event box stays a staff drop, openable only after check-in.
- **Phase 8 (after launch):** a live event with a real venue becomes a spot (30 minutes before start to its end), a venue-verified flag, the `whos_here` 6 hour window and the "Show me in the event room" setting, the organiser box trigger (boxes within 300 m of the approved venue and inside the window), events exempt from no-spawn zones except water. The chill deck waits for the card deck.

## 9. Alerts

- Each Hopper chooses in Settings: **Off**, **A few** (about 3 a day), **All**. Default A few.
- An alert fires at the moment a new spot lights within about 3 km of your last fix (the same reach as the avatar). A few means at most 3 per play-day, first come first served. All means every spot in reach. Off means none; you still see spots if you look.
- Content: spot name, rough distance ("about 1.4 km", shown only to you), prizes left as pips, and a SEND button that starts the trip.
- Server: no log table. Each user's `play_fix` row carries an `alert_cursor` (the newest spot already alerted) and `alerts_today`, so a spot alerts you once and the daily count is exact. The heartbeat returns spots newer than the cursor. Outside Play, a light foreground check every 60 s sends only the coarse fix.
- **Push ships with alerts in Phase 6.** Android Chrome supports web push without installing the app, so alerts reach people when the app is closed. iPhone needs the app on the home screen first (the install prompt after the 3rd box, Jae's decision), so the same push works there once installed. Push uses the last coarse fix if it is under 6 hours old, honours the same setting and quota, and never sends between 21:00 and 07:00. Until push is on for a person, Settings says honestly "Alerts need the app open".
- No alert for events (they are already on the Today deck).

## 10. Privacy and safety

1. Nobody's real position is ever shown or sent to another player. The only public fact is "this avatar is at this spot".
2. **The server keeps one coarse position per user:** `play_fix` (about 110 m grid, overwritten, no read policy, deleted after 24 hours, and the backup retention checked). It exists for the 3 km check and for alerts. The start of a journey is never stored. This replaces v2's "the server forgets your position". The privacy notice line ships with Phase 1, not later.
3. `spot_visits` holds no coordinates. Rows die a day after the spot closes.
4. Room names and keys are fresh per spot instance. Heads show a room name and look, never a handle, until a wave is returned or a link is accepted.
5. Sending an avatar is the consent. The first time, one line in place: "Your avatar shows at the spot with a room name and your look. Nothing about where you are." "Bring avatar home" removes you at once.
6. **Profiles are locked down before heads ship.** Today `profiles_read` is `using (true)` (supabase/schema.sql line 408), so anyone can read every Hopper's home `area`, and `is_admin`. Per Jae: the home area is hidden from other people. So:
   - `profiles` becomes readable by its owner only.
   - A public view (owned by a definer on purpose, so it can read the table) with **handle, look and XP only**: no `area`, no `is_admin`, no `id` (an id would join to the open `riders_read`). Nothing may `select *` from it.
   - **`display_name` is not in the public view.** Jae said name and XP may stay public; we made that "may" a "no" because a public name turns any handle into a real name, which undoes the room aliases. Crew members see each other's names through `my_crew()` after a link-up. Leaderboards show handles. Jae can flip this (section 20).
   - `my_crew()` returns handle, name, XP and look for accepted crew only. The Crew page's name search (`ilike '%q%'` on `display_name`, a real-name directory) is replaced by an exact-handle lookup RPC. `useCrew.ts` stops embedding `profiles` through the foreign key (PostgREST cannot embed through a view).
   - Tests run as anon and as another user.
7. Blocks both ways at a spot, Blocked list with unblock, reports with their target visible to staff. `reports.kind` is checked against `('room','dm','person')` today; it gains `'spot'` and `'vibe'` (an edit to Ola's schema, section 18).
8. **Hide this spot** (on your phone) and **Report this spot**. Staff see spots with 3 or more distinct reporters in the admin desk and end them with END NOW. Nothing is removed automatically, so one account cannot kill an organiser's event.
9. Vibes are a fixed catalogue of positive stickers, rate limited, blockable, reportable. No free text anywhere in a spot.
10. Claim coordinates and box `geog` for near, special and welcome boxes are blanked 48 hours after close (v2 item 10, unchanged). The privacy notice says: "we keep where your boxes were for 48 hours, and a rounded copy of your last location for 24 hours".
11. Night: small boxes 20 to 60 m, no special box after 19:00, a pause button, no random spots after 21:00.
12. Ola removed proximity presence on purpose. Spot presence is different by design: you choose to send an avatar, no GPS creates a head, no coordinates are stored, the room carries a room name and look only. The note for Ola says so.
13. **What is left, in one plain line.** Someone who knows a person's look and watches many rooms could still learn a rough 1 to 2 km zone, not an address. The look is a fingerprint. The 8-rooms-a-day cap, the delay before a head appears, the fresh room names and the hidden handle make that slow and noisy. We do not claim it is zero.

## 11. Limits and anti-spam

No 24 hour wait on anything. Against spam we use rate limits, email verification and a watch on who wins.

| Limit | Value |
|---|---|
| Avatar trips | 1 running, 6 starts per hour, 20 per play-day, 8 rooms entered per play-day; destination within 3 km of your last fix; auto arrival after `eta_s - 3` s (never under 7 s) and by 60 s, steer arrival from 10 s to 180 s |
| Small boxes | 10 per play-day, 3 live, Lagos bounds only, Common only, at most 100 XP |
| Box XP ceiling | 150 per play-day across welcome A and B, small and spot boxes; special, Golden and check-in are outside it |
| Spot claims | once per spot, 2 per hour, 6 per play-day, first 10 per spot, verified account, avatar present, room under the ceiling |
| Waves | 30 a day, one re-wave after 7 days, both in the room |
| Link ups | 10 requests a day, 20 pending at once, resend after 7 days, both in the room when sent from a head |
| Vibes | 10 a minute, 3 a minute to one person, 150 a day, at most 5 a minute and 30 an hour arriving at one person, catalogue stickers only |
| Alerts | Off, A few = 3 per play-day, All; none 21:00 to 07:00 |
| Special box | one per play-day, Golden once per 7 days, unlocks 4 h after sign-up |
| Speed | 25 m/s (90 km/h) between located claims (special, welcome C), at least 60 s apart. A danfo or keke on the expressway passes; a 6 km move in 10 minutes passes. Check-in does not use the speed rule (it has its radius and window) |
| Check-in | 3 per play-day, window, distance logged |
| Heartbeat | one call per 15 s; guests may call it only until their three welcome boxes are done, then an account is required; room pulse one per 5 s |
| Email codes | 6 digits, expire in 10 minutes, resend after 60 s, Supabase rate limits and CAPTCHA on sign-up and on anonymous sign-in |

What a faker gains, in plain numbers: small boxes need no GPS (100 XP a day, same as an honest player). Spot boxes: a faker can send an avatar anywhere in reach, so up to 6 spot boxes a day inside the same 150 XP ceiling, same as an honest player. Special box: 60 XP a day with extra effort. Check-ins are the real target, so we log distances and watch.

**Controls against many fake accounts** (all in the Phase 6 launch gate):

1. One account per normalised email (lowercase, Gmail dots and `+tags` removed, `googlemail.com` treated as `gmail.com`).
2. A blocklist of known disposable email domains, checked in `finish_account()` (always works) and in the auth before-user-created hook if the plan has it.
3. CAPTCHA on sign-up and on anonymous sign-in.
4. Every spot claim can be joined to the winner's sign-up hour and email domain. The admin desk flags a spot when 3 or more of its 10 winners signed up in the same hour or share a domain.
5. The ladder stays XP and at most 2 common collectibles per spot.
6. Per-account claim limits as above. Phone or WhatsApp codes are the next step if the data shows a farm.

Known gap, stated plainly: a person with many real email addresses can still make many accounts. Email codes make it slow, not impossible. If one person takes 5 of 10 slots at three spots in a row, we tighten with data (device checks, phone codes).

## 12. Email verification (Supabase email OTP)

- Sign-up asks name, email, password, gender as today, then **a 6 digit code sent to the email**. The account is real only after the code is confirmed.
- **The old confirm path is deleted.** `/api/account/create` today marks any email-shaped string as confirmed (`email_confirm: true`), so every legacy account already has a confirmed email. The route's confirm step (or the whole route) is removed in the same commit that ships the code flow.
- Flow for a guest: the signed-in anonymous user calls `updateUser({ email, password, data: { display_name, gender } })`, which sends the code, then `verifyOtp` confirms it, then `finish_account()` stamps `profile_private.verified_at` and `account_at` and copies name and gender (length checked) from the user metadata, because the service-role step that wrote them today no longer runs. Same user id, so XP and boxes carry over. For an existing account with an unconfirmed email: `signInWithOtp` then `verifyOtp`. The exact Supabase call, the `verifyOtp` type and the email template for an anonymous upgrade are confirmed on the local stack first.
- **`finish_account()` must see proof of a fresh code.** It never trusts `email_confirmed_at is not null` (every legacy account passes that). It requires that the session's `amr` list contains an `otp` entry from the last 10 minutes (checked on the local stack first), with a fresh-confirmation fallback if `amr` does not carry it. It also applies the email normalisation, uniqueness and disposable-domain checks from section 11.
- `is_verified()` is true when `verified_at` is set. `has_account()` for the gates then means a verified account.
- **Backfill is local only.** On the local database, test accounts are marked verified once. In production, legacy accounts keep `verified_at` null and must sign in with a code before they can wave, link, vibe or claim spot boxes.
- Gated on a verified account: small boxes, spot boxes, special box, waves, Link up, Vibe, DMs as today.
- **Local testing:** Supabase's local Inbucket mail inbox at http://127.0.0.1:54324 receives the codes. No real email needed.
- **Production:** needs an email sender. Supabase's built-in email is rate limited and only for test use, so set custom SMTP with Resend (a domain with SPF, DKIM, DMARC) before launch. Set code length 6, expiry 10 minutes, anonymous sign-ins rate limit and CAPTCHA. The anonymous upgrade sends an "email change" message, so the **email_change template** must carry `{{ .Token }}`, not only the sign-up template. Launch checks: a paid Resend plan (the free plan is about 100 mails a day), a raised Supabase auth email rate limit, a real 6 digit code arriving in Gmail and Yahoo inboxes, resend after 60 s, expiry at 10 minutes, and a clear "That email already has an account, sign in instead" path that does not reveal more than it must.
- Phone or WhatsApp codes later if email is not enough.

## 13. First session (under 60 seconds)

Unchanged from v2.

- One line, the location prompt, the map flies to you. Three welcome boxes, owner-only, XP only, no card, no Gist: A at 25 m (50 XP, four-box reveal, avatar run), B at 90 to 130 m (50 XP, avatar run), C at 180 to 250 m ("worth the walk", 150 XP, real GPS). Night: all three 15 to 45 m. A and B count toward the 150 XP ceiling; C is a going-out reward and does not.
- No account for the three welcome boxes. After the third reveal: "Sign up to keep your Golden Danfo". The sheet opens in place and the same user id is upgraded, ending in the email code.
- Anti-farm: anonymous sign-in rate limit and CAPTCHA on, welcome exemption for the owner only, never a card.

## 14. Streak, Today and Me

Unchanged from v2.

- A streak day is any play-day with at least one box opened or one check-in. Seven pips roll toward the Golden Box. The first box of the day lights the pip. `open_daily_box` is retired and Me's Today's box becomes the entry into Play.
- Outside day, derived with no column: a claim on a box that needs presence (special, event, staff, welcome C) or a check-in. A spot box is an avatar claim and does not count as outside.
- Me shows the alert setting and the pips.

## 15. States and edge cases

| Situation | What happens |
|---|---|
| Outside Lagos | "Play is Lagos only for now." Browsing events works as today |
| No GPS, denied, or revoked | Tapping the avatar says "Turn on location to open boxes" |
| Stale fix (older than 2 minutes) | "Finding you", sending and claims paused |
| Spot more than 3 km from you | "Too far to send your avatar (3 km)" with the distance |
| Spot closes while the avatar travels | Quiet "Gone", the trip ends, no loss copy |
| Arrive too early or too late | The avatar keeps running (early) or "Try again" (expired) |
| Spot box sold out | "All 10 taken". The room stays open |
| Spot ends while you are in it | Your head vanishes, the box says a quiet "Gone" |
| Blocked person in the room | Neither sees the other. The box stays visible |
| You tap "Bring avatar home" | Your visit is deleted at once |
| Hit a daily limit | Told before the tape rips ("6 spot boxes today. Back at 06:00") |
| Box XP full for today | Spot claim refused before the tape rips; small boxes seal at their 100 XP |
| Sign-up needed mid-claim | We ask before the tape rips, then resume |
| Special box not unlocked | Locked crate with the unlock time ("Opens tomorrow 06:00" if past 19:00) |
| No special box candidate | Skip the day, streak safe |
| Alerts need the app open (no push yet) | Settings says so honestly |
| Offline | Plain map style, claims wait for signal, no failure copy |
| Device in another time zone | Server time and Africa/Lagos decide the play-day |

## 16. How Play lives in the client

- Overlay mode of the same map on "/", not a route. The MapLibre instance survives. Lazy-loaded Play layer. The back button leaves Play.
- Live position is its own hook, kept out of the store. The fix carries accuracy and timestamp. The client rounds to 3 decimals for everything except located claims.
- **One heartbeat, `play_tick(lat, lng, accuracy)`, every 20 s** (30 s on low tier, paused when hidden). Every tick writes `play_fix`, refreshes your presence if your avatar is at a spot, and returns boxes. The heavier work (small-box top-up, special box check, spot search within 3 km, alerts) runs on every third tick or when the screen first opens. It also returns your trip and room state and the unread counts of waves and link ups. The only other poll is `spot_pulse` every 6 s while a room is open and visible (10 s above 20 avatars).
- Your avatar is a 44 px tappable disc on a neutral ring. Claims always use the real position (or the visit row for spot boxes), never the avatar's display position.
- Crates and vibe stickers are CSS/SVG. A second WebGL context would hurt cheap phones.
- Pages' own tickers pause in Play. Play owns Toaster, Reveal and sheet offsets while the nav is hidden.

## 17. Cheap Android phones

Unchanged. `deviceTier()` is low at 2 GB or less or with data saver. Low tier: pixel ratio 1.5, no 3D city, pitch 30, no ambient animation, heartbeat 30 s, at most 12 markers, room heads at most 6 on the map. No backdrop blur on the HUD; at most 20 DOM markers.

## 18. Ola's code stays Ola's

Waves, DMs, blocks, reports, room keys, the account gate and the sign-up sheet are reused. Every edit to his files:

| File | Edit | When |
|---|---|---|
| `supabase/chat_accounts.sql` | `require_account_row()` exempts a welcome drop claim by its owner | Phase 0 merge commit |
| `supabase/chat_accounts.sql` | `spot_visits`, spot branch in `in_room` (visible and not removed), `spot:%` and `hop-%` false in `message_visible`, `stamp_message` refuses them, spot keys in the purge | Phase 4 and 5 |
| `supabase/chat_accounts.sql` | `send_wave`: for `spot:` channels both must be in the room and `have_met` is skipped, required `met_at`, one re-wave after 7 days; `my_waves` returns the room name until the wave is returned | Phase 5 |
| `supabase/chat_accounts.sql` | `add_to_crew` closed, replaced by `send_link` and `respond_link` | Phase 5 |
| `supabase/chat_accounts.sql` | `has_account()` requires a verified email | Phase 6 |
| `supabase/schema.sql` | `profiles_read` replaced by own-row only plus the public view; `crew_rw_own` becomes read and delete only | Phase 5 |
| `supabase/schema.sql` | `reports.kind` gains `'spot'` and `'vibe'` | Phase 4 |
| `supabase/schema.sql` | `riders_read` limited to own rows and `riders_insert_own` removed (no client code uses `hop_riders` today; boarding comes back as a server function when Hop social is built) | Phase 5 |
| `supabase/schema.sql` | `drop_rewards` and `claim_game_drop` pay a `collectible` prize into `user_collectibles` | Phase 2 |
| `src/app/api/account/create/route.ts` | confirm step removed (or route deleted); the code flow replaces it | Phase 6 |

Asked of Ola, not done by us: a server-verified boarding function for `hop_riders` before any Hop social, and a review of the OTP change to `has_account`.

## 19. What changed from v2 (one line each)

| What changed | v2 said |
|---|---|
| Spot heads are avatars you send (up to 3 km), not real GPS | Heads only for people within 150 m with opt-in, sending was impossible |
| Travel time is random 10 to 60 s, not tied to distance; heads appear after a short random delay | n/a |
| Rooms show a per-spot room name; the handle appears only after a returned wave or an accepted link-up | Handle and avatar |
| Random spots ON from launch with scarcity limits (after the Phase 6 gate) | Random spawner off until data |
| Spot box: first 10 avatars, random distinct rewards, the visit row is the proof | One shared 25 XP box for everyone within 60 m, no race |
| Spot boxes may pay at most 2 collectibles and later cards | Only boxes that need a walk may pay cards |
| Link up (mutual request) and Vibe (sticker) are back | Both cut, wave was the vibe |
| Sending the avatar is the consent; no opt-in card | Opt-in card, default off |
| Map heads ship with spots (safe now) | Map heads in polish only if used |
| No 24 hour wait on anything; special box unlocks 4 h after sign-up (with a night-safety window); email code instead | 24 hour account age for special box, spot box and waves |
| No proof-of-approach for the special box | Heartbeat approach check |
| The server keeps one coarse position per user for the 3 km rule | The server forgets your position |
| One 150 XP box ceiling across welcome A and B, small and spot boxes; small boxes 10 a day, max 100 XP | 150 XP clamp for small boxes only, 15 a day |
| Speed rule 25 m/s plus 60 s between located claims | 8 m/s |
| Profiles: home area, id and is_admin hidden; name only to crew; handle, look and XP public | Handle and avatar only |
| Alerts per Hopper: Off, A few, All, with Android push in Phase 6 | No alerts |
| Events as spots, the venue-verified flag and organiser box rules move to Phase 8; check-in is only tightened now | Events as big spots in v1 |
| Pushes go to jae/ui-refresh on Ola's repo only | New branch jae/play-v2 |
| Welcome box C is opened by the avatar run like A and B (no radius check, no coordinates), so every Hopper can finish the intro; walking yourself starts with the special box. Sections 11, 13 and 14 still say real GPS for C: read them with this change. Also new: `supabase/starter_quests.sql` gives every live event its quest kit | Welcome C needed real GPS |

## 20. Choices made for Jae (reply only if you object)

1. **Heads appear after a small random delay** (0 to 20 s, and at least 90 s after you start when you steer), and the travel time is random, so nobody can work out how near you were. Say if you want heads to appear the instant an avatar arrives.
2. **Room names, not handles.** In a room people see a fun per-spot name (like "Jollof Rider") and a look. The real handle shows after a wave is returned or a link-up is accepted.
3. **Public name.** The public profile has handle, look and XP, not the display name, so a handle cannot be turned into a real name. Crew see each other's names. Say if you want names fully public.
4. **Special box window.** Boxes appear 06:00 to 19:00 and close at 22:00, near range after 18:00; if you unlock after 19:00 the box comes at 06:00. The alternative is the stricter 18:00 and 21:00.
5. **150 XP box ceiling is shared.** To leave room for spot boxes, small boxes are 10 a day and 10 XP each (100 XP). When box XP is full, spot claims are refused so the slot stays free for someone else.
6. Steer mode may take up to 3 minutes; the 10 to 60 s window is for the auto run.
7. Default alert setting is A few.
8. Random spots run 07:00 to 21:00, about 18 a day, 1 live per area. Two rule fields change that.
9. Crew shows no area, no distance, no map dots.
10. Spot ladder numbers (15 to 50 XP, at most 2 collectibles) and the 10 sticker names are first drafts.
11. Local test accounts are backfilled as verified once; production accounts must verify with a code.
