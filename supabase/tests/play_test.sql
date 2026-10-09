-- ============================================================================
-- Hoppaz: Play mode tests, part 1 (play_tick, small boxes, remote claim,
-- welcome layout, play_fix privacy and purge)
-- Run against a LOCAL database that already has schema.sql, chat_accounts.sql,
-- hunt_items.sql, spawning.sql, box_guards.sql and play.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/play_test.sql
--
-- One transaction that always rolls back, so nothing is kept. It clears the
-- no-spawn zones first (inside the transaction only) so seed and imported data
-- cannot change the result. Every check raises an exception on failure; the
-- last line printed is ALL PLAY TESTS PASSED.
-- Test sites are open sea south of Lagos, so no real data sits near them.
-- Inside one transaction now() does not move, so the tests age a Hopper's
-- play_fix row by hand (age_fix) to step over the 15 s and 50 s rules.
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

create function pg_temp.pt(p_lat double precision, p_lng double precision) returns geography language sql as $f$
  select st_point(p_lng, p_lat)::geography;
$f$;

create function pg_temp.off(p_from geography, p_dist double precision, p_bearing double precision) returns geography language sql as $f$
  select st_project(p_from, p_dist, radians(p_bearing))::geography;
$f$;

create function pg_temp.lat(p_g geography) returns double precision language sql as $f$ select st_y(p_g::geometry); $f$;
create function pg_temp.lng(p_g geography) returns double precision language sql as $f$ select st_x(p_g::geometry); $f$;

-- a Hopper with an email (an account)
create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'playtest-' || u || '@playtest.invalid', '{}', '{}', now(), now());
  return u;
end $f$;

-- a guest: an anonymous user, no email
create function pg_temp.newguest() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, '{}', '{}', now(), now());
  return u;
end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_nosub() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
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

-- step a Hopper's play_fix back in time: its last tick p_at_s seconds ago, its last full pass p_full_s seconds ago
create function pg_temp.age_fix(p_user uuid, p_at_s integer, p_full_s integer) returns void language plpgsql as $f$
begin
  update public.play_fix set at = now() - make_interval(secs => p_at_s),
    last_full_at = case when p_full_s is null then last_full_at else now() - make_interval(secs => p_full_s) end
  where user_id = p_user;
end $f$;

-- play_tick as the Hopper
create function pg_temp.tick(p_user uuid, p_lat double precision, p_lng double precision, p_acc double precision default 12) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.play_tick(p_lat, p_lng, p_acc);
  perform pg_temp.as_admin();
  return r;
end $f$;

-- claim_game_drop as the Hopper
create function pg_temp.claim(p_user uuid, p_drop uuid, p_lat double precision default null, p_lng double precision default null) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.claim_game_drop(p_drop, p_lat, p_lng);
  perform pg_temp.as_admin();
  return r;
end $f$;

-- ids of the boxes in a play_tick answer
create function pg_temp.box_ids(p_res jsonb) returns uuid[] language sql as $f$
  select coalesce(array_agg((b->>'id')::uuid order by b->>'id'), '{}') from jsonb_array_elements(p_res->'boxes') b;
$f$;

-- ----------------------------------------------------------------- setup ---
do $t$
begin
  delete from public.no_spawn_zones;
  raise notice 'ok: setup';
end $t$;

-- ------------------------------------------------------ structure and grants ---
do $t$
declare t text; u uuid := pg_temp.newuser();
begin
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'game_drops_kind_check' and conrelid = 'public.game_drops'::regclass)
                     ~ 'staff.*spawn.*welcome.*near.*special', 'kind check holds the full list');
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'game_drops_claim_method_check' and conrelid = 'public.game_drops'::regclass)
                     ~ 'proximity.*qr.*either.*avatar', 'claim_method check holds the full list');
  -- a plain staff drop keeps needing presence
  insert into public.game_drops (title, geog, opens_at, closes_at, claim_method, kind)
  values ('T staff', pg_temp.pt(6.34, 3.10), now(), now() + interval '1 hour', 'proximity', 'staff');
  perform pg_temp.eq((select needs_presence::text from public.game_drops where title = 'T staff'), 'true', 'needs_presence defaults to true');
  perform pg_temp.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'play_fix'
                        and column_name = any (array['user_id','lat','lng','accuracy','at','alert_cursor','alerts_today','alert_day','starts_hour_at','starts_hour_n',
                                                     'starts_day','starts_day_n','rooms_day','rooms_day_n','last_full_at']))::text, '15', 'play_fix has its columns');
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.play_fix'::regclass), 'RLS on for play_fix');
  perform pg_temp.eq((select count(*) from pg_policy where polrelid = 'public.play_fix'::regclass)::text, '0', 'play_fix has no policy');
  foreach t in array array['select', 'insert', 'update', 'delete'] loop
    perform pg_temp.ok(not has_table_privilege('authenticated', 'public.play_fix', t), 'authenticated has no ' || t || ' on play_fix');
    perform pg_temp.ok(not has_table_privilege('anon', 'public.play_fix', t), 'anon has no ' || t || ' on play_fix');
  end loop;
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.play_tick(double precision,double precision,double precision)', 'execute'), 'authenticated may call play_tick');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.play_tick(double precision,double precision,double precision)', 'execute'), 'anon may not call play_tick');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.play_tick_for(uuid,double precision,double precision,double precision,boolean,boolean)', 'execute'), 'authenticated may not call play_tick_for');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.purge_play_fix()', 'execute'), 'authenticated may not call purge_play_fix');
  perform pg_temp.ok(has_function_privilege('anon', 'public.claim_game_drop(uuid,double precision,double precision,text)', 'execute')
                     and has_function_privilege('authenticated', 'public.claim_game_drop(uuid,double precision,double precision,text)', 'execute'), 'claim_game_drop grants unchanged');
  -- anon cannot run the heartbeat at all
  perform pg_temp.as_anon();
  begin perform public.play_tick(6.34, 3.10, 10); raise exception 'TEST FAILED: anon ran play_tick';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();
  -- nobody reads play_fix through the API roles, whatever is in it
  insert into public.play_fix (user_id, lat, lng) values (u, 6.34, 3.10);
  perform pg_temp.as_user(u);
  begin perform count(*) from public.play_fix; raise exception 'TEST FAILED: authenticated read play_fix';
  exception when insufficient_privilege then null; end;
  begin insert into public.play_fix (user_id, lat, lng) values (u, 6.34, 3.10); raise exception 'TEST FAILED: authenticated wrote play_fix';
  exception when insufficient_privilege then null; end;
  begin delete from public.play_fix; raise exception 'TEST FAILED: authenticated deleted from play_fix';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_anon();
  begin perform count(*) from public.play_fix; raise exception 'TEST FAILED: anon read play_fix';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();
  delete from public.play_fix where user_id = u;
  raise notice 'ok: structure, grants, play_fix privacy';
end $t$;

-- -------------------------------------------------------------- play-day ---
do $t$
begin
  perform pg_temp.eq(public.lagos_play_day(pg_temp.lagos('2026-10-10 05:59:59'))::text, '2026-10-09', 'before 06:00 is still the day before');
  perform pg_temp.eq(public.lagos_play_day(pg_temp.lagos('2026-10-10 06:00:00'))::text, '2026-10-10', '06:00 starts the day');
  perform pg_temp.eq(public.lagos_play_day(pg_temp.lagos('2026-10-10 23:59:59'))::text, '2026-10-10', 'late evening is the same day');
  perform pg_temp.eq(public.lagos_play_day(pg_temp.lagos('2026-10-11 00:00:00'))::text, '2026-10-10', 'midnight is still the day before');
  perform pg_temp.eq(public.lagos_play_day(pg_temp.lagos('2026-01-01 00:30:00'))::text, '2025-12-31', 'across a year');
  perform pg_temp.eq(public.lagos_play_day('2026-10-10 04:59:59+00')::text, '2026-10-09', 'UTC input: 05:59:59 Lagos');
  perform pg_temp.eq(public.lagos_play_day('2026-10-10 05:00:00+00')::text, '2026-10-10', 'UTC input: 06:00:00 Lagos');
  perform pg_temp.eq(public.lagos_play_day_start(pg_temp.lagos('2026-10-10 12:00:00'))::text, pg_temp.lagos('2026-10-10 06:00:00')::text, 'play-day start in the afternoon');
  perform pg_temp.eq(public.lagos_play_day_start(pg_temp.lagos('2026-10-10 03:00:00'))::text, pg_temp.lagos('2026-10-09 06:00:00')::text, 'play-day start after midnight');
  perform pg_temp.ok(public.lagos_play_day() = public.lagos_play_day(now()), 'default is now');
  raise notice 'ok: play-day';
end $t$;

-- ------------------------------------------ play_tick: session, bounds, rate ---
do $t$
declare
  u uuid := pg_temp.newuser(); res jsonb; fx record;
begin
  -- no session
  perform pg_temp.as_nosub();
  res := public.play_tick(6.34, 3.20, 10);
  perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'no_session', 'no session');
  perform pg_temp.eq(res->>'ok', 'false', 'no session is not ok');
  -- bad or missing position
  res := pg_temp.tick(u, null, 3.20);
  perform pg_temp.eq(res->>'reason', 'location_required', 'no lat');
  res := pg_temp.tick(u, 6.34, null);
  perform pg_temp.eq(res->>'reason', 'location_required', 'no lng');
  res := pg_temp.tick(u, 'NaN'::double precision, 3.20);
  perform pg_temp.eq(res->>'reason', 'location_required', 'NaN lat');
  -- outside Lagos, on every side
  perform pg_temp.eq(pg_temp.tick(u, 7.20, 3.80)->>'reason', 'outside_lagos', 'north of Lagos');
  perform pg_temp.eq(pg_temp.tick(u, 6.34, 4.50)->>'reason', 'outside_lagos', 'east of Lagos');
  perform pg_temp.eq(pg_temp.tick(u, 6.10, 3.80)->>'reason', 'outside_lagos', 'south of Lagos');
  perform pg_temp.eq(pg_temp.tick(u, 6.34, 2.90)->>'reason', 'outside_lagos', 'west of Lagos');
  perform pg_temp.eq(pg_temp.tick(u, 6.2999, 3.20)->>'reason', 'outside_lagos', 'just under the southern edge');
  perform pg_temp.eq(pg_temp.tick(u, 6.34, 3.9501)->>'reason', 'outside_lagos', 'just over the eastern edge');
  perform pg_temp.eq((select count(*) from public.play_fix where user_id = u)::text, '0', 'refused calls write no play_fix');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u)::text, '0', 'refused calls make no boxes');

  -- the first good call
  res := pg_temp.tick(u, 6.34123, 3.20456, 12.5);
  perform pg_temp.eq(res->>'ok', 'true', 'first call ok: ' || res::text);
  perform pg_temp.eq(res->>'full', 'true', 'the first call is a full pass');
  perform pg_temp.ok(res ? 'boxes' and res ? 'small_left_today' and res ? 'welcome_left' and res ? 'play_day' and res ? 'night', 'answer shape: ' || res::text);
  select * into fx from public.play_fix where user_id = u;
  perform pg_temp.eq(fx.lat::text, '6.341', 'lat rounded to 3 decimals');
  perform pg_temp.eq(fx.lng::text, '3.205', 'lng rounded to 3 decimals');
  perform pg_temp.eq(fx.accuracy::text, '12.5', 'accuracy kept');
  perform pg_temp.ok(fx.at = now() and fx.last_full_at = now(), 'time stamps');

  -- one call per 15 s
  res := pg_temp.tick(u, 6.34123, 3.20456, 12.5);
  perform pg_temp.eq(res->>'ok', 'false', 'second call is refused');
  perform pg_temp.eq(res->>'reason', 'too_soon', 'second call too_soon');
  perform pg_temp.ok((res->>'retry_in_s')::integer between 1 and 15, 'retry_in_s: ' || res::text);
  perform pg_temp.age_fix(u, 14, null);
  perform pg_temp.eq(pg_temp.tick(u, 6.34123, 3.20456)->>'reason', 'too_soon', '14 s is still too soon');
  perform pg_temp.age_fix(u, 16, null);
  res := pg_temp.tick(u, 6.34223, 3.20556, null);
  perform pg_temp.eq(res->>'ok', 'true', '16 s later it is fine');
  perform pg_temp.eq(res->>'full', 'false', 'a call 16 s after a full pass is light');
  select * into fx from public.play_fix where user_id = u;
  perform pg_temp.eq(fx.lat::text || ',' || fx.lng::text, '6.342,3.206', 'the row follows the Hopper');
  perform pg_temp.ok(fx.accuracy is null, 'no accuracy given, none kept');
  perform pg_temp.eq((select count(*) from public.play_fix where user_id = u)::text, '1', 'one row per Hopper');
  -- a bad accuracy is dropped, not an error
  perform pg_temp.age_fix(u, 20, null);
  perform pg_temp.eq(pg_temp.tick(u, 6.34223, 3.20556, -5)->>'ok', 'true', 'negative accuracy tolerated');
  perform pg_temp.ok((select accuracy is null from public.play_fix where user_id = u), 'negative accuracy not kept');
  -- a refused call (too soon) does not move the row
  perform pg_temp.tick(u, 6.40, 3.50, 5);
  perform pg_temp.eq((select lat::text from public.play_fix where user_id = u), '6.342', 'a refused call leaves the row alone');
  raise notice 'ok: play_tick session, bounds, rate limit';
end $t$;

-- ------------------------------------------------ top-up: count and distances ---
do $t$
declare
  u uuid := pg_temp.newuser(); res jsonb; o geography := pg_temp.pt(6.3401, 3.2201); bx jsonb; i integer; d double precision;
  v_night boolean := extract(hour from now() at time zone 'Africa/Lagos') >= 21 or extract(hour from now() at time zone 'Africa/Lagos') < 6;
begin
  res := pg_temp.tick(u, 6.3401, 3.2201, 10);
  perform pg_temp.eq(res->>'ok', 'true', 'ok');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'three small boxes on the first call');
  perform pg_temp.eq(res->>'night', v_night::text, 'night flag follows the Lagos clock');
  perform pg_temp.eq(res->>'small_left_today', '10', 'ten small boxes left today');
  perform pg_temp.eq(res->>'welcome_left', '0', 'no welcome boxes');
  perform pg_temp.eq(res->>'play_day', public.lagos_play_day()::text, 'play_day');
  for bx in select * from jsonb_array_elements(res->'boxes') loop
    perform pg_temp.eq(bx->>'kind', 'near', 'box kind');
    perform pg_temp.eq(bx->>'tier', 'common', 'box tier');
    perform pg_temp.eq(bx->>'needs_presence', 'false', 'box needs_presence');
    perform pg_temp.ok(bx->'slot' = 'null'::jsonb, 'a small box has no slot');
    perform pg_temp.ok((bx->>'closes_at')::timestamptz > now(), 'closes in the future');
    d := st_distance(o, pg_temp.pt((bx->>'lat')::double precision, (bx->>'lng')::double precision));
    perform pg_temp.ok(d between (case when v_night then 19.5 else 59.5 end) and (case when v_night then 60.5 else 150.5 end), 'distance ' || d);
  end loop;
  -- the rows
  perform pg_temp.eq((select count(*) from public.game_drops g where g.owner_id = u and g.kind = 'near' and g.active and g.max_claims = 1 and g.reward_model = 'fixed'
                        and g.claim_method = 'proximity' and g.needs_presence = false and g.opens_at <= now() and g.closes_at > now())::text, '3', 'three near rows with the right fields');
  perform pg_temp.eq((select string_agg(r.reward_type || ' ' || r.xp_amount, ',') from public.drop_rewards r join public.game_drops g on g.id = r.drop_id where g.owner_id = u), 'xp 10,xp 10,xp 10', 'each pays 10 XP');
  -- they keep apart
  perform pg_temp.ok((select min(st_distance(a.geog, c.geog)) from public.game_drops a join public.game_drops c on c.owner_id = a.owner_id and c.id > a.id where a.owner_id = u) >= (case when v_night then 14.5 else 39.5 end), 'boxes are apart');
  -- ordinary Hoppers see only their own
  perform pg_temp.as_user(pg_temp.newuser());
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u)::text, '0', 'another Hopper sees none of them');
  perform pg_temp.as_admin();
  perform pg_temp.as_user(u);
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near')::text, '3', 'the owner sees them');
  perform pg_temp.as_admin();

  -- a second call changes nothing (rate limit) and a light call adds nothing
  perform pg_temp.age_fix(u, 20, null);
  res := pg_temp.tick(u, 6.3401, 3.2201, 10);
  perform pg_temp.eq(res->>'full', 'false', 'light pass');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'still three');
  perform pg_temp.age_fix(u, 20, 60);
  res := pg_temp.tick(u, 6.3401, 3.2201, 10);
  perform pg_temp.eq(res->>'full', 'true', 'full again after 60 s');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near')::text, '3', 'a full pass with three live adds none');

  -- distances, day and night, over many Hoppers (forced, so the clock does not matter)
  for i in 1..30 loop
    u := pg_temp.newuser();
    res := public.play_tick_for(u, 6.3401, 3.2201, 10, true, false);
    perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'day: three boxes');
    perform pg_temp.ok((select bool_and(st_distance(o, pg_temp.pt((b->>'lat')::double precision, (b->>'lng')::double precision)) between 59.5 and 150.5)
                          from jsonb_array_elements(res->'boxes') b), 'day boxes 60 to 150 m');
    u := pg_temp.newuser();
    res := public.play_tick_for(u, 6.3401, 3.2201, 10, true, true);
    perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'night: three boxes');
    perform pg_temp.ok((select bool_and(st_distance(o, pg_temp.pt((b->>'lat')::double precision, (b->>'lng')::double precision)) between 19.5 and 60.5)
                          from jsonb_array_elements(res->'boxes') b), 'night boxes 20 to 60 m');
  end loop;
  -- the tier and the kind are fixed
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and (kind <> 'near' or title <> 'Small box'))::text, '0', 'only near boxes');
  raise notice 'ok: top-up count and distances';
end $t$;

-- ------------------------------------- the full pass: every third tick only ---
do $t$
declare
  u uuid := pg_temp.newuser(); res jsonb; ids uuid[]; c jsonb; n integer;
begin
  res := pg_temp.tick(u, 6.3401, 3.2601, 10);
  perform pg_temp.eq(res->>'full', 'true', 'first tick is full');
  ids := pg_temp.box_ids(res);
  -- open one box (remote), then tick lightly: no replacement yet
  c := pg_temp.claim(u, ids[1]);
  perform pg_temp.eq(c->>'ok', 'true', 'claim ok: ' || c::text);
  perform pg_temp.age_fix(u, 20, null);
  res := pg_temp.tick(u, 6.3401, 3.2601, 10);
  perform pg_temp.eq(res->>'full', 'false', 'second tick is light');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '2', 'two left after one is opened');
  perform pg_temp.eq(res->>'small_left_today', '9', 'nine left');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near')::text, '3', 'no replacement on a light pass');
  perform pg_temp.age_fix(u, 20, null);
  res := pg_temp.tick(u, 6.3401, 3.2601, 10);
  perform pg_temp.eq(res->>'full', 'false', 'third tick is light too (20 + 20 s after the full pass is under 50)');
  -- the full pass makes the replacement, but it rises 40 to 90 s after the open
  perform pg_temp.age_fix(u, 20, 60);
  res := pg_temp.tick(u, 6.3401, 3.2601, 10);
  perform pg_temp.eq(res->>'full', 'true', 'full pass');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near')::text, '4', 'a replacement was made');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '2', 'the replacement has not risen yet');
  select count(*) into n from public.game_drops g where g.owner_id = u and g.kind = 'near' and g.opens_at between now() + interval '39 seconds' and now() + interval '91 seconds';
  perform pg_temp.eq(n::text, '1', 'the replacement opens 40 to 90 s after the open');
  -- once it has risen (move time on by hand) it shows on a light pass
  update public.game_drops set opens_at = now() where owner_id = u and kind = 'near' and opens_at > now();
  perform pg_temp.age_fix(u, 20, null);
  res := pg_temp.tick(u, 6.3401, 3.2601, 10);
  perform pg_temp.eq(res->>'full', 'false', 'light pass');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'three again');
  raise notice 'ok: full pass every third tick, replacement delay';
end $t$;

-- ---------------------------------------------------- 10 a play-day ---
do $t$
declare
  u uuid := pg_temp.newuser(); res jsonb; c jsonb; i integer; n integer := 0; b uuid; xp0 integer; v_old uuid; k integer;
begin
  select xp into xp0 from public.profiles where id = u;
  for i in 1..14 loop
    update public.game_drops set opens_at = now() where owner_id = u and kind = 'near' and opens_at > now();
    perform pg_temp.age_fix(u, 20, 60);
    res := pg_temp.tick(u, 6.3401, 3.2801, 10);
    perform pg_temp.eq(res->>'ok', 'true', 'tick ' || i);
    perform pg_temp.ok(jsonb_array_length(res->'boxes') <= 3, 'never more than three');
    foreach b in array pg_temp.box_ids(res) loop
      c := pg_temp.claim(u, b);
      perform pg_temp.eq(c->>'ok', 'true', 'claim: ' || c::text);
      n := n + 1;
    end loop;
  end loop;
  perform pg_temp.eq(n::text, '10', 'exactly ten small boxes opened in a play-day');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near')::text, '10', 'no more than ten were ever made');
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = u)::text, '100', '100 XP from ten small boxes');
  perform pg_temp.age_fix(u, 20, 60);
  res := pg_temp.tick(u, 6.3401, 3.2801, 10);
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '0', 'the eleventh is sealed');
  perform pg_temp.eq(res->>'small_left_today', '0', 'none left today');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near' and claimed_count = 0 and active)::text, '0', 'no live small box');

  -- a new play-day starts fresh: ten claims from before 06:00 today do not count
  u := pg_temp.newuser();
  for k in 1..10 loop
    insert into public.game_drops (title, geog, opens_at, closes_at, claim_method, max_claims, claimed_count, kind, owner_id, needs_presence, active, radius_m)
    values ('T old', pg_temp.pt(6.34, 3.29), now() - interval '4 days', now() - interval '3 days', 'proximity', 1, 1, 'near', u, false, false, 60) returning id into v_old;
    insert into public.drop_claims (drop_id, user_id, claimed_at) values (v_old, u, now() - interval '3 days');
  end loop;
  res := pg_temp.tick(u, 6.3401, 3.2901, 10);
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'old claims do not count toward today');
  perform pg_temp.eq(res->>'small_left_today', '10', 'ten left on a fresh day');
  raise notice 'ok: 10 small boxes per play-day';
end $t$;

-- ------------------------------------------------- zones and moving on ---
do $t$
declare
  u uuid; res jsonb; i integer; o geography := pg_temp.pt(6.3401, 3.3201); z uuid; zc geography;
begin
  -- a zone over part of the ring: no box ever lands in it, and there are still three
  zc := pg_temp.off(o, 110, 0);
  perform public.add_no_spawn_zone('half ring', 'test', pg_temp.lat(zc), pg_temp.lng(zc), 100);
  for i in 1..40 loop
    u := pg_temp.newuser();
    res := public.play_tick_for(u, 6.3401, 3.3201, 10, true, false);
    perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'three boxes beside a zone');
    perform pg_temp.eq((select count(*) from public.game_drops g join public.no_spawn_zones z on st_intersects(z.geog, g.geog) where g.owner_id = u)::text, '0', 'a small box landed in a zone');
  end loop;
  -- a water zone and a military zone are refused alike (any active zone)
  perform pg_temp.eq((select count(*) from public.no_spawn_zones where name = 'half ring' and zone_type is not null)::text, '1', 'zone typed');
  delete from public.no_spawn_zones;

  -- standing inside a big zone: ok, no boxes, nothing left behind
  perform public.add_no_spawn_zone('huge', 'test', 6.3401, 3.3201, 5000);
  u := pg_temp.newuser();
  res := public.play_tick_for(u, 6.3401, 3.3201, 10, true, false);
  perform pg_temp.eq(res->>'ok', 'true', 'inside a zone is not an error');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '0', 'no boxes inside a big zone');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u)::text, '0', 'no rows inside a big zone');
  -- a zone switched off does not count
  update public.no_spawn_zones set active = false;
  perform pg_temp.age_fix(u, 20, 60);
  res := public.play_tick_for(u, 6.3401, 3.3201, 10, true, false);
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'a switched-off zone is ignored');
  delete from public.no_spawn_zones;

  -- walking about cannot churn rows: 30 are made a play-day at most (10 of them can ever be opened)
  u := pg_temp.newuser();
  for i in 1..14 loop
    perform pg_temp.age_fix(u, 20, 60);
    res := public.play_tick_for(u, 6.3401 + (i % 2) * 0.02, 3.3601, 10, true, false);   -- 2.2 km apart each time
  end loop;
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near')::text, '30', 'at most 30 small-box rows a play-day');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '0', 'and none after that');

  -- walking away retires the far boxes and puts new ones around the new place
  u := pg_temp.newuser();
  res := public.play_tick_for(u, 6.3401, 3.3401, 10, true, false);
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'three at the start');
  perform pg_temp.age_fix(u, 20, 60);
  res := public.play_tick_for(u, 6.3601, 3.3401, 10, true, false);   -- 2.2 km north
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'three at the new place');
  perform pg_temp.ok((select bool_and(st_distance(pg_temp.pt(6.3601, 3.3401), pg_temp.pt((b->>'lat')::double precision, (b->>'lng')::double precision)) < 151) from jsonb_array_elements(res->'boxes') b), 'all around the new place');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u and kind = 'near' and active)::text, '3', 'the old ones were retired');
  raise notice 'ok: zones and moving on';
end $t$;

-- --------------------------------------------------------------- purge ---
do $t$
declare
  u_old uuid := pg_temp.newuser(); u_new uuid := pg_temp.newuser(); u_edge uuid := pg_temp.newuser(); n integer; job text;
begin
  insert into public.play_fix (user_id, lat, lng, at) values (u_old, 6.34, 3.40, now() - interval '25 hours');
  insert into public.play_fix (user_id, lat, lng, at) values (u_new, 6.34, 3.40, now() - interval '2 hours');
  insert into public.play_fix (user_id, lat, lng, at) values (u_edge, 6.34, 3.40, now() - interval '23 hours 59 minutes');
  n := public.purge_play_fix();
  perform pg_temp.ok(n >= 1, 'purge reports what it deleted');
  perform pg_temp.eq((select count(*) from public.play_fix where user_id = u_old)::text, '0', 'a row older than 24 hours is gone');
  perform pg_temp.eq((select count(*) from public.play_fix where user_id = u_new)::text, '1', 'a recent row stays');
  perform pg_temp.eq((select count(*) from public.play_fix where user_id = u_edge)::text, '1', 'a row just under 24 hours stays');
  perform pg_temp.eq(public.purge_play_fix()::text, '0', 'a second purge finds nothing');
  -- nobody else may run it
  perform pg_temp.as_user(u_new);
  begin perform public.purge_play_fix(); raise exception 'TEST FAILED: authenticated ran purge_play_fix';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();
  -- the nightly job is scheduled (needs pg_cron; skipped quietly where it is not installed)
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select command into job from cron.job where jobname = 'hoppaz-purge-play-fix';
    perform pg_temp.ok(job like '%purge_play_fix%', 'the nightly purge job is scheduled');
    perform pg_temp.eq((select schedule from cron.job where jobname = 'hoppaz-purge-play-fix'), '30 2 * * *', 'at 03:30 Lagos');
  else
    raise notice 'skipped: pg_cron is not installed here';
  end if;
  raise notice 'ok: play_fix purge';
end $t$;

-- ----------------------------------------------------------- remote claim ---
do $t$
declare
  u uuid := pg_temp.newuser(); w uuid := pg_temp.newuser(); gst uuid := pg_temp.newguest(); res jsonb; c jsonb; ids uuid[]; xp0 integer; lat0 double precision; lng0 double precision;
  v_staff uuid; v_spawn uuid; v_late uuid; v_old uuid; v_near uuid; cl record;
begin
  res := pg_temp.tick(u, 6.3401, 3.3601, 10);
  ids := pg_temp.box_ids(res);
  select xp into xp0 from public.profiles where id = u;
  -- somebody else cannot open my box
  c := pg_temp.claim(w, ids[1]);
  perform pg_temp.eq(c->>'reason', 'not_yours', 'another Hopper cannot open it');
  -- no coordinates at all
  c := pg_temp.claim(u, ids[1]);
  perform pg_temp.ok(c->>'ok' = 'true' and c->>'reward' = 'Small find' and (c->>'xp')::integer = 10, 'remote claim: ' || c::text);
  select * into cl from public.drop_claims where drop_id = ids[1] and user_id = u;
  perform pg_temp.ok(cl.lat is null and cl.lng is null, 'no coordinates stored on a remote claim');
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = u)::text, '10', 'paid 10 XP');
  perform pg_temp.eq((select claimed_count::text from public.game_drops where id = ids[1]), '1', 'claimed_count');
  perform pg_temp.eq((select a.outside_score::text from public.activity_log a join public.drop_claims dc on dc.id = a.source_id where dc.drop_id = ids[1]), '0', 'a small box scores 0 on the Outside board');
  c := pg_temp.claim(u, ids[1]);
  perform pg_temp.ok(c->>'reason' in ('sold_out', 'already'), 'a second open is refused: ' || c::text);
  -- coordinates sent along (a far-away fix) are ignored, not stored, and do not block the claim
  c := pg_temp.claim(u, ids[2], 6.50, 3.60);
  perform pg_temp.eq(c->>'ok', 'true', 'a remote claim needs no distance');
  perform pg_temp.ok((select lat is null and lng is null from public.drop_claims where drop_id = ids[2] and user_id = u), 'sent coordinates are not stored');
  -- not open yet, and closed
  update public.game_drops set opens_at = now() + interval '1 minute', closes_at = now() + interval '2 hours' where id = ids[3];
  perform pg_temp.eq(pg_temp.claim(u, ids[3])->>'reason', 'closed', 'not open yet');
  update public.game_drops set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 minute' where id = ids[3];
  perform pg_temp.eq(pg_temp.claim(u, ids[3])->>'reason', 'closed', 'closed');

  -- the remote path is only for near and welcome boxes you own: other drops still need presence
  insert into public.game_drops (title, geog, opens_at, closes_at, claim_method, kind, needs_presence, radius_m)
  values ('T staff remote', pg_temp.pt(6.34, 3.37), now() - interval '1 minute', now() + interval '1 hour', 'proximity', 'staff', false, 60) returning id into v_staff;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount) values (v_staff, 'xp', 'T', 10);
  perform pg_temp.eq(pg_temp.claim(u, v_staff)->>'reason', 'location_required', 'a staff drop flagged remote still needs a position');
  perform pg_temp.eq(pg_temp.claim(u, v_staff, 6.50, 3.60)->>'reason', 'too_far', 'and still checks the radius');
  insert into public.game_drops (title, geog, opens_at, closes_at, claim_method, max_claims, kind, owner_id, needs_presence, radius_m)
  values ('T spawn remote', pg_temp.pt(6.34, 3.38), now() - interval '1 minute', now() + interval '1 hour', 'proximity', 5, 'spawn', u, false, 60) returning id into v_spawn;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount) values (v_spawn, 'xp', 'T', 10);
  perform pg_temp.eq(pg_temp.claim(u, v_spawn)->>'reason', 'location_required', 'a street box flagged remote still needs a position');
  -- a normal located claim still works and stores its position
  c := pg_temp.claim(u, v_staff, 6.34, 3.37);
  perform pg_temp.eq(c->>'ok', 'true', 'a located claim on a presence box');
  perform pg_temp.ok((select lat = 6.34 and lng = 3.37 from public.drop_claims where drop_id = v_staff and user_id = u), 'located claims keep their position');

  -- a guest cannot open a small box (no account); welcome boxes are covered below
  insert into public.game_drops (title, geog, opens_at, closes_at, claim_method, max_claims, kind, owner_id, needs_presence, radius_m)
  values ('T near guest', pg_temp.pt(6.34, 3.39), now() - interval '1 minute', now() + interval '1 hour', 'proximity', 1, 'near', gst, false, 60) returning id into v_near;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount) values (v_near, 'xp', 'T', 10);
  perform pg_temp.eq(pg_temp.claim(gst, v_near)->>'reason', 'need_account', 'a guest needs an account for a small box');
  perform pg_temp.eq((select count(*) from public.drop_claims where user_id = gst)::text, '0', 'and nothing was claimed');
  raise notice 'ok: remote claim';
end $t$;

-- ------------------------------------------- welcome layout and exemption ---
do $t$
declare
  i integer; u uuid; res jsonb; ids uuid[]; o geography := pg_temp.pt(6.3401, 3.4201); r record; a jsonb;
begin
  for i in 1..25 loop
    u := pg_temp.newuser();
    res := public.spawn_welcome_boxes_for(u, 6.3401, 3.4201, false);
    perform pg_temp.ok(res->>'ok' = 'true' and res->>'already' = 'false' and res->>'night' = 'false', 'day result shape: ' || res::text);
    ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
    perform pg_temp.eq(cardinality(ids)::text, '3', 'three day boxes');
    -- ids come back in the order A, B, C
    perform pg_temp.ok(abs(st_distance(o, (select geog from public.game_drops where id = ids[1])) - 25) < 0.5, 'A is 25 m away');
    perform pg_temp.ok(st_distance(o, (select geog from public.game_drops where id = ids[2])) between 89.5 and 130.5, 'B is 90 to 130 m away');
    perform pg_temp.ok(st_distance(o, (select geog from public.game_drops where id = ids[3])) between 179.5 and 250.5, 'C is 180 to 250 m away');
    perform pg_temp.eq((select string_agg(needs_presence::text, ',' order by created_at) from public.game_drops where id = any (ids)), 'false,false,true', 'A and B send the avatar, C needs presence');
  end loop;
  select * into r from public.game_drops where id = ids[1];
  perform pg_temp.ok(r.kind = 'welcome' and r.owner_id = u and r.radius_m = 60 and r.max_claims = 1 and r.claim_method = 'proximity' and r.reward_model = 'fixed'
                     and r.closes_at - r.opens_at = interval '24 hours' and r.title = 'Welcome box' and r.active, 'welcome row fields');
  perform pg_temp.eq((select string_agg(rw.title || ' ' || rw.xp_amount, ', ' order by g.created_at) from public.drop_rewards rw join public.game_drops g on g.id = rw.drop_id where g.id = any (ids)),
                     'Welcome find 50, Welcome find 50, Worth the walk 150', 'day rewards');
  -- a repeat call changes nothing
  res := public.spawn_welcome_boxes_for(u, 6.3401, 3.4201, false);
  perform pg_temp.ok(res->>'already' = 'true' and not res ? 'ids', 'already');
  -- night: all three 15 to 45 m, 50 XP each, C still needs presence
  for i in 1..25 loop
    u := pg_temp.newuser();
    res := public.spawn_welcome_boxes_for(u, 6.3401, 3.4201, true);
    ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
    perform pg_temp.ok((select bool_and(st_distance(o, g.geog) between 14.5 and 45.5 and g.radius_m = 80) from public.game_drops g where g.id = any (ids)), 'night boxes 15 to 45 m, radius 80');
    perform pg_temp.eq((select string_agg(needs_presence::text, ',' order by created_at) from public.game_drops where id = any (ids)), 'false,false,true', 'night: C needs presence');
    perform pg_temp.eq((select string_agg(rw.xp_amount::text, ',' order by g.created_at) from public.drop_rewards rw join public.game_drops g on g.id = rw.drop_id where g.id = any (ids)), '50,50,50', 'night rewards');
  end loop;
  -- standing inside a big zone: no boxes, nothing left behind, and a clear place still works
  perform public.add_no_spawn_zone('big zone', 'test', 6.3401, 3.4401, 500);
  u := pg_temp.newuser();
  res := public.spawn_welcome_boxes_for(u, 6.3401, 3.4401, false);
  perform pg_temp.eq(res->>'reason', 'no_clear_spot', 'no clear spot');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = u)::text, '0', 'and nothing left behind');
  res := public.spawn_welcome_boxes_for(u, 6.3401, 3.4601, false);
  perform pg_temp.eq(res->>'already', 'false', 'a clear place still gets boxes');
  perform pg_temp.eq((select count(*) from public.no_spawn_zones z join public.game_drops g on st_intersects(z.geog, g.geog) where g.owner_id = u)::text, '0', 'no box in a zone');
  delete from public.no_spawn_zones;
  raise notice 'ok: welcome layout';
end $t$;

-- A guest: three welcome boxes, no account, then the account wall.
do $t$
declare
  g uuid := pg_temp.newguest(); res jsonb; c jsonb; w jsonb; ids uuid[]; o geography := pg_temp.pt(6.3401, 3.4801); box_c record; xp0 integer; msg text;
begin
  -- a guest with no welcome boxes yet may call it
  res := pg_temp.tick(g, 6.3401, 3.4801, 10);
  perform pg_temp.eq(res->>'ok', 'true', 'a guest may play');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '0', 'no boxes yet');
  perform pg_temp.eq(res->>'small_left_today', '0', 'guests have no small boxes');

  w := public.spawn_welcome_boxes_for(g, 6.3401, 3.4801, false);
  ids := array(select jsonb_array_elements_text(w->'ids')::uuid);
  perform pg_temp.age_fix(g, 20, null);
  res := pg_temp.tick(g, 6.3401, 3.4801, 10);
  perform pg_temp.eq(res->>'ok', 'true', 'guest tick ok');
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'the three welcome boxes');
  perform pg_temp.eq((select string_agg(b->>'slot', ',' order by ord) from jsonb_array_elements(res->'boxes') with ordinality as t(b, ord)), 'a,b,c', 'slots a, b, c');
  perform pg_temp.eq((select string_agg(b->>'tier', ',' order by ord) from jsonb_array_elements(res->'boxes') with ordinality as t(b, ord)), 'rare,rare,legendary', 'tiers');
  perform pg_temp.eq((select string_agg(b->>'needs_presence', ',' order by ord) from jsonb_array_elements(res->'boxes') with ordinality as t(b, ord)), 'false,false,true', 'needs_presence');
  perform pg_temp.ok((select bool_and(b->>'kind' = 'welcome') from jsonb_array_elements(res->'boxes') b), 'all welcome');
  perform pg_temp.eq(res->>'welcome_left', '3', 'welcome_left');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = g and kind = 'near')::text, '0', 'no small boxes for a guest');
  select xp into xp0 from public.profiles where id = g;

  -- A: remote, no coordinates, no account (the welcome exemption)
  begin
    c := pg_temp.claim(g, ids[1]);
  exception when others then
    perform pg_temp.as_admin();
    get stacked diagnostics msg = message_text;
    if msg = 'need_account' then raise exception 'TEST FAILED: the account gate refuses a guest''s own welcome box: apply the welcome exemption in require_account_row() (chat_accounts.sql)'; end if;
    raise;
  end;
  perform pg_temp.eq(c->>'ok', 'true', 'guest opens welcome A: ' || c::text);
  perform pg_temp.ok((select lat is null and lng is null from public.drop_claims where drop_id = ids[1] and user_id = g), 'no coordinates stored for A');
  perform pg_temp.eq((c->>'xp'), '50', 'A pays 50');
  -- B the same, and the ceiling-less XP lands on the profile
  c := pg_temp.claim(g, ids[2], 6.50, 3.60);
  perform pg_temp.eq(c->>'ok', 'true', 'guest opens welcome B');
  perform pg_temp.ok((select lat is null and lng is null from public.drop_claims where drop_id = ids[2] and user_id = g), 'no coordinates stored for B');
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = g)::text, '100', '100 XP from A and B');
  -- the heartbeat still works for the guest with one welcome box left
  perform pg_temp.age_fix(g, 20, null);
  res := pg_temp.tick(g, 6.3401, 3.4801, 10);
  perform pg_temp.eq(res->>'ok', 'true', 'still ok with one welcome box left');
  perform pg_temp.eq(res->>'welcome_left', '1', 'one left');
  perform pg_temp.eq(res->'boxes'->0->>'slot', 'c', 'it is C');
  -- C needs presence: no remote path
  perform pg_temp.eq(pg_temp.claim(g, ids[3])->>'reason', 'location_required', 'C needs a position');
  select * into box_c from public.game_drops where id = ids[3];
  perform pg_temp.eq(pg_temp.claim(g, ids[3], 6.40, 3.60)->>'reason', 'too_far', 'C checks the radius');
  c := pg_temp.claim(g, ids[3], pg_temp.lat(box_c.geog), pg_temp.lng(box_c.geog));
  perform pg_temp.eq(c->>'ok', 'true', 'C opens at its position: ' || c::text);
  perform pg_temp.eq(c->>'xp', '150', 'C pays 150');
  perform pg_temp.ok((select lat is not null from public.drop_claims where drop_id = ids[3] and user_id = g), 'a located welcome claim keeps its position');

  -- three welcome boxes opened: the guest now needs an account
  perform pg_temp.age_fix(g, 20, 60);
  res := pg_temp.tick(g, 6.3401, 3.4801, 10);
  perform pg_temp.eq(res->>'ok', 'false', 'guest blocked after three welcome boxes');
  perform pg_temp.eq(res->>'reason', 'need_account', 'need_account');
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = g and kind = 'near')::text, '0', 'still no small boxes');
  -- signing up (an email on the same user) lifts the wall and the small boxes start
  update auth.users set email = 'playtest-' || g || '@playtest.invalid' where id = g;
  res := pg_temp.tick(g, 6.3401, 3.4801, 10);
  perform pg_temp.eq(res->>'ok', 'true', 'after sign-up the heartbeat works: ' || res::text);
  perform pg_temp.eq(jsonb_array_length(res->'boxes')::text, '3', 'three small boxes');
  perform pg_temp.eq(res->>'small_left_today', '10', 'ten small boxes today');
  perform pg_temp.eq(res->>'welcome_left', '0', 'no welcome boxes left');
  raise notice 'ok: guest, welcome exemption, account wall';
end $t$;

do $t$ begin raise notice 'ALL PLAY TESTS PASSED'; end $t$;

rollback;
