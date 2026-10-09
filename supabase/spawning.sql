-- ============================================================================
-- Hoppaz: street box spawning (Pokemon GO style)
-- Run order: schema.sql, hunt_items.sql, then this file in the Supabase SQL
-- editor. Then spawn_points_lagos.sql (real Lagos spots, made by
-- scripts/spawn-points/import-osm.mjs). Safe to run again. If you ever re-run
-- schema.sql, run this file after it, because schema.sql restores the old
-- drops_read_active policy and the old claim_game_drop.
--
-- What it adds:
--   spawn_points    safe public spots a box can appear at (parks, beaches,
--                   landmarks, markets, bus stops, fuel stations, venues).
--   no_spawn_zones  places that never get boxes (water, military, airport,
--                   prisons, ports, private estates, unsafe spots).
--   spawn_rules     the schedule: when, where, how many, how long, first N.
--   spawn_boxes()   the spawner. pg_cron runs it every 5 minutes. Each active
--                   rule that is due drops a wave of shared boxes. After 21:00
--                   (Lagos) only night_safe spots are used.
--   spawn_welcome_boxes()  3 personal boxes for a new Hopper, 24 hours.
--   claim_game_drop()      same as before plus: owner check, one claim at a time
--                          per Hopper, speed check, slow-down for spawn boxes,
--                          claim position stored, street boxes score nothing on
--                          the Outside Score board (rule street_drop).
--
-- Boxes made here are ordinary game_drops (kind 'spawn' or 'welcome'), so the
-- map, claim flow and rewards need no changes. A welcome box is visible only to
-- its owner. The three tables are service-role only: staff edit them through
-- the admin desk or the SQL editor, never from the browser.
--
-- Days in a rule are the Lagos weekday the window STARTS on (1 = Monday ...
-- 7 = Sunday). A 21:00 to 02:00 rule on Friday also covers Saturday 00:00 to
-- 02:00. A start and end of the same minute means all day. A night_from and
-- night_until of the same minute means no night limit for that rule.
-- ============================================================================

-- ------------------------------------------------------------ area lookup ---
-- Nearest Lagos area within 5 km, else null.
create or replace function public.lagos_area_for(p_geog geography)
returns text language sql stable set search_path = public as $$
  select a.name from areas a where st_dwithin(a.centroid, p_geog, 5000) order by st_distance(a.centroid, p_geog) limit 1;
$$;
revoke all on function public.lagos_area_for(geography) from public, anon, authenticated;
grant execute on function public.lagos_area_for(geography) to service_role;

-- ------------------------------------------------------------ spawn points ---
create table if not exists public.spawn_points (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            text not null check (kind in ('street','park','run','beach','landmark','market','venue')),
  geog            geography(point,4326) not null,
  area            text references public.areas(name) on delete set null,
  night_safe      boolean not null default false,
  weight          numeric not null default 1 check (weight > 0),
  source          text not null default 'staff' check (source in ('osm','venue','staff')),
  source_ref      text,
  active          boolean not null default true,
  last_spawned_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (source, source_ref)
);
create index if not exists spawn_points_geog_idx on public.spawn_points using gist(geog);
create index if not exists spawn_points_pick_idx on public.spawn_points(active, kind);

-- Fills area from the nearest Lagos area when it is left empty.
create or replace function public.spawn_points_fill_area()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.area is null then new.area := public.lagos_area_for(new.geog); end if;
  return new;
end $$;
revoke all on function public.spawn_points_fill_area() from public, anon, authenticated;
grant execute on function public.spawn_points_fill_area() to service_role;
drop trigger if exists spawn_points_area on public.spawn_points;
create trigger spawn_points_area before insert or update on public.spawn_points
  for each row execute function public.spawn_points_fill_area();

-- ---------------------------------------------------------- no-spawn zones ---
create table if not exists public.no_spawn_zones (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  reason     text not null default '',
  geog       geography(geometry,4326) not null,
  source     text not null default 'staff' check (source in ('osm','staff')),
  source_ref text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source, source_ref)
);
create index if not exists no_spawn_zones_geog_idx on public.no_spawn_zones using gist(geog);

-- ------------------------------------------------------------- spawn rules ---
-- A rule says: inside this window, every N minutes, drop a wave of boxes at
-- random spots of these kinds. rewards items: {type: xp|badge|collectible,
-- title, description?, xp_amount?, weight?, badge_key?, collectible_key?, quantity?}.
create table if not exists public.spawn_rules (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  active             boolean not null default false,
  areas              text[],
  kinds              text[] not null default '{street,park,run,beach,landmark,market,venue}'
                       check (kinds <@ array['street','park','run','beach','landmark','market','venue']::text[]),
  days               smallint[] not null default '{1,2,3,4,5,6,7}'
                       check (days <@ array[1,2,3,4,5,6,7]::smallint[]),
  start_minute       integer not null default 420 check (start_minute between 0 and 1439),
  end_minute         integer not null default 1260 check (end_minute between 0 and 1439),
  every_minutes      integer not null default 30 check (every_minutes between 5 and 1440),
  boxes_per_wave     integer not null default 3 check (boxes_per_wave between 1 and 50),
  lifetime_minutes   integer not null default 30 check (lifetime_minutes between 5 and 1440),
  max_claims         integer not null default 5 check (max_claims between 1 and 1000),
  radius_m           integer not null default 80 check (radius_m between 25 and 500),
  night_from_minute  integer not null default 1260 check (night_from_minute between 0 and 1439),
  night_until_minute integer not null default 360 check (night_until_minute between 0 and 1439),
  reward_model       text not null default 'random' check (reward_model in ('fixed','random')),
  rewards            jsonb not null default '[{"type":"xp","title":"Street find","xp_amount":30,"weight":80},{"type":"xp","title":"Lucky find","xp_amount":100,"weight":18},{"type":"xp","title":"Jackpot","xp_amount":300,"weight":2}]'
                       check (jsonb_typeof(rewards) = 'array'),
  last_run_at        timestamptz,
  created_at         timestamptz not null default now()
);

-- Two examples to copy from. Inactive until staff switch them on.
insert into public.spawn_rules (name, active, start_minute, end_minute, every_minutes, boxes_per_wave, lifetime_minutes, max_claims, radius_m)
values ('Day street boxes', false, 420, 1260, 30, 4, 30, 5, 80)
on conflict (name) do nothing;
insert into public.spawn_rules (name, active, kinds, start_minute, end_minute, every_minutes, boxes_per_wave, lifetime_minutes, max_claims, radius_m)
values ('Night venue boxes', false, '{venue,street}', 1260, 120, 45, 2, 40, 5, 80)
on conflict (name) do nothing;

-- ----------------------------------------------------- game_drops columns ---
alter table public.game_drops add column if not exists kind text not null default 'staff';
alter table public.game_drops drop constraint if exists game_drops_kind_check;
alter table public.game_drops add constraint game_drops_kind_check check (kind in ('staff','spawn','welcome'));
alter table public.game_drops add column if not exists spawn_point_id uuid references public.spawn_points(id) on delete set null;
alter table public.game_drops add column if not exists spawn_rule_id uuid references public.spawn_rules(id) on delete set null;
alter table public.game_drops add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
create index if not exists game_drops_kind_idx on public.game_drops(kind, closes_at);
create index if not exists game_drops_owner_idx on public.game_drops(owner_id);

alter table public.drop_claims add column if not exists lat double precision;
alter table public.drop_claims add column if not exists lng double precision;
create index if not exists drop_claims_user_idx on public.drop_claims(user_id, claimed_at desc);

-- ---------------------------------------------------------------- security ---
alter table public.spawn_points enable row level security;
alter table public.no_spawn_zones enable row level security;
alter table public.spawn_rules enable row level security;
revoke all on public.spawn_points, public.no_spawn_zones, public.spawn_rules from anon, authenticated;
grant all on public.spawn_points, public.no_spawn_zones, public.spawn_rules to service_role;

-- A welcome box sits near where a Hopper signed up, often home. Only its owner
-- may ever see it.
drop policy if exists drops_read_active on public.game_drops;
create policy drops_read_active on public.game_drops for select
  using (active and closes_at > now() and (owner_id is null or owner_id = auth.uid()));

-- --------------------------------------------------------------- spawner ---
-- Drops a wave of boxes for every rule that is due. p_rule runs one rule even if
-- it is switched off; p_force skips the day, window and every_minutes checks.
-- Returns how many boxes were made.
create or replace function public.spawn_boxes(p_now timestamptz default now(), p_rule uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r spawn_rules; spot record; rw jsonb; new_id uuid; made integer; total integer := 0; picked geography[];
  mins integer := extract(hour from p_now at time zone 'Africa/Lagos')::integer * 60 + extract(minute from p_now at time zone 'Africa/Lagos')::integer;
  dow integer := extract(isodow from p_now at time zone 'Africa/Lagos')::integer;
  wd integer; in_window boolean; night boolean;
begin
  for r in select * from spawn_rules where (p_rule is null and active) or id = p_rule order by created_at for update skip locked loop
    begin
      in_window := case when r.start_minute = r.end_minute then true
                        when r.start_minute < r.end_minute then mins >= r.start_minute and mins < r.end_minute
                        else mins >= r.start_minute or mins < r.end_minute end;
      night := case when r.night_from_minute = r.night_until_minute then false   -- empty night window: no night limit
                    when r.night_from_minute < r.night_until_minute then mins >= r.night_from_minute and mins < r.night_until_minute
                    else mins >= r.night_from_minute or mins < r.night_until_minute end;
      -- after midnight inside a wrapped window we are still in the previous day's window
      wd := case when r.end_minute < r.start_minute and mins < r.end_minute then (dow + 5) % 7 + 1 else dow end;
      -- 30 s of slack so a cron tick that lands a moment early does not skip a whole cycle
      if not p_force and (not in_window or not (wd = any(r.days))
         or (r.last_run_at is not null and r.last_run_at > p_now - make_interval(mins => r.every_minutes) + interval '30 seconds')) then
        continue;
      end if;
      -- keep only reward items the claim function can honour
      select coalesce(jsonb_agg(i), '[]'::jsonb) into rw from jsonb_array_elements(r.rewards) i
        where jsonb_typeof(i) = 'object' and coalesce(i->>'title', '') <> '' and coalesce(nullif(i->>'weight', '')::numeric, 1) > 0
          and (i->>'type' = 'xp'
               or (i->>'type' = 'badge' and coalesce(i->>'badge_key', '') <> '')
               or (i->>'type' = 'collectible' and exists (select 1 from collectibles c where c.key = i->>'collectible_key')));
      if jsonb_array_length(rw) = 0 then
        raise notice 'spawn_boxes: rule "%" has no usable rewards, skipped', r.name;
        continue;
      end if;
      made := 0; picked := '{}';
      for spot in
        select sp.id, sp.name, sp.geog, sp.area from spawn_points sp
        where sp.active and sp.kind = any(r.kinds)
          and (r.areas is null or sp.area = any(r.areas))
          and (not night or sp.night_safe)
          and not exists (select 1 from no_spawn_zones z where z.active and st_intersects(z.geog, sp.geog))
          and not exists (select 1 from game_drops g where g.active and g.closes_at > p_now and g.kind in ('spawn','welcome') and st_dwithin(g.geog, sp.geog, 50))
          and (sp.last_spawned_at is null or sp.last_spawned_at < p_now - make_interval(mins => r.lifetime_minutes))
        order by -ln(1 - random()) / sp.weight
      loop
        exit when made >= r.boxes_per_wave;
        if exists (select 1 from unnest(picked) g where st_dwithin(g, spot.geog, 300)) then continue; end if;
        insert into game_drops (title, description, area, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, spawn_point_id, spawn_rule_id, active)
        values (spot.name, 'First ' || r.max_claims || ' to get here open it.', spot.area, spot.geog, p_now, p_now + make_interval(mins => r.lifetime_minutes),
                r.radius_m, 'proximity', r.max_claims, r.reward_model, 'spawn', spot.id, r.id, true)
        returning id into new_id;
        insert into drop_rewards (drop_id, reward_type, title, description, quantity, weight, xp_amount, badge_key, collectible_id)
        select new_id, i->>'type', i->>'title', coalesce(i->>'description', ''), nullif(i->>'quantity', '')::integer,
               coalesce(nullif(i->>'weight', '')::numeric, 1), least(greatest(coalesce(nullif(i->>'xp_amount', '')::integer, 0), 0), 10000),
               nullif(i->>'badge_key', ''), (select c.id from collectibles c where c.key = i->>'collectible_key')
        from jsonb_array_elements(rw) i;
        update spawn_points set last_spawned_at = p_now where id = spot.id;
        picked := picked || spot.geog;
        made := made + 1;
      end loop;
      update spawn_rules set last_run_at = p_now where id = r.id;
      total := total + made;
    exception when others then
      -- one broken rule must not stop the others, but a named run shows the error
      if p_rule is not null then raise; end if;
      raise warning 'spawn_boxes: rule "%" failed: %', r.name, sqlerrm;
    end;
  end loop;
  return total;
end $$;
revoke all on function public.spawn_boxes(timestamptz, uuid, boolean) from public, anon, authenticated;
grant execute on function public.spawn_boxes(timestamptz, uuid, boolean) to service_role;

-- --------------------------------------------------------- welcome boxes ---
-- The work of spawn_welcome_boxes for a given user and a given day or night, so
-- it can be tested at any hour. Service role only.
create or replace function public.spawn_welcome_boxes_for(p_user uuid, p_lat double precision, p_lng double precision, p_night boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  origin geography := st_point(p_lng, p_lat)::geography;
  ids uuid[] := '{}'; picks geography[] := '{}'; pos geography; new_id uuid; k integer; t integer;
  dist double precision; bear double precision := random() * 360; lo double precision; hi double precision;
begin
  perform pg_advisory_xact_lock(hashtextextended('welcome:' || p_user::text, 0));
  if exists (select 1 from game_drops where owner_id = p_user and kind = 'welcome') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  for k in 1..3 loop
    pos := null;
    if p_night then
      dist := 15 + random() * 30;
    else
      -- two close ones (120 to 450 m), one far one (600 to 1500 m)
      dist := case k when 1 then 200 when 2 then 320 else 900 end;
      lo := case when k < 3 then 120 else 600 end;
      hi := case when k < 3 then 450 else 1500 end;
      select sp.geog into pos from spawn_points sp
        where sp.active and st_dwithin(sp.geog, origin, hi) and not st_dwithin(sp.geog, origin, lo)
          and not exists (select 1 from no_spawn_zones z where z.active and st_intersects(z.geog, sp.geog))
          and not exists (select 1 from unnest(picks) g where st_dwithin(g, sp.geog, 100))
        order by -ln(1 - random()) / sp.weight limit 1;
    end if;
    if pos is null then
      -- no spot: an offset from the Hopper, turning the bearing until it clears every zone
      for t in 0..11 loop
        pos := st_project(origin, dist, radians(bear + (k - 1) * 120 + t * 30))::geography;
        exit when not exists (select 1 from no_spawn_zones z where z.active and st_intersects(z.geog, pos));
        pos := null;
      end loop;
      if pos is null then pos := origin; end if;
    end if;
    picks := picks || pos;
    insert into game_drops (title, description, area, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id, active)
    values ('Welcome box', 'Just for you. Go find it.', public.lagos_area_for(pos), pos, now(), now() + interval '24 hours',
            case when p_night then 80 else 60 end, 'proximity', 1, 'fixed', 'welcome', p_user, true)
    returning id into new_id;
    insert into drop_rewards (drop_id, reward_type, title, xp_amount)
    values (new_id, 'xp', case when k = 3 and not p_night then 'Worth the walk' else 'Welcome find' end, case when k = 3 and not p_night then 150 else 50 end);
    ids := ids || new_id;
  end loop;
  return jsonb_build_object('ok', true, 'already', false, 'night', p_night, 'ids', to_jsonb(ids));
end $$;
revoke all on function public.spawn_welcome_boxes_for(uuid, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.spawn_welcome_boxes_for(uuid, double precision, double precision, boolean) to service_role;

-- Three personal boxes for a new Hopper, once. At night (21:00 to 06:00 Lagos)
-- they sit right next to the Hopper; by day two are a short walk and one is a
-- longer one.
create or replace function public.spawn_welcome_boxes(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare h integer := extract(hour from now() at time zone 'Africa/Lagos')::integer;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_lat is null or p_lng is null then return jsonb_build_object('ok', false, 'reason', 'location_required'); end if;
  if p_lat not between 6.30 and 6.80 or p_lng not between 3.05 and 3.95 then return jsonb_build_object('ok', false, 'reason', 'outside_lagos'); end if;
  return public.spawn_welcome_boxes_for(auth.uid(), p_lat, p_lng, h >= 21 or h < 6);
end $$;
revoke all on function public.spawn_welcome_boxes(double precision, double precision) from public, anon;
grant execute on function public.spawn_welcome_boxes(double precision, double precision) to authenticated;

-- ----------------------------------------------------------- staff tools ---
-- A round no-spawn zone around a point. Staff only.
create or replace function public.add_no_spawn_zone(p_name text, p_reason text, p_lat double precision, p_lng double precision, p_radius_m integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'zone name required'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'bad coordinates'; end if;
  if p_radius_m is null or p_radius_m not between 1 and 50000 then raise exception 'radius_m must be between 1 and 50000'; end if;
  insert into no_spawn_zones (name, reason, geog, source)
  values (trim(p_name), coalesce(p_reason, ''), st_buffer(st_point(p_lng, p_lat)::geography, p_radius_m), 'staff')
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.add_no_spawn_zone(text, text, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.add_no_spawn_zone(text, text, double precision, double precision, integer) to service_role;

-- One call for the admin desk: how much is in the spawner right now.
create or replace function public.spawner_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'points_total', (select count(*) from spawn_points),
    'points_active', (select count(*) from spawn_points where active),
    'night_safe_active', (select count(*) from spawn_points where active and night_safe),
    'points_by_kind', (select jsonb_object_agg(k.kind, coalesce(c.n, 0))
                         from unnest(array['street','park','run','beach','landmark','market','venue']) k(kind)
                         left join (select kind, count(*) n from spawn_points where active group by kind) c on c.kind = k.kind),
    'zones_active', (select count(*) from no_spawn_zones where active),
    'live_spawn', (select count(*) from game_drops where kind = 'spawn' and active and closes_at > now()),
    'live_welcome', (select count(*) from game_drops where kind = 'welcome' and active and closes_at > now()),
    'rules_active', (select count(*) from spawn_rules where active));
$$;
revoke all on function public.spawner_summary() from public, anon, authenticated;
grant execute on function public.spawner_summary() to service_role;

-- ------------------------------------------------------------- claiming ---
-- Same atomic claim as schema.sql, plus: a welcome box can only be claimed by its
-- owner, a Hopper's claims run one at a time (so parallel requests cannot all
-- pass the checks below), a claim made by location cannot follow another one
-- faster than 50 m/s, a Hopper gets 6 street boxes an hour, and the claim keeps
-- the position it was made from. Street and welcome boxes log the street_drop
-- score (0 until staff change it), not the venue drop score, so boxes cannot
-- top the monthly board. The search_path includes extensions because that is
-- where Supabase keeps pgcrypto (digest). The grants stay as schema.sql left them.
insert into public.game_score_rules(key,score) values ('street_drop',0) on conflict(key) do nothing;

create or replace function public.claim_game_drop(p_drop uuid,p_lat double precision default null,p_lng double precision default null,p_code text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare d game_drops; r drop_rewards; e events; claim_id uuid; voucher text; dist double precision; ticket drop_qr_codes; roll numeric; total numeric; used_loc boolean:=false; prev record;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'reason','no_session'); end if;
  -- one claim at a time per Hopper: the speed and cooldown checks read committed claims, so parallel calls would all pass
  perform pg_advisory_xact_lock(hashtextextended('claim:'||auth.uid()::text,0));
  select * into d from game_drops where id=p_drop and active for update;
  if d.owner_id is not null and d.owner_id<>auth.uid() then return jsonb_build_object('ok',false,'reason','not_yours'); end if;
  if not found or now()<d.opens_at or now()>d.closes_at then return jsonb_build_object('ok',false,'reason','closed'); end if;
  if d.max_claims is not null and d.claimed_count>=d.max_claims then return jsonb_build_object('ok',false,'reason','sold_out'); end if;
  if d.claim_method in ('qr','either') and p_code is not null then
    update drop_qr_codes set uses=uses+1 where drop_id=d.id and active and code_hash=encode(digest(p_code,'sha256'),'hex') and valid_from<=now() and valid_until>now() and uses<max_uses returning * into ticket;
    if not found and d.claim_method='qr' then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
  elsif d.claim_method='qr' then return jsonb_build_object('ok',false,'reason','code_required'); end if;
  if ticket.id is null or p_code is null then
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
  insert into drop_claims(drop_id,user_id,reward_id,lat,lng) values(d.id,auth.uid(),r.id,p_lat,p_lng) returning id into claim_id;
  update game_drops set claimed_count=claimed_count+1 where id=d.id;
  if r.xp_amount>0 then update profiles set xp=xp+r.xp_amount where id=auth.uid(); end if;
  if r.badge_key is not null then perform award_badge(auth.uid(),r.badge_key); end if;
  insert into activity_log(user_id,action,source_id,event_id,outside_score) values(auth.uid(),'drop',claim_id,d.event_id,coalesce((select score from game_score_rules where key=case when d.kind in ('spawn','welcome') then 'street_drop' else 'drop' end),0));
  return jsonb_build_object('ok',true,'claim_id',claim_id,'reward',r.title,'description',r.description,'code',voucher,'xp',r.xp_amount);
end $$;

-- ------------------------------------------------------------- scheduler ---
-- Every 5 minutes. Rules decide for themselves whether they are due.
do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'hoppaz-spawn-boxes';
  perform cron.schedule('hoppaz-spawn-boxes', '*/5 * * * *', 'select public.spawn_boxes()');
exception when others then
  raise notice 'pg_cron not available: enable it in Supabase (Database, Extensions), then run this file again.';
end $cron$;
