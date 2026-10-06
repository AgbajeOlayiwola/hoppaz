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
  least(100, e.base_heat + coalesce(c.n, 0) * 7 + coalesce(s.n, 0) * 3)::int as heat,
  -- Last on purpose: create or replace view can only append columns.
  coalesce(r.n, 0)::int as here_now
from public.events e
left join (select event_id, count(*) n from public.checkins group by 1) c on c.event_id = e.id
left join (select event_id, count(*) n from public.swipes where decision = 'in' group by 1) s on s.event_id = e.id
-- The live crowd: who checked in during the last three hours.
left join (select event_id, count(*) n from public.checkins where created_at > now() - interval '3 hours' group by 1) r on r.event_id = e.id;

-- ============================================================= rpc =========

-- Everything live inside a radius, with distance and heat already computed.
-- The return type grew here_now; Postgres will not replace a function whose
-- result shape changed, so drop it first.
drop function if exists public.events_near(double precision, double precision, double precision, timestamptz, timestamptz);
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
  distance_m double precision, heat int, checkins int, swipes_in int, here_now int
)
language sql stable security definer set search_path = public
as $$
  select e.id, e.title, e.venue_name, e.area,
         st_y(e.geog::geometry), st_x(e.geog::geometry),
         e.starts_at, e.price_naira, e.vibe, e.source, e.ig_url, e.flyer_url,
         st_distance(e.geog, st_point(p_lng, p_lat)::geography),
         h.heat, h.checkins, h.swipes_in, h.here_now
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

-- messages: policies live in the chat section below, after the tables they use.

drop policy if exists riders_read on public.hop_riders;
create policy riders_read on public.hop_riders for select using (true);
drop policy if exists riders_insert_own on public.hop_riders;
create policy riders_insert_own on public.hop_riders for insert to authenticated
  with check (user_id = auth.uid());

-- ================================================== event photos ==========
-- Pictures from the night, shown in the event card. Only someone the server
-- has checked in at that event can post, which keeps it to people who were
-- actually there. Admins hide a photo by setting hidden = true.
create table if not exists public.event_photos (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  path       text not null check (char_length(path) between 3 and 200),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists event_photos_event_idx on public.event_photos (event_id, created_at desc);
alter table public.event_photos enable row level security;

drop policy if exists event_photos_read on public.event_photos;
create policy event_photos_read on public.event_photos for select using (not hidden);
drop policy if exists event_photos_insert on public.event_photos;
create policy event_photos_insert on public.event_photos for insert to authenticated
  with check (
    user_id = auth.uid()
    and hidden = false
    -- the file must sit in the poster's own folder for this event
    and path like auth.uid()::text || '/' || event_id::text || '/%'
    and exists (select 1 from public.checkins c where c.event_id = event_photos.event_id and c.user_id = auth.uid())
  );
drop policy if exists event_photos_delete_own on public.event_photos;
create policy event_photos_delete_own on public.event_photos for delete using (user_id = auth.uid());

-- Storage: public to read, each Hopper writes only under their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', true, 3145728, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists event_photos_upload on storage.objects;
create policy event_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists event_photos_remove_own on storage.objects;
create policy event_photos_remove_own on storage.objects for delete to authenticated
  using (bucket_id = 'event-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========================================================== chat ==========
-- Rooms (base, each event, each Hop), waves between people who have met, DMs
-- that open only when a wave is accepted, anonymous aliases with a mutual
-- reveal, blocks and reports.
--
-- The rule that holds it together: no user id ever reaches a browser through
-- chat. Room messages carry an opaque per-room identity key; DMs say "from a"
-- or "from b". Only security-definer functions (and admins via the service
-- role) can map a key back to a person, which is what keeps anonymous mode
-- honest and still lets abuse be traced.

-- ---- identities: one random key per person per room, named and anon apart
create table if not exists public.room_identities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  channel    text not null,
  anon       boolean not null,
  alias      text not null,
  created_at timestamptz not null default now(),
  -- separate keys for named and anonymous posting, so one never unmasks the other
  unique (user_id, channel, anon)
);
alter table public.room_identities enable row level security;
-- deliberately no policies: nobody reads this table except definer functions

create or replace function public.make_alias()
returns text language sql volatile as $$
  select (array['Jollof','Danfo','Suya','Agbada','Gele','Okada','Keke','Molue','Owambe','Zobo',
                'Shayo','Bridge','Yaba','Lekki','Ankara','Chapman','Puff-puff','Asun'])[1 + floor(random() * 18)::int]
      || ' ' || (array['Hopper','Rider','Raver','Stepper','Vibe','Spark','Groove','Wave'])[1 + floor(random() * 8)::int]
      || ' ' || upper(substr(md5(random()::text), 1, 2));
$$;

create or replace function public.identity_for(p_user uuid, p_channel text, p_anon boolean)
returns public.room_identities
language plpgsql security definer set search_path = public as $$
declare r public.room_identities;
begin
  select * into r from room_identities where user_id = p_user and channel = p_channel and anon = p_anon;
  if found then return r; end if;
  insert into room_identities (user_id, channel, anon, alias)
  values (p_user, p_channel, p_anon, make_alias())
  on conflict (user_id, channel, anon) do nothing;
  select * into r from room_identities where user_id = p_user and channel = p_channel and anon = p_anon;
  return r;
end $$;
-- Internal only: called with any user id it would map people to their aliases.
revoke all on function public.identity_for(uuid, text, boolean) from public, anon, authenticated;

-- ---- blocks and reports
create table if not exists public.blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker    uuid not null references public.profiles(id) on delete cascade,
  blocked    uuid not null references public.profiles(id) on delete cascade,
  label      text not null, -- what the blocker saw (an alias or a name), for the unblock list
  created_at timestamptz not null default now(),
  unique (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
-- no policies: reading "blocked" would hand over the id behind an alias

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter    uuid not null references public.profiles(id) on delete cascade,
  target      uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('room', 'dm', 'person')),
  ref_id      uuid,
  excerpt     text,
  reason      text not null check (char_length(reason) between 1 and 300),
  created_at  timestamptz not null default now()
);
alter table public.reports enable row level security;
-- no policies: admins read reports with the service role

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
revoke all on function public.is_blocked(uuid, uuid) from public, anon, authenticated;

-- ---- room messages: authorship moves off the row
alter table public.messages add column if not exists author_key  uuid references public.room_identities(id) on delete set null;
alter table public.messages add column if not exists author_name text;
alter table public.messages add column if not exists author_look jsonb;
alter table public.messages add column if not exists anon        boolean not null default false;

do $$
begin
  -- One-time move: old messages carried user_id in the clear. Give each author
  -- a named room identity, copy their name and look, then drop the column.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'messages' and column_name = 'user_id') then
    drop policy if exists messages_insert_own on public.messages;
    insert into public.room_identities (user_id, channel, anon, alias)
      select distinct on (m.user_id, m.channel) m.user_id, m.channel, false, public.make_alias()
      from public.messages m
      on conflict (user_id, channel, anon) do nothing;
    update public.messages m
       set author_key = ri.id, author_name = coalesce(p.display_name, 'A Hopper'), author_look = p.avatar
      from public.room_identities ri, public.profiles p
     where ri.user_id = m.user_id and ri.channel = m.channel and ri.anon = false and p.id = m.user_id;
    alter table public.messages drop column user_id;
  end if;
end $$;

-- The server fills in who posted. Whatever the client sends for author fields is overwritten.
create or replace function public.stamp_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r  room_identities;
  p  profiles;
  n  int;
begin
  if me is null then raise exception 'no_session'; end if;
  select count(*) into n
    from messages m join room_identities ri on ri.id = m.author_key
   where ri.user_id = me and m.created_at > now() - interval '30 seconds';
  if n >= 8 then raise exception 'slow_down'; end if;

  r := identity_for(me, new.channel, coalesce(new.anon, false));
  select * into p from profiles where id = me;
  new.anon        := coalesce(new.anon, false);
  new.author_key  := r.id;
  new.author_name := case when new.anon then r.alias else coalesce(p.display_name, 'A Hopper') end;
  new.author_look := case when new.anon then null else p.avatar end;
  new.created_at  := now();
  return new;
end $$;

drop trigger if exists messages_stamp on public.messages;
create trigger messages_stamp before insert on public.messages
  for each row execute function public.stamp_message();

-- Hidden: rooms of events that ended over a day ago, and anyone you blocked (or who blocked you).
create or replace function public.message_visible(p_channel text, p_key uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
           select 1 from events e
            where e.id::text = p_channel
              and coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '24 hours' < now())
     and not exists (
           select 1 from room_identities ri
            where ri.id = p_key and auth.uid() is not null and is_blocked(auth.uid(), ri.user_id));
$$;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select
  using (public.message_visible(channel, author_key));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (auth.uid() is not null);

-- Event rooms clear the day after. The read policy already hides them; this
-- deletes them for real. Schedule it if pg_cron is on:
--   select cron.schedule('hoppaz-purge-rooms', '15 * * * *', 'select public.purge_expired_rooms()');
create or replace function public.purge_expired_rooms()
returns int language sql security definer set search_path = public as $$
  with gone as (
    delete from messages m using events e
     where e.id::text = m.channel
       and coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '24 hours' < now()
    returning 1)
  select count(*)::int from gone;
$$;
revoke all on function public.purge_expired_rooms() from public, anon, authenticated;

-- Your own keys in a room, so the client can tell which messages are yours.
create or replace function public.my_room_keys(p_channel text)
returns table (key uuid, anon boolean, alias text)
language sql stable security definer set search_path = public as $$
  select id, anon, alias from room_identities where user_id = auth.uid() and channel = p_channel;
$$;

-- What you would be called if you posted anonymously here (creates it on first ask).
create or replace function public.my_alias(p_channel text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  return (identity_for(auth.uid(), p_channel, true)).alias;
end $$;

-- ---- "met": checked in at the same event, or rode the same Hop
create or replace function public.have_met(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from checkins c1 join checkins c2 on c2.event_id = c1.event_id
                  where c1.user_id = a and c2.user_id = b)
      or exists (select 1 from hop_riders h1 join hop_riders h2 on h2.hop_id = h1.hop_id
                  where h1.user_id = a and h2.user_id = b);
$$;
revoke all on function public.have_met(uuid, uuid) from public, anon, authenticated;

-- ---- who's here: only for people checked in at the same event
create or replace function public.whos_here(p_event uuid)
returns table (key uuid, alias text, waved boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from checkins where event_id = p_event and user_id = me) then
    return; -- not there yourself: you do not get to see who is
  end if;
  return query
    select (identity_for(c.user_id, p_event::text, true)).id,
           (identity_for(c.user_id, p_event::text, true)).alias,
           exists (select 1 from waves w where w.from_user = me and w.to_user = c.user_id)
      from checkins c
     where c.event_id = p_event
       and c.user_id <> me
       and c.created_at > now() - interval '6 hours'
       and not is_blocked(me, c.user_id)
     order by c.created_at desc
     limit 60;
end $$;

-- ---- waves and DMs
create table if not exists public.waves (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references public.profiles(id) on delete cascade,
  to_user      uuid not null references public.profiles(id) on delete cascade,
  event_id     uuid references public.events(id) on delete set null,
  from_alias   text not null,
  to_alias     text not null,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (from_user, to_user),
  check (from_user <> to_user)
);
alter table public.waves enable row level security; -- RPC only

create table if not exists public.dms (
  id         uuid primary key default gen_random_uuid(),
  a          uuid not null references public.profiles(id) on delete cascade,
  b          uuid not null references public.profiles(id) on delete cascade,
  a_alias    text not null,
  b_alias    text not null,
  a_revealed boolean not null default false,
  b_revealed boolean not null default false,
  event_id   uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  check (a <> b)
);
create unique index if not exists dms_pair_idx on public.dms (least(a, b), greatest(a, b));
alter table public.dms enable row level security; -- RPC only

create table if not exists public.dm_messages (
  id         uuid primary key default gen_random_uuid(),
  dm_id      uuid not null references public.dms(id) on delete cascade,
  from_a     boolean not null, -- not a user id: the other side never learns yours from a message
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_dm_idx on public.dm_messages (dm_id, created_at desc);
alter table public.dm_messages enable row level security;

create or replace function public.is_dm_member(p_dm uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from dms d
                  where d.id = p_dm and auth.uid() in (d.a, d.b) and not is_blocked(d.a, d.b));
$$;

drop policy if exists dm_messages_read on public.dm_messages;
create policy dm_messages_read on public.dm_messages for select using (public.is_dm_member(dm_id));
-- no insert policy: messages go through send_dm()

create or replace function public.open_dm(p_wave public.waves)
returns uuid language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  insert into dms (a, b, a_alias, b_alias, event_id)
  values (p_wave.from_user, p_wave.to_user, p_wave.from_alias, p_wave.to_alias, p_wave.event_id)
  on conflict do nothing
  returning id into d;
  if d is null then
    select id into d from dms
     where least(a, b) = least(p_wave.from_user, p_wave.to_user)
       and greatest(a, b) = greatest(p_wave.from_user, p_wave.to_user);
  end if;
  return d;
end $$;
revoke all on function public.open_dm(public.waves) from public, anon, authenticated;

-- Wave at someone by the key on their message or in "who's here".
-- Returns: sent | matched:<dm id> | already | not_met | blocked | slow_down | self | gone | no_session
create or replace function public.send_wave(p_key uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  them  uuid;
  ch    text;
  ev    uuid;
  back  waves;
  w     waves;
  n     int;
begin
  if me is null then return 'no_session'; end if;
  select user_id, channel into them, ch from room_identities where id = p_key;
  if them is null then return 'gone'; end if;
  if them = me then return 'self'; end if;
  if exists (select 1 from blocks where blocker = me and blocked = them) then return 'blocked'; end if;
  -- Blocked by them: say nothing that tells you so.
  if exists (select 1 from blocks where blocker = them and blocked = me) then return 'sent'; end if;
  if not have_met(me, them) then return 'not_met'; end if;

  -- They already waved at you: that is a match, open the DM.
  select * into back from waves where from_user = them and to_user = me;
  if found then
    if back.status = 'pending' then
      update waves set status = 'accepted', responded_at = now() where id = back.id returning * into back;
    end if;
    if back.status = 'accepted' then return 'matched:' || open_dm(back)::text; end if;
    return 'already';
  end if;
  if exists (select 1 from waves where from_user = me and to_user = them) then return 'already'; end if;

  select count(*) into n from waves where from_user = me and created_at > now() - interval '1 day';
  if n >= 30 then return 'slow_down'; end if;

  select id into ev from events where id::text = ch;
  insert into waves (from_user, to_user, event_id, from_alias, to_alias)
  values (me, them, ev,
          (identity_for(me, ch, true)).alias,
          (identity_for(them, ch, true)).alias)
  returning * into w;
  return 'sent';
end $$;

create or replace function public.my_waves()
returns table (id uuid, from_alias text, event_title text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.id, w.from_alias, e.title, w.created_at
    from waves w left join events e on e.id = w.event_id
   where w.to_user = auth.uid() and w.status = 'pending' and not is_blocked(w.from_user, w.to_user)
   order by w.created_at desc;
$$;

-- Accept opens the DM and returns its id; decline returns null.
create or replace function public.respond_wave(p_wave uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare w waves;
begin
  update waves set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_wave and to_user = auth.uid() and status = 'pending'
  returning * into w;
  if not found or not p_accept then return null; end if;
  return open_dm(w);
end $$;

create or replace function public.my_dms()
returns table (
  id uuid, i_am_a boolean, other_name text, other_look jsonb, revealed boolean,
  me_revealed boolean, them_revealed boolean, my_alias text, event_title text,
  last_body text, last_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.id,
         d.a = auth.uid(),
         case when d.a_revealed and d.b_revealed then coalesce(p.display_name, 'A Hopper')
              when d.a = auth.uid() then d.b_alias else d.a_alias end,
         case when d.a_revealed and d.b_revealed then p.avatar end,
         d.a_revealed and d.b_revealed,
         case when d.a = auth.uid() then d.a_revealed else d.b_revealed end,
         case when d.a = auth.uid() then d.b_revealed else d.a_revealed end,
         case when d.a = auth.uid() then d.a_alias else d.b_alias end,
         e.title,
         l.body,
         coalesce(l.created_at, d.created_at)
    from dms d
    join profiles p on p.id = case when d.a = auth.uid() then d.b else d.a end
    left join events e on e.id = d.event_id
    left join lateral (select body, created_at from dm_messages where dm_id = d.id
                        order by created_at desc limit 1) l on true
   where auth.uid() in (d.a, d.b) and not is_blocked(d.a, d.b)
   order by coalesce(l.created_at, d.created_at) desc;
$$;

create or replace function public.send_dm(p_dm uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d dms; n int; out_id uuid;
begin
  select * into d from dms where id = p_dm and auth.uid() in (a, b);
  if not found or is_blocked(d.a, d.b) then raise exception 'not_in_dm'; end if;
  select count(*) into n from dm_messages
   where dm_id = p_dm and from_a = (d.a = auth.uid()) and created_at > now() - interval '30 seconds';
  if n >= 10 then raise exception 'slow_down'; end if;
  insert into dm_messages (dm_id, from_a, body) values (p_dm, d.a = auth.uid(), btrim(p_body))
  returning id into out_id;
  return out_id;
end $$;

-- Names show only once both sides have tapped reveal. There is no un-reveal.
create or replace function public.reveal_dm(p_dm uuid)
returns void language sql security definer set search_path = public as $$
  update dms set a_revealed = a_revealed or a = auth.uid(),
                 b_revealed = b_revealed or b = auth.uid()
   where id = p_dm and auth.uid() in (a, b);
$$;

-- Block by a room key, or by DM. Works on aliases without exposing who they are.
create or replace function public.block_person(p_key uuid default null, p_dm uuid default null, p_label text default 'A Hopper')
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them uuid;
begin
  if me is null then return false; end if;
  if p_key is not null then select user_id into them from room_identities where id = p_key; end if;
  if p_dm is not null then
    select case when a = me then b else a end into them from dms where id = p_dm and me in (a, b);
  end if;
  if them is null or them = me then return false; end if;
  insert into blocks (blocker, blocked, label) values (me, them, left(coalesce(p_label, 'A Hopper'), 60))
  on conflict (blocker, blocked) do nothing;
  update waves set status = 'declined', responded_at = now()
   where status = 'pending' and ((from_user = me and to_user = them) or (from_user = them and to_user = me));
  return true;
end $$;

create or replace function public.my_blocks()
returns table (id uuid, label text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, label, created_at from blocks where blocker = auth.uid() order by created_at desc;
$$;

create or replace function public.unblock(p_block uuid)
returns void language sql security definer set search_path = public as $$
  delete from blocks where id = p_block and blocker = auth.uid();
$$;

-- Report a room message, a DM message, or a person. The server resolves who.
create or replace function public.report(p_kind text, p_ref uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them uuid; ex text;
begin
  if me is null then return false; end if;
  if p_kind = 'room' then
    select ri.user_id, m.body into them, ex
      from messages m join room_identities ri on ri.id = m.author_key where m.id = p_ref;
  elsif p_kind = 'dm' then
    select case when x.from_a then d.a else d.b end, x.body into them, ex
      from dm_messages x join dms d on d.id = x.dm_id
     where x.id = p_ref and me in (d.a, d.b);
  elsif p_kind = 'person' then
    select user_id into them from room_identities where id = p_ref;
  end if;
  if them is null or them = me then return false; end if;
  insert into reports (reporter, target, kind, ref_id, excerpt, reason)
  values (me, them, p_kind, p_ref, left(ex, 400), left(p_reason, 300));
  return true;
end $$;

-- ======================================================= realtime ==========
-- Live chat and live heat on the map.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.checkins; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.dm_messages; exception when duplicate_object then null; end;
  end if;
end $$;
