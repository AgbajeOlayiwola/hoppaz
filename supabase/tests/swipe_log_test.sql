-- ============================================================================
-- Hoppaz: swipe log tests
-- Run against a LOCAL database that has schema.sql, chat_accounts.sql and
-- swipe_log.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/swipe_log_test.sql
--
-- One transaction that always rolls back, so nothing is kept. Every check
-- raises an exception on failure; the last line printed is
-- ALL SWIPE LOG TESTS PASSED. Inside one transaction now() does not move, so
-- every insert here falls inside the two-second double-fire window.
-- ============================================================================
begin;

create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $f$
begin
  if p_cond is not true then raise exception 'TEST FAILED: %', p_msg; end if;
end $f$;

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', now(), now());
  return u;
end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

create temp table t (k text primary key, v uuid);
grant all on t to authenticated;

do $t$
declare a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); ev uuid;
begin
  insert into public.events (title, venue_name, geog, starts_at, status)
  values ('Swipe log test night', 'Test venue', st_makepoint(3.38, 6.2)::geography, now() + interval '1 day', 'live')
  returning id into ev;
  insert into t values ('a', a), ('b', b), ('ev', ev);
end $t$;

-- A guest (no email, so no account) can log a swipe either way.
do $t$
declare a uuid := (select v from t where k = 'a'); ev uuid := (select v from t where k = 'ev'); n int;
begin
  perform pg_temp.as_user(a);
  insert into public.swipe_log (event_id, direction) values (ev, 'right');
  insert into public.swipe_log (event_id, direction) values (ev, 'right'); -- double fire: dropped
  insert into public.swipe_log (event_id, direction) values (ev, 'left');
  select count(*) into n from public.swipe_log where event_id = ev;
  perform pg_temp.ok(n = 2, 'a guest logs both ways, and a double fire is dropped (got ' || n || ')');
  perform pg_temp.ok((select bool_and(user_id = a) from public.swipe_log where event_id = ev), 'user_id defaults to the swiper');
  perform pg_temp.as_admin();
end $t$;

-- Nobody writes for someone else, reads someone else's, or changes the log.
do $t$
declare a uuid := (select v from t where k = 'a'); b uuid := (select v from t where k = 'b'); ev uuid := (select v from t where k = 'ev'); n int;
begin
  perform pg_temp.as_user(b);
  begin
    insert into public.swipe_log (user_id, event_id, direction) values (a, ev, 'left');
    raise exception 'TEST FAILED: b logged a swipe as a';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.swipe_log where event_id = ev;
  perform pg_temp.ok(n = 0, 'b cannot read a''s swipes');
  select coalesce(sum(rights + lefts), 0) into n from public.swipe_stats where event_id = ev;
  perform pg_temp.ok(n = 0, 'swipe_stats only counts your own swipes through the app');
  begin
    update public.swipe_log set direction = 'right' where event_id = ev;
    raise exception 'TEST FAILED: the log can be updated';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.swipe_log where event_id = ev;
    raise exception 'TEST FAILED: the log can be deleted from';
  exception when insufficient_privilege then null;
  end;
  insert into public.swipe_log (event_id, direction) values (ev, 'right');
  perform pg_temp.as_admin();
end $t$;

-- Staff see the whole picture.
do $t$
declare ev uuid := (select v from t where k = 'ev'); s record;
begin
  select * into s from public.swipe_stats where event_id = ev;
  perform pg_temp.ok(s.rights = 2 and s.lefts = 1, 'staff count 2 rights and 1 left');
  perform pg_temp.ok(s.hoppers_right = 2 and s.hoppers_left = 1, 'staff count the Hoppers each way');
end $t$;

do $t$ begin raise notice 'ALL SWIPE LOG TESTS PASSED'; end $t$;

rollback;
