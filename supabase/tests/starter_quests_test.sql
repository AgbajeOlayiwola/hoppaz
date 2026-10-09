-- ============================================================================
-- Hoppaz: starter quest tests
-- Run against a LOCAL database that already has schema.sql, chat_accounts.sql
-- and starter_quests.sql applied (the whole load order is fine):
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/starter_quests_test.sql
--
-- One transaction that always rolls back, so nothing is kept. Events, Hoppers,
-- crews and photos are made here, away from any real venue (open sea south of
-- Lagos). Every check raises an exception on failure; the last line printed is
-- ALL STARTER QUEST TESTS PASSED.
-- It covers: the kit when an event goes live, no duplicates, the backfill, the
-- code quest, the kit following a moved event, and claim_quest for each quest
-- type (check-in refused from away from the venue, photo through review, crew
-- of four, code), including the two fixes starter_quests.sql makes to it.
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
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kittest-' || u || '@kittest.invalid', '{}', '{}', now(), now());
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

-- an event at a test site (open sea), made by the service role like an import or an approval
create function pg_temp.newevent(p_title text, p_venue text, p_status text, p_starts timestamptz, p_ends timestamptz,
                                 p_lat double precision default 6.3401, p_lng double precision default 3.2001) returns uuid language plpgsql as $f$
declare e uuid;
begin
  insert into public.events (title, venue_name, geog, starts_at, ends_at, status)
  values (p_title, p_venue, st_point(p_lng, p_lat)::geography, p_starts, p_ends, p_status) returning id into e;
  return e;
end $f$;

-- the kit quest of an event by its short name (checkin, photo, squad, code)
create function pg_temp.kitq(p_event uuid, p_slug text) returns uuid language sql as $f$
  select id from public.quests where key = 'kit-' || p_event || '-' || p_slug;
$f$;

create function pg_temp.kitcount(p_event uuid) returns integer language sql as $f$
  select count(*)::integer from public.quests where key like 'kit-' || p_event || '-%';
$f$;

create function pg_temp.xp(p_user uuid) returns integer language sql as $f$
  select xp from public.profiles where id = p_user;
$f$;

-- claim_quest and claim_checkin as the Hopper
create function pg_temp.cq(p_user uuid, p_quest uuid, p_event uuid, p_code text default null, p_crew uuid default null) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.claim_quest(p_quest, p_event, p_code, null, p_crew);
  perform pg_temp.as_admin();
  return r;
end $f$;

create function pg_temp.cin(p_user uuid, p_event uuid, p_lat double precision, p_lng double precision) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.claim_checkin(p_event, p_lat, p_lng);
  perform pg_temp.as_admin();
  return r;
end $f$;

-- a Hopper standing at the test venue checks in
create function pg_temp.cin_at(p_user uuid, p_event uuid) returns jsonb language sql as $f$
  select pg_temp.cin(p_user, p_event, 6.3401, 3.2001);
$f$;

-- ------------------------------------------------- structure and privileges ---
do $t$
begin
  perform pg_temp.ok(to_regprocedure('public.give_event_starter_quests(uuid,text)') is not null, 'give_event_starter_quests exists');
  perform pg_temp.ok(to_regprocedure('public.backfill_starter_quests()') is not null, 'backfill_starter_quests exists');
  perform pg_temp.ok(exists (select 1 from pg_trigger where tgname = 'events_starter_quests' and tgrelid = 'public.events'::regclass and not tgisinternal), 'go-live trigger');
  perform pg_temp.ok(exists (select 1 from pg_trigger where tgname = 'events_starter_quests_follow' and tgrelid = 'public.events'::regclass and not tgisinternal), 'follow trigger');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.give_event_starter_quests(uuid,text)', 'execute'), 'anon cannot make a kit');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.give_event_starter_quests(uuid,text)', 'execute'), 'a Hopper cannot make a kit');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.backfill_starter_quests()', 'execute'), 'a Hopper cannot run the backfill');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.give_event_starter_quests(uuid,text)', 'execute'), 'the service role can make a kit');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.backfill_starter_quests()', 'execute'), 'the service role can run the backfill');
  perform pg_temp.ok((select p.proconfig::text like '%extensions%' from pg_proc p where p.oid = 'public.claim_quest(uuid,uuid,text,text,uuid)'::regprocedure),
                     'claim_quest can see digest() (search_path includes extensions)');
  perform pg_temp.eq(public.starter_checkin_title('SOTO Gallery, 10 Omo Osagie Street'), 'Check in at SOTO Gallery', 'the street address is dropped from the title');
  perform pg_temp.eq(public.starter_checkin_title('A, Street'), 'Check in at A, Street', 'a one letter first part keeps the whole name');
  perform pg_temp.ok(char_length(public.starter_checkin_title(repeat('X', 120))) <= 100, 'a long venue name fits the 100 character title');
  raise notice 'ok: structure and privileges';
end $t$;

-- A Hopper cannot call it.
do $t$
declare u uuid := pg_temp.newuser(); e uuid := pg_temp.newevent('T privileges', 'Test Venue', 'live', now() + interval '1 day', now() + interval '1 day 4 hours'); denied boolean := false;
begin
  perform pg_temp.as_user(u);
  begin
    perform public.give_event_starter_quests(e);
  exception when insufficient_privilege then denied := true;
  end;
  perform pg_temp.as_admin();
  perform pg_temp.ok(denied, 'a Hopper calling give_event_starter_quests is refused');
  raise notice 'ok: a Hopper cannot call it';
end $t$;

-- ------------------------------------------------------- the kit on go-live ---
do $t$
declare
  e uuid; q record; n integer; starts timestamptz := now() + interval '3 days'; ends timestamptz := now() + interval '3 days 5 hours';
begin
  -- a pending event gets nothing, and asking for a kit gives nothing either
  e := pg_temp.newevent('T go live', 'Test Venue, 12 Some Street', 'pending', starts, ends);
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '0', 'a pending event has no kit');
  perform pg_temp.eq(public.give_event_starter_quests(e)::text, '0', 'a pending event is not given a kit');
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '0', 'still no kit');

  -- it goes live: three quests, no code quest
  update public.events set status = 'live' where id = e;
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'the kit arrives when the event goes live');
  perform pg_temp.ok(pg_temp.kitq(e, 'code') is null, 'no code quest without a code');
  perform pg_temp.eq((select count(*)::text from public.quests where event_id = e), '3', 'nothing else on the event');
  select * into q from public.quests where id = pg_temp.kitq(e, 'checkin');
  perform pg_temp.ok(q.title = 'Check in at Test Venue' and q.quest_type = 'checkin' and q.xp_reward = 25 and q.repeat_period = 'once' and q.active and q.event_id = e, 'check-in quest fields: ' || q.title);
  select * into q from public.quests where id = pg_temp.kitq(e, 'photo');
  perform pg_temp.ok(q.title = 'Snap the vibe' and q.quest_type = 'photo' and q.xp_reward = 60 and q.repeat_period = 'once' and q.active, 'photo quest fields');
  select * into q from public.quests where id = pg_temp.kitq(e, 'squad');
  perform pg_temp.ok(q.title = 'Squad of four' and q.quest_type = 'group' and q.group_size = 4 and q.xp_reward = 80 and q.repeat_period = 'once' and q.active, 'squad quest is a group quest of four');
  -- open from now (so the Today cards list them from day one) until 2 hours after the event ends
  perform pg_temp.ok((select bool_and(starts_at <= now() and ends_at = ends + interval '2 hours') from public.quests where event_id = e), 'window: now until 2 hours after the end');
  perform pg_temp.ok((select bool_and(char_length(title) between 2 and 100 and description <> '' and title !~ ('[' || chr(8212) || chr(8211) || ']') and description !~ ('[' || chr(8212) || chr(8211) || ']')) from public.quests where event_id = e), 'titles and descriptions are plain');
  -- players see them straight away
  perform pg_temp.as_anon();
  select count(*) into n from public.quests where event_id = e;
  perform pg_temp.as_admin();
  perform pg_temp.eq(n::text, '3', 'players can read the kit from day one');

  -- rejected to live also counts as going live
  e := pg_temp.newevent('T rejected', 'Test Venue', 'rejected', starts, ends);
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '0', 'a rejected event has no kit');
  update public.events set status = 'live' where id = e;
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'rejected to live gets the kit');

  -- inserted as live (staff, the importer)
  e := pg_temp.newevent('T inserted live', 'Test Venue', 'live', starts, ends);
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'an event inserted as live gets the kit');

  -- no end time: taken as 8 hours long
  e := pg_temp.newevent('T no end', 'Test Venue', 'live', starts, null);
  perform pg_temp.ok((select bool_and(ends_at = starts + interval '10 hours') from public.quests where event_id = e), 'no end time: 8 hours plus the 2 hour margin');

  -- an event already over gets no kit, by trigger, by call or by backfill
  e := pg_temp.newevent('T over', 'Test Venue', 'live', now() - interval '3 days', now() - interval '3 days' + interval '4 hours');
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '0', 'an event that is over gets no kit');
  perform pg_temp.eq(public.give_event_starter_quests(e)::text, '0', 'and none when asked');
  -- one that ended within the margin still does
  e := pg_temp.newevent('T just over', 'Test Venue', 'live', now() - interval '5 hours', now() - interval '1 hour');
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'an event that ended an hour ago is still inside its window');

  -- a long venue name still fits the title limit
  e := pg_temp.newevent('T long venue', repeat('V', 120), 'live', starts, ends);
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'a 120 character venue name still makes the kit');
  raise notice 'ok: the kit on go-live';
end $t$;

-- --------------------------------------------------------- no duplicates ---
do $t$
declare
  e uuid; ids uuid[]; n integer; starts timestamptz := now() + interval '3 days'; ends timestamptz := now() + interval '3 days 5 hours';
begin
  e := pg_temp.newevent('T no dupes', 'Test Venue', 'live', starts, ends);
  ids := array(select id from public.quests where event_id = e order by key);
  perform pg_temp.eq(cardinality(ids)::text, '3', 'the kit');

  -- asking again, a second and third time
  perform pg_temp.eq(public.give_event_starter_quests(e)::text, '0', 'asking again makes nothing');
  perform pg_temp.eq(public.give_event_starter_quests(e)::text, '0', 'and again');
  -- the trigger fired again: live to pending to live, a status update that changes nothing, a title edit
  update public.events set status = 'pending' where id = e;
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'taking an event off keeps its kit');
  update public.events set status = 'live' where id = e;
  update public.events set status = 'live' where id = e;
  update public.events set title = 'T no dupes renamed' where id = e;
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'going live again makes no duplicates');
  perform pg_temp.ok(array(select id from public.quests where event_id = e order by key) = ids, 'the same three quests, not new copies');
  -- the backfill leaves it alone, today and when run again
  perform public.backfill_starter_quests();
  perform public.backfill_starter_quests();
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'the backfill makes no duplicates');
  perform pg_temp.eq((select count(*)::text from public.quests where event_id = e), '3', 'still only the three');

  -- a quest staff switched off stays off and is not made again
  update public.quests set active = false where id = pg_temp.kitq(e, 'photo');
  perform pg_temp.eq(public.give_event_starter_quests(e)::text, '0', 'a switched off quest is not made again');
  update public.events set status = 'pending' where id = e;
  update public.events set status = 'live' where id = e;
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '3', 'still three rows');
  perform pg_temp.ok((select not active from public.quests where id = pg_temp.kitq(e, 'photo')), 'and it is still off');

  -- an event whose staff already made a quest of a kind keeps it: the kit fills in only the other kinds
  e := pg_temp.newevent('T staff quest', 'Test Venue', 'pending', starts, ends);
  insert into public.quests (key, title, description, quest_type, event_id, xp_reward) values ('t-staff-checkin-' || e, 'Staff check in', 'Made by staff.', 'checkin', e, 30);
  update public.events set status = 'live' where id = e;
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '2', 'the kit skips a kind the event already has');
  perform pg_temp.ok(pg_temp.kitq(e, 'checkin') is null and pg_temp.kitq(e, 'photo') is not null and pg_temp.kitq(e, 'squad') is not null, 'photo and squad were added, check-in was not');
  perform pg_temp.eq((select count(*)::text from public.quests where event_id = e and quest_type = 'checkin'), '1', 'one check-in quest on the event');
  perform pg_temp.eq((select title from public.quests where key = 't-staff-checkin-' || e), 'Staff check in', 'the staff quest is untouched');
  raise notice 'ok: no duplicates';
end $t$;

-- -------------------------------------------------------------- the code ---
do $t$
declare
  e uuid; e2 uuid; q uuid; n integer; msg text; starts timestamptz := now() + interval '3 days'; ends timestamptz := now() + interval '3 days 5 hours';
begin
  e := pg_temp.newevent('T code', 'Test Venue', 'live', starts, ends);
  e2 := pg_temp.newevent('T code other', 'Test Venue', 'live', starts, ends);
  perform pg_temp.ok(pg_temp.kitq(e, 'code') is null, 'no code quest until the organiser sets a code');

  -- blank codes add nothing
  perform pg_temp.eq(public.give_event_starter_quests(e, null)::text, '0', 'no code: nothing');
  perform pg_temp.eq(public.give_event_starter_quests(e, '')::text, '0', 'empty code: nothing');
  perform pg_temp.eq(public.give_event_starter_quests(e, '    ')::text, '0', 'spaces: nothing');
  perform pg_temp.ok(pg_temp.kitq(e, 'code') is null, 'still no code quest');
  -- too short, too long
  begin perform public.give_event_starter_quests(e, 'abc'); exception when others then get stacked diagnostics msg = message_text; end;
  perform pg_temp.ok(msg like 'The code must be%', 'a 3 character code is refused: ' || coalesce(msg, 'no error'));
  msg := null;
  begin perform public.give_event_starter_quests(e, repeat('x', 65)); exception when others then get stacked diagnostics msg = message_text; end;
  perform pg_temp.ok(msg like 'The code must be%', 'a 65 character code is refused');
  perform pg_temp.ok(pg_temp.kitq(e, 'code') is null, 'a refused code leaves no quest behind');

  -- a code: one new quest, with the code stored only as a hash
  perform pg_temp.eq(public.give_event_starter_quests(e, '  DOOR-1234 ')::text, '1', 'a code adds "Find the code"');
  q := pg_temp.kitq(e, 'code');
  perform pg_temp.ok(q is not null, 'the code quest exists');
  perform pg_temp.ok((select title = 'Find the code' and quest_type = 'qr' and xp_reward = 40 and repeat_period = 'once' and active and event_id = e
                             and starts_at <= now() and ends_at = ends + interval '2 hours' from public.quests where id = q), 'code quest fields');
  perform pg_temp.eq((select count(*)::text from public.quest_codes where quest_id = q), '1', 'one code');
  perform pg_temp.eq((select code_hash from public.quest_codes where quest_id = q), encode(extensions.digest('DOOR-1234', 'sha256'), 'hex'), 'stored trimmed, as a sha256 hash');
  perform pg_temp.ok((select active and uses = 0 and max_uses >= 2000 and valid_until is null from public.quest_codes where quest_id = q), 'code row: active, unused, room for a crowd, no own end');
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '4', 'the full kit of four');
  -- the same code again: nothing changes
  perform pg_temp.eq(public.give_event_starter_quests(e, 'DOOR-1234')::text, '0', 'the same code again makes nothing');
  perform pg_temp.eq((select count(*)::text from public.quest_codes where quest_id = q), '1', 'and no second code row');
  perform pg_temp.eq(pg_temp.kitcount(e)::text, '4', 'still four quests');
  -- a different code goes in beside it
  perform pg_temp.eq(public.give_event_starter_quests(e, 'DOOR-5678')::text, '0', 'a second code makes no new quest');
  perform pg_temp.eq((select count(*)::text from public.quest_codes where quest_id = q), '2', 'two codes on the one quest');
  -- a code another quest already uses is refused, and the event keeps no half-made code quest
  msg := null;
  begin perform public.give_event_starter_quests(e2, 'DOOR-1234'); exception when others then get stacked diagnostics msg = message_text; end;
  perform pg_temp.ok(msg like 'That code is already used%', 'a code used by another quest is refused: ' || coalesce(msg, 'no error'));
  perform pg_temp.ok(pg_temp.kitq(e2, 'code') is null, 'no code quest was left on the other event');
  perform pg_temp.eq(public.give_event_starter_quests(e2, 'DOOR-9999')::text, '1', 'its own code works');
  -- a code on an event that is not live, or is over, is not stored
  e2 := pg_temp.newevent('T code pending', 'Test Venue', 'pending', starts, ends);
  perform pg_temp.eq(public.give_event_starter_quests(e2, 'DOOR-7777')::text, '0', 'a pending event takes no code');
  perform pg_temp.ok(not exists (select 1 from public.quest_codes where code_hash = encode(extensions.digest('DOOR-7777', 'sha256'), 'hex')), 'and the code was not stored');
  raise notice 'ok: the code quest';
end $t$;

-- ------------------------------------------------------------- the backfill ---
do $t$
declare
  a uuid; b uuid; over uuid; pend uuid; r1 integer; r2 integer; starts timestamptz := now() + interval '2 days'; ends timestamptz := now() + interval '2 days 4 hours';
begin
  a := pg_temp.newevent('T backfill a', 'Test Venue', 'live', starts, ends);
  b := pg_temp.newevent('T backfill b', 'Test Venue', 'live', now() - interval '1 hour', now() + interval '3 hours');
  over := pg_temp.newevent('T backfill over', 'Test Venue', 'live', now() - interval '4 days', now() - interval '4 days' + interval '3 hours');
  pend := pg_temp.newevent('T backfill pending', 'Test Venue', 'pending', starts, ends);
  -- live events from before the kit existed: no kit rows at all
  delete from public.quests where event_id in (a, b);
  perform pg_temp.eq((select count(*)::text from public.quests where event_id in (a, b)), '0', 'two live events with no kit');

  r1 := public.backfill_starter_quests();
  perform pg_temp.ok(r1 >= 6, 'the backfill made at least the six quests of the two events: ' || r1);
  perform pg_temp.eq(pg_temp.kitcount(a)::text, '3', 'a live event in the future gets its kit');
  perform pg_temp.eq(pg_temp.kitcount(b)::text, '3', 'a live event under way gets its kit');
  perform pg_temp.eq(pg_temp.kitcount(over)::text, '0', 'an event that is over gets none');
  perform pg_temp.eq(pg_temp.kitcount(pend)::text, '0', 'a pending event gets none');
  perform pg_temp.ok((select bool_and(starts_at <= now() and ends_at > now()) from public.quests where event_id in (a, b)), 'the backfilled quests are open');
  -- run again: nothing more to do, anywhere
  r2 := public.backfill_starter_quests();
  perform pg_temp.eq(r2::text, '0', 'a second backfill has nothing to do');
  perform pg_temp.eq(pg_temp.kitcount(a)::text, '3', 'no duplicates after the second run');
  -- every live event that is still inside its window has a quest of every kit kind
  perform pg_temp.eq((select count(*)::text from public.events e
                      where e.status = 'live' and coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '2 hours' > now()
                        and exists (select 1 from (values ('checkin'), ('photo'), ('group')) k(t) where not exists (select 1 from public.quests q where q.event_id = e.id and q.quest_type = k.t))),
                     '0', 'no live event is missing a kind of the kit');
  raise notice 'ok: backfill';
end $t$;

-- ------------------------------------------------------------- the clock ---
do $t$
declare
  e uuid; staff uuid; staff_end timestamptz := now() + interval '30 days'; starts timestamptz := now() + interval '3 days'; ends timestamptz := now() + interval '3 days 5 hours';
  u uuid := pg_temp.newuser(); r jsonb;
begin
  e := pg_temp.newevent('T clock', 'Old Venue, 1 Road', 'pending', starts, ends);
  insert into public.quests (key, title, description, quest_type, event_id, xp_reward, ends_at) values ('t-staff-code-' || e, 'Staff code', 'Made by staff.', 'qr', e, 10, staff_end) returning id into staff;
  update public.events set status = 'live' where id = e;

  -- the event moves a day later
  update public.events set starts_at = starts + interval '1 day', ends_at = ends + interval '1 day' where id = e;
  perform pg_temp.ok((select bool_and(ends_at = ends + interval '1 day' + interval '2 hours') from public.quests where key like 'kit-' || e || '-%'), 'the kit follows a moved event');
  perform pg_temp.ok((select ends_at = staff_end from public.quests where id = staff), 'a quest staff made keeps its own end');
  -- the end time is removed: 8 hours from the start
  update public.events set ends_at = null where id = e;
  perform pg_temp.ok((select bool_and(ends_at = starts + interval '1 day' + interval '10 hours') from public.quests where key like 'kit-' || e || '-%'), 'no end time: 8 hours plus the margin');
  -- a new venue renames the check-in quest and nothing else
  update public.events set venue_name = 'New Venue, 9 Avenue' where id = e;
  perform pg_temp.eq((select title from public.quests where id = pg_temp.kitq(e, 'checkin')), 'Check in at New Venue', 'a new venue renames the check-in quest');
  perform pg_temp.eq((select title from public.quests where id = pg_temp.kitq(e, 'photo')), 'Snap the vibe', 'the other titles stay');
  -- an unrelated edit changes nothing
  update public.events set title = 'T clock renamed' where id = e;
  perform pg_temp.eq((select title from public.quests where id = pg_temp.kitq(e, 'checkin')), 'Check in at New Venue', 'an unrelated edit leaves the kit alone');

  -- an event moved into the past closes its quests
  update public.quests set starts_at = now() - interval '5 days' where key like 'kit-' || e || '-%';
  update public.events set starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '3 hours' where id = e;
  perform pg_temp.ok((select bool_and(ends_at <= now()) from public.quests where key like 'kit-' || e || '-%'), 'the quests close with an event that is over');
  r := pg_temp.cq(u, pg_temp.kitq(e, 'checkin'), e);
  perform pg_temp.eq(r->>'reason', 'closed', 'a closed kit quest cannot be claimed: ' || r::text);
  perform pg_temp.as_anon();
  perform pg_temp.eq((select count(*)::text from public.quests where event_id = e and key like 'kit-%'), '0', 'and players no longer see it');
  perform pg_temp.as_admin();
  -- moved back to the future: they open again
  update public.events set starts_at = starts, ends_at = ends where id = e;
  perform pg_temp.ok((select bool_and(ends_at = ends + interval '2 hours') from public.quests where key like 'kit-' || e || '-%'), 'moved back, the quests open again');
  raise notice 'ok: the kit follows the clock';
end $t$;

-- ----------------------------------------------- claim_quest: check-in quest ---
do $t$
declare
  e uuid; q uuid; here uuid := pg_temp.newuser(); away uuid := pg_temp.newuser(); other uuid; r jsonb; xp0 integer; starts timestamptz := now() + interval '1 hour'; ends timestamptz := now() + interval '5 hours';
begin
  e := pg_temp.newevent('T check-in quest', 'Test Venue', 'live', starts, ends);
  other := pg_temp.newevent('T other event', 'Test Venue', 'live', starts, ends);
  q := pg_temp.kitq(e, 'checkin');

  -- away from the venue: the check-in is refused, so the quest is too
  r := pg_temp.cin(away, e, 6.45, 3.40);
  perform pg_temp.eq(r->>'reason', 'too_far', 'check-in from far away is refused: ' || r::text);
  perform pg_temp.ok((r->>'distance_m')::integer > 1500, 'by more than the 1500 m limit');
  perform pg_temp.ok(not exists (select 1 from public.checkins where user_id = away and event_id = e), 'no check-in row for the Hopper who is away');
  xp0 := pg_temp.xp(away);
  r := pg_temp.cq(away, q, e);
  perform pg_temp.eq(r->>'reason', 'checkin_required', 'the check-in quest is refused away from the venue: ' || r::text);
  perform pg_temp.eq(pg_temp.xp(away)::text, xp0::text, 'and pays nothing');
  perform pg_temp.ok(not exists (select 1 from public.quest_claims where user_id = away), 'and leaves no claim');
  -- just outside the limit is refused too
  r := pg_temp.cin(away, e, 6.3401 + 0.0136, 3.2001);   -- about 1.51 km north
  perform pg_temp.eq(r->>'reason', 'too_far', 'a bit outside the limit is refused too: ' || r::text);

  -- at the venue: not yet checked in, so the quest still waits
  r := pg_temp.cq(here, q, e);
  perform pg_temp.eq(r->>'reason', 'checkin_required', 'the quest needs the check-in first');
  r := pg_temp.cin_at(here, e);
  perform pg_temp.eq(r->>'ok', 'true', 'check-in at the venue: ' || r::text);
  xp0 := pg_temp.xp(here);
  -- the wrong event, or none
  perform pg_temp.eq(pg_temp.cq(here, q, other)->>'reason', 'wrong_event', 'a quest of another event');
  perform pg_temp.eq(pg_temp.cq(here, q, null)->>'reason', 'wrong_event', 'no event given');
  r := pg_temp.cq(here, q, e);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'status' = 'approved' and r->>'xp' = '25', 'the check-in quest pays 25 XP at once: ' || r::text);
  perform pg_temp.eq((pg_temp.xp(here) - xp0)::text, '25', '25 XP on the profile');
  perform pg_temp.ok(exists (select 1 from public.activity_log where user_id = here and action = 'quest' and event_id = e), 'logged as a quest');
  perform pg_temp.eq(pg_temp.cq(here, q, e)->>'reason', 'already', 'once only');
  perform pg_temp.eq(pg_temp.xp(here)::text, (xp0 + 25)::text, 'and no second payment');
  raise notice 'ok: check-in quest';
end $t$;

-- ----------------------------------------------------- claim_quest: photo quest ---
do $t$
declare
  e uuid; q uuid; checked uuid := pg_temp.newuser(); absent uuid := pg_temp.newuser(); rejected uuid := pg_temp.newuser(); r jsonb; xp0 integer; photo uuid; msg text;
  starts timestamptz := now() + interval '1 hour'; ends timestamptz := now() + interval '5 hours';
begin
  e := pg_temp.newevent('T photo quest', 'Test Venue', 'live', starts, ends);
  q := pg_temp.kitq(e, 'photo');
  perform pg_temp.cin_at(checked, e);
  perform pg_temp.cin_at(rejected, e);

  -- no photo yet
  perform pg_temp.eq(pg_temp.cq(checked, q, e)->>'reason', 'photo_required', 'no photo, no claim');
  -- a Hopper who was not checked in cannot even post a photo (the photo policy)
  perform pg_temp.as_user(absent);
  begin
    insert into public.event_photos (event_id, user_id, path) values (e, absent, absent || '/' || e || '/a.jpg');
  exception when insufficient_privilege then msg := 'refused';
  end;
  perform pg_temp.as_admin();
  perform pg_temp.eq(msg, 'refused', 'a photo from someone who is not checked in is refused');
  perform pg_temp.eq(pg_temp.cq(absent, q, e)->>'reason', 'photo_required', 'so they have nothing to claim with');

  -- a checked-in Hopper posts a photo: the claim waits for review and pays nothing yet
  perform pg_temp.as_user(checked);
  insert into public.event_photos (event_id, user_id, path) values (e, checked, checked || '/' || e || '/a.jpg');   -- no RETURNING: a pending photo is not readable by its owner
  perform pg_temp.as_admin();
  select id into photo from public.event_photos where user_id = checked and event_id = e;
  xp0 := pg_temp.xp(checked);
  r := pg_temp.cq(checked, q, e);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'status' = 'pending' and r->>'xp' = '0', 'the photo claim goes to review: ' || r::text);
  perform pg_temp.eq(pg_temp.xp(checked)::text, xp0::text, 'no XP before review');
  perform pg_temp.eq((select status from public.quest_claims where user_id = checked and quest_id = q), 'pending', 'a pending claim');
  perform pg_temp.eq((select evidence_id::text from public.quest_claims where user_id = checked and quest_id = q), photo::text, 'tied to the photo');
  -- the same photo cannot pay the quest twice (a repeat finds no unused photo)
  perform pg_temp.eq(pg_temp.cq(checked, q, e)->>'reason', 'photo_required', 'one claim only');
  perform pg_temp.eq((select count(*)::text from public.quest_claims where user_id = checked and quest_id = q), '1', 'a single claim row');
  -- staff press APPROVE in Photo review: the claim is approved and the XP lands
  update public.event_photos set moderation_status = 'approved', hidden = false where id = photo;
  perform pg_temp.eq((select status from public.quest_claims where user_id = checked and quest_id = q), 'approved', 'APPROVE approves the claim');
  perform pg_temp.eq((pg_temp.xp(checked) - xp0)::text, '60', 'the 60 XP lands');
  perform pg_temp.ok(exists (select 1 from public.activity_log where user_id = checked and action = 'quest' and event_id = e), 'logged as a quest');

  -- a photo staff REJECT (the review hides it) does not count
  perform pg_temp.as_user(rejected);
  insert into public.event_photos (event_id, user_id, path) values (e, rejected, rejected || '/' || e || '/a.jpg');
  perform pg_temp.as_admin();
  select id into photo from public.event_photos where user_id = rejected and event_id = e;
  update public.event_photos set moderation_status = 'rejected', hidden = true where id = photo;
  perform pg_temp.eq(pg_temp.cq(rejected, q, e)->>'reason', 'photo_required', 'a rejected photo is not evidence');
  raise notice 'ok: photo quest';
end $t$;

-- ----------------------------------------------------- claim_quest: squad quest ---
do $t$
declare
  e uuid; q uuid; owner uuid := pg_temp.newuser(); m2 uuid := pg_temp.newuser(); m3 uuid := pg_temp.newuser(); m4 uuid := pg_temp.newuser(); outsider uuid := pg_temp.newuser();
  crew uuid; small uuid; code text; r jsonb; xp0 integer; starts timestamptz := now() + interval '1 hour'; ends timestamptz := now() + interval '5 hours';
begin
  e := pg_temp.newevent('T squad quest', 'Test Venue', 'live', starts, ends);
  q := pg_temp.kitq(e, 'squad');
  perform pg_temp.as_user(owner); crew := public.create_crew('T Squad'); perform pg_temp.as_admin();
  select invite_code into code from public.crews where id = crew;
  perform pg_temp.as_user(m2); perform public.join_crew(code); perform pg_temp.as_admin();
  perform pg_temp.as_user(m3); perform public.join_crew(code); perform pg_temp.as_admin();
  perform pg_temp.as_user(m4); perform public.join_crew(code); perform pg_temp.as_admin();
  perform pg_temp.eq((select count(*)::text from public.crew_members where crew_id = crew), '4', 'a crew of four');

  -- not in the crew, or no crew chosen
  perform pg_temp.eq(pg_temp.cq(outsider, q, e, null, crew)->>'reason', 'crew_required', 'not a member of that crew');
  perform pg_temp.eq(pg_temp.cq(owner, q, e, null, null)->>'reason', 'crew_required', 'no crew chosen');

  -- three of four are there: not enough
  perform pg_temp.cin_at(owner, e); perform pg_temp.cin_at(m2, e); perform pg_temp.cin_at(m3, e);
  r := pg_temp.cq(owner, q, e, null, crew);
  perform pg_temp.eq(r->>'reason', 'group_not_there', 'three checked in is not a squad of four: ' || r::text);
  -- the fourth member has not checked in: they cannot claim from home (claim_quest fix 2)
  r := pg_temp.cq(m4, q, e, null, crew);
  perform pg_temp.eq(r->>'reason', 'checkin_required', 'a member who is not at the event cannot claim: ' || r::text);
  -- the fourth is far away and cannot check in either
  perform pg_temp.eq(pg_temp.cin(m4, e, 6.45, 3.40)->>'reason', 'too_far', 'checking in from away is refused');
  perform pg_temp.eq(pg_temp.cq(m4, q, e, null, crew)->>'reason', 'checkin_required', 'so the squad is still three');
  -- the fourth arrives
  perform pg_temp.cin_at(m4, e);
  xp0 := pg_temp.xp(owner);
  r := pg_temp.cq(owner, q, e, null, crew);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'status' = 'approved' and r->>'xp' = '80', 'four checked in: the squad quest pays 80 XP: ' || r::text);
  perform pg_temp.eq((pg_temp.xp(owner) - xp0)::text, '80', '80 XP on the profile');
  perform pg_temp.eq((select crew_id::text from public.quest_claims where user_id = owner and quest_id = q), crew::text, 'the claim names the crew');
  perform pg_temp.eq(pg_temp.cq(owner, q, e, null, crew)->>'reason', 'already', 'once only');
  -- each member claims their own
  perform pg_temp.eq(pg_temp.cq(m4, q, e, null, crew)->>'ok', 'true', 'the fourth member claims too');

  -- a crew of three can never claim, however many are there
  perform pg_temp.as_user(outsider); small := public.create_crew('T Small'); perform pg_temp.as_admin();
  select invite_code into code from public.crews where id = small;
  perform pg_temp.as_user(m2); perform public.join_crew(code); perform pg_temp.as_admin();
  perform pg_temp.as_user(m3); perform public.join_crew(code); perform pg_temp.as_admin();
  perform pg_temp.cin_at(outsider, e);
  perform pg_temp.eq(pg_temp.cq(outsider, q, e, null, small)->>'reason', 'group_not_there', 'a crew of three cannot make a squad of four');
  raise notice 'ok: squad quest';
end $t$;

-- ------------------------------------------------------ claim_quest: code quest ---
do $t$
declare
  e uuid; e2 uuid; q uuid; u1 uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser(); u4 uuid := pg_temp.newuser(); r jsonb; xp0 integer;
  starts timestamptz := now() + interval '1 hour'; ends timestamptz := now() + interval '5 hours';
begin
  e := pg_temp.newevent('T code quest', 'Test Venue', 'live', starts, ends);
  e2 := pg_temp.newevent('T code quest other', 'Test Venue', 'live', starts, ends);
  perform public.give_event_starter_quests(e, 'FIND-ME-42');
  q := pg_temp.kitq(e, 'code');

  xp0 := pg_temp.xp(u1);
  r := pg_temp.cq(u1, q, e, 'WRONG-CODE');
  perform pg_temp.eq(r->>'reason', 'invalid_code', 'a wrong code: ' || r::text);
  perform pg_temp.eq(pg_temp.cq(u1, q, e, null)->>'reason', 'invalid_code', 'no code');
  perform pg_temp.eq(pg_temp.cq(u1, q, e, 'find-me-42')->>'reason', 'invalid_code', 'the code is exact, capitals count');
  perform pg_temp.eq(pg_temp.cq(u1, q, e2, 'FIND-ME-42')->>'reason', 'wrong_event', 'the right code for the wrong event');
  perform pg_temp.eq(pg_temp.xp(u1)::text, xp0::text, 'nothing paid for any of those');
  r := pg_temp.cq(u1, q, e, 'FIND-ME-42');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'status' = 'approved' and r->>'xp' = '40', 'the right code pays 40 XP: ' || r::text);
  perform pg_temp.eq((pg_temp.xp(u1) - xp0)::text, '40', '40 XP on the profile');
  perform pg_temp.eq((select uses::text from public.quest_codes where quest_id = q), '1', 'the code counts its use');
  perform pg_temp.eq(pg_temp.cq(u1, q, e, 'FIND-ME-42')->>'reason', 'already', 'once per Hopper');

  -- a code used up, and a code switched off
  update public.quest_codes set uses = max_uses where quest_id = q;
  perform pg_temp.eq(pg_temp.cq(u2, q, e, 'FIND-ME-42')->>'reason', 'invalid_code', 'a code with no uses left');
  update public.quest_codes set uses = 0, active = false where quest_id = q;
  perform pg_temp.eq(pg_temp.cq(u3, q, e, 'FIND-ME-42')->>'reason', 'invalid_code', 'a code switched off');
  update public.quest_codes set active = true where quest_id = q;
  perform pg_temp.eq(pg_temp.cq(u4, q, e, 'FIND-ME-42')->>'ok', 'true', 'and on again');
  raise notice 'ok: code quest';
end $t$;

-- ------------------------------------- claim_quest: other quests still work ---
-- The rewrite must not change the quests staff make by hand: an 'insight' quest
-- (code, then review).
do $t$
declare
  e uuid; qi uuid; u uuid := pg_temp.newuser(); r jsonb; xp0 integer;
begin
  e := pg_temp.newevent('T hand-made', 'Test Venue', 'live', now() + interval '1 hour', now() + interval '5 hours');
  insert into public.quests (key, title, description, quest_type, event_id, xp_reward) values ('t-insight-' || e, 'One line', 'A line.', 'insight', e, 20) returning id into qi;
  insert into public.quest_codes (quest_id, code_hash) values (qi, encode(extensions.digest('LINE-IN', 'sha256'), 'hex'));
  xp0 := pg_temp.xp(u);
  r := pg_temp.cq(u, qi, e, 'LINE-IN');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'status' = 'pending' and r->>'xp' = '0', 'an insight quest still goes to review: ' || r::text);
  perform pg_temp.eq(pg_temp.cq(u, qi, e, 'NOPE')->>'reason', 'invalid_code', 'insight with a wrong code');
  perform pg_temp.eq(pg_temp.xp(u)::text, xp0::text, 'no XP before review');
  raise notice 'ok: hand-made quests unchanged';
end $t$;

do $t$ begin raise notice 'ALL STARTER QUEST TESTS PASSED'; end $t$;

rollback;
