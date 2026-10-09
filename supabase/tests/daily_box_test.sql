-- ============================================================================
-- Hoppaz: Today's box tests
-- Run against a LOCAL database that already has schema.sql, hunt_items.sql,
-- spawning.sql and daily_box.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/daily_box_test.sql
--
-- One transaction that always rolls back, so nothing is kept. Every check
-- raises an exception on failure; the last line printed is
-- ALL DAILY BOX TESTS PASSED.
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

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dailytest-' || u || '@dailytest.invalid', '{}', '{}', now(), now());
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

-- ------------------------------------------------------- the prize table ---
do $t$
declare r record;
begin
  -- the edges of every band
  select * into r from public.daily_box_roll(0);       perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Small find/15/common', 'roll 0');
  select * into r from public.daily_box_roll(0.5999);  perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Small find/15/common', 'roll 0.5999');
  select * into r from public.daily_box_roll(0.60);    perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Good find/30/rare', 'roll 0.60');
  select * into r from public.daily_box_roll(0.8999);  perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Good find/30/rare', 'roll 0.8999');
  select * into r from public.daily_box_roll(0.90);    perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Big find/75/epic', 'roll 0.90');
  select * into r from public.daily_box_roll(0.9899);  perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Big find/75/epic', 'roll 0.9899');
  select * into r from public.daily_box_roll(0.99);    perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Jackpot/200/legendary', 'roll 0.99');
  select * into r from public.daily_box_roll(0.999999); perform pg_temp.eq(r.title || '/' || r.xp || '/' || r.rarity, 'Jackpot/200/legendary', 'roll 0.999999');
  -- the odds add up: 60 + 30 + 9 + 1 over a fine sweep of [0, 1)
  perform pg_temp.eq(
    (select string_agg(title || ':' || n, ',' order by n desc) from (select title, count(*) n from generate_series(0, 9999) g, lateral public.daily_box_roll(g / 10000.0) group by title) s),
    'Small find:6000,Good find:3000,Big find:900,Jackpot:100', 'prize weights');
  raise notice 'ok: prize table';
end $t$;

-- ------------------------------------------------ once a day, xp, streak ---
do $t$
declare
  u uuid := pg_temp.newuser();
  a jsonb; b jsonb; xp0 integer; xp1 integer; today date := (now() at time zone 'Africa/Lagos')::date; stats jsonb;
begin
  xp0 := (select xp from public.profiles where id = u);
  perform pg_temp.ok(xp0 = 0, 'a new profile starts at 0 XP');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where user_id = u), 'a new Hopper has no activity');

  -- first open
  perform pg_temp.as_user(u); a := public.open_daily_box(); perform pg_temp.as_admin();
  perform pg_temp.ok((a->>'ok')::boolean and not (a->>'already')::boolean, 'first call opens the box');
  perform pg_temp.ok((a->>'xp')::integer in (15, 30, 75, 200), 'xp is one of the four prizes');
  perform pg_temp.ok((a->>'title') in ('Small find', 'Good find', 'Big find', 'Jackpot'), 'title is one of the four prizes');
  perform pg_temp.ok((a->>'rarity') in ('common', 'rare', 'epic', 'legendary'), 'rarity is returned');
  xp1 := (select xp from public.profiles where id = u);
  perform pg_temp.eq(xp1 || '', a->>'xp', 'the XP was added to the profile');
  perform pg_temp.eq((select count(*) from public.daily_boxes where user_id = u and day = today) || '', '1', 'one daily_boxes row for today');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u and action = 'daily') || '', '1', 'one activity_log row');
  perform pg_temp.eq((select outside_score from public.activity_log where user_id = u and action = 'daily') || '', '0', 'a daily box scores nothing outside');
  perform pg_temp.ok((select l.source_id = d.id from public.activity_log l join public.daily_boxes d on d.user_id = l.user_id and d.day = today where l.user_id = u and l.action = 'daily'), 'the log row points at the box');

  -- the streak counts it
  perform pg_temp.as_user(u); stats := public.my_game_stats(); perform pg_temp.as_admin();
  perform pg_temp.eq(stats->>'daily_streak', '1', 'the box makes a 1 day streak');
  perform pg_temp.eq(stats->>'outside_score', '0', 'and adds nothing to the Outside Score');

  -- second open, the same day: nothing changes
  perform pg_temp.as_user(u); b := public.open_daily_box(); perform pg_temp.as_admin();
  perform pg_temp.ok((b->>'ok')::boolean and (b->>'already')::boolean, 'second call says already');
  perform pg_temp.eq(b->>'title' || '/' || (b->>'xp') || '/' || (b->>'rarity'), a->>'title' || '/' || (a->>'xp') || '/' || (a->>'rarity'), 'second call returns today''s result');
  perform pg_temp.eq((select xp from public.profiles where id = u) || '', xp1 || '', 'no second payout');
  perform pg_temp.eq((select count(*) from public.daily_boxes where user_id = u) || '', '1', 'still one row');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u and action = 'daily') || '', '1', 'still one activity row');

  -- yesterday's box was opened: today's is a new box and the streak is 2
  update public.daily_boxes set day = day - 1, opened_at = opened_at - interval '1 day' where user_id = u;
  update public.activity_log set created_at = created_at - interval '1 day' where user_id = u and action = 'daily';
  perform pg_temp.as_user(u); b := public.open_daily_box(); stats := public.my_game_stats(); perform pg_temp.as_admin();
  perform pg_temp.ok((b->>'ok')::boolean and not (b->>'already')::boolean, 'a new day opens a new box');
  perform pg_temp.eq((select count(*) from public.daily_boxes where user_id = u) || '', '2', 'two rows over two days');
  perform pg_temp.eq(stats->>'daily_streak', '2', 'two days in a row is a 2 day streak');
  perform pg_temp.eq((select xp from public.profiles where id = u) || '', (xp1 + (b->>'xp')::integer) || '', 'the second day paid too');
  raise notice 'ok: once a day, xp, streak';
end $t$;

-- -------------------------------------------------------- this week's days ---
do $t$
declare
  u uuid := pg_temp.newuser();
  today date := (now() at time zone 'Africa/Lagos')::date;
  monday date := date_trunc('week', now() at time zone 'Africa/Lagos')::date;
  days date[]; r jsonb;
begin
  perform pg_temp.as_user(u); days := array(select public.my_week_days()); perform pg_temp.as_admin();
  perform pg_temp.eq(coalesce(array_length(days, 1), 0) || '', '0', 'no activity, no days');

  perform pg_temp.as_user(u); r := public.open_daily_box(); days := array(select public.my_week_days()); perform pg_temp.as_admin();
  perform pg_temp.eq(array_to_string(days, ','), today::text, 'today shows once the box is open');

  -- an old row (last week) is not in this week; one on Monday is
  insert into public.activity_log (user_id, action, source_id, outside_score, created_at)
  values (u, 'post', gen_random_uuid(), 0, (monday - 3)::timestamp at time zone 'Africa/Lagos' + interval '12 hours'),
         (u, 'post', gen_random_uuid(), 0, monday::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  perform pg_temp.as_user(u); days := array(select public.my_week_days()); perform pg_temp.as_admin();
  perform pg_temp.ok(monday = any (days), 'Monday is in the week');
  perform pg_temp.ok(today = any (days), 'today is in the week');
  perform pg_temp.ok(not ((monday - 3) = any (days)), 'last week is not');
  perform pg_temp.eq(array_length(days, 1) || '', case when monday = today then '1' else '2' end, 'only this week''s days, once each');

  -- another Hopper sees none of it
  perform pg_temp.as_user(pg_temp.newuser()); days := array(select public.my_week_days()); perform pg_temp.as_admin();
  perform pg_temp.eq(coalesce(array_length(days, 1), 0) || '', '0', 'other Hoppers'' days are not mine');
  raise notice 'ok: week days';
end $t$;

-- ------------------------------------------------------------- privileges ---
do $t$
declare
  u uuid := pg_temp.newuser();
  other uuid := pg_temp.newuser();
  r jsonb; n integer;
begin
  perform pg_temp.as_user(other); r := public.open_daily_box(); perform pg_temp.as_admin();

  -- the signed-out cannot call either function
  perform pg_temp.as_anon();
  begin perform public.open_daily_box(); raise exception 'TEST FAILED: anon opened a box';
  exception when insufficient_privilege then null; end;
  begin perform public.my_week_days(); raise exception 'TEST FAILED: anon read week days';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.daily_boxes limit 1; raise exception 'TEST FAILED: anon read daily_boxes';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();

  perform pg_temp.ok(has_function_privilege('authenticated', 'public.open_daily_box()', 'execute'), 'authenticated can open');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.my_week_days()', 'execute'), 'authenticated can read week days');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.open_daily_box()', 'execute'), 'anon cannot open');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.my_week_days()', 'execute'), 'anon cannot read week days');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.daily_box_roll(double precision)', 'execute'), 'the prize table is not public');

  -- a Hopper reads only their own rows, and cannot write any
  perform pg_temp.as_user(u); r := public.open_daily_box();
  select count(*) into n from public.daily_boxes;
  perform pg_temp.eq(n || '', '1', 'a Hopper sees only their own box');
  begin insert into public.daily_boxes (user_id, day, reward_title, xp, rarity) values (u, current_date - 5, 'Jackpot', 200, 'legendary');
    raise exception 'TEST FAILED: a Hopper wrote a daily_boxes row';
  exception when insufficient_privilege then null; end;
  begin update public.daily_boxes set xp = 200;
    raise exception 'TEST FAILED: a Hopper edited a daily_boxes row';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set xp = 9999 where id = u;
    raise exception 'TEST FAILED: a Hopper set their own XP';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();
  raise notice 'ok: privileges';
end $t$;

-- ------------------------------------------------ the Lagos day boundary ---
-- Lagos is UTC+1: 22:59:59 UTC is still today in Lagos, 23:00:00 UTC is already tomorrow.
do $t$
declare
  u uuid := pg_temp.newuser();
  monday date := date_trunc('week', now() at time zone 'Africa/Lagos')::date;
  turn timestamptz := (monday + 1)::timestamp at time zone 'Africa/Lagos';  -- Tuesday 00:00 in Lagos = Monday 23:00 UTC
  days date[]; stats jsonb;
begin
  perform pg_temp.eq(to_char(turn at time zone 'UTC', 'HH24:MI'), '23:00', 'a Lagos midnight is 23:00 UTC');
  insert into public.activity_log (user_id, action, source_id, outside_score, created_at)
  values (u, 'post', gen_random_uuid(), 0, turn - interval '1 second'),
         (u, 'post', gen_random_uuid(), 0, turn);
  perform pg_temp.as_user(u); days := array(select public.my_week_days()); perform pg_temp.as_admin();
  perform pg_temp.eq(array_to_string(days, ','), monday || ',' || (monday + 1), '22:59:59 UTC is Monday, 23:00:00 UTC is Tuesday');
  raise notice 'ok: day boundary';
end $t$;

-- A box row that already exists (the first of two calls at the same moment got there first):
-- the second call pays nothing and logs nothing, and answers with that row.
do $t$
declare
  u uuid := pg_temp.newuser();
  today date := (now() at time zone 'Africa/Lagos')::date;
  r jsonb;
begin
  insert into public.daily_boxes (user_id, day, reward_title, xp, rarity) values (u, today, 'Big find', 75, 'epic');
  perform pg_temp.as_user(u); r := public.open_daily_box(); perform pg_temp.as_admin();
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'already')::boolean, 'the loser of the race is told already');
  perform pg_temp.eq(r->>'title' || '/' || (r->>'xp'), 'Big find/75', 'and gets the winner''s box');
  perform pg_temp.eq((select xp from public.profiles where id = u) || '', '0', 'no payout from the losing call');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = u) || '', '0', 'and no activity row');
  raise notice 'ok: second call after the row exists';
end $t$;

-- ------------------------------------------- the check on activity_log.action ---
do $t$
declare def text; a text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conrelid = 'public.activity_log'::regclass and conname = 'activity_log_action_check';
  foreach a in array array['checkin', 'quest', 'photo', 'post', 'drop', 'crew', 'daily'] loop
    perform pg_temp.ok(def like '%''' || a || '''%', 'activity_log allows ' || a);
  end loop;
  raise notice 'ok: activity_log actions';
end $t$;

-- ------------------------------------------------ the Outside Score board ---
-- A Hopper who only opened daily boxes last month is not "#N in Lagos".
do $t$
declare
  stay uuid := pg_temp.newuser();
  went uuid := pg_temp.newuser();
  last_month date := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  mid timestamptz := (last_month + 14)::timestamp at time zone 'Africa/Lagos' + interval '12 hours';
  s jsonb; tok text; snap jsonb;
begin
  insert into public.activity_log (user_id, action, source_id, outside_score, created_at)
  values (stay, 'daily', gen_random_uuid(), 0, mid),
         (went, 'daily', gen_random_uuid(), 0, mid),
         (went, 'checkin', gen_random_uuid(), 100, mid);

  perform pg_temp.as_user(stay); s := public.my_game_stats(last_month); perform pg_temp.as_admin();
  perform pg_temp.eq(s->>'outside_score', '0', 'daily boxes only: no Outside Score');
  perform pg_temp.eq(s->>'active_days', '1', 'but it was an active day');
  perform pg_temp.eq(s->>'lagos_rank', '0', 'and no Lagos rank');

  perform pg_temp.as_user(went); s := public.my_game_stats(last_month); perform pg_temp.as_admin();
  perform pg_temp.ok((s->>'lagos_rank')::integer >= 1, 'a Hopper with a score is ranked');

  -- the month report card (the poster reads the snapshot)
  perform pg_temp.as_user(stay); tok := public.create_monthly_report(last_month); perform pg_temp.as_admin();
  select snapshot into snap from public.monthly_reports where share_token = tok;
  perform pg_temp.ok(snap->>'lagos_rank' is null, 'the report of a Hopper with no score has no rank');
  perform pg_temp.as_user(went); tok := public.create_monthly_report(last_month); perform pg_temp.as_admin();
  select snapshot into snap from public.monthly_reports where share_token = tok;
  perform pg_temp.ok((snap->>'lagos_rank')::integer >= 1, 'the report of a Hopper with a score has a rank');

  -- the public board lists nobody at 0, and does list the one who went out
  perform pg_temp.as_anon();
  perform pg_temp.ok(not exists (select 1 from public.monthly_leaderboard(last_month, 100) where outside_score <= 0), 'the board has no zero-score rows');
  perform pg_temp.ok(exists (select 1 from public.monthly_leaderboard(last_month, 100) where outside_score >= 100), 'the board lists a Hopper with a score');
  perform pg_temp.as_admin();
  raise notice 'ok: outside score board';
end $t$;

do $t$ begin raise notice 'ALL DAILY BOX TESTS PASSED'; end $t$;

rollback;
