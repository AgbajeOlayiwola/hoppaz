-- ============================================================================
-- Hoppaz: box guard tests (no box in the water)
-- Run against a LOCAL database that already has schema.sql, hunt_items.sql,
-- spawning.sql, spawn_points_lagos.sql and box_guards.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/box_guards_test.sql
--
-- One transaction that always rolls back, so nothing is kept. Every check
-- raises an exception on failure; the last line printed is
-- ALL BOX GUARD TESTS PASSED.
-- Part 1 uses the real Lagos data (the Atlantic, the lagoon, the real spots).
-- Part 2 builds its own zones at open sea east of Lagos (longitude 4.4 to 4.9),
-- where no real data sits, so it proves every rule edge by edge.
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

create function pg_temp.pt(p_lat double precision, p_lng double precision) returns geography language sql as $f$
  select st_point(p_lng, p_lat)::geography;
$f$;

create function pg_temp.off(p_from geography, p_dist double precision, p_bearing double precision) returns geography language sql as $f$
  select st_project(p_from, p_dist, radians(p_bearing))::geography;
$f$;

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guardtest-' || u || '@guardtest.invalid', '{}', '{}', now(), now());
  return u;
end $f$;

-- Inserts a drop the way the admin desk would. Answers 'ok' (the row stays until
-- the rollback) or '<sqlstate> <message>' when the database refuses it.
create function pg_temp.try_drop(p_geog geography, p_kind text default 'staff', p_event uuid default null)
returns text language plpgsql as $f$
begin
  insert into public.game_drops (title, geog, event_id, opens_at, closes_at, radius_m, claim_method, reward_model, kind)
  values ('ZZ guard test', p_geog, p_event, now() - interval '1 minute', now() + interval '1 hour', 80, 'proximity', 'fixed', p_kind);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $f$;

create function pg_temp.water_msg() returns text language sql as $f$
  select '23514 That spot is in the water. Pick a spot on land.';
$f$;

-- ============================================================================
-- Part 1: the real Lagos data
-- ============================================================================

-- The data this part needs is there.
do $t$
begin
  perform pg_temp.ok(exists (select 1 from public.no_spawn_zones where zone_type = 'water' and source_ref in ('derived/sea', 'lagos-core/sea')),
    'the Atlantic zone is missing: run spawn_points_lagos.sql (then box_guards.sql) first');
  perform pg_temp.ok((select count(*) from public.spawn_points where active) > 0, 'no active spawn spots: run spawn_points_lagos.sql first');
  raise notice 'ok: real data is loaded';
end $t$;

-- Every zone has a type, and the type agrees with the reason.
do $t$
begin
  perform pg_temp.eq((select count(*) from public.no_spawn_zones where zone_type is null)::text, '0', 'every zone has a type');
  perform pg_temp.eq((select count(*) from public.no_spawn_zones where (reason = 'water') <> (zone_type = 'water'))::text, '0', 'zone_type water exactly where the reason is water');
  perform pg_temp.ok(exists (select 1 from public.no_spawn_zones where source_ref in ('derived/sea', 'lagos-core/sea') and zone_type = 'water' and active), 'the Atlantic is a water zone');
  perform pg_temp.ok(exists (select 1 from public.no_spawn_zones where source_ref = 'lagos-core/harbour-mouth' and zone_type = 'water' and active)
                     or not exists (select 1 from public.no_spawn_zones where source_ref = 'lagos-core/harbour-mouth'), 'the boat-only harbour mouth is a water zone');
  perform pg_temp.eq((select count(*) from public.no_spawn_zones where reason = 'military' and zone_type <> 'military')::text, '0', 'military zones are typed military');
  raise notice 'ok: zone types on the real data';
end $t$;

-- A staff drop in the sea, a street box in the lagoon, a land drop, an event drop with no point.
do $t$
declare
  v_sea geography := pg_temp.pt(6.30, 3.40);           -- open Atlantic, 11 km south of Victoria Island
  v_lagoon geography; v_lagoon_name text; v_land geography; v_ev uuid; k text;
begin
  perform pg_temp.ok((select bool_or(st_intersects(z.geog, v_sea)) from public.no_spawn_zones z where z.zone_type = 'water' and z.active), 'premise: the test sea point is in a water zone');
  -- a staff drop in the sea is refused, with the plain message; so is every other kind
  perform pg_temp.eq(pg_temp.try_drop(v_sea, 'staff'), pg_temp.water_msg(), 'a staff drop in the sea is rejected');
  perform pg_temp.eq(pg_temp.try_drop(v_sea, 'spawn'), pg_temp.water_msg(), 'a street box in the sea is rejected');
  perform pg_temp.eq(pg_temp.try_drop(v_sea, 'welcome'), pg_temp.water_msg(), 'a welcome box in the sea is rejected');

  -- the lagoon: a point certain to be inside it
  select z.name, st_pointonsurface(z.geog::geometry)::geography into v_lagoon_name, v_lagoon
    from public.no_spawn_zones z where z.zone_type = 'water' and z.active and z.source_ref not in ('derived/sea', 'lagos-core/sea')
    order by (z.name = 'Lagos Lagoon') desc, st_area(z.geog) desc limit 1;
  perform pg_temp.ok(v_lagoon is not null, 'a lagoon zone to test with');
  perform pg_temp.eq(pg_temp.try_drop(v_lagoon, 'spawn'), pg_temp.water_msg(), 'a street box in the lagoon (' || v_lagoon_name || ') is rejected');
  perform pg_temp.eq(pg_temp.try_drop(v_lagoon, 'staff'), pg_temp.water_msg(), 'a staff drop in the lagoon is rejected');

  -- a land drop is fine: a real park or landmark spot, which the spawner itself uses
  select sp.geog into v_land from public.spawn_points sp where sp.active and sp.kind in ('park', 'landmark', 'market') order by sp.name limit 1;
  perform pg_temp.ok(v_land is not null, 'a land spot to test with');
  foreach k in array array['staff', 'spawn', 'welcome'] loop
    perform pg_temp.eq(pg_temp.try_drop(v_land, k), 'ok', 'a ' || k || ' drop on land is fine');
  end loop;

  -- an event drop with no point of its own is untouched, even when the event itself sits in the sea
  insert into public.events (title, venue_name, geog, starts_at, status) values ('ZZ guard event', 'ZZ guard venue', v_sea, now(), 'live') returning id into v_ev;
  perform pg_temp.eq(pg_temp.try_drop(null, 'staff', v_ev), 'ok', 'an event drop with no point is fine');
  -- but the moment it has a point of its own, the point is checked
  perform pg_temp.eq(pg_temp.try_drop(v_sea, 'staff', v_ev), pg_temp.water_msg(), 'an event drop with its own point in the sea is rejected');
  raise notice 'ok: sea, lagoon, land and event drops on the real data';
end $t$;

-- The waterline spots are off: nothing active within 40 m of water, beaches included.
do $t$
begin
  perform pg_temp.eq((select count(*) from public.spawn_points sp
                        where sp.active and exists (select 1 from public.no_spawn_zones z where z.active and z.zone_type = 'water' and st_dwithin(z.geog, sp.geog, 40)))::text,
                     '0', 'no active spot within 40 m of water');
  perform pg_temp.eq((select count(*) from public.spawn_points sp
                        where sp.active and sp.kind = 'beach' and exists (select 1 from public.no_spawn_zones z where z.active and z.zone_type = 'water' and st_dwithin(z.geog, sp.geog, 40)))::text,
                     '0', 'no active beach on the waterline');
  perform pg_temp.ok(exists (select 1 from public.spawn_points sp
                               where not sp.active and exists (select 1 from public.no_spawn_zones z where z.active and z.zone_type = 'water' and st_dwithin(z.geog, sp.geog, 40))),
                     'the waterline spots are there and switched off');
  raise notice 'ok: waterline spots are inactive';
end $t$;

-- The spawner on the real data, forced, puts nothing in the water or in any zone.
do $t$
declare r uuid; made integer;
begin
  select id into r from public.spawn_rules order by created_at limit 1;
  made := public.spawn_boxes(now(), r, true);
  perform pg_temp.ok(made > 0, 'the forced spawner made boxes on the real data');
  perform pg_temp.eq((select count(*) from public.game_drops g join public.no_spawn_zones z on z.active and st_intersects(z.geog, g.geog)
                        where g.spawn_rule_id = r and g.created_at = now())::text, '0', 'no street box in a zone');
  raise notice 'ok: spawner on the real data (% boxes)', made;
end $t$;

-- A Hopper standing at the active spot nearest the sea gets welcome boxes on land, day and night.
do $t$
declare
  v_at geography; v_lat double precision; v_lng double precision; i integer; res jsonb; ids uuid[];
begin
  select sp.geog into v_at from public.spawn_points sp, public.no_spawn_zones z
    where sp.active and z.active and z.zone_type = 'water' and z.source_ref in ('derived/sea', 'lagos-core/sea')
    order by st_distance(z.geog, sp.geog) limit 1;
  v_lat := st_y(v_at::geometry); v_lng := st_x(v_at::geometry);
  for i in 1..15 loop
    res := public.spawn_welcome_boxes_for(pg_temp.newuser(), v_lat, v_lng, i % 2 = 0);
    perform pg_temp.eq(res->>'ok', 'true', 'welcome boxes at the coast were made');
    ids := array(select jsonb_array_elements_text(res->'ids')::uuid);
    perform pg_temp.eq((select count(*) from public.game_drops g join public.no_spawn_zones z on z.active and st_intersects(z.geog, g.geog) where g.id = any (ids))::text,
                       '0', 'a welcome box at the coast landed in a zone');
  end loop;
  raise notice 'ok: welcome boxes at the real coast';
end $t$;

-- ============================================================================
-- Part 2: zones of our own, every rule edge by edge
-- ============================================================================

-- Zone types: worked out from reason and source_ref, kept when given, checked.
do $t$
declare z uuid;
begin
  perform pg_temp.eq(public.no_spawn_zone_type('water', null), 'water', 'type of reason water');
  perform pg_temp.eq(public.no_spawn_zone_type('  Water ', null), 'water', 'type ignores case and spaces');
  perform pg_temp.eq(public.no_spawn_zone_type('military', null), 'military', 'type of reason military');
  perform pg_temp.eq(public.no_spawn_zone_type('airport', null), 'airport', 'type of reason airport');
  perform pg_temp.eq(public.no_spawn_zone_type('prison', null), 'prison', 'type of reason prison');
  perform pg_temp.eq(public.no_spawn_zone_type('port', null), 'port', 'type of reason port');
  perform pg_temp.eq(public.no_spawn_zone_type('landfill', null), 'landfill', 'type of reason landfill');
  perform pg_temp.eq(public.no_spawn_zone_type('power plant', null), 'power', 'type of reason power plant');
  perform pg_temp.eq(public.no_spawn_zone_type('private estate', null), 'estate', 'type of reason private estate');
  perform pg_temp.eq(public.no_spawn_zone_type('closed for a private event', null), 'staff', 'an unknown reason is a staff zone');
  perform pg_temp.eq(public.no_spawn_zone_type(null, null), 'staff', 'no reason is a staff zone');
  perform pg_temp.eq(public.no_spawn_zone_type('', 'derived/sea'), 'water', 'the sea is water by its source_ref');
  perform pg_temp.eq(public.no_spawn_zone_type('', 'lagos-core/harbour-mouth'), 'water', 'the harbour mouth is water by its source_ref');
  -- inserted without a type: filled in
  insert into public.no_spawn_zones (name, reason, geog, source) values ('ZZ typed a', 'power plant', pg_temp.pt(6.33, 4.40), 'staff') returning id into z;
  perform pg_temp.eq((select zone_type from public.no_spawn_zones where id = z), 'power', 'a new zone gets its type');
  insert into public.no_spawn_zones (name, reason, geog, source, source_ref) values ('ZZ typed b', 'Cordoned off', pg_temp.pt(6.33, 4.41), 'staff', 'zz/b') returning id into z;
  perform pg_temp.eq((select zone_type from public.no_spawn_zones where id = z), 'staff', 'a hand-made zone is staff');
  -- given a type: kept, whatever the reason says
  insert into public.no_spawn_zones (name, reason, geog, source, zone_type) values ('ZZ typed c', 'a creek', pg_temp.pt(6.33, 4.42), 'staff', 'water') returning id into z;
  perform pg_temp.eq((select zone_type from public.no_spawn_zones where id = z), 'water', 'a given type is kept');
  -- add_no_spawn_zone still works and types its zone from the reason
  z := public.add_no_spawn_zone('ZZ typed d', 'military', 6.33, 4.43, 100);
  perform pg_temp.eq((select zone_type from public.no_spawn_zones where id = z), 'military', 'add_no_spawn_zone zones are typed');
  -- the type must be one of the nine
  begin
    insert into public.no_spawn_zones (name, reason, geog, source, zone_type) values ('ZZ typed e', 'x', pg_temp.pt(6.33, 4.44), 'staff', 'lake');
    raise exception 'TEST FAILED: zone type lake accepted';
  exception when check_violation then null; end;
  raise notice 'ok: zone types';
end $t$;

-- The guard, edge by edge.
do $t$
declare
  v_water uuid; v_base uuid; v_hand uuid; v_ev uuid; v_drop uuid;
  w_in geography := pg_temp.pt(6.325, 4.50);                   -- in the water
  w_edge geography := pg_temp.pt(6.325, 4.60);                 -- exactly on the water's edge
  land geography := pg_temp.pt(6.325, 4.65);                   -- dry land, nothing near
  base_in geography := pg_temp.pt(6.325, 4.80);                -- centre of a military circle
  hand_in geography := pg_temp.pt(6.325, 4.90);                -- centre of a hand-made circle
  k text;
begin
  insert into public.no_spawn_zones (name, reason, geog, source)
  values ('ZZ guard water', 'water', st_geogfromtext('SRID=4326;POLYGON((4.40 6.30,4.60 6.30,4.60 6.35,4.40 6.35,4.40 6.30))'), 'staff') returning id into v_water;
  v_base := public.add_no_spawn_zone('ZZ guard base', 'military', 6.325, 4.80, 300);
  v_hand := public.add_no_spawn_zone('ZZ guard hand', 'closed for a private event', 6.325, 4.90, 200);
  perform pg_temp.eq((select zone_type from public.no_spawn_zones where id = v_water), 'water', 'premise: the test sea is water');

  -- water: no box of any kind, plain message, check_violation
  foreach k in array array['staff', 'spawn', 'welcome'] loop
    perform pg_temp.eq(pg_temp.try_drop(w_in, k), pg_temp.water_msg(), k || ' drop in the water');
    perform pg_temp.eq(pg_temp.try_drop(w_edge, k), pg_temp.water_msg(), k || ' drop on the water edge');
    perform pg_temp.eq(pg_temp.try_drop(land, k), 'ok', k || ' drop on land');
  end loop;

  -- other zones: staff drops may go there, street and welcome boxes may not
  perform pg_temp.eq(pg_temp.try_drop(base_in, 'staff'), 'ok', 'a staff drop in a military zone is allowed');
  perform pg_temp.eq(pg_temp.try_drop(hand_in, 'staff'), 'ok', 'a staff drop in a hand-made zone is allowed');
  foreach k in array array['spawn', 'welcome'] loop
    perform pg_temp.ok(pg_temp.try_drop(base_in, k) = '23514 That spot is in a no-box area (ZZ guard base). Pick another spot.', k || ' box in a military zone: ' || pg_temp.try_drop(base_in, k));
    perform pg_temp.ok(pg_temp.try_drop(hand_in, k) = '23514 That spot is in a no-box area (ZZ guard hand). Pick another spot.', k || ' box in a hand-made zone');
  end loop;

  -- a zone switched off guards nothing; switched on again it does
  update public.no_spawn_zones set active = false where id in (v_water, v_base, v_hand);
  perform pg_temp.eq(pg_temp.try_drop(w_in, 'staff'), 'ok', 'a staff drop in a switched-off water zone');
  perform pg_temp.eq(pg_temp.try_drop(w_in, 'spawn'), 'ok', 'a street box in a switched-off water zone');
  perform pg_temp.eq(pg_temp.try_drop(base_in, 'welcome'), 'ok', 'a welcome box in a switched-off military zone');
  update public.no_spawn_zones set active = true where id in (v_water, v_base, v_hand);
  perform pg_temp.eq(pg_temp.try_drop(w_in, 'staff'), pg_temp.water_msg(), 'the water zone guards again once back on');

  -- an event drop without its own point: untouched, event in the water or not
  insert into public.events (title, venue_name, geog, starts_at, status) values ('ZZ guard event', 'ZZ guard venue', w_in, now(), 'live') returning id into v_ev;
  perform pg_temp.eq(pg_temp.try_drop(null, 'staff', v_ev), 'ok', 'an event drop without a point is fine');

  -- updates: moving a drop into the water or changing its kind is checked
  v_drop := (select id from public.game_drops where title = 'ZZ guard test' and geog is not null and st_dwithin(geog, land, 1) and kind = 'staff' limit 1);
  perform pg_temp.ok(v_drop is not null, 'premise: a staff drop on land to move');
  begin update public.game_drops set geog = w_in where id = v_drop; raise exception 'TEST FAILED: drop moved into the water';
  exception when check_violation then if sqlerrm <> 'That spot is in the water. Pick a spot on land.' then raise; end if; end;
  update public.game_drops set geog = pg_temp.pt(6.325, 4.66) where id = v_drop;     -- a move on land is fine
  update public.game_drops set kind = 'spawn' where id = v_drop;                      -- still clear of every zone
  begin update public.game_drops set geog = base_in where id = v_drop; raise exception 'TEST FAILED: street box moved into a military zone';
  exception when check_violation then if sqlerrm not like 'That spot is in a no-box area%' then raise; end if; end;
  v_drop := (select id from public.game_drops where title = 'ZZ guard test' and st_dwithin(geog, base_in, 1) and kind = 'staff' limit 1);
  begin update public.game_drops set kind = 'spawn' where id = v_drop; raise exception 'TEST FAILED: staff drop in a military zone became a street box';
  exception when check_violation then if sqlerrm not like 'That spot is in a no-box area%' then raise; end if; end;

  -- a drop that was already in the water (made before the guard) can still be claimed, closed and renamed
  alter table public.game_drops disable trigger game_drops_guard;
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, reward_model, kind)
  values ('ZZ old water drop', w_in, now() - interval '1 minute', now() + interval '1 hour', 80, 'proximity', 'fixed', 'staff') returning id into v_drop;
  alter table public.game_drops enable trigger game_drops_guard;
  update public.game_drops set claimed_count = claimed_count + 1 where id = v_drop;
  update public.game_drops set title = 'ZZ old water drop, renamed', active = false, closes_at = now() + interval '2 hours' where id = v_drop;
  perform pg_temp.eq((select claimed_count::text || title from public.game_drops where id = v_drop), '1ZZ old water drop, renamed', 'an old water drop can still be changed');
  raise notice 'ok: the guard edge by edge';
end $t$;

-- Spawn spots at the water: 40 m, on insert and on move, beaches too.
do $t$
declare
  edge geography := pg_temp.pt(6.325, 4.60);
  s30 uuid; s60 uuid; sbeach uuid; sbeach_sand uuid; smove uuid; sstaff uuid;
begin
  -- the test water from the previous block is still there: one transaction
  perform pg_temp.ok(exists (select 1 from public.no_spawn_zones where name = 'ZZ guard water' and zone_type = 'water' and active), 'premise: the test water is there');
  insert into public.spawn_points (name, kind, geog) values ('ZZ spot 30 m', 'street', pg_temp.off(edge, 30, 90)) returning id into s30;
  insert into public.spawn_points (name, kind, geog) values ('ZZ spot 60 m', 'street', pg_temp.off(edge, 60, 90)) returning id into s60;
  insert into public.spawn_points (name, kind, geog) values ('ZZ beach on the waterline', 'beach', pg_temp.off(edge, 5, 90)) returning id into sbeach;
  insert into public.spawn_points (name, kind, geog) values ('ZZ beach on the sand', 'beach', pg_temp.off(edge, 150, 90)) returning id into sbeach_sand;
  perform pg_temp.eq((select active::text from public.spawn_points where id = s30), 'false', 'a spot 30 m from the water is off');
  perform pg_temp.eq((select active::text from public.spawn_points where id = s60), 'true', 'a spot 60 m from the water stays on');
  perform pg_temp.eq((select active::text from public.spawn_points where id = sbeach), 'false', 'a beach on the waterline is off');
  perform pg_temp.eq((select active::text from public.spawn_points where id = sbeach_sand), 'true', 'a beach on the sand stays on');
  -- a spot inserted already off stays off, and moving a spot to the waterline switches it off
  insert into public.spawn_points (name, kind, geog, active) values ('ZZ spot off', 'street', pg_temp.off(edge, 300, 90), false) returning id into smove;
  perform pg_temp.eq((select active::text from public.spawn_points where id = smove), 'false', 'a spot made off stays off');
  update public.spawn_points set active = true where id = smove;                       -- staff switch it on: allowed
  perform pg_temp.eq((select active::text from public.spawn_points where id = smove), 'true', 'staff can switch a spot on');
  update public.spawn_points set geog = pg_temp.off(edge, 20, 90) where id = smove;    -- moved to the waterline
  perform pg_temp.eq((select active::text from public.spawn_points where id = smove), 'false', 'a spot moved to the waterline goes off');
  -- a staff switch-on of a spot near water survives an unrelated edit
  update public.spawn_points set active = true where id = s30;
  update public.spawn_points set weight = 3 where id = s30;
  perform pg_temp.eq((select active::text from public.spawn_points where id = s30), 'true', 'a staff switch-on survives an edit that does not move the spot');
  -- a switched-off water zone does not count
  update public.no_spawn_zones set active = false where name = 'ZZ guard water';
  insert into public.spawn_points (name, kind, geog) values ('ZZ spot by dry zone', 'street', pg_temp.off(edge, 10, 90)) returning id into sstaff;
  perform pg_temp.eq((select active::text from public.spawn_points where id = sstaff), 'true', 'a switched-off water zone does not switch spots off');
  update public.no_spawn_zones set active = true where name = 'ZZ guard water';
  raise notice 'ok: spawn spots by the water';
end $t$;

-- Nobody but the service role can run the guard functions.
do $t$
declare f text;
begin
  foreach f in array array['public.game_drops_guard_geog()', 'public.spawn_points_keep_off_water()', 'public.no_spawn_zones_fill_type()', 'public.no_spawn_zone_type(text,text)'] loop
    perform pg_temp.ok(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), f || ' is not open to the browser');
    perform pg_temp.ok(has_function_privilege('service_role', f, 'execute'), f || ' is open to the service role');
  end loop;
  raise notice 'ok: privileges';
end $t$;

do $t$ begin raise notice 'ALL BOX GUARD TESTS PASSED'; end $t$;

rollback;
