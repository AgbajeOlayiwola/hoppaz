-- ============================================================================
-- Hoppaz: Play mode, part 1 (small boxes, welcome layout, the heartbeat)
-- Run order: schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql,
-- spawn_points_lagos.sql, box_guards.sql, daily_box.sql, then THIS FILE LAST.
-- Safe to run again. Spec: docs/PLAY-MODE.md. Plan: docs/PLAY-BUILD-PLAN.md
-- (Phase 1). The client contract is docs/PLAY-API.md.
--
-- Why last: it replaces claim_game_drop() and spawn_welcome_boxes_for(), which
-- spawning.sql defines. If you ever re-run spawning.sql (or schema.sql, which
-- restores the oldest claim_game_drop), run this file again afterwards.
--
-- What it adds:
--   lagos_play_day()     the play-day (06:00 to 06:00 Lagos) a moment belongs to.
--   game_drops           kind 'near' (a small box, only its owner sees it), claim
--                        method 'avatar' (room for the spot boxes to come), and
--                        needs_presence: false for near boxes and all three welcome
--                        boxes (A, B and C), which are opened by sending the avatar
--                        (no radius, no coordinates). Everything else keeps needing
--                        presence.
--   play_fix             one row per Hopper: the last position the heartbeat saw,
--                        rounded to 3 decimals (about 110 m), its accuracy and
--                        time, and the small counters later phases use. RLS on,
--                        no policy, nothing granted to anon or authenticated: only
--                        the functions below read it. A nightly job deletes rows
--                        older than 24 hours.
--   play_tick()          the heartbeat the app calls every 20 s while Play is
--                        open: writes play_fix, tops up 3 small boxes around the
--                        Hopper (60 to 150 m by day, 20 to 60 m at night, never in
--                        a no-spawn zone, 10 opened a play-day, 30 rows made at most) and returns the Hopper's
--                        boxes. One call per 15 s. The heavier work (retiring far
--                        boxes, the top-up) runs when the last full pass is older
--                        than about 50 s, so on every third tick.
--   claim_game_drop()    the spawning.sql version plus a remote path for boxes
--                        with needs_presence = false.
--   spawn_welcome_boxes_for()   new layout: A 25 m, B 90 to 130 m, C 180 to 250 m;
--                        night 15 to 45 m for all three. C, the far one, is reached
--                        by the avatar run like A and B (no radius check), so every
--                        Hopper can finish the intro. Walking yourself starts with
--                        the special box. Welcome boxes made before this change and
--                        not opened yet are switched to the avatar run when this
--                        file is applied.
--
-- Guests (anonymous users) may call play_tick until their three welcome boxes
-- are opened; after that it answers need_account. Guests get no small boxes.
--
-- Cards: claim_game_drop calls grant_card() (cards.sql, run after this file) for a
-- 'card' prize on a box that has game_drops.card_max_tier, and answers with `card`
-- (null for every other prize). Nothing changes until cards.sql is loaded and a box
-- carries a card prize.
--
-- Not in this file yet (later phases): the 150 XP box ceiling, the speed rule
-- v2, collectible delivery, the special box, spots and rooms.
-- ============================================================================

-- ------------------------------------------------------- constraint lists ---
-- The full lists. spawning.sql repeats them, so either file can run first or
-- again once near, special or avatar rows exist.
alter table public.game_drops drop constraint if exists game_drops_kind_check;
alter table public.game_drops add constraint game_drops_kind_check check (kind in ('staff','spawn','welcome','near','special'));
alter table public.game_drops drop constraint if exists game_drops_claim_method_check;
alter table public.game_drops add constraint game_drops_claim_method_check check (claim_method in ('proximity','qr','either','avatar'));

-- ------------------------------------------------------------- play-day ---
-- The play-day a moment belongs to: the Lagos date, but the day turns over at
-- 06:00 (so 05:59 on the 10th is still the 9th). Lagos has no daylight saving.
create or replace function public.lagos_play_day(p_ts timestamptz default now())
returns date language sql stable set search_path = public as $$
  select ((p_ts at time zone 'Africa/Lagos') - interval '6 hours')::date;
$$;
-- When that play-day started (06:00 Lagos).
create or replace function public.lagos_play_day_start(p_ts timestamptz default now())
returns timestamptz language sql stable set search_path = public as $$
  select (public.lagos_play_day(p_ts)::timestamp + interval '6 hours') at time zone 'Africa/Lagos';
$$;
revoke all on function public.lagos_play_day(timestamptz), public.lagos_play_day_start(timestamptz) from public, anon;
grant execute on function public.lagos_play_day(timestamptz), public.lagos_play_day_start(timestamptz) to authenticated, service_role;

-- ----------------------------------------------------- game_drops column ---
-- true: you must be at the box with real GPS. false: send the avatar. Only near
-- boxes and your own welcome boxes (A, B and C) are ever opened remotely
-- (claim_game_drop checks the kind and the owner too), so a wrong flag on a staff
-- drop does no harm.
alter table public.game_drops add column if not exists needs_presence boolean not null default true;

-- --------------------------------------------------------------- play_fix ---
create table if not exists public.play_fix (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  lat             double precision not null,   -- rounded to 3 decimals
  lng             double precision not null,
  accuracy        real,
  at              timestamptz not null default now(),
  alert_cursor    timestamptz,                 -- later phases: newest spot already alerted
  alerts_today    integer not null default 0,
  alert_day       date,
  starts_hour_at  timestamptz,
  starts_hour_n   integer not null default 0,
  starts_day      date,
  starts_day_n    integer not null default 0,
  rooms_day       date,
  rooms_day_n     integer not null default 0,
  last_full_at    timestamptz                  -- last heavy pass of play_tick
);
create index if not exists play_fix_at_idx on public.play_fix(at);
alter table public.play_fix enable row level security;
revoke all on public.play_fix from anon, authenticated;
grant all on public.play_fix to service_role;
-- no policy on purpose: nobody reads this table, only the functions in this file

-- ------------------------------------------------------------ heartbeat ---
-- The work for one Hopper. p_has_account says whether the Hopper has an account
-- (play_tick passes has_account()); p_night forces day or night (null: the
-- clock), so tests can reach both. Service role only; players call play_tick.
-- Answers {ok:false, reason} for: no_session, location_required, outside_lagos,
-- too_soon (retry_in_s), need_account.
create or replace function public.play_tick_for(p_user uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_has_account boolean, p_night boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fx play_fix; had_fix boolean; origin geography; acc real; full_pass boolean; night boolean; day_start timestamptz := public.lagos_play_day_start();
  v_welcome integer; v_done integer; v_live integer; v_made integer; v_new integer; v_last timestamptz; v_opens timestamptz;
  others geography[]; pos geography; dist double precision; sep double precision; k integer; t integer; new_id uuid; boxes jsonb; welcome_left integer;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_lat is null or p_lng is null or p_lat = 'NaN'::double precision or p_lng = 'NaN'::double precision then return jsonb_build_object('ok', false, 'reason', 'location_required'); end if;
  if p_lat not between 6.30 and 6.80 or p_lng not between 3.05 and 3.95 then return jsonb_build_object('ok', false, 'reason', 'outside_lagos'); end if;
  -- one heartbeat at a time per Hopper
  perform pg_advisory_xact_lock(hashtextextended('play:' || p_user::text, 0));
  select * into fx from play_fix where user_id = p_user;
  had_fix := found;
  if had_fix and fx.at > now() - interval '15 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'retry_in_s', greatest(1, ceil(extract(epoch from fx.at + interval '15 seconds' - now()))::integer));
  end if;
  -- a guest plays until the three welcome boxes are opened, then needs an account
  select count(*) into v_welcome from drop_claims c join game_drops g on g.id = c.drop_id where c.user_id = p_user and g.kind = 'welcome';
  if not coalesce(p_has_account, false) and v_welcome >= 3 then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;

  acc := case when p_accuracy is null or p_accuracy = 'NaN'::double precision or p_accuracy < 0 then null else least(p_accuracy, 100000)::real end;
  insert into play_fix (user_id, lat, lng, accuracy, at)
  values (p_user, round(p_lat::numeric, 3)::double precision, round(p_lng::numeric, 3)::double precision, acc, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, at = excluded.at;

  night := coalesce(p_night, extract(hour from now() at time zone 'Africa/Lagos')::integer >= 21 or extract(hour from now() at time zone 'Africa/Lagos')::integer < 6);
  full_pass := not had_fix or fx.last_full_at is null or fx.last_full_at < now() - interval '50 seconds';
  select count(*) into v_done from drop_claims c join game_drops g on g.id = c.drop_id where c.user_id = p_user and g.kind = 'near' and c.claimed_at >= day_start;

  if full_pass then
    update play_fix set last_full_at = now() where user_id = p_user;
    origin := st_point(p_lng, p_lat)::geography;
    -- small boxes the Hopper has left far behind are retired, so the top-up puts new ones where they are now
    update game_drops set active = false
      where owner_id = p_user and kind = 'near' and active and claimed_count = 0 and not st_dwithin(geog, origin, 400);
    if p_has_account then
      select count(*) into v_live from game_drops where owner_id = p_user and kind = 'near' and active and closes_at > now() and claimed_count = 0;
      select count(*) into v_made from game_drops where owner_id = p_user and kind = 'near' and created_at >= day_start;
      -- 3 live at a time, 10 opened or live per play-day; and at most 30 rows made a play-day, so walking about cannot churn rows
      v_new := least(3 - v_live, 10 - v_done - v_live, 30 - v_made);
      if v_new > 0 then
        -- a replacement rises 40 to 90 s after the last small box was opened
        select max(c.claimed_at) into v_last from drop_claims c join game_drops g on g.id = c.drop_id
          where c.user_id = p_user and g.kind = 'near' and c.claimed_at > now() - interval '10 minutes';
        others := array(select geog::geography from game_drops where owner_id = p_user and kind = 'near' and active and closes_at > now() and claimed_count = 0);
        sep := case when night then 15 else 40 end;
        for k in 1..v_new loop
          pos := null;
          for t in 1..16 loop
            dist := case when night then 20 + random() * 40 else 60 + random() * 90 end;
            pos := st_project(origin, dist, radians(random() * 360))::geography;
            -- the same zone check as the spawner: no box in any active no-spawn zone (water is also refused by box_guards.sql)
            exit when not exists (select 1 from no_spawn_zones z where z.active and st_intersects(z.geog, pos))
                  and not exists (select 1 from unnest(others) g where st_dwithin(g, pos, sep));
            pos := null;
          end loop;
          continue when pos is null;   -- nowhere clear this time (a big zone, the lagoon): try again on the next full pass
          v_opens := case when v_last is null then now() else greatest(now(), v_last + make_interval(secs => 40 + random() * 50)) end;
          insert into game_drops (title, description, area, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active)
          values ('Small box', 'Just for you.', public.lagos_area_for(pos), pos, v_opens, v_opens + interval '2 hours', 60, 'proximity', 1, 'fixed', 'near', p_user, false, true)
          returning id into new_id;
          insert into drop_rewards (drop_id, reward_type, title, xp_amount) values (new_id, 'xp', 'Small find', 10);
          others := others || pos;
        end loop;
      end if;
    end if;
  end if;

  -- the Hopper's own boxes that are open now. slot (a, b, c) names a welcome box; the tier is fixed by the kind.
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'tier', x.tier, 'lat', x.lat, 'lng', x.lng,
                                               'closes_at', x.closes_at, 'needs_presence', x.needs_presence, 'slot', x.slot) order by x.created_at, x.id), '[]'::jsonb),
         count(*) filter (where x.kind = 'welcome')::integer
    into boxes, welcome_left
  from (
    select g.id, g.kind, g.created_at, g.closes_at, g.needs_presence,
           st_y(g.geog::geometry) as lat, st_x(g.geog::geometry) as lng,
           case when g.kind = 'welcome' then (case when exists (select 1 from drop_rewards r where r.drop_id = g.id and r.xp_amount >= 150) then 'legendary' else 'rare' end) else 'common' end as tier,
           case when g.kind = 'welcome' then (array['a','b','c'])[least(w.rn, 3)] end as slot
    from game_drops g
    left join (select id, row_number() over (order by created_at, id) as rn from game_drops where owner_id = p_user and kind = 'welcome') w on w.id = g.id
    where g.owner_id = p_user and g.kind in ('welcome', 'near') and g.active and g.opens_at <= now() and g.closes_at > now() and g.claimed_count = 0
      and not exists (select 1 from drop_claims c where c.drop_id = g.id and c.user_id = p_user)
  ) x;

  return jsonb_build_object('ok', true, 'full', full_pass, 'night', night, 'play_day', public.lagos_play_day(), 'boxes', boxes,
                            'small_left_today', case when coalesce(p_has_account, false) then greatest(0, 10 - v_done) else 0 end,
                            'welcome_left', welcome_left);
end $$;
revoke all on function public.play_tick_for(uuid, double precision, double precision, double precision, boolean, boolean) from public, anon, authenticated;
grant execute on function public.play_tick_for(uuid, double precision, double precision, double precision, boolean, boolean) to service_role;

-- The heartbeat the app calls. Anonymous (guest) sessions are the authenticated role too.
create or replace function public.play_tick(p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  return public.play_tick_for(auth.uid(), p_lat, p_lng, p_accuracy, public.has_account(), null);
end $$;
revoke all on function public.play_tick(double precision, double precision, double precision) from public, anon;
grant execute on function public.play_tick(double precision, double precision, double precision) to authenticated;

-- -------------------------------------------------------------- claiming ---
-- spawning.sql's claim_game_drop with one addition (marked "remote path"): a
-- box with needs_presence = false (a small box, or any of your own welcome boxes)
-- opens without a radius check, a speed check or a position, and stores no
-- coordinates. The account gate is unchanged: the drop_claims trigger in
-- chat_accounts.sql still refuses guests, except for their own welcome boxes.
-- Small boxes also log the street_drop score, like street and welcome boxes.
-- The second addition (marked "card prize"): the card hook above the XP.
create or replace function public.claim_game_drop(p_drop uuid,p_lat double precision default null,p_lng double precision default null,p_code text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare d game_drops; r drop_rewards; e events; claim_id uuid; voucher text; dist double precision; ticket drop_qr_codes; roll numeric; total numeric; used_loc boolean:=false; prev record; remote boolean:=false; card jsonb; paid integer;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'reason','no_session'); end if;
  -- one claim at a time per Hopper: the speed and cooldown checks read committed claims, so parallel calls would all pass
  perform pg_advisory_xact_lock(hashtextextended('claim:'||auth.uid()::text,0));
  select * into d from game_drops where id=p_drop and active for update;
  if d.owner_id is not null and d.owner_id<>auth.uid() then return jsonb_build_object('ok',false,'reason','not_yours'); end if;
  if not found or now()<d.opens_at or now()>d.closes_at then return jsonb_build_object('ok',false,'reason','closed'); end if;
  if d.max_claims is not null and d.claimed_count>=d.max_claims then return jsonb_build_object('ok',false,'reason','sold_out'); end if;
  -- remote path (play.sql): a small box or a welcome box of your own (A, B or C) that needs no presence. No radius, no speed rule, no coordinates stored.
  remote:=d.needs_presence is false and d.kind in ('near','welcome') and d.owner_id=auth.uid();
  if remote and d.kind<>'welcome' and not has_account() then return jsonb_build_object('ok',false,'reason','need_account'); end if;
  if remote then null;
  elsif d.claim_method in ('qr','either') and p_code is not null then
    update drop_qr_codes set uses=uses+1 where drop_id=d.id and active and code_hash=encode(digest(p_code,'sha256'),'hex') and valid_from<=now() and valid_until>now() and uses<max_uses returning * into ticket;
    if not found and d.claim_method='qr' then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
  elsif d.claim_method='qr' then return jsonb_build_object('ok',false,'reason','code_required'); end if;
  if not remote and (ticket.id is null or p_code is null) then
    if p_lat is null or p_lng is null then return jsonb_build_object('ok',false,'reason','location_required'); end if;
    select * into e from events where id=d.event_id;
    if coalesce(d.geog,e.geog) is null then return jsonb_build_object('ok',false,'reason','location_required'); end if;
    dist:=st_distance(coalesce(d.geog,e.geog),st_point(p_lng,p_lat)::geography);
    if dist>d.radius_m then return jsonb_build_object('ok',false,'reason','too_far','distance_m',round(dist)); end if;
    used_loc:=true;
  end if;
  if exists(select 1 from drop_claims where drop_id=d.id and user_id=auth.uid()) then return jsonb_build_object('ok',false,'reason','already'); end if;
  if used_loc then
    select c.lat,c.lng,c.claimed_at into prev from drop_claims c where c.user_id=auth.uid() and c.lat is not null and c.lng is not null and c.claimed_at>now()-interval '2 hours' order by c.claimed_at desc limit 1;
    if found and st_distance(st_point(prev.lng,prev.lat)::geography,st_point(p_lng,p_lat)::geography)/greatest(extract(epoch from now()-prev.claimed_at),1)>50 then return jsonb_build_object('ok',false,'reason','too_fast'); end if;
  end if;
  if d.kind='spawn' and (select count(*) from drop_claims c join game_drops g on g.id=c.drop_id where c.user_id=auth.uid() and g.kind='spawn' and c.claimed_at>now()-interval '60 minutes')>=6 then return jsonb_build_object('ok',false,'reason','slow_down'); end if;
  select coalesce(sum(weight),0) into total from drop_rewards where drop_id=d.id and active and (quantity is null or claimed<quantity);
  if total<=0 then return jsonb_build_object('ok',false,'reason','sold_out'); end if;
  roll:=random()*total;
  if d.reward_model='random' then
    select dr.* into r from (select id,sum(weight) over(order by id) running from drop_rewards where drop_id=d.id and active and (quantity is null or claimed<quantity)) x join drop_rewards dr on dr.id=x.id where x.running>=roll order by x.running limit 1;
  else
    select * into r from drop_rewards where drop_id=d.id and active and (quantity is null or claimed<quantity) order by id limit 1;
  end if;
  if not found then return jsonb_build_object('ok',false,'reason','sold_out'); end if;
  update drop_rewards set claimed=claimed+1 where id=r.id and (quantity is null or claimed<quantity);
  if not found then return jsonb_build_object('ok',false,'reason','sold_out'); end if;
  if r.reward_type in ('discount','upgrade','ticket') then
    select code into voucher from drop_reward_codes where reward_id=r.id and claimed_by is null order by id limit 1 for update skip locked;
    if voucher is null then update drop_rewards set claimed=claimed-1 where id=r.id; return jsonb_build_object('ok',false,'reason','sold_out'); end if;
    update drop_reward_codes set claimed_by=auth.uid(),claimed_at=now() where reward_id=r.id and code=voucher;
  end if;
  insert into drop_claims(drop_id,user_id,reward_id,lat,lng) values(d.id,auth.uid(),r.id,case when remote then null else p_lat end,case when remote then null else p_lng end) returning id into claim_id;
  update game_drops set claimed_count=claimed_count+1 where id=d.id;
  -- card prize (cards.sql): a 'card' prize on a box with card_max_tier hands out a card. A pity lift (the 10th claim since a Rare, the 60th since an Epic) tops the XP up to the lifted tier; otherwise the XP is the prize row's, as always. A walked box passes its position so the card is stamped Visited when the box sits inside the card's radius; neither is stored.
  if r.reward_type='card' and d.card_max_tier is not null then
    card:=public.grant_card(auth.uid(),r.card_tier,d.id,d.card_max_tier,r.xp_amount,case when remote then null else p_lat end,case when remote then null else p_lng end,'box',claim_id);
  end if;
  paid:=coalesce((card->>'xp')::integer,r.xp_amount);
  card:=card->'card';
  if paid>0 then update profiles set xp=xp+paid where id=auth.uid(); end if;
  if r.badge_key is not null then perform award_badge(auth.uid(),r.badge_key); end if;
  insert into activity_log(user_id,action,source_id,event_id,outside_score) values(auth.uid(),'drop',claim_id,d.event_id,coalesce((select score from game_score_rules where key=case when d.kind in ('spawn','welcome','near') then 'street_drop' else 'drop' end),0));
  return jsonb_build_object('ok',true,'claim_id',claim_id,'reward',r.title,'description',r.description,'code',voucher,'xp',paid,'card',card);
end $$;

-- ----------------------------------------------------------- welcome boxes ---
-- Three personal boxes for a new Hopper, once. By day: A 25 m away, B 90 to 130 m,
-- C 180 to 250 m. At night all three sit 15 to 45 m away. All three are opened by
-- sending the avatar (needs_presence false): C, the far one, is the avatar run (a
-- short cutscene of the avatar running down the road), so everyone can finish the
-- intro. There is no radius check and no coordinates are stored. Walking yourself
-- comes later, with the special box. Each box turns its bearing until it clears
-- every no-spawn zone; if none does, there are no boxes this time
-- ('no_clear_spot'). The three rows are stamped in order (A, B, C) so play_tick
-- can tell them apart. Service role only.
create or replace function public.spawn_welcome_boxes_for(p_user uuid, p_lat double precision, p_lng double precision, p_night boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  origin geography := st_point(p_lng, p_lat)::geography;
  ids uuid[] := '{}'; pos geography; new_id uuid; k integer; t integer; dist double precision; bear double precision := random() * 360;
begin
  perform pg_advisory_xact_lock(hashtextextended('welcome:' || p_user::text, 0));
  if exists (select 1 from game_drops where owner_id = p_user and kind = 'welcome') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  for k in 1..3 loop
    pos := null;
    for t in 0..11 loop
      dist := case when p_night then 15 + random() * 30
                   else case k when 1 then 25 when 2 then 90 + random() * 40 else 180 + random() * 70 end end;
      pos := st_project(origin, dist, radians(bear + (k - 1) * 120 + t * 30))::geography;
      exit when not exists (select 1 from no_spawn_zones z where z.active and st_intersects(z.geog, pos));
      pos := null;
    end loop;
    if pos is null then
      -- nowhere is clear (the Hopper stands inside a big zone, on a bridge over the lagoon): no boxes
      -- this time, the app asks again when the location changes. box_guards.sql refuses a box in a zone.
      delete from game_drops where id = any (ids);
      return jsonb_build_object('ok', false, 'reason', 'no_clear_spot');
    end if;
    insert into game_drops (title, description, area, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, needs_presence, active, created_at)
    values ('Welcome box', 'Just for you. Go find it.', public.lagos_area_for(pos), pos, now(), now() + interval '24 hours',
            case when p_night then 80 else 60 end, 'proximity', 1, 'fixed', 'welcome', p_user, false, true, clock_timestamp())
    returning id into new_id;
    insert into drop_rewards (drop_id, reward_type, title, xp_amount)
    values (new_id, 'xp', case when k = 3 and not p_night then 'Worth the walk' else 'Welcome find' end, case when k = 3 and not p_night then 150 else 50 end);
    ids := ids || new_id;
  end loop;
  return jsonb_build_object('ok', true, 'already', false, 'night', p_night, 'ids', to_jsonb(ids));
end $$;
revoke all on function public.spawn_welcome_boxes_for(uuid, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.spawn_welcome_boxes_for(uuid, double precision, double precision, boolean) to service_role;

-- Welcome boxes made before this change still ask the Hopper to walk to C. Switch
-- the ones that are still open and unopened to the avatar run, so nobody is stuck
-- on the far box. Opened and expired boxes are left as they were. Safe to run again.
update public.game_drops set needs_presence = false
where kind = 'welcome' and needs_presence and claimed_count = 0 and closes_at > now();

-- ------------------------------------------------------------------ purge ---
-- Rows of Hoppers who have not had Play open for 24 hours. Returns how many.
create or replace function public.purge_play_fix()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from play_fix where at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_play_fix() from public, anon, authenticated;
grant execute on function public.purge_play_fix() to service_role;

-- ------------------------------------------------------------- scheduler ---
-- Every night at 03:30 Lagos (02:30 UTC).
do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'hoppaz-purge-play-fix';
  perform cron.schedule('hoppaz-purge-play-fix', '30 2 * * *', 'select public.purge_play_fix()');
exception when others then
  raise notice 'pg_cron not available: enable it in Supabase (Database, Extensions), then run this file again.';
end $cron$;
