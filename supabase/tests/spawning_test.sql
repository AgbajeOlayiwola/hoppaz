-- ============================================================================
-- Hoppaz: street box spawning tests
-- Run against a LOCAL database that already has schema.sql, hunt_items.sql and
-- spawning.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/spawning_test.sql
--
-- One transaction that always rolls back, so nothing is kept. It clears the
-- spawn tables first (inside the transaction only) so seed and imported data
-- cannot change the result. Every check raises an exception on failure; the
-- last line printed is ALL SPAWNING TESTS PASSED.
-- Test sites are open sea south of Lagos, so no real data sits near them.
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

create function pg_temp.dist(p_a geography, p_b geography) returns double precision language sql as $f$
  select st_distance(p_a, p_b);
$f$;

create function pg_temp.lat(p_g geography) returns double precision language sql as $f$ select st_y(p_g::geometry); $f$;
create function pg_temp.lng(p_g geography) returns double precision language sql as $f$ select st_x(p_g::geometry); $f$;

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'spawntest-' || u || '@spawntest.invalid', '{}', '{}', now(), now());
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

create function pg_temp.as_service() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.mkspot(p_name text, p_kind text, p_geog geography, p_area text, p_night boolean default false, p_weight numeric default 1, p_active boolean default true)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.spawn_points (name, kind, geog, area, night_safe, weight, active)
  values (p_name, p_kind, p_geog, p_area, p_night, p_weight, p_active) returning id into v;
  return v;
end $f$;

-- n spots on a ring around a centre
create function pg_temp.mkring(p_area text, p_center geography, p_kind text, p_n integer, p_night boolean, p_weight numeric, p_radius double precision default 800, p_phase double precision default 0)
returns void language plpgsql as $f$
declare i integer;
begin
  for i in 0..p_n - 1 loop
    perform pg_temp.mkspot(p_area || ' ' || p_kind || ' ' || i, p_kind, pg_temp.off(p_center, p_radius, p_phase + i * 360.0 / p_n), p_area, p_night, p_weight);
  end loop;
end $f$;

-- a plain drop with one 10 XP reward
create function pg_temp.mkdrop(p_geog geography, p_kind text default 'staff', p_max integer default null, p_radius integer default 80,
  p_opens timestamptz default now() - interval '1 minute', p_closes timestamptz default now() + interval '1 hour', p_owner uuid default null)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id)
  values ('T drop', p_geog, p_opens, p_closes, p_radius, 'proximity', p_max, 'fixed', p_kind, p_owner) returning id into v;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount) values (v, 'xp', 'T reward', 10);
  return v;
end $f$;

-- ----------------------------------------------------------------- setup ---
do $t$
declare n text;
begin
  update public.spawn_rules set active = false;
  delete from public.spawn_points;
  delete from public.no_spawn_zones;
  delete from public.game_drops where kind in ('spawn', 'welcome');
  foreach n in array array['ZZ T-A','ZZ T-B','ZZ T-C','ZZ T-D','ZZ T-E','ZZ T-F','ZZ T-G','ZZ T-I','ZZ T-other'] loop
    insert into public.areas (name, side, centroid) values (n, 'island', pg_temp.pt(6.31, 3.30));
  end loop;
  insert into public.areas (name, side, centroid) values ('ZZ T-area', 'island', pg_temp.pt(6.30, 3.95));
  perform pg_temp.ok(extract(isodow from date '2026-10-14') = 3, '2026-10-14 should be a Wednesday');
  raise notice 'ok: setup';
end $t$;

-- ------------------------------------------------ area fill and lookup ---
do $t$
declare v_t geography := pg_temp.pt(6.30, 3.95); v_id uuid;
begin
  v_id := pg_temp.mkspot('auto near', 'park', pg_temp.off(v_t, 2000, 0), null);
  perform pg_temp.eq((select area from public.spawn_points where id = v_id), 'ZZ T-area', 'empty area filled from nearest area');
  v_id := pg_temp.mkspot('auto far', 'park', pg_temp.off(v_t, 8000, 0), null);
  perform pg_temp.eq(coalesce((select area from public.spawn_points where id = v_id), '<null>'), '<null>', 'no area further than 5 km');
  v_id := pg_temp.mkspot('explicit', 'park', pg_temp.off(v_t, 2000, 90), 'ZZ T-A');
  perform pg_temp.eq((select area from public.spawn_points where id = v_id), 'ZZ T-A', 'explicit area kept');
  perform pg_temp.eq(public.lagos_area_for(pg_temp.off(v_t, 100, 0)), 'ZZ T-area', 'lagos_area_for');
  delete from public.spawn_points;
  raise notice 'ok: area fill';
end $t$;

-- --------------------------------------------------- a) forced wave ---
do $t$
declare
  a geography := pg_temp.pt(6.31, 3.30); v_rule uuid; v_n integer; w1 uuid[]; w2 uuid[]; i integer;
  v_now timestamptz := now();   -- real time, so the boxes can be opened below
begin
  perform pg_temp.mkring('ZZ T-A', a, 'street', 10, false, 1);
  -- four heavy spots within 180 m of each other: only one may be picked per wave
  for i in 0..3 loop
    perform pg_temp.mkspot('cluster ' || i, 'street', pg_temp.off(pg_temp.off(a, 3000, 90), i * 60, 90), 'ZZ T-A', false, 50);
  end loop;
  -- a heavy spot inside a zone, and decoys that must never be used
  perform pg_temp.mkspot('zone spot', 'street', a, 'ZZ T-A', false, 1000);
  perform public.add_no_spawn_zone('T zone', 'test', 6.31, 3.30, 150);
  perform pg_temp.mkspot('decoy park', 'park', pg_temp.off(a, 1500, 45), 'ZZ T-A', false, 1000);
  perform pg_temp.mkspot('decoy other area', 'street', pg_temp.off(a, 1500, 200), 'ZZ T-other', false, 1000);
  perform pg_temp.mkspot('decoy inactive', 'street', pg_temp.off(a, 1500, 300), 'ZZ T-A', false, 1000, false);
  insert into public.spawn_rules (name, kinds, areas, boxes_per_wave, max_claims, radius_m, lifetime_minutes, night_from_minute, night_until_minute)
  values ('T rule A', '{street}', '{ZZ T-A}', 4, 5, 80, 30, 0, 0) returning id into v_rule;   -- no night limit: this wave runs at the real clock

  v_n := public.spawn_boxes(v_now, v_rule, true);
  perform pg_temp.eq(v_n::text, '4', 'forced wave returns boxes_per_wave');
  perform pg_temp.eq((select count(*) from public.game_drops where spawn_rule_id = v_rule)::text, '4', 'four spawn drops exist');
  perform pg_temp.ok((select bool_and(g.kind = 'spawn' and g.claim_method = 'proximity' and g.max_claims = 5 and g.radius_m = 80 and g.active
                        and g.opens_at = v_now and g.closes_at = v_now + interval '30 minutes' and g.description = 'First 5 to get here open it.'
                        and g.reward_model = 'random' and g.area = 'ZZ T-A' and g.owner_id is null and g.title = sp.name and g.claimed_count = 0)
                      from public.game_drops g join public.spawn_points sp on sp.id = g.spawn_point_id where g.spawn_rule_id = v_rule), 'drop fields');
  perform pg_temp.eq((select count(*) from public.game_drops g where g.spawn_rule_id = v_rule
                        and (select string_agg(r.xp_amount::text, ',' order by r.xp_amount) from public.drop_rewards r where r.drop_id = g.id and r.reward_type = 'xp') = '30,100,300')::text,
                     '4', 'every drop has the three default rewards');
  perform pg_temp.ok(not exists (select 1 from public.game_drops g join public.no_spawn_zones z on st_intersects(z.geog, g.geog) where g.spawn_rule_id = v_rule), 'no box inside a zone');
  perform pg_temp.ok(not exists (select 1 from public.game_drops g join public.spawn_points sp on sp.id = g.spawn_point_id
                                 where g.spawn_rule_id = v_rule and (sp.name like 'decoy%' or sp.name = 'zone spot')), 'zone, kind, area and inactive filters');
  perform pg_temp.ok(not exists (select 1 from public.game_drops x join public.game_drops y on x.id < y.id and y.spawn_rule_id = v_rule
                                 where x.spawn_rule_id = v_rule and st_dwithin(x.geog, y.geog, 300)), 'boxes in a wave are 300 m apart');
  perform pg_temp.eq((select count(*) from public.game_drops g where g.spawn_rule_id = v_rule and st_dwithin(g.geog, pg_temp.off(a, 3000, 90), 400))::text, '1', 'one box out of the cluster');
  perform pg_temp.eq((select count(*) from public.spawn_points where last_spawned_at = v_now)::text, '4', 'spots stamped with last_spawned_at');
  perform pg_temp.eq((select last_run_at::text from public.spawn_rules where id = v_rule), v_now::text, 'rule last_run_at');

  -- a second forced wave never reuses a spot or stacks on a live box
  select array_agg(id) into w1 from public.game_drops where spawn_rule_id = v_rule;
  perform pg_temp.eq(public.spawn_boxes(v_now, v_rule, true)::text, '4', 'second forced wave');
  select array_agg(id) into w2 from public.game_drops where spawn_rule_id = v_rule and id <> all (w1);
  perform pg_temp.eq(cardinality(w2)::text, '4', 'second wave size');
  perform pg_temp.eq((select count(distinct spawn_point_id) from public.game_drops where spawn_rule_id = v_rule)::text, '8', 'no spot used twice');
  perform pg_temp.ok(not exists (select 1 from public.game_drops x join public.game_drops y on x.id = any (w1) and y.id = any (w2) and st_dwithin(x.geog, y.geog, 50)), 'second wave keeps 50 m from live boxes');
  raise notice 'ok: a) forced wave';
end $t$;

-- a spawned box is a normal box: a Hopper in range opens it
do $t$
declare v_rule uuid; v_drop uuid; v_g geography; v_u uuid := pg_temp.newuser(); res jsonb;
begin
  select id into v_rule from public.spawn_rules where name = 'T rule A';
  select id, geog into v_drop, v_g from public.game_drops where spawn_rule_id = v_rule order by id limit 1;
  perform pg_temp.as_user(v_u);
  res := public.claim_game_drop(v_drop, pg_temp.lat(v_g), pg_temp.lng(v_g));
  perform pg_temp.as_admin();
  perform pg_temp.ok(res->>'ok' = 'true' and (res->>'xp')::integer in (30, 100, 300), 'a spawned box can be opened: ' || res::text);
  perform pg_temp.eq((select xp::text from public.profiles where id = v_u), res->>'xp', 'xp awarded');
  raise notice 'ok: a) spawned box opens';
end $t$;

-- ---------------------------------------------------- b) windows and timing ---
do $t$
declare
  b geography := pg_temp.pt(6.31, 3.39); v_rule uuid;
begin
  perform pg_temp.mkring('ZZ T-B', b, 'park', 8, false, 1);
  insert into public.spawn_rules (name, kinds, areas, start_minute, end_minute, every_minutes, boxes_per_wave)
  values ('T rule B', '{park}', '{ZZ T-B}', 480, 720, 30, 2) returning id into v_rule;   -- 08:00 to 12:00, switched off
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 15:00'), v_rule)::text, '0', '08:00-12:00 rule does not fire at 15:00');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 07:59'), v_rule)::text, '0', 'not before the window');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 12:00'), v_rule)::text, '0', 'window end is exclusive');
  perform pg_temp.ok((select last_run_at is null from public.spawn_rules where id = v_rule), 'a skipped run leaves last_run_at alone');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 08:00'), v_rule)::text, '2', 'fires at window start, even though the rule is switched off');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 08:00'), v_rule)::text, '0', 'second call right after returns 0');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 08:10'), v_rule)::text, '0', 'not due at +10 min');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 08:29'), v_rule)::text, '0', 'not due at +29 min');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 08:30'), v_rule)::text, '2', 'due at +30 min');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 15:00'), v_rule, true)::text, '2', 'p_force skips the window');
  perform pg_temp.eq((select count(*) from public.game_drops where spawn_rule_id = v_rule and opens_at = pg_temp.lagos('2026-10-14 08:30'))::text, '2', 'drops carry p_now');
  raise notice 'ok: b) window and due check';
end $t$;

-- weekday filter and a window that wraps past midnight
do $t$
declare
  c geography := pg_temp.pt(6.31, 3.48); v_rule uuid; v_ids uuid[];
begin
  perform pg_temp.mkring('ZZ T-C', c, 'venue', 6, true, 1, 800, 0);
  perform pg_temp.mkring('ZZ T-C', c, 'venue', 6, false, 100, 1600, 15);
  -- 20:00 to 02:00, Wednesdays only (2026-10-14 is a Wednesday)
  insert into public.spawn_rules (name, kinds, areas, days, start_minute, end_minute, every_minutes, boxes_per_wave)
  values ('T rule C', '{venue}', '{ZZ T-C}', '{3}', 1200, 120, 30, 2) returning id into v_rule;
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 15:00'), v_rule)::text, '0', 'wrapped window: closed at 15:00');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 01:00'), v_rule)::text, '0', 'Wednesday 01:00 belongs to Tuesday night');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-15 21:00'), v_rule)::text, '0', 'Thursday evening is not a Wednesday');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-16 01:00'), v_rule)::text, '0', 'Friday 01:00 belongs to Thursday night');
  perform pg_temp.ok((select last_run_at is null from public.spawn_rules where id = v_rule), 'weekday skips leave last_run_at alone');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 20:30'), v_rule)::text, '2', 'Wednesday 20:30 fires');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-15 01:00'), v_rule)::text, '2', '20:00-02:00 rule fires at 01:00 (Wednesday night)');
  -- 01:00 is night, so the heavy day-only spots must not be used
  select array_agg(id) into v_ids from public.game_drops where spawn_rule_id = v_rule and opens_at = pg_temp.lagos('2026-10-15 01:00');
  perform pg_temp.ok((select bool_and(sp.night_safe) from public.game_drops g join public.spawn_points sp on sp.id = g.spawn_point_id where g.id = any (v_ids)), 'night run uses night_safe spots only');
  raise notice 'ok: b) weekday and wrap';
end $t$;

-- ------------------------------------------------------- c) night spots ---
do $t$
declare
  d geography := pg_temp.pt(6.31, 3.57); v_rule uuid; v_ids uuid[];
begin
  perform pg_temp.mkring('ZZ T-D', d, 'venue', 6, true, 1, 800, 0);
  perform pg_temp.mkring('ZZ T-D', d, 'street', 6, false, 1000, 1600, 15);
  insert into public.spawn_rules (name, kinds, areas, start_minute, end_minute, every_minutes, boxes_per_wave)
  values ('T rule D', '{venue,street}', '{ZZ T-D}', 1140, 120, 30, 4) returning id into v_rule;   -- 19:00 to 02:00, night from 21:00
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 20:30'), v_rule)::text, '4', 'evening wave');
  perform pg_temp.ok(exists (select 1 from public.game_drops g join public.spawn_points sp on sp.id = g.spawn_point_id where g.spawn_rule_id = v_rule and not sp.night_safe), 'before 21:00 any spot may be used');
  perform pg_temp.eq(public.spawn_boxes(pg_temp.lagos('2026-10-14 22:00'), v_rule)::text, '4', 'night wave');
  select array_agg(id) into v_ids from public.game_drops where spawn_rule_id = v_rule and opens_at = pg_temp.lagos('2026-10-14 22:00');
  perform pg_temp.eq(cardinality(v_ids)::text, '4', 'night wave drops');
  perform pg_temp.ok((select bool_and(sp.night_safe) from public.game_drops g join public.spawn_points sp on sp.id = g.spawn_point_id where g.id = any (v_ids)), 'at 22:00 only night_safe spots are used');
  raise notice 'ok: c) night spots';
end $t$;

-- a live box (street or welcome) within 50 m keeps another spot from spawning
do $t$
declare
  v_i geography := pg_temp.pt(6.31, 4.40); v_s1 uuid; v_s2 uuid; v_rule uuid; v_block uuid; v_pick uuid;
begin
  v_s1 := pg_temp.mkspot('block s1', 'street', v_i, 'ZZ T-I', false, 1000);
  v_s2 := pg_temp.mkspot('block s2', 'street', pg_temp.off(v_i, 2000, 0), 'ZZ T-I', false, 1);
  insert into public.spawn_rules (name, kinds, areas, boxes_per_wave, night_from_minute, night_until_minute)
  values ('T rule I', '{street}', '{ZZ T-I}', 1, 0, 0) returning id into v_rule;
  v_block := pg_temp.mkdrop(pg_temp.off(v_i, 30, 90), 'welcome', 1, 60, now() - interval '1 minute', now() + interval '1 hour', pg_temp.newuser());
  perform pg_temp.eq(public.spawn_boxes(now(), v_rule, true)::text, '1', 'wave with one spot blocked');
  select spawn_point_id into v_pick from public.game_drops where spawn_rule_id = v_rule;
  perform pg_temp.eq(v_pick::text, v_s2::text, 'the spot next to a live welcome box is skipped');
  -- once the blocker is over and the spot cooled down, the heavy spot is back
  update public.game_drops set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 hour' where id = v_block;
  perform pg_temp.eq(public.spawn_boxes(now() + interval '31 minutes', v_rule, true)::text, '1', 'later wave');
  perform pg_temp.eq((select spawn_point_id::text from public.game_drops where spawn_rule_id = v_rule and opens_at > now() + interval '1 minute'), v_s1::text, 'spot is free again when the box has closed');
  raise notice 'ok: c) live boxes block nearby spots';
end $t$;

-- ----------------------------------- running every active rule, rewards ---
do $t$
declare
  v_e uuid; v_f uuid; v_g uuid; v_h uuid; v_col uuid; v_n integer;
begin
  perform pg_temp.mkring('ZZ T-E', pg_temp.pt(6.31, 3.66), 'run', 6, false, 1);
  perform pg_temp.mkring('ZZ T-F', pg_temp.pt(6.31, 3.75), 'beach', 6, false, 1);
  perform pg_temp.mkring('ZZ T-G', pg_temp.pt(6.31, 3.84), 'market', 3, false, 1);
  -- all day, every day; one rule on, one rule off
  insert into public.spawn_rules (name, active, kinds, areas, start_minute, end_minute, boxes_per_wave, night_from_minute, night_until_minute)
  values ('T rule E', true, '{run}', '{ZZ T-E}', 0, 0, 3, 0, 0) returning id into v_e;
  insert into public.spawn_rules (name, active, kinds, areas, start_minute, end_minute, boxes_per_wave, night_from_minute, night_until_minute)
  values ('T rule F', false, '{beach}', '{ZZ T-F}', 0, 0, 3, 0, 0) returning id into v_f;
  v_n := public.spawn_boxes();
  perform pg_temp.eq(v_n::text, '3', 'spawn_boxes() runs active rules only');
  perform pg_temp.eq((select count(*) from public.game_drops where spawn_rule_id = v_e)::text, '3', 'active rule spawned');
  perform pg_temp.eq((select count(*) from public.game_drops where spawn_rule_id = v_f)::text, '0', 'inactive rule did not spawn');
  perform pg_temp.eq(public.spawn_boxes()::text, '0', 'second run of spawn_boxes() is not due yet');

  -- rewards: only items the claim function can honour make it through
  insert into public.collectibles (key, name, description, emoji) values ('zz-test-collectible', 'ZZ Test', 'test', 'T') returning id into v_col;
  insert into public.spawn_rules (name, kinds, areas, start_minute, end_minute, boxes_per_wave, night_from_minute, night_until_minute, reward_model, rewards)
  values ('T rule H', '{market}', '{ZZ T-G}', 0, 0, 1, 0, 0, 'fixed', jsonb_build_array(
    jsonb_build_object('type', 'collectible', 'title', 'Test item', 'collectible_key', 'zz-test-collectible', 'xp_amount', 40, 'weight', 3),
    jsonb_build_object('type', 'collectible', 'title', 'Missing item', 'collectible_key', 'no-such-key'),
    jsonb_build_object('type', 'badge', 'title', 'Badge without key'),
    jsonb_build_object('type', 'xp', 'title', 'Zero weight', 'xp_amount', 5, 'weight', 0),
    jsonb_build_object('type', 'xp', 'title', 'Huge', 'xp_amount', 99999, 'weight', 1),
    jsonb_build_object('type', 'discount', 'title', 'Not allowed here'))) returning id into v_h;
  perform pg_temp.eq(public.spawn_boxes(now(), v_h, true)::text, '1', 'rule with mixed rewards spawns');
  perform pg_temp.eq((select count(*) from public.drop_rewards r join public.game_drops g on g.id = r.drop_id where g.spawn_rule_id = v_h)::text, '2', 'only valid reward items kept');
  perform pg_temp.ok(exists (select 1 from public.drop_rewards r join public.game_drops g on g.id = r.drop_id
                             where g.spawn_rule_id = v_h and r.reward_type = 'collectible' and r.collectible_id = v_col and r.xp_amount = 40 and r.weight = 3), 'collectible key resolved to its id');
  perform pg_temp.ok(exists (select 1 from public.drop_rewards r join public.game_drops g on g.id = r.drop_id
                             where g.spawn_rule_id = v_h and r.reward_type = 'xp' and r.title = 'Huge' and r.xp_amount = 10000), 'xp capped at 10000');

  -- a rule with nothing to give spawns nothing
  insert into public.spawn_rules (name, kinds, areas, start_minute, end_minute, boxes_per_wave, rewards) values ('T rule G', '{market}', '{ZZ T-G}', 0, 0, 1, '[]') returning id into v_g;
  perform pg_temp.eq(public.spawn_boxes(now(), v_g, true)::text, '0', 'rule without rewards spawns nothing');
  perform pg_temp.eq((select count(*) from public.game_drops where spawn_rule_id = v_g)::text, '0', 'no empty boxes');
  raise notice 'ok: spawn_boxes() and rewards';
end $t$;

-- -------------------------------------------------------- d) first N ---
do $t$
declare
  x geography := pg_temp.pt(6.31, 4.20); v_drop uuid := pg_temp.mkdrop(x, 'spawn', 2); v_open uuid := pg_temp.mkdrop(x);
  u1 uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); res jsonb;
begin
  perform pg_temp.as_user(u1); res := public.claim_game_drop(v_drop, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'first Hopper opens it');
  perform pg_temp.as_user(u2); res := public.claim_game_drop(v_drop, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'second Hopper opens it');
  perform pg_temp.as_user(u3); res := public.claim_game_drop(v_drop, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'sold_out', 'third Hopper is too late');
  perform pg_temp.eq((select claimed_count::text from public.game_drops where id = v_drop), '2', 'claimed_count');
  perform pg_temp.ok((select lat = pg_temp.lat(x) and lng = pg_temp.lng(x) from public.drop_claims where drop_id = v_drop and user_id = u1), 'claim keeps the position it was made from');
  perform pg_temp.eq((select xp::text from public.profiles where id = u1), '10', 'reward still pays XP');
  -- one claim per Hopper still holds
  perform pg_temp.as_user(u1); res := public.claim_game_drop(v_open, pg_temp.lat(x), pg_temp.lng(x));
  perform pg_temp.eq(res->>'ok', 'true', 'claim on an unlimited drop'); res := public.claim_game_drop(v_open, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'already', 'second claim of the same drop');
  raise notice 'ok: d) first N';
end $t$;

-- ------------------------------------------ e) too far, closed, no session ---
do $t$
declare
  x geography := pg_temp.pt(6.31, 4.20); u uuid := pg_temp.newuser(); res jsonb; v_far geography := pg_temp.off(pg_temp.pt(6.31, 4.20), 500, 90);
  v_drop uuid := pg_temp.mkdrop(x); v_old uuid; v_future uuid; v_off uuid;
begin
  v_old := pg_temp.mkdrop(x, 'staff', null, 80, now() - interval '2 hours', now() - interval '1 hour');
  v_future := pg_temp.mkdrop(x, 'staff', null, 80, now() + interval '1 hour', now() + interval '2 hours');
  v_off := pg_temp.mkdrop(x);
  update public.game_drops set active = false where id = v_off;
  perform pg_temp.as_user(u);
  res := public.claim_game_drop(v_drop, pg_temp.lat(v_far), pg_temp.lng(v_far));
  perform pg_temp.eq(res->>'reason', 'too_far', 'outside the radius');
  perform pg_temp.ok((res->>'distance_m')::numeric between 495 and 505, 'distance_m reported');
  res := public.claim_game_drop(v_old, pg_temp.lat(x), pg_temp.lng(x));
  perform pg_temp.eq(res->>'reason', 'closed', 'after closes_at');
  res := public.claim_game_drop(v_future, pg_temp.lat(x), pg_temp.lng(x));
  perform pg_temp.eq(res->>'reason', 'closed', 'before opens_at');
  res := public.claim_game_drop(v_off, pg_temp.lat(x), pg_temp.lng(x));
  perform pg_temp.eq(res->>'reason', 'closed', 'inactive drop');
  res := public.claim_game_drop(v_drop);
  perform pg_temp.eq(res->>'reason', 'location_required', 'no position given');
  perform pg_temp.ok(not exists (select 1 from public.drop_claims where user_id = u), 'refused claims leave nothing behind');
  -- a session with no user id
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  res := public.claim_game_drop(v_drop, pg_temp.lat(x), pg_temp.lng(x));
  perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'no_session', 'no session');
  raise notice 'ok: e) too_far, closed';
end $t$;

-- ------------------------------------------------------------ g) too fast ---
do $t$
declare
  x geography := pg_temp.pt(6.31, 4.20); v_old uuid := pg_temp.mkdrop(x); v_new uuid := pg_temp.mkdrop(x);
  u1 uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); u4 uuid := pg_temp.newuser(); res jsonb;
begin
  -- 20 km away, 60 seconds ago
  insert into public.drop_claims (drop_id, user_id, claimed_at, lat, lng) values (v_old, u1, now() - interval '60 seconds', 6.31 + 0.18, 4.20);
  perform pg_temp.as_user(u1); res := public.claim_game_drop(v_new, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'too_fast', 'teleporting 20 km in a minute');
  perform pg_temp.ok(not exists (select 1 from public.drop_claims where user_id = u1 and drop_id = v_new), 'no claim stored when too fast');
  -- 2 km away, 30 minutes ago: a walk
  insert into public.drop_claims (drop_id, user_id, claimed_at, lat, lng) values (v_old, u2, now() - interval '30 minutes', 6.31 + 0.018, 4.20);
  perform pg_temp.as_user(u2); res := public.claim_game_drop(v_new, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'a normal walk is fine');
  -- far but 3 hours ago: outside the 2 hour memory
  insert into public.drop_claims (drop_id, user_id, claimed_at, lat, lng) values (v_old, u3, now() - interval '3 hours', 6.31 + 0.18, 4.20);
  perform pg_temp.as_user(u3); res := public.claim_game_drop(v_new, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'old far claim is ignored');
  -- a recent claim that has no position (made before the column existed) is ignored
  insert into public.drop_claims (drop_id, user_id, claimed_at) values (v_old, u4, now() - interval '60 seconds');
  perform pg_temp.as_user(u4); res := public.claim_game_drop(v_new, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'claims without a position are ignored');
  raise notice 'ok: g) too_fast';
end $t$;

-- ----------------------------------------------------------- h) slow down ---
do $t$
declare
  x geography := pg_temp.pt(6.31, 4.20); v_target uuid := pg_temp.mkdrop(x, 'spawn'); v_staff uuid := pg_temp.mkdrop(x, 'staff');
  u_six uuid := pg_temp.newuser(); u_five uuid := pg_temp.newuser(); u_staff uuid := pg_temp.newuser(); u_old uuid := pg_temp.newuser();
  v_d uuid; i integer; res jsonb;
begin
  for i in 1..6 loop
    v_d := pg_temp.mkdrop(x, 'spawn');
    insert into public.drop_claims (drop_id, user_id, claimed_at) values (v_d, u_six, now() - interval '10 minutes');
    if i <= 5 then insert into public.drop_claims (drop_id, user_id, claimed_at) values (v_d, u_five, now() - interval '10 minutes'); end if;
    insert into public.drop_claims (drop_id, user_id, claimed_at) values (v_d, u_old, now() - interval '61 minutes');
    insert into public.drop_claims (drop_id, user_id, claimed_at) values (pg_temp.mkdrop(x, 'staff'), u_staff, now() - interval '10 minutes');
  end loop;
  perform pg_temp.as_user(u_six); res := public.claim_game_drop(v_target, pg_temp.lat(x), pg_temp.lng(x));
  perform pg_temp.eq(res->>'reason', 'slow_down', '7th street box within the hour');
  res := public.claim_game_drop(v_staff, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'slow down only applies to spawn boxes');
  perform pg_temp.as_user(u_five); res := public.claim_game_drop(v_target, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', '6th street box is allowed');
  perform pg_temp.as_user(u_staff); res := public.claim_game_drop(v_target, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'staff drops do not count');
  perform pg_temp.as_user(u_old); res := public.claim_game_drop(v_target, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'claims older than an hour do not count');
  raise notice 'ok: h) slow_down';
end $t$;

-- ------------------------------------- j) one claim at a time, QR code, score ---
do $t$
declare
  x geography := pg_temp.pt(6.31, 4.40); u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); res jsonb; h bigint; lk integer;
  v_spawn uuid := pg_temp.mkdrop(x, 'spawn', 5); v_staff uuid := pg_temp.mkdrop(x, 'staff'); v_welcome uuid := pg_temp.mkdrop(x, 'welcome', 1, 80, now() - interval '1 minute', now() + interval '1 hour', u);
  v_qr uuid; v_either uuid; v_cid uuid;
begin
  -- a claim takes the Hopper's own lock first, so parallel requests from one Hopper run one at a time
  perform pg_temp.as_user(u); res := public.claim_game_drop(v_spawn, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'claim for the lock check');
  h := hashtextextended('claim:' || u::text, 0);
  select count(*) into lk from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid::bigint = (h >> 32) & 4294967295 and objid::bigint = h & 4294967295;
  perform pg_temp.ok(lk = 1, 'claim_game_drop holds the per-Hopper advisory lock');
  -- the lock is per Hopper: nobody else's key is taken by this claim
  perform pg_temp.ok(not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid::bigint = ((hashtextextended('claim:' || u2::text, 0)) >> 32) & 4294967295
                                   and objid::bigint = (hashtextextended('claim:' || u2::text, 0)) & 4294967295), 'no lock taken for another Hopper');

  -- score: street and welcome boxes log the street_drop rule (0 by default), venue drops keep the drop rule
  select id into v_cid from public.drop_claims where drop_id = v_spawn and user_id = u;
  perform pg_temp.eq((select outside_score::text from public.activity_log where source_id = v_cid and action = 'drop'), '0', 'a street box scores 0 by default');
  perform pg_temp.as_user(u); res := public.claim_game_drop(v_welcome, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'ok', 'true', 'owner opens the welcome box');
  perform pg_temp.eq((select a.outside_score::text from public.activity_log a join public.drop_claims c on c.id = a.source_id where c.drop_id = v_welcome and c.user_id = u), '0', 'a welcome box scores 0 by default');
  perform pg_temp.as_user(u); res := public.claim_game_drop(v_staff, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq((select a.outside_score::text from public.activity_log a join public.drop_claims c on c.id = a.source_id where c.drop_id = v_staff and c.user_id = u),
                     (select score::text from public.game_score_rules where key = 'drop'), 'a staff drop keeps the drop score');
  update public.game_score_rules set score = 7 where key = 'street_drop';
  v_spawn := pg_temp.mkdrop(x, 'spawn', 5);
  perform pg_temp.as_user(u2); res := public.claim_game_drop(v_spawn, pg_temp.lat(x), pg_temp.lng(x)); perform pg_temp.as_admin();
  perform pg_temp.eq((select a.outside_score::text from public.activity_log a join public.drop_claims c on c.id = a.source_id where c.drop_id = v_spawn and c.user_id = u2), '7', 'street_drop score can be changed by staff');
  update public.game_score_rules set score = 0 where key = 'street_drop';

  -- QR codes need pgcrypto digest(), which lives in the extensions schema on Supabase
  v_qr := pg_temp.mkdrop(x, 'staff'); update public.game_drops set claim_method = 'qr' where id = v_qr;
  v_either := pg_temp.mkdrop(x, 'staff'); update public.game_drops set claim_method = 'either' where id = v_either;
  insert into public.drop_qr_codes (drop_id, code_hash, valid_from, valid_until) values
    (v_qr, encode(extensions.digest('QR-ONE', 'sha256'), 'hex'), now() - interval '1 hour', now() + interval '1 hour'),
    (v_either, encode(extensions.digest('QR-TWO', 'sha256'), 'hex'), now() - interval '1 hour', now() + interval '1 hour');
  perform pg_temp.as_user(u2);
  res := public.claim_game_drop(v_qr, null, null, 'WRONG');
  perform pg_temp.eq(res->>'reason', 'invalid_code', 'a wrong code on a QR drop');
  res := public.claim_game_drop(v_qr);
  perform pg_temp.eq(res->>'reason', 'code_required', 'a QR drop needs a code');
  res := public.claim_game_drop(v_qr, null, null, 'QR-ONE');
  perform pg_temp.eq(res->>'ok', 'true', 'the right code opens a QR drop: ' || res::text);
  res := public.claim_game_drop(v_either, null, null, 'QR-TWO');
  perform pg_temp.eq(res->>'ok', 'true', 'the right code opens an either drop without a location: ' || res::text);
  perform pg_temp.as_admin();
  raise notice 'ok: j) claim lock, score, QR';
end $t$;

-- ----------------------------------------------------- f) welcome boxes ---
-- By day: spots in range are used; decoys (too near, in the gap, too far, in a zone, inactive) are not.
do $t$
declare
  w geography := pg_temp.pt(6.34, 3.20); v_u uuid := pg_temp.newuser(); res jsonb; ids uuid[];
  p1 geography := pg_temp.off(pg_temp.pt(6.34, 3.20), 200, 20); p2 geography := pg_temp.off(pg_temp.pt(6.34, 3.20), 300, 200); p3 geography := pg_temp.off(pg_temp.pt(6.34, 3.20), 1000, 110);
  v_hits integer;
begin
  perform pg_temp.mkspot('near 1', 'park', p1, null);
  perform pg_temp.mkspot('near 2', 'park', p2, null);
  perform pg_temp.mkspot('far 1', 'park', p3, null);
  perform pg_temp.mkspot('too near', 'park', pg_temp.off(w, 50, 300), null, false, 1000);
  perform pg_temp.mkspot('in the gap', 'park', pg_temp.off(w, 520, 60), null, false, 1000);
  perform pg_temp.mkspot('too far', 'park', pg_temp.off(w, 2000, 250), null, false, 1000);
  perform pg_temp.mkspot('in a zone', 'park', pg_temp.off(w, 250, 330), null, false, 1000);
  perform pg_temp.mkspot('inactive', 'park', pg_temp.off(w, 300, 100), null, false, 1000, false);
  perform public.add_no_spawn_zone('welcome zone', 'test', pg_temp.lat(pg_temp.off(w, 250, 330)), pg_temp.lng(pg_temp.off(w, 250, 330)), 60);
  res := public.spawn_welcome_boxes_for(v_u, 6.34, 3.20, false);
  perform pg_temp.ok(res->>'ok' = 'true' and res->>'already' = 'false' and res->>'night' = 'false', 'day result shape: ' || res::text);
  ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
  perform pg_temp.eq(cardinality(ids)::text, '3', 'three day boxes');
  perform pg_temp.eq((select count(*) from public.game_drops where id = any (ids) and radius_m = 60 and kind = 'welcome' and owner_id = v_u)::text, '3', 'day radius 60');
  select count(*) into v_hits from public.game_drops g where g.id = any (ids) and (st_dwithin(g.geog, p1, 1) or st_dwithin(g.geog, p2, 1));
  perform pg_temp.eq(v_hits::text, '2', 'two boxes at the close spots');
  perform pg_temp.eq((select count(*) from public.game_drops g where g.id = any (ids) and st_dwithin(g.geog, p3, 1))::text, '1', 'one box at the far spot');
  perform pg_temp.eq((select string_agg(r.title || ' ' || r.xp_amount, ', ' order by r.xp_amount, r.title) from public.drop_rewards r where r.drop_id = any (ids)),
                     'Welcome find 50, Welcome find 50, Worth the walk 150', 'day rewards');
  perform pg_temp.ok((select r.title = 'Worth the walk' from public.drop_rewards r join public.game_drops g on g.id = r.drop_id where g.id = any (ids) and st_dwithin(g.geog, p3, 1)), 'the far box pays the most');
  delete from public.spawn_points;
  raise notice 'ok: f) welcome by day, spots';
end $t$;

-- By day with no spots: offsets 200, 320 and 900 m. By night: three boxes 15 to 45 m away.
do $t$
declare
  v_u uuid := pg_temp.newuser(); v_n uuid := pg_temp.newuser(); res jsonb; ids uuid[];
  wd geography := pg_temp.pt(6.34, 3.30); wn geography := pg_temp.pt(6.34, 3.50);
begin
  res := public.spawn_welcome_boxes_for(v_u, 6.34, 3.30, false);
  ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
  perform pg_temp.eq((select string_agg(round(pg_temp.dist(g.geog, wd))::text, ',' order by pg_temp.dist(g.geog, wd)) from public.game_drops g where g.id = any (ids)), '200,320,900', 'day fallback distances');
  perform pg_temp.eq((select string_agg(r.xp_amount::text, ',' order by r.xp_amount) from public.drop_rewards r where r.drop_id = any (ids)), '50,50,150', 'day fallback rewards');

  res := public.spawn_welcome_boxes_for(v_n, 6.34, 3.50, true);
  perform pg_temp.ok(res->>'ok' = 'true' and res->>'night' = 'true', 'night result shape: ' || res::text);
  ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
  perform pg_temp.eq(cardinality(ids)::text, '3', 'three night boxes');
  perform pg_temp.ok((select bool_and(pg_temp.dist(g.geog, wn) between 14.5 and 45.5 and g.radius_m = 80 and g.max_claims = 1 and g.claim_method = 'proximity'
                        and g.reward_model = 'fixed' and g.closes_at - g.opens_at = interval '24 hours' and g.title = 'Welcome box' and g.active) from public.game_drops g where g.id = any (ids)), 'night boxes sit next to the Hopper');
  perform pg_temp.eq((select string_agg(r.xp_amount::text, ',') from public.drop_rewards r where r.drop_id = any (ids)), '50,50,50', 'night rewards');
  -- a second call changes nothing, whatever the hour
  res := public.spawn_welcome_boxes_for(v_n, 6.34, 3.50, false);
  perform pg_temp.ok(res->>'ok' = 'true' and res->>'already' = 'true' and not res ? 'ids', 'already: ' || res::text);
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = v_n)::text, '3', 'no new rows on a repeat call');
  raise notice 'ok: f) welcome fallback and night';
end $t$;

-- Zones: every welcome box avoids them, and the Hopper's own point is the last resort.
do $t$
declare
  i integer; res jsonb; ids uuid[]; v_zone geography;
  wq geography := pg_temp.pt(6.34, 3.60); wz geography := pg_temp.pt(6.34, 3.40); wl geography := pg_temp.pt(6.34, 3.70);
begin
  -- night: a zone 60 m north with a 55 m radius covers a big arc of the 15 to 45 m ring
  v_zone := pg_temp.off(wq, 60, 0);
  perform public.add_no_spawn_zone('night zone', 'test', pg_temp.lat(v_zone), pg_temp.lng(v_zone), 55);
  for i in 1..25 loop
    res := public.spawn_welcome_boxes_for(pg_temp.newuser(), 6.34, 3.60, true);
    ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
    perform pg_temp.ok(not exists (select 1 from public.game_drops g join public.no_spawn_zones z on st_intersects(z.geog, g.geog) where g.id = any (ids) and z.name = 'night zone'), 'night box inside a zone');
    perform pg_temp.ok((select bool_and(pg_temp.dist(g.geog, wq) between 14.5 and 45.5) from public.game_drops g where g.id = any (ids)), 'night boxes found a clear bearing');
  end loop;
  -- day without spots: a zone over the 200 m point
  v_zone := pg_temp.off(wz, 200, 0);
  perform public.add_no_spawn_zone('day zone', 'test', pg_temp.lat(v_zone), pg_temp.lng(v_zone), 150);
  for i in 1..10 loop
    res := public.spawn_welcome_boxes_for(pg_temp.newuser(), 6.34, 3.40, false);
    ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
    perform pg_temp.ok(not exists (select 1 from public.game_drops g join public.no_spawn_zones z on st_intersects(z.geog, g.geog) where g.id = any (ids) and z.name = 'day zone'), 'day box inside a zone');
    perform pg_temp.eq((select string_agg(round(pg_temp.dist(g.geog, wz))::text, ',' order by pg_temp.dist(g.geog, wz)) from public.game_drops g where g.id = any (ids)), '200,320,900', 'day boxes kept their distances');
  end loop;
  -- standing inside a big zone: nowhere is clear, so the boxes go to the Hopper's own point
  perform public.add_no_spawn_zone('big zone', 'test', 6.34, 3.70, 500);
  res := public.spawn_welcome_boxes_for(pg_temp.newuser(), 6.34, 3.70, true);
  ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
  perform pg_temp.ok((select bool_and(pg_temp.dist(g.geog, wl) < 1) from public.game_drops g where g.id = any (ids)), 'last resort is the Hopper own point');
  raise notice 'ok: f) welcome zones';
end $t$;

-- A coast: a big water zone and a Hopper standing a few metres from it. No box lands in the water.
do $t$
declare
  i integer; res jsonb; ids uuid[]; z uuid; lat0 double precision;
begin
  insert into public.no_spawn_zones (name, reason, geog, source)
  values ('test sea', 'water', st_geogfromtext('SRID=4326;POLYGON((4.20 5.90,4.80 5.90,4.80 6.31,4.20 6.31,4.20 5.90))'), 'staff') returning id into z;
  foreach lat0 in array array[6.31018, 6.3125, 6.3140] loop   -- 20 m, 140 m and 310 m north of the shore
    for i in 1..25 loop
      res := public.spawn_welcome_boxes_for(pg_temp.newuser(), lat0, 4.50, false);
      ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
      perform pg_temp.ok(not exists (select 1 from public.game_drops g join public.no_spawn_zones sea on st_intersects(sea.geog, g.geog) where g.id = any (ids) and sea.id = z), 'day box in the water at ' || lat0);
      perform pg_temp.eq((select string_agg(round(pg_temp.dist(g.geog, pg_temp.pt(lat0, 4.50)))::text, ',' order by pg_temp.dist(g.geog, pg_temp.pt(lat0, 4.50))) from public.game_drops g where g.id = any (ids)), '200,320,900', 'day boxes at the coast kept their distances');
      res := public.spawn_welcome_boxes_for(pg_temp.newuser(), lat0, 4.50, true);
      ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
      perform pg_temp.ok(not exists (select 1 from public.game_drops g join public.no_spawn_zones sea on st_intersects(sea.geog, g.geog) where g.id = any (ids) and sea.id = z), 'night box in the water at ' || lat0);
      perform pg_temp.ok((select bool_and(pg_temp.dist(g.geog, pg_temp.pt(lat0, 4.50)) between 14.5 and 45.5) from public.game_drops g where g.id = any (ids)), 'night boxes at the coast found land');
    end loop;
  end loop;
  delete from public.no_spawn_zones where id = z;
  raise notice 'ok: f) welcome boxes at a coast';
end $t$;

-- The real entry point, visibility and ownership.
do $t$
declare
  v_w geography := pg_temp.pt(6.34, 3.80); uw uuid := pg_temp.newuser(); uo uuid := pg_temp.newuser(); res jsonb; ids uuid[]; v_box uuid; v_g geography; v_cnt integer;
  v_night boolean := extract(hour from now() at time zone 'Africa/Lagos') >= 21 or extract(hour from now() at time zone 'Africa/Lagos') < 6;
begin
  perform pg_temp.as_user(uw);
  res := public.spawn_welcome_boxes(6.34, 3.80);
  perform pg_temp.as_admin();
  perform pg_temp.ok(res->>'ok' = 'true' and res->>'already' = 'false', 'welcome ok: ' || res::text);
  perform pg_temp.eq(res->>'night', v_night::text, 'night flag follows the Lagos clock');
  ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
  perform pg_temp.eq(cardinality(ids)::text, '3', 'three boxes');
  if v_night then
    perform pg_temp.ok((select bool_and(pg_temp.dist(g.geog, v_w) between 14.5 and 45.5) from public.game_drops g where g.id = any (ids)), 'night distances (this run happened at night)');
  else
    perform pg_temp.eq((select string_agg(round(pg_temp.dist(g.geog, v_w))::text, ',' order by pg_temp.dist(g.geog, v_w)) from public.game_drops g where g.id = any (ids)), '200,320,900', 'day distances (this run happened by day)');
  end if;

  perform pg_temp.as_user(uw);
  res := public.spawn_welcome_boxes(6.34, 3.80);
  perform pg_temp.as_admin();
  perform pg_temp.ok(res->>'ok' = 'true' and res->>'already' = 'true', 'second call is already: ' || res::text);
  perform pg_temp.eq((select count(*) from public.game_drops where owner_id = uw)::text, '3', 'still three boxes');

  -- guards
  perform pg_temp.as_user(uw);
  perform pg_temp.eq(public.spawn_welcome_boxes(7.20, 3.80)->>'reason', 'outside_lagos', 'north of Lagos');
  perform pg_temp.eq(public.spawn_welcome_boxes(6.34, 4.50)->>'reason', 'outside_lagos', 'east of Lagos');
  perform pg_temp.eq(public.spawn_welcome_boxes(6.10, 3.80)->>'reason', 'outside_lagos', 'south of Lagos');
  perform pg_temp.eq(public.spawn_welcome_boxes(6.34, 2.90)->>'reason', 'outside_lagos', 'west of Lagos');
  perform pg_temp.eq(public.spawn_welcome_boxes(null, null)->>'reason', 'location_required', 'no position');
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  perform pg_temp.eq(public.spawn_welcome_boxes(6.34, 3.80)->>'reason', 'no_session', 'no session');
  perform pg_temp.as_admin();
  perform pg_temp.eq((select count(*) from public.game_drops where kind = 'welcome' and owner_id = uo)::text, '0', 'guards create nothing');

  -- only the owner sees them
  perform pg_temp.as_user(uw);
  select count(*) into v_cnt from public.game_drops where kind = 'welcome';
  perform pg_temp.eq(v_cnt::text, '3', 'owner sees the three boxes');
  perform pg_temp.as_user(uo);
  select count(*) into v_cnt from public.game_drops where kind = 'welcome';
  perform pg_temp.eq(v_cnt::text, '0', 'another Hopper sees no welcome boxes');
  select count(*) into v_cnt from public.game_drops where owner_id = uw;
  perform pg_temp.eq(v_cnt::text, '0', 'another Hopper cannot filter them out either');
  perform pg_temp.as_anon();
  select count(*) into v_cnt from public.game_drops where kind = 'welcome';
  perform pg_temp.eq(v_cnt::text, '0', 'anon sees no welcome boxes');
  perform pg_temp.as_admin();

  -- only the owner can open one
  select id, geog into v_box, v_g from public.game_drops g where g.id = any (ids) order by (select r.xp_amount from public.drop_rewards r where r.drop_id = g.id), g.id limit 1;
  perform pg_temp.as_user(uo);
  res := public.claim_game_drop(v_box, pg_temp.lat(v_g), pg_temp.lng(v_g));
  perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'not_yours', 'another Hopper cannot open it');
  perform pg_temp.as_user(uw);
  res := public.claim_game_drop(v_box, pg_temp.lat(pg_temp.off(v_g, 400, 0)), pg_temp.lng(pg_temp.off(v_g, 400, 0)));
  perform pg_temp.eq(res->>'reason', 'too_far', 'the owner still has to be there');
  res := public.claim_game_drop(v_box, pg_temp.lat(v_g), pg_temp.lng(v_g));
  perform pg_temp.as_admin();
  perform pg_temp.ok(res->>'ok' = 'true' and (res->>'xp')::integer = 50, 'the owner opens it for 50 XP: ' || res::text);
  perform pg_temp.as_user(uw);
  res := public.claim_game_drop(v_box, pg_temp.lat(v_g), pg_temp.lng(v_g));
  perform pg_temp.as_admin();
  perform pg_temp.eq(res->>'reason', 'sold_out', 'opened once, gone');
  raise notice 'ok: f) welcome entry point, privacy';
end $t$;

-- ------------------------------------------------------ i) privileges ---
do $t$
declare
  t text; v_rule uuid; v_u uuid := pg_temp.newuser();
begin
  foreach t in array array['spawn_points', 'no_spawn_zones', 'spawn_rules'] loop
    perform pg_temp.as_anon();
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST FAILED: anon could read %', t;
    exception when insufficient_privilege then null;
    end;
    perform pg_temp.as_user(v_u);
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST FAILED: authenticated could read %', t;
    exception when insufficient_privilege then null;
    end;
    perform pg_temp.as_admin();
    perform pg_temp.ok((select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'RLS on for ' || t);
  end loop;

  perform pg_temp.as_user(v_u);
  begin perform public.spawn_boxes(); raise exception 'TEST FAILED: authenticated ran spawn_boxes';
  exception when insufficient_privilege then null; end;
  begin perform public.spawner_summary(); raise exception 'TEST FAILED: authenticated ran spawner_summary';
  exception when insufficient_privilege then null; end;
  begin perform public.add_no_spawn_zone('x', 'x', 6.4, 3.4, 100); raise exception 'TEST FAILED: authenticated ran add_no_spawn_zone';
  exception when insufficient_privilege then null; end;
  begin perform public.spawn_welcome_boxes_for(v_u, 6.4, 3.4, true); raise exception 'TEST FAILED: authenticated ran spawn_welcome_boxes_for';
  exception when insufficient_privilege then null; end;
  begin perform public.lagos_area_for(st_point(3.4, 6.4)::geography); raise exception 'TEST FAILED: authenticated ran lagos_area_for';
  exception when insufficient_privilege then null; end;

  perform pg_temp.as_anon();
  begin perform public.spawn_boxes(); raise exception 'TEST FAILED: anon ran spawn_boxes';
  exception when insufficient_privilege then null; end;
  begin perform public.spawn_welcome_boxes(6.34, 3.80); raise exception 'TEST FAILED: anon ran spawn_welcome_boxes';
  exception when insufficient_privilege then null; end;
  begin perform public.spawner_summary(); raise exception 'TEST FAILED: anon ran spawner_summary';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();

  perform pg_temp.ok(not has_function_privilege('anon', 'public.spawn_boxes(timestamptz,uuid,boolean)', 'execute'), 'anon spawn_boxes grant');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.spawn_boxes(timestamptz,uuid,boolean)', 'execute'), 'authenticated spawn_boxes grant');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.spawn_boxes(timestamptz,uuid,boolean)', 'execute'), 'service_role spawn_boxes grant');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.spawn_welcome_boxes(double precision,double precision)', 'execute'), 'authenticated may call spawn_welcome_boxes');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.spawn_welcome_boxes(double precision,double precision)', 'execute'), 'anon may not call spawn_welcome_boxes');
  perform pg_temp.ok(has_function_privilege('anon', 'public.claim_game_drop(uuid,double precision,double precision,text)', 'execute')
                     and has_function_privilege('authenticated', 'public.claim_game_drop(uuid,double precision,double precision,text)', 'execute'), 'claim_game_drop grants unchanged');

  -- the service role can use all of it
  perform pg_temp.as_service();
  perform pg_temp.ok((select count(*) from public.spawn_points) >= 0 and (select count(*) from public.no_spawn_zones) >= 0 and (select count(*) from public.spawn_rules) > 0, 'service role reads the tables');
  perform pg_temp.ok(public.spawner_summary() ? 'points_total', 'service role runs spawner_summary');
  select id into v_rule from public.spawn_rules where name = 'T rule B';
  perform pg_temp.ok(public.spawn_boxes(pg_temp.lagos('2026-10-20 15:00'), v_rule, true) >= 0, 'service role runs spawn_boxes');
  perform pg_temp.as_admin();

  -- the existing app still lists boxes: anon and signed-in Hoppers read game_drops
  perform pg_temp.as_anon();
  perform pg_temp.ok((select count(*) from public.game_drops) >= 0, 'anon reads game_drops');
  perform pg_temp.ok((select count(*) from (select kind, owner_id, spawn_point_id, spawn_rule_id, hunt_item, claimed_count, max_claims from public.game_drops limit 5) s) >= 0, 'anon reads the new columns');
  perform pg_temp.ok(not exists (select 1 from public.game_drops where owner_id is not null), 'anon sees no owned boxes');
  perform pg_temp.as_user(v_u);
  perform pg_temp.ok((select count(*) from public.game_drops) >= 0, 'authenticated reads game_drops');
  perform pg_temp.as_admin();
  raise notice 'ok: i) privileges';
end $t$;

-- ---------------------------------------------------- admin summary ---
do $t$
declare s1 jsonb; s2 jsonb; v_a uuid; v_d uuid;
begin
  s1 := public.spawner_summary();
  perform pg_temp.ok(s1 ?& array['points_total','points_active','night_safe_active','points_by_kind','zones_active','live_spawn','live_welcome','rules_active'], 'summary keys');
  perform pg_temp.eq((select count(*)::text from jsonb_object_keys(s1->'points_by_kind')), '7', 'all seven kinds listed');
  v_a := pg_temp.mkspot('sum 1', 'venue', pg_temp.pt(6.31, 4.30), null, true);
  perform pg_temp.mkspot('sum 2', 'venue', pg_temp.pt(6.31, 4.31), null, false);
  perform pg_temp.mkspot('sum 3', 'street', pg_temp.pt(6.31, 4.32), null, true, 1, false);
  perform public.add_no_spawn_zone('sum zone', 'test', 6.31, 4.30, 100);
  v_d := pg_temp.mkdrop(pg_temp.pt(6.31, 4.30), 'spawn');
  perform pg_temp.mkdrop(pg_temp.pt(6.31, 4.30), 'welcome', 1, 60, now(), now() + interval '1 hour', pg_temp.newuser());
  perform pg_temp.mkdrop(pg_temp.pt(6.31, 4.30), 'spawn', null, 80, now() - interval '2 hours', now() - interval '1 hour');
  update public.spawn_rules set active = true where name = 'T rule A';
  s2 := public.spawner_summary();
  perform pg_temp.eq((s2->>'points_total')::integer - (s1->>'points_total')::integer || '', '3', 'points_total');
  perform pg_temp.eq((s2->>'points_active')::integer - (s1->>'points_active')::integer || '', '2', 'points_active');
  perform pg_temp.eq((s2->>'night_safe_active')::integer - (s1->>'night_safe_active')::integer || '', '1', 'night_safe_active');
  perform pg_temp.eq((s2->'points_by_kind'->>'venue')::integer - (s1->'points_by_kind'->>'venue')::integer || '', '2', 'points_by_kind venue');
  perform pg_temp.eq((s2->'points_by_kind'->>'street')::integer - (s1->'points_by_kind'->>'street')::integer || '', '0', 'inactive spots not counted by kind');
  perform pg_temp.eq((s2->>'zones_active')::integer - (s1->>'zones_active')::integer || '', '1', 'zones_active');
  perform pg_temp.eq((s2->>'live_spawn')::integer - (s1->>'live_spawn')::integer || '', '1', 'live_spawn ignores closed boxes');
  perform pg_temp.eq((s2->>'live_welcome')::integer - (s1->>'live_welcome')::integer || '', '1', 'live_welcome');
  perform pg_temp.eq((s2->>'rules_active')::integer - (s1->>'rules_active')::integer || '', '1', 'rules_active');
  -- add_no_spawn_zone: a staff circle that covers its centre and not a point 300 m out
  perform pg_temp.ok((select st_covers(z.geog, pg_temp.pt(6.31, 4.30)) and not st_covers(z.geog, pg_temp.off(pg_temp.pt(6.31, 4.30), 300, 0)) and z.source = 'staff' and z.active and z.reason = 'test'
                        from public.no_spawn_zones z where z.name = 'sum zone'), 'add_no_spawn_zone makes a 100 m staff circle');
  begin perform public.add_no_spawn_zone('', 'x', 6.4, 3.4, 100); raise exception 'TEST FAILED: empty zone name accepted';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  begin perform public.add_no_spawn_zone('x', 'x', 6.4, 3.4, 0); raise exception 'TEST FAILED: zero radius accepted';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  raise notice 'ok: summary and zones';
end $t$;

do $t$ begin raise notice 'ALL SPAWNING TESTS PASSED'; end $t$;

rollback;
