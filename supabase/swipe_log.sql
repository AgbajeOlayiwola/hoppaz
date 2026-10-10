-- ============================================================================
-- Hoppaz: the swipe log (every swipe on the Today deck, left and right)
-- Run order: schema.sql, chat_accounts.sql, then THIS FILE (it only needs
-- profiles and events). Safe to run again. Test: tests/swipe_log_test.sql.
--
-- public.swipes holds where each Hopper stands on an event (one row: 'in' is
-- WE OUTSIDE, which also sends the group chat invite). This file keeps the
-- story of how they got there, for the data: one row per swipe, never updated.
-- The deck is endless (a card you swipe either way comes round again), so one
-- Hopper can swipe the same event many times, and every time is kept.
--
--   swipe_log    who swiped, which event, which way ('right' or 'left'), where
--                in the app (surface, 'today' for now) and when. Anyone signed
--                in writes their own rows, guests (anonymous sessions) too:
--                a swipe needs no account, only WE OUTSIDE does. A Hopper reads
--                back only their own rows; nobody updates or deletes them (the
--                rows go with the profile). Staff read everything with the
--                service role.
--   swipe_stats  per event: right and left swipes, and how many Hoppers swiped
--                each way. security_invoker, so through the app's key it only
--                ever counts your own swipes; staff see the whole picture.
--
-- A second swipe of the same event the same way inside two seconds is dropped
-- (a double fire, not a choice), so the counts stay honest.
-- ============================================================================

create table if not exists public.swipe_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  direction  text not null check (direction in ('right', 'left')),
  surface    text not null default 'today' check (char_length(surface) between 1 and 24),
  created_at timestamptz not null default now()
);
create index if not exists swipe_log_event_idx on public.swipe_log (event_id, direction);
create index if not exists swipe_log_user_idx on public.swipe_log (user_id, created_at desc);

alter table public.swipe_log enable row level security;

drop policy if exists swipe_log_read_own on public.swipe_log;
create policy swipe_log_read_own on public.swipe_log for select using (user_id = auth.uid());
drop policy if exists swipe_log_insert_own on public.swipe_log;
create policy swipe_log_insert_own on public.swipe_log for insert to authenticated
  with check (user_id = auth.uid());

revoke update, delete on public.swipe_log from anon, authenticated;

-- The time is the server's, whatever the app sends; a double fire is dropped.
create or replace function public.swipe_log_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  if exists (
    select 1 from swipe_log l
     where l.user_id = new.user_id and l.event_id = new.event_id and l.direction = new.direction
       and l.created_at > now() - interval '2 seconds'
  ) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists swipe_log_guard on public.swipe_log;
create trigger swipe_log_guard before insert on public.swipe_log
  for each row execute function public.swipe_log_guard();

create or replace view public.swipe_stats with (security_invoker = true) as
  select l.event_id,
         e.title,
         e.starts_at,
         count(*) filter (where l.direction = 'right')::int as rights,
         count(*) filter (where l.direction = 'left')::int  as lefts,
         count(distinct l.user_id) filter (where l.direction = 'right')::int as hoppers_right,
         count(distinct l.user_id) filter (where l.direction = 'left')::int  as hoppers_left,
         max(l.created_at) as last_swipe_at
    from public.swipe_log l
    join public.events e on e.id = l.event_id
   group by l.event_id, e.title, e.starts_at;

grant select, insert on public.swipe_log to authenticated;
grant select on public.swipe_stats to authenticated;
