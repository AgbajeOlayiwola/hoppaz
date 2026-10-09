-- ============================================================================
-- Hoppaz: the SQL files can be run again, in the documented order
-- Proves that spawning.sql then play.sql run twice on a database that already
-- holds 'near', 'special' and 'avatar' rows (the case that used to fail: the
-- old spawning.sql re-added a kind check without 'near' and 'special').
--
-- Run against a LOCAL database that already has the whole load order applied.
-- psql reads the SQL files from inside the database container, so copy them in
-- first, then run this file (the folder is a psql variable, default below):
--   docker cp supabase/. supabase_db_hoppaz-local:/tmp/hoppaz-sql
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/sql_rerun_test.sql
-- (add  -v sqldir=/some/other/folder  to read the files from somewhere else)
--
-- One transaction that always rolls back, so nothing is kept: the test rows,
-- and everything the four runs change, are undone. The files must not hold
-- their own begin or commit (spawning.sql and play.sql do not). box_guards.sql
-- does, so it is not part of this test; its own test covers it. The last line
-- printed is ALL RERUN TESTS PASSED.
-- ============================================================================
\if :{?sqldir}
\else
  \set sqldir /tmp/hoppaz-sql
\endif

begin;

create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $f$
begin
  if p_cond is not true then raise exception 'TEST FAILED: %', p_msg; end if;
end $f$;

create function pg_temp.eq(p_got text, p_want text, p_msg text) returns void language plpgsql as $f$
begin
  if p_got is distinct from p_want then raise exception 'TEST FAILED: % (got %, wanted %)', p_msg, p_got, p_want; end if;
end $f$;

-- ------------------------------------------------------------ rows to keep ---
-- Open sea south of Lagos, with the zones cleared (inside this transaction only), so the box guard lets the rows in.
delete from public.no_spawn_zones;

create table pg_temp.keep (id uuid, kind text, claim_method text);

do $t$
declare
  u uuid := gen_random_uuid(); v uuid; k text; m text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rerun-' || u || '@rerun.invalid', '{}', '{}', now(), now());
  -- the first line is the case play.sql makes: a small box that sends the avatar (needs no presence); the rest are the kinds and methods the full lists allow
  for k, m in values ('near', 'proximity'), ('near', 'avatar'), ('special', 'proximity'), ('special', 'avatar'), ('spawn', 'avatar'), ('staff', 'avatar'), ('welcome', 'proximity') loop
    insert into public.game_drops (title, geog, opens_at, closes_at, claim_method, max_claims, kind, owner_id, radius_m)
    values ('T rerun ' || k || ' ' || m, st_point(3.70, 6.31)::geography, now(), now() + interval '1 hour', m, 1, k,
            case when k in ('near', 'special', 'welcome') then u end, 60)
    returning id into v;
    insert into pg_temp.keep values (v, k, m);
  end loop;
  insert into public.play_fix (user_id, lat, lng) values (u, 6.31, 3.70);
  perform pg_temp.eq((select count(*) from pg_temp.keep)::text, '7', 'seven rows to keep');
  raise notice 'ok: rows with near, special and avatar are in';
end $t$;

-- ------------------------------------------------ spawning.sql, play.sql, twice ---
\echo running spawning.sql (1)
\i :sqldir/spawning.sql

-- spawning.sql puts its own claim_game_drop and welcome layout back: that is why play.sql goes last
do $t$
begin
  perform pg_temp.ok((select prosrc not like '%needs_presence%' from pg_proc where oid = 'public.claim_game_drop(uuid,double precision,double precision,text)'::regprocedure),
                     'spawning.sql restores the old claim_game_drop');
  perform pg_temp.eq((select count(*) from pg_temp.keep k join public.game_drops g on g.id = k.id)::text, '7', 'rows survive spawning.sql');
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'game_drops_kind_check' and conrelid = 'public.game_drops'::regclass) ~ 'near.*special', 'spawning.sql holds the full kind list');
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'game_drops_claim_method_check' and conrelid = 'public.game_drops'::regclass) ~ 'avatar', 'spawning.sql holds the full claim_method list');
  raise notice 'ok: spawning.sql ran over near, special and avatar rows';
end $t$;

\echo running play.sql (1)
\i :sqldir/play.sql
\echo running spawning.sql (2)
\i :sqldir/spawning.sql
\echo running play.sql (2)
\i :sqldir/play.sql

-- ------------------------------------------------------------------ checks ---
do $t$
declare
  u uuid; res jsonb;
begin
  perform pg_temp.eq((select count(*) from pg_temp.keep k join public.game_drops g on g.id = k.id and g.kind = k.kind and g.claim_method = k.claim_method)::text, '7', 'every row is still there, unchanged');
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'game_drops_kind_check' and conrelid = 'public.game_drops'::regclass)
                     ~ 'staff.*spawn.*welcome.*near.*special', 'kind check holds the full list');
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'game_drops_claim_method_check' and conrelid = 'public.game_drops'::regclass)
                     ~ 'proximity.*qr.*either.*avatar', 'claim_method check holds the full list');
  perform pg_temp.eq((select count(*) from pg_constraint where conrelid = 'public.game_drops'::regclass and conname in ('game_drops_kind_check', 'game_drops_claim_method_check'))::text, '2', 'one of each check');
  -- play.sql ran last, so its functions are the ones in place
  perform pg_temp.ok((select prosrc like '%needs_presence%' from pg_proc where oid = 'public.claim_game_drop(uuid,double precision,double precision,text)'::regprocedure), 'claim_game_drop is the Play version');
  perform pg_temp.ok((select prosrc like '%90 + random() * 40%' from pg_proc where oid = 'public.spawn_welcome_boxes_for(uuid,double precision,double precision,boolean)'::regprocedure), 'the welcome layout is the Play version');
  perform pg_temp.ok(exists (select 1 from pg_proc where oid = 'public.play_tick(double precision,double precision,double precision)'::regprocedure), 'play_tick exists');
  perform pg_temp.ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_drops' and column_name = 'needs_presence'), 'needs_presence exists');
  -- the policies and jobs are not doubled
  perform pg_temp.eq((select count(*) from pg_policy where polrelid = 'public.game_drops'::regclass and polname = 'drops_read_active')::text, '1', 'one drops_read_active policy');
  perform pg_temp.eq((select count(*) from pg_policy where polrelid = 'public.play_fix'::regclass)::text, '0', 'play_fix still has no policy');
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.eq((select count(*) from cron.job where jobname = 'hoppaz-spawn-boxes')::text, '1', 'one spawn job');
    perform pg_temp.eq((select count(*) from cron.job where jobname = 'hoppaz-purge-play-fix')::text, '1', 'one purge job');
  end if;
  -- the Hopper's play_fix row survived the reruns, and the heartbeat still works
  select user_id into u from public.play_fix where lat = 6.31 and lng = 3.70 and user_id in (select owner_id from public.game_drops g join pg_temp.keep k on k.id = g.id) limit 1;
  perform pg_temp.ok(u is not null, 'play_fix row survived');
  update public.play_fix set at = now() - interval '1 minute' where user_id = u;
  res := public.play_tick_for(u, 6.31, 3.70, 10, true, false);
  perform pg_temp.eq(res->>'ok', 'true', 'play_tick_for works after the reruns: ' || res::text);
  raise notice 'ok: spawning.sql and play.sql ran twice over near, special and avatar rows';
end $t$;

do $t$ begin raise notice 'ALL RERUN TESTS PASSED'; end $t$;

rollback;
