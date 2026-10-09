# Spawn alerts by web push

A Hopper picks how many spawn alerts they get in Settings on Me: **Off**, **A few** (about 3 a play-day) or **All**. The default is A few. When a spot lights near them, a notification arrives even with the app closed, and tapping it opens Hoppaz at the spot.

Spots arrive in Phase 4. Everything below is built and tested now with a test alert; the spawner only has to call `notify_spot_alert` once per new spot.

## How it works

```
spot lights --> notify_spot_alert()  (supabase/push.sql)
                  quiet hours? configured? --> pick_spot_alert_users()
                  one pg_net POST --> /api/push/send  (shared secret)
                                        --> web-push --> the push service (FCM, Mozilla, Apple)
                                              --> public/sw.js shows the notification
                                                    tap --> focus or open the app at the url
```

- **Browser** (`src/lib/push.ts`, `public/sw.js`): permission, the service worker, the subscription with the VAPID public key, and the Off / A few / All choice. `enablePush()` must run from a tap.
- **Routes** (`src/app/api/push/`): `subscribe` and `unsubscribe` (a Hopper's own token), `send` (shared secret or the staff token only), `test` (development only, a 404 in production).
- **Database** (`supabase/push.sql`): `push_subscriptions` (a Hopper reads and deletes only their own rows), `alert_prefs` (the level), `push_config` (server-only settings), `pick_spot_alert_users`, `notify_spot_alert`.

### Who gets an alert for a spot

All of these, decided in the database, not in the app:

- they have a push subscription and have not chosen Off;
- their last `play_fix` is under 6 hours old and within 3 km of the spot (the fix is already rounded to about 110 m; the alert body says "About 1.4 km from you" to that Hopper only, never coordinates);
- A few: fewer than 3 alerts so far this play-day (the play-day turns over at 06:00 Lagos). All: no cap;
- not already alerted for this spot or a newer one (`play_fix.alert_cursor`; spots that light in the same instant count as one wave);
- not in quiet hours, **23:00 to 07:00 Lagos** (Jae, 9 Oct 2026). Change the hours without a deploy with `select set_push_config('quiet_from_hour','21'); select set_push_config('quiet_until_hour','7');`. The same call changes `few_per_day` (3), `radius_m` (3000) and `fix_max_age_hours` (6).

The picker spends the alert from the same counters (`alerts_today`, `alert_day`, `alert_cursor`) that the in-app alert in `play_tick` will use in Phase 6, so a Hopper never gets the same spot twice or more than their cap across both routes. `alert_prefs` is the setting; Phase 6 can read it instead of adding `profile_private.spot_alerts`.

### iPhone

Web push on iPhone works only after Hoppaz is on the home screen (iOS 16.4 and later). In a Safari tab the push APIs are absent, so `pushSupport()` returns `needs-install`; the Settings row then says so and its ADD TO HOME SCREEN button calls `askToInstall()`, which opens Ola's `InstallSheet` through its sign-in moment (the one trigger that is not tied to a win). When InstallSheet gets its own alerts moment, change that one line in `src/lib/push.ts`. After installing, open the installed app and tap A few or All again: the permission question has to come from a tap inside the installed app.

## Env vars

| Name | Where | What |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel and `.env.local` | public half of the key pair; inlined into the browser bundle, so a redeploy is needed after changing it |
| `VAPID_PRIVATE_KEY` | Vercel and `.env.local` | private half; server only, never in git |
| `VAPID_SUBJECT` | Vercel and `.env.local` | `mailto:` the support address (push services contact it about abuse) |
| `PUSH_SEND_SECRET` | Vercel and `.env.local`, and the database | the shared secret for `POST /api/push/send` |
| `SUPABASE_SECRET_KEY` | already set | how the send route reads subscriptions |

Make a key pair: `node -e 'const w=require("web-push");console.log(w.generateVAPIDKeys())'`. Never reuse the local pair in production. Changing the pair makes every saved subscription useless; `enablePush()` re-subscribes on the next tap and `syncPush()` keeps a good one saved.

## Run order

`schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql, spawn_points_lagos.sql, box_guards.sql, daily_box.sql, play.sql, push.sql`. Push runs after play.sql because it reads `play_fix`. Safe to run again.

Then tell the database where the send route is (once per environment; local value in `localdb/README.md`):

```sql
select set_push_config('send_url', 'https://YOUR-APP/api/push/send');
select set_push_config('send_secret', '<the same value as PUSH_SEND_SECRET>');
```

Until both are set, `notify_spot_alert` does nothing and says why in a notice (no quota is spent).

## Test it

1. Database: `docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/push_test.sql` ends with `ALL PUSH TESTS PASSED`.
2. In the browser (development): sign in, open Me, Settings, pick A few. Allow notifications. Press SEND ME A TEST ALERT (shown in development only). The notification shows with the Hoppaz icon; tapping it focuses the app.
3. The database path, end to end, with no spots: put your test Hopper's fix near a point and call the notifier by hand (as the postgres role):
   ```sql
   -- a fix for you, anywhere in Lagos (your own user id from auth.users)
   insert into play_fix (user_id, lat, lng, accuracy) values ('<your user id>', 6.428, 3.421, 20)
     on conflict (user_id) do update set lat = 6.428, lng = 3.421, at = now(), alert_cursor = null, alerts_today = 0;
   select notify_spot_alert(gen_random_uuid(), 6.430, 3.425, 'Test spot', now(), now());
   ```
   It returns the number of Hoppers alerted. It returns 0 between 23:00 and 07:00 Lagos; pass `p_now => '2026-10-15 12:00+01'` and `p_spot_at` to test at another hour.
4. The send route alone: `curl -X POST $URL/api/push/send -H "Authorization: Bearer $PUSH_SEND_SECRET" -H 'content-type: application/json' -d '{"user_ids":["<id>"],"title":"Test","body":"Hello","url":"/"}'`.

## Production (Jae)

1. Make a new VAPID pair; put `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `PUSH_SEND_SECRET` (a long random string) in Vercel, then redeploy.
2. Run `push.sql` on the Supabase project, then the two `set_push_config` lines with the real address and the same secret.
3. Choose how a new spot calls the notifier. **pg_net** (enable it in Database, Extensions; `push.sql` tries to create it) lets `spawn_boxes` call `notify_spot_alert` directly, with no Vercel cron and no polling, and the pushes go out the moment a spot lights. The fallback, if pg_net is not allowed on the plan, is a Vercel cron route that calls the same functions every few minutes: Vercel Hobby only allows daily crons, so check the plan first.
4. `/api/push/test` and the test button only exist in development.
