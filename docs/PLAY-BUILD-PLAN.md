# Hoppaz Play v2.1: build plan

Builds PLAY-MODE-v2.1.md (the version after the security review). Replaces BUILD-PLAN.md. Nothing below has been done. The repo is untouched and other builds are editing its working tree, so Phase 0 waits until they finish (git refuses to merge with the 9 overlapping dirty files).

Rules for every phase:

- Each phase is one or a few commits on **jae/ui-refresh** and leaves the app playable. Jae can try it on his phone before the next phase starts.
- **Pushes go to Ola's repo, branch jae/ui-refresh only. Never his main. No new branch, no PR to main.** Push after a phase passes its checks and Jae says go. Check the remote name with `git remote -v` first. The docs line that says we never push to Ola's repo changes in Phase 0.
- The old box layer on the events map is removed in the same commit that lets Play open boxes, never before.
- Docs are updated in the phase that changes behaviour. No em dashes anywhere.
- All Play SQL goes in `supabase/play.sql`, run last, idempotent. Ola's files are edited only where the spec's section 18 table says, so his review is easy.
- Cut, do not add. If a task is not needed to prove "send your avatar, walk to your box, go to a spot, meet people, wave, link up, vibe", it waits. Reuse existing fields (`lifetime_minutes`, `max_claims`, `reward_model`, the `rewards` list with quantity and weight) before adding new ones.
- Order the user asked for: merge with Ola; Play shell and small boxes; rewards; special box and pips; spots with avatar travel and the first-10 box; heads with Wave, Link up, Vibe and profile lockdown; alerts and email OTP; polish.
- **Launch gate:** the random spot rule and public release wait until Phase 6 is done. Until then spots are staff-lit only.

## Phase 0. Merge with Ola, docs, first push (size M, one sitting plus docs)

Output: one base for everything else. tsc clean, eslint 0 errors, `next build` passes, welcome boxes open for a guest, the plan is in the docs and on Ola's repo.

1. Backup: `git branch backup/pre-ola-merge-2026-10-09`. Re-fetch upstream and re-check overlap with `git merge-tree --write-tree --name-only HEAD upstream/main`.
2. Commit the dirty tree in logical commits so the merge commit holds only conflict work: docs; SQL (box_guards, daily_box, spawning edits, tests); Today deck; Me refresh; welcome and box fixes. Do not commit half-built Play work.
3. `git merge upstream/main` (merge, not rebase).
4. Resolve the 5 conflicts exactly as rehearsed in the scratch clone:
   - `src/lib/useSession.ts`: take Ola's store whole; drop our startSession patch.
   - `src/app/discover/page.tsx`: take ours; port his "We outside" toast; his SwipeDeck.tsx stays unmounted.
   - `src/app/me/page.tsx`: keep ours, keep both imports, wrap in his RequireAccount, drop his lagosToday constant, keep his gender ask.
   - `src/app/admin/page.tsx`: take his draft state, token autoload and 401 handling; graft our spawner into Queue, empty and loaded.
   - `src/lib/game.ts`: resolve by hand. Do not reformat first (our file is one line per function, so reformatting turns every hunk into a conflict). Keep our `useGameDrops`, re-apply his `requireAccount` with the welcome exemption: `if (drop.kind !== "welcome" && !requireAccount("claim this reward")) return { error: NEED_ACCOUNT }`.
   - Review the four auto-merges once: page.tsx hasVenue filter, CameraHunt gate, SettingsGroup Appearance row, globals.css.
5. In the same merge commit, one SQL edit only: `require_account_row()` in `supabase/chat_accounts.sql` exempts a `drop_claims` insert whose drop is kind welcome and owned by `auth.uid()`. Add `supabase/tests/account_gate_test.sql` from the scratch clone. Nothing about spots goes in the merge commit.
6. Separate commits after the merge commit: reformat `src/lib/game.ts`; `openBox` asks for an account before the tape rips and closes the Reveal quietly on `need_account`; WE OUTSIDE button in the DeckCard foot using `useGoing.toggleGoing`.
7. **Make the SQL re-runnable in any order.** `supabase/spawning.sql` drops and re-adds `game_drops_kind_check` with only `('staff','spawn','welcome')` (line about 130), which fails once a `near` or `special` row exists, and the same would happen to `claim_method` once `'avatar'` rows exist. Change spawning.sql in this phase to the full lists (kind: staff, spawn, welcome, near, special; claim_method: proximity, qr, either, avatar), and repeat the same lists in play.sql with drop and add. Write the run order into SPAWNING.md: schema.sql, chat_accounts.sql (with the exemption), hunt_items.sql, spawning.sql, spawn_points_lagos.sql, box_guards.sql, daily_box.sql, then play.sql last. Warn: re-running schema.sql restores the old `claim_game_drop` and `drops_read_active`; re-running an old chat_accounts.sql restores the strict trigger. SQL before the app deploy; pg_cron on; anonymous sign-ins on with the rate limit and CAPTCHA. Add a test that runs spawning.sql then play.sql twice on a database that holds `near` and `avatar` rows.
8. Verify on a THROWAWAY database (not the shared local docker DB): `tsc --noEmit`, `eslint src`, `next build --webpack`, the three existing SQL tests plus `account_gate_test.sql`. Manual smoke on a fresh browser profile: one anonymous user under Strict Mode; three welcome boxes open with no sheet; the next box shows the sheet and opens after sign-up; admin autoloads; the Today deck WE OUTSIDE button works as guest and member.
9. **Docs and first push.** Rewrite `docs/PLAY-MODE.md` from PLAY-MODE-v2.1.md (the old file still says shared boxes use 5/3/2/1 first-N by tier and area counts under 5 are hidden, which conflicts with the first-10 rule: remove those, show one bar of 10 prize pips, and drop the Gist count from the HUD tray until a Gist system exists). Add Jae's rows to `docs/DECISIONS.md` (spawn spots, spot box, tapping a head, special box 4 h, alerts, rewards, profiles, fake accounts, pushes). Update `docs/SPAWNING.md`. Fix `docs/UI-REFRESH-PLAN.md` so it says we push to Ola's repo, branch jae/ui-refresh only. Update the saved project memory entry that says never to push to Ola's repo. Write the **note for Ola** (not a pull request; there is no PR to main): the one welcome exemption; what later phases change in his files (spec section 18); that spot presence differs from the proximity he removed (an avatar you send, no GPS, no coordinates, room name and look only); the run order; what we ask of him (a server-verified boarding function for `hop_riders`, a review of the OTP change to `has_account`). Push the merge plus docs to jae/ui-refresh once Jae confirms the remote.

## Phase 1. Play shell, welcome boxes, small boxes (size L)

Jae tries: tap the avatar, the map closes around you, three welcome boxes, avatar runs, Reveal, sign-up sheet, small boxes keep arriving.

**Before this phase ships to anyone:** the privacy notice line goes live ("we keep where your boxes were for 48 hours, and a rounded copy of your last location for 24 hours"), and the Supabase backup retention for deleted rows is checked and written down. `play_fix` stores positions from the first day, so the notice cannot wait for Phase 7.

DB (`supabase/play.sql`, part 1):
- `lagos_play_day()` (06:00 boundary).
- `game_drops.kind` adds `near`; new column `needs_presence boolean` (false for near and welcome A and B).
- `play_fix` table (user_id pk, rounded lat and lng to 3 decimals, accuracy, at, plus the counters used later: `alert_cursor`, `alerts_today`, `alert_day`, `starts_hour_at`, `starts_hour_n`, `starts_day`, `starts_day_n`, `rooms_day`, `rooms_day_n`, `last_full_at`). RLS on, no policies, revoked from anon and authenticated.
- `play_tick(lat, lng, accuracy)`: inside Lagos bounds, upserts `play_fix`, tops up 3 small boxes (60 to 150 m, refuses zones), 10 per play-day, one call per 15 s. The heavier work runs when `last_full_at` is older than about 50 s (every third tick). Returns boxes now; spots, alerts and counts fill in later phases. Guests (anonymous users) may call it until their three welcome boxes are done; after that it needs an account.
- `claim_game_drop`: remote path for `needs_presence = false` (no radius, no coordinates stored).
- Welcome layout rewrite: A 25 m, B 90 to 130 m, C 180 to 250 m; night 15 to 45 m.
- Nightly job: purge `play_fix` rows older than 24 hours.

Client files:
- New: `src/lib/useLivePosition.ts`, `src/lib/usePlayMode.ts`, `src/lib/deviceTier.ts`, `src/components/play/{PlayLayer,Avatar,Hud,Tray,Pips}.tsx` (dynamic import).
- Edit: `src/components/map/NightMap.tsx` (`mode` and `onMapReady` props; old `play` prop renamed `swoop`), `src/components/BottomNav.tsx` (hidden flag), `src/components/Toaster.tsx` (offsets), `src/lib/useWelcomeBoxes.ts` (trust a fresh fix only), `src/lib/game.ts`, `src/app/page.tsx` (extract box logic, pause tickers in Play).
- Straight-line avatar run, CSS/SVG crates, in-map Common open, four-box Reveal for welcome A, `requireAccount` before the tape rips, "sign up to keep" after the third reveal.
- Same commit: delete the box layer, N LEFT and YOURS pins, arrival toasts and BoxSheet for ordinary opens on the events map. BoxSheet stays for staff and event drops.
- Dev override: arrow keys or click moves the position.
- Real phone checks: zoom 16.4 shows all three boxes; zoom 17.2 overzoom is not blurry (else keep `maxZoom` 17).

Tests: extend `supabase/tests` for `play_tick`, `play_fix` privacy (no read for authenticated), the purge job actually deleting old rows, remote claim, welcome exemption and layout.

## Phase 2. Honest rewards (size M)

Jae tries: a box cannot be opened from the next district; check-in works only near the venue during the event; a collectible prize really lands in the Collection page.

DB (play.sql part 2):
- `claim_game_drop` v2: accuracy input; radius 60 plus min(accuracy, 30) for located claims (special, welcome C); **speed limit 25 m/s (90 km/h) and at least 60 s between located claims** (the shipped function uses 50 m/s; 8 m/s would refuse real riders on the expressway); zone guard for every kind. No 24 hour age rule. Check-in does not use the speed rule.
- **One 150 XP box ceiling per play-day** across welcome A and B, small boxes and spot boxes, with small boxes limited to 100 of it. Special, Golden and check-in XP sit outside it. A claim pays what room is left; a spot claim with no room is refused (`xp_full`) before it uses a slot. Small boxes drop from 15 to 10 a day.
- **Collectible delivery.** `user_collectibles (user_id, collectible_id, claim_id)`; `claim_game_drop` writes a row for a `collectible` prize; the Collection page reads it. (Today the function pays XP and badges only and `collections` needs an event drop.) Gist: a `rewards_gist` flag, false until a Gist system exists; the Gist count stays out of the HUD.
- Random pool picker with distinct prizes: written in Phase 4 on top of the existing `drop_rewards` picker (rows with `quantity 1`); the test goes with it.
- Nightly job: blank `drop_claims` lat and lng, and `game_drops.geog` for near, special and welcome, 48 hours after close; relax the geog check for those kinds; delete unclaimed expired small boxes. Receipts stay.
- `claim_checkin` tightening only (the security fix): for events with a venue location, 300 m plus min(accuracy, 100), inside the event window, 3 per play-day, distance logged. Events without a venue location keep today's rules. No XP change.
- Streak and `my_week_days` count boxes and check-ins on the play-day. `open_daily_box` retired. Outside day derived from claims on `needs_presence` boxes and check-ins.

Client: `CHECKIN_RADIUS_M` follows the new rule (`src/lib/useCheckin.ts`); `Fix` gets accuracy and timestamp; Me's Today's box becomes the Play entry showing pips (`src/app/me/page.tsx`, `src/lib/useDailyBox.ts`).

Tests: claim v2 (radius, accuracy, a 6 km move in 10 minutes passes, a 60 km move in 10 minutes fails, 60 s gap, small cap 100, shared ceiling 150, welcome), a collectible claim creates a `user_collectibles` row, check-in window and cap, purge job.

## Phase 3. Special box, pips, night (size M)

Jae tries: sign up, see the locked pink crate with its unlock time; four hours later (shorten it on the test DB) one pink crate far away with a dashed line; walk to it, the pip lights; day 7 gives the Golden Box.

DB:
- `ensure_special_box` inside `play_tick`: only when now >= `account_at` plus 4 hours (a `special_unlock_hours` setting, default 4), between 06:00 and 19:00, same area, 400 to 1,500 m then 250 to 600 m then skip (after 18:00 only the 250 to 600 m range); the segment must not cross water or a zone; closes 22:00. Unlock source is `profile_private.account_at` from day one and stays so; Phase 6 only makes `finish_account()` write it at the code step, so the timing never changes silently.
- **No approach-proof columns.** The claim uses the radius, the accuracy cap and the speed rule only.
- Golden Box flag (day 7, 2 outside days, once per 7 days). Special pays 60 XP, Golden 150 XP, card slot reserved for the deck.

Client: locked crate with unlock time ("Opens at 14:10" or "Opens tomorrow 06:00"), rim glint, dashed line, night chip, pause button, idle auto-exit after 10 minutes, tray messages for every state in spec section 15.

Tests: unlock timing at 3 h 59 m and 4 h 01 m, the 06:00 to 19:00 window and the 18:00 near-range rule, water crossing refusal, Golden once per 7 days.

## Phase 4. Spots with avatar travel and the first-10 box (size L)

Jae tries: press SPAWN NOW in admin; a spot lights up with its sheet; tap SEND on a second phone 1 to 3 km away and watch the avatar run 10 to 60 seconds, arrive, and appear in the room on the first phone a few seconds later; both tap the box and get different rewards; the 11th phone gets "All 10 taken"; try a spot 4 km away and get "too far".

DB (play.sql part 3, and `chat_accounts.sql` for the room table):
- `game_drops`: `is_spot boolean`; `claim_method` adds `'avatar'` (full constraint lists as in Phase 0).
- `spawn_rules`: reuse `lifetime_minutes` (90), `max_claims` (10), `reward_model` ('random') and the `rewards` list (10 items, each `quantity 1`, with XP prizes and at most 2 collectibles). Add only `area_rest_minutes` (120), `point_rest_hours` (12) and `max_per_day` (18). One live random spot per area is enforced in `spawn_boxes()`. A new rule "Day spots" (07:00 to 21:00), **inactive** until the launch gate. The old 30 minute example rules stay inactive.
- `spawn_boxes()` update: respects the area and point rests, one live spot per area and the daily cap when a rule runs (SPAWN NOW ignores them); the existing picker with `quantity 1` rows already gives 10 distinct prizes.
- **One table, `spot_visits`** (id, user_id, drop_id, mode, state, started_at, eta_s, arrived_at, visible_from, last_seen, key). Partial unique index: one running or arrived visit per user. No coordinates. RLS on, no policies, revoked. No separate trips table. Rows (and the key from `identity_for(user, 'spot:' || drop_id, false)`) are purged one day after the spot closes.
- RPCs: `start_trip(spot, mode)`, `arrive_trip(trip)`, `leave_spot()`, `spot_pulse(spot, cursor)` (heads and, in Phase 5, vibes). Rules exactly as spec section 5: reads `play_fix` (under 2 minutes old), 3 km (checked, then forgotten), **`eta_s` random 10 to 60 for auto, never derived from distance**, auto arrival at or after `eta_s - 3` s (never under 7) and by 60 s plus 10 s grace, steer arrival from 10 s to 180 s plus grace, 6 starts an hour, 20 a day and 8 rooms a day (counters on `play_fix`), one running visit, `visible_from` = arrival plus 0 to 20 s random (steer: the later of arrival and start plus 90 s, plus 0 to 20 s). Head removal at a random 10 to 20 minutes after the last refresh. **No RPC returns `started_at`, `arrived_at`, `visible_from`, `eta_s` or any time or order of arrival;** room order is linked and waved first, then a hash of the key. Counts under 3 read "a few"; prizes left return as pips only.
- `in_room(user, 'spot:<id>')` branch: a visit whose `visible_from` has passed and whose head is not removed. `purge_expired_rooms` handles spot visits and spot keys.
- `claim_game_drop` avatar branch: requires the visit row (arrived, seen in the last 10 minutes), one claim per spot, 2 an hour (replacing the old 6 an hour for spot boxes), 6 a play-day, `claimed_count < 10` under the existing row lock, no radius, no speed check, no coordinates stored; the 150 XP ceiling from Phase 2 applies; draws one remaining reward at random. Gate: `has_account()` for now (Phase 6 makes it a verified account).
- `play_tick` now returns spots within 3 km and the user's visit and room state, and refreshes `last_seen` for an avatar at a spot.
- `reports.kind` gains `'spot'` (and `'vibe'` in Phase 5), `ref_id` = drop id; admin lists spots with 3 or more distinct reporters. A test covers the new kinds.

Client:
- New: `src/components/play/{SpotRing,SpotSheet,SendAvatar,Room}.tsx`, `src/lib/play/{spots,trip}.ts`.
- Spot ring and rim glint, tray sheet (name, "Open until", "a few here" or a count, 10 prize pips, honest empty state), SEND with auto run (curved ease, `eta_s` from the server), **steer mode: four on-screen arrows move the avatar across the real map at a fixed speed, like the mock, with no road snapping yet** (Phase 7 adds snapping), the room as up to 10 heads on a ring (6 on low tier) plus a spot sheet list, "Bring avatar home", Hide this spot, Report this spot, quiet "Gone" and "Too far" states, limit messages before the tape rips.
- `src/components/admin/SpawnerSection.tsx`: new fields, a Spot reports list, SPAWN NOW writes the prize pool.
- Edits to Ola's files: the `spot_visits` table, the `in_room` branch and the purge in `supabase/chat_accounts.sql`; the `reports.kind` list in `supabase/schema.sql`.

Tests: `supabase/tests/spot_travel_test.sql` (3 km limit by `play_fix`, stale fix, `too_fast` and `expired`, `eta_s` not correlated with distance, one visit at a time, 8 rooms a day, visit has no coordinates, no RPC returns a time, the 11th claim fails, rewards all differ, limits per hour and per day, ceiling refusal, claim without a visit fails, spot closing mid-trip, `play_fix` unreadable by others, a head never appears before `visible_from`). Real phone: two devices, the 10 to 60 s run feels right.

## Phase 5. Heads: Wave, Link up, Vibe, and the profile lockdown (size L)

Jae tries: two phones in one room, tap a face: Wave then wave back and the DM opens; Link up and accept and you are in each other's crew with a chat; Vibe pops a sticker over the head; the Crew page shows no home area; rooms show fun room names, not handles.

Order inside the phase matters:

1. **Profiles lockdown.** In `supabase/schema.sql`: `profiles_read` replaced by own-row only; a **definer-owned** public view with handle, look and XP only (no `area`, no `is_admin`, no `id`, no `display_name`); `my_crew()` RPC (handle, name, XP, look; accepted crew only) so the Crew page does not need `area`; an exact-handle lookup RPC replacing the `ilike '%q%'` search on `display_name`. Check every profile read: `src/lib/useSession.ts` (select of the own row is fine), `src/lib/useCrew.ts` (**line 44 embeds `profiles` through `crew_friend_id_fkey`; embeds do not work through a view, so it moves to `my_crew()`; line 83 is the search**), the `useMyLook` hook, `src/app/api/account/create/route.ts`, the monthly board RPC (shows handles). **Remove the area and distance from `src/app/crew/page.tsx` (lines near 224, 258 to 269 and 300) and the area placement in `src/lib/useCrew.ts`.** Nothing may `select *` from the view. Tests run as anon and as another user. If Jae wants names public, the view gets `display_name` back (spec section 20).
2. **Close the chat and Hop holes.** `message_visible`: `spot:%` and `hop-%` false. `stamp_message`: refuses them. `riders_read` limited to own rows and `riders_insert_own` removed (no client code uses `hop_riders` today; listed in spec section 18).
3. **Wave.** `send_wave`: for `spot:` channels both people must be in the room (or inside the head's removal window) and `have_met` is skipped; required `met_at` ("Met at Freedom Park", new column on `waves`); one re-wave after 7 days. `my_waves` returns `met_at` and shows the room name instead of the handle until the wave is returned. 30 a day stays.
4. **Link up.** `link_requests` table (kept separate from `waves`), `send_link(key)` (both in the room), `send_link_by_handle(handle)` (Crew page, exact handle), `respond_link(id, accept)`, `my_links()`, a helper that opens the DM between two users. On accept: both crew rows plus the DM. Limits: 10 requests a day, 20 pending, resend after 7 days, blocked senders see "sent". Requests show the room name until accepted. Close the old path: `add_to_crew` revoked, `crew_rw_own` becomes select and delete only. `useCrew.add` calls the RPC.
5. **Vibe.** `spot_vibes` table, `send_vibe(key, sticker)` (catalogue ids 1 to 10, both in the room, 10 a minute, 3 a minute to one person, 150 a day, at most 5 a minute and 30 an hour arriving at one person, both-way block filter), `spot_pulse` returns vibes since a cursor, purge 2 hours after close. Report kind `vibe`. Settings: "Mute vibes".
6. **`spot_people(spot)`.** Key, room name, look, waved, dm id, linked; ring order is linked and waved first, then a key hash; excludes blocks both ways; never a handle (unless returned or linked), a distance or a time.
7. **Report-based hiding.** 3 distinct reporters of a person hide that avatar from rooms until staff look (a flag, not a delete).
8. **Client.** `src/lib/chat.ts` gets a `spot` kind and `Person.dm`; `WAVE_TEXT` rewritten (no more "party or group chat"); `src/components/chat/PersonCard.tsx` gets Wave, Link up, Vibe, OPEN CHAT, Block, Report, uses `requireAccount` and the in-place sheet, the DM opens as a sheet and never `router.push`; new `src/components/play/{VibePicker,VibePop}.tsx` and ten SVG stickers (no emoji); the sender sees the sticker at once, others on the next pulse (6 s, 10 s above 20 avatars, with a cursor); incoming requests dot on the avatar from the heartbeat's unread counts; Settings: Blocked list with the existing unblock; first-send line "Your avatar shows at the spot with a room name and your look". Delete the dead `useGoing` duplicate in `chat.ts`.

Tests: `supabase/tests/spot_social_test.sql` (public view hides `area`, `id`, `is_admin` and `display_name` when read as anon and as another user, both-way blocks, no coordinates, handles or times in `spot_people`, head removal window, keys and room names differ per spot, wave rules including a spot wave to someone not in the room failing and a faked shared Hop not helping, mutual link up creates two crew rows and a DM, one-way request does not, vibe limits including the receiver cap, unknown sticker, `message_visible` and `stamp_message` for spot and hop rooms, `crew` cannot be written directly, `hop_riders` rows of others unreadable).

## Phase 6. Alerts, email OTP, push, then the launch gate (size XL)

Jae tries: pick Off, A few or All in Settings; a spot lights and an alert with SEND arrives (on Android with the app closed); sign up with a real code from Inbucket; the special box unlock counts from the code; an unverified account cannot wave.

DB:
- `profile_private`: `spot_alerts text default 'few' check (off, few, all)`, `verified_at timestamptz`, `email_norm` (unique), `email_domain`. `is_verified()`.
- **`finish_account()`** stamps `verified_at` and `account_at`, copies name and gender from the user metadata (length checked), and refuses unless it sees proof of a fresh code: the session `amr` list holds an `otp` entry from the last 10 minutes (confirmed on the local stack first, with a fresh-confirmation fallback). It never trusts `email_confirmed_at is not null`. It enforces one account per normalised email (lowercase, Gmail dots and `+tags` removed, `googlemail.com` as `gmail.com`) and a disposable-domain blocklist. The before-user-created hook is added too only if the plan has it.
- **Backfill on the local database only.** Production legacy accounts get `verified_at` null and sign in with `signInWithOtp` then `verifyOtp`.
- `has_account()` (Ola's file) requires `verified_at`. The special box keeps using `account_at`.
- Alerts: `play_tick` returns spots newer than `alert_cursor` within 3 km, honouring the setting, `alerts_today` (A few = 3 per play-day, first come first served) and quiet hours 21:00 to 07:00; a light `check_spot_alerts(lat, lng)` for the 60 s foreground check. No log table.
- Per-user hide list stays on the phone.
- Admin: a concentration flag on a spot when 3 or more of its 10 winners signed up in the same hour or share an email domain.

Client and routes:
- `src/app/api/account/create/route.ts`: **the confirm step is deleted in the same commit** (or the whole route). The sign-up sheet calls `updateUser({ email, password, data: { display_name, gender } })` as the user, then a code step (`src/lib/account.ts` and the sheet component) with `verifyOtp`, a resend after 60 s, a clear wrong-code and expired-code message, a "That email already has an account, sign in instead" path, then `finish_account()`.
- Settings row: "Spot alerts: Off, A few, All". Alert banner with SEND. Honest line "Alerts need the app open" until push is on.
- **Web push, Android first.** Service worker, VAPID keys, a `push_subscriptions` table, a sender that runs when a spot lights (a `pg_net` call from `spawn_boxes` to a protected route or a Supabase Edge Function; check the Vercel plan before relying on cron), the same setting, quota, 6 hour fix age and quiet hours. The install prompt after the 3rd box (Jae's decision, its own key, separate commit) opens the iPhone path, where push works once the app is on the home screen. Tapping a push opens the spot sheet.
- Auth settings, written down in `docs/AUTH.md` and in SPAWNING.md: email confirmations on, OTP length 6, expiry 10 minutes, anonymous sign-in rate limit and CAPTCHA, the **email_change template and the sign-up template both carry `{{ .Token }}`**, local Inbucket at http://127.0.0.1:54324, production custom SMTP with Resend (verified sending domain with SPF, DKIM, DMARC).
- First check on the local stack, before writing the UI: which template, which `verifyOtp` type and what `amr` look like for the anonymous upgrade. Do not guess.

Tests: `supabase/tests/otp_gate_test.sql` (unverified account fails wave, link, vibe, spot claim, special; verified passes; a legacy account with an old confirmed email cannot call `finish_account()` without a fresh code; duplicate normalised email refused; disposable domain refused), alert counts per setting, stale fix gives no alert, quiet hours, concentration flag.

**Launch gate (end of this phase), a checked list:**
1. Paid Resend plan or equal, Supabase auth email rate limit raised, sender domain with SPF, DKIM, DMARC.
2. A real 6 digit code arrives in Gmail and Yahoo inboxes from the `email_change` template; resend after 60 s and expiry at 10 minutes work.
3. CAPTCHA on for sign-up and anonymous sign-in; email normalisation and the disposable blocklist live.
4. Web push works on two Android phones and (after install) one iPhone.
5. Full smoke on two phones.
6. Last item: switch on the "Day spots" rule (a test beforehand proves the rule exists and is inactive until now), and tell Jae the window (07:00 to 21:00) and the count (about 18 a day) in one line so he can change the two fields.

## Phase 7. Polish and handoff (size M)

Only what the data asks for:
- Steer road snapping from the basemap road layer; `deviceTier` refinement if a phone needs it; glint tuning; the three sound blips behind a flag.
- Epic and Legendary ceremony and cards (needs the deck), WaysToEarn copy.
- Realtime on `spot_vibes` for the receiver only (policy `to_user = auth.uid()`) if polling load asks for it.
- Final note for Ola, updated docs.

## Phase 8. Events as big spots (size M, after launch)

Moved out of the first release because Jae's corrections do not need it and staff-lit spots already cover launch days: a live event with a real venue becomes a spot (30 minutes before start to its end), a venue-verified flag, `whos_here` 6 hour window with "Show me in the event room" (`profile_private.show_in_event_room`, asked once in place at check-in), the organiser box trigger (within 300 m of the approved venue, inside the window), events exempt from no-spawn zones except water, the chill deck once the card deck exists.

## Track B (same branch, separate commits, any time after Phase 0)

Level ladder 0/500/2,000/6,000/15,000 with ranks in thirds, event quests doubled, level-up moment, in commits labelled "Track B" so Ola's review of Play is not buried. Hop stop 250 XP waits for a server-verified boarding function from Ola.

## Later (needs other work)

Card deck and Gist (and the chill deck), Hop social after verified boarding, phone or WhatsApp codes, device attestation, organiser tools.

## What we measure from day one

Alerts sent, alerts opened and push delivery, trips started and arrived, time from spawn to the first claim and to 10 of 10, claims per spot, avatars per room, wave, link up and vibe rates, link accept rate, OTP completion and resend rate, check-in distances, hide and report rate, and winner concentration (sign-up hour and email domain of the 10 winners). Spot count and length change only on these.

## Risks and how the plan covers them

- A 10-slot race rewards whoever has the app open. Push alerts help; watch time to 10 of 10 and the alert-open rate.
- The 3 km rule and "arrival" are not security (the position comes from the phone). The protection is the verified and unique email, CAPTCHA, limits, small prizes and the winner-concentration flag. Phone codes are the next step if the data shows a farm.
- One person with many real emails takes slots. Watch concentration; add phone codes if needed.
- A stalker could learn a rough 1 to 2 km zone from someone's look across many rooms. Room names, the head delay, random travel time, the 8-rooms cap and counts under 3 hidden make it slow and noisy. Not zero.
- Polling load: the room pulse is the heaviest loop (6 s per open room, 10 s above 20 avatars, with a cursor). The heartbeat does heavy work every third tick. Realtime for the receiver is the next step.
- Supabase's built-in email limits and the Resend free plan. Paid plan and raised limits are in the launch gate, or sign-up stalls.
- Steering is cosmetic. It is described that way everywhere so nobody thinks the server checks a route.

## Order at a glance

0 Merge, docs and push to jae/ui-refresh. 1 Play shell and small boxes. 2 Honest rewards. 3 Special box and pips. 4 Spots with avatar travel and the first-10 box. 5 Heads: Wave, Link up, Vibe, profile lockdown. 6 Alerts, email OTP, push, launch gate. 7 Polish. 8 Events as big spots (after launch). Track B on the side.
