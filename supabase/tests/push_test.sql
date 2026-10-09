-- ============================================================================
-- Hoppaz: spawn alert (web push) tests
-- Run against a LOCAL database that has the whole load order applied, push.sql
-- last:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/push_test.sql
--
-- One transaction that always rolls back, so nothing is kept (the pg_net
-- request it queues is rolled back too, so nothing is sent). Every check
-- raises an exception on failure; the last line printed is
-- ALL PUSH TESTS PASSED.
-- Test sites are open sea south of Lagos, so no real data sits near them.
-- Inside one transaction now() does not move, so the tests pass their own
-- clock (p_now) to the picker.
-- ============================================================================
begin;

-- --------------------------------------------------------------- helpers ---
create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $f$
begin
  if p_cond is not true then raise exception 'TEST FAILED: %', p_msg; end if;
end $f$;

create function pg_temp.eq(p_got text, p_want text, p_msg text) returns void language plpgsql as $f$
begin
  if p_got is distinct from p_want then raise exception 'TEST FAILED: % (got %, wanted %)', p_msg, p_got, p_want; end if;
end $f$;

create function pg_temp.lagos(p_ts text) returns timestamptz language sql as $f$
  select p_ts::timestamp at time zone 'Africa/Lagos';
$f$;

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pushtest-' || u || '@pushtest.invalid', '{}', '{}', now(), now());
  return u;
end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- A Hopper with a push subscription and a fix. p_fix_at is when the heartbeat last saw them.
create function pg_temp.hopper(p_lat double precision, p_lng double precision, p_fix_at timestamptz default null, p_sub boolean default true)
returns uuid language plpgsql as $f$
declare u uuid := pg_temp.newuser();
begin
  insert into public.play_fix (user_id, lat, lng, accuracy, at) values (u, p_lat, p_lng, 20, coalesce(p_fix_at, now()));
  if p_sub then
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (u, 'https://push.example.test/' || u, repeat('p', 87), repeat('a', 22));
  end if;
  return u;
end $f$;

create function pg_temp.picked(p_spot uuid, p_lat double precision, p_lng double precision, p_spot_at timestamptz, p_now timestamptz)
returns uuid[] language sql as $f$
  select coalesce(array_agg(user_id), '{}') from public.pick_spot_alert_users(p_spot, p_lat, p_lng, p_spot_at, p_now);
$f$;

-- The spot sits in open sea off Lagos. 0.01 degree of latitude is about 1.1 km.
-- ------------------------------------------------- quiet hours (23 to 7) ---
do $t$
begin
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-15 22:59'))::text, 'false', '22:59 is awake');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-15 23:00'))::text, 'true',  '23:00 is quiet');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-16 00:30'))::text, 'true',  '00:30 is quiet');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-16 06:59'))::text, 'true',  '06:59 is quiet');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-16 07:00'))::text, 'false', '07:00 is awake');
  -- Jae can change the hours without a redeploy
  perform public.set_push_config('quiet_from_hour', '21');
  perform public.set_push_config('quiet_until_hour', '9');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-15 21:30'))::text, 'true',  '21:30 is quiet with the changed hours');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-16 08:30'))::text, 'true',  '08:30 is quiet with the changed hours');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-16 09:00'))::text, 'false', '09:00 is awake with the changed hours');
  perform public.set_push_config('quiet_from_hour', null);
  perform public.set_push_config('quiet_until_hour', null);
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-15 23:00'))::text, 'true', 'defaults are back');
  perform pg_temp.eq(public.push_in_quiet_hours(pg_temp.lagos('2026-10-16 07:30'))::text, 'false', 'the default morning is back');
  raise notice 'ok: quiet hours';
end $t$;

-- --------------------------------------------- subscriptions and their RLS ---
do $t$
declare a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); n integer; ok boolean; i integer;
begin
  -- a signed-out caller cannot save, read or delete
  perform pg_temp.as_anon();
  begin
    perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('p', 87), repeat('a', 22));
    raise exception 'TEST FAILED: anon saved a subscription';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.push_subscriptions;
    raise exception 'TEST FAILED: anon read subscriptions';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user(a);
  perform pg_temp.ok(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a1', repeat('p', 87), repeat('a', 22), 'UA'), 'valid subscription saves');
  perform pg_temp.eq(public.save_push_subscription('http://push.example.test/insecure', repeat('p', 87), repeat('a', 22))::text, 'false', 'http endpoint refused');
  perform pg_temp.eq(public.save_push_subscription('not a url', repeat('p', 87), repeat('a', 22))::text, 'false', 'garbage endpoint refused');
  -- the server posts to a saved address, so only real push services may be saved
  perform pg_temp.eq(public.save_push_subscription('https://internal.example.test:8443/admin/hook?x=1', repeat('p', 87), repeat('a', 22))::text, 'false', 'non-push host refused');
  perform pg_temp.eq(public.save_push_subscription('https://fcm.googleapis.com.evil.test/fcm/send/x', repeat('p', 87), repeat('a', 22))::text, 'false', 'look-alike host refused');
  perform pg_temp.eq(public.save_push_subscription('https://evil.test/push.apple.com/x', repeat('p', 87), repeat('a', 22))::text, 'false', 'push host in the path refused');
  perform pg_temp.eq(public.save_push_subscription('https://user@fcm.googleapis.com/fcm/send/x', repeat('p', 87), repeat('a', 22))::text, 'false', 'userinfo refused');
  perform pg_temp.eq(public.save_push_subscription('https://fcm.googleapis.com:8443/fcm/send/x', repeat('p', 87), repeat('a', 22))::text, 'false', 'odd port refused');
  perform pg_temp.ok(public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/abc', repeat('p', 87), repeat('a', 22)), 'Mozilla push host saves');
  perform pg_temp.ok(public.save_push_subscription('https://web.push.apple.com/QAbc', repeat('p', 87), repeat('a', 22)), 'Apple push host saves');
  delete from public.push_subscriptions where endpoint in ('https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QAbc');
  perform pg_temp.eq(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a2', 'short', repeat('a', 22))::text, 'false', 'short key refused');
  perform pg_temp.eq(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a3', repeat('p', 87), '')::text, 'false', 'empty auth refused');
  -- saving the same endpoint again is a refresh, not a second row
  perform pg_temp.ok(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a1', repeat('q', 87), repeat('b', 22), 'UA2'), 'same endpoint saves again');
  select count(*) into n from public.push_subscriptions;
  perform pg_temp.eq(n::text, '1', 'one row after a re-save');

  -- a direct insert or update is not allowed for a Hopper
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (a, 'https://push.example.test/direct', repeat('p', 87), repeat('a', 22));
    raise exception 'TEST FAILED: direct insert worked';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.push_subscriptions set endpoint = 'https://push.example.test/hacked';
    raise exception 'TEST FAILED: direct update worked';
  exception when insufficient_privilege then null;
  end;

  -- B sees nothing of A's, and cannot delete A's row
  perform pg_temp.as_user(b);
  select count(*) into n from public.push_subscriptions;
  perform pg_temp.eq(n::text, '0', 'B sees none of A''s subscriptions');
  delete from public.push_subscriptions;
  perform pg_temp.as_user(a);
  select count(*) into n from public.push_subscriptions;
  perform pg_temp.eq(n::text, '1', 'A''s row survived B''s delete');

  -- the same phone signs in as B: the row changes owner
  perform pg_temp.as_user(b);
  perform pg_temp.ok(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/a1', repeat('p', 87), repeat('a', 22)), 'B takes the endpoint over');
  select count(*) into n from public.push_subscriptions;
  perform pg_temp.eq(n::text, '1', 'B sees it now');
  perform pg_temp.as_user(a);
  select count(*) into n from public.push_subscriptions;
  perform pg_temp.eq(n::text, '0', 'A no longer sees it');

  -- A can delete their own
  perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/own', repeat('p', 87), repeat('a', 22));
  delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/own';
  get diagnostics n = row_count;
  perform pg_temp.eq(n::text, '1', 'A deletes their own row');

  -- at most 5 browsers per Hopper
  for i in 1..7 loop
    perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/many' || i, repeat('p', 87), repeat('a', 22));
    perform pg_sleep(0.002);
  end loop;
  select count(*) into n from public.push_subscriptions;
  perform pg_temp.eq(n::text, '5', 'capped at 5 browsers');
  perform pg_temp.as_admin();
  raise notice 'ok: subscriptions and RLS';
end $t$;

-- ---------------------------------------------------------- alert level ----
do $t$
declare a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); n integer;
begin
  perform pg_temp.as_user(a);
  perform pg_temp.eq(public.my_alert_level(), 'few', 'the default is A few');
  perform pg_temp.ok(public.set_alert_level('off'), 'set off');
  perform pg_temp.eq(public.my_alert_level(), 'off', 'reads back off');
  perform pg_temp.ok(public.set_alert_level('all'), 'set all');
  perform pg_temp.eq(public.my_alert_level(), 'all', 'reads back all');
  perform pg_temp.eq(public.set_alert_level('lots')::text, 'false', 'an unknown level is refused');
  perform pg_temp.eq(public.set_alert_level(null)::text, 'false', 'null is refused');
  perform pg_temp.eq(public.my_alert_level(), 'all', 'a refused level changes nothing');
  begin
    update public.alert_prefs set alert_level = 'off';
    raise exception 'TEST FAILED: direct update of the level worked';
  exception when insufficient_privilege then null;
  end;
  -- B cannot see or move A's choice
  perform pg_temp.as_user(b);
  select count(*) into n from public.alert_prefs;
  perform pg_temp.eq(n::text, '0', 'B sees no one else''s level');
  perform pg_temp.eq(public.my_alert_level(), 'few', 'B still has the default');
  perform pg_temp.as_anon();
  begin
    perform public.set_alert_level('all');
    raise exception 'TEST FAILED: anon set a level';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_admin();
  raise notice 'ok: alert level';
end $t$;

-- ------------------------------------------------------------- the picker ---
do $t$
declare
  now0 timestamptz := pg_temp.lagos('2026-10-15 12:00');
  lat0 constant double precision := 6.20; lng0 constant double precision := 3.40;  -- open sea
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid();
  near_ uuid; edge uuid; far_ uuid; stale uuid; fresh uuid; nosub uuid; offu uuid; allu uuid; got uuid[];
begin
  -- 1.1 km, 2.7 km, 3.3 km north of the spot
  near_ := pg_temp.hopper(lat0 + 0.010, lng0, now0 - interval '10 minutes');
  edge  := pg_temp.hopper(lat0 + 0.024, lng0, now0 - interval '10 minutes');
  far_  := pg_temp.hopper(lat0 + 0.030, lng0, now0 - interval '10 minutes');
  stale := pg_temp.hopper(lat0 + 0.010, lng0, now0 - interval '6 hours 1 minute');
  fresh := pg_temp.hopper(lat0 + 0.010, lng0, now0 - interval '5 hours 59 minutes');
  nosub := pg_temp.hopper(lat0 + 0.010, lng0, now0 - interval '10 minutes', false);
  offu  := pg_temp.hopper(lat0 + 0.010, lng0, now0 - interval '10 minutes');
  allu  := pg_temp.hopper(lat0 + 0.010, lng0, now0 - interval '10 minutes');
  insert into public.alert_prefs (user_id, alert_level) values (offu, 'off'), (allu, 'all');

  got := pg_temp.picked(s1, lat0, lng0, now0, now0);
  perform pg_temp.ok(near_ = any(got), 'near Hopper (1.1 km) is alerted');
  perform pg_temp.ok(edge = any(got), 'Hopper at 2.7 km is alerted');
  perform pg_temp.ok(not far_ = any(got), 'Hopper at 3.3 km is not alerted');
  perform pg_temp.ok(not stale = any(got), 'a fix over 6 hours old gets no alert');
  perform pg_temp.ok(fresh = any(got), 'a fix just under 6 hours old does');
  perform pg_temp.ok(not nosub = any(got), 'no push subscription, no push (and no quota spent)');
  perform pg_temp.ok(not offu = any(got), 'Off gets nothing');
  perform pg_temp.ok(allu = any(got), 'All is alerted');
  perform pg_temp.eq(array_length(got, 1)::text, '4', 'exactly near, edge, fresh and all');

  -- the age rule uses the clock it is given: a day later every fix above is stale
  perform pg_temp.eq(array_length(pg_temp.picked(s4, lat0, lng0, now0 + interval '1 day', now0 + interval '1 day'), 1)::text, null, 'a day later every fix is stale');

  -- quota was spent, the cursor moved, the day is stamped
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = near_), '1', 'near: one alert spent');
  perform pg_temp.eq((select (alert_cursor = now0)::text from public.play_fix where user_id = near_), 'true', 'near: cursor is the spot time');
  perform pg_temp.eq((select alert_day::text from public.play_fix where user_id = near_), '2026-10-15', 'near: the play-day is stamped');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = nosub), '0', 'no subscription: nothing spent');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = far_), '0', 'far: nothing spent');

  -- dedupe: the same spot again alerts no one; an older one neither
  perform pg_temp.eq(array_length(pg_temp.picked(s1, lat0, lng0, now0, now0), 1)::text, null, 'the same spot never alerts twice');
  perform pg_temp.eq(array_length(pg_temp.picked(s1, lat0, lng0, now0 - interval '1 minute', now0), 1)::text, null, 'an older spot does not alert');

  -- A few: 3 per play-day. near_ has 1; two more spots take it to 3, the 4th is refused. All keeps going.
  got := pg_temp.picked(s2, lat0, lng0, now0 + interval '10 minutes', now0 + interval '10 minutes');
  perform pg_temp.ok(near_ = any(got), 'near: second spot alerts');
  got := pg_temp.picked(s3, lat0, lng0, now0 + interval '20 minutes', now0 + interval '20 minutes');
  perform pg_temp.ok(near_ = any(got), 'near: third spot alerts');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = near_), '3', 'near: three spent');
  got := pg_temp.picked(gen_random_uuid(), lat0, lng0, now0 + interval '30 minutes', now0 + interval '30 minutes');
  perform pg_temp.ok(not near_ = any(got), 'near: the 4th alert of the play-day is held back');
  perform pg_temp.ok(allu = any(got), 'All: still alerted on the 4th');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = near_), '3', 'near: the held-back one is not counted');
  perform pg_temp.eq((select (alert_cursor = now0 + interval '20 minutes')::text from public.play_fix where user_id = near_), 'true', 'near: the cursor stays on the last real alert');

  -- the play-day turns over at 06:00 Lagos: 05:59 is still the old day, 06:00 the new
  -- (refresh the fixes: they were seen "just now" at each of these moments)
  update public.play_fix set at = pg_temp.lagos('2026-10-16 05:50') where user_id in (near_, allu);
  got := pg_temp.picked(gen_random_uuid(), lat0, lng0, pg_temp.lagos('2026-10-16 05:55'), pg_temp.lagos('2026-10-16 05:55'));
  perform pg_temp.ok(not near_ = any(got), 'near: 05:55 is still the old play-day, still capped');
  update public.play_fix set at = pg_temp.lagos('2026-10-16 06:00') where user_id in (near_, allu);
  got := pg_temp.picked(gen_random_uuid(), lat0, lng0, pg_temp.lagos('2026-10-16 06:05'), pg_temp.lagos('2026-10-16 06:05'));
  perform pg_temp.ok(near_ = any(got), 'near: a new play-day gives A few a fresh three');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = near_), '1', 'near: the count restarted at one');
  perform pg_temp.eq((select alert_day::text from public.play_fix where user_id = near_), '2026-10-16', 'near: the new play-day is stamped');

  -- a Hopper who turns Off after the fact is skipped on the next spot
  insert into public.alert_prefs (user_id, alert_level) values (near_, 'off') on conflict (user_id) do update set alert_level = 'off';
  got := pg_temp.picked(gen_random_uuid(), lat0, lng0, pg_temp.lagos('2026-10-16 06:20'), pg_temp.lagos('2026-10-16 06:20'));
  perform pg_temp.ok(not near_ = any(got), 'near: turned Off, skipped');

  -- the daily cap is a setting too
  perform public.set_push_config('few_per_day', '1');
  update public.alert_prefs set alert_level = 'few' where user_id = near_;
  update public.play_fix set alerts_today = 1, alert_day = '2026-10-16', at = pg_temp.lagos('2026-10-16 06:25') where user_id = near_;
  got := pg_temp.picked(gen_random_uuid(), lat0, lng0, pg_temp.lagos('2026-10-16 06:30'), pg_temp.lagos('2026-10-16 06:30'));
  perform pg_temp.ok(not near_ = any(got), 'near: a cap of 1 holds back the second');
  perform public.set_push_config('few_per_day', null);

  -- a point outside Lagos alerts no one
  update public.play_fix set at = pg_temp.lagos('2026-10-16 06:25'), alert_cursor = null where user_id = allu;
  perform pg_temp.eq(array_length(pg_temp.picked(gen_random_uuid(), 40.0, -74.0, pg_temp.lagos('2026-10-16 06:30'), pg_temp.lagos('2026-10-16 06:30')), 1)::text, null, 'a spot outside Lagos alerts no one');
  perform pg_temp.eq(array_length(pg_temp.picked(gen_random_uuid(), null, null, pg_temp.lagos('2026-10-16 06:30'), pg_temp.lagos('2026-10-16 06:30')), 1)::text, null, 'a spot with no point alerts no one');
  raise notice 'ok: picker (range, age, level, cap, dedupe, play-day)';
end $t$;

-- ----------------------------------------- who may call the server pieces ---
do $t$
declare a uuid := pg_temp.newuser();
begin
  perform pg_temp.as_user(a);
  begin
    perform * from public.pick_spot_alert_users(gen_random_uuid(), 6.2, 3.4);
    raise exception 'TEST FAILED: a Hopper called the picker';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.notify_spot_alert(gen_random_uuid(), 6.2, 3.4, 'X');
    raise exception 'TEST FAILED: a Hopper called notify_spot_alert';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_push_config('send_secret', 'x');
    raise exception 'TEST FAILED: a Hopper set the config';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.push_config;
    raise exception 'TEST FAILED: a Hopper read the config';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_anon();
  begin
    perform public.notify_spot_alert(gen_random_uuid(), 6.2, 3.4, 'X');
    raise exception 'TEST FAILED: anon called notify_spot_alert';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_admin();
  raise notice 'ok: server-only functions';
end $t$;

-- ------------------------------------------------------ notify_spot_alert ---
do $t$
declare
  now_ok timestamptz := pg_temp.lagos('2026-10-15 12:00');
  u uuid; s uuid := gen_random_uuid(); n integer; has_net boolean := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
begin
  delete from public.push_config where key in ('send_url', 'send_secret');
  u := pg_temp.hopper(6.21, 3.40, now_ok - interval '5 minutes');

  -- not set up: no call, no quota spent
  n := public.notify_spot_alert(s, 6.20, 3.40, 'Test spot', now_ok, now_ok);
  perform pg_temp.eq(n::text, '0', 'no send_url or secret: nothing sent');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = u), '0', 'no quota spent when the route is not set up');

  perform public.set_push_config('send_url', 'http://127.0.0.1:9/api/push/send');
  perform public.set_push_config('send_secret', 'test-secret-not-real');

  -- quiet hours: even a perfect match is held
  n := public.notify_spot_alert(s, 6.20, 3.40, 'Test spot', pg_temp.lagos('2026-10-15 23:30'), pg_temp.lagos('2026-10-15 23:30'));
  perform pg_temp.eq(n::text, '0', 'quiet hours: nothing sent');
  n := public.notify_spot_alert(s, 6.20, 3.40, 'Test spot', pg_temp.lagos('2026-10-16 03:00'), pg_temp.lagos('2026-10-16 03:00'));
  perform pg_temp.eq(n::text, '0', 'quiet hours (03:00): nothing sent');
  perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = u), '0', 'quiet hours spend no quota');

  if has_net then
    n := public.notify_spot_alert(s, 6.20, 3.40, 'Test spot', now_ok, now_ok);
    perform pg_temp.eq(n::text, '1', 'awake, in range, configured: one alert queued');
    perform pg_temp.eq((select alerts_today::text from public.play_fix where user_id = u), '1', 'quota spent');
    perform pg_temp.ok(exists (select 1 from net.http_request_queue where url = 'http://127.0.0.1:9/api/push/send'), 'the request is queued in pg_net');
    n := public.notify_spot_alert(s, 6.20, 3.40, 'Test spot', now_ok, now_ok);
    perform pg_temp.eq(n::text, '0', 'the same spot is not queued twice');
    perform pg_temp.ok((select (convert_from(body, 'utf8')::jsonb)->'alerts'->0->>'body' from net.http_request_queue where url = 'http://127.0.0.1:9/api/push/send' limit 1) like 'About 1.1 km from you.%', 'the body carries a rough distance for that Hopper only');
    perform pg_temp.ok(((select (convert_from(body, 'utf8')::jsonb)->'alerts'->0->>'url' from net.http_request_queue where url = 'http://127.0.0.1:9/api/push/send' limit 1)) = '/?spot=' || s::text, 'the push opens the spot');
    raise notice 'ok: notify_spot_alert (pg_net present)';
  else
    raise notice 'ok: notify_spot_alert (pg_net NOT installed here: the queue checks were skipped)';
  end if;
end $t$;

do $t$ begin raise notice 'ALL PUSH TESTS PASSED'; end $t$;

rollback;
