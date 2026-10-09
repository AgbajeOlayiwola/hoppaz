-- ============================================================================
-- Hoppaz: handles, accounts, event rooms, group chats and chat pictures
-- Run in the Supabase SQL editor after schema.sql. Safe to run again.
--
-- What changes:
--   * every Hopper gets a unique, auto-generated handle (JollofRaver4821), and
--     chat shows it so you always know who you are talking to
--   * gender and birthday live in profile_private, never on the public profile
--   * event rooms: temporary, for everyone checked in at the event; gone for
--     good three days after it
--   * event group chats: permanent; saying you're going sends the invite
--   * waving, private chats and adding someone to your crew need an account
--     (email + password); rooms and group chats do not
--   * room and DM messages can carry a picture (private bucket, signed URLs)
-- ============================================================================

-- ------------------------------------------------------------- handles -----
alter table public.profiles add column if not exists handle text;

create or replace function public.make_handle()
returns text language plpgsql volatile set search_path = public as $$
declare
  firsts text[] := array['Jollof','Danfo','Suya','Agbada','Gele','Okada','Keke','Molue','Owambe','Zobo',
                         'Shayo','Bridge','Yaba','Lekki','Ankara','Chapman','PuffPuff','Asun','Amala','Akara',
                         'Kilishi','Bole','Eko','Ikoyi','Surulere','Obalende','Fela','Afrobeat'];
  seconds text[] := array['Hopper','Rider','Raver','Stepper','Vibe','Spark','Groove','Wave','Star','Boss','Legend','Champ'];
  h text;
begin
  loop
    h := firsts[1 + floor(random() * array_length(firsts, 1))::int]
      || seconds[1 + floor(random() * array_length(seconds, 1))::int]
      || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from profiles where lower(handle) = lower(h));
  end loop;
  return h;
end $$;
revoke all on function public.make_handle() from public, anon, authenticated;

-- Row by row, so each new handle is visible to the uniqueness check of the next.
do $$
declare r record;
begin
  for r in select id from public.profiles where handle is null loop
    update public.profiles set handle = public.make_handle() where id = r.id;
  end loop;
end $$;
create unique index if not exists profiles_handle_idx on public.profiles (lower(handle));

create or replace function public.stamp_handle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.handle is null then new.handle := make_handle(); end if;
  return new;
end $$;
drop trigger if exists profiles_handle on public.profiles;
create trigger profiles_handle before insert on public.profiles
  for each row execute function public.stamp_handle();
-- Not in the profiles update grant: a handle is assigned, never chosen.

-- ------------------------------------------------------------ accounts -----
-- An account is an auth user with an email. Anonymous Hoppers have none.
create or replace function public.has_account()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and coalesce(u.email, '') <> '');
$$;
revoke all on function public.has_account() from public, anon;
grant execute on function public.has_account() to authenticated;

-- What we know about a Hopper beyond the public profile. Asked for a bit at a
-- time: gender at sign-up, birthday a day later, and so on.
create table if not exists public.profile_private (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  gender     text check (gender in ('female', 'male', 'other')),
  birthday   date,
  account_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;
drop policy if exists profile_private_read_own on public.profile_private;
create policy profile_private_read_own on public.profile_private for select using (user_id = auth.uid());
-- no write policies: details go through set_private_details() or the sign-up route

create or replace function public.set_private_details(p_gender text default null, p_birthday date default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if p_gender is not null and p_gender not in ('female', 'male', 'other') then return false; end if;
  if p_birthday is not null and (p_birthday < date '1900-01-01' or p_birthday > current_date) then return false; end if;
  insert into profile_private (user_id, gender, birthday) values (auth.uid(), p_gender, p_birthday)
  on conflict (user_id) do update
    set gender = coalesce(excluded.gender, profile_private.gender),
        birthday = coalesce(excluded.birthday, profile_private.birthday),
        updated_at = now();
  return true;
end $$;

-- An earlier draft had a NEARBY room for everyone in your area. Rooms are for
-- the event only now; this clears that draft away if it was run.
drop function if exists public.whos_near(text);
drop function if exists public.ping_presence(text);
drop function if exists public.is_near(uuid, text, interval);
drop table if exists public.presence;

-- ------------------------------------------------- who is in which room -----
-- An event's room is temporary and automatic: everyone checked in at the event
-- is in it, nobody has to add them. Its group chat is permanent and joined:
-- saying you're going sends the invite.
create table if not exists public.event_group_members (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'invited' check (status in ('invited', 'joined', 'left')),
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  primary key (event_id, user_id)
);
create index if not exists event_group_members_user_idx on public.event_group_members (user_id, status);
alter table public.event_group_members enable row level security;
drop policy if exists event_group_members_read_own on public.event_group_members;
create policy event_group_members_read_own on public.event_group_members for select using (user_id = auth.uid());
-- no write policies: join_group() and leave_group() below

-- Channels: '<event id>', 'group:<event id>', 'move:<crew move id>', 'hop-<hop id>'.
-- Anything else (the old 'base' room) is read-only history.
create or replace function public.in_room(p_user uuid, p_channel text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if p_channel like 'group:%' then
    return exists (select 1 from event_group_members
                    where user_id = p_user and event_id::text = substr(p_channel, 7) and status = 'joined');
  elsif exists (select 1 from events where id::text = p_channel) then
    return exists (select 1 from checkins where user_id = p_user and event_id::text = p_channel);
  elsif p_channel like 'move:%' then
    -- A crew move's chat: everyone in the crew who said I'M IN.
    return exists (select 1 from crew_move_rsvps
                    where user_id = p_user and move_id::text = substr(p_channel, 6) and status = 'going');
  elsif p_channel like 'hop-%' then
    return exists (select 1 from hop_riders where user_id = p_user and hop_id::text = substr(p_channel, 5));
  end if;
  return false;
end $$;
revoke all on function public.in_room(uuid, text) from public, anon, authenticated;

-- When an event room closes for good: three days after the event ends.
create or replace function public.room_closes_at(p_channel text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '3 days'
    from events e where e.id::text = p_channel;
$$;

-- Who can read a message: event rooms only their own people and only until they
-- close, group chats only members. The old draft's nearby rooms: nobody.
create or replace function public.message_visible(p_channel text, p_key uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select (case
            when p_channel like 'area:%' then false
            when p_channel like 'group:%' or p_channel like 'move:%' then in_room(auth.uid(), p_channel)
            when exists (select 1 from events e where e.id::text = p_channel)
              then room_closes_at(p_channel) > now() and in_room(auth.uid(), p_channel)
            else true
          end)
     and not exists (
           select 1 from room_identities ri
            where ri.id = p_key and auth.uid() is not null and is_blocked(auth.uid(), ri.user_id));
$$;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select
  using (public.message_visible(channel, author_key, created_at));
drop function if exists public.message_visible(text, uuid);

-- -------------------------------------------------------- room messages -----
alter table public.messages add column if not exists author_handle text;
alter table public.messages add column if not exists image_path    text;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (char_length(body) <= 400 and (char_length(btrim(body)) >= 1 or image_path is not null));
create index if not exists messages_image_idx on public.messages (image_path) where image_path is not null;

-- Same as before, plus: the handle on every message, event rooms only for people
-- checked in, group chats only for members, and a picture only from your own folder.
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
  if not in_room(me, new.channel) then
    raise exception '%', case when new.channel like 'group:%' then 'not_in_group'
                              when new.channel like 'move:%' then 'not_in_move'
                              else 'not_at_event' end;
  end if;
  if room_closes_at(new.channel) < now() then raise exception 'room_closed'; end if;
  if new.image_path is not null and new.image_path not like 'room/' || me::text || '/%' then raise exception 'bad_image'; end if;

  r := identity_for(me, new.channel, coalesce(new.anon, false));
  select * into p from profiles where id = me;
  new.anon          := coalesce(new.anon, false);
  new.author_key    := r.id;
  new.author_handle := case when new.anon then null else p.handle end;
  new.author_name   := case when new.anon then r.alias else coalesce(p.display_name, p.handle, 'A Hopper') end;
  new.author_look   := case when new.anon then null else p.avatar end;
  new.created_at    := now();
  return new;
end $$;

-- ---------------------------------------------------------- who's here -----
-- Everyone checked in at the event, for people checked in themselves. Named,
-- so you know who you are waving at.
drop function if exists public.whos_here(uuid);
create function public.whos_here(p_event uuid)
returns table (key uuid, handle text, name text, look jsonb, waved boolean, in_crew boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not in_room(me, p_event::text) then return; end if;
  return query
    select ri.id, p.handle, coalesce(p.display_name, p.handle), p.avatar,
           exists (select 1 from waves w where w.from_user = me and w.to_user = c.user_id),
           exists (select 1 from crew k where k.user_id = me and k.friend_id = c.user_id)
      from checkins c
      join profiles p on p.id = c.user_id
      cross join lateral identity_for(c.user_id, p_event::text, false) ri
     where c.event_id = p_event and c.user_id <> me
       and not is_blocked(me, c.user_id)
     order by c.created_at desc
     limit 80;
end $$;

-- ------------------------------------------------------ waves and DMs -----
-- Returns: sent | matched:<dm id> | already | not_met | blocked | slow_down | self | gone | no_session | need_account
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
  if not has_account() then return 'need_account'; end if;
  select user_id, channel into them, ch from room_identities where id = p_key;
  if them is null then return 'gone'; end if;
  if them = me then return 'self'; end if;
  if exists (select 1 from blocks where blocker = me and blocked = them) then return 'blocked'; end if;
  -- Blocked by them: say nothing that tells you so.
  if exists (select 1 from blocks where blocker = them and blocked = me) then return 'sent'; end if;
  -- Met at an event or on a Hop, or both around the same area right now.
  if not have_met(me, them) and not in_room(me, ch) then return 'not_met'; end if;

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
          (select coalesce(handle, 'A Hopper') from profiles where id = me),
          (select coalesce(handle, 'A Hopper') from profiles where id = them))
  returning * into w;
  return 'sent';
end $$;

drop function if exists public.my_waves();
create function public.my_waves()
returns table (id uuid, from_alias text, from_look jsonb, event_title text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.id, coalesce(p.handle, w.from_alias), p.avatar, e.title, w.created_at
    from waves w
    join profiles p on p.id = w.from_user
    left join events e on e.id = w.event_id
   where w.to_user = auth.uid() and w.status = 'pending' and not is_blocked(w.from_user, w.to_user)
   order by w.created_at desc;
$$;

create or replace function public.respond_wave(p_wave uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare w waves;
begin
  if p_accept and not has_account() then raise exception 'need_account'; end if;
  update waves set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_wave and to_user = auth.uid() and status = 'pending'
  returning * into w;
  if not found or not p_accept then return null; end if;
  return open_dm(w);
end $$;

-- DM messages can carry a picture too.
alter table public.dm_messages add column if not exists image_path text;
alter table public.dm_messages drop constraint if exists dm_messages_body_check;
alter table public.dm_messages add constraint dm_messages_body_check
  check (char_length(body) <= 1000 and (char_length(btrim(body)) >= 1 or image_path is not null));

-- The handle and look always show; the display name still waits for both to reveal.
drop function if exists public.my_dms();
create function public.my_dms()
returns table (
  id uuid, i_am_a boolean, other_name text, other_handle text, other_look jsonb, revealed boolean,
  me_revealed boolean, them_revealed boolean, my_alias text, event_title text,
  last_body text, last_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.id,
         d.a = auth.uid(),
         case when d.a_revealed and d.b_revealed then coalesce(p.display_name, p.handle, 'A Hopper')
              else coalesce(p.handle, case when d.a = auth.uid() then d.b_alias else d.a_alias end) end,
         p.handle,
         p.avatar,
         d.a_revealed and d.b_revealed,
         case when d.a = auth.uid() then d.a_revealed else d.b_revealed end,
         case when d.a = auth.uid() then d.b_revealed else d.a_revealed end,
         case when d.a = auth.uid() then d.a_alias else d.b_alias end,
         e.title,
         case when l.body = '' and l.image_path is not null then '📷 Photo' else l.body end,
         coalesce(l.created_at, d.created_at)
    from dms d
    join profiles p on p.id = case when d.a = auth.uid() then d.b else d.a end
    left join events e on e.id = d.event_id
    left join lateral (select body, image_path, created_at from dm_messages where dm_id = d.id
                        order by created_at desc limit 1) l on true
   where auth.uid() in (d.a, d.b) and not is_blocked(d.a, d.b)
   order by coalesce(l.created_at, d.created_at) desc;
$$;

drop function if exists public.send_dm(uuid, text);
create or replace function public.send_dm(p_dm uuid, p_body text, p_image text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d dms; n int; out_id uuid;
begin
  if not has_account() then raise exception 'need_account'; end if;
  select * into d from dms where id = p_dm and auth.uid() in (a, b);
  if not found or is_blocked(d.a, d.b) then raise exception 'not_in_dm'; end if;
  if p_image is not null and p_image not like 'dm/' || p_dm::text || '/' || auth.uid()::text || '/%' then
    raise exception 'bad_image';
  end if;
  select count(*) into n from dm_messages
   where dm_id = p_dm and from_a = (d.a = auth.uid()) and created_at > now() - interval '30 seconds';
  if n >= 10 then raise exception 'slow_down'; end if;
  insert into dm_messages (dm_id, from_a, body, image_path) values (p_dm, d.a = auth.uid(), btrim(coalesce(p_body, '')), p_image)
  returning id into out_id;
  return out_id;
end $$;

-- ------------------------------------------------------------- crew add -----
-- Add the person behind a room key to your crew. Returns: added | already |
-- self | gone | blocked | no_session | need_account
create or replace function public.add_to_crew(p_key uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them uuid;
begin
  if me is null then return 'no_session'; end if;
  if not has_account() then return 'need_account'; end if;
  select user_id into them from room_identities where id = p_key;
  if them is null then return 'gone'; end if;
  if them = me then return 'self'; end if;
  if is_blocked(me, them) then return 'blocked'; end if;
  insert into crew (user_id, friend_id) values (me, them) on conflict do nothing;
  if not found then return 'already'; end if;
  return 'added';
end $$;

-- ---------------------------------------------------------- chat images -----
-- Private bucket. Room pictures: room/<uploader>/<file>, readable once a visible
-- message points at them. DM pictures: dm/<dm id>/<uploader>/<file>, readable by
-- the two people in that chat only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_images_upload on storage.objects;
create policy chat_images_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-images' and (
    ((storage.foldername(name))[1] = 'room' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'dm'
        and (storage.foldername(name))[3] = auth.uid()::text
        and public.has_account()
        and public.is_dm_member(((storage.foldername(name))[2])::uuid))
  )
);

drop policy if exists chat_images_read on storage.objects;
create policy chat_images_read on storage.objects for select to authenticated using (
  bucket_id = 'chat-images' and (
    ((storage.foldername(name))[1] = 'room' and exists (select 1 from public.messages m where m.image_path = name))
    or ((storage.foldername(name))[1] = 'dm' and public.is_dm_member(((storage.foldername(name))[2])::uuid))
  )
);

drop policy if exists chat_images_remove_own on storage.objects;
create policy chat_images_remove_own on storage.objects for delete to authenticated using (
  bucket_id = 'chat-images' and (
    ((storage.foldername(name))[1] = 'room' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'dm' and (storage.foldername(name))[3] = auth.uid()::text)
  )
);

-- ---------------------------------------------------- event group chats -----
-- Saying you're going (the deck, or I'M GOING on the event card) invites you
-- to the event's group chat. Joining is up to you; the chat stays after the
-- night, unlike the event room. Messages live in messages, channel 'group:<event id>'.
create or replace function public.invite_to_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.decision = 'in' then
    insert into event_group_members (event_id, user_id) values (new.event_id, new.user_id)
    on conflict (event_id, user_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists swipes_group_invite on public.swipes;
create trigger swipes_group_invite after insert or update of decision on public.swipes
  for each row execute function public.invite_to_group();

-- Everyone who already said they're going gets their invite now.
insert into public.event_group_members (event_id, user_id)
  select event_id, user_id from public.swipes where decision = 'in'
on conflict (event_id, user_id) do nothing;

-- Your invites and your group chats, newest activity first.
create or replace function public.my_groups()
returns table (event_id uuid, title text, starts_at timestamptz, status text, members int, last_body text, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.event_id, e.title, e.starts_at, g.status,
         (select count(*)::int from event_group_members m where m.event_id = g.event_id and m.status = 'joined'),
         case when l.body = '' and l.image_path is not null then '📷 Photo' else l.body end,
         coalesce(l.created_at, g.joined_at, g.invited_at)
    from event_group_members g
    join events e on e.id = g.event_id
    left join lateral (select body, image_path, created_at from messages
                        where channel = 'group:' || g.event_id::text
                        order by created_at desc limit 1) l on g.status = 'joined'
   where g.user_id = auth.uid() and g.status in ('invited', 'joined')
   order by (g.status = 'invited') desc, coalesce(l.created_at, g.joined_at, g.invited_at) desc;
$$;

-- Join from an invite. Only people who were invited (said they're going) can.
create or replace function public.join_group(p_event uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update event_group_members set status = 'joined', joined_at = coalesce(joined_at, now())
   where event_id = p_event and user_id = auth.uid() and status in ('invited', 'left');
  return found;
end $$;

-- Decline an invite or leave the chat. The invite can be taken up again later.
create or replace function public.leave_group(p_event uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update event_group_members set status = 'left' where event_id = p_event and user_id = auth.uid();
  return found;
end $$;

-- Who is in a group chat, for members only.
create or replace function public.group_members(p_event uuid)
returns table (key uuid, handle text, name text, look jsonb, waved boolean, in_crew boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not in_room(me, 'group:' || p_event::text) then return; end if;
  return query
    select ri.id, p.handle, coalesce(p.display_name, p.handle), p.avatar,
           exists (select 1 from waves w where w.from_user = me and w.to_user = g.user_id),
           exists (select 1 from crew k where k.user_id = me and k.friend_id = g.user_id)
      from event_group_members g
      join profiles p on p.id = g.user_id
      cross join lateral identity_for(g.user_id, 'group:' || p_event::text, false) ri
     where g.event_id = p_event and g.status = 'joined' and g.user_id <> me
       and not is_blocked(me, g.user_id)
     order by g.joined_at
     limit 200;
end $$;

-- ------------------------------------------------- rooms close for good -----
-- Event rooms disappear from view three days after the event (message_visible
-- above). This deletes them for real: messages, the room names handed out, and
-- the paths of their pictures, which the caller then removes from Storage
-- (Postgres cannot delete Storage files itself).
-- Run daily by /api/cron/purge-rooms (see vercel.json).
drop function if exists public.purge_expired_rooms();
create function public.purge_expired_rooms()
returns table (path text)
language plpgsql security definer set search_path = public as $$
begin
  create temp table if not exists purge_closed (channel text primary key) on commit drop;
  truncate purge_closed;
  insert into purge_closed
    select e.id::text from events e
     where coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '3 days' < now()
       and exists (select 1 from messages m where m.channel = e.id::text
                   union all
                   select 1 from room_identities ri where ri.channel = e.id::text);

  return query
    with gone as (
      delete from messages m
       where m.channel in (select pc.channel from purge_closed pc)
          or m.channel like 'area:%'
      returning m.image_path)
    select g.image_path from gone g where g.image_path is not null;

  delete from room_identities ri where ri.channel in (select pc.channel from purge_closed pc);
end $$;
revoke all on function public.purge_expired_rooms() from public, anon, authenticated;
grant execute on function public.purge_expired_rooms() to service_role;

-- -------------------------------------------------------- crew move chats -----
-- Saying I'M IN to a crew move puts you in its chat with everyone else who's
-- in (in_room above); MAYBE or CAN'T GO takes you out. Like event group chats,
-- these stay. Messages live in messages, channel 'move:<move id>'.
create or replace function public.move_members(p_move uuid)
returns table (key uuid, handle text, name text, look jsonb, waved boolean, in_crew boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not in_room(me, 'move:' || p_move::text) then return; end if;
  return query
    select ri.id, p.handle, coalesce(p.display_name, p.handle), p.avatar,
           exists (select 1 from waves w where w.from_user = me and w.to_user = r.user_id),
           exists (select 1 from crew k where k.user_id = me and k.friend_id = r.user_id)
      from crew_move_rsvps r
      join profiles p on p.id = r.user_id
      cross join lateral identity_for(r.user_id, 'move:' || p_move::text, false) ri
     where r.move_id = p_move and r.status = 'going' and r.user_id <> me
       and not is_blocked(me, r.user_id)
     order by r.updated_at
     limit 200;
end $$;
