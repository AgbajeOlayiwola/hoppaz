-- ============================================================================
-- Hoppaz: Today's box (the daily box on Me)
-- Run order: schema.sql, hunt_items.sql, spawning.sql, then this file in the
-- Supabase SQL editor. Safe to run again.
--
-- One box a day for every Hopper, opened from the Me tab. It is the reason to
-- open the app on a day you are staying in: it pays a little XP and it keeps
-- the daily streak alive. It is not a drop (no place, no radius, no reward
-- pool), so it lives in its own small table.
--
-- What it adds:
--   daily_boxes       one row per Hopper per Lagos day: what the box held.
--                     A Hopper can read their own rows and nothing else; rows
--                     are only written by open_daily_box().
--   daily_box_roll()  the prize table (pure, so it can be tested at the
--                     edges). 60% Small find 15 XP, 30% Good find 30 XP,
--                     9% Big find 75 XP, 1% Jackpot 200 XP.
--   open_daily_box()  opens today's box: once per Hopper per Lagos day. Adds
--                     the XP to profiles.xp and logs a 'daily' row in
--                     activity_log with outside_score 0, so the daily streak
--                     counts it (staying in is not going out, so it scores
--                     nothing on the Outside Score board). A second call the
--                     same day changes nothing and returns today's result
--                     with already = true.
--   my_week_days()    the Lagos dates this week (Monday start) on which the
--                     caller has any activity_log row. Drives the seven dots
--                     on the streak tile.
--   rank rule         my_game_stats(), create_monthly_report() and
--                     monthly_leaderboard() are schema.sql's, each with one
--                     change: a Hopper with no Outside Score this month is not
--                     ranked (lagos_rank is 0 / left out). Without it, a Hopper
--                     who only opened daily boxes (score 0) would be "#N in
--                     Lagos". The change is the "having sum" in each.
--
-- Cards (cards.sql, run after play.sql): open_daily_box answers with `card`, null unless
-- staff switch on card_rules 'daily_box'. Nothing else about the box changes.
--
-- activity_log.action gets one new value, 'daily'. The check is widened, no
-- row changes. Days are Lagos days (Africa/Lagos), the same as my_game_stats().
--
-- If schema.sql is ever run again, run this file after it: schema.sql puts back
-- the old rank rule. (Same as spawning.sql and claim_game_drop.)
-- ============================================================================

-- ------------------------------------------------------------ activity log ---
-- Adds 'daily' to the allowed actions, and only when it is not there yet: a
-- re-run changes nothing (no table lock, no re-scan). Whatever other actions the
-- live check already allows are kept, so a value another file added is not lost.
-- One DO block is one statement: the old check is never left dropped.
do $$
declare
  v_def  text;
  v_list text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.activity_log'::regclass and c.conname = 'activity_log_action_check';

  if v_def like '%''daily''%' then return; end if;

  v_list := case
    when v_def is null then array['checkin', 'quest', 'photo', 'post', 'drop', 'crew']
    else array(select m[1] from regexp_matches(v_def, '''([^'']+)''', 'g') as m)
  end || 'daily'::text;

  alter table public.activity_log drop constraint if exists activity_log_action_check;
  execute format(
    'alter table public.activity_log add constraint activity_log_action_check check (action in (%s))',
    (select string_agg(quote_literal(a), ', ') from unnest(v_list) as a)
  );
end $$;

-- ------------------------------------------------------------- daily boxes ---
create table if not exists public.daily_boxes (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  day          date not null,
  reward_title text not null,
  xp           integer not null check (xp > 0),
  rarity       text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  opened_at    timestamptz not null default now(),
  -- what the activity_log row points back at
  id           uuid not null unique default gen_random_uuid(),
  primary key (user_id, day)
);

alter table public.daily_boxes enable row level security;
drop policy if exists daily_boxes_read_own on public.daily_boxes;
create policy daily_boxes_read_own on public.daily_boxes for select using (user_id = auth.uid());
revoke all on public.daily_boxes from anon, authenticated;
grant select on public.daily_boxes to authenticated;

-- ------------------------------------------------------------- prize table ---
-- p_roll is a number in [0, 1). The caller passes random().
create or replace function public.daily_box_roll(p_roll double precision)
returns table(title text, xp integer, rarity text)
language sql immutable set search_path = public as $$
  select case when p_roll < 0.60 then 'Small find' when p_roll < 0.90 then 'Good find' when p_roll < 0.99 then 'Big find' else 'Jackpot' end,
         case when p_roll < 0.60 then 15 when p_roll < 0.90 then 30 when p_roll < 0.99 then 75 else 200 end,
         case when p_roll < 0.60 then 'common' when p_roll < 0.90 then 'rare' when p_roll < 0.99 then 'epic' else 'legendary' end;
$$;
revoke all on function public.daily_box_roll(double precision) from public, anon, authenticated;
grant execute on function public.daily_box_roll(double precision) to service_role;

-- ---------------------------------------------------------- open the box ---
create or replace function public.open_daily_box()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_prize record;
  v_box   public.daily_boxes;
  v_card  jsonb;
  v_max   text;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  select * into v_prize from public.daily_box_roll(random());

  -- The primary key settles a race: a second call at the same moment waits for the
  -- first, then finds the row and takes the "already" branch below.
  insert into public.daily_boxes (user_id, day, reward_title, xp, rarity)
  values (v_me, v_today, v_prize.title, v_prize.xp, v_prize.rarity)
  on conflict (user_id, day) do nothing
  returning * into v_box;

  if v_box.id is null then
    select * into v_box from public.daily_boxes where user_id = v_me and day = v_today;
    -- cards.sql: the card today's box gave, if it gave one
    if to_regclass('public.user_cards') is not null then
      v_card := public.card_for_source(v_me, 'daily', v_box.id);
    end if;
    return jsonb_build_object('ok', true, 'already', true, 'title', v_box.reward_title, 'xp', v_box.xp, 'rarity', v_box.rarity, 'card', v_card);
  end if;

  update public.profiles set xp = xp + v_box.xp where id = v_me;
  insert into public.activity_log (user_id, action, source_id, outside_score) values (v_me, 'daily', v_box.id, 0) on conflict do nothing;

  -- cards.sql: this box pays a card only when staff set card_rules 'daily_box' max_tier
  -- (null by default: Today's box pays XP only). The card's tier is the box's rarity,
  -- capped at max_tier. The XP above is not touched.
  if to_regclass('public.card_rules') is not null then
    v_max := public.card_rule('daily_box') ->> 'max_tier';
    if v_max is not null then
      v_card := public.grant_card(v_me, v_box.rarity, null, v_max, v_box.xp, null, null, 'daily', v_box.id) -> 'card';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'title', v_box.reward_title, 'xp', v_box.xp, 'rarity', v_box.rarity, 'card', v_card);
end $$;
revoke all on function public.open_daily_box() from public, anon;
grant execute on function public.open_daily_box() to authenticated;

-- ------------------------------------------------------- this week's days ---
create or replace function public.my_week_days()
returns setof date language sql stable security definer set search_path = public as $$
  select distinct (a.created_at at time zone 'Africa/Lagos')::date as day
  from public.activity_log a
  where a.user_id = auth.uid()
    and a.created_at >= date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
  order by 1;
$$;
revoke all on function public.my_week_days() from public, anon;
grant execute on function public.my_week_days() to authenticated;

-- --------------------------------------------------- the Outside Score board ---
-- schema.sql's functions, one change each: `having sum(outside_score) > 0`, so
-- the daily box (and any other row worth 0) never puts a Hopper on the board.
-- A Hopper with no score gets lagos_rank 0 from my_game_stats() and null from
-- create_monthly_report(); the report poster shows no rank for either.

create or replace function public.my_game_stats(p_month date default date_trunc('month',now() at time zone 'Africa/Lagos')::date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  me uuid:=auth.uid(); month_end date:=(p_month+interval '1 month')::date;
  monthly bigint; outing int; active_days int; daily_streak int:=0; week_days int; weekend int; outing_streak int:=0; lagos_rank int:=0; today date:=(now() at time zone 'Africa/Lagos')::date;
begin
  if me is null then return '{}'::jsonb; end if;
  select coalesce(sum(outside_score),0),count(distinct (created_at at time zone 'Africa/Lagos')::date)
    into monthly,active_days from activity_log where user_id=me and created_at>=p_month::timestamp at time zone 'Africa/Lagos' and created_at<month_end::timestamp at time zone 'Africa/Lagos';
  select count(*) into outing from checkins where user_id=me and created_at>=p_month::timestamp at time zone 'Africa/Lagos' and created_at<month_end::timestamp at time zone 'Africa/Lagos';
  select count(distinct (created_at at time zone 'Africa/Lagos')::date) into week_days from activity_log where user_id=me and created_at>=date_trunc('week',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  select count(*) into weekend from checkins where user_id=me and extract(isodow from created_at at time zone 'Africa/Lagos') in (5,6,7) and created_at>=date_trunc('week',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  with days as (select distinct (created_at at time zone 'Africa/Lagos')::date d from activity_log where user_id=me),
  anchor as (select case when exists(select 1 from days where d=today) then today else today-1 end d),
  numbered as (select days.d, anchor.d-days.d-(row_number() over(order by days.d desc)::int-1) gap from days cross join anchor where days.d<=anchor.d)
  select count(*) into daily_streak from numbered where gap=0;
  with weeks as (select distinct date_trunc('week',created_at at time zone 'Africa/Lagos')::date d from checkins where user_id=me),
  anchor as (select case when exists(select 1 from weeks where d=date_trunc('week',now() at time zone 'Africa/Lagos')::date) then date_trunc('week',now() at time zone 'Africa/Lagos')::date else (date_trunc('week',now() at time zone 'Africa/Lagos')-interval '7 days')::date end d),
  numbered as (select weeks.d, (anchor.d-weeks.d)/7-(row_number() over(order by weeks.d desc)::int-1) gap from weeks cross join anchor where weeks.d<=anchor.d)
  select count(*) into outing_streak from numbered where gap=0;
  return jsonb_build_object('month_start',p_month,'outside_score',monthly,'active_days',active_days,'verified_outings',outing,'active_days_this_week',week_days,'weekend_outings_this_week',weekend,'daily_streak',daily_streak,'weekly_activity_goal',week_days>=3,'weekend_goal',weekend>0,'outing_streak',outing_streak,'lagos_rank',(select coalesce((select rank::int from (select user_id,dense_rank() over(order by sum(outside_score) desc) rank from activity_log where created_at>=p_month::timestamp at time zone 'Africa/Lagos' and created_at<month_end::timestamp at time zone 'Africa/Lagos' group by user_id having sum(outside_score)>0) ranks where user_id=me),0)));
end $$;

create or replace function public.create_monthly_report(p_month date default (date_trunc('month',now() at time zone 'Africa/Lagos')-interval '1 month')::date)
returns text language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); snap jsonb; token text; month_end date:=(p_month+interval '1 month')::date;
begin
 if me is null then return null; end if;
 snap:=my_game_stats(p_month)||jsonb_build_object(
  'name',(select coalesce(display_name,'A Hopper') from profiles where id=me),
  'events',(select count(*) from checkins where user_id=me and created_at>=p_month::timestamp at time zone 'Africa/Lagos' and created_at<month_end::timestamp at time zone 'Africa/Lagos'),
  'quests',(select count(*) from quest_claims where user_id=me and status='approved' and claimed_at>=p_month::timestamp at time zone 'Africa/Lagos' and claimed_at<month_end::timestamp at time zone 'Africa/Lagos'),
  'crew_activity',(select count(*) from activity_log where user_id=me and crew_id is not null and created_at>=p_month::timestamp at time zone 'Africa/Lagos' and created_at<month_end::timestamp at time zone 'Africa/Lagos'),
  'lagos_rank',(select rank::int from (select user_id,dense_rank() over(order by sum(outside_score) desc) rank from activity_log where created_at>=p_month::timestamp at time zone 'Africa/Lagos' and created_at<month_end::timestamp at time zone 'Africa/Lagos' group by user_id having sum(outside_score)>0) ranks where user_id=me));
 insert into monthly_reports(user_id,month_start,snapshot) values(me,p_month,snap) on conflict(user_id,month_start) do update set snapshot=excluded.snapshot,created_at=now() returning share_token into token;
 return token;
end $$;

-- Public leaderboards expose names and scores only, never user IDs or location.
create or replace function public.monthly_leaderboard(p_month date default date_trunc('month',now() at time zone 'Africa/Lagos')::date,p_limit int default 50)
returns table(rank bigint,display_name text,outside_score bigint,avatar jsonb)
language sql stable security definer set search_path=public as $$
 select row_number() over(order by sum(a.outside_score) desc)::bigint,coalesce(p.display_name,'Hopper'),sum(a.outside_score),p.avatar
 from activity_log a join profiles p on p.id=a.user_id
 where a.created_at >= p_month::timestamp at time zone 'Africa/Lagos' and a.created_at < (p_month+interval '1 month')::timestamp at time zone 'Africa/Lagos'
 group by p.id,p.display_name,p.avatar having sum(a.outside_score)>0 order by sum(a.outside_score) desc limit least(greatest(p_limit,1),100);
$$;
