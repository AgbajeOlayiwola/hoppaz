-- ============================================================================
-- Hoppaz: hotspot zone tests
-- Run against a LOCAL database that already has schema.sql and spawning.sql
-- applied (the areas, no_spawn_zones and spawn_points tables). psql reads
-- hotspot_zones.sql from inside the database container, so copy the SQL files in
-- first, then run this file (the folder is a psql variable, default below):
--   docker cp supabase/. supabase_db_hoppaz-local:/tmp/hoppaz-sql
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/hotspot_zones_test.sql
-- (add  -v sqldir=/some/other/folder  to read the files from somewhere else)
--
-- One transaction that always rolls back, so nothing is kept. It runs
-- hotspot_zones.sql first (twice, which also proves it can be run again), then
-- checks the zones:
--   * 10 to 14 first zones, each with one hotspot, and the shapes are valid
--   * zones do not overlap
--   * every hotspot is inside its own zone and in no other
--   * no hotspot (and no split junction) is in a no-spawn zone, near water or
--     near a military, prison, port or airport zone
--   * no zone holds land on both sides of the lagoon (a table of 35 well-known
--     places, each on land of one side, is checked against the zones)
--   * together the zones cover the 16 area centres, each on its own side, and
--     every spawn point that lies inside Lagos State
--   * every zone has a split hint: a cut, and two junctions inside the zone
--   * the table is read-only for the app: anon and signed-in Hoppers read only
--     the active and planned rows, and cannot write
--   * Jae's three calls of 10 Oct 2026 are in: Mile 2 (Lagos-Badagry Expressway x
--     Jakande Estate Road), Bourdillon in Ikoyi kept, Ikorodu Garage (the trunk
--     roundabout after the Agric bus stops); those three names, and only those, are
--     confirmed; a split child that keeps its parent's junction has the same point
--   * a run again keeps the status and the confirmed flag that staff set
-- Every check raises an exception on failure; the last line printed is
-- ALL HOTSPOT ZONE TESTS PASSED.
-- ============================================================================
\if :{?sqldir}
\else
  \set sqldir /tmp/hoppaz-sql
\endif

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

create function pg_temp.as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $f$;

create function pg_temp.as_user() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- ---------------------------------------------------------- load the file ---
\echo running hotspot_zones.sql (1)
\i :sqldir/hotspot_zones.sql
\echo running hotspot_zones.sql (2)
\i :sqldir/hotspot_zones.sql

-- Well-known places, each on land of one side of the lagoon, with the zone each
-- one is in. (scripts/hotspots/zones.mjs checks the same list against OpenStreetMap
-- land when it builds the zones.)
create table pg_temp.places (name text, lat double precision, lng double precision, side text, zone text);
insert into pg_temp.places values
  ('Tafawa Balewa Square', 6.4448, 3.4016, 'island', 'lagos-island'),
  ('Campbell Street and Broad Street', 6.4471, 3.3985, 'island', 'lagos-island'),
  ('Falomo Roundabout', 6.4445, 3.4273, 'island', 'ikoyi'),
  ('Alexander Roundabout', 6.4497, 3.4492, 'island', 'ikoyi'),
  ('Akin Adesola Street, Victoria Island', 6.4292, 3.4239, 'island', 'victoria-island'),
  ('Oniru', 6.4357, 3.4426, 'island', 'victoria-island'),
  ('Admiralty Way, Lekki Phase 1', 6.4479, 3.4702, 'island', 'lekki'),
  ('Ikate', 6.4367, 3.5078, 'island', 'lekki'),
  ('Ajah', 6.4656, 3.5616, 'island', 'ajah'),
  ('Lagos-Calabar Coastal Highway at Eleko', 6.4424, 3.8542, 'island', 'ajah'),
  ('Allen Avenue, Ikeja', 6.6072, 3.3492, 'mainland', 'ikeja'),
  ('Computer Village', 6.5959, 3.3425, 'mainland', 'ikeja'),
  ('Agege', 6.6200, 3.3200, 'mainland', 'ikeja'),
  ('Ogba', 6.6330, 3.3400, 'mainland', 'ikeja'),
  ('Ketu', 6.5934, 3.3926, 'mainland', 'ojota'),
  ('Gbagada', 6.5530, 3.3905, 'mainland', 'ojota'),
  ('Magodo', 6.6160, 3.3830, 'mainland', 'ojota'),
  ('Yaba market', 6.5058, 3.3734, 'mainland', 'yaba'),
  ('Shomolu', 6.5400, 3.3830, 'mainland', 'yaba'),
  ('UNILAG, Akoka', 6.5177, 3.3845, 'mainland', 'yaba'),
  ('Ojuelegba', 6.5101, 3.3632, 'mainland', 'surulere'),
  ('Adeniran Ogunsanya Street, Surulere', 6.5000, 3.3560, 'mainland', 'surulere'),
  ('Mushin', 6.5270, 3.3450, 'mainland', 'surulere'),
  ('Oshodi', 6.5560, 3.3490, 'mainland', 'surulere'),
  ('Isolo', 6.5360, 3.3190, 'mainland', 'surulere'),
  ('Apapa', 6.4480, 3.3630, 'mainland', 'festac'),
  ('Mile 2', 6.4640, 3.3040, 'mainland', 'festac'),
  ('Festac Town', 6.4660, 3.2860, 'mainland', 'festac'),
  ('Egbeda', 6.5870, 3.2970, 'mainland', 'alimosho'),
  ('Ikotun', 6.5500, 3.2500, 'mainland', 'alimosho'),
  ('Iyana Ipaja', 6.6100, 3.2650, 'mainland', 'alimosho'),
  ('Alaba', 6.4680, 3.1930, 'mainland', 'ojo-badagry'),
  ('Badagry', 6.4150, 2.8840, 'mainland', 'ojo-badagry'),
  ('Ikorodu', 6.6190, 3.5060, 'mainland', 'ikorodu'),
  ('Epe', 6.5840, 3.9790, 'mainland', 'ikorodu');

-- ------------------------------------------------- shape of the table ---
do $t$
declare n integer; r record;
begin
  n := (select count(*) from public.hotspots where parent_id is null);
  perform pg_temp.ok(n between 10 and 14, format('10 to 14 first zones, found %s', n));
  perform pg_temp.eq((select count(*) from public.hotspots)::text, n::text, 'only the first zones are in the table so far');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where parent_id is not null), 'first zones have no parent');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where status <> 'planned'), 'every zone starts planned');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where side not in ('mainland', 'island')), 'side is mainland or island');
  perform pg_temp.ok(exists (select 1 from public.hotspots where side = 'island') and exists (select 1 from public.hotspots where side = 'mainland'), 'both sides have zones');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where name = '' or junction = '' or road_a = '' or road_b = '' or road_a = road_b), 'every zone has a name, a junction and two different roads');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where wave not between 1 and 4), 'waves are 1 to 4');
  perform pg_temp.ok(exists (select 1 from public.hotspots where wave = 1), 'there is a first wave');
  perform pg_temp.eq((select string_agg(slug, ',' order by slug) from public.hotspots where name_confirmed), 'festac,ikorodu,ikoyi',
    'only the three names Jae confirmed on 10 Oct 2026 (Mile 2, Bourdillon, Ikorodu Garage) are marked confirmed');
  -- shapes
  perform pg_temp.ok(not exists (select 1 from public.hotspots where not st_isvalid(zone_geom)), 'every zone shape is valid');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where st_srid(zone_geom) <> 4326 or st_srid(geom) <> 4326), 'SRID 4326 everywhere');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where geometrytype(zone_geom) <> 'MULTIPOLYGON' or geometrytype(geom) <> 'POINT'), 'a point and a multipolygon');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where abs(st_y(geom) - lat) > 1e-9 or abs(st_x(geom) - lng) > 1e-9), 'geom is made from lat and lng');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where not st_within(zone_geom, st_makeenvelope(2.6, 6.2, 4.5, 6.8, 4326))), 'zones lie inside the box of Lagos State');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where area_km2 < 1 or land_km2 < 1 or land_km2 > area_km2 + 0.1), 'areas are filled in and land is not more than the shape');
  -- the stored area is the real area of the shape
  for r in select slug, area_km2, st_area(st_transform(zone_geom, 32631)) / 1e6 as real_km2 from public.hotspots loop
    perform pg_temp.ok(abs(r.area_km2 - r.real_km2) <= greatest(0.2, r.real_km2 * 0.01), format('area_km2 of %s is %s but the shape is %s', r.slug, r.area_km2, round(r.real_km2::numeric, 1)));
  end loop;
  raise notice 'ok: % first zones, shapes and fields', n;
end $t$;

-- ------------------------------------ Jae's three calls of 10 Oct 2026 ---
do $t$
declare h record; kid jsonb;
begin
  -- Mile 2 is the Lagos-Badagry Expressway crossing with Jakande Estate Road (6.46019, 3.30985), not the Festac 1st Avenue crossing
  select * into h from public.hotspots where slug = 'festac';
  perform pg_temp.eq(h.junction, 'Mile 2', 'the Festac and Apapa hotspot is called Mile 2');
  perform pg_temp.eq(h.road_a || ' x ' || h.road_b, 'Lagos-Badagry Expressway x Jakande Estate Road', 'Mile 2 is the Expressway with Jakande Estate Road');
  perform pg_temp.ok(st_distance(h.geom::geography, st_setsrid(st_makepoint(3.30985, 6.46019), 4326)::geography) <= 60, 'Mile 2 is at the Jakande Estate Road crossing');
  -- Ikoyi keeps Bourdillon Road x Alexander Avenue
  select * into h from public.hotspots where slug = 'ikoyi';
  perform pg_temp.eq(h.junction, 'Bourdillon (Alexander Avenue)', 'the Ikoyi hotspot is still Bourdillon');
  perform pg_temp.eq(h.road_a || ' x ' || h.road_b, 'Bourdillon Road x Alexander Avenue', 'Bourdillon is Bourdillon Road with Alexander Avenue');
  -- Ikorodu Garage is the next big junction after the Agric bus stops (6.6254, 3.4840 to 3.4878), coming from Lagos on Ikorodu Road:
  -- east of Agric, on Ikorodu Road, 1 to 2.5 km on, at the roundabout where it ends (180 m from OSM's Ikorodu Bus Terminal at 6.62118, 3.50199)
  select * into h from public.hotspots where slug = 'ikorodu';
  perform pg_temp.eq(h.junction, 'Ikorodu Garage', 'the Ikorodu and Epe hotspot is called Ikorodu Garage');
  perform pg_temp.eq(h.road_a || ' x ' || h.road_b, 'Ikorodu Road x Ayangburen Road', 'Ikorodu Garage is Ikorodu Road with Ayangburen Road');
  perform pg_temp.ok(h.lng > 3.4878, 'Ikorodu Garage is east of the Agric bus stops, towards the town');
  perform pg_temp.ok(st_distance(h.geom::geography, st_setsrid(st_makepoint(3.4878, 6.62533), 4326)::geography) between 1000 and 2500, 'Ikorodu Garage is 1 to 2.5 km past the Agric bus stops');
  perform pg_temp.ok(st_distance(h.geom::geography, st_setsrid(st_makepoint(3.50199, 6.62118), 4326)::geography) <= 250, 'Ikorodu Garage is by the Ikorodu Bus Terminal');
  -- the split child that keeps the parent's junction has the same point and roads (Mile 2 and Ikorodu Garage moved; the children moved with them)
  for h in select slug, lat, lng, road_a, road_b, junction, split_hint from public.hotspots where slug in ('festac', 'ikorodu') loop
    kid := h.split_hint->'children'->0;
    perform pg_temp.ok((kid->>'lat')::float8 = h.lat and (kid->>'lng')::float8 = h.lng and kid->>'junction' = h.junction
      and kid->>'road_a' = h.road_a and kid->>'road_b' = h.road_b, format('%s: the first split child keeps the parent junction', h.slug));
  end loop;
  raise notice 'ok: Mile 2, Bourdillon and Ikorodu Garage are where Jae put them (10 Oct 2026)';
end $t$;

-- ------------------------------------------------ zones do not overlap ---
do $t$
declare r record; worst double precision := 0; total double precision; merged double precision;
begin
  for r in
    select a.slug as a, b.slug as b, st_area(st_transform(st_intersection(a.zone_geom, b.zone_geom), 32631)) as m2
    from public.hotspots a join public.hotspots b on a.slug < b.slug and a.zone_geom && b.zone_geom
  loop
    worst := greatest(worst, r.m2);
    perform pg_temp.ok(r.m2 <= 1000, format('zones %s and %s overlap by %s m2', r.a, r.b, round(r.m2::numeric)));
  end loop;
  select sum(st_area(st_transform(zone_geom, 32631))), st_area(st_transform(st_union(zone_geom), 32631)) into total, merged from public.hotspots;
  perform pg_temp.ok(total - merged <= 5000, format('the zones add up to %s m2 but their union is %s m2', round(total::numeric), round(merged::numeric)));
  raise notice 'ok: no two zones overlap (worst pair % m2)', round(worst::numeric);
end $t$;

-- ----------------------------- every hotspot is inside its own zone only ---
do $t$
declare r record;
begin
  for r in select slug, geom, zone_geom from public.hotspots loop
    perform pg_temp.ok(st_covers(r.zone_geom, r.geom), format('the hotspot of %s is outside its zone', r.slug));
    perform pg_temp.eq((select count(*) from public.hotspots h where st_covers(h.zone_geom, r.geom))::text, '1', format('the hotspot of %s is in more than one zone', r.slug));
    -- not at the very edge of the zone (a hotspot a few metres from the line would confuse people)
    perform pg_temp.ok(st_distance(st_transform(r.geom, 32631), st_transform(st_boundary(r.zone_geom), 32631)) >= 100, format('the hotspot of %s is within 100 m of the zone edge', r.slug));
  end loop;
  raise notice 'ok: every hotspot is inside its own zone and no other';
end $t$;

-- ---------------------------------------- hotspots and the no-spawn zones ---
do $t$
declare r record; n integer := 0;
begin
  if not exists (select 1 from public.no_spawn_zones) then
    raise notice 'skipped: no_spawn_zones is empty here';
    return;
  end if;
  -- the hotspot, and both split junctions, as points to test
  for r in
    select h.slug, 'hotspot' as what, h.geom::geography as g from public.hotspots h
    union all
    select h.slug, 'split junction ' || (c->>'junction'), st_setsrid(st_makepoint((c->>'lng')::float8, (c->>'lat')::float8), 4326)::geography
    from public.hotspots h, jsonb_array_elements(h.split_hint->'children') c
  loop
    n := n + 1;
    perform pg_temp.ok(not exists (select 1 from public.no_spawn_zones z where z.active and st_intersects(z.geog, r.g)), format('%s of %s is inside a no-spawn zone', r.what, r.slug));
    perform pg_temp.ok(not exists (select 1 from public.no_spawn_zones z where z.active and z.zone_type = 'water' and st_dwithin(z.geog, r.g, 60)), format('%s of %s is within 60 m of water', r.what, r.slug));
    perform pg_temp.ok(not exists (select 1 from public.no_spawn_zones z where z.active and z.zone_type in ('military', 'prison', 'port', 'airport') and st_dwithin(z.geog, r.g, 100)), format('%s of %s is within 100 m of a military, prison, port or airport zone', r.what, r.slug));
  end loop;
  raise notice 'ok: % junctions are outside every no-spawn zone, 60 m from water, 100 m from military, prison, port and airport zones', n;
end $t$;

-- ------------------------------ no zone holds land on both sides of the lagoon ---
do $t$
declare r record;
begin
  -- every well-known place is in the zone expected, and that zone is on its side
  for r in select p.*, (select h.slug from public.hotspots h where st_covers(h.zone_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326))) as got,
                  (select h.side from public.hotspots h where st_covers(h.zone_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326))) as got_side
           from pg_temp.places p loop
    perform pg_temp.eq(r.got, r.zone, format('%s should be in zone %s', r.name, r.zone));
    perform pg_temp.eq(r.got_side, r.side, format('%s is on %s land but its zone is %s', r.name, r.side, r.got_side));
  end loop;
  -- so a zone never holds places from both sides, and each side is what the row says
  perform pg_temp.ok(not exists (
    select 1 from public.hotspots h join pg_temp.places p on st_covers(h.zone_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326))
    group by h.slug having count(distinct p.side) > 1), 'a zone holds places from both mainland and island');
  perform pg_temp.ok(not exists (
    select 1 from public.hotspots h join pg_temp.places p on st_covers(h.zone_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326)) where p.side <> h.side),
    'a zone holds a place from the other side');
  -- every zone holds at least one of the places (so each is proven)
  perform pg_temp.ok(not exists (select 1 from public.hotspots h where not exists (
    select 1 from pg_temp.places p where st_covers(h.zone_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326)))), 'a zone holds none of the well-known places');
  -- the waterways between the sides lie outside the zones' land: the two island
  -- landmasses of Lagos Island and Ikoyi and of Victoria Island are cut apart by Five Cowries Creek
  perform pg_temp.ok((select h.slug from public.hotspots h where st_covers(h.zone_geom, st_setsrid(st_makepoint(3.4273, 6.4445), 4326))) <>
                     (select h.slug from public.hotspots h where st_covers(h.zone_geom, st_setsrid(st_makepoint(3.4239, 6.4292), 4326))),
                     'Ikoyi and Victoria Island are not one zone');
  raise notice 'ok: no zone holds land on both sides of the lagoon (% places)', (select count(*) from pg_temp.places);
end $t$;

-- ----------------------------------------- the 16 area centres are covered ---
do $t$
declare r record; n integer := 0;
begin
  if not exists (select 1 from public.areas) then
    raise notice 'skipped: areas is empty here';
    return;
  end if;
  for r in select a.name, a.side, (select count(*) from public.hotspots h where st_covers(h.zone_geom, a.centroid::geometry)) as zones,
                  (select h.side from public.hotspots h where st_covers(h.zone_geom, a.centroid::geometry) limit 1) as zone_side
           from public.areas a loop
    n := n + 1;
    perform pg_temp.eq(r.zones::text, '1', format('the centre of %s should be in exactly one zone', r.name));
    perform pg_temp.eq(r.zone_side, r.side, format('the centre of %s is on %s land but its zone is %s', r.name, r.side, r.zone_side));
  end loop;
  perform pg_temp.ok(n >= 16, format('16 area centres expected, found %s', n));
  raise notice 'ok: the zones cover all % area centres, each in one zone on its own side', n;
end $t$;

-- --------------------------- every spawn point inside Lagos State is in a zone ---
-- The outline of Lagos State (OpenStreetMap, simplified to about 55 m; made by
-- node scripts/hotspots/zones.mjs --state-wkt). The spawn point importer also
-- caught some places over the line in Ogun State (Ota, Sango, Ogijo, Agbara);
-- those are not in a zone and need not be. A point more than 150 m inside the
-- state must be.
create table pg_temp.state (g geometry);
insert into pg_temp.state values (st_geomfromtext('MULTIPOLYGON(((3.1039 6.4995,3.1005 6.4995,3.0959 6.4978,3.0883 6.4993,3.0739 6.4982,3.0632 6.4995,3.0503 6.4992,3.0476 6.4982,3.0283 6.4981,3.0157 6.5001,2.9911 6.5009,2.9868 6.5026,2.9765 6.5010,2.9635 6.5018,2.9525 6.5013,2.9486 6.5003,2.9243 6.5026,2.9202 6.5012,2.9142 6.5039,2.9094 6.5044,2.9066 6.5039,2.9035 6.5015,2.8980 6.5026,2.8929 6.5019,2.8969 6.4950,2.8973 6.4877,2.8937 6.4801,2.8900 6.4761,2.8806 6.4699,2.8693 6.4717,2.8671 6.4713,2.8602 6.4677,2.8584 6.4600,2.8565 6.4578,2.8554 6.4535,2.8532 6.4499,2.8428 6.4440,2.8305 6.4424,2.8199 6.4513,2.8072 6.4567,2.8015 6.4583,2.7984 6.4584,2.7939 6.4573,2.7836 6.4508,2.7758 6.4484,2.7575 6.4474,2.7457 6.4478,2.7422 6.4489,2.7361 6.4546,2.7309 6.4567,2.7246 6.4576,2.7166 6.4570,2.7067 6.4514,2.7060 6.4213,2.7070 6.3726,2.7352 6.3761,2.7552 6.3801,2.7716 6.3823,2.7894 6.3834,2.8123 6.3874,2.8360 6.3889,2.8505 6.3918,2.9010 6.3936,2.9232 6.3936,2.9701 6.3961,3.0232 6.3947,3.0690 6.3966,3.0727 6.3994,3.0769 6.3968,3.0952 6.3972,3.1137 6.3987,3.1508 6.3987,3.2023 6.4008,3.3105 6.4000,3.3360 6.3982,3.3676 6.3946,3.3803 6.3923,3.3934 6.3913,3.3971 6.3902,3.4040 6.3901,3.4028 6.3944,3.4249 6.4055,3.4312 6.4077,3.4447 6.4094,3.5350 6.4125,3.6942 6.4197,3.7475 6.4267,3.8453 6.4261,3.9911 6.4214,4.0510 6.4131,4.1810 6.3889,4.2435 6.3804,4.3225 6.3722,4.3509 6.3667,4.3508 6.4276,4.3501 6.4299,4.3446 6.4338,4.3434 6.4358,4.3372 6.4395,4.3327 6.4395,4.3241 6.4378,4.3039 6.4395,4.3019 6.4388,4.2987 6.4352,4.2956 6.4346,4.2911 6.4366,4.2876 6.4360,4.2840 6.4368,4.2813 6.4388,4.2790 6.4379,4.2763 6.4396,4.2751 6.4419,4.2724 6.4428,4.2684 6.4425,4.2638 6.4436,4.2543 6.4413,4.2533 6.4390,4.2540 6.4362,4.2533 6.4343,4.2500 6.4338,4.2453 6.4345,4.2434 6.4362,4.2369 6.4382,4.2374 6.4419,4.2357 6.4448,4.2334 6.4455,4.2280 6.4448,4.2258 6.4456,4.2218 6.4505,4.2173 6.4631,4.2134 6.4645,4.2078 6.4642,4.2035 6.4619,4.2005 6.4632,4.1937 6.4632,4.1922 6.4655,4.1774 6.4701,4.1720 6.4736,4.1611 6.4747,4.1594 6.4872,4.1550 6.4966,4.1562 6.4988,4.1677 6.5036,4.1740 6.5087,4.1783 6.5151,4.1918 6.5190,4.2061 6.5253,4.2111 6.5281,4.2144 6.5319,4.2223 6.5377,4.2276 6.5516,4.2265 6.5536,4.2287 6.5576,4.2254 6.5612,4.2231 6.5620,4.2220 6.5654,4.2180 6.5697,4.2153 6.5777,4.2127 6.5786,4.2118 6.5817,4.1996 6.5885,4.1988 6.5858,4.1867 6.5849,4.1796 6.5864,4.1783 6.5887,4.1663 6.5934,4.1622 6.5922,4.1556 6.5868,4.1502 6.5804,4.1430 6.5751,4.1383 6.5728,4.1289 6.5710,4.1222 6.5663,4.1164 6.5634,4.1106 6.5583,4.1095 6.5523,4.1095 6.5469,4.1030 6.5459,4.0947 6.5460,4.0936 6.5493,4.0954 6.5507,4.0920 6.5553,4.0906 6.5618,4.0886 6.5626,4.0861 6.5588,4.0834 6.5590,4.0744 6.5623,4.0682 6.5636,4.0649 6.5624,4.0654 6.5667,4.0671 6.5695,4.0649 6.5806,4.0632 6.5827,4.0593 6.5943,4.0575 6.5964,4.0576 6.5995,4.0559 6.6036,4.0565 6.6111,4.0514 6.6160,4.0505 6.6192,4.0538 6.6210,4.0566 6.6247,4.0586 6.6299,4.0579 6.6339,4.0588 6.6360,4.0616 6.6367,4.0643 6.6361,4.0684 6.6332,4.0704 6.6332,4.0767 6.6371,4.0815 6.6376,4.0845 6.6398,4.0854 6.6428,4.0880 6.6448,4.0915 6.6526,4.0952 6.6515,4.0926 6.6565,4.0933 6.6587,4.0919 6.6603,4.0904 6.6661,4.0943 6.6707,4.0928 6.6725,4.0913 6.6770,4.0915 6.6790,4.0502 6.6800,3.9728 6.6797,3.7079 6.6830,3.6999 6.6838,3.4611 6.6855,3.4616 6.6787,3.4642 6.6760,3.4631 6.6733,3.4636 6.6721,3.4615 6.6690,3.4583 6.6694,3.4512 6.6724,3.4488 6.6752,3.4477 6.6720,3.4447 6.6697,3.4436 6.6673,3.4526 6.6523,3.4543 6.6445,3.4577 6.6394,3.4483 6.6406,3.4344 6.6373,3.3767 6.6385,3.3706 6.6391,3.3692 6.6399,3.3691 6.6429,3.3678 6.6431,3.3670 6.6461,3.3640 6.6492,3.3579 6.6519,3.3537 6.6588,3.3451 6.6651,3.3360 6.6682,3.3217 6.6665,3.3171 6.6673,3.3154 6.6667,3.3095 6.6717,3.2912 6.6790,3.2883 6.6817,3.2845 6.6813,3.2685 6.6916,3.2666 6.6955,3.2650 6.6968,3.2629 6.6966,3.2601 6.6944,3.2595 6.6905,3.2417 6.6599,3.2388 6.6401,3.2392 6.6308,3.2414 6.6287,3.2399 6.6161,3.2374 6.6142,3.2332 6.6059,3.2288 6.6020,3.2160 6.5951,3.2074 6.5884,3.1993 6.5804,3.1968 6.5762,3.1963 6.5707,3.1973 6.5664,3.2007 6.5592,3.2016 6.5522,3.2038 6.5472,3.2047 6.5425,3.2049 6.5332,3.2038 6.5296,3.2000 6.5277,3.1971 6.5249,3.1912 6.5229,3.1866 6.5191,3.1795 6.5098,3.1711 6.5094,3.1570 6.5049,3.1555 6.5021,3.1476 6.5030,3.1436 6.5045,3.1362 6.5033,3.1302 6.5007,3.1237 6.5008,3.1217 6.5001,3.1184 6.5011,3.1114 6.5012,3.1039 6.4995)))', 4326));

do $t$
declare n integer; inside integer; bad integer; names text;
begin
  select count(*) into n from public.spawn_points;
  if n = 0 then
    raise notice 'skipped: no spawn points here';
    return;
  end if;
  with sp as (
    select p.name, p.geog, st_covers(st_buffer(st_transform((select g from pg_temp.state), 32631), -150), st_transform(p.geog::geometry, 32631)) as in_state,
           exists (select 1 from public.hotspots h where st_covers(h.zone_geom, p.geog::geometry)) as in_zone
    from public.spawn_points p)
  select count(*) filter (where in_state), count(*) filter (where in_state and not in_zone),
         string_agg(name || ' ' || round(st_y(geog::geometry)::numeric, 4) || ',' || round(st_x(geog::geometry)::numeric, 4), '; ') filter (where in_state and not in_zone)
    into inside, bad, names from sp;
  perform pg_temp.ok(inside > 0, 'some spawn points are inside the state outline');
  perform pg_temp.eq(bad::text, '0', format('%s of %s spawn points inside Lagos State are in no zone: %s', bad, inside, names));
  raise notice 'ok: all % spawn points inside Lagos State are inside a zone (% over the line in Ogun State are not)', inside, n - inside;
end $t$;

-- --------------------------------------------------------- split hints ---
do $t$
declare r record; c jsonb; apart double precision; gap double precision;
begin
  for r in select slug, split_hint, zone_geom from public.hotspots loop
    perform pg_temp.eq(r.split_hint->'trigger'->>'peak_people', '60', format('%s: trigger peak 60', r.slug));
    perform pg_temp.eq(r.split_hint->'trigger'->>'days', '7', format('%s: trigger 7 days', r.slug));
    perform pg_temp.ok(r.split_hint->>'cut_kind' in ('line', 'lga'), format('%s: the cut is a straight line (along a road) or an LGA line', r.slug));
    perform pg_temp.ok(length(coalesce(r.split_hint->>'cut_along', '')) > 2, format('%s: the cut has a name', r.slug));
    perform pg_temp.eq(jsonb_array_length(r.split_hint->'children')::text, '2', format('%s: two children', r.slug));
    -- a line cut: north-south (ns, child 1 is west and child 2 east) or east-west (ew, north then south), and the
    -- two junctions lie on its two sides, at least 100 m from it. An LGA cut names the LGAs of each child.
    if r.split_hint->>'cut_kind' = 'line' then
      perform pg_temp.ok(r.split_hint->>'axis' in ('ns', 'ew'), format('%s: the line runs ns or ew', r.slug));
      perform pg_temp.ok((r.split_hint->>'at')::float8 between 2.6 and 4.5 or (r.split_hint->>'at')::float8 between 6.2 and 6.8, format('%s: the line has a position', r.slug));
      for k in 0..1 loop
        c := r.split_hint->'children'->k;
        if r.split_hint->>'axis' = 'ew' then
          gap := ((c->>'lat')::float8 - (r.split_hint->>'at')::float8) * 111000 * (case when k = 0 then 1 else -1 end);
        else
          gap := ((c->>'lng')::float8 - (r.split_hint->>'at')::float8) * 111000 * cos(radians(6.5)) * (case when k = 0 then -1 else 1 end);
        end if;
        perform pg_temp.ok(gap >= 100, format('%s: child %s is %s m on the wrong side of the cut line (it needs 100 m or more on its own side)', r.slug, k + 1, round(gap::numeric)));
      end loop;
    else
      perform pg_temp.ok(jsonb_array_length(r.split_hint->'lgas'->'a') >= 1 and jsonb_array_length(r.split_hint->'lgas'->'b') >= 1, format('%s: an LGA cut names the LGAs of both children', r.slug));
    end if;
    for c in select * from jsonb_array_elements(r.split_hint->'children') loop
      perform pg_temp.ok(length(coalesce(c->>'name', '')) > 1 and length(coalesce(c->>'junction', '')) > 1 and length(coalesce(c->>'road_a', '')) > 1 and length(coalesce(c->>'road_b', '')) > 1, format('%s: a child is missing a name, junction or road', r.slug));
      perform pg_temp.ok(c->>'road_a' <> c->>'road_b', format('%s: a child junction has one road twice', r.slug));
      perform pg_temp.ok(st_covers(r.zone_geom, st_setsrid(st_makepoint((c->>'lng')::float8, (c->>'lat')::float8), 4326)), format('%s: child junction %s is outside the zone', r.slug, c->>'junction'));
    end loop;
    apart := st_distance(
      st_setsrid(st_makepoint((r.split_hint->'children'->0->>'lng')::float8, (r.split_hint->'children'->0->>'lat')::float8), 4326)::geography,
      st_setsrid(st_makepoint((r.split_hint->'children'->1->>'lng')::float8, (r.split_hint->'children'->1->>'lat')::float8), 4326)::geography);
    perform pg_temp.ok(apart >= 800, format('%s: the two child junctions are only %s m apart (rooms are 800 m apart at least)', r.slug, round(apart::numeric)));
    perform pg_temp.ok(r.split_hint->'children'->0->>'slug' <> r.split_hint->'children'->1->>'slug', format('%s: the children need two slugs', r.slug));
    perform pg_temp.ok(not exists (select 1 from public.hotspots h where h.slug in (r.split_hint->'children'->0->>'slug', r.split_hint->'children'->1->>'slug')), format('%s: a child slug is already a zone', r.slug));
  end loop;
  raise notice 'ok: every zone has a split hint with a cut and two junctions inside it';
end $t$;

-- ----------------------------------------------- the app can only read ---
do $t$
declare total integer; visible integer; tgt uuid; got text;
begin
  select count(*) into total from public.hotspots;
  -- table level: the app roles have no write rights at all
  perform pg_temp.ok(not has_table_privilege('anon', 'public.hotspots', 'INSERT') and not has_table_privilege('anon', 'public.hotspots', 'UPDATE')
    and not has_table_privilege('anon', 'public.hotspots', 'DELETE') and not has_table_privilege('anon', 'public.hotspots', 'TRUNCATE'), 'anon cannot write');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.hotspots', 'INSERT') and not has_table_privilege('authenticated', 'public.hotspots', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.hotspots', 'DELETE') and not has_table_privilege('authenticated', 'public.hotspots', 'TRUNCATE'), 'signed-in Hoppers cannot write');
  perform pg_temp.ok(has_table_privilege('anon', 'public.hotspots', 'SELECT') and has_table_privilege('authenticated', 'public.hotspots', 'SELECT'), 'both can read');
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.hotspots'::regclass), 'row level security is on');
  perform pg_temp.eq((select count(*) from pg_policy where polrelid = 'public.hotspots'::regclass)::text, '1', 'exactly one policy (the read)');
  perform pg_temp.ok((select polcmd from pg_policy where polrelid = 'public.hotspots'::regclass) = 'r', 'the one policy is for select');

  -- staff set one zone paused and one split, to see what the app does not get
  update public.hotspots set status = 'paused' where slug = (select slug from public.hotspots order by slug limit 1);
  update public.hotspots set status = 'split' where slug = (select slug from public.hotspots order by slug offset 1 limit 1);
  update public.hotspots set status = 'active' where slug = (select slug from public.hotspots order by slug offset 2 limit 1);

  perform pg_temp.as_anon();
  select count(*) into visible from public.hotspots;
  perform pg_temp.eq(visible::text, (total - 2)::text, 'anon sees every zone except the paused and the split one');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where status not in ('active', 'planned')), 'anon sees only active and planned zones');
  perform pg_temp.ok(exists (select 1 from public.hotspots where status = 'active'), 'anon sees the active zone');
  begin
    insert into public.hotspots (slug, name, side, road_a, road_b, lat, lng, zone_geom) values ('anon-try', 'x', 'island', 'a', 'b', 6.4, 3.4, 'MULTIPOLYGON(((3 6,3 7,4 7,4 6,3 6)))'::geometry);
    raise exception 'TEST FAILED: anon could insert a hotspot';
  exception when insufficient_privilege then null; end;
  begin
    update public.hotspots set lat = 6.5;
    get diagnostics visible = row_count;
    raise exception 'TEST FAILED: anon could update (% rows)', visible;
  exception when insufficient_privilege then null; end;
  begin
    delete from public.hotspots;
    raise exception 'TEST FAILED: anon could delete';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();

  perform pg_temp.as_user();
  select count(*) into visible from public.hotspots;
  perform pg_temp.eq(visible::text, (total - 2)::text, 'a signed-in Hopper sees every zone except the paused and the split one');
  begin
    update public.hotspots set lat = 6.5;
    raise exception 'TEST FAILED: a signed-in Hopper could update';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hotspots (slug, name, side, road_a, road_b, lat, lng, zone_geom) values ('user-try', 'x', 'island', 'a', 'b', 6.4, 3.4, 'MULTIPOLYGON(((3 6,3 7,4 7,4 6,3 6)))'::geometry);
    raise exception 'TEST FAILED: a signed-in Hopper could insert a hotspot';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.hotspots;
    raise exception 'TEST FAILED: a signed-in Hopper could delete';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();

  perform pg_temp.ok(has_table_privilege('service_role', 'public.hotspots', 'INSERT') and has_table_privilege('service_role', 'public.hotspots', 'UPDATE'), 'the service role can write');
  raise notice 'ok: the app reads active and planned zones and cannot write';
end $t$;

-- ----------------------------------------------- a run again keeps staff edits ---
-- Staff change one zone and add a child zone; the file runs again; the staff
-- edits that belong to staff survive and the ones that belong to the file come back.
create table pg_temp.rerun (keep_slug text, n0 integer);

do $t$
declare keep_slug text; n0 integer;
begin
  select count(*) into n0 from public.hotspots;
  select slug into keep_slug from public.hotspots order by slug offset 3 limit 1;
  update public.hotspots set status = 'active', name_confirmed = true, name = 'Edited by hand', lat = 6.5, lng = 3.4 where slug = keep_slug;
  -- a child zone made by staff, and a parent that refuses to be deleted while it has one
  insert into public.hotspots (slug, name, side, road_a, road_b, lat, lng, zone_geom, parent_id)
  select keep_slug || '-child', 'Child', side, road_a, road_b, lat, lng, zone_geom, id from public.hotspots where slug = keep_slug;
  begin
    delete from public.hotspots where slug = keep_slug;
    raise exception 'TEST FAILED: a parent zone with children could be deleted';
  exception when foreign_key_violation then null; end;
  insert into pg_temp.rerun values (keep_slug, n0);
end $t$;

\echo running hotspot_zones.sql (3)
\i :sqldir/hotspot_zones.sql

do $t$
declare keep_slug text; n0 integer;
begin
  select r.keep_slug, r.n0 into keep_slug, n0 from pg_temp.rerun r;
  perform pg_temp.eq((select count(*) from public.hotspots)::text, (n0 + 1)::text, 'a run again adds no rows and keeps the child zone');
  perform pg_temp.eq((select status from public.hotspots where slug = keep_slug), 'active', 'a run again keeps the status staff set');
  perform pg_temp.ok((select name_confirmed from public.hotspots where slug = keep_slug), 'a run again keeps the confirmed flag');
  perform pg_temp.ok((select name from public.hotspots where slug = keep_slug) <> 'Edited by hand', 'a run again restores the name from the file');
  perform pg_temp.ok((select lat from public.hotspots where slug = keep_slug) <> 6.5, 'a run again restores the junction from the file');
  perform pg_temp.ok((select parent_id from public.hotspots where slug = keep_slug || '-child') = (select id from public.hotspots where slug = keep_slug), 'the child still points at its parent');
  perform pg_temp.eq((select count(*) from public.hotspots where slug = keep_slug)::text, '1', 'one row per slug');
  raise notice 'ok: a run again updates names, junctions and shapes and keeps status, confirmed flag, parent and child';
end $t$;

do $t$ begin raise notice 'ALL HOTSPOT ZONE TESTS PASSED'; end $t$;

rollback;
