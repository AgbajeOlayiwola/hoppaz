-- ============================================================================
-- Hoppaz: card deck tests (cards.sql, cards_s1_seed.sql, the card hooks in
-- play.sql and daily_box.sql)
-- Run against a LOCAL database that already has the whole load order applied, cards.sql
-- and cards_s1_seed.sql included:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cards_test.sql
-- The last section runs cards.sql twice more over live rows; it needs the SQL folder
-- inside the container (it is skipped with a notice when you do not pass sqldir):
--   docker cp supabase/. supabase_db_hoppaz-local:/tmp/hoppaz-sql
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v sqldir=/tmp/hoppaz-sql < supabase/tests/cards_test.sql
--
-- One transaction that always rolls back, so nothing is kept (the seed stays as it was).
-- It reads the seeded deck first, then clears the no-spawn zones and works in a made-up
-- season 99 of its own cards, so the real deck cannot change a result. The odds are
-- measured over thousands of draws and checked to five standard deviations, so a run does
-- not fail by bad luck. Every check raises an exception on failure; the last line printed
-- is ALL CARD TESTS PASSED.
-- ============================================================================
\if :{?sqldir}
\else
  \set sqldir ''
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

-- a count that should be a binomial: p_n tries, chance p_p, within five standard deviations
create function pg_temp.binom(p_msg text, p_got numeric, p_n numeric, p_p numeric) returns void language plpgsql as $f$
declare sd numeric := sqrt(p_n * p_p * (1 - p_p));
begin
  if abs(p_got - p_n * p_p) > 5 * sd + 1 then
    raise exception 'TEST FAILED: % (got %, expected % +- %)', p_msg, p_got, round(p_n * p_p, 1), round(5 * sd + 1, 1);
  end if;
  raise notice '  % : % of % (expected %)', p_msg, p_got, p_n, round(p_n * p_p, 1);
end $f$;

-- runs a statement and answers its error (sqlstate and message), or null when it ran
create function pg_temp.throws(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $f$;

create function pg_temp.pt(p_lat double precision, p_lng double precision) returns geography language sql as $f$
  select st_point(p_lng, p_lat)::geography;
$f$;

create function pg_temp.off(p_from geography, p_dist double precision, p_bearing double precision) returns geography language sql as $f$
  select st_project(p_from, p_dist, radians(p_bearing))::geography;
$f$;

create function pg_temp.lat(p_g geography) returns double precision language sql as $f$ select st_y(p_g::geometry); $f$;
create function pg_temp.lng(p_g geography) returns double precision language sql as $f$ select st_x(p_g::geometry); $f$;

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cardtest-' || u || '@cardtest.invalid', '{}', '{}', now(), now());
  return u;
end $f$;

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

-- make season p_season the live one
create function pg_temp.live(p_season integer) returns void language plpgsql as $f$
begin
  update public.card_seasons set live = false where live and season <> p_season;
  update public.card_seasons set live = true where season = p_season;
end $f$;

-- a made-up card in season 99. Capped rarities default to 100000 copies so a test only
-- meets a cap when it sets one.
create function pg_temp.mk(p_key text, p_rarity text, p_g geography, p_kind text default 'place', p_copies integer default null, p_weight numeric default 1) returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.cards (key, season, set_id, division, name, category, rarity, geog, geo_kind, radius_m, copies_total, numbered, front_path, back_path, thumb_path, status, signed_off)
  values (p_key, 99, (select s.id from public.card_sets s where s.key = 'zz-test'), 'Test', p_key, 'place', p_rarity, p_g, p_kind,
          case p_kind when 'citywide' then null when 'area' then 500 else 150 end,
          case when p_rarity = 'common' then null else coalesce(p_copies, 100000) end, p_rarity = 'epic',
          '/cards/t/' || p_key || '.webp', '/cards/t/' || p_key || '.back.webp', '/cards/t/' || p_key || '.thumb.webp', 'live', true)
  returning id into v_id;
  if p_weight <> 1 then update public.card_stock set weight = p_weight where card_id = v_id; end if;
  return v_id;
end $f$;

create function pg_temp.retire(p_prefix text) returns void language sql as $f$
  update public.cards set status = 'retired' where season = 99 and key like p_prefix || '%';
$f$;

create function pg_temp.id_of(p_key text) returns uuid language sql as $f$ select id from public.cards where key = p_key; $f$;

-- grant_card for a Hopper, null box point and no position unless given
create function pg_temp.grant(p_user uuid, p_tier text, p_max text default 'legendary', p_xp integer default 10, p_drop uuid default null) returns jsonb language sql as $f$
  select public.grant_card(p_user, p_tier, p_drop, p_max, p_xp);
$f$;

-- how often each card key comes up in p_n draws
create function pg_temp.draw(p_user uuid, p_tier text, p_geog geography, p_n integer, p_skip uuid[] default '{}') returns table(key text, n bigint) language sql as $f$
  select c.key, count(*) from (select public.pick_card(p_user, p_tier, p_geog, p_skip) as id from generate_series(1, p_n)) p
  join public.cards c on c.id = p.id group by c.key;
$f$;

-- a box that pays a card for one Hopper: a presence box 500 m wide
create function pg_temp.box(p_user uuid, p_g geography, p_kind text default 'special') returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active)
  values ('T card box', p_g, now() - interval '1 minute', now() + interval '1 hour', 500, 'proximity', 1, 'random', p_kind, p_user, true, true)
  returning id into v_id;
  return v_id;
end $f$;

-- a box with one card prize of a set tier
create function pg_temp.box1(p_user uuid, p_g geography, p_tier text, p_max text, p_xp integer) returns uuid language plpgsql as $f$
declare v_id uuid := pg_temp.box(p_user, p_g);
begin
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) values (v_id, 'card', p_tier || ' card', p_xp, p_tier);
  update public.game_drops set card_max_tier = p_max where id = v_id;
  return v_id;
end $f$;

create function pg_temp.claim(p_user uuid, p_drop uuid, p_lat double precision default null, p_lng double precision default null) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.claim_game_drop(p_drop, p_lat, p_lng);
  perform pg_temp.as_admin();
  return r;
end $f$;

create function pg_temp.visit(p_user uuid, p_card uuid, p_g geography, p_acc double precision default 10) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.visit_card(p_card, st_y(p_g::geometry), st_x(p_g::geometry), p_acc);
  perform pg_temp.as_admin();
  return r;
end $f$;

-- a heartbeat for the Hopper, p_age_s seconds old, at a point
create function pg_temp.fix(p_user uuid, p_g geography, p_age_s integer default 5) returns void language plpgsql as $f$
begin
  insert into public.play_fix (user_id, lat, lng, accuracy, at)
  values (p_user, round(st_y(p_g::geometry)::numeric, 3), round(st_x(p_g::geometry)::numeric, 3), 10, now() - make_interval(secs => p_age_s))
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, at = excluded.at;
end $f$;

-- a copy of a card for a Hopper, numbered like grant_card would if the card is capped
create function pg_temp.own(p_user uuid, p_card uuid) returns void language sql as $f$
  with bump as (
    update public.card_stock st set copies_issued = st.copies_issued + 1
    where st.card_id = p_card and exists (select 1 from public.cards c where c.id = p_card and c.copies_total is not null)
    returning st.copies_issued)
  insert into public.user_cards (user_id, card_id, copy_no) values (p_user, p_card, (select copies_issued from bump));
$f$;

-- --------------------------------------------------- the seeded deck, as is ---
-- Read before anything is changed: season 1 as cards_s1_seed.sql left it.
do $t$
declare r record; bad integer;
begin
  perform pg_temp.eq((select count(*) from public.cards where season = 1)::text, '125', 'Season 1 has 125 cards');
  perform pg_temp.eq((select string_agg(rarity || ':' || n, ',' order by public.card_rank(rarity)) from (select rarity, count(*) n from public.cards where season = 1 group by rarity) x),
                     'common:94,rare:29,epic:2', 'rarity counts 94, 29, 2 and no Legendary');
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and status = 'live' and signed_off)::text, '125', 'all 125 are live and signed off');
  perform pg_temp.eq((select count(*) from public.card_sets)::text, '48', '48 sets');
  perform pg_temp.eq((select count(*) from public.card_stock st join public.cards c on c.id = st.card_id where c.season = 1)::text, '125', 'every card has a stock row');
  perform pg_temp.eq((select count(*) from public.card_seasons where live)::text, '1', 'one live season');
  perform pg_temp.eq((select season::text from public.card_seasons where live), '1', 'Season 1 is live');
  -- caps: Common unlimited, Rare 1,000, Epic 100; only Epic shows a serial
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and rarity = 'common' and copies_total is null and not numbered)::text, '94', 'Common has no cap');
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and rarity = 'rare' and copies_total = 1000)::text, '29', 'Rare caps at 1,000');
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and rarity = 'epic' and copies_total = 100 and numbered)::text, '2', 'Epic caps at 100 and is numbered');
  -- art: three WebP paths per card, all Hoppaz original, never a photograph
  perform pg_temp.eq((select count(*) from public.cards where season = 1
                       and front_path = '/cards/s1/front/' || key || '.webp' and back_path = '/cards/s1/back/' || key || '.webp' and thumb_path = '/cards/s1/thumb/' || key || '.webp')::text,
                     '125', 'front, back and thumb paths follow the card key');
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and art_kind = 'owned')::text, '125', 'no photograph art');
  -- every point is in Lagos State and outside every active no-spawn zone
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and lat between 6.2 and 6.95 and lng between 2.65 and 4.45)::text, '125', 'every point is inside Lagos State');
  select count(*) into bad from public.cards c where c.season = 1 and exists (select 1 from public.no_spawn_zones z where z.active and st_intersects(z.geog, c.geog));
  perform pg_temp.eq(bad::text, '0', 'no seeded card sits in a no-spawn zone');
  -- radius by geo_kind: place 150 (a moved viewpoint 300), area 500, city-wide none
  perform pg_temp.eq((select string_agg(geo_kind || ':' || coalesce(radius_m::text, 'null'), ',' order by geo_kind, radius_m) from (select distinct geo_kind, radius_m from public.cards where season = 1) x),
                     'area:500,citywide:null,place:150,place:300', 'radius by geo_kind');
  perform pg_temp.eq((select count(*) from public.cards where season = 1 and geo_kind = 'citywide')::text, '2', 'two city-wide cards');
  perform pg_temp.ok(exists (select 1 from public.cards where key = 'IKD-IJD-01' and radius_m = 300), 'the moved viewpoint has the wider circle');
  perform pg_temp.ok((select lat from public.cards where key = 'YAB-01') between 6.5 and 6.54, 'a Yaba card is in Yaba');
  -- the sets: 1 campus, 1 city-wide, the rest councils
  perform pg_temp.eq((select string_agg(kind || ':' || n, ',' order by kind) from (select kind, count(*) n from public.card_sets group by kind) x), 'campus:1,city:1,council:46', 'set kinds');
  raise notice 'ok: the seeded deck';
end $t$;

-- ------------------------------------------------------------------ setup ---
-- Zones cleared for this transaction only, a live made-up season 99.
do $t$
begin
  delete from public.no_spawn_zones;
  insert into public.card_sets (key, name, division, kind) values ('zz-test', 'Test set', 'Test', 'council');
  insert into public.card_seasons (season, name, live) values (99, 'Test season', false);
  perform pg_temp.live(99);
  perform pg_temp.eq((select season::text from public.card_seasons where live), '99', 'season 99 is the live one');
  raise notice 'ok: setup';
end $t$;

-- -------------------------------------------------------- the zone guard ---
do $t$
declare e text;
begin
  insert into public.no_spawn_zones (name, reason, geog, source, source_ref, zone_type)
  values ('T water', 'water', st_buffer(pg_temp.pt(6.40, 3.50), 300), 'staff', 'cards-test', 'water');
  e := pg_temp.throws($q$ select pg_temp.mk('ZG1', 'common', pg_temp.pt(6.40, 3.50)) $q$);
  perform pg_temp.ok(e like '23514:%', 'a card in a zone is refused: ' || coalesce(e, 'it went in'));
  e := pg_temp.throws($q$ select pg_temp.mk('ZG2', 'common', pg_temp.pt(6.40, 3.51)) $q$);
  perform pg_temp.ok(e is null, 'a card outside the zone is fine: ' || coalesce(e, ''));
  -- moving a card into the zone is refused too
  e := pg_temp.throws($q$ update public.cards set geog = pg_temp.pt(6.40, 3.50) where key = 'ZG2' $q$);
  perform pg_temp.ok(e like '23514:%', 'moving a card into a zone is refused');
  delete from public.no_spawn_zones where source_ref = 'cards-test';
  perform pg_temp.retire('ZG');
  raise notice 'ok: the zone guard';
end $t$;

-- ------------------------------------------------------------ the distance mix ---
-- 6 Commons within 3 km of the box, 6 at 3 to 8 km, 6 beyond: 30, 30 and 40 percent of draws.
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); i integer; nd integer := 10000; ns integer := 4000;
  nn bigint; mm bigint; ff bigint; tot bigint; n1 bigint; n2 bigint; n3 bigint; w jsonb;
begin
  for i in 1..6 loop
    perform pg_temp.mk('DN' || i, 'common', pg_temp.off(b, 500 + i * 300, i * 50));
    perform pg_temp.mk('DM' || i, 'common', pg_temp.off(b, 4000 + i * 400, i * 50 + 20));
    perform pg_temp.mk('DF' || i, 'common', pg_temp.off(b, 10000 + i * 1500, i * 50 + 40));
  end loop;
  perform pg_temp.eq((select count(*) from public.card_pool(u, 'common', b) where bucket = 'near')::text, '6', 'six near');
  perform pg_temp.eq((select count(*) from public.card_pool(u, 'common', b) where bucket = 'mid')::text, '6', 'six mid');
  perform pg_temp.eq((select count(*) from public.card_pool(u, 'common', b) where bucket = 'far')::text, '6', 'six far');

  create temp table pg_temp.d1 on commit drop as select * from pg_temp.draw(u, 'common', b, nd);
  select coalesce(sum(n) filter (where key like 'DN%'), 0), coalesce(sum(n) filter (where key like 'DM%'), 0), coalesce(sum(n) filter (where key like 'DF%'), 0) into nn, mm, ff from pg_temp.d1;
  perform pg_temp.eq((nn + mm + ff)::text, nd::text, 'every draw landed on a card');
  perform pg_temp.binom('near share 30%', nn, nd, 0.30);
  perform pg_temp.binom('mid share 30%', mm, nd, 0.30);
  perform pg_temp.binom('far share 40%', ff, nd, 0.40);
  -- inside a bucket every card is equally likely
  select n into n1 from pg_temp.d1 where key = 'DN1';
  perform pg_temp.binom('one near card is 5% (30 / 6)', n1, nd, 0.05);

  -- a weight of 3 on one near card: 3 of 8 shares of the near bucket
  update public.card_stock set weight = 3 where card_id = pg_temp.id_of('DN1');
  select n into n1 from pg_temp.draw(u, 'common', b, nd) where key = 'DN1';
  perform pg_temp.binom('a weight-3 near card is 11.25%', coalesce(n1, 0), nd, 0.30 * 3 / 8);
  update public.card_stock set weight = 1 where card_id = pg_temp.id_of('DN1');

  -- a card you own counts half
  perform pg_temp.own(u, pg_temp.id_of('DN2'));
  select n into n2 from pg_temp.draw(u, 'common', b, ns) where key = 'DN2';
  select n into n3 from pg_temp.draw(u, 'common', b, ns) where key = 'DN3';
  perform pg_temp.ok(n2::numeric / n3 between 0.35 and 0.70, 'an owned card comes up about half as often: ' || n2 || ' against ' || n3);
  delete from public.user_cards where user_id = u;

  -- no box point: no buckets, the whole pool, a third each
  select coalesce(sum(n) filter (where key like 'DN%'), 0) into nn from pg_temp.draw(u, 'common', null, ns);
  perform pg_temp.binom('no box point: near cards are a third', nn, ns, 1.0 / 3);

  -- skipped cards are never drawn
  perform pg_temp.eq((select count(*) from pg_temp.draw(u, 'common', b, 3000, array(select id from public.cards where key like 'DN%')) where key like 'DN%')::text, '0', 'skipped cards never come up');

  -- the city-wide card is always far, wherever its point is
  perform pg_temp.mk('DW1', 'common', b, 'citywide');
  perform pg_temp.eq((select bucket from public.card_pool(u, 'common', b) p join public.cards c on c.id = p.card_id where c.key = 'DW1'), 'far', 'a city-wide card is far even on top of the box');
  perform pg_temp.retire('DW');

  -- an empty bucket passes its share on, pro rata: no near cards, mid 30/70, far 40/70
  perform pg_temp.retire('DN');
  select coalesce(sum(n) filter (where key like 'DM%'), 0), coalesce(sum(n) filter (where key like 'DF%'), 0) into mm, ff from pg_temp.draw(u, 'common', b, ns);
  perform pg_temp.eq((mm + ff)::text, ns::text, 'no near cards: every draw still lands');
  perform pg_temp.binom('no near cards: mid share 3/7', mm, ns, 3.0 / 7);
  perform pg_temp.binom('no near cards: far share 4/7', ff, ns, 4.0 / 7);
  -- near and mid both empty: everything is far
  perform pg_temp.retire('DM');
  select coalesce(sum(n), 0) into ff from pg_temp.draw(u, 'common', b, 2000) where key like 'DF%';
  perform pg_temp.eq(ff::text, '2000', 'near and mid empty: all far');
  -- far empty instead: near and mid split evenly
  update public.cards set status = 'live' where key like 'DN%' or key like 'DM%';
  perform pg_temp.retire('DF');
  select coalesce(sum(n) filter (where key like 'DN%'), 0) into nn from pg_temp.draw(u, 'common', b, ns);
  perform pg_temp.binom('no far cards: near is half', nn, ns, 0.5);
  update public.cards set status = 'live' where key like 'DF%';

  -- far_min: staff set far to 5, the far share stays 15 and near and mid take 42.5 each
  update public.card_rules set value = jsonb_set(value, '{far}', '5') where key = 'distance_mix';
  select coalesce(sum(n) filter (where key like 'DF%'), 0), coalesce(sum(n) filter (where key like 'DN%'), 0) into ff, nn from pg_temp.draw(u, 'common', b, ns);
  perform pg_temp.binom('far_min: far stays 15%', ff, ns, 0.15);
  perform pg_temp.binom('far_min: near takes 42.5%', nn, ns, 0.425);
  update public.card_rules set value = jsonb_set(value, '{far}', '40') where key = 'distance_mix';

  -- Epic is city-wide: no buckets, so a near and a far Epic come up half each (30/40 buckets would say 43 and 57)
  perform pg_temp.mk('DE1', 'epic', pg_temp.off(b, 800, 10));
  perform pg_temp.mk('DE2', 'epic', pg_temp.off(b, 15000, 200));
  perform pg_temp.eq((select count(*) from public.card_pool(u, 'epic', b) where bucket = 'all')::text, '2', 'Epic has no buckets');
  select coalesce(n, 0) into n1 from pg_temp.draw(u, 'epic', b, ns) where key = 'DE1';
  perform pg_temp.binom('Epic is city-wide: the near Epic is half', n1, ns, 0.5);
  perform pg_temp.retire('D');
  raise notice 'ok: the distance mix';
end $t$;

-- ------------------------------------------------- tier odds, the whole chain ---
-- Special boxes (84 / 13 / 2.7 / 0.3) opened one by one through claim_game_drop. One Hopper
-- opens thousands of boxes here, so their guarantee counters are zeroed before each one:
-- the odds under test are the prize rows', not the pity timer's (that has its own test).
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); u0 uuid := pg_temp.newuser(); i integer; n integer := 4000; d uuid; d2 uuid; r jsonb;
  c_common integer := 0; c_rare integer := 0; c_epic integer := 0; c_leg integer := 0; bad integer := 0; k text; t0 timestamptz := clock_timestamp();
begin
  for i in 1..8 loop perform pg_temp.mk('OC' || i, 'common', pg_temp.off(b, 300 * i, i * 40)); end loop;
  for i in 1..4 loop perform pg_temp.mk('OR' || i, 'rare', pg_temp.off(b, 500 * i, i * 40 + 5)); end loop;
  for i in 1..2 loop perform pg_temp.mk('OE' || i, 'epic', pg_temp.off(b, 700 * i, i * 40 + 10)); end loop;
  perform pg_temp.mk('OL1', 'legendary', pg_temp.off(b, 900, 77));

  -- add_card_prizes writes the four rows with the odds from the rules
  d := pg_temp.box(u, b);
  perform pg_temp.eq(public.add_card_prizes(d, 'special')::text, '4', 'the special box has four prize rows');
  perform pg_temp.eq((select string_agg(card_tier || ':' || weight || ':' || xp_amount, ',' order by xp_amount) from public.drop_rewards where drop_id = d and reward_type = 'card'),
                     'common:84:10,rare:13:25,epic:2.7:60,legendary:0.3:150', 'weights 84, 13, 2.7, 0.3 and XP 10, 25, 60, 150');
  perform pg_temp.eq((select card_max_tier || '/' || reward_model from public.game_drops where id = d), 'legendary/random', 'the box is capped at Legendary and picks by weight');
  -- the title is receipt text a client may print: no tier word, because the card that lands can be another tier
  perform pg_temp.eq((select string_agg(distinct title, ',') from public.drop_rewards where drop_id = d), 'Card', 'every card prize row is titled just "Card"');
  d2 := pg_temp.box(u0, b);
  perform public.add_card_prizes(d2, 'special');
  perform pg_temp.eq(pg_temp.claim(u0, d2, pg_temp.lat(b), pg_temp.lng(b))->>'reward', 'Card', 'and the claim answers "Card", not a tier');
  perform pg_temp.eq(public.add_card_prizes(d, 'special')::text, '4', 'a second call replaces the rows');
  perform pg_temp.eq((select count(*) from public.drop_rewards where drop_id = d)::text, '4', 'still four rows');

  create temp table pg_temp.boxes on commit drop as select pg_temp.box(u, b) as id from generate_series(1, n);
  perform public.add_card_prizes(id, 'special') from pg_temp.boxes;
  for d in select id from pg_temp.boxes loop
    update public.card_pity set since_rare = 0, since_epic = 0 where user_id = u;
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    perform pg_temp.ok((r->>'ok')::boolean, 'the claim worked: ' || r::text);
    k := r->'card'->>'rarity';
    if k = 'common' then c_common := c_common + 1; elsif k = 'rare' then c_rare := c_rare + 1; elsif k = 'epic' then c_epic := c_epic + 1; elsif k = 'legendary' then c_leg := c_leg + 1; end if;
    -- XP is the prize row's, which is the tier's when no guarantee lifted anything
    if (r->>'xp')::integer is distinct from (public.card_rule('tier_xp') ->> k)::integer then bad := bad + 1; end if;
  end loop;
  perform pg_temp.eq((c_common + c_rare + c_epic + c_leg)::text, n::text, 'every box paid a card');
  perform pg_temp.binom('Common 84%', c_common, n, 0.84);
  perform pg_temp.binom('Rare 13%', c_rare, n, 0.13);
  perform pg_temp.binom('Epic 2.7%', c_epic, n, 0.027);
  perform pg_temp.binom('Legendary 0.3%', c_leg, n, 0.003);
  perform pg_temp.eq(bad::text, '0', 'XP follows the tier: 10, 25, 60, 150');
  raise notice '  % claims in % ms', n, round(extract(epoch from clock_timestamp() - t0) * 1000);
  raise notice 'ok: tier odds through claim_game_drop';
end $t$;

-- -------------------------------------------------------------- roll-down ---
-- The deck has no Legendary: the 0.3 goes to Epic (3.0 in all). Then a tier with
-- nothing left goes one tier down, and with nothing at all the box pays XP only.
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); d uuid; r jsonb; n integer := 2000; i integer; k text;
  c_common integer := 0; c_rare integer := 0; c_epic integer := 0; c_leg integer := 0; epic_xp_bad integer := 0;
begin
  perform pg_temp.retire('OL');
  create temp table pg_temp.boxes2 on commit drop as select pg_temp.box(u, b) as id from generate_series(1, n);
  perform public.add_card_prizes(id, 'special') from pg_temp.boxes2;
  for d in select id from pg_temp.boxes2 loop
    update public.card_pity set since_rare = 0, since_epic = 0 where user_id = u;
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    k := r->'card'->>'rarity';
    if k = 'common' then c_common := c_common + 1; elsif k = 'rare' then c_rare := c_rare + 1; elsif k = 'epic' then c_epic := c_epic + 1; elsif k = 'legendary' then c_leg := c_leg + 1; end if;
    -- an Epic card pays Epic's 60 whether its row was Epic or a Legendary row that rolled down
    if k = 'epic' and (r->>'xp')::integer <> 60 then epic_xp_bad := epic_xp_bad + 1; end if;
  end loop;
  perform pg_temp.eq(c_leg::text, '0', 'no Legendary card is ever given when the deck has none');
  perform pg_temp.eq((c_common + c_rare + c_epic)::text, n::text, 'every box still paid a card');
  perform pg_temp.binom('Epic takes the Legendary share: 3.0%', c_epic, n, 0.03);
  perform pg_temp.binom('Common stays 84%', c_common, n, 0.84);
  perform pg_temp.eq(epic_xp_bad::text, '0', 'an Epic that came from a rolled-down Legendary row pays 60, not 150');
  raise notice '  common %, rare %, epic %', c_common, c_rare, c_epic;

  -- the catalogue and the draw agree on what the deck holds: tiers shows only live ones
  -- (checked on the real deck in the catalogue section)

  -- XP follows the card that lands, never more than the prize row: Legendary asked (150), only an Epic left -> 60
  u := pg_temp.newuser();
  r := pg_temp.grant(u, 'legendary', 'legendary', 150);
  perform pg_temp.eq(r->'card'->>'rarity' || '/' || (r->>'xp'), 'epic/60', 'a Legendary row that lands an Epic pays 60');
  -- and a sold-out Epic row (60) landing a Rare pays the Rare's 25
  create temp table pg_temp.oe_stock on commit drop as select card_id, copies_issued from public.card_stock where card_id in (select id from public.cards where key like 'OE%');
  update public.card_stock set copies_issued = (select copies_total from public.cards where id = card_id) where card_id in (select card_id from pg_temp.oe_stock);
  r := pg_temp.grant(u, 'epic', 'legendary', 60);
  perform pg_temp.eq(r->'card'->>'rarity' || '/' || (r->>'xp'), 'rare/25', 'an Epic row that falls to a Rare pays 25');
  update public.card_stock st set copies_issued = o.copies_issued from pg_temp.oe_stock o where st.card_id = o.card_id;

  -- tier by tier with grant_card: Legendary asked, nothing at Legendary or Epic -> Rare
  u := pg_temp.newuser();
  perform pg_temp.retire('OE');
  r := pg_temp.grant(u, 'legendary');
  perform pg_temp.eq(r->'card'->>'rarity', 'rare', 'Legendary with no Legendary or Epic rolls to Rare');
  perform pg_temp.retire('OR');
  r := pg_temp.grant(u, 'legendary');
  perform pg_temp.eq(r->'card'->>'rarity', 'common', 'and with no Rare either, to Common');
  perform pg_temp.retire('OC');
  r := pg_temp.grant(u, 'legendary');
  perform pg_temp.ok(r is null, 'with no card at all, nothing: XP only');
  -- through a claim: the prize row's XP is paid and the answer has card null
  d := pg_temp.box1(u, b, 'legendary', 'legendary', 150);
  r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '150' and (r->'card') = 'null'::jsonb, 'no card left: the claim pays 150 XP and card is null: ' || r::text);
  perform pg_temp.eq((select xp::text from public.profiles where id = u), '150', 'the XP landed on the profile');
  raise notice 'ok: roll-down';
end $t$;

-- ------------------------------------------------------------ the Golden Box ---
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); d uuid; r jsonb; i integer; n integer := 300; epics integer := 0; legs integer := 0; xp150 integer := 0;
begin
  update public.cards set status = 'live' where key like 'OC%' or key like 'OR%' or key like 'OE%' or key like 'OL%';
  d := pg_temp.box(u, b);
  perform pg_temp.eq(public.add_card_prizes(d, 'golden')::text, '2', 'the Golden Box has two rows');
  perform pg_temp.eq((select string_agg(card_tier || ':' || weight || ':' || xp_amount, ',' order by card_tier) from public.drop_rewards where drop_id = d), 'epic:97:150,legendary:3:150', 'Epic 97, Legendary 3, XP stays 150');
  perform pg_temp.eq((select card_max_tier from public.game_drops where id = d), 'legendary', 'capped at Legendary');
  perform pg_temp.retire('OL');
  create temp table pg_temp.boxes3 on commit drop as select pg_temp.box(u, b) as id from generate_series(1, n);
  perform public.add_card_prizes(id, 'golden') from pg_temp.boxes3;
  for d in select id from pg_temp.boxes3 loop
    update public.card_pity set since_rare = 0, since_epic = 0 where user_id = u;
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    if r->'card'->>'rarity' = 'epic' then epics := epics + 1; elsif r->'card'->>'rarity' = 'legendary' then legs := legs + 1; end if;
    if r->>'xp' = '150' then xp150 := xp150 + 1; end if;
  end loop;
  perform pg_temp.eq(epics::text, n::text, 'with no Legendary every Golden Box is an Epic');
  perform pg_temp.eq(xp150::text, n::text, 'and pays 150 XP');
  -- the flat 150 stays when the Epic is sold out and a Rare lands
  create temp table pg_temp.oe_stock_g on commit drop as select card_id, copies_issued from public.card_stock where card_id in (select id from public.cards where key like 'OE%');
  update public.card_stock set copies_issued = (select copies_total from public.cards where id = card_id) where card_id in (select card_id from pg_temp.oe_stock_g);
  d := pg_temp.box(u, b);
  perform public.add_card_prizes(d, 'golden');
  update public.card_pity set since_rare = 0, since_epic = 0 where user_id = u;
  r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
  perform pg_temp.ok(r->'card'->>'rarity' = 'rare' and r->>'xp' = '150', 'Golden Box, Epics gone: a Rare at the flat 150 XP: ' || r::text);
  update public.card_stock st set copies_issued = o.copies_issued from pg_temp.oe_stock_g o where st.card_id = o.card_id;
  -- with a Legendary in the deck, 3% of Golden Boxes are one
  perform pg_temp.mk('OL2', 'legendary', b);
  epics := 0; legs := 0;
  create temp table pg_temp.boxes3b on commit drop as select pg_temp.box(u, b) as id from generate_series(1, 2000);
  perform public.add_card_prizes(id, 'golden') from pg_temp.boxes3b;
  for d in select id from pg_temp.boxes3b loop
    update public.card_pity set since_rare = 0, since_epic = 0 where user_id = u;
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    if r->'card'->>'rarity' = 'legendary' then legs := legs + 1; end if;
  end loop;
  perform pg_temp.binom('Golden Box Legendary 3%', legs, 2000, 0.03);
  perform pg_temp.retire('OL');
  raise notice 'ok: the Golden Box';
end $t$;

-- ------------------------------------------------------------- the spot box ---
-- Ten one-prize rows, 87 Common to 13 Rare, and no card twice in one box.
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); d uuid; i integer; u uuid; r jsonb; keys text[] := '{}'; rows_rare integer; owner uuid := pg_temp.newuser(); big integer := 0; rares integer := 0;
begin
  perform pg_temp.retire('O');
  for i in 1..12 loop
    perform pg_temp.mk('SC' || i, 'common', pg_temp.off(b, 200 * i, i * 30));
    perform pg_temp.mk('SR' || i, 'rare', pg_temp.off(b, 250 * i, i * 30 + 10));
  end loop;
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, active)
  values ('T spot box', b, now() - interval '1 minute', now() + interval '1 hour', 500, 'proximity', 10, 'random', 'spawn', true) returning id into d;
  perform pg_temp.eq(public.add_card_prizes(d, 'spot')::text, '10', 'a spot box has ten rows');
  -- 60 boxes: a quarter of them draw ten Commons, and all of them are still capped at Rare
  create temp table pg_temp.spots_cap on commit drop as select pg_temp.box(owner, b, 'spawn') as id from generate_series(1, 60);
  perform public.add_card_prizes(id, 'spot') from pg_temp.spots_cap;
  perform pg_temp.eq((select card_max_tier from public.game_drops where id = d), 'rare', 'a spot box is capped at Rare');
  perform pg_temp.eq((select count(*) from public.game_drops g where g.id in (select id from pg_temp.spots_cap) and g.card_max_tier <> 'rare')::text, '0', 'every spot box is capped at Rare, even one whose ten rows are all Common');
  perform pg_temp.ok(not exists (select 1 from public.drop_rewards where drop_id = d and (quantity is distinct from 1 or card_tier not in ('common', 'rare'))), 'each row is one prize, Common or Rare');
  -- the tier draw at spawn: 87 / 13 over many boxes
  create temp table pg_temp.spots on commit drop as select pg_temp.box(owner, b, 'spawn') as id from generate_series(1, 400);
  perform public.add_card_prizes(id, 'spot') from pg_temp.spots;
  select count(*) filter (where card_tier = 'rare') into rares from public.drop_rewards where drop_id in (select id from pg_temp.spots);
  perform pg_temp.binom('spot rows: 13% Rare', rares, 4000, 0.13);
  -- ten Hoppers open the first box: ten different cards
  for i in 1..10 loop
    u := pg_temp.newuser();
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    perform pg_temp.ok((r->>'ok')::boolean and r->'card' <> 'null'::jsonb, 'spot claim ' || i || ': ' || r::text);
    keys := keys || (r->'card'->>'key');
  end loop;
  perform pg_temp.eq((select count(distinct k) from unnest(keys) k)::text, '10', 'ten claims, ten different cards');
  perform pg_temp.eq((select count(*) from public.user_cards where drop_id = d)::text, '10', 'ten copies from one box');
  raise notice 'ok: the spot box';
end $t$;

-- a pool thinner than the box gives a repeat rather than nothing
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); d uuid; u uuid; r jsonb; i integer; got text[] := '{}';
begin
  perform pg_temp.retire('S');
  perform pg_temp.mk('TH1', 'common', b);
  perform pg_temp.mk('TH2', 'common', pg_temp.off(b, 300, 90));
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, active, card_max_tier)
  values ('T thin box', b, now() - interval '1 minute', now() + interval '1 hour', 500, 'proximity', 5, 'fixed', 'spawn', true, 'common') returning id into d;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) values (d, 'card', 'Common card', 10, 'common');
  for i in 1..5 loop
    u := pg_temp.newuser();
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    perform pg_temp.ok((r->>'ok')::boolean and r->'card' <> 'null'::jsonb, 'thin pool claim ' || i || ': ' || r::text);
    got := got || (r->'card'->>'key');
  end loop;
  perform pg_temp.eq((select count(distinct k) from unnest(got[1:2]) k)::text, '2', 'the first two claims are different');
  perform pg_temp.eq(cardinality(got)::text, '5', 'all five got a card');
  perform pg_temp.retire('TH');
  raise notice 'ok: a thin pool repeats';
end $t$;

-- ------------------------------------------------------------- copy caps ---
-- A capped card gives out copies 1, 2, 3 and no more; past the cap the ask rolls down.
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); r jsonb; i integer; v_rare uuid; v_epic uuid; dup integer := 0; e text;
begin
  for i in 1..3 loop perform pg_temp.mk('CC' || i, 'common', pg_temp.off(b, 400 * i, i * 60)); end loop;
  v_rare := pg_temp.mk('CR1', 'rare', b, 'place', 3);
  v_epic := pg_temp.mk('CE1', 'epic', b, 'place', 2);
  for i in 1..5 loop
    r := pg_temp.grant(u2, 'rare', 'rare');
    if i <= 3 then
      perform pg_temp.eq(r->'card'->>'key', 'CR1', 'ask ' || i || ' gets the capped Rare');
      perform pg_temp.eq(r->'card'->>'copy_no', i::text, 'copy number ' || i);
    else
      perform pg_temp.eq(r->'card'->>'rarity', 'common', 'ask ' || i || ' is past the cap: it rolls down to Common');
      perform pg_temp.eq(r->'card'->>'copy_no', null, 'a Common has no copy number');
    end if;
  end loop;
  perform pg_temp.eq((select copies_issued::text from public.card_stock where card_id = v_rare), '3', 'the counter stops at the cap');
  perform pg_temp.eq((select count(*) from public.user_cards where card_id = v_rare)::text, '3', 'three copies are out');
  perform pg_temp.eq(array_to_string(array(select copy_no from public.user_cards where card_id = v_rare order by copy_no), ','), '1,2,3', 'copy numbers 1, 2, 3, each once');
  perform pg_temp.ok(public.pick_card(u, 'rare', b) is null, 'a sold-out card is never drawn');
  perform pg_temp.ok(not exists (select 1 from public.card_pool(u, 'rare', b)), 'and is not in the pool');

  -- Epic: 2 copies, numbered, then it rolls down (the Rare is sold out too, so to Common)
  r := pg_temp.grant(u, 'epic');
  perform pg_temp.eq(r->'card'->>'copy_no', '1', 'Epic copy 1');
  perform pg_temp.eq(r->'card'->>'numbered', 'true', 'an Epic shows its number');
  perform pg_temp.eq(r->'card'->>'copies_total', '2', 'and its cap');
  r := pg_temp.grant(u2, 'epic');
  perform pg_temp.eq(r->'card'->>'copy_no', '2', 'Epic copy 2');
  r := pg_temp.grant(u, 'epic');
  perform pg_temp.eq(r->'card'->>'rarity', 'common', 'a third Epic ask rolls down');

  -- a Hopper can hold repeats; a repeat is not new
  for i in 1..12 loop
    r := pg_temp.grant(u3, 'common');
    if not (r->'card'->>'is_new')::boolean then dup := dup + 1; end if;
  end loop;
  perform pg_temp.eq((select count(*) from public.user_cards where user_id = u3)::text, '12', 'twelve copies');
  perform pg_temp.ok((select count(distinct card_id) from public.user_cards where user_id = u3) <= 3, 'from at most the three Commons');
  perform pg_temp.ok(dup >= 9, 'repeats are not new: ' || dup);
  -- the table says the same: no copy number twice, no negative counter
  e := pg_temp.throws($q$ insert into public.user_cards (user_id, card_id, copy_no) select user_id, card_id, copy_no from public.user_cards where copy_no = 1 limit 1 $q$);
  perform pg_temp.ok(e like '23505:%', 'a copy number is unique per card: ' || coalesce(e, 'it went in'));
  e := pg_temp.throws($q$ update public.card_stock set copies_issued = -1 $q$);
  perform pg_temp.ok(e like '23514:%', 'the counter cannot go below zero');
  -- the cap rules are in the table: Common unlimited, the rest capped
  e := pg_temp.throws($q$ select pg_temp.mk('CX1', 'common', pg_temp.pt(6.5, 3.4), 'place', 5) $q$);
  perform pg_temp.eq(e, null, 'mk ignores a cap on Common');
  e := pg_temp.throws($q$ update public.cards set copies_total = null where key = 'CR1' $q$);
  perform pg_temp.ok(e like '23514:%', 'a Rare must have a cap');
  raise notice 'ok: copy caps';
end $t$;

-- ------------------------------------------------------------ the guarantees ---
-- A Rare by the 10th card claim, an Epic by the 60th, per Hopper, within the box cap.
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); u4 uuid := pg_temp.newuser(); r jsonb; i integer; want text; d uuid; res jsonb;
begin
  perform pg_temp.mk('GR1', 'rare', pg_temp.off(b, 600, 10));
  perform pg_temp.mk('GR2', 'rare', pg_temp.off(b, 900, 120));
  perform pg_temp.mk('GE1', 'epic', pg_temp.off(b, 1200, 200));

  -- 70 common asks: the 10th, 20th ... are Rare, the 60th is Epic, nothing else lifts
  for i in 1..70 loop
    r := pg_temp.grant(u, 'common', 'legendary', 10);
    want := case when i % 60 = 0 then 'epic' when i % 10 = 0 then 'rare' else 'common' end;
    perform pg_temp.eq(r->'card'->>'rarity', want, 'claim ' || i || ' is ' || want);
    perform pg_temp.eq(r->'card'->>'lifted', (want <> 'common')::text, 'claim ' || i || ' lifted flag');
    -- a lift tops the XP up to the tier's XP; nothing else changes it
    perform pg_temp.eq(r->>'xp', case want when 'epic' then '60' when 'rare' then '25' else '10' end, 'claim ' || i || ' XP');
  end loop;
  perform pg_temp.eq((select since_rare || '/' || since_epic from public.card_pity where user_id = u), '0/10', 'the counters after 70: Rare at 70, Epic 10 ago');

  -- a Rare you draw by luck restarts the count: 4 Commons, a Rare, 9 Commons, then the lift
  for i in 1..15 loop
    r := pg_temp.grant(u2, case when i = 5 then 'rare' else 'common' end, 'legendary', 10);
    want := case when i = 5 or i = 15 then 'rare' else 'common' end;
    perform pg_temp.eq(r->'card'->>'rarity', want, 'luck run, claim ' || i);
    perform pg_temp.eq(r->'card'->>'lifted', (i = 15)::text, 'only claim 15 is lifted');
  end loop;

  -- the guarantee stays within the box cap: capped at Rare, 70 claims never give an Epic ...
  for i in 1..70 loop
    r := pg_temp.grant(u3, 'common', 'rare', 10);
    perform pg_temp.eq(r->'card'->>'rarity', case when i % 10 = 0 then 'rare' else 'common' end, 'capped box, claim ' || i);
  end loop;
  perform pg_temp.eq((select since_epic::text from public.card_pity where user_id = u3), '70', 'the Epic count kept going');
  -- ... and the first box that can pay an Epic does
  r := pg_temp.grant(u3, 'common', 'epic', 10);
  perform pg_temp.eq(r->'card'->>'rarity', 'epic', 'the first Epic-capable box pays the owed Epic');
  perform pg_temp.eq(r->>'xp', '60', 'with the Epic XP');
  perform pg_temp.eq((select since_rare || '/' || since_epic from public.card_pity where user_id = u3), '0/0', 'Epic zeroes both counters');

  -- through claim_game_drop: ten Common-only boxes, the 10th is a Rare worth 25 XP
  for i in 1..10 loop
    d := pg_temp.box1(u4, b, 'common', 'rare', 10);
    res := pg_temp.claim(u4, d, pg_temp.lat(b), pg_temp.lng(b));
    perform pg_temp.ok((res->>'ok')::boolean, 'claim ' || i || ': ' || res::text);
    perform pg_temp.eq(res->'card'->>'rarity', case when i = 10 then 'rare' else 'common' end, 'box ' || i || ' card');
    perform pg_temp.eq(res->>'xp', case when i = 10 then '25' else '10' end, 'box ' || i || ' XP');
  end loop;
  perform pg_temp.eq((select xp::text from public.profiles where id = u4), '115', 'profile XP: nine boxes of 10 and the lift to 25');
  -- another Hopper's count is their own
  perform pg_temp.eq((select count(*) from public.card_pity where user_id in (u, u2, u3, u4))::text, '4', 'one counter row each');
  raise notice 'ok: the guarantees';
end $t$;

-- A sold-out Epic must not turn the Epic guarantee into a Rare on every claim: the lift falls back to the
-- prize tier, and a Rare only when one is owed too.
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); r jsonb; i integer; d uuid; seq text := ''; rares integer := 0; n integer := 400;
begin
  perform pg_temp.retire('');
  for i in 1..4 loop perform pg_temp.mk('SOC' || i, 'common', pg_temp.off(b, 300 * i, i * 70)); end loop;
  for i in 1..3 loop perform pg_temp.mk('SOR' || i, 'rare', pg_temp.off(b, 400 * i, i * 70 + 20)); end loop;
  perform pg_temp.mk('SOE1', 'epic', pg_temp.off(b, 900, 40), 'place', 2);
  perform pg_temp.mk('SOE2', 'epic', pg_temp.off(b, 1100, 140), 'place', 2);
  update public.card_stock set copies_issued = 2 where card_id in (select id from public.cards where key in ('SOE1', 'SOE2'));
  perform pg_temp.ok(not exists (select 1 from public.card_pool(u, 'epic', b)), 'both Epics are sold out');

  -- 59 claims since an Epic: the next is owed one, there is none, so the Common row pays a Common, not a Rare
  insert into public.card_pity (user_id, since_rare, since_epic) values (u, 0, 59);
  for i in 1..12 loop
    d := pg_temp.box1(u, b, 'common', 'legendary', 10);
    r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
    perform pg_temp.ok((r->>'ok')::boolean, 'sold-out Epic, claim ' || i || ': ' || r::text);
    seq := seq || left(r->'card'->>'rarity', 1);
  end loop;
  perform pg_temp.eq(seq, 'cccccccccrcc', 'a sold-out Epic owed: Commons, and the Rare guarantee still lands on the 10th claim');
  perform pg_temp.eq((select since_rare || '/' || since_epic from public.card_pity where user_id = u), '2/71', 'the Rare count restarted at the 10th; the Epic count keeps going');
  -- the same for a Rare row: an owed Epic that is not there leaves a Rare row a Rare
  insert into public.card_pity (user_id, since_rare, since_epic) values (u2, 0, 59);
  r := pg_temp.grant(u2, 'rare', 'legendary', 25);
  perform pg_temp.eq(r->'card'->>'rarity' || '/' || (r->>'xp'), 'rare/25', 'a Rare row with an Epic owed and none left pays its Rare');

  -- the special box over many claims: the Epic and Legendary rows fall to Rare (16% Rare in all) and the Rare guarantee adds a little (about 19%), nowhere near all Rare
  insert into public.card_pity (user_id, since_rare, since_epic) values (u3, 0, 59);
  create temp table pg_temp.boxes_so on commit drop as select pg_temp.box(u3, b) as id from generate_series(1, n);
  perform public.add_card_prizes(id, 'special') from pg_temp.boxes_so;
  for d in select id from pg_temp.boxes_so loop
    r := pg_temp.claim(u3, d, pg_temp.lat(b), pg_temp.lng(b));
    if r->'card'->>'rarity' = 'rare' then rares := rares + 1; end if;
    perform pg_temp.ok(r->'card'->>'rarity' in ('common', 'rare'), 'no Epic from sold-out Epics');
  end loop;
  perform pg_temp.ok(rares between 35 and 125, 'with the Epics gone about 19% of claims are Rare, not all of them: ' || rares || ' of ' || n);
  raise notice 'ok: a sold-out Epic and the guarantee (% Rare of %)', rares, n;
end $t$;

-- ------------------------------------------------------------- Visited ---
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); r jsonb; e text; pos geography; d uuid; fix_before text; claims_before integer; xp0 integer;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; a1 uuid; stats jsonb;
begin
  perform pg_temp.retire('');
  p1 := pg_temp.mk('VP1', 'common', b);
  p2 := pg_temp.mk('VP2', 'common', pg_temp.off(b, 250, 90));
  p3 := pg_temp.mk('VP3', 'common', pg_temp.off(b, 1000, 180));
  p4 := pg_temp.mk('VP4', 'common', pg_temp.off(b, 2000, 270));
  p5 := pg_temp.mk('VP5', 'common', pg_temp.off(b, 3000, 0));
  p6 := pg_temp.mk('VP6', 'common', pg_temp.off(b, 5000, 135));
  p7 := pg_temp.mk('VP7', 'common', pg_temp.off(b, 6000, 225));
  a1 := pg_temp.mk('VA1', 'common', pg_temp.off(b, 4000, 45), 'area');
  perform pg_temp.own(u, p) from unnest(array[p1, p2, p3, p4, p5, p7, a1]) p;

  -- refusals that need no position check
  perform pg_temp.as_nosub(); r := public.visit_card(p1, 6.5, 3.4); perform pg_temp.as_admin();
  perform pg_temp.eq(r->>'reason', 'no_session', 'no session');
  perform pg_temp.as_user(u); r := public.visit_card(p1, null, null); perform pg_temp.as_admin();
  perform pg_temp.eq(r->>'reason', 'location_required', 'no position');
  perform pg_temp.as_user(u); r := public.visit_card(p1, 'NaN'::double precision, 3.4); perform pg_temp.as_admin();
  perform pg_temp.eq(r->>'reason', 'location_required', 'a NaN position');
  perform pg_temp.fix(u, b);
  perform pg_temp.eq(pg_temp.visit(u, gen_random_uuid(), b)->>'reason', 'not_found', 'an unknown card');
  perform pg_temp.eq(pg_temp.visit(u, p6, pg_temp.off(b, 5000, 135))->>'reason', 'not_owned', 'a card you do not hold');
  update public.cards set status = 'draft' where id = p1;
  perform pg_temp.eq(pg_temp.visit(u, p1, b)->>'reason', 'not_found', 'a card that is not live');
  update public.cards set status = 'live' where id = p1;

  -- too far, told to the nearest 10 m
  pos := pg_temp.off(b, 400, 90); perform pg_temp.fix(u, pos);
  r := pg_temp.visit(u, p1, pos);
  perform pg_temp.eq(r->>'reason', 'too_far', '400 m from a 150 m card');
  perform pg_temp.eq(r->>'distance_m', '400', 'the distance is told to 10 m');

  -- the heartbeat has to be alive inside Play's box
  pos := pg_temp.off(b, 100, 90);
  delete from public.play_fix where user_id = u;
  perform pg_temp.eq(pg_temp.visit(u, p1, pos)->>'reason', 'location_stale', 'no heartbeat at all');
  perform pg_temp.fix(u, pos, 300);
  perform pg_temp.eq(pg_temp.visit(u, p1, pos)->>'reason', 'location_stale', 'a heartbeat five minutes old');
  perform pg_temp.fix(u, pg_temp.off(b, 6000, 0), 5);
  perform pg_temp.eq(pg_temp.visit(u, p1, pos)->>'reason', 'too_fast', 'a heartbeat 6 km away five seconds ago');
  perform pg_temp.eq((select count(*) from public.card_visits where user_id = u)::text, '0', 'a refused visit stamps nothing');

  -- today's speed rule from the last located claim
  perform pg_temp.fix(u, pos, 5);
  d := pg_temp.box(u, b);
  insert into public.drop_claims (drop_id, user_id, claimed_at, lat, lng) values (d, u, now() - interval '10 seconds', 6.70, 3.60);
  perform pg_temp.eq(pg_temp.visit(u, p1, pos)->>'reason', 'too_fast', '25 km from the last claim ten seconds ago');
  delete from public.drop_claims where user_id = u;

  -- the first stamp: inside the circle, 30 XP, an outside day
  xp0 := (select xp from public.profiles where id = u);
  select md5(row(lat, lng, accuracy, at)::text) into fix_before from public.play_fix where user_id = u;
  select count(*) into claims_before from public.drop_claims;
  r := pg_temp.visit(u, p1, pos);
  perform pg_temp.ok((r->>'ok')::boolean and not (r->>'already')::boolean, 'the first stamp: ' || r::text);
  perform pg_temp.eq(r->>'xp', '30', 'pays 30 XP');
  perform pg_temp.eq(r->>'outside', 'true', 'and is an outside day');
  perform pg_temp.eq(r->'card'->>'key', 'VP1', 'the answer names the card');
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = u)::text, '30', 'the XP landed on the profile');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u and action = 'card_visit' and outside_score = 0)::text, '1', 'one card_visit row, worth 0 on the board');
  perform pg_temp.eq((select created_at::text from public.activity_log where user_id = u and action = 'card_visit' limit 1), public.lagos_play_day_start()::text, 'the row is dated to the start of the play-day, not to the minute');
  perform pg_temp.eq((select (created_at at time zone 'Africa/Lagos')::date::text from public.activity_log where user_id = u and action = 'card_visit' limit 1), public.lagos_play_day()::text, 'and still lands on the play-day for the streak');
  perform pg_temp.eq((select visited_on || '/' || xp_paid from public.card_visits where user_id = u and card_id = p1), public.lagos_play_day() || '/true', 'the stamp holds the play-day and the XP flag');
  -- the position was used and thrown away
  perform pg_temp.eq((select md5(row(lat, lng, accuracy, at)::text) from public.play_fix where user_id = u), fix_before, 'visit_card did not touch the heartbeat row');
  perform pg_temp.eq((select count(*) from public.drop_claims)::text, claims_before::text, 'and wrote no claim row');

  -- once per card
  r := pg_temp.visit(u, p1, pos);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'already')::boolean and r->>'xp' = '0' and r->>'outside' = 'false', 'the second stamp is already: ' || r::text);
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = u)::text, '30', 'no second payout');
  perform pg_temp.eq((select count(*) from public.card_visits where user_id = u and card_id = p1)::text, '1', 'one stamp row');

  -- nothing within 300 m of a paid stamp today pays
  pos := pg_temp.off(b, 250, 90); perform pg_temp.fix(u, pos);
  r := pg_temp.visit(u, p2, pos);
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '0' and r->>'xp_skipped' = 'near_stamp' and r->>'outside' = 'false', 'a card 250 m from a paid stamp: stamped, not paid: ' || r::text);
  -- an area card stamps within 500 m but pays nothing
  pos := (select geog from public.cards where id = a1); perform pg_temp.fix(u, pos);
  r := pg_temp.visit(u, a1, pos);
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '0' and r->>'xp_skipped' = 'area', 'an area card is stamped, not paid: ' || r::text);
  -- two more paid stamps make three, the fourth pays nothing
  pos := (select geog from public.cards where id = p3); perform pg_temp.fix(u, pos);
  perform pg_temp.eq(pg_temp.visit(u, p3, pos)->>'xp', '30', 'second paid stamp');
  pos := (select geog from public.cards where id = p4); perform pg_temp.fix(u, pos);
  perform pg_temp.eq(pg_temp.visit(u, p4, pos)->>'xp', '30', 'third paid stamp');
  pos := (select geog from public.cards where id = p5); perform pg_temp.fix(u, pos);
  r := pg_temp.visit(u, p5, pos);
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '0' and r->>'xp_skipped' = 'daily_limit', 'the fourth stamp of the play-day pays nothing: ' || r::text);
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = u)::text, '90', 'three paid stamps, 90 XP');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u and action = 'card_visit')::text, '3', 'only paid stamps are outside days');
  perform pg_temp.eq((select count(*) from public.card_visits where user_id = u)::text, '6', 'six stamps in all');
  -- an outside day: the streak counts it, the board does not
  perform pg_temp.as_user(u); stats := public.my_game_stats(); perform pg_temp.as_admin();
  perform pg_temp.ok((stats->>'daily_streak')::integer >= 1, 'the streak counts the stamp');
  perform pg_temp.eq(stats->>'outside_score', '0', 'and the Outside Score board gets nothing');
  perform pg_temp.eq(stats->>'lagos_rank', '0', 'so a Hopper with only stamps is not ranked');
  -- the next play-day the limit is open again
  update public.card_visits set visited_on = visited_on - 1 where user_id = u;
  pos := (select geog from public.cards where id = p7); perform pg_temp.fix(u, pos);
  perform pg_temp.eq(pg_temp.visit(u, p7, pos)->>'xp', '30', 'a new play-day pays again');
  raise notice 'ok: Visited, the main run';
end $t$;

-- the circle: radius plus GPS accuracy, the accuracy capped at 30 m
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); c uuid := pg_temp.mk('VR1', 'common', b); a uuid; apos geography; u uuid; r jsonb; i integer;
begin
  a := pg_temp.mk('VR2', 'common', pg_temp.off(b, 8000, 20), 'area');
  apos := (select geog from public.cards where id = a);
  for i in 1..7 loop
    u := pg_temp.newuser(); perform pg_temp.own(u, c); perform pg_temp.own(u, a);
    case i
      when 1 then perform pg_temp.fix(u, pg_temp.off(b, 140, 0)); r := pg_temp.visit(u, c, pg_temp.off(b, 140, 0), 5);
                  perform pg_temp.eq(r->>'ok', 'true', '140 m from a 150 m card'); perform pg_temp.eq(r->>'xp', '30', 'pays');
      when 2 then perform pg_temp.fix(u, pg_temp.off(b, 170, 0)); r := pg_temp.visit(u, c, pg_temp.off(b, 170, 0), 30);
                  perform pg_temp.eq(r->>'ok', 'true', '170 m with 30 m of accuracy is inside');
      when 3 then perform pg_temp.fix(u, pg_temp.off(b, 190, 0)); r := pg_temp.visit(u, c, pg_temp.off(b, 190, 0), 100);
                  perform pg_temp.eq(r->>'reason', 'too_far', '190 m with 100 m of accuracy: the slack is capped at 30');
      when 4 then perform pg_temp.fix(u, pg_temp.off(b, 170, 0)); r := pg_temp.visit(u, c, pg_temp.off(b, 170, 0), 5);
                  perform pg_temp.eq(r->>'reason', 'too_far', '170 m with 5 m of accuracy is outside');
      when 5 then perform pg_temp.fix(u, pg_temp.off(b, 170, 0)); r := pg_temp.visit(u, c, pg_temp.off(b, 170, 0), -50);
                  perform pg_temp.eq(r->>'reason', 'too_far', 'a negative accuracy is no slack');
      when 6 then perform pg_temp.fix(u, pg_temp.off(apos, 480, 90)); r := pg_temp.visit(u, a, pg_temp.off(apos, 480, 90), 5);
                  perform pg_temp.eq(r->>'ok', 'true', '480 m from an area card is inside its 500 m');
      when 7 then perform pg_temp.fix(u, pg_temp.off(apos, 560, 90)); r := pg_temp.visit(u, a, pg_temp.off(apos, 560, 90), 5);
                  perform pg_temp.eq(r->>'reason', 'too_far', '560 m from an area card is outside');
    end case;
  end loop;
  raise notice 'ok: the Visited circle';
end $t$;

-- a city-wide card stamps from anywhere in Lagos; a card past Play's box needs no heartbeat
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); w1 uuid := pg_temp.mk('VW1', 'common', b, 'citywide'); w2 uuid := pg_temp.mk('VW2', 'common', b, 'citywide');
  e1 uuid := pg_temp.mk('VE1', 'common', pg_temp.pt(6.58, 3.97)); u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); r jsonb;
begin
  perform pg_temp.own(u, w1); perform pg_temp.own(u, w2); perform pg_temp.own(u, e1); perform pg_temp.own(u2, e1);
  perform pg_temp.eq((select radius_m is null from public.cards where id = w1)::text, 'true', 'a city-wide card has no radius');
  perform pg_temp.fix(u, pg_temp.pt(6.60, 3.20));
  r := pg_temp.visit(u, w1, pg_temp.pt(6.60, 3.20));
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '0', 'a city-wide card stamps from Ikeja, 20 km from its anchor: ' || r::text);
  r := pg_temp.visit(u, w2, pg_temp.pt(9.07, 7.49));
  perform pg_temp.eq(r->>'reason', 'outside_lagos', 'but not from Abuja');
  -- staff can refuse them instead
  update public.card_rules set value = jsonb_set(value, '{citywide}', '"refuse"') where key = 'visit';
  perform pg_temp.fix(u, pg_temp.pt(6.60, 3.20));
  perform pg_temp.eq(pg_temp.visit(u, w2, pg_temp.pt(6.60, 3.20))->>'reason', 'not_stampable', 'with citywide set to refuse, they cannot be stamped');
  update public.card_rules set value = jsonb_set(value, '{citywide}', '"lagos"') where key = 'visit';
  -- Badagry is past the west edge of Play's box: no heartbeat can run there, so none is asked for
  r := pg_temp.visit(u, w2, pg_temp.pt(6.43, 2.88));
  perform pg_temp.ok((r->>'ok')::boolean, 'a city-wide card from Badagry needs no heartbeat: ' || r::text);
  -- Epe is past the east edge: a card there stamps with no heartbeat, but nothing checked the position, so it pays no XP
  r := pg_temp.visit(u, e1, pg_temp.pt(6.58, 3.97));
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '0' and r->>'xp_skipped' = 'unverified' and r->>'outside' = 'false', 'a card in Epe, outside Play''s box, stamps free: ' || r::text);
  perform pg_temp.eq((select xp_paid::text from public.card_visits where user_id = u and card_id = e1), 'false', 'the stamp row says no XP was paid');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u and action = 'card_visit' and source_id = e1)::text, '0', 'and it is not an outside day');
  -- a heartbeat from Epe is fine too, but Epe is outside the box the stamp is believed in, so still no XP
  perform pg_temp.fix(u2, pg_temp.pt(6.58, 3.97), 5);
  r := pg_temp.visit(u2, e1, pg_temp.pt(6.58, 3.97));
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '0', 'a heartbeat from Epe stamps, no XP: ' || r::text);
  raise notice 'ok: city-wide cards and the edges of Play';
end $t$;

-- what is kept: a play-day date and a yes or no, nothing about where or when
do $t$
begin
  perform pg_temp.eq((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'card_visits'),
                     'user_id,card_id,visited_on,xp_paid', 'card_visits holds exactly the user, the card, the play-day and the XP flag');
  perform pg_temp.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('card_visits', 'user_cards', 'card_pity')
                       and (column_name ~* '(lat|lng|geog|position|accuracy|location)' or data_type like 'timestamp%'))::text, '0',
                     'no coordinates and no timestamps in the Hopper tables');
  raise notice 'ok: what is kept';
end $t$;

-- a walked box stamps its card when it opens inside the card's circle; an avatar claim never does
do $t$
declare
  b geography := pg_temp.pt(6.5158, 3.3792); u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); d uuid; r jsonb; c uuid; xp0 integer;
begin
  perform pg_temp.retire('');
  c := pg_temp.mk('WK1', 'common', b);
  d := pg_temp.box1(u, b, 'common', 'common', 10);
  r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
  perform pg_temp.eq(r->'card'->>'key', 'WK1', 'the one card in the pool');
  perform pg_temp.eq(r->'card'->>'visited', 'true', 'a box opened on the card''s point stamps it');
  perform pg_temp.eq((select xp_paid::text from public.card_visits where user_id = u and card_id = c), 'false', 'with no XP for the stamp');
  perform pg_temp.eq(r->>'xp', '10', 'the claim pays only the prize row');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u and action = 'card_visit')::text, '0', 'and is not an outside day of its own');
  -- 300 m from the card (box 500 m wide): outside the card's 150 m
  d := pg_temp.box1(u2, pg_temp.off(b, 300, 0), 'common', 'common', 10);
  r := pg_temp.claim(u2, d, pg_temp.lat(pg_temp.off(b, 300, 0)), pg_temp.lng(pg_temp.off(b, 300, 0)));
  perform pg_temp.eq(r->'card'->>'visited', 'false', 'a box 300 m away does not stamp');
  perform pg_temp.eq((select count(*) from public.card_visits where user_id = u2)::text, '0', 'no stamp row');
  -- an avatar (remote) claim has no position: a card, never a stamp
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active, card_max_tier)
  values ('T remote', b, now() - interval '1 minute', now() + interval '1 hour', 60, 'proximity', 1, 'fixed', 'near', u3, false, true, 'common') returning id into d;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) values (d, 'card', 'Common card', 10, 'common');
  r := pg_temp.claim(u3, d);
  perform pg_temp.eq(r->'card'->>'key', 'WK1', 'a remote claim still gets the card');
  perform pg_temp.eq(r->'card'->>'visited', 'false', 'and is never stamped');
  perform pg_temp.ok((select lat is null and lng is null from public.drop_claims where drop_id = d and user_id = u3), 'the claim row has no position');
  -- a small box with a card prize but no card_max_tier pays XP only
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active)
  values ('T small', b, now() - interval '1 minute', now() + interval '1 hour', 60, 'proximity', 1, 'fixed', 'near', u2, false, true) returning id into d;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) values (d, 'card', 'Common card', 10, 'common');
  xp0 := (select xp from public.profiles where id = u2);
  r := pg_temp.claim(u2, d);
  perform pg_temp.ok((r->>'ok')::boolean and r->'card' = 'null'::jsonb and r->>'xp' = '10', 'no card_max_tier: XP only: ' || r::text);
  perform pg_temp.eq((select xp - xp0 from public.profiles where id = u2)::text, '10', 'and the XP landed');
  raise notice 'ok: boxes and stamps';
end $t$;

-- --------------------------------------------------- catalogue and collection ---
-- Back to the real deck: every made-up card retired, Season 1 live.
do $t$
declare
  c jsonb; r jsonb; u uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); i integer; yaba uuid := pg_temp.id_of('YAB-01'); pos geography; sum_count integer; n_tiers text;
begin
  perform pg_temp.retire('');
  perform pg_temp.live(1);
  perform pg_temp.as_anon(); c := public.card_catalog(); perform pg_temp.as_admin();
  perform pg_temp.eq(c->>'ok', 'true', 'anyone can read the catalogue');
  perform pg_temp.eq(c->'season'->>'season', '1', 'the live season');
  perform pg_temp.eq(jsonb_array_length(c->'cards')::text, '125', '125 cards');
  perform pg_temp.eq(jsonb_array_length(c->'sets')::text, '48', '48 sets');
  perform pg_temp.eq((c->'counts'->>'common') || '/' || (c->'counts'->>'rare') || '/' || (c->'counts'->>'epic') || '/' || (c->'counts'->>'legendary'), '94/29/2/0', 'counts by rarity, Legendary 0');
  select string_agg(t, ',' order by public.card_rank(t)) into n_tiers from jsonb_array_elements_text(c->'tiers') t;
  perform pg_temp.eq(n_tiers, 'common,rare,epic', 'tiers lists only the rarities the deck has: no Legendary');
  perform pg_temp.eq((select sum((s->>'count')::integer)::text from jsonb_array_elements(c->'sets') s), '125', 'the set counts add up');
  perform pg_temp.ok(not (c->'cards'->0 ? 'fact') and (c->'cards'->0 ? 'known_for') and (c->'cards'->0->'art' ? 'thumb') and (c->'cards'->0->'geo' ? 'lat'), 'the catalogue cards are compact: no back text, with art paths and a point');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(c->'cards') x where x->>'rarity' = 'legendary'), 'no Legendary card is listed');

  -- a collection: five Commons, two Rares, an Epic, and YAB-01 stamped
  for i in 1..5 loop perform pg_temp.grant(u, 'common'); end loop;
  for i in 1..2 loop perform pg_temp.grant(u, 'rare'); end loop;
  perform pg_temp.grant(u, 'epic');
  perform pg_temp.own(u, yaba);
  pos := (select geog from public.cards where id = yaba); perform pg_temp.fix(u, pos);
  perform pg_temp.eq(pg_temp.visit(u, yaba, pos)->>'xp', '30', 'YAB-01 is a place card in Yaba: stamped and paid');
  perform pg_temp.as_user(u); r := public.my_collection(); perform pg_temp.as_admin();
  perform pg_temp.eq(r->>'ok', 'true', 'my_collection answers');
  perform pg_temp.eq(r->>'season', '1', 'it names the live season');
  select sum((o->>'count')::integer) into sum_count from jsonb_array_elements(r->'owned') o;
  perform pg_temp.eq(sum_count::text, '9', 'nine copies');
  perform pg_temp.eq(r->'totals'->>'copies', '9', 'totals.copies');
  perform pg_temp.eq(r->'totals'->>'cards', jsonb_array_length(r->'owned')::text, 'totals.cards is the number of entries');
  perform pg_temp.eq(r->'totals'->>'of', '125', 'out of 125');
  perform pg_temp.eq(r->'totals'->>'visited', '1', 'one stamp');
  perform pg_temp.eq(r->'owned'->0->'card'->>'rarity', 'epic', 'the best card first');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r->'owned') o where jsonb_array_length(o->'copies') <> (o->>'count')::integer), 'each entry lists its copies');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'owned') o where o->'card'->>'key' = 'YAB-01' and (o->>'visited')::boolean and o->>'visited_on' = public.lagos_play_day()::text), 'YAB-01 is visited, with the play-day');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'owned') o where o->'card' ? 'fact' and o->'card' ? 'question'), 'an owned card carries its back text');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r->'owned') o, jsonb_array_elements(o->'copies') cp where o->'card'->>'rarity' in ('rare', 'epic') and cp->>'copy_no' is null), 'every Rare and Epic copy has its number');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r->'owned') o, jsonb_array_elements(o->'copies') cp where o->'card'->>'rarity' = 'common' and cp->>'copy_no' is not null), 'a Common has none');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'sets') s where s->>'key' = 'yaba' and s->>'visited' = '1' and s->>'total' = '10' and (s->>'owned')::integer >= 1), 'set progress: the Yaba set, 10 cards, one visited');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r->'sets') s where s->>'owned' = '0'), 'only sets you hold a card of are listed');
  perform pg_temp.eq(r->'pity'->>'rare_by', '10', 'the Rare guarantee is told');
  perform pg_temp.eq(r->'pity'->>'epic_by', '60', 'and the Epic one');
  perform pg_temp.eq(r->'pity'->>'since_epic', '0', 'an Epic just came');
  perform pg_temp.eq(r->'stamps'->>'paid_today', '1', 'one paid stamp today');
  perform pg_temp.eq(r->'stamps'->>'paid_max', '3', 'out of 3');
  -- nobody else's cards show
  perform pg_temp.as_user(u2); r := public.my_collection(); perform pg_temp.as_admin();
  perform pg_temp.ok(r->>'ok' = 'true' and jsonb_array_length(r->'owned') = 0 and r->'totals'->>'copies' = '0', 'another Hopper starts empty');
  perform pg_temp.as_nosub(); r := public.my_collection(); perform pg_temp.as_admin();
  perform pg_temp.eq(r->>'reason', 'no_session', 'no session, no collection');
  raise notice 'ok: catalogue and collection';
end $t$;

-- --------------------------------------------------------- Today's box ---
do $t$
declare
  u uuid; r jsonb; r2 jsonb; i integer; bad integer := 0; got integer := 0; xp_box integer;
begin
  -- by default Today's box pays XP only, as before
  u := pg_temp.newuser();
  perform pg_temp.as_user(u); r := public.open_daily_box(); perform pg_temp.as_admin();
  perform pg_temp.ok((r->>'ok')::boolean and jsonb_exists(r, 'card') and r->'card' = 'null'::jsonb, 'off by default: card is null: ' || r::text);
  perform pg_temp.eq((select count(*) from public.user_cards where user_id = u)::text, '0', 'and no card is made');
  perform pg_temp.eq((select xp::text from public.profiles where id = u), r->>'xp', 'the XP is the box''s');

  -- staff switch it on, capped at Rare
  update public.card_rules set value = '{"max_tier":"rare"}' where key = 'daily_box';
  u := pg_temp.newuser();
  perform pg_temp.as_user(u); r := public.open_daily_box(); perform pg_temp.as_admin();
  perform pg_temp.ok((r->>'ok')::boolean and not (r->>'already')::boolean and r->'card' <> 'null'::jsonb, 'on: the box pays a card: ' || r::text);
  perform pg_temp.ok(r->'card'->>'rarity' in ('common', 'rare'), 'never above the cap: ' || (r->'card'->>'rarity'));
  perform pg_temp.eq((select xp::text from public.profiles where id = u), r->>'xp', 'the XP is still only the box''s');
  perform pg_temp.eq((select source || '/' || (source_id = d.id)::text from public.user_cards uc join public.daily_boxes d on d.user_id = uc.user_id and d.day = (now() at time zone 'Africa/Lagos')::date where uc.user_id = u),
                     'daily/true', 'the copy points at today''s box');
  -- a second call the same day: the same answer, no second card
  perform pg_temp.as_user(u); r2 := public.open_daily_box(); perform pg_temp.as_admin();
  perform pg_temp.ok((r2->>'already')::boolean and r2->'card'->>'key' = r->'card'->>'key', 'the repeat call shows the same card');
  perform pg_temp.eq((select count(*) from public.user_cards where user_id = u)::text, '1', 'and no second copy');
  perform pg_temp.eq((select xp::text from public.profiles where id = u), r->>'xp', 'and no second XP');

  -- capped at Common: thirty Hoppers, all Common
  update public.card_rules set value = '{"max_tier":"common"}' where key = 'daily_box';
  for i in 1..30 loop
    u := pg_temp.newuser();
    perform pg_temp.as_user(u); r := public.open_daily_box(); perform pg_temp.as_admin();
    if r->'card' <> 'null'::jsonb then got := got + 1; if r->'card'->>'rarity' <> 'common' then bad := bad + 1; end if; end if;
  end loop;
  perform pg_temp.eq(got::text, '30', 'every box paid a card');
  perform pg_temp.eq(bad::text, '0', 'and every card was Common');
  update public.card_rules set value = '{"max_tier":null}' where key = 'daily_box';
  raise notice 'ok: Today''s box';
end $t$;

-- ---------------------------------------------------------- RLS and grants ---
do $t$
declare
  a uuid := pg_temp.newuser(); b2 uuid := pg_temp.newuser(); e text; n bigint; live_n bigint; t text; i integer; g uuid; res jsonb;
  tables text[] := array['cards', 'card_sets', 'card_seasons', 'card_stock', 'user_cards', 'card_visits', 'card_pity', 'card_rules'];
begin
  perform pg_temp.grant(a, 'common'); perform pg_temp.grant(a, 'rare'); perform pg_temp.grant(a, 'common');
  perform pg_temp.grant(b2, 'common'); perform pg_temp.grant(b2, 'epic');
  insert into public.card_visits (user_id, card_id, visited_on) select user_id, card_id, public.lagos_play_day() from public.user_cards where user_id in (a, b2) on conflict do nothing;
  insert into public.cards (key, season, set_id, division, name, category, rarity, geog, geo_kind, radius_m, front_path, back_path, thumb_path, status, signed_off)
  select 'RLD', 1, set_id, division, 'A draft', category, 'common', geog, 'place', 150, '/f', '/b', '/t', 'draft', false from public.cards where key = 'YAB-01';
  select count(*) into live_n from public.cards where status = 'live' and signed_off;

  -- every table has RLS on; the catalogue tables have a read policy, the Hopper tables an owner one, the other two none
  perform pg_temp.eq((select count(*) from pg_class where relname = any (tables) and relnamespace = 'public'::regnamespace and relrowsecurity)::text, '8', 'RLS is on for all eight tables');
  perform pg_temp.eq((select string_agg(c.relname || ':' || (select count(*) from pg_policy p where p.polrelid = c.oid), ',' order by c.relname) from pg_class c where c.relname = any (tables) and c.relnamespace = 'public'::regnamespace),
                     'card_pity:1,card_rules:0,card_seasons:1,card_sets:1,card_stock:0,card_visits:1,cards:1,user_cards:1', 'one policy each, none on stock and rules');
  perform pg_temp.eq((select string_agg(distinct p.polcmd::text, ',') from pg_policy p where p.polrelid = any (array(select oid from pg_class where relname = any (tables) and relnamespace = 'public'::regnamespace))), 'r', 'every policy is a read');

  -- anyone reads the live catalogue, and only that
  perform pg_temp.as_anon();
  select count(*) into n from public.cards; perform pg_temp.eq(n::text, live_n::text, 'anon reads every live card and not the draft');
  select count(*) into n from public.cards where key = 'RLD'; perform pg_temp.eq(n::text, '0', 'a draft card is invisible');
  select count(*) into n from public.card_sets; perform pg_temp.eq(n::text, '48', 'anon reads the sets');
  select count(*) into n from public.card_seasons; perform pg_temp.ok(n >= 2, 'and the seasons');
  foreach t in array array['card_stock', 'user_cards', 'card_visits', 'card_pity', 'card_rules'] loop
    e := pg_temp.throws('select count(*) from public.' || t);
    perform pg_temp.ok(e like '42501:%', 'anon cannot read ' || t || ': ' || coalesce(e, 'it could'));
  end loop;
  foreach t in array array['public.my_collection()', 'public.visit_card(gen_random_uuid(), 6.5, 3.4, null)', 'public.grant_card(gen_random_uuid(), ''common'', null, ''common'')',
                           'public.pick_card(gen_random_uuid(), ''common'')', 'public.add_card_prizes(gen_random_uuid())', 'public.card_pool(gen_random_uuid(), ''common'')',
                           'public.card_json(gen_random_uuid())', 'public.card_rule(''visit'')', 'public.card_for_source(gen_random_uuid(), ''daily'', gen_random_uuid())'] loop
    e := pg_temp.throws('select ' || t);
    perform pg_temp.ok(e like '42501:%', 'anon cannot call ' || t || ': ' || coalesce(e, 'it could'));
  end loop;
  e := pg_temp.throws('select public.card_catalog()'); perform pg_temp.eq(e, null, 'anon can call card_catalog');
  perform pg_temp.as_admin();

  -- a Hopper reads their own copies, stamps and counters and nobody else's
  perform pg_temp.as_user(a);
  select count(*) into n from public.user_cards; perform pg_temp.eq(n::text, '3', 'a sees their 3 copies');
  select count(*) into n from public.user_cards where user_id = b2; perform pg_temp.eq(n::text, '0', 'and none of b''s');
  select count(*) into n from public.card_visits; perform pg_temp.eq(n::text, (select count(distinct card_id) from public.user_cards where user_id = a)::text, 'a sees only their stamps');
  select count(*) into n from public.card_visits where user_id = b2; perform pg_temp.eq(n::text, '0', 'and none of b''s stamps');
  select count(*) into n from public.card_pity; perform pg_temp.eq(n::text, '1', 'a sees their own counter row');
  select count(*) into n from public.cards; perform pg_temp.eq(n::text, live_n::text, 'a reads the live catalogue');
  foreach t in array array['card_stock', 'card_rules'] loop
    e := pg_temp.throws('select count(*) from public.' || t);
    perform pg_temp.ok(e like '42501:%', 'a cannot read ' || t);
  end loop;
  -- and cannot write anything, or give a card away
  foreach t in array array['insert into public.user_cards (user_id, card_id) select user_id, card_id from public.user_cards',
                           'update public.user_cards set user_id = gen_random_uuid()', 'delete from public.user_cards',
                           'insert into public.card_visits (user_id, card_id, visited_on) select user_id, card_id, visited_on from public.card_visits', 'update public.card_visits set xp_paid = true', 'delete from public.card_visits',
                           'update public.card_pity set since_rare = 99', 'delete from public.card_pity', 'insert into public.card_pity (user_id) values (gen_random_uuid())',
                           'update public.cards set rarity = ''epic''', 'delete from public.cards', 'insert into public.cards (key) values (''x'')',
                           'update public.card_stock set copies_issued = 0', 'update public.card_rules set value = ''{}''',
                           'update public.card_seasons set live = false', 'update public.card_sets set name = ''x'''] loop
    e := pg_temp.throws(t);
    perform pg_temp.ok(e like '42501:%', 'a Hopper cannot: ' || t || ' (' || coalesce(e, 'it ran') || ')');
  end loop;
  foreach t in array array['public.grant_card(gen_random_uuid(), ''common'', null, ''common'')', 'public.add_card_prizes(gen_random_uuid())', 'public.pick_card(gen_random_uuid(), ''common'')'] loop
    e := pg_temp.throws('select ' || t);
    perform pg_temp.ok(e like '42501:%', 'a Hopper cannot call ' || t);
  end loop;
  res := public.my_collection(); perform pg_temp.eq(res->'totals'->>'copies', '3', 'a''s my_collection shows only a''s copies');
  perform pg_temp.as_admin();

  -- organisers cannot mint cards: card_max_tier is refused from a browser session
  alter table public.game_drops disable row level security;
  grant insert, update on public.game_drops to authenticated;
  perform pg_temp.as_user(a);
  e := pg_temp.throws($q$ insert into public.game_drops (title, geog, opens_at, closes_at, kind, card_max_tier) values ('T mint', st_point(3.38, 6.52)::geography, now(), now() + interval '1 hour', 'staff', 'legendary') $q$);
  perform pg_temp.ok(e like '42501:%Only staff%', 'a Hopper cannot make a box that pays a card: ' || coalesce(e, 'it went in'));
  e := pg_temp.throws($q$ insert into public.game_drops (title, geog, opens_at, closes_at, kind) values ('T plain', st_point(3.38, 6.52)::geography, now(), now() + interval '1 hour', 'staff') $q$);
  perform pg_temp.eq(e, null, 'but a plain box is fine');
  e := pg_temp.throws($q$ update public.game_drops set card_max_tier = 'epic' where title = 'T plain' $q$);
  perform pg_temp.ok(e like '42501:%Only staff%', 'and cannot add the cap later: ' || coalesce(e, 'it went in'));
  e := pg_temp.throws($q$ update public.game_drops set title = 'T plain 2' where title = 'T plain' $q$);
  perform pg_temp.eq(e, null, 'other edits are untouched');
  perform pg_temp.as_admin();
  update public.game_drops set card_max_tier = 'epic' where title = 'T plain 2';
  perform pg_temp.eq((select card_max_tier from public.game_drops where title = 'T plain 2'), 'epic', 'the service side can set it');
  execute 'set local role service_role';
  update public.game_drops set card_max_tier = 'rare' where title = 'T plain 2';
  perform pg_temp.as_admin();
  perform pg_temp.eq((select card_max_tier from public.game_drops where title = 'T plain 2'), 'rare', 'and so can the service role');
  revoke insert, update on public.game_drops from authenticated;
  alter table public.game_drops enable row level security;

  -- who may do what to the tables, by privilege
  perform pg_temp.eq((select count(*) from unnest(tables) x where has_table_privilege('authenticated', 'public.' || x, 'INSERT') or has_table_privilege('authenticated', 'public.' || x, 'UPDATE')
                       or has_table_privilege('authenticated', 'public.' || x, 'DELETE') or has_table_privilege('anon', 'public.' || x, 'INSERT')
                       or has_table_privilege('anon', 'public.' || x, 'UPDATE') or has_table_privilege('anon', 'public.' || x, 'DELETE'))::text, '0', 'no client role can write any card table');
  perform pg_temp.eq((select string_agg(x, ',' order by x) from unnest(tables) x where has_table_privilege('anon', 'public.' || x, 'SELECT')), 'card_seasons,card_sets,cards', 'anon can read only the catalogue tables');
  raise notice 'ok: RLS and grants';
end $t$;

-- ------------------------------------------------------ nothing for sale ---
do $t$
declare e text; res jsonb; d uuid; u uuid := pg_temp.newuser();
begin
  -- no price, naira, cash-out or payment column anywhere in the card tables
  perform pg_temp.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('cards', 'card_sets', 'card_seasons', 'card_stock', 'user_cards', 'card_visits', 'card_pity', 'card_rules')
                       and column_name ~* '(price|naira|ngn|usd|cash|money|payment|cost|currency|sale|sell|buy|fee|wallet)')::text, '0', 'no money column in the card tables');
  -- no function that buys, sells, trades, gifts or transfers a card
  perform pg_temp.eq((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like '%card%'
                       and proname ~* '(buy|sell|sale|price|purchase|trade|gift|transfer|cashout|withdraw|redeem|swap|list)')::text, '0', 'no function that moves or sells a card');
  -- the catalogue and a claim say nothing of money
  perform pg_temp.ok(public.card_catalog()::text !~* '"(price|cost|naira|ngn|usd|currency)"', 'the catalogue has no price');
  -- a card prize never takes the voucher path: no code, no reward code claimed
  d := pg_temp.box1(u, pg_temp.pt(6.5158, 3.3792), 'common', 'common', 10);
  res := pg_temp.claim(u, d, 6.5158, 3.3792);
  perform pg_temp.ok((res->>'ok')::boolean and res->>'code' is null, 'a card claim carries no voucher code: ' || res::text);
  perform pg_temp.eq((select count(*) from public.drop_reward_codes where claimed_by = u)::text, '0', 'and takes no code');
  -- the only way a card changes hands is a box: user_cards has no insert path for a client, shown above, and no function takes a user other than the claimer
  perform pg_temp.eq((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('visit_card', 'my_collection', 'card_catalog')
                       and has_function_privilege('authenticated', p.oid, 'EXECUTE') and pg_get_function_arguments(p.oid) ~* 'user')::text, '0', 'no client function takes a user');
  raise notice 'ok: nothing for sale';
end $t$;

-- ------------------------------------------------- other prizes, unchanged ---
do $t$
declare u uuid := pg_temp.newuser(); b geography := pg_temp.pt(6.5158, 3.3792); d uuid; r jsonb;
begin
  d := pg_temp.box(u, b, 'staff');
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount) values (d, 'xp', 'Plain find', 40);
  r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
  perform pg_temp.ok((r->>'ok')::boolean and r->>'xp' = '40' and r->>'reward' = 'Plain find' and r->'card' = 'null'::jsonb, 'an XP prize: same answer, card null: ' || r::text);
  perform pg_temp.eq((select xp::text from public.profiles where id = u), '40', 'and the same XP');
  perform pg_temp.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), 'card,claim_id,code,description,ok,reward,xp', 'the answer has the old keys and card');
  -- a second claim of the same box is refused as before
  r := pg_temp.claim(u, d, pg_temp.lat(b), pg_temp.lng(b));
  perform pg_temp.ok(not (r->>'ok')::boolean, 'a repeat is refused: ' || r::text);
  raise notice 'ok: other prizes are unchanged';
end $t$;

-- ------------------------------------------------------ run again, twice ---
-- cards.sql over live rows: nothing lost, nothing doubled, a rule staff changed kept.
select (:'sqldir' <> '') as rerun \gset
\if :rerun
  do $t$
  begin
    update public.card_rules set value = jsonb_set(value, '{xp}', '45') - 'citywide' where key = 'visit';
    update public.cards set status = 'retired' where key = 'YAB-01';
    update public.card_stock set copies_issued = 7, weight = 2 where card_id = pg_temp.id_of('MUS-45');
    create temp table pg_temp.keep_n on commit drop as select (select count(*) from public.user_cards) as copies, (select count(*) from public.cards) as cards;
    raise notice 'ok: rows to keep are in';
  end $t$;
  \echo running cards.sql (1)
  \i :sqldir/cards.sql
  \echo running cards.sql (2)
  \i :sqldir/cards.sql
  do $t$
  declare t text;
  begin
    perform pg_temp.eq((select value->>'xp' from public.card_rules where key = 'visit'), '45', 'a rule staff changed is kept');
    perform pg_temp.eq((select value->>'citywide' from public.card_rules where key = 'visit'), 'lagos', 'and a setting the row lacked is added');
    perform pg_temp.eq((select status from public.cards where key = 'YAB-01'), 'retired', 'a retired card stays retired');
    perform pg_temp.eq((select copies_issued || '/' || weight from public.card_stock where card_id = pg_temp.id_of('MUS-45')), '7/2', 'counters and weights are kept');
    perform pg_temp.eq((select count(*) from public.cards)::text, (select count(*) from public.card_stock)::text, 'one stock row per card');
    perform pg_temp.eq((select count(*) from public.user_cards)::text, (select copies from pg_temp.keep_n)::text, 'copies are kept');
    perform pg_temp.eq((select count(*) from public.cards)::text, (select cards from pg_temp.keep_n)::text, 'cards are kept');
    perform pg_temp.eq((select string_agg(c.relname || ':' || (select count(*) from pg_policy p where p.polrelid = c.oid), ',' order by c.relname) from pg_class c
                         where c.relname in ('cards', 'card_sets', 'card_seasons', 'card_stock', 'user_cards', 'card_visits', 'card_pity', 'card_rules') and c.relnamespace = 'public'::regnamespace),
                       'card_pity:1,card_rules:0,card_seasons:1,card_sets:1,card_stock:0,card_visits:1,cards:1,user_cards:1', 'no policy is doubled');
    perform pg_temp.eq((select count(*) from pg_trigger where not tgisinternal and tgname in ('cards_stock_row', 'cards_guard', 'game_drops_card_guard'))::text, '3', 'no trigger is doubled');
    perform pg_temp.eq((select count(*) from pg_constraint where conname in ('activity_log_action_check', 'drop_rewards_reward_type_check', 'drop_rewards_card_tier_check', 'game_drops_card_max_tier_check'))::text, '4', 'no constraint is doubled');
    perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'activity_log_action_check') like '%''daily''%'
                       and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'activity_log_action_check') like '%''card_visit''%', 'the action list keeps daily and adds card_visit');
    perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'drop_rewards_reward_type_check') like '%''collectible''%'
                       and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'drop_rewards_reward_type_check') like '%''card''%', 'the reward types keep collectible and add card');
    perform pg_temp.ok((select prosrc like '%grant_card%' from pg_proc where oid = 'public.claim_game_drop(uuid,double precision,double precision,text)'::regprocedure), 'claim_game_drop still carries the card hook');
    perform pg_temp.ok((select prosrc like '%grant_card%' from pg_proc where oid = 'public.open_daily_box()'::regprocedure), 'open_daily_box too');
    perform pg_temp.ok((public.card_catalog()->>'ok')::boolean, 'the catalogue still answers');
    raise notice 'ok: cards.sql ran twice over live rows';
  end $t$;
\else
  do $t$ begin raise notice 'skipped: the rerun check (pass -v sqldir=/tmp/hoppaz-sql, see the top of this file)'; end $t$;
\endif

do $t$ begin raise notice 'ALL CARD TESTS PASSED'; end $t$;

rollback;
