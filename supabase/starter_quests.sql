-- ============================================================================
-- Hoppaz: starter quests (every event comes with quests from day one)
-- Run order: schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql,
-- spawn_points_lagos.sql, box_guards.sql, daily_box.sql, play.sql, then THIS
-- FILE. Safe to run again. It only needs schema.sql (events, quests, checkins,
-- event_photos, crews); it is listed after play.sql so the order stays one line.
-- Plan: docs/EVENT-PLANNER.md (item 3, "a starter kit on every event"). Tests:
-- supabase/tests/starter_quests_test.sql.
--
-- Only quests the app can verify. Nothing vague ("learn the DJ's name", "dance
-- through a song"): every quest below is checked by claim_quest() itself, or by
-- a person looking at a photo in the admin desk. What each one proves:
--
--   Check in at <venue>   type checkin (the venue name, without its street
--                         address). claim_quest() wants a checkins row for the
--                         event, and the only way to get one is claim_checkin(),
--                         which measures the Hopper's position against the venue
--                         (1500 m) and refuses from far away.
--                         So the quest is paid only to someone the server put at
--                         the venue. 25 XP: a small extra on top of the check-in
--                         itself (100 XP in DECISIONS.md, 50 XP in the code
--                         until Track B lands).
--   Snap the vibe         type photo. claim_quest() wants a photo of the Hopper's
--                         own at this event; event_photos only accepts photos
--                         from someone already checked in. The claim waits as
--                         'pending' until staff open Photo review in /admin and
--                         press APPROVE; the photo trigger then approves the
--                         claim and pays the XP. 60 XP.
--   Squad of four         type GROUP (group_size 4), not a photo. claim_quest()
--                         counts the crew's members who have a check-in at the
--                         event and wants at least four, so the app proves four
--                         people were there. A photo with four people in it
--                         proves nothing the app can check: the reviewer would
--                         count heads, and any photo of the event already pays
--                         "Snap the vibe". The claimer must be one of the four
--                         (see claim_quest below). 80 XP.
--   Find the code         type qr, only when the organiser has set a code (see
--                         give_event_starter_quests). claim_quest() checks the
--                         code against its stored hash. 40 XP.
--
-- XP follows DECISIONS.md: going out pays most. A full kit adds up to 205 XP on
-- top of the check-in, more than a whole day of boxes (150 XP ceiling), and the
-- check-in quest alone stays small. Change the numbers in the VALUES list below.
--
-- What it adds:
--   give_event_starter_quests(event, code)   the kit for one event. Adds only
--                         what is missing, so it can be called any number of
--                         times. Returns how many quests it made. Service role
--                         only (the admin routes and later the organiser tools).
--   events_starter_quests   trigger: when an event goes live (inserted live, or
--                         pending to live) it gets its kit, once. Never on a
--                         pending or rejected event.
--   events_starter_quests_follow   trigger: when a live event's start, end or
--                         venue changes, its kit follows (see "the clock").
--   backfill_starter_quests()   gives every live event that has no kit its kit.
--                         Run at the end of this file, and again any time
--                         (select public.backfill_starter_quests()).
--   quest_claims.evidence_id   the column claim_quest() and the photo approval
--                         trigger use but schema.sql never adds (see below).
--   claim_quest()         schema.sql's, with two fixes (see below).
--
-- No duplicates: each kit quest has a fixed key, 'kit-<event id>-<name>', and
-- the insert skips a key that exists. A kit quest is also skipped when the event
-- already has a quest of that type that staff made, so an event with its own
-- check-in quest does not get a second "Check in" line. A quest staff switch off
-- (active = false) stays off and is not made again.
--
-- The clock. Quests are visible and claimable from the moment the event goes
-- live (the Today cards list them from day one) and close 2 hours after the
-- event ends (an event with no end time is taken as 8 hours long, the same rule
-- as claim_collectible). An event whose window is already over gets no kit. When
-- an event is moved, the kit moves with it. Known limit, not changed here:
-- claim_checkin() has no time window of its own, so a Hopper within 1500 m of
-- the venue could check in early and claim the check-in quest before the night.
--
-- The code. There is no code column on events (it would be readable by every
-- Hopper). The organiser's code is passed in once and kept only as a hash in
-- quest_codes, as the admin desk does:
--   select public.give_event_starter_quests('<event id>', 'DOOR-1234');
-- That adds "Find the code" (qr, 40 XP) with that code. The code is exact,
-- including capitals, 4 to 64 characters, up to 2000 claims, and a code used by
-- another quest is refused. Calling it again with the same code changes nothing;
-- a different code is added beside the first (retire one with
-- quest_codes.active = false).
--
-- If schema.sql is ever run again, run this file after it: schema.sql puts the
-- old claim_quest back (same as spawning.sql and claim_game_drop). The
-- evidence_id column stays once added.
-- ============================================================================

-- --------------------------------------------------------------- the kit ---
-- The check-in quest's title. Venue names often carry the street address after a
-- comma ("SOTO Gallery, 10 Omo Osagie Street"); the title keeps the name only.
create or replace function public.starter_checkin_title(p_venue text)
returns text language sql immutable set search_path = public as $$
  select 'Check in at ' || left(
    case when char_length(btrim(split_part(p_venue, ',', 1))) >= 2 then btrim(split_part(p_venue, ',', 1)) else btrim(p_venue) end, 85);
$$;

create or replace function public.give_event_starter_quests(p_event uuid, p_code text default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  ev events; v_end timestamptz; v_made integer := 0; v_n integer;
  v_code text := nullif(btrim(coalesce(p_code, '')), ''); v_key text; v_quest uuid; v_hash text;
begin
  select * into ev from events where id = p_event and status = 'live';
  if not found then return 0; end if;
  -- the window closes 2 hours after the event ends; an event that is already over gets no kit
  v_end := coalesce(ev.ends_at, ev.starts_at + interval '8 hours') + interval '2 hours';
  if v_end <= now() then return 0; end if;
  if v_code is not null and char_length(v_code) not between 4 and 64 then
    raise exception 'The code must be 4 to 64 characters.';
  end if;
  -- the trigger, the backfill and an admin call can meet: one at a time per event
  perform pg_advisory_xact_lock(hashtextextended('starter:' || p_event::text, 0));

  insert into quests (key, title, description, quest_type, event_id, starts_at, ends_at, repeat_period, xp_reward, group_size)
  select 'kit-' || ev.id || '-' || k.slug, k.title, k.description, k.quest_type, ev.id, now(), v_end, 'once', k.xp, k.size
  from (values
    ('checkin', public.starter_checkin_title(ev.venue_name), 'Get to the venue and tap CHECK IN. Easiest XP of the night.', 'checkin', 25, 2),
    ('photo',   'Snap the vibe', 'Check in, then post one photo from the night. We take a look, then the XP lands.', 'photo', 60, 2),
    ('squad',   'Squad of four', 'Get four of your crew checked in here, then pick your crew and claim it.', 'group', 80, 4)
  ) as k(slug, title, description, quest_type, xp, size)
  where not exists (select 1 from quests q where q.event_id = ev.id and q.quest_type = k.quest_type)
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;
  v_made := v_made + v_n;

  -- "Find the code": only when the organiser has set one
  if v_code is not null then
    v_key := 'kit-' || ev.id || '-code';
    select id into v_quest from quests where key = v_key;
    if v_quest is null then
      insert into quests (key, title, description, quest_type, event_id, starts_at, ends_at, repeat_period, xp_reward, group_size)
      values (v_key, 'Find the code', 'Spot the code at the venue, then scan it or type it in.', 'qr', ev.id, now(), v_end, 'once', 40, 2)
      returning id into v_quest;
      v_made := v_made + 1;
    end if;
    v_hash := encode(digest(v_code, 'sha256'), 'hex');
    insert into quest_codes (quest_id, code_hash, valid_from, valid_until, max_uses)
    values (v_quest, v_hash, now(), null, 2000)
    on conflict (code_hash) do nothing;
    if not exists (select 1 from quest_codes where quest_id = v_quest and code_hash = v_hash) then
      raise exception 'That code is already used by another quest. Pick a different one.';
    end if;
  end if;
  return v_made;
end $$;
revoke all on function public.give_event_starter_quests(uuid, text) from public, anon, authenticated;
grant execute on function public.give_event_starter_quests(uuid, text) to service_role;

-- Every live event that still has no kit gets one. Returns how many quests it made.
create or replace function public.backfill_starter_quests()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_total integer := 0;
begin
  for r in select id from events where status = 'live' order by starts_at loop
    v_total := v_total + public.give_event_starter_quests(r.id);
  end loop;
  return v_total;
end $$;
revoke all on function public.backfill_starter_quests() from public, anon, authenticated;
grant execute on function public.backfill_starter_quests() to service_role;

-- --------------------------------------------------------------- triggers ---
-- Going live: inserted as live (staff, the importer), or pending to live (approval).
create or replace function public.starter_quests_on_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    perform public.give_event_starter_quests(new.id);
  end if;
  return null;
end $$;
revoke all on function public.starter_quests_on_event() from public, anon, authenticated;
drop trigger if exists events_starter_quests on public.events;
create trigger events_starter_quests after insert or update of status on public.events
  for each row execute function public.starter_quests_on_event();

-- The kit follows the event. A moved event keeps its quests open until 2 hours
-- after its new end; a renamed venue renames the check-in quest. Only quests with
-- the kit's own keys are touched. A window that is already over closes the quest
-- (a quest cannot end before it started, so it ends 1 minute after it started).
create or replace function public.starter_quests_follow_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_end timestamptz := coalesce(new.ends_at, new.starts_at + interval '8 hours') + interval '2 hours';
begin
  update quests set ends_at = greatest(v_end, starts_at + interval '1 minute')
  where key like 'kit-' || new.id || '-%' and ends_at is distinct from greatest(v_end, starts_at + interval '1 minute');
  if new.venue_name is distinct from old.venue_name then
    update quests set title = public.starter_checkin_title(new.venue_name)
    where key = 'kit-' || new.id || '-checkin';
  end if;
  return null;
end $$;
revoke all on function public.starter_quests_follow_event() from public, anon, authenticated;
drop trigger if exists events_starter_quests_follow on public.events;
create trigger events_starter_quests_follow after update of venue_name, starts_at, ends_at on public.events
  for each row
  when (old.venue_name is distinct from new.venue_name or old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
  execute function public.starter_quests_follow_event();

-- ------------------------------------------------- quest_claims.evidence_id ---
-- The photo a photo quest claim stands on. claim_quest() writes it and the photo
-- approval trigger (log_approved_photo, schema.sql) reads it, but schema.sql never
-- adds the column. On a database built from schema.sql, every claim_quest() call
-- therefore ended in "column evidence_id of relation quest_claims does not exist",
-- and so did approving a photo in Photo review.
alter table public.quest_claims add column if not exists evidence_id uuid references public.event_photos(id) on delete set null;
create index if not exists quest_claims_evidence_idx on public.quest_claims(evidence_id) where evidence_id is not null;

-- ------------------------------------------------------------- claim_quest ---
-- schema.sql's claim_quest with two fixes, everything else word for word:
--  1. search_path now includes extensions. pgcrypto's digest() lives there, and
--     with search_path = public the code check for 'qr' and 'insight' quests
--     failed with "function digest(text, unknown) does not exist", so no code
--     quest could ever be claimed. (claim_game_drop already has it.)
--  2. A 'group' claim also needs the claimer to have a check-in at the event.
--     Before, any member of a crew with enough checked-in members could claim
--     from home, so "Squad of four" would have paid crew members who were not
--     there. The answer is the same checkin_required the check-in quest gives.
create or replace function public.claim_quest(p_quest uuid,p_event uuid default null,p_code text default null,p_evidence text default null,p_crew uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare q quests; me uuid:=auth.uid(); period text; claim_status text:='approved'; c quest_codes; members int; new_claim uuid; photo_ref uuid;
begin
  if me is null then return jsonb_build_object('ok',false,'reason','no_session'); end if;
  select * into q from quests where id=p_quest and active and starts_at<=now() and (ends_at is null or ends_at>now());
  if not found then return jsonb_build_object('ok',false,'reason','closed'); end if;
  period:=case q.repeat_period when 'daily' then to_char(now() at time zone 'Africa/Lagos','YYYY-MM-DD') when 'weekly' then to_char(date_trunc('week',now() at time zone 'Africa/Lagos'),'YYYY-MM-DD') when 'monthly' then to_char(now() at time zone 'Africa/Lagos','YYYY-MM') else 'once' end;
  if q.event_id is not null and p_event is distinct from q.event_id then return jsonb_build_object('ok',false,'reason','wrong_event'); end if;
  if q.quest_type='checkin' and not exists(select 1 from checkins where user_id=me and event_id=coalesce(p_event,q.event_id)) then return jsonb_build_object('ok',false,'reason','checkin_required');
  elsif q.quest_type='photo' then
    select p.id,p.moderation_status into photo_ref,claim_status from event_photos p where p.user_id=me and p.event_id=coalesce(p_event,q.event_id) and not p.hidden and p.moderation_status in ('pending','approved') and not exists(select 1 from quest_claims old where old.quest_id=q.id and old.evidence_id=p.id) order by p.created_at desc limit 1;
    if photo_ref is null then return jsonb_build_object('ok',false,'reason','photo_required'); end if;
    claim_status:=case when exists(select 1 from event_photos where id=photo_ref and moderation_status='approved') then 'approved' else 'pending' end;
  elsif q.quest_type in ('qr','insight') then
    update quest_codes set uses=uses+1 where quest_id=q.id and active and code_hash=encode(digest(coalesce(p_code,''),'sha256'),'hex') and valid_from<=now() and (valid_until is null or valid_until>now()) and uses<max_uses returning * into c;
    if not found then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
    if q.quest_type='insight' then claim_status:='pending'; end if;
  elsif q.quest_type='group' then
    if p_crew is null or not public.is_crew_member(p_crew) then return jsonb_build_object('ok',false,'reason','crew_required'); end if;
    -- fix 2: the claimer must be at the event too
    if not exists(select 1 from checkins where user_id=me and event_id=coalesce(p_event,q.event_id)) then return jsonb_build_object('ok',false,'reason','checkin_required'); end if;
    select count(*) into members from crew_members cm join checkins ci on ci.user_id=cm.user_id where cm.crew_id=p_crew and ci.event_id=coalesce(p_event,q.event_id);
    if members<q.group_size then return jsonb_build_object('ok',false,'reason','group_not_there'); end if;
  end if;
  insert into quest_claims(quest_id,user_id,event_id,crew_id,period_key,evidence,status,evidence_id) values(q.id,me,coalesce(p_event,q.event_id),p_crew,period,left(p_evidence,500),claim_status,photo_ref) on conflict(quest_id,user_id,period_key) do nothing returning id into new_claim;
  if new_claim is null then return jsonb_build_object('ok',false,'reason','already'); end if;
  if claim_status='approved' then
    update profiles set xp=xp+q.xp_reward where id=me;
    insert into activity_log(user_id,action,source_id,event_id,crew_id,outside_score) values(me,'quest',new_claim,coalesce(p_event,q.event_id),p_crew,(select score from game_score_rules where key='quest'));
    if q.badge_key is not null then perform award_badge(me,q.badge_key); end if;
  end if;
  return jsonb_build_object('ok',true,'status',claim_status,'xp',case when claim_status='approved' then q.xp_reward else 0 end);
end $$;

-- --------------------------------------------------------------- backfill ---
-- Live events that went live before this file existed get their kit now.
do $backfill$
declare v_made integer;
begin
  v_made := public.backfill_starter_quests();
  raise notice 'starter quests: % made for live events that had none', v_made;
end $backfill$;
