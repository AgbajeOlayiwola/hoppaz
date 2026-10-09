-- ============================================================================
-- Hoppaz: spawn alerts by web push (the database half)
-- Run order: schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql,
-- spawn_points_lagos.sql, box_guards.sql, daily_box.sql, play.sql, then THIS
-- FILE. Safe to run again. Guide: docs/PUSH.md. Test: tests/push_test.sql.
--
-- What it adds:
--   push_subscriptions     one row per browser a Hopper allowed alerts on. Each
--                          Hopper can read and delete only their own rows; rows
--                          are written by save_push_subscription().
--   alert_prefs            the Hopper's choice: off, few (about 3 a play-day) or
--                          all. No row means few. my_alert_level() reads it,
--                          set_alert_level() writes it.
--   push_config            small server-side settings (the send route's address
--                          and shared secret, quiet hours, the daily cap...).
--                          Nobody but the server can read it.
--   pick_spot_alert_users  who should hear about a new spot: a push
--                          subscription, a fix under 6 hours old within 3 km,
--                          not Off, under the daily cap, not alerted for this
--                          spot already. It claims the quota in the same
--                          statement, so two spots lit at once cannot both
--                          spend the last alert.
--   notify_spot_alert      picks, then asks the Next.js send route to deliver
--                          the pushes through pg_net. The spot spawner calls
--                          this once for each new spot.
--
-- Spots do not exist yet (Phase 4). Call notify_spot_alert from the spawner
-- when they do; until then see docs/PUSH.md for the manual test path.
--
-- Quiet hours are 23:00 to 07:00 Lagos (Jae, 9 Oct 2026; the older
-- spec text says 21:00 to 07:00). Change them with set_push_config, no redeploy:
--   select set_push_config('quiet_from_hour', '21'); select set_push_config('quiet_until_hour', '7');
-- ============================================================================

-- ------------------------------------------------------------- config ------
create table if not exists public.push_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
grant all on public.push_config to service_role;

create or replace function public.set_push_config(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_value is null then
    delete from push_config where key = p_key;
  else
    insert into push_config (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
revoke all on function public.set_push_config(text, text) from public, anon, authenticated;
grant execute on function public.set_push_config(text, text) to service_role;

create or replace function public.push_cfg(p_key text, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value from push_config where key = p_key), p_default);
$$;
revoke all on function public.push_cfg(text, text) from public, anon, authenticated;
grant execute on function public.push_cfg(text, text) to service_role;

-- -------------------------------------------------- push_subscriptions -----
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_read_own on public.push_subscriptions;
create policy push_subscriptions_read_own on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions for delete using (user_id = auth.uid());
-- no insert or update policy: save_push_subscription() is the only way in
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- Saves (or moves) this browser's subscription for the signed-in Hopper. A
-- browser keeps one endpoint, so when another Hopper signs in on the same phone
-- the row simply changes owner. At most 5 browsers per Hopper; the oldest go.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return false; end if;
  if p_endpoint is null or length(p_endpoint) not between 20 and 1000 or p_endpoint !~ '^https://[^[:space:]]+$' then return false; end if;
  -- Only a real push service: the server posts to this address, so a Hopper may not choose any other host
  -- (kept in step with PUSH_HOSTS in src/app/api/push/_lib.ts).
  if p_endpoint !~* '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/[^[:space:]@]*$' then return false; end if;
  if p_p256dh is null or length(p_p256dh) not between 20 and 200 then return false; end if;
  if p_auth is null or length(p_auth) not between 8 and 100 then return false; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), clock_timestamp(), clock_timestamp())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, updated_at = clock_timestamp();
  delete from push_subscriptions
  where id in (select id from push_subscriptions where user_id = me order by updated_at desc offset 5);
  return true;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated, service_role;

-- --------------------------------------------------------- alert_prefs -----
create table if not exists public.alert_prefs (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  alert_level text not null default 'few' check (alert_level in ('off', 'few', 'all')),
  updated_at  timestamptz not null default now()
);
alter table public.alert_prefs enable row level security;
drop policy if exists alert_prefs_read_own on public.alert_prefs;
create policy alert_prefs_read_own on public.alert_prefs for select using (user_id = auth.uid());
revoke all on public.alert_prefs from anon, authenticated;
grant select on public.alert_prefs to authenticated;
grant all on public.alert_prefs to service_role;

create or replace function public.my_alert_level()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select alert_level from alert_prefs where user_id = auth.uid()), 'few');
$$;
revoke all on function public.my_alert_level() from public, anon;
grant execute on function public.my_alert_level() to authenticated, service_role;

create or replace function public.set_alert_level(p_level text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_level is null or p_level not in ('off', 'few', 'all') then return false; end if;
  insert into alert_prefs (user_id, alert_level) values (auth.uid(), p_level)
  on conflict (user_id) do update set alert_level = excluded.alert_level, updated_at = now();
  return true;
end $$;
revoke all on function public.set_alert_level(text) from public, anon;
grant execute on function public.set_alert_level(text) to authenticated, service_role;

-- ------------------------------------------------------------ the picker ---
-- Quiet hours in Lagos time. From 23 to 7 means 23:00 up to (not including) 07:00.
create or replace function public.push_in_quiet_hours(p_ts timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  h integer := extract(hour from p_ts at time zone 'Africa/Lagos')::integer;
  f integer := coalesce(nullif(push_cfg('quiet_from_hour', '23'), '')::integer, 23);
  u integer := coalesce(nullif(push_cfg('quiet_until_hour', '7'), '')::integer, 7);
begin
  if f = u then return false; end if;
  if f > u then return h >= f or h < u; end if;
  return h >= f and h < u;
end $$;
revoke all on function public.push_in_quiet_hours(timestamptz) from public, anon, authenticated;
grant execute on function public.push_in_quiet_hours(timestamptz) to service_role;

-- Who to alert for a spot at (p_lat, p_lng) that lit at p_spot_at. Returns each
-- Hopper's id and a rough distance in metres, and spends one alert of their
-- quota. Not called by players: service role only. Ignores quiet hours; that is
-- notify_spot_alert's job, so this stays easy to test.
--   dedupe: play_fix.alert_cursor is the newest spot already alerted. A spot with
--           the same (or an older) p_spot_at never alerts the same Hopper twice.
--           Spots that light in the same instant count as one wave: one alert.
--   quota:  few = 3 per play-day (06:00 Lagos turn-over), all = no cap.
create or replace function public.pick_spot_alert_users(
  p_spot_id uuid, p_lat double precision, p_lng double precision,
  p_spot_at timestamptz default now(), p_now timestamptz default now())
returns table (user_id uuid, distance_m integer) language plpgsql security definer set search_path = public as $$
declare
  today   date := public.lagos_play_day(p_now);
  radius  double precision := coalesce(nullif(push_cfg('radius_m', '3000'), '')::double precision, 3000);
  cap     integer := coalesce(nullif(push_cfg('few_per_day', '3'), '')::integer, 3);
  max_age interval := make_interval(hours => coalesce(nullif(push_cfg('fix_max_age_hours', '6'), '')::integer, 6));
  spot    geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  if p_lat is null or p_lng is null or p_lat not between 6.2 and 6.9 or p_lng not between 2.9 and 4.1 then return; end if;
  return query
  with cand as (
    select f.user_id as uid,
           st_distance(st_setsrid(st_makepoint(f.lng, f.lat), 4326)::geography, spot) as d
    from play_fix f
    left join alert_prefs ap on ap.user_id = f.user_id
    where f.at > p_now - max_age
      and f.at <= p_now + interval '5 minutes'
      and st_dwithin(st_setsrid(st_makepoint(f.lng, f.lat), 4326)::geography, spot, radius)
      and coalesce(ap.alert_level, 'few') <> 'off'
      and (f.alert_cursor is null or f.alert_cursor < p_spot_at)
      and (coalesce(ap.alert_level, 'few') = 'all'
           or (case when f.alert_day is distinct from today then 0 else f.alerts_today end) < cap)
      and exists (select 1 from push_subscriptions s where s.user_id = f.user_id)
    order by f.user_id
    for update of f
  ), claimed as (
    update play_fix pf
    set alert_cursor = p_spot_at,
        alerts_today = case when pf.alert_day is distinct from today then 1 else pf.alerts_today + 1 end,
        alert_day = today
    from cand
    where pf.user_id = cand.uid
    returning pf.user_id as uid
  )
  select cand.uid, cand.d::integer from cand join claimed on claimed.uid = cand.uid;
end $$;
revoke all on function public.pick_spot_alert_users(uuid, double precision, double precision, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pick_spot_alert_users(uuid, double precision, double precision, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------- the pg_net hop --
-- pg_net is Supabase's way for the database to make an HTTP call. Created here
-- if the project allows it; if not, enable it in Supabase (Database,
-- Extensions) and run this file again.
do $net$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not available here. TODO: enable it in Supabase (Database, Extensions) and run push.sql again, or call POST /api/push/send yourself (docs/PUSH.md).';
end $net$;

-- Tells every Hopper who should hear about this spot. Call it once per new
-- spot, from the spawner, with the spot's id, its point, its name and the time
-- it lit. Returns how many Hoppers were alerted (0 in quiet hours, or when the
-- send route is not set up yet). The HTTP call is queued by pg_net and goes out
-- after the surrounding transaction commits; if queueing fails, the quota these
-- Hoppers spent is given back.
--
-- One-off set-up (the address of the deployed app and the same secret as the
-- PUSH_SEND_SECRET env var; see docs/PUSH.md):
--   select set_push_config('send_url', 'https://YOUR-APP/api/push/send');
--   select set_push_config('send_secret', '...');
create or replace function public.notify_spot_alert(
  p_spot_id uuid, p_lat double precision, p_lng double precision, p_title text,
  p_spot_at timestamptz default now(), p_now timestamptz default now(), p_url text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  send_url    text := push_cfg('send_url', '');
  send_secret text := push_cfg('send_secret', '');
  alerts      jsonb;
  n           integer;
begin
  if push_in_quiet_hours(p_now) then return 0; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise notice 'notify_spot_alert: pg_net is not installed. TODO: enable pg_net, or have the spawner call /api/push/send itself (docs/PUSH.md).';
    return 0;
  end if;
  if send_url = '' or send_secret = '' then
    raise notice 'notify_spot_alert: send_url / send_secret are not set (select set_push_config(...), docs/PUSH.md).';
    return 0;
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', pk.user_id,
             'title', left(coalesce(nullif(trim(p_title), ''), 'A spot'), 60) || ' just lit up',
             'body', case when pk.distance_m < 1000 then 'Under 1 km from you. ' else 'About ' || round(pk.distance_m / 1000.0, 1)::text || ' km from you. ' end
                     || 'Send your avatar to open a box.',
             'url', coalesce(p_url, '/?spot=' || p_spot_id::text),
             'tag', 'spot-' || p_spot_id::text)), '[]'::jsonb)
      into alerts
      from public.pick_spot_alert_users(p_spot_id, p_lat, p_lng, p_spot_at, p_now) pk;
    n := jsonb_array_length(alerts);
    if n = 0 then return 0; end if;
    perform net.http_post(
      url := send_url,
      body := jsonb_build_object('alerts', alerts),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || send_secret),
      timeout_milliseconds := 8000);
    return n;
  exception when others then
    -- the sub-transaction rolled back the quota the picker spent; the spawner carries on
    raise warning 'notify_spot_alert failed: %', sqlerrm;
    return 0;
  end;
end $$;
revoke all on function public.notify_spot_alert(uuid, double precision, double precision, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.notify_spot_alert(uuid, double precision, double precision, text, timestamptz, timestamptz, text) to service_role;
