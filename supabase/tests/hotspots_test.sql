-- ============================================================================
-- Hoppaz: hotspot tests (the list, entering, the room, chat rules, mutes,
-- reports, staff switches, retention, the daily reward)
-- Run against a LOCAL database that has the whole load order applied, ending with
-- hotspot_zones.sql and hotspots.sql:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/hotspots_test.sql
--
-- One transaction that always rolls back, so nothing is kept. It clears the
-- hotspot tables first (inside the transaction only) so real use of the local
-- database cannot change a count. Every check raises an exception on failure; the
-- last line printed is ALL HOTSPOT TESTS PASSED.
-- Inside one transaction now() does not move, so the tests age rows by hand (a
-- message 31 s old, a visit that has faded) to step over the clock rules.
--
-- What it proves, in order:
--   * the tables are locked down, and the server stores and takes no position
--   * hotspot_list for anyone: statuses, bands, shapes that still hold the pin
--   * the gates: account, "I'm 18 or older" (and a birthday that says under 18, which
--     cannot be changed afterwards)
--   * enter, leave, pulse, the fade, one avatar one place, the cap, 30 entries a day
--   * the room: heads with an alias and a null look only (no crew or wave flags);
--     hotspot blocks that stay out of the global ones; counts
--   * chat: who can read, 24 hours, 240 characters, text only, no links or numbers
--     (and the ways round the filter), the word list, duplicates, 5 in 30 s and 40 an
--     hour (under a per-Hopper lock), slow mode, mutes, pause
--   * old rooms exactly as before: event rooms, group chats, crew moves, waves, DMs
--   * the purge, 7 day retention and housekeeping
--   * reports (kind 'hotspot'), automatic mutes (only reports that cite a message count),
--     staff tools
--   * a hotspot alias cannot be turned into a person: add_to_crew, the Regular badges
--   * the daily reward once a play-day, and the Regular badge
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

-- a Hopper with an email (an account)
create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hstest-' || u || '@hstest.invalid', '{}', '{}', now(), now());
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

-- the hotspot and event ids by name, filled in below
create temp table fx (name text primary key, id uuid);
grant all on fx to public;
create function pg_temp.hid(p_slug text) returns uuid language sql as $f$ select id from fx where name = p_slug; $f$;
create function pg_temp.ch(p_slug text) returns text language sql as $f$ select 'hotspot:' || id::text from fx where name = p_slug; $f$;

-- Hopper calls, each as that Hopper; they put the role back afterwards
create function pg_temp.confirm(p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.confirm_adult(); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.enter(p_uid uuid, p_slug text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.enter_hotspot(p_slug); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.leave(p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.leave_hotspot(); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.pulse(p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.hotspot_pulse(); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.room(p_uid uuid, p_slug text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.hotspot_room(p_slug); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.mine(p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.my_hotspot(); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.claim(p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.claim_hotspot_daily(); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.report(p_uid uuid, p_ref uuid, p_why text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.report_hotspot(p_ref, p_why); perform pg_temp.as_admin(); return r; end $f$;

-- post a message as that Hopper: 'ok', or the error the database raised
create function pg_temp.say(p_uid uuid, p_channel text, p_body text, p_anon boolean default false, p_image text default null) returns text language plpgsql as $f$
begin
  perform pg_temp.as_user(p_uid);
  begin
    insert into public.messages (channel, body, anon, image_path) values (p_channel, p_body, p_anon, p_image);
  exception when others then
    perform pg_temp.as_admin();
    return sqlerrm;
  end;
  perform pg_temp.as_admin();
  return 'ok';
end $f$;

-- what that Hopper can read in a room, through the read policy
create function pg_temp.sees(p_uid uuid, p_channel text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.as_user(p_uid);
  select coalesce(string_agg(body, '|' order by body), '') into r from public.messages where channel = p_channel;
  perform pg_temp.as_admin();
  return r;
end $f$;

-- make everything in a room older, to step over the 30 s, 60 s and hour rules
create function pg_temp.age_msgs(p_channel text, p_by interval) returns void language sql as $f$
  update public.messages set created_at = created_at - p_by where channel = p_channel;
$f$;

-- the key of a Hopper's alias in the hotspot they are in
create function pg_temp.key_of(p_uid uuid, p_slug text) returns uuid language sql as $f$
  select key from public.hotspot_visits where user_id = p_uid and hotspot_id = pg_temp.hid(p_slug);
$f$;

-- ------------------------------------------------------------- fixtures ---
-- Clean slate for the hotspot tables, inside this transaction only.
delete from public.hotspot_visits;
delete from public.hotspot_days;
delete from public.hotspot_quota;
delete from public.hotspot_mutes;
delete from public.messages where channel like 'hotspot:%';
delete from public.reports where kind = 'hotspot';
delete from public.hotspot_words;
insert into public.hotspot_words (word) values ('whatsapp'), ('dm me'), ('insta'), ('telegram');

do $t$
begin
  -- hotspots.sql opened wave 1 once, and only wave 1
  perform pg_temp.eq((select string_agg(slug, ',' order by slug) from public.hotspots where opened_at is not null and wave = 1), 'ikeja,lekki,victoria-island,yaba', 'wave 1 (Yaba, Lekki, Victoria Island, Ikeja) was opened');
  perform pg_temp.ok(not exists (select 1 from public.hotspots where wave > 1 and status = 'active' and opened_at is null), 'no other wave was opened by the file');
  insert into fx select slug, id from public.hotspots where slug in ('yaba', 'lekki', 'ikoyi', 'ikeja', 'ojota');
  perform pg_temp.eq((select count(*) from fx)::text, '5', 'the five zones used here exist');
  -- the defaults of the chat rules
  perform pg_temp.eq((select slow_seconds || ' ' || slow_from || ' ' || slow_to || ' ' || max_here from public.hotspots where slug = 'yaba'), '10 00:00:00 05:00:00 100', 'slow mode 00:00 to 05:00, 10 s; a soft cap of 100');
  -- Yaba and Lekki open, Ikoyi planned, Ikeja paused (by the staff call, which is also under test below)
  perform pg_temp.eq(public.admin_hotspot_set_status('yaba', 'open')->>'ok', 'true', 'open Yaba');
  perform pg_temp.eq(public.admin_hotspot_set_status('lekki', 'open')->>'ok', 'true', 'open Lekki');
  perform pg_temp.eq(public.admin_hotspot_set_status('ikoyi', 'planned')->>'ok', 'true', 'plan Ikoyi');
  perform pg_temp.eq(public.admin_hotspot_set_status('ikeja', 'paused')->>'ok', 'true', 'pause Ikeja');
  perform pg_temp.eq(public.admin_hotspot_set_status('ojota', 'open')->>'ok', 'true', 'open Ojota');
  perform pg_temp.eq(public.admin_hotspot_set_status('yaba', 'closed')->>'reason', 'bad_status', 'a status must be open, planned or paused');
  perform pg_temp.eq(public.admin_hotspot_set_status('nowhere', 'open')->>'reason', 'not_found', 'an unknown hotspot');
  -- the real clock may be inside the night window: slow mode is tested on its own below
  update public.hotspots set slow_seconds = 0 where slug in ('yaba', 'lekki');
  raise notice 'ok: fixtures';
end $t$;

-- people: a to k have accounts; guest is a guest
create temp table who (name text primary key, id uuid);
grant all on who to public;
do $t$
declare n text;
begin
  foreach n in array array['a', 'b', 'c', 'd', 'e', 'f', 'h', 'i', 'j', 'k', 'minor', 'grown'] loop
    insert into who values (n, pg_temp.newuser());
  end loop;
  insert into who values ('guest', pg_temp.newguest());
  update public.profiles set avatar = '{"hat":"red","skin":3}'::jsonb where id = (select id from who where name = 'a');
end $t$;
create function pg_temp.u(p_name text) returns uuid language sql as $f$ select id from who where name = p_name; $f$;

-- ---------------------------------------------- locked down, no position ---
do $t$
declare r record;
begin
  -- RLS on, no policy, nothing for the app
  for r in select unnest(array['hotspot_visits', 'hotspot_days', 'hotspot_quota', 'hotspot_mutes', 'hotspot_words', 'hotspot_blocks']) as t loop
    perform pg_temp.ok((select relrowsecurity from pg_class where oid = ('public.' || r.t)::regclass), r.t || ': row level security is on');
    perform pg_temp.eq((select count(*) from pg_policy where polrelid = ('public.' || r.t)::regclass)::text, '0', r.t || ': no policy');
    perform pg_temp.ok(not has_table_privilege('anon', 'public.' || r.t, 'SELECT') and not has_table_privilege('authenticated', 'public.' || r.t, 'SELECT')
                       and not has_table_privilege('authenticated', 'public.' || r.t, 'INSERT') and not has_table_privilege('authenticated', 'public.' || r.t, 'UPDATE')
                       and not has_table_privilege('authenticated', 'public.' || r.t, 'DELETE'), r.t || ': nothing granted to the app');
    perform pg_temp.ok(has_table_privilege('service_role', 'public.' || r.t, 'SELECT'), r.t || ': the service role can read');
    -- no place on any of them
    perform pg_temp.ok(not exists (select 1 from information_schema.columns c
                                    where c.table_schema = 'public' and c.table_name = r.t
                                      and (c.column_name ~* '(lat|lng|lon|geog|geom|position|location|accuracy|coord|point)'
                                           or c.udt_name in ('geography', 'geometry', 'float4', 'float8'))), r.t || ': no coordinate column');
  end loop;

  -- no function a Hopper calls takes a position
  perform pg_temp.ok(not exists (
    select 1 from pg_proc p, unnest(p.proargtypes::oid[]) as a(t)
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('enter_hotspot', 'leave_hotspot', 'hotspot_pulse', 'hotspot_room', 'my_hotspot', 'claim_hotspot_daily',
                         'confirm_adult', 'report_hotspot', 'hotspot_list')
       and a.t = any (array['float8'::regtype::oid, 'float4'::regtype::oid, 'numeric'::regtype::oid, 'geography'::regtype::oid, 'geometry'::regtype::oid])), 'no Hopper call takes a number that could be a position');
  perform pg_temp.eq((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enter_hotspot', 'hotspot_room') and pronargs = 1)::text, '2', 'enter and room take only the slug');
  perform pg_temp.eq((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('leave_hotspot', 'hotspot_pulse', 'my_hotspot', 'claim_hotspot_daily', 'confirm_adult', 'hotspot_list') and pronargs = 0)::text, '6', 'the rest take nothing');
  perform pg_temp.ok(not exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('enter_hotspot', 'leave_hotspot', 'hotspot_pulse', 'hotspot_room', 'my_hotspot', 'claim_hotspot_daily', 'report_hotspot')
       and (p.prosrc ~* 'play_fix' or p.prosrc ~* 'st_(point|distance|dwithin|contains|intersects)' or p.prosrc ~* '\mgeog')), 'the presence code never reads play_fix or does a geography test');
  raise notice 'ok: locked down, no position stored or taken';
end $t$;

-- who may call what
do $t$
declare f text;
begin
  perform pg_temp.ok(has_function_privilege('anon', 'public.hotspot_list()', 'execute') and has_function_privilege('authenticated', 'public.hotspot_list()', 'execute'), 'anyone can read the list');
  foreach f in array array['public.enter_hotspot(text)', 'public.leave_hotspot()', 'public.hotspot_pulse()', 'public.hotspot_room(text)', 'public.my_hotspot()',
                           'public.claim_hotspot_daily()', 'public.confirm_adult()', 'public.report_hotspot(uuid,text)'] loop
    perform pg_temp.ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ': signed in only');
  end loop;
  foreach f in array array['public.admin_hotspot_set_status(text,text)', 'public.admin_hotspot_set_slow(text,integer,time,time)', 'public.admin_hotspot_mute(uuid,uuid,numeric,text)',
                           'public.admin_hotspot_unmute(uuid)', 'public.admin_hotspot_mutes(boolean)', 'public.admin_hotspot_reports(boolean,integer)',
                           'public.admin_hotspot_clear(text,integer)', 'public.admin_hotspot_word_add(text)', 'public.admin_hotspot_word_remove(text)',
                           'public.hotspot_leave_for(uuid)', 'public.purge_hotspot_data()', 'public.purge_expired_rooms()', 'public.in_room(uuid,text)',
                           'public.stamp_hotspot_message(public.messages,uuid)', 'public.hotspot_text_problem(text)'] loop
    perform pg_temp.ok(has_function_privilege('service_role', f, 'execute') and not has_function_privilege('anon', f, 'execute')
                       and not has_function_privilege('authenticated', f, 'execute'), f || ': service role only');
  end loop;
  -- and really refused
  perform pg_temp.as_user(pg_temp.u('a'));
  begin
    perform public.admin_hotspot_set_status('yaba', 'paused');
    raise exception 'TEST FAILED: a Hopper paused a hotspot';
  exception when insufficient_privilege then null; end;
  begin
    perform public.in_room(pg_temp.u('a'), 'hotspot:x');
    raise exception 'TEST FAILED: a Hopper called in_room';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_admin();
  raise notice 'ok: who may call what';
end $t$;

-- ----------------------------------------------------------- the list ---
do $t$
declare r record; total int; g geometry; expect int;
begin
  select count(*) into expect from public.hotspots where status in ('active', 'planned', 'paused');
  perform pg_temp.as_anon();
  perform pg_temp.eq((select count(*) from public.hotspot_list())::text, expect::text, 'anon gets every zone that is open, planned or paused');
  perform pg_temp.eq((select status from public.hotspot_list() where slug = 'yaba'), 'open', 'active reads as open');
  perform pg_temp.eq((select status from public.hotspot_list() where slug = 'ikoyi'), 'planned', 'planned reads as planned');
  perform pg_temp.eq((select status from public.hotspot_list() where slug = 'ikeja'), 'paused', 'paused reads as paused');
  perform pg_temp.eq((select name from public.hotspot_list() where slug = 'yaba'), 'Jibowu', 'the room is named after the place');
  perform pg_temp.eq((select zone_name from public.hotspot_list() where slug = 'yaba'), 'Yaba', 'the zone keeps its name');
  perform pg_temp.eq((select name from public.hotspot_list() where slug = 'lekki'), 'Lekki Phase 1', 'the road in brackets is left off the room name');
  perform pg_temp.ok((select here_band from public.hotspot_list() where slug = 'yaba') = 'quiet' and (select here_n from public.hotspot_list() where slug = 'yaba') is null, 'nobody there reads quiet');
  perform pg_temp.ok((select today_band from public.hotspot_list() where slug = 'yaba') = 'quiet', 'nobody today reads quiet');
  perform pg_temp.eq((select string_agg(wave::text, '') from public.hotspot_list()), (select string_agg(wave::text, '' order by wave) from public.hotspot_list()), 'ordered by wave');
  perform pg_temp.as_admin();

  -- a split zone is not in the list
  update public.hotspots set status = 'split' where slug = 'ojota';
  perform pg_temp.ok(not exists (select 1 from public.hotspot_list() where slug = 'ojota'), 'a split zone is not listed');
  update public.hotspots set status = 'active' where slug = 'ojota';

  -- the shapes hold: each pin is inside its own simplified zone, the JSON stays small
  select sum(length(zone_geojson::text)) into total from public.hotspot_list();
  perform pg_temp.ok(total < 60000, format('the shapes are small enough for a phone (%s bytes)', total));
  for r in select l.slug, l.zone_geojson, l.lat, l.lng from public.hotspot_list() l loop
    g := st_setsrid(st_geomfromgeojson(r.zone_geojson::text), 4326);
    perform pg_temp.ok(st_isvalid(g) and geometrytype(g) in ('POLYGON', 'MULTIPOLYGON'), r.slug || ': the zone shape is a valid polygon');
    perform pg_temp.ok(st_contains(g, st_setsrid(st_makepoint(r.lng, r.lat), 4326)), r.slug || ': its junction is inside its own simplified zone');
    perform pg_temp.ok(st_area(st_transform(g, 32631)) > 0.97 * st_area(st_transform((select zone_geom from public.hotspots h where h.slug = r.slug), 32631)), r.slug || ': the simplified zone keeps 97 percent of the area');
  end loop;
  perform pg_temp.ok(not exists (
    select 1 from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m) where p.proname = 'hotspot_list' and m = 't' and n ~* '(user|uid|owner|handle|email)'), 'the list has no column about people');
  -- the bands
  perform pg_temp.eq((select string_agg(public.hotspot_band(n), ',' order by n) from unnest(array[0, 1, 2, 3, 19, 20, 59, 60, 500]::bigint[]) n), 'quiet,few,few,some,some,busy,busy,packed,packed', 'count bands');
  raise notice 'ok: the list';
end $t$;

-- ------------------------------------------------- gates: account and 18+ ---
do $t$
declare r jsonb; a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b');
begin
  -- nobody signed in
  perform pg_temp.as_nosub();
  perform pg_temp.eq(public.enter_hotspot('yaba')->>'reason', 'no_session', 'no session: enter');
  perform pg_temp.eq(public.confirm_adult()->>'reason', 'no_session', 'no session: confirm');
  perform pg_temp.eq(public.hotspot_pulse()->>'reason', 'no_session', 'no session: pulse');
  perform pg_temp.eq(public.hotspot_room('yaba')->>'reason', 'no_session', 'no session: room');
  perform pg_temp.eq(public.claim_hotspot_daily()->>'reason', 'no_session', 'no session: claim');
  perform pg_temp.eq(public.my_hotspot()->>'reason', 'no_session', 'no session: mine');
  perform pg_temp.eq(public.leave_hotspot()->>'reason', 'no_session', 'no session: leave');
  perform pg_temp.eq(public.report_hotspot(gen_random_uuid(), 'x')->>'reason', 'no_session', 'no session: report');
  perform pg_temp.as_admin();

  -- a guest: no account, no entry, cannot confirm
  perform pg_temp.eq(pg_temp.confirm(pg_temp.u('guest'))->>'reason', 'need_account', 'a guest cannot confirm 18+');
  perform pg_temp.eq(pg_temp.enter(pg_temp.u('guest'), 'yaba')->>'reason', 'need_account', 'a guest cannot enter');
  perform pg_temp.eq(pg_temp.claim(pg_temp.u('guest'))->>'reason', 'need_account', 'a guest cannot claim');
  perform pg_temp.eq(pg_temp.say(pg_temp.u('guest'), pg_temp.ch('yaba'), 'hello'), 'need_account', 'a guest cannot post');
  r := pg_temp.mine(pg_temp.u('guest'));
  perform pg_temp.ok((r->>'ok')::boolean and not (r->>'has_account')::boolean and not (r->>'adult')::boolean and r->'in' = 'null'::jsonb, 'my_hotspot tells a guest what is missing');

  -- an account that has not said 18+
  perform pg_temp.eq(pg_temp.enter(a, 'yaba')->>'reason', 'need_adult', 'no 18+ confirmation: cannot enter');
  r := pg_temp.mine(a);
  perform pg_temp.ok((r->>'has_account')::boolean and not (r->>'adult')::boolean, 'my_hotspot: account, not yet 18+');
  -- even with a visit slipped in, posting still needs the confirmation
  insert into public.hotspot_visits (user_id, hotspot_id, key, fades_at)
  values (a, pg_temp.hid('yaba'), (public.identity_for(a, pg_temp.ch('yaba'), false)).id, now() + interval '15 minutes');
  perform pg_temp.eq(pg_temp.say(a, pg_temp.ch('yaba'), 'hello'), 'need_adult', 'no 18+ confirmation: cannot post');
  delete from public.hotspot_visits where user_id = a;

  -- the confirmation: once
  r := pg_temp.confirm(a);
  perform pg_temp.ok((r->>'ok')::boolean and not (r->>'already')::boolean, 'confirm 18+');
  r := pg_temp.confirm(a);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'already')::boolean, 'confirm again says already');
  perform pg_temp.ok((select adult_confirmed_at is not null from public.profile_private where user_id = a), 'the date is kept with the private details');
  perform pg_temp.ok((pg_temp.mine(a)->>'adult')::boolean, 'my_hotspot: 18+');

  -- a birthday that says under 18 cannot confirm
  insert into public.profile_private (user_id, birthday) values (pg_temp.u('minor'), (now() at time zone 'Africa/Lagos')::date - interval '16 years');
  perform pg_temp.eq(pg_temp.confirm(pg_temp.u('minor'))->>'reason', 'under_18', 'a 16 year old cannot confirm');
  perform pg_temp.eq(pg_temp.enter(pg_temp.u('minor'), 'yaba')->>'reason', 'need_adult', 'and cannot enter');
  -- exactly 18 today can
  insert into public.profile_private (user_id, birthday) values (pg_temp.u('grown'), (now() at time zone 'Africa/Lagos')::date - interval '18 years');
  perform pg_temp.ok((pg_temp.confirm(pg_temp.u('grown'))->>'ok')::boolean, 'someone who turns 18 today can confirm');
  perform pg_temp.ok((pg_temp.enter(pg_temp.u('grown'), 'yaba')->>'ok')::boolean, 'and enter');
  -- confirmed, then the birthday on file says under 18: out again
  perform pg_temp.confirm(b);
  perform pg_temp.ok((pg_temp.enter(b, 'yaba')->>'ok')::boolean, 'b enters');
  update public.profile_private set birthday = (now() at time zone 'Africa/Lagos')::date - interval '15 years' where user_id = b;
  perform pg_temp.eq(pg_temp.say(b, pg_temp.ch('yaba'), 'hello'), 'need_adult', 'a birthday under 18 on file stops posting even after confirming');
  perform pg_temp.eq(pg_temp.enter(b, 'yaba')->>'reason', 'need_adult', 'and entering');
  -- the answer sticks: a later birthday does not undo a refusal
  perform pg_temp.ok((select under_18_at is not null from public.profile_private where user_id = b), 'the first birthday under 18 is remembered');
  perform pg_temp.as_user(b);
  perform public.set_private_details(null, date '1990-01-01');
  perform pg_temp.as_admin();
  perform pg_temp.ok((select birthday = date '1990-01-01' from public.profile_private where user_id = b), 'the birthday itself can be changed');
  perform pg_temp.eq(pg_temp.confirm(b)->>'reason', 'under_18', 'but confirming still says under 18');
  perform pg_temp.eq(pg_temp.enter(b, 'yaba')->>'reason', 'need_adult', 'and entering');
  perform pg_temp.eq(pg_temp.say(b, pg_temp.ch('yaba'), 'hello'), 'need_adult', 'and posting');
  -- a Hopper who set 2012, was refused and then said 1990 is the case above; one who never asked is the same
  perform pg_temp.as_user(pg_temp.u('minor'));
  perform public.set_private_details(null, date '1985-05-05');
  perform pg_temp.as_admin();
  perform pg_temp.eq(pg_temp.confirm(pg_temp.u('minor'))->>'reason', 'under_18', 'a minor who then says 1985 cannot confirm either');
  -- staff can clear a typo by hand
  update public.profile_private set under_18_at = null, birthday = null where user_id in (b, pg_temp.u('minor'));
  perform pg_temp.ok((pg_temp.confirm(b)->>'ok')::boolean, 'cleared by staff: b can confirm again');
  delete from public.hotspot_visits;
  raise notice 'ok: the gates (account, 18+)';
end $t$;

-- -------------------------------------------------- enter, leave, pulse ---
do $t$
declare
  a uuid := pg_temp.u('a'); c uuid := pg_temp.u('c'); r jsonb; r2 jsonb; k1 uuid; k2 uuid; alias1 text; fade timestamptz; i int;
  pf_before public.play_fix; pf_after public.play_fix;
begin
  perform pg_temp.confirm(c);
  -- not found, planned, paused
  perform pg_temp.eq(pg_temp.enter(a, 'nowhere')->>'reason', 'not_found', 'unknown slug');
  perform pg_temp.eq(pg_temp.enter(a, null)->>'reason', 'not_found', 'no slug');
  perform pg_temp.eq(pg_temp.enter(a, 'ikoyi')->>'reason', 'not_open', 'planned: opening soon');
  perform pg_temp.eq(pg_temp.enter(a, 'ikeja')->>'reason', 'paused', 'paused');
  perform pg_temp.ok(not exists (select 1 from public.hotspot_visits where user_id = a), 'nothing was written by the refusals');

  -- the server learns no position: a play_fix row (the Play heartbeat) is not read or changed
  insert into public.play_fix (user_id, lat, lng, accuracy, at) values (a, 6.517, 3.369, 12, now() - interval '1 hour');
  select * into pf_before from public.play_fix where user_id = a;

  -- enter (slug is not case sensitive)
  r := pg_temp.enter(a, ' YABA ');
  perform pg_temp.ok((r->>'ok')::boolean, 'enter Yaba: ' || r::text);
  perform pg_temp.ok(not (r->>'already_here')::boolean, 'a first entry is not already_here');
  perform pg_temp.eq(r#>>'{hotspot,slug}', 'yaba', 'slug');
  perform pg_temp.eq(r#>>'{hotspot,name}', 'Jibowu', 'the room name is the place');
  perform pg_temp.eq(r->>'channel', pg_temp.ch('yaba'), 'channel is hotspot:<id>');
  perform pg_temp.ok((r->>'key')::uuid is not null and length(r->>'alias') > 3, 'a key and an alias come back');
  perform pg_temp.eq(r#>>'{rules,max_len}', '240', 'the rules come back: 240 characters');
  perform pg_temp.eq(r#>>'{rules,burst}', '5', 'the rules come back: 5 in 30 s');
  perform pg_temp.eq((r#>>'{slow,from}') || '-' || (r#>>'{slow,to}'), '00:00-05:00', 'slow mode window comes back');
  k1 := (r->>'key')::uuid; alias1 := r->>'alias';
  perform pg_temp.eq((select alias from public.room_identities where id = k1), alias1, 'the alias is the room identity alias');
  perform pg_temp.ok(exists (select 1 from public.room_identities where id = k1 and channel = pg_temp.ch('yaba') and user_id = a and not anon), 'a named-side identity for this channel');
  select * into pf_after from public.play_fix where user_id = a;
  perform pg_temp.ok(pf_before = pf_after, 'play_fix is untouched by entering');
  perform pg_temp.eq((select count(*) from public.play_fix where user_id = a)::text, '1', 'and no second position row');

  -- the visit
  fade := (select fades_at from public.hotspot_visits where user_id = a);
  perform pg_temp.ok(fade >= now() + interval '10 minutes' and fade <= now() + interval '20 minutes', 'the head fades 10 to 20 minutes out');
  r2 := pg_temp.mine(a);
  perform pg_temp.eq(r2#>>'{in,slug}', 'yaba', 'my_hotspot: in Yaba');
  perform pg_temp.eq(r2#>>'{in,alias}', alias1, 'my_hotspot: same alias');
  perform pg_temp.ok(public.in_room(a, pg_temp.ch('yaba')), 'in_room: in Yaba');
  perform pg_temp.ok(not public.in_room(a, pg_temp.ch('lekki')), 'in_room: not in Lekki');
  perform pg_temp.ok(not public.in_room(c, pg_temp.ch('yaba')), 'in_room: someone else is not');
  perform pg_temp.ok(not public.in_room(null, pg_temp.ch('yaba')), 'in_room: nobody is not');
  perform pg_temp.ok(not public.in_room(a, 'hotspot:' || gen_random_uuid()::text), 'in_room: a hotspot that does not exist');
  perform pg_temp.ok(not public.in_room(a, 'hotspot:'), 'in_room: an empty id');
  perform pg_temp.ok(public.room_closes_at(pg_temp.ch('yaba')) is null, 'an open hotspot never closes by the clock');

  -- the fade is random: many entries land in the range and are not all the same
  create temp table fades (f interval) on commit drop;
  for i in 1..12 loop
    perform pg_temp.leave(a);
    perform pg_temp.enter(a, 'yaba');
    insert into fades select fades_at - now() from public.hotspot_visits where user_id = a;
  end loop;
  perform pg_temp.ok((select min(f) >= interval '10 minutes' and max(f) <= interval '20 minutes' from fades), 'every fade is 10 to 20 minutes');
  perform pg_temp.ok((select count(distinct f) from fades) > 1, 'and they differ');
  perform pg_temp.leave(a);
  r := pg_temp.enter(a, 'yaba');
  perform pg_temp.eq(r->>'key', k1::text, 'leave and come back: the same key');
  perform pg_temp.eq(r->>'alias', alias1, 'leave and come back: the same alias');

  -- again while alive: refreshed, not new
  update public.hotspot_visits set entered_at = now() - interval '3 minutes' where user_id = a;
  r := pg_temp.enter(a, 'yaba');
  perform pg_temp.ok((r->>'already_here')::boolean, 'again while there: already_here');
  perform pg_temp.ok((select entered_at <= now() - interval '2 minutes' from public.hotspot_visits where user_id = a), 'the arrival time is kept');
  perform pg_temp.eq((select count(*) from public.hotspot_visits where user_id = a)::text, '1', 'one visit row');

  -- a different alias in another hotspot
  r := pg_temp.enter(a, 'lekki');
  perform pg_temp.ok((r->>'ok')::boolean, 'enter Lekki');
  k2 := (r->>'key')::uuid;
  perform pg_temp.ok(k2 <> k1, 'another key in another hotspot');
  perform pg_temp.eq((select count(*) from public.room_identities where user_id = a and channel in (pg_temp.ch('yaba'), pg_temp.ch('lekki')))::text, '2', 'one identity per hotspot');
  -- one avatar, one place
  perform pg_temp.eq((select count(*) from public.hotspot_visits where user_id = a)::text, '1', 'one avatar, one place: one row');
  perform pg_temp.eq((select hotspot_id::text from public.hotspot_visits where user_id = a), pg_temp.hid('lekki')::text, 'it moved to Lekki');
  perform pg_temp.ok(not public.in_room(a, pg_temp.ch('yaba')) and public.in_room(a, pg_temp.ch('lekki')), 'out of Yaba, in Lekki');
  r := pg_temp.enter(a, 'yaba');
  perform pg_temp.eq(r->>'key', k1::text, 'and back in Yaba: the same key as the first time');

  -- leaving a spot room too (Play mode's spot_visits does not exist yet: a stand-in)
  create table public.spot_visits (user_id uuid primary key, drop_id uuid);
  insert into public.spot_visits values (a, gen_random_uuid()), (c, gen_random_uuid());
  perform pg_temp.leave(a);
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.ok(not exists (select 1 from public.spot_visits where user_id = a), 'entering a hotspot takes the avatar out of any spot room');
  perform pg_temp.ok(exists (select 1 from public.spot_visits where user_id = c), 'and only that Hopper');
  -- the other way: a spot trip calls hotspot_leave_for
  perform public.hotspot_leave_for(a);
  perform pg_temp.ok(not exists (select 1 from public.hotspot_visits where user_id = a), 'hotspot_leave_for takes the avatar out of the hotspot');
  drop table public.spot_visits;

  -- leave
  perform pg_temp.enter(a, 'yaba');
  r := pg_temp.leave(a);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'left')::boolean, 'leave');
  r := pg_temp.leave(a);
  perform pg_temp.ok((r->>'ok')::boolean and not (r->>'left')::boolean, 'leave again: nothing to leave');
  perform pg_temp.ok(not public.in_room(a, pg_temp.ch('yaba')), 'out of the room');
  perform pg_temp.eq(pg_temp.mine(a)->>'in', null, 'my_hotspot: nowhere');

  -- pulse and the timeout
  perform pg_temp.eq(pg_temp.pulse(a)->>'reason', 'not_in_hotspot', 'pulse when not in a hotspot');
  perform pg_temp.enter(a, 'yaba');
  update public.hotspot_visits set last_seen = now() - interval '1 minute', fades_at = now() + interval '1 minute' where user_id = a;
  r := pg_temp.pulse(a);
  perform pg_temp.ok((r->>'ok')::boolean and r->>'slug' = 'yaba', 'pulse keeps the avatar in');
  perform pg_temp.ok((select fades_at >= now() + interval '10 minutes' and fades_at <= now() + interval '20 minutes' from public.hotspot_visits where user_id = a), 'pulse pushes the fade out to 10 to 20 minutes');
  -- a visit that has faded: out of the room, out of the counts, and a pulse does not bring it back
  update public.hotspot_visits set fades_at = now() - interval '1 second', entered_at = now() - interval '2 hours' where user_id = a;
  perform pg_temp.ok(not public.in_room(a, pg_temp.ch('yaba')), 'a faded visit is not in the room');
  perform pg_temp.eq(pg_temp.pulse(a)->>'reason', 'not_in_hotspot', 'a pulse does not revive a faded visit');
  perform pg_temp.eq(pg_temp.mine(a)->>'in', null, 'my_hotspot: faded');
  perform pg_temp.eq((select here_band from public.hotspot_list() where slug = 'yaba'), 'quiet', 'and it is not counted');
  r := pg_temp.enter(a, 'yaba');
  perform pg_temp.ok(not (r->>'already_here')::boolean, 'entering after the fade is a new entry');
  perform pg_temp.ok((select entered_at > now() - interval '1 minute' from public.hotspot_visits where user_id = a), 'with a new arrival time');

  -- paused: everyone goes at once
  perform public.admin_hotspot_set_status('yaba', 'paused');
  perform pg_temp.ok(not exists (select 1 from public.hotspot_visits where hotspot_id = pg_temp.hid('yaba')), 'pausing sends everyone out');
  perform pg_temp.ok(not public.in_room(a, pg_temp.ch('yaba')), 'a paused hotspot has nobody in it');
  perform pg_temp.eq(pg_temp.enter(a, 'yaba')->>'reason', 'paused', 'and cannot be entered');
  perform pg_temp.eq(public.room_closes_at(pg_temp.ch('yaba'))::text, '-infinity', 'room_closes_at: closed while paused');
  perform public.admin_hotspot_set_status('yaba', 'open');
  perform pg_temp.ok(public.room_closes_at(pg_temp.ch('yaba')) is null, 'room_closes_at: open again');
  -- a visit left behind when a zone is paused behind the scenes: pulse says paused and clears it
  perform pg_temp.enter(a, 'yaba');
  update public.hotspots set status = 'paused' where slug = 'yaba';
  perform pg_temp.eq(pg_temp.pulse(a)->>'reason', 'paused', 'pulse tells a visitor the hotspot is paused');
  perform pg_temp.ok(not exists (select 1 from public.hotspot_visits where user_id = a), 'and clears the visit');
  update public.hotspots set status = 'active' where slug = 'yaba';
  raise notice 'ok: enter, leave, pulse, fade, one avatar one place, pause';
end $t$;

-- ---------------------------------------------- the cap and 30 a day ---
do $t$
declare a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); r jsonb; d date := public.hotspot_play_day();
begin
  -- a soft cap
  delete from public.hotspot_visits;
  update public.hotspots set max_here = 2 where slug = 'yaba';
  perform pg_temp.ok((pg_temp.enter(a, 'yaba')->>'ok')::boolean, 'cap: first in');
  perform pg_temp.ok((pg_temp.enter(b, 'yaba')->>'ok')::boolean, 'cap: second in');
  r := pg_temp.enter(c, 'yaba');
  perform pg_temp.eq(r->>'reason', 'full', 'cap: the third is told it is full');
  perform pg_temp.ok((pg_temp.enter(a, 'yaba')->>'ok')::boolean, 'cap: someone already in can enter again');
  update public.hotspot_visits set fades_at = now() - interval '1 second' where user_id = b;
  perform pg_temp.ok((pg_temp.enter(c, 'yaba')->>'ok')::boolean, 'cap: a faded head frees a place');
  update public.hotspots set max_here = 100 where slug = 'yaba';
  delete from public.hotspot_visits;

  -- 30 entries a day; staying in a room you are in is not an entry
  delete from public.hotspot_quota where user_id = a;
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.eq((select entries::text from public.hotspot_quota where user_id = a), '1', 'one entry counted');
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.eq((select entries::text from public.hotspot_quota where user_id = a), '1', 'entering the room you are in again counts nothing');
  update public.hotspot_quota set entries = 30 where user_id = a;
  perform pg_temp.ok((pg_temp.enter(a, 'yaba')->>'already_here')::boolean, 'at the limit you can still be where you are');
  r := pg_temp.enter(a, 'lekki');
  perform pg_temp.eq(r->>'reason', 'slow_down', 'the 31st entry in a day is refused');
  perform pg_temp.eq((select hotspot_id::text from public.hotspot_visits where user_id = a), pg_temp.hid('yaba')::text, 'and the avatar stays where it was');
  update public.hotspot_quota set play_day = d - 1 where user_id = a;
  perform pg_temp.ok((pg_temp.enter(a, 'lekki')->>'ok')::boolean, 'a new play-day starts the count again');
  perform pg_temp.eq((select entries::text from public.hotspot_quota where user_id = a), '1', 'at 1');
  delete from public.hotspot_visits;
  raise notice 'ok: the cap and the daily limit';
end $t$;

-- ------------------------------------------------------------ the room ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); d uuid := pg_temp.u('d'); e uuid := pg_temp.u('e');
  r jsonb; head jsonb; ka uuid; kb uuid;
begin
  perform pg_temp.confirm(d); perform pg_temp.confirm(e);
  delete from public.hotspot_visits; delete from public.hotspot_days;
  perform pg_temp.enter(a, 'yaba');
  -- not in the room: no heads
  perform pg_temp.eq(pg_temp.room(b, 'yaba')->>'reason', 'not_in_hotspot', 'room: only for someone in it');
  perform pg_temp.eq(pg_temp.room(a, 'nowhere')->>'reason', 'not_found', 'room: unknown slug');
  perform pg_temp.eq(pg_temp.room(a, 'lekki')->>'reason', 'not_in_hotspot', 'room: not the room you are in');
  perform pg_temp.enter(b, 'yaba');
  ka := pg_temp.key_of(a, 'yaba'); kb := pg_temp.key_of(b, 'yaba');
  r := pg_temp.room(a, 'yaba');
  perform pg_temp.ok((r->>'ok')::boolean, 'room: ok');
  perform pg_temp.eq(jsonb_array_length(r->'heads')::text, '1', 'room: a sees b, not themselves');
  head := r->'heads'->0;
  perform pg_temp.eq(head->>'key', kb::text, 'room: the head carries b''s key');
  perform pg_temp.eq(head->>'alias', (select alias from public.room_identities where id = kb), 'room: and b''s alias');
  -- nothing but key, alias and a null look: no crew or wave flag, nothing that says who you know
  perform pg_temp.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(head) k), 'alias,key,look', 'a head is exactly key, alias, look');
  perform pg_temp.ok(head::text !~* 'handle|name"|email|@|user', 'no handle, name, email or user id in a head');
  perform pg_temp.eq(r#>>'{you,key}', ka::text, 'you: your own key');
  perform pg_temp.eq(r#>>'{you,alias}', (select alias from public.room_identities where id = ka), 'you: your own alias');
  perform pg_temp.eq(r->>'name', 'Jibowu', 'the room name');
  -- the look is never the avatar: a real look would link the alias to the profile that owns it
  perform pg_temp.ok(pg_temp.room(b, 'yaba')->'heads'->0->'look' = 'null'::jsonb, 'the look of a head is null, though a has an avatar');
  perform pg_temp.ok(pg_temp.room(b, 'yaba')::text !~ 'red|skin', 'and nothing of the avatar is anywhere in the room');
  -- the counts: under 3 never exact
  perform pg_temp.eq(r->>'here_band', 'few', 'two there: a few');
  perform pg_temp.ok(r->'here_n' = 'null'::jsonb, 'two there: no exact number');
  perform pg_temp.eq(r->>'today_band', 'few', 'two today: a few');
  perform pg_temp.enter(c, 'yaba');
  r := pg_temp.room(a, 'yaba');
  perform pg_temp.eq(r->>'here_band', 'some', 'three there: some');
  perform pg_temp.eq(r->>'here_n', '3', 'three there: the number');
  perform pg_temp.eq(r->>'today_n', '3', 'three today: the number');
  perform pg_temp.eq(jsonb_array_length(r->'heads')::text, '2', 'a sees two heads');
  -- the heads are in a fixed order that does not depend on who arrived first
  perform pg_temp.eq(
    (select string_agg(h->>'key', ',' order by ord) from jsonb_array_elements(pg_temp.room(a, 'yaba')->'heads') with ordinality as t(h, ord)),
    (select string_agg(key::text, ',' order by md5(key::text)) from public.hotspot_visits where hotspot_id = pg_temp.hid('yaba') and user_id <> a),
    'heads are ordered by a hash of the key');
  -- the list counts the same, with the number once it is 3
  perform pg_temp.as_anon();
  perform pg_temp.eq((select here_n::text from public.hotspot_list() where slug = 'yaba'), '3', 'the list: 3 here');
  perform pg_temp.eq((select today_n::text from public.hotspot_list() where slug = 'yaba'), '3', 'the list: 3 today');
  perform pg_temp.as_admin();
  -- a hotspot block hides heads both ways, and stays a hotspot block
  perform pg_temp.as_user(a);
  perform public.block_person(kb, null, 'x');
  perform pg_temp.as_admin();
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(a, 'yaba')->'heads')::text, '1', 'a blocked b: b is not among a''s heads');
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(b, 'yaba')->'heads')::text, '1', 'and a is not among b''s');
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(c, 'yaba')->'heads')::text, '2', 'c sees both');
  perform pg_temp.eq((select count(*) from public.blocks where blocker = a)::text, '0', 'blocking an alias writes no global block');
  perform pg_temp.eq((select blocker::text || '>' || blocked::text || ' ' || label from public.hotspot_blocks), a::text || '>' || b::text || ' ' || (select alias from public.room_identities where id = kb), 'it is a hotspot block, labelled with the alias');
  delete from public.hotspot_blocks;
  -- a global block (made somewhere else) does not touch the hotspot: it would show who the alias is
  insert into public.blocks (blocker, blocked, label) values (a, b, 'someone from an event');
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(a, 'yaba')->'heads')::text, '2', 'a global block does not hide a head in a hotspot');
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(b, 'yaba')->'heads')::text, '2', 'either way round');
  delete from public.blocks;
  -- a faded head disappears
  update public.hotspot_visits set fades_at = now() - interval '1 second' where user_id = c;
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(a, 'yaba')->'heads')::text, '1', 'a faded head is gone');
  update public.hotspot_visits set fades_at = now() + interval '15 minutes' where user_id = c;
  -- crew and waves tell the room nothing: a one-sided crew row or a wave must not show which alias is a known person
  perform pg_temp.eq(pg_temp.room(a, 'yaba')::text, pg_temp.room(a, 'yaba')::text, 'the room reads the same twice');
  r := pg_temp.room(a, 'yaba');
  insert into public.crew (user_id, friend_id) values (a, pg_temp.u('c')), (a, pg_temp.u('b'));
  insert into public.waves (from_user, to_user, from_alias, to_alias) values (a, pg_temp.u('c'), 'a', 'c');
  perform pg_temp.eq(pg_temp.room(a, 'yaba')::text, r::text, 'a crew row and a wave change nothing in the room: same heads, same order, no flags');
  delete from public.waves where from_user = a;
  delete from public.crew where user_id = a;
  -- at most 100 heads, and a crowd reads as packed
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'crowd-' || g || '-' || gen_random_uuid() || '@hstest.invalid', '{}', '{}', now(), now()
    from generate_series(1, 105) g;
  insert into public.hotspot_visits (user_id, hotspot_id, key, fades_at)
  select u.id, pg_temp.hid('yaba'), (public.identity_for(u.id, pg_temp.ch('yaba'), false)).id, now() + interval '15 minutes'
    from auth.users u where u.email like 'crowd-%@hstest.invalid';
  perform pg_temp.eq(jsonb_array_length(pg_temp.room(a, 'yaba')->'heads')::text, '100', 'at most 100 heads');
  perform pg_temp.eq(pg_temp.room(a, 'yaba')->>'here_band', 'packed', 'a crowd reads as packed');
  perform pg_temp.eq(pg_temp.room(a, 'yaba')->>'here_n', '108', 'and the number is exact');
  delete from public.hotspot_visits; delete from public.hotspot_days;
  raise notice 'ok: the room';
end $t$;

-- -------------------------------------------------------------- chat ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); d uuid := pg_temp.u('d');
  ch text := pg_temp.ch('yaba'); lk text := pg_temp.ch('lekki'); m public.messages; i int; res text; ka uuid; mid text;
begin
  delete from public.hotspot_visits; delete from public.hotspot_days; delete from public.hotspot_quota;
  perform pg_temp.enter(a, 'yaba'); perform pg_temp.enter(b, 'yaba'); perform pg_temp.enter(d, 'lekki');
  ka := pg_temp.key_of(a, 'yaba');

  -- a message: stamped by the server
  perform pg_temp.eq(pg_temp.say(a, ch, '  Jibowu tonight?  ', true), 'ok', 'a posts, even asking for anon');
  select * into m from public.messages where channel = ch;
  perform pg_temp.eq(m.body, 'Jibowu tonight?', 'the body is trimmed');
  perform pg_temp.ok(not m.anon, 'the anon flag is ignored');
  perform pg_temp.eq(m.author_key::text, ka::text, 'the author is the alias key');
  perform pg_temp.eq(m.author_name, (select alias from public.room_identities where id = ka), 'the name shown is the alias');
  perform pg_temp.ok(m.author_handle is null, 'the handle is never stored on a hotspot message');
  perform pg_temp.ok(m.author_look is null, 'no look is stored: the avatar would give the person away');
  perform pg_temp.ok(m.created_at = now(), 'the server sets the time');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where source_id = m.id), 'a hotspot message is not an active day (activity_log)');

  -- who can read it: people in the room
  perform pg_temp.eq(pg_temp.sees(a, ch), 'Jibowu tonight?', 'the author reads it');
  perform pg_temp.eq(pg_temp.sees(b, ch), 'Jibowu tonight?', 'someone in the room reads it');
  perform pg_temp.eq(pg_temp.sees(c, ch), '', 'someone outside does not');
  perform pg_temp.eq(pg_temp.sees(d, ch), '', 'someone in another hotspot does not');
  perform pg_temp.as_anon();
  perform pg_temp.eq((select count(*) from public.messages where channel = ch)::text, '0', 'nor does a visitor who is not signed in');
  perform pg_temp.as_admin();
  perform pg_temp.leave(b);
  perform pg_temp.eq(pg_temp.sees(b, ch), '', 'once b has left, b does not read it');
  perform pg_temp.enter(b, 'yaba');
  perform pg_temp.eq(pg_temp.sees(b, ch), 'Jibowu tonight?', 'back in, b reads it again');
  update public.hotspot_visits set fades_at = now() - interval '1 second' where user_id = b;
  perform pg_temp.eq(pg_temp.sees(b, ch), '', 'a faded visit reads nothing');
  perform pg_temp.enter(b, 'yaba');
  -- 24 hours
  perform pg_temp.age_msgs(ch, interval '23 hours 59 minutes');
  perform pg_temp.eq(pg_temp.sees(b, ch), 'Jibowu tonight?', 'just under 24 hours: readable');
  perform pg_temp.age_msgs(ch, interval '2 minutes');
  perform pg_temp.eq(pg_temp.sees(b, ch), '', 'over 24 hours: not readable, though still stored');
  perform pg_temp.eq(pg_temp.sees(a, ch), '', 'not even the author');
  perform pg_temp.eq((select count(*) from public.messages where channel = ch)::text, '1', 'still in the table for 7 days');
  delete from public.messages where channel = ch;
  -- a block hides the message
  perform pg_temp.say(a, ch, 'blocked soon');
  perform pg_temp.as_user(b);
  perform public.block_person(ka, null, 'x');
  perform pg_temp.as_admin();
  perform pg_temp.eq(pg_temp.sees(b, ch), '', 'b blocked a: a''s message is hidden from b');
  perform pg_temp.eq(pg_temp.sees(a, ch), 'blocked soon', 'a still reads their own');
  perform pg_temp.say(b, ch, 'from b');
  perform pg_temp.eq(pg_temp.sees(a, ch), 'blocked soon', 'and a does not read b either (the block works both ways)');
  delete from public.hotspot_blocks;
  -- a global block made elsewhere does not hide a hotspot message (it would show which alias is that person)
  insert into public.blocks (blocker, blocked, label) values (b, a, 'someone from an event');
  perform pg_temp.eq(pg_temp.sees(b, ch), 'blocked soon|from b', 'a global block does not hide a hotspot message');
  delete from public.blocks;
  delete from public.messages where channel = ch;

  -- length: 240
  perform pg_temp.eq(pg_temp.say(a, ch, repeat('x', 240)), 'ok', '240 characters');
  perform pg_temp.age_msgs(ch, interval '31 seconds');
  perform pg_temp.eq(pg_temp.say(a, ch, repeat('y', 241)), 'too_long', '241 characters');
  perform pg_temp.eq(pg_temp.say(a, ch, '   '), 'empty', 'blank');
  perform pg_temp.eq(pg_temp.say(a, ch, ''), 'empty', 'nothing');
  perform pg_temp.eq(pg_temp.say(a, ch, 'a picture', false, 'room/' || a::text || '/x.png'), 'no_images', 'text only');
  delete from public.messages where channel = ch;

  -- links, emails, @names and phone numbers
  foreach res in array array['see https://example.com', 'www.example.org', 'jollof.ng', 'it is on x.co now', 'mail me ola@gmail.com', 'ig is @jollofking',
                             '08012345678', '0801 234 5678', '+234 801 234 5678', '0801-234-5678', '(0801) 234 5678', '1 2 3 4 5 6 7', 'call 234.801.234.5678', 'T.ME/abc'] loop
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'no_links', 'refused: ' || res);
  end loop;
  foreach res in array array['see you at 9pm, 2 friends coming', 'it was 2.5 hours long', 'N5,000 each, 25 of us', 'lol 11:30pm 08/10 3x', 'wait... what?', 'e.g. this one',
                             'room 12 and 34 and 56', 'mail@home', 'Friday 8pm Jibowu'] loop
    update public.messages set created_at = now() - interval '2 hours' where channel = ch;
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'ok', 'allowed: ' || res);
  end loop;
  delete from public.messages where channel = ch;

  -- the word list: whole words, a little leet speak, any case
  foreach res in array array['add my whatsapp', 'WhatsApp me', 'wh4tsapp', 'DM  me later', 'dm m3', 'follow my insta', 'INSTA?'] loop
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'blocked_word', 'refused word: ' || res);
  end loop;
  foreach res in array array['instagrammer', 'dm', 'what is your app', 'whats up'] loop
    update public.messages set created_at = now() - interval '2 hours' where channel = ch;
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'ok', 'allowed word: ' || res);
  end loop;
  delete from public.messages where channel = ch;
  perform public.admin_hotspot_word_add('  Jollof Bandit ');
  perform pg_temp.eq(pg_temp.say(a, ch, 'hi jollof bandit'), 'blocked_word', 'a word staff added is refused');
  perform pg_temp.eq(public.admin_hotspot_word_add('x')->>'reason', 'bad_word', 'a word must be 2 to 40 characters');
  perform pg_temp.ok((public.admin_hotspot_word_remove('jollof bandit')->>'ok')::boolean, 'staff remove it');
  perform pg_temp.eq(pg_temp.say(a, ch, 'hi jollof bandit'), 'ok', 'and it is allowed again');
  delete from public.messages where channel = ch;
  -- a word with a regex character cannot break the filter
  perform public.admin_hotspot_word_add('c++ (help)');
  perform pg_temp.eq(pg_temp.say(a, ch, 'I need c++ (help) now'), 'blocked_word', 'a word with symbols is matched as text');
  perform pg_temp.eq(pg_temp.say(a, ch, 'I need cccc'), 'ok', 'and does not act as a pattern');
  perform public.admin_hotspot_word_remove('c++ (help)');
  delete from public.messages where channel = ch;

  -- the ways round the filter (all of these got through before the text was normalised)
  foreach res in array array[E'ping me 0801 - 234 - 5678 now', E'0801/234/5678', E'0801,234,5678', E'0801_234_5678', E'08012\u200B345678',
                             E'\uFF10\uFF18\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18',
                             E'\u0660\u0668\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668',
                             E'\u06F0\u06F8\u06F0\u06F1 \u06F2\u06F3\u06F4 \u06F5\u06F6\u06F7\u06F8',
                             'zero eight zero one two three four five six seven', 'oh eight oh one two three four five six', '0 8 0 1 2 3 4 5 6 7 8',
                             'yabaparty dot com', 'yabaparty (dot) com', 'find me at yabaparty.com', E'yaba\u200Bparty.com'] loop
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'no_links', 'refused (number or link in disguise): ' || res);
  end loop;
  foreach res in array array[E'message me on wha\u200Btsapp', E'whats\u00ADapp me', 'tele gram is where I am', 'w.h.a.t.s.a.p.p', 'W H A T S A P P', 'wha tsapp', 'dmme', 'd m m e',
                             'dm_me', 'ig: yabaparty', 'IG = yabaparty', 'snap: yabaparty', E'wh\u0430tsapp', E'\u0442elegram',
                             E'\uFF57\uFF48\uFF41\uFF54\uFF53\uFF41\uFF50\uFF50', E'\U0001D5EA\U0001D5F5\U0001D5EE\U0001D601\U0001D600\U0001D5EE\U0001D5FD\U0001D5FD',
                             E'wh\u00E1tsapp', 'i.n.s.t.a'] loop
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'blocked_word', 'refused (word in disguise): ' || res);
  end loop;
  -- a message with nothing that shows is empty
  foreach res in array array[E'\u200B', E'\u200B \u200B', E'\u2060\uFEFF', E'\u00AD', E'\u3164', E'\u2800\u2800', E'\u200E\u200F', E'\u00A0\u2003'] loop
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'empty', 'empty: ' || encode(convert_to(res, 'UTF8'), 'hex'));
  end loop;
  -- ordinary talk is left alone
  foreach res in array array['who is outside tonight', 'Not bad. Me too', 'for example this is fine', 'installing the app now', 'I am 25 and she is 23, 2 of us',
                             'one two three go', E'lol \U0001F602\U0001F602 love it', E'Ol\u00E1, how far? \u00C9 ti de', 'N5000 cover and 3 drinks', 'it is fine ig', 'my instagrammer friend',
                             E'family \U0001F468\u200D\U0001F469\u200D\U0001F467 fun'] loop
    update public.messages set created_at = now() - interval '2 hours' where channel = ch;
    perform pg_temp.eq(pg_temp.say(a, ch, res), 'ok', 'allowed: ' || res);
  end loop;
  -- what is kept has the hiding characters taken out, and the joiners emoji need stay in
  update public.messages set created_at = now() - interval '2 hours' where channel = ch;
  perform pg_temp.eq(pg_temp.say(a, ch, E'hi\u200B there\u2060!'), 'ok', 'zero-width characters in an allowed message');
  perform pg_temp.eq((select body from public.messages where channel = ch and body like 'hi%there%'), 'hi there!', 'are not stored');
  perform pg_temp.ok(exists (select 1 from public.messages where channel = ch and body like E'family%\u200D%'), 'but an emoji joiner is');
  delete from public.messages where channel = ch;

  -- duplicates: the same text twice inside 60 s
  perform pg_temp.eq(pg_temp.say(a, ch, 'Same thing'), 'ok', 'first');
  perform pg_temp.eq(pg_temp.say(a, ch, 'same thing '), 'duplicate', 'the same text again is refused, whatever the case');
  perform pg_temp.eq(pg_temp.say(a, ch, 'something else'), 'ok', 'a different text is fine');
  perform pg_temp.eq(pg_temp.say(b, ch, 'Same thing'), 'ok', 'someone else may say it');
  perform pg_temp.age_msgs(ch, interval '61 seconds');
  perform pg_temp.eq(pg_temp.say(a, ch, 'Same thing'), 'ok', 'after 60 seconds it is fine');
  delete from public.messages where channel = ch;

  -- 5 in 30 seconds, per Hopper
  for i in 1..5 loop
    perform pg_temp.eq(pg_temp.say(a, ch, 'burst ' || i), 'ok', 'message ' || i || ' of 5');
  end loop;
  perform pg_temp.eq(pg_temp.say(a, ch, 'burst 6'), 'slow_down', 'the 6th in 30 s is refused');
  perform pg_temp.eq(pg_temp.say(b, ch, 'b is fine'), 'ok', 'and another Hopper is not held up');
  perform pg_temp.age_msgs(ch, interval '31 seconds');
  perform pg_temp.eq(pg_temp.say(a, ch, 'burst 6'), 'ok', 'after 30 s it is fine');
  delete from public.messages where channel = ch;
  -- 40 an hour
  alter table public.messages disable trigger messages_stamp;
  insert into public.messages (channel, body, author_key, author_name, created_at)
  select ch, 'old ' || g, ka, 'x', now() - interval '10 minutes' - g * interval '1 second' from generate_series(1, 40) g;
  alter table public.messages enable trigger messages_stamp;
  perform pg_temp.eq(pg_temp.say(a, ch, 'forty one'), 'slow_down', 'the 41st in an hour is refused');
  update public.messages set created_at = now() - interval '61 minutes' where channel = ch and body = 'old 40';
  perform pg_temp.eq(pg_temp.say(a, ch, 'forty one'), 'ok', 'one drops out of the hour, one fits');
  delete from public.messages where channel = ch;
  -- the limit table
  perform pg_temp.eq((select burst || '/' || window_s || '/' || coalesce(per_hour::text, '-') from public.chat_rate_limit(ch)), '5/30/40', 'chat_rate_limit: hotspot');
  perform pg_temp.eq((select burst || '/' || window_s || '/' || coalesce(per_hour::text, '-') from public.chat_rate_limit('group:x')), '8/30/-', 'chat_rate_limit: everything else keeps 8 in 30 s');

  -- slow mode: the window, at its edges, in Lagos time (Lagos is UTC+1)
  perform pg_temp.ok(not public.hotspot_slow_now('00:00', '05:00', '2026-10-10 22:59:59+00'), 'slow mode off at 23:59:59 Lagos');
  perform pg_temp.ok(public.hotspot_slow_now('00:00', '05:00', '2026-10-10 23:00:00+00'), 'slow mode on at 00:00 Lagos');
  perform pg_temp.ok(public.hotspot_slow_now('00:00', '05:00', '2026-10-11 03:59:59+00'), 'slow mode on at 04:59:59 Lagos');
  perform pg_temp.ok(not public.hotspot_slow_now('00:00', '05:00', '2026-10-11 04:00:00+00'), 'slow mode off at 05:00 Lagos');
  perform pg_temp.ok(not public.hotspot_slow_now('00:00', '05:00', '2026-10-11 11:00:00+00'), 'slow mode off at noon UTC');
  perform pg_temp.ok(public.hotspot_slow_now('22:00', '02:00', '2026-10-10 22:00:00+00'), 'a window across midnight: 23:00 Lagos');
  perform pg_temp.ok(public.hotspot_slow_now('22:00', '02:00', '2026-10-11 00:30:00+00'), 'a window across midnight: 01:30 Lagos');
  perform pg_temp.ok(not public.hotspot_slow_now('22:00', '02:00', '2026-10-11 12:00:00+00'), 'a window across midnight: 13:00 Lagos');
  perform pg_temp.ok(not public.hotspot_slow_now('03:00', '03:00', '2026-10-11 02:00:00+00'), 'the same time twice is never');
  -- in the trigger (now() cannot move, so the window is set to cover the whole day, then none)
  update public.hotspots set slow_from = '00:00', slow_to = '24:00', slow_seconds = 10 where slug = 'yaba';
  perform pg_temp.eq(pg_temp.say(a, ch, 'night one'), 'ok', 'slow mode: the first message goes');
  perform pg_temp.eq(pg_temp.say(a, ch, 'night two'), 'slow_mode', 'slow mode: a second inside 10 s is held');
  perform pg_temp.eq(pg_temp.say(b, ch, 'night b'), 'ok', 'slow mode: it is per Hopper');
  perform pg_temp.age_msgs(ch, interval '9 seconds');
  perform pg_temp.eq(pg_temp.say(a, ch, 'night two'), 'slow_mode', 'slow mode: 9 s is not enough');
  perform pg_temp.age_msgs(ch, interval '2 seconds');
  perform pg_temp.eq(pg_temp.say(a, ch, 'night two'), 'ok', 'slow mode: 11 s is');
  perform public.admin_hotspot_set_slow('yaba', 0);
  perform pg_temp.eq(pg_temp.say(a, ch, 'night three'), 'ok', 'staff switch it off: no gap');
  perform public.admin_hotspot_set_slow('yaba', 30, '12:00', '12:00');
  perform pg_temp.eq(pg_temp.say(a, ch, 'night four'), 'ok', 'a window that is never: no gap');
  perform pg_temp.eq(public.admin_hotspot_set_slow('yaba', 500)->>'reason', 'bad_seconds', 'slow mode seconds are 0 to 120');
  perform pg_temp.eq(public.admin_hotspot_set_slow('nowhere', 10)->>'reason', 'not_found', 'slow mode on an unknown hotspot');
  update public.hotspots set slow_from = '00:00', slow_to = '05:00', slow_seconds = 0 where slug = 'yaba';
  delete from public.messages where channel = ch;

  -- the room must be open and you must be in it
  perform pg_temp.eq(pg_temp.say(c, ch, 'hello'), 'not_in_hotspot', 'not in the room: cannot post');
  perform pg_temp.eq(pg_temp.say(a, lk, 'hello'), 'not_in_hotspot', 'in another hotspot: cannot post here');
  perform pg_temp.eq(pg_temp.say(a, 'hotspot:' || gen_random_uuid()::text, 'hello'), 'room_closed', 'a hotspot that does not exist');
  perform pg_temp.eq(pg_temp.say(a, 'hotspot:nonsense', 'hello'), 'room_closed', 'a made-up id');
  perform pg_temp.eq(pg_temp.say(a, pg_temp.ch('ikoyi'), 'hello'), 'room_closed', 'planned: the room is closed');
  perform pg_temp.eq(pg_temp.say(a, pg_temp.ch('ikeja'), 'hello'), 'room_closed', 'paused: the room is closed');
  update public.hotspot_visits set fades_at = now() - interval '1 second' where user_id = a;
  perform pg_temp.eq(pg_temp.say(a, ch, 'hello'), 'not_in_hotspot', 'faded: cannot post');
  perform pg_temp.enter(a, 'yaba');
  -- talking keeps you in the room
  update public.hotspot_visits set fades_at = now() + interval '1 minute', last_seen = now() - interval '1 hour' where user_id = a;
  perform pg_temp.eq(pg_temp.say(a, ch, 'still here'), 'ok', 'post');
  perform pg_temp.ok((select fades_at >= now() + interval '10 minutes' from public.hotspot_visits where user_id = a), 'a message pushes the fade out');
  delete from public.messages where channel = ch;

  -- mutes: one alias, one hotspot or all
  ka := pg_temp.key_of(a, 'yaba');
  perform pg_temp.eq(public.admin_hotspot_mute(pg_temp.hid('yaba'), gen_random_uuid(), 1)->>'reason', 'not_a_hotspot_alias', 'mute: not an alias');
  perform pg_temp.eq(public.admin_hotspot_mute(pg_temp.hid('yaba'), (public.identity_for(a, 'group:x', false)).id, 1)->>'reason', 'not_a_hotspot_alias', 'mute: an alias from another kind of room is not one');
  perform pg_temp.eq(public.admin_hotspot_mute(pg_temp.hid('yaba'), ka, 0)->>'reason', 'bad_hours', 'mute: hours');
  res := public.admin_hotspot_mute(pg_temp.hid('yaba'), ka, 2, 'rude')->>'mute';
  perform pg_temp.eq(pg_temp.say(a, ch, 'hello'), 'muted', 'muted in Yaba');
  perform pg_temp.eq(pg_temp.say(b, ch, 'from b'), 'ok', 'only that alias is muted');
  perform pg_temp.eq(pg_temp.sees(a, ch), 'from b', 'a mute does not change what you can read');
  perform pg_temp.ok((pg_temp.enter(a, 'yaba')->>'ok')::boolean, 'a mute does not stop you being there');
  perform pg_temp.enter(a, 'lekki');
  perform pg_temp.eq(pg_temp.say(a, lk, 'hello from lekki'), 'ok', 'a mute in Yaba is not a mute in Lekki');
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.ok((select until between now() + interval '119 minutes' and now() + interval '121 minutes' from public.hotspot_mutes where id = res::uuid), 'two hours');
  perform pg_temp.ok((public.admin_hotspot_unmute(res::uuid)->>'ok')::boolean, 'staff lift it');
  perform pg_temp.eq(pg_temp.say(a, ch, 'hello'), 'ok', 'and the alias can talk again');
  res := public.admin_hotspot_mute(null, ka, 1)->>'mute';
  perform pg_temp.eq(pg_temp.say(a, ch, 'again'), 'muted', 'muted in every hotspot: Yaba');
  perform pg_temp.enter(a, 'lekki');
  perform pg_temp.eq(pg_temp.say(a, lk, 'again'), 'muted', 'muted in every hotspot: Lekki');
  perform pg_temp.eq((select count(*) from public.admin_hotspot_mutes(true))::text, '1', 'the active list has it');
  perform pg_temp.ok(not exists (select 1 from public.admin_hotspot_mutes(false) mm where mm.alias is null), 'the list shows aliases, not user ids');
  perform pg_temp.enter(a, 'yaba');
  update public.hotspot_mutes set until = now() - interval '1 second' where id = res::uuid;
  perform pg_temp.eq(pg_temp.say(a, ch, 'again'), 'ok', 'a mute that has run out is over');
  perform pg_temp.eq((select count(*) from public.admin_hotspot_mutes(true))::text, '0', 'the active list is empty');
  perform pg_temp.eq((select count(*) from public.admin_hotspot_mutes(false))::text, '1', 'the full list still has it');
  delete from public.hotspot_mutes; delete from public.messages where channel in (ch, lk);

  -- paused behind a visitor's back: they cannot post
  perform pg_temp.enter(a, 'yaba');
  update public.hotspots set status = 'paused' where slug = 'yaba';
  perform pg_temp.eq(pg_temp.say(a, ch, 'hello'), 'room_closed', 'paused: cannot post');
  perform pg_temp.eq(pg_temp.sees(a, ch), '', 'paused: nothing to read');
  update public.hotspots set status = 'active' where slug = 'yaba';
  raise notice 'ok: chat rules';
end $t$;

-- ------------------------------------- old rooms, exactly as before ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c');
  ev uuid; ec text; i int; m public.messages; ka uuid; kb uuid; dm uuid; sent text; kh uuid;
begin
  delete from public.hotspot_visits;
  delete from public.messages where channel like 'hotspot:%';
  insert into public.events (title, venue_name, geog, starts_at, status) values ('HS test event', 'HS test venue', st_point(3.70, 6.31)::geography, now(), 'live') returning id into ev;
  update public.events set status = 'live' where id = ev;
  insert into fx values ('ev', ev);
  ec := ev::text;
  insert into public.checkins (event_id, user_id) values (ev, a), (ev, b);

  -- event room
  perform pg_temp.eq(pg_temp.say(c, ec, 'hi'), 'not_at_event', 'event room: not checked in');
  perform pg_temp.eq(pg_temp.say(a, ec, 'hi from a'), 'ok', 'event room: checked in');
  select * into m from public.messages where channel = ec;
  perform pg_temp.eq(m.author_handle, (select handle from public.profiles where id = a), 'event room: the handle shows, as before');
  perform pg_temp.ok(not m.anon and m.author_look is not null, 'event room: named, with a look');
  perform pg_temp.eq(pg_temp.say(a, ec, 'anon one', true), 'ok', 'event room: anon');
  perform pg_temp.ok((select anon and author_handle is null and author_look is null and author_name = (select alias from public.room_identities where id = author_key) from public.messages where channel = ec and body = 'anon one'), 'event room: anon shows the alias only');
  perform pg_temp.eq(pg_temp.sees(b, ec), 'anon one|hi from a', 'event room: checked-in people read it');
  perform pg_temp.eq(pg_temp.sees(c, ec), '', 'event room: others do not');
  perform pg_temp.ok(exists (select 1 from public.activity_log where source_id = m.id and action = 'post'), 'event room: a post is still an active day');
  perform pg_temp.eq(pg_temp.say(a, ec, 'an image', false, 'room/not-mine/x.png'), 'bad_image', 'event room: pictures from your own folder only');
  perform pg_temp.eq(pg_temp.say(a, ec, 'a picture', false, 'room/' || a::text || '/x.png'), 'ok', 'event room: pictures are allowed');
  -- the old limit: 8 in 30 s, not 5
  delete from public.messages where channel = ec;
  for i in 1..8 loop
    perform pg_temp.eq(pg_temp.say(b, ec, 'old ' || i), 'ok', 'event room: message ' || i || ' of 8');
  end loop;
  perform pg_temp.eq(pg_temp.say(b, ec, 'old 9'), 'slow_down', 'event room: the 9th in 30 s is refused (not the 6th)');
  perform pg_temp.age_msgs(ec, interval '31 seconds');
  perform pg_temp.eq(pg_temp.say(b, ec, repeat('z', 300)), 'ok', 'event room: 300 characters');
  perform pg_temp.eq(pg_temp.say(b, ec, 'www.example.com 08012345678 whatsapp'), 'ok', 'event room: no link or word filter here');
  perform pg_temp.age_msgs(ec, interval '31 seconds');
  perform pg_temp.eq(pg_temp.say(b, ec, 'old 1'), 'ok', 'event room: a repeat is fine');
  -- closing: three days after the event
  perform pg_temp.ok(abs(extract(epoch from public.room_closes_at(ec) - (now() + interval '8 hours' + interval '3 days'))) < 1, 'room_closes_at: start + 8 h + 3 days when there is no end');
  update public.events set starts_at = now() - interval '5 days', ends_at = now() - interval '2 days 23 hours' where id = ev;
  perform pg_temp.ok(pg_temp.sees(b, ec) <> '', 'event room: still readable just before it closes');
  update public.events set ends_at = now() - interval '3 days 1 hour' where id = ev;
  perform pg_temp.eq(pg_temp.sees(b, ec), '', 'event room: closed');
  perform pg_temp.eq(pg_temp.say(b, ec, 'late'), 'room_closed', 'event room: cannot post after it closes');
  perform pg_temp.ok(public.room_closes_at(ec) < now(), 'room_closes_at: in the past');
  perform pg_temp.ok(public.room_closes_at('area:nothing') is null and public.room_closes_at('base') is null, 'room_closes_at: nothing for other channels');

  -- group chats, crew moves, the old channels
  update public.events set starts_at = now(), ends_at = now() + interval '3 hours' where id = ev;
  perform pg_temp.eq(pg_temp.say(a, 'group:' || ec, 'group hi'), 'not_in_group', 'group chat: not a member');
  insert into public.event_group_members (event_id, user_id, status) values (ev, a, 'joined'), (ev, b, 'invited') on conflict (event_id, user_id) do update set status = excluded.status;
  perform pg_temp.eq(pg_temp.say(a, 'group:' || ec, 'group hi'), 'ok', 'group chat: a member');
  perform pg_temp.eq(pg_temp.say(b, 'group:' || ec, 'group hi'), 'not_in_group', 'group chat: invited is not joined');
  perform pg_temp.eq(pg_temp.sees(a, 'group:' || ec), 'group hi', 'group chat: members read');
  perform pg_temp.eq(pg_temp.sees(b, 'group:' || ec), '', 'group chat: others do not');
  perform pg_temp.eq(pg_temp.say(a, 'move:' || gen_random_uuid()::text, 'move hi'), 'not_in_move', 'crew move chat: not in it');
  perform pg_temp.eq(pg_temp.say(a, 'base', 'base hi'), 'not_at_event', 'the old base room: nobody posts');
  perform pg_temp.eq(pg_temp.say(a, 'area:yaba', 'area hi'), 'not_at_event', 'an area room: nobody posts');
  perform pg_temp.ok(public.message_visible('base', null, now()) and not public.message_visible('area:yaba', null, now()), 'message_visible: base is open, area is closed');
  perform pg_temp.ok(not public.in_room(a, 'move:' || gen_random_uuid()::text) and not public.in_room(a, 'hop-' || gen_random_uuid()::text) and not public.in_room(a, 'whatever'), 'in_room: the other channels');
  perform pg_temp.ok(public.in_room(a, ec) and not public.in_room(c, ec) and public.in_room(a, 'group:' || ec), 'in_room: event and group');

  -- waves and DMs
  perform pg_temp.as_user(a);
  select w.key into kb from public.whos_here(ev) w;
  sent := public.send_wave(kb);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'sent', 'wave at an event: sent');
  perform pg_temp.as_user(b);
  select w.key into ka from public.whos_here(ev) w;
  sent := public.send_wave(ka);
  perform pg_temp.as_admin();
  perform pg_temp.ok(sent like 'matched:%', 'wave back at an event: matched, ' || sent);
  dm := substr(sent, 9)::uuid;
  perform pg_temp.as_user(a);
  perform public.send_dm(dm, 'hello from the DM', null);
  perform pg_temp.as_admin();
  perform pg_temp.eq((select body from public.dm_messages where dm_id = dm), 'hello from the DM', 'a DM goes through');
  perform pg_temp.as_user(a);
  sent := public.send_wave(kb);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'already', 'waving again: already');

  -- a hotspot head cannot be waved at yet, even by someone you met at the event
  perform pg_temp.enter(a, 'yaba'); perform pg_temp.enter(b, 'yaba');
  kh := pg_temp.key_of(b, 'yaba');
  perform pg_temp.as_user(a);
  sent := public.send_wave(kh);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'not_met', 'waves at hotspot heads wait for Play mode phase 5');
  perform pg_temp.ok(not exists (select 1 from public.waves w where w.from_user = a and w.to_user = b and w.created_at = now() and w.event_id is null), 'and no wave row was made');
  delete from public.hotspot_visits;
  raise notice 'ok: event rooms, group chats, moves, waves and DMs as before';
end $t$;

-- ---------------------------------------------- purge, retention ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); ev uuid := (select id from fx where name = 'ev'); ev_old uuid; k uuid; paths text[];
  today date := public.hotspot_play_day(); res jsonb;
begin
  delete from public.hotspot_visits; delete from public.hotspot_days; delete from public.hotspot_quota; delete from public.hotspot_mutes;
  delete from public.messages where channel like 'hotspot:%' or channel like 'area:%';
  insert into public.events (title, venue_name, geog, starts_at, status) values ('HS old event', 'HS old venue', st_point(3.70, 6.31)::geography, now() - interval '10 days', 'live') returning id into ev_old;
  update public.events set status = 'live', ends_at = now() - interval '9 days' where id = ev_old;
  k := (public.identity_for(a, ev_old::text, false)).id;

  alter table public.messages disable trigger messages_stamp;
  insert into public.messages (channel, body, author_key, author_name, image_path) values
    (ev_old::text, 'old room', k, 'x', 'room/' || a::text || '/old.png'),
    (ev::text, 'open room', null, 'x', null),
    ('area:yaba', 'area', null, 'x', null);
  insert into public.messages (channel, body, author_name, created_at) values
    (pg_temp.ch('yaba'), 'eight days', 'x', now() - interval '8 days'),
    (pg_temp.ch('yaba'), 'six days', 'x', now() - interval '6 days'),
    (pg_temp.ch('lekki'), 'seven days plus', 'x', now() - interval '7 days 1 hour');
  alter table public.messages enable trigger messages_stamp;

  insert into public.hotspot_visits (user_id, hotspot_id, key, fades_at) values
    (a, pg_temp.hid('yaba'), (public.identity_for(a, pg_temp.ch('yaba'), false)).id, now() + interval '15 minutes'),
    (b, pg_temp.hid('yaba'), (public.identity_for(b, pg_temp.ch('yaba'), false)).id, now() - interval '2 hours');
  insert into public.hotspot_days (user_id, play_day, hotspot_id, stayed_at) values
    (a, today - 31, pg_temp.hid('yaba'), now()), (a, today - 29, pg_temp.hid('yaba'), now()), (b, today, pg_temp.hid('lekki'), null);
  insert into public.hotspot_quota (user_id, play_day, entries) values (a, today - 5, 3), (b, today, 2);
  insert into public.hotspot_mutes (hotspot_id, user_id, until) values
    (pg_temp.hid('yaba'), a, now() - interval '31 days'), (pg_temp.hid('yaba'), b, now() + interval '1 hour');

  select array_agg(path) into paths from public.purge_expired_rooms();
  perform pg_temp.eq(paths::text, format('{room/%s/old.png}', a), 'the purge hands back the picture path of the closed event room');
  perform pg_temp.ok(not exists (select 1 from public.messages where channel = ev_old::text), 'a closed event room is deleted');
  perform pg_temp.ok(not exists (select 1 from public.room_identities where channel = ev_old::text), 'with its room names');
  perform pg_temp.ok(exists (select 1 from public.messages where channel = ev::text and body = 'open room'), 'an open event room is kept');
  perform pg_temp.ok(not exists (select 1 from public.messages where channel like 'area:%'), 'area rooms are still deleted');
  perform pg_temp.eq((select string_agg(body, ',' order by body) from public.messages where channel like 'hotspot:%'), 'six days', 'hotspot messages over 7 days go, newer ones stay');
  perform pg_temp.eq((select count(*) from public.hotspot_visits)::text, '1', 'visits that faded over an hour ago go');
  perform pg_temp.ok(exists (select 1 from public.hotspot_visits where user_id = a), 'and the live one stays');
  perform pg_temp.eq((select string_agg((today - play_day)::text, ',' order by play_day) from public.hotspot_days), '29,0', 'day rows over 30 days go');
  perform pg_temp.eq((select string_agg(user_id::text, ',') from public.hotspot_quota), b::text, 'old quota rows go');
  perform pg_temp.eq((select count(*) from public.hotspot_mutes)::text, '1', 'mutes that ended over 30 days ago go');
  perform pg_temp.ok(exists (select 1 from public.hotspot_mutes where user_id = b), 'a mute still in force stays');
  res := public.purge_hotspot_data();
  perform pg_temp.ok((select sum(v::int) from jsonb_each_text(res) e(k, v)) = 0, 'a second run finds nothing: ' || res::text);
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.eq((select count(*) from cron.job where jobname = 'hoppaz-purge-hotspots')::text, '1', 'one hourly housekeeping job');
  end if;
  raise notice 'ok: purge and retention';
end $t$;

-- ----------------------------------------------- reports and staff ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); d uuid := pg_temp.u('d'); e uuid := pg_temp.u('e');
  f uuid := pg_temp.u('f'); h uuid := pg_temp.u('h'); i uuid := pg_temp.u('i'); j uuid := pg_temp.u('j'); k uuid := pg_temp.u('k');
  ch text := pg_temp.ch('yaba'); lk text := pg_temp.ch('lekki'); ec text := (select id::text from fx where name = 'ev');
  msg uuid; ka uuid; alias_a text; r jsonb; rid uuid; n int; ev_msg uuid; x uuid;
begin
  perform pg_temp.confirm(f); perform pg_temp.confirm(h); perform pg_temp.confirm(i); perform pg_temp.confirm(k);
  delete from public.hotspot_visits; delete from public.hotspot_mutes; delete from public.hotspot_quota; delete from public.messages where channel like 'hotspot:%';
  perform pg_temp.enter(a, 'yaba');
  ka := pg_temp.key_of(a, 'yaba'); alias_a := (select alias from public.room_identities where id = ka);
  perform pg_temp.eq(pg_temp.say(a, ch, 'rude message'), 'ok', 'a posts something to report');
  msg := (select id from public.messages where channel = ch and body = 'rude message');
  foreach x in array array[b, c, d, e, f, h, i, k] loop
    perform pg_temp.enter(x, 'yaba');
  end loop;

  -- the kind list
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_kind_check' and conrelid = 'public.reports'::regclass) ~ 'room.*dm.*person.*hotspot', 'reports.kind allows room, dm, person and hotspot');
  -- refusals
  perform pg_temp.eq(pg_temp.report(j, msg, 'rude')->>'reason', 'not_in_hotspot', 'report: only from inside the room');
  perform pg_temp.eq(pg_temp.report(b, msg, '  ')->>'reason', 'bad_reason', 'report: a reason is needed');
  perform pg_temp.eq(pg_temp.report(b, gen_random_uuid(), 'rude')->>'reason', 'gone', 'report: nothing by that id');
  perform pg_temp.eq(pg_temp.report(a, msg, 'rude')->>'reason', 'self', 'report: not yourself');
  perform pg_temp.eq(pg_temp.report(b, (select key from public.hotspot_visits where user_id = pg_temp.u('d')), 'x')->>'ok', 'true', 'report: a head by its key works too');
  delete from public.reports where kind = 'hotspot';
  perform pg_temp.enter(d, 'lekki');
  perform pg_temp.eq(pg_temp.report(b, pg_temp.key_of(d, 'lekki'), 'x')->>'reason', 'not_in_hotspot', 'report: a head in another hotspot cannot be reached');
  perform pg_temp.enter(d, 'yaba');

  -- one report
  r := pg_temp.report(b, msg, 'rude');
  perform pg_temp.ok((r->>'ok')::boolean, 'report: a message');
  select * into rid from (select id from public.reports where kind = 'hotspot' and reporter = b) q;
  perform pg_temp.eq((select kind || '/' || coalesce(hotspot_id::text, '-') || '/' || coalesce(alias, '-') || '/' || ref_id::text || '/' || target::text from public.reports where id = rid),
                     'hotspot/' || pg_temp.hid('yaba') || '/' || alias_a || '/' || msg || '/' || a, 'the report names the hotspot, the alias, the message and the person');
  perform pg_temp.eq((select excerpt from public.reports where id = rid), 'Jibowu / ' || alias_a || ': rude message', 'the excerpt: place, alias, text');
  perform pg_temp.eq(pg_temp.report(b, msg, 'again')->>'reason', 'already', 'report: the same alias in the same hotspot, once a day');
  perform pg_temp.eq(pg_temp.report(b, ka, 'again')->>'reason', 'already', 'report: by the key too');
  -- it shows in the desk's queue as it reads reports today
  perform pg_temp.ok(exists (select 1 from public.reports where kind = 'hotspot' and reviewed_at is null and excerpt like 'Jibowu /%'), 'it is in the open reports queue');

  -- Ola's report still works for event rooms
  perform pg_temp.eq(pg_temp.say(a, ec, 'event rude'), 'ok', 'a posts in the event room');
  ev_msg := (select id from public.messages where channel = ec and body = 'event rude');
  perform pg_temp.as_user(b);
  perform pg_temp.ok(public.report('room', ev_msg, 'spam'), 'report(room) still works');
  perform pg_temp.as_admin();
  perform pg_temp.eq((select kind from public.reports where ref_id = ev_msg), 'room', 'and it is a room report');

  -- three different people: muted in that hotspot for an hour
  perform pg_temp.report(c, msg, 'rude');
  perform pg_temp.ok(not exists (select 1 from public.hotspot_mutes where user_id = a), 'two reports: no mute');
  perform pg_temp.report(d, msg, 'rude');
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = a and hotspot_id = pg_temp.hid('yaba') and auto)::text, '1', 'three reports: muted in Yaba');
  perform pg_temp.ok((select until between now() + interval '59 minutes' and now() + interval '61 minutes' and key = ka from public.hotspot_mutes where user_id = a), 'for an hour, on that alias');
  perform pg_temp.eq(pg_temp.say(a, ch, 'sorry'), 'muted', 'and the alias cannot post');
  perform pg_temp.report(e, msg, 'rude');
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = a)::text, '1', 'a fourth report does not stack another mute');
  perform pg_temp.enter(a, 'lekki');
  perform pg_temp.eq(pg_temp.say(a, lk, 'from lekki'), 'ok', 'the mute is for Yaba only');
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.report(f, msg, 'rude');
  perform pg_temp.ok(not exists (select 1 from public.hotspot_mutes where user_id = a and hotspot_id is null), 'five reports: not yet everywhere');
  -- six: muted in every hotspot for 12 hours
  perform pg_temp.report(h, msg, 'rude');
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = a and hotspot_id is null and auto)::text, '1', 'six reports: muted in every hotspot');
  perform pg_temp.ok((select until between now() + interval '11 hours 59 minutes' and now() + interval '12 hours 1 minute' from public.hotspot_mutes where user_id = a and hotspot_id is null), 'for 12 hours');
  perform pg_temp.enter(a, 'lekki');
  perform pg_temp.eq(pg_temp.say(a, lk, 'from lekki'), 'muted', 'so Lekki too');
  perform pg_temp.report(i, ka, 'rude');
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = a)::text, '2', 'a seventh report adds nothing');

  -- what staff see
  perform pg_temp.eq((select count(*) from public.admin_hotspot_reports(true, 100))::text, '7', 'staff: seven open reports');
  perform pg_temp.ok((select bool_and(hotspot_slug = 'yaba' and alias = alias_a and key = ka and reporters_24h = 6) from public.admin_hotspot_reports(true, 100)), 'each names Yaba, the alias and its key, and how many people reported a message by it (the key report does not count)');
  perform pg_temp.ok((select excerpt from public.admin_hotspot_reports(true, 100) where excerpt not like '%:%') is not null, 'the person report has an excerpt with no message');
  perform pg_temp.eq((select count(*) from public.admin_hotspot_mutes(true) where auto and alias = alias_a)::text, '2', 'staff: two automatic mutes, shown by alias');
  update public.reports set reviewed_at = now() where id = rid;
  perform pg_temp.eq((select count(*) from public.admin_hotspot_reports(true, 100))::text, '6', 'a closed report leaves the open list');
  perform pg_temp.eq((select count(*) from public.admin_hotspot_reports(false, 100))::text, '7', 'and stays in the full one');
  -- staff lift both
  perform public.admin_hotspot_unmute(m.id) from public.admin_hotspot_mutes(true) m;
  perform pg_temp.eq(pg_temp.say(a, lk, 'back'), 'ok', 'lifted: Lekki');
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.eq(pg_temp.say(a, ch, 'back'), 'ok', 'lifted: Yaba');

  -- 20 reports a day
  delete from public.reports where kind = 'hotspot' and reporter = k;
  insert into public.reports (reporter, target, kind, reason) select k, a, 'person', 'x' from generate_series(1, 20);
  perform pg_temp.eq(pg_temp.report(k, msg, 'rude')->>'reason', 'slow_down', 'report: 20 a day');
  delete from public.reports where reporter = k;

  -- the report outlives the message
  perform pg_temp.age_msgs(ch, interval '8 days');
  perform public.purge_hotspot_data();
  perform pg_temp.ok(not exists (select 1 from public.messages where id = msg), 'the message is deleted at 7 days');
  perform pg_temp.eq((select excerpt from public.reports where id = rid), 'Jibowu / ' || alias_a || ': rude message', 'the report keeps its excerpt');
  perform pg_temp.eq((select hotspot_id::text || alias from public.reports where id = rid), pg_temp.hid('yaba')::text || alias_a, 'and the hotspot and alias');

  -- clear the last N minutes
  delete from public.messages where channel = ch;
  perform pg_temp.say(b, ch, 'new one');
  perform pg_temp.say(a, ch, 'older one');
  update public.messages set created_at = now() - interval '1 hour' where channel = ch and body = 'older one';
  perform pg_temp.eq(public.admin_hotspot_clear('yaba', 30)->>'deleted', '1', 'staff: clear the last 30 minutes');
  perform pg_temp.eq((select string_agg(body, ',') from public.messages where channel = ch), 'older one', 'and only those');
  perform pg_temp.eq(public.admin_hotspot_clear('yaba', 0)->>'reason', 'bad_minutes', 'staff: minutes are 1 to 1440');
  perform pg_temp.eq(public.admin_hotspot_clear('nowhere', 10)->>'reason', 'not_found', 'staff: unknown hotspot');

  -- status switches
  update public.hotspots set status = 'split' where slug = 'ojota';
  perform pg_temp.eq(public.admin_hotspot_set_status('ojota', 'open')->>'reason', 'not_found', 'staff cannot reopen a split zone');
  update public.hotspots set status = 'active' where slug = 'ojota';
  perform pg_temp.enter(b, 'yaba');
  r := public.admin_hotspot_set_status('yaba', 'planned');
  perform pg_temp.ok((r->>'ok')::boolean and not exists (select 1 from public.hotspot_visits where hotspot_id = pg_temp.hid('yaba')), 'back to planned: nobody is in the room');
  perform pg_temp.eq(pg_temp.enter(b, 'yaba')->>'reason', 'not_open', 'and it reads opening soon');
  perform public.admin_hotspot_set_status('yaba', 'open');
  perform pg_temp.ok((pg_temp.enter(b, 'yaba')->>'ok')::boolean, 'open again');
  raise notice 'ok: reports, automatic mutes, staff tools';
end $t$;

-- ------------------- reports that count: no muting someone who never spoke ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); d uuid := pg_temp.u('d'); e uuid := pg_temp.u('e');
  f uuid := pg_temp.u('f'); h uuid := pg_temp.u('h'); i uuid := pg_temp.u('i');
  ch text := pg_temp.ch('yaba'); msg uuid; x uuid;
begin
  delete from public.hotspot_quota; delete from public.hotspot_mutes;
  -- only a report that cites a message from the last 24 hours counts toward a mute
  delete from public.reports where kind = 'hotspot'; delete from public.hotspot_visits; delete from public.messages where channel = ch;
  foreach x in array array[b, c, d, e, f, h, i] loop
    perform pg_temp.enter(x, 'yaba');
  end loop;
  -- d has said nothing: six accounts reporting d's head mute nobody
  foreach x in array array[b, c, e, f, h, i] loop
    perform pg_temp.eq(pg_temp.report(x, pg_temp.key_of(d, 'yaba'), 'rude')->>'ok', 'true', 'a head report goes to staff');
  end loop;
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = d)::text, '0', 'six reports on a head that said nothing: no mute, in this hotspot or any');
  perform pg_temp.eq((select count(*) from public.reports where kind = 'hotspot' and target = d and not counts)::text, '6', 'but all six are in the queue for staff');
  perform pg_temp.eq(pg_temp.say(d, ch, 'now d speaks'), 'ok', 'd can still post');
  -- an old message does not count either
  delete from public.reports where kind = 'hotspot';
  perform pg_temp.age_msgs(ch, interval '25 hours');
  msg := (select id from public.messages where channel = ch and body = 'now d speaks');
  perform pg_temp.enter(d, 'yaba');
  foreach x in array array[b, c, e] loop
    perform pg_temp.report(x, msg, 'rude');
  end loop;
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = d)::text, '0', 'three reports on a message from 25 hours ago: no mute');
  -- a message from the last day does
  delete from public.reports where kind = 'hotspot';
  perform pg_temp.eq(pg_temp.say(d, ch, 'd again'), 'ok', 'd posts again');
  msg := (select id from public.messages where channel = ch and body = 'd again');
  foreach x in array array[b, c, e] loop
    perform pg_temp.report(x, msg, 'rude');
  end loop;
  perform pg_temp.eq((select count(*) from public.hotspot_mutes where user_id = d and auto)::text, '1', 'three reports on a message from the last day: muted');
  delete from public.hotspot_mutes; delete from public.reports where kind = 'hotspot'; delete from public.messages where channel = ch;

  raise notice 'ok: only reports that cite a message count toward a mute';
end $t$;

-- ----------------------------------------------- the daily reward ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); d uuid := pg_temp.u('d'); e uuid := pg_temp.u('e');
  r jsonb; xp0 int; today date := public.hotspot_play_day(); acts int;
begin
  delete from public.hotspot_visits; delete from public.hotspot_days; delete from public.hotspot_quota; delete from public.hotspot_mutes;

  -- not in a hotspot, then too early
  perform pg_temp.eq(pg_temp.claim(a)->>'reason', 'not_in_hotspot', 'claim: not in a hotspot');
  perform pg_temp.enter(a, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '1 minute' where user_id = a;
  r := pg_temp.claim(a);
  perform pg_temp.eq(r->>'reason', 'too_early', 'claim: one minute is not five');
  perform pg_temp.ok((r->>'wait_s')::int between 238 and 241, 'and it says how long is left: ' || (r->>'wait_s'));
  perform pg_temp.eq((select xp::text from public.profiles where id = a), '0', 'no XP yet');

  -- five minutes: 10 XP, once
  update public.hotspot_visits set entered_at = now() - interval '5 minutes' where user_id = a;
  select count(*) into acts from public.activity_log where user_id = a;
  r := pg_temp.claim(a);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'xp')::int = 10 and not (r->>'already')::boolean, 'claim: 10 XP after 5 minutes: ' || r::text);
  perform pg_temp.eq((select xp::text from public.profiles where id = a), '10', 'the XP is on the profile');
  perform pg_temp.eq((select count(*) from public.activity_log where user_id = a)::text, acts::text, 'not a streak day, not an outside day: nothing in activity_log');
  perform pg_temp.ok(r->'badge' = 'null'::jsonb, 'no badge yet');
  perform pg_temp.eq(r->>'days_here', '1', 'one stay');
  perform pg_temp.ok((select stayed_at is not null and xp_paid = 10 from public.hotspot_days where user_id = a and play_day = today and hotspot_id = pg_temp.hid('yaba')), 'the day row records the stay and the XP');
  r := pg_temp.claim(a);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'xp')::int = 0 and (r->>'already')::boolean, 'claim again the same day: nothing more');
  perform pg_temp.eq((select xp::text from public.profiles where id = a), '10', 'still 10');
  -- hopping to another hotspot pays nothing extra, but the stay counts there
  perform pg_temp.enter(a, 'lekki');
  update public.hotspot_visits set entered_at = now() - interval '6 minutes' where user_id = a;
  r := pg_temp.claim(a);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'xp')::int = 0 and (r->>'already')::boolean, 'another hotspot, same day: no extra XP');
  perform pg_temp.eq((select xp::text from public.profiles where id = a), '10', 'still 10 after hopping');
  perform pg_temp.ok((select stayed_at is not null and xp_paid = 0 from public.hotspot_days where user_id = a and play_day = today and hotspot_id = pg_temp.hid('lekki')), 'but the Lekki stay is recorded');
  -- the next play-day pays again
  update public.hotspot_days set play_day = play_day - 1 where user_id = a;
  perform pg_temp.enter(a, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '6 minutes' where user_id = a;
  r := pg_temp.claim(a);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'xp')::int = 10, 'the next play-day: 10 XP again');
  perform pg_temp.eq((select xp::text from public.profiles where id = a), '20', 'at 20');
  -- the play-day turns over at 06:00 Lagos
  perform pg_temp.eq(public.hotspot_play_day('2026-10-10 04:59:00+00')::text, '2026-10-09', 'play-day: 05:59 Lagos is still the 9th');
  perform pg_temp.eq(public.hotspot_play_day('2026-10-10 05:00:00+00')::text, '2026-10-10', 'play-day: 06:00 Lagos is the 10th');

  -- paused or faded: nothing to claim
  perform pg_temp.enter(e, 'yaba');
  perform pg_temp.confirm(e);
  perform pg_temp.enter(e, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '9 minutes', fades_at = now() - interval '1 second' where user_id = e;
  perform pg_temp.eq(pg_temp.claim(e)->>'reason', 'not_in_hotspot', 'claim: a faded visit');
  perform pg_temp.enter(e, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '9 minutes' where user_id = e;
  update public.hotspots set status = 'paused' where slug = 'yaba';
  perform pg_temp.eq(pg_temp.claim(e)->>'reason', 'not_in_hotspot', 'claim: a paused hotspot');
  update public.hotspots set status = 'active' where slug = 'yaba';

  -- the Regular badge: four stays at one hotspot within 30 days
  insert into public.hotspot_days (user_id, play_day, hotspot_id, stayed_at) values
    (b, today - 1, pg_temp.hid('yaba'), now()), (b, today - 2, pg_temp.hid('yaba'), now()), (b, today - 3, pg_temp.hid('yaba'), now());
  perform pg_temp.enter(b, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '6 minutes' where user_id = b;
  r := pg_temp.claim(b);
  perform pg_temp.eq(r->>'days_here', '4', 'b: four stays');
  perform pg_temp.eq(r#>>'{badge,key}', 'regular-yaba', 'b: the Regular badge');
  perform pg_temp.eq(r#>>'{badge,name}', 'Regular at Jibowu', 'named for the place');
  perform pg_temp.ok(exists (select 1 from public.badges where user_id = b and key = 'regular-yaba'), 'and it is in badges');
  perform pg_temp.eq((select name || '/' || description from public.badge_catalog where key = 'regular-yaba'), 'Regular at Jibowu/Four days at Jibowu in a month.', 'and in the catalog, so the Me shelf can show it');
  r := pg_temp.claim(b);
  perform pg_temp.ok(r->'badge' = 'null'::jsonb, 'claiming again does not award it twice');
  perform pg_temp.eq((select count(*) from public.badges where user_id = b and key = 'regular-yaba')::text, '1', 'one badge row');
  -- a stay 31 days ago does not count
  insert into public.hotspot_days (user_id, play_day, hotspot_id, stayed_at) values
    (c, today - 31, pg_temp.hid('yaba'), now()), (c, today - 2, pg_temp.hid('yaba'), now()), (c, today - 3, pg_temp.hid('yaba'), now());
  perform pg_temp.enter(c, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '6 minutes' where user_id = c;
  r := pg_temp.claim(c);
  perform pg_temp.eq(r->>'days_here', '3', 'c: the stay over 30 days ago is not counted');
  perform pg_temp.ok(r->'badge' = 'null'::jsonb, 'c: no badge');
  -- four stays split between two hotspots do not count for either
  insert into public.hotspot_days (user_id, play_day, hotspot_id, stayed_at) values
    (d, today - 1, pg_temp.hid('lekki'), now()), (d, today - 2, pg_temp.hid('lekki'), now()), (d, today - 3, pg_temp.hid('yaba'), now());
  perform pg_temp.enter(d, 'yaba');
  update public.hotspot_visits set entered_at = now() - interval '6 minutes' where user_id = d;
  r := pg_temp.claim(d);
  perform pg_temp.ok(r->'badge' = 'null'::jsonb and r->>'days_here' = '2', 'd: two and two is not four at one place');
  -- a visit with no stay is not a stay
  perform pg_temp.ok((select count(*) from public.hotspot_days where user_id = d and stayed_at is null) = 0, 'every counted row had a stay');
  raise notice 'ok: the daily reward and the Regular badge';
end $t$;

-- ----------------------- a hotspot alias is not a way to a person ---
do $t$
declare
  a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); c uuid := pg_temp.u('c'); g uuid := pg_temp.u('guest');
  ev uuid := (select id from fx where name = 'ev'); ch text := pg_temp.ch('yaba');
  kb uuid; ke uuid; sent text; before_handles text; after_handles text; alias_b text; lk bigint;
begin
  delete from public.hotspot_visits; delete from public.hotspot_days; delete from public.hotspot_quota; delete from public.hotspot_mutes;
  delete from public.messages where channel like 'hotspot:%'; delete from public.crew; delete from public.blocks; delete from public.hotspot_blocks;
  update public.events set starts_at = now(), ends_at = now() + interval '3 hours' where id = ev;
  perform pg_temp.enter(a, 'yaba'); perform pg_temp.enter(b, 'yaba');
  kb := pg_temp.key_of(b, 'yaba');
  alias_b := (select alias from public.room_identities where id = kb);

  -- add_to_crew: a hotspot key must not put the real profile into your crew list
  perform pg_temp.as_user(a);
  sent := public.add_to_crew(kb);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'not_met', 'add_to_crew: a hotspot key answers not_met');
  perform pg_temp.ok(not exists (select 1 from public.crew where user_id = a), 'and nothing was added to the crew');
  perform pg_temp.as_user(a);
  sent := public.add_to_crew(gen_random_uuid());
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'gone', 'an unknown key is still gone');
  perform pg_temp.as_user(g);
  sent := public.add_to_crew(kb);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'need_account', 'a guest is still told to make an account');
  -- an event room key still works as before
  perform pg_temp.as_user(a);
  select w.key into ke from public.whos_here(ev) w;
  sent := public.add_to_crew(ke);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'added', 'add_to_crew: an event room key still adds');
  perform pg_temp.as_user(a);
  sent := public.add_to_crew(ke);
  perform pg_temp.as_admin();
  perform pg_temp.eq(sent, 'already', 'and again says already');
  delete from public.crew;
  -- the proof from the review, in full: no way from the alias to the profile through crew
  perform pg_temp.as_user(a);
  perform public.add_to_crew(kb);
  perform pg_temp.eq((select count(*) from public.crew c join public.profiles p on p.id = c.friend_id)::text, '0', 'the crew list holds no profile behind a hotspot alias');
  perform pg_temp.as_admin();

  -- blocking an alias: the person does not vanish from the event lists that show their handle
  perform pg_temp.as_user(a);
  select string_agg(w.handle, ',' order by w.handle) into before_handles from public.whos_here(ev) w;
  perform public.block_person(kb, null, 'x');
  select string_agg(w.handle, ',' order by w.handle) into after_handles from public.whos_here(ev) w;
  perform pg_temp.as_admin();
  perform pg_temp.ok(before_handles is not null and before_handles = after_handles, 'blocking a hotspot alias changes nothing in the event room lists: ' || coalesce(after_handles, 'null'));
  perform pg_temp.eq((select count(*) from public.blocks)::text, '0', 'no global block was made');
  -- my_blocks lists it by alias, unblock lifts it
  perform pg_temp.as_user(a);
  perform pg_temp.eq((select count(*) from public.my_blocks())::text, '1', 'my_blocks lists the hotspot block');
  perform pg_temp.eq((select label from public.my_blocks()), alias_b, 'by its alias');
  perform public.unblock((select id from public.my_blocks()));
  perform pg_temp.eq((select count(*) from public.my_blocks())::text, '0', 'unblock lifts it');
  perform pg_temp.as_admin();
  perform pg_temp.eq((select count(*) from public.hotspot_blocks)::text, '0', 'and the row is gone');
  -- a block from an event room is global as before, and is listed with the others
  perform pg_temp.as_user(a);
  perform public.block_person(ke, null, 'someone');
  perform public.block_person(kb, null, 'x');
  perform pg_temp.eq((select count(*) from public.my_blocks())::text, '2', 'a global block and a hotspot block are both listed');
  perform pg_temp.as_admin();
  perform pg_temp.eq((select count(*) from public.blocks where blocker = a)::text, '1', 'the event room block is global as before');
  perform pg_temp.as_user(a);
  perform public.unblock(id) from public.my_blocks();
  perform pg_temp.eq((select count(*) from public.my_blocks())::text, '0', 'and both lift');
  perform pg_temp.as_admin();
  -- blocking yourself or an unknown key does nothing
  ke := pg_temp.key_of(a, 'yaba');
  perform pg_temp.as_user(a);
  perform pg_temp.ok(not public.block_person(ke, null, 'me') and not public.block_person(gen_random_uuid(), null, 'x'), 'block_person: yourself or nobody is refused');
  perform pg_temp.as_admin();

  -- the Regular badge is private; other badges stay public
  insert into public.badge_catalog (key, name, description) values ('regular-yaba', 'Regular at Jibowu', 'x'), ('hs-test-public', 'Public', 'x') on conflict (key) do nothing;
  insert into public.badges (user_id, key) values (b, 'regular-yaba'), (b, 'hs-test-public') on conflict do nothing;
  perform pg_temp.as_anon();
  perform pg_temp.eq((select count(*) from public.badges where key like 'regular-%')::text, '0', 'badges: signed out, no Regular badge is readable');
  perform pg_temp.eq((select count(*) from public.badges where key = 'hs-test-public')::text, '1', 'but other badges are');
  perform pg_temp.as_user(c);
  perform pg_temp.eq((select count(*) from public.badges where key like 'regular-%')::text, '0', 'badges: another Hopper cannot read it');
  perform pg_temp.as_user(b);
  perform pg_temp.eq((select count(*) from public.badges where key = 'regular-yaba')::text, '1', 'badges: its owner can');
  perform pg_temp.as_admin();

  -- the post lock: a post takes the Hopper's own advisory lock, so parallel posts wait their turn
  perform pg_temp.enter(a, 'yaba');
  perform pg_temp.eq(pg_temp.say(a, ch, 'lock check'), 'ok', 'a posts');
  lk := hashtextextended('hotspot-post:' || a::text, 0);
  perform pg_temp.ok(exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and ((classid::bigint << 32) | objid::bigint) = lk), 'posting takes the per-Hopper lock');
  perform pg_temp.ok(not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and ((classid::bigint << 32) | objid::bigint) = hashtextextended('hotspot-post:' || c::text, 0)), 'and not anyone else''s');
  delete from public.messages where channel like 'hotspot:%'; delete from public.hotspot_visits; delete from public.hotspot_days; delete from public.hotspot_quota;
  raise notice 'ok: a hotspot alias is not a way to a person';
end $t$;

do $t$ begin raise notice 'ALL HOTSPOT TESTS PASSED'; end $t$;

rollback;
