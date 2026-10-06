-- ============================================================================
-- Hoppaz Night Map: schema
-- Run once in the Supabase SQL editor, then run seed.sql.
-- Also turn on Authentication -> Sign In / Providers -> Anonymous sign-ins.
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- areas -----
-- Lagos areas with real centroids. Used for the "you are in" fallback when a
-- Hopper will not grant GPS, and for the mainland/island bridge penalty.
create table if not exists public.areas (
  name       text primary key,
  side       text not null check (side in ('mainland', 'island')),
  centroid   geography(point, 4326) not null
);

-- ------------------------------------------------------------- profiles -----
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  area         text references public.areas(name),
  xp           integer not null default 0 check (xp >= 0),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- The Bitmoji-style look. Parts and wardrobe ids only; the client whitelists
-- every field on read, so this is just a size guard.
alter table public.profiles add column if not exists avatar jsonb
  check (avatar is null or (jsonb_typeof(avatar) = 'object' and pg_column_size(avatar) < 2048));

-- A Hopper never signs up. Supabase anonymous sign-in creates the auth user,
-- this trigger gives it a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- events -----
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 2 and 120),
  venue_name   text not null check (char_length(venue_name) between 2 and 120),
  area         text references public.areas(name),
  geog         geography(point, 4326) not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  price_naira  integer not null default 0 check (price_naira >= 0),
  vibe         text not null default 'afro',
  source       text not null default 'hopper' check (source in ('hoppaz', 'hopper', 'instagram', 'partner')),
  ig_url       text,
  flyer_url    text,
  base_heat    integer not null default 20 check (base_heat between 0 and 100),
  status       text not null default 'pending' check (status in ('pending', 'live', 'rejected')),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists events_geog_idx   on public.events using gist (geog);
create index if not exists events_window_idx on public.events (starts_at) where status = 'live';

-- Nothing a Hopper drops goes live on its own. An admin flips it.
create or replace function public.force_pending_on_insert()
returns trigger
language plpgsql
as $$
begin
  -- auth.uid() is null for the service role and the SQL editor: that is us
  -- seeding or an admin route, and it is trusted. Anyone else gets pending.
  if auth.uid() is not null
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    new.status := 'pending';
    new.source := 'hopper';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists events_force_pending on public.events;
create trigger events_force_pending
  before insert on public.events
  for each row execute function public.force_pending_on_insert();

-- ------------------------------------------------------------- checkins -----
create table if not exists public.checkins (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists checkins_event_idx on public.checkins (event_id, created_at desc);

-- --------------------------------------------------------------- swipes -----
-- The Bumble-style deck. 'in' means the Hopper wants to be there.
create table if not exists public.swipes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  decision   text not null check (decision in ('in', 'pass')),
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);
create index if not exists swipes_event_idx on public.swipes (event_id) where decision = 'in';

-- --------------------------------------------------------------- badges -----
create table if not exists public.badges (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  key       text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ----------------------------------------------------------------- crew -----
create table if not exists public.crew (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- ------------------------------------------------------------- messages -----
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null default 'base' check (char_length(channel) between 1 and 64),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 400),
  created_at timestamptz not null default now()
);
create index if not exists messages_channel_idx on public.messages (channel, created_at desc);

-- ----------------------------------------------------------------- hops -----
create table if not exists public.hops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  hop_date    date not null,
  price_naira integer not null default 0,
  boarding    text not null default 'Board 6:00pm, bus leaves 7:00pm and does not wait',
  ticket_url  text,
  status      text not null default 'announced' check (status in ('announced', 'selling', 'sold_out', 'done'))
);

create table if not exists public.hop_stops (
  id        uuid primary key default gen_random_uuid(),
  hop_id    uuid not null references public.hops(id) on delete cascade,
  idx       smallint not null,
  name      text not null,
  area      text references public.areas(name),
  geog      geography(point, 4326) not null,
  stop_time text not null,
  role      text not null,
  unique (hop_id, idx)
);

create table if not exists public.hop_riders (
  hop_id     uuid not null references public.hops(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hop_id, user_id)
);

-- ============================================================= heat ========
-- Heat is what the map is actually drawing. Base popularity decays as the
-- night's real signal arrives: people who swiped in, then people who turned up.
create or replace view public.event_heat as
select
  e.id as event_id,
  coalesce(c.n, 0)::int as checkins,
  coalesce(s.n, 0)::int as swipes_in,
  least(100, e.base_heat + coalesce(c.n, 0) * 7 + coalesce(s.n, 0) * 3)::int as heat
from public.events e
left join (select event_id, count(*) n from public.checkins group by 1) c on c.event_id = e.id
left join (select event_id, count(*) n from public.swipes where decision = 'in' group by 1) s on s.event_id = e.id;

-- ============================================================= rpc =========

-- Everything live inside a radius, with distance and heat already computed.
create or replace function public.events_near(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m double precision default 15000,
  p_from     timestamptz default now() - interval '4 hours',
  p_to       timestamptz default now() + interval '36 hours'
)
returns table (
  id uuid, title text, venue_name text, area text,
  lat double precision, lng double precision,
  starts_at timestamptz, price_naira int, vibe text, source text,
  ig_url text, flyer_url text,
  distance_m double precision, heat int, checkins int, swipes_in int
)
language sql stable security definer set search_path = public
as $$
  select e.id, e.title, e.venue_name, e.area,
         st_y(e.geog::geometry), st_x(e.geog::geometry),
         e.starts_at, e.price_naira, e.vibe, e.source, e.ig_url, e.flyer_url,
         st_distance(e.geog, st_point(p_lng, p_lat)::geography),
         h.heat, h.checkins, h.swipes_in
  from public.events e
  join public.event_heat h on h.event_id = e.id
  where e.status = 'live'
    and e.starts_at between p_from and p_to
    and st_dwithin(e.geog, st_point(p_lng, p_lat)::geography, p_radius_m)
  order by h.heat desc, e.starts_at asc;
$$;

-- The swipe deck: live events this Hopper has not judged yet, nearest first.
create or replace function public.events_deck(
  p_lat   double precision,
  p_lng   double precision,
  p_limit int default 30
)
returns table (
  id uuid, title text, venue_name text, area text,
  lat double precision, lng double precision,
  starts_at timestamptz, price_naira int, vibe text, source text,
  ig_url text, flyer_url text,
  distance_m double precision, heat int, swipes_in int
)
language sql stable security definer set search_path = public
as $$
  select e.id, e.title, e.venue_name, e.area,
         st_y(e.geog::geometry), st_x(e.geog::geometry),
         e.starts_at, e.price_naira, e.vibe, e.source, e.ig_url, e.flyer_url,
         st_distance(e.geog, st_point(p_lng, p_lat)::geography),
         h.heat, h.swipes_in
  from public.events e
  join public.event_heat h on h.event_id = e.id
  where e.status = 'live'
    and e.starts_at > now() - interval '2 hours'
    and not exists (select 1 from public.swipes s where s.event_id = e.id and s.user_id = auth.uid())
  order by st_distance(e.geog, st_point(p_lng, p_lat)::geography) asc, h.heat desc
  limit p_limit;
$$;

-- Check-in is gated server side at 1500 m. Doing this in the client only means
-- anyone can mint badges from their bedroom.
create or replace function public.claim_checkin(
  p_event_id uuid,
  p_lat      double precision,
  p_lng      double precision
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
  v_dist double precision;
  v_xp int := 50;
  v_new text[] := '{}';
  v_is_hop boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select * into v_event from public.events where id = p_event_id and status = 'live';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_event');
  end if;

  v_dist := st_distance(v_event.geog, st_point(p_lng, p_lat)::geography);
  if v_dist > 1500 then
    return jsonb_build_object('ok', false, 'reason', 'too_far', 'distance_m', round(v_dist));
  end if;

  insert into public.checkins (event_id, user_id) values (p_event_id, v_user)
  on conflict (event_id, user_id) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  select exists (
    select 1 from public.hop_stops hs
    where st_dwithin(hs.geog, v_event.geog, 200)
  ) into v_is_hop;
  if v_is_hop then v_xp := v_xp + 50; end if;

  -- badges
  perform public.award_badge(v_user, case when a.side = 'island' then 'island' else 'mainland' end)
    from public.areas a where a.name = v_event.area;
  if extract(hour from v_event.starts_at at time zone 'Africa/Lagos') >= 23 then
    perform public.award_badge(v_user, 'latenight');
  end if;
  if v_event.price_naira = 0 then perform public.award_badge(v_user, 'free'); end if;
  if v_event.vibe = 'comedy'   then perform public.award_badge(v_user, 'comedy'); end if;
  if v_event.vibe = 'beach'    then perform public.award_badge(v_user, 'beach'); end if;
  if v_is_hop                  then perform public.award_badge(v_user, 'hop'); end if;

  update public.profiles set xp = xp + v_xp where id = v_user;

  select coalesce(array_agg(key), '{}') into v_new
  from public.badges where user_id = v_user and earned_at > now() - interval '5 seconds';

  return jsonb_build_object('ok', true, 'xp', v_xp, 'distance_m', round(v_dist), 'badges', v_new);
end;
$$;

create or replace function public.award_badge(p_user uuid, p_key text)
returns void
language sql security definer set search_path = public
as $$
  insert into public.badges (user_id, key) values (p_user, p_key)
  on conflict (user_id, key) do nothing;
$$;

-- ============================================================= rls =========
alter table public.areas      enable row level security;
alter table public.profiles   enable row level security;
alter table public.events     enable row level security;
alter table public.checkins   enable row level security;
alter table public.swipes     enable row level security;
alter table public.badges     enable row level security;
alter table public.crew       enable row level security;
alter table public.messages   enable row level security;
alter table public.hops       enable row level security;
alter table public.hop_stops  enable row level security;
alter table public.hop_riders enable row level security;

-- public reference data
drop policy if exists areas_read on public.areas;
create policy areas_read on public.areas for select using (true);
drop policy if exists hops_read on public.hops;
create policy hops_read on public.hops for select using (true);
drop policy if exists hop_stops_read on public.hop_stops;
create policy hop_stops_read on public.hop_stops for select using (true);

-- profiles: names are shown on leaderboards, so readable; writable by owner
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- RLS picks the row, grants pick the columns. Without this a Hopper could set
-- their own xp or is_admin from the console. XP only moves via claim_checkin().
revoke update on public.profiles from anon, authenticated;
grant update (display_name, area, avatar) on public.profiles to authenticated;

-- events: only what is live is public; a Hopper can see and withdraw their own
drop policy if exists events_read_live on public.events;
create policy events_read_live on public.events for select
  using (status = 'live' or created_by = auth.uid());
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (auth.uid() is not null);
drop policy if exists events_delete_own_pending on public.events;
create policy events_delete_own_pending on public.events for delete
  using (created_by = auth.uid() and status = 'pending');

-- check-ins are the product: who is out, right now
drop policy if exists checkins_read on public.checkins;
create policy checkins_read on public.checkins for select using (true);

-- swipes are private to the Hopper who swiped
drop policy if exists swipes_read_own on public.swipes;
create policy swipes_read_own on public.swipes for select using (user_id = auth.uid());
drop policy if exists swipes_insert_own on public.swipes;
create policy swipes_insert_own on public.swipes for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists swipes_delete_own on public.swipes;
create policy swipes_delete_own on public.swipes for delete using (user_id = auth.uid());

drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select using (true);

drop policy if exists crew_rw_own on public.crew;
create policy crew_rw_own on public.crew for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select using (true);
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists riders_read on public.hop_riders;
create policy riders_read on public.hop_riders for select using (true);
drop policy if exists riders_insert_own on public.hop_riders;
create policy riders_insert_own on public.hop_riders for insert to authenticated
  with check (user_id = auth.uid());

-- ======================================================= realtime ==========
-- Live chat and live heat on the map.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.checkins; exception when duplicate_object then null; end;
  end if;
end $$;
