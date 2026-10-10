-- ============================================================================
-- Hoppaz: hotspots (the always-open rooms at the 13 junctions)
-- Run order: schema.sql, chat_accounts.sql, ... , hotspot_zones.sql, then THIS
-- FILE LAST. Safe to run again. Spec: docs/HOTSPOTS.md (sections 7 to 10, build
-- steps 1, 3, 4 and 6). The client contract is the API section at the end of
-- that file.
--
-- Why last: it replaces eleven of Ola's functions with the same body plus a hotspot
-- branch (in_room, room_closes_at, message_visible, stamp_message,
-- purge_expired_rooms, log_chat_activity, and guards in send_wave, add_to_crew,
-- block_person, my_blocks and unblock). Every branch starts with `like 'hotspot:%'`,
-- so no other channel, event room, group chat, crew move or DM behaves any
-- differently. It also changes the badges read policy (the Regular badges are
-- private) and adds a trigger on profile_private (an under 18 birthday is
-- remembered). If you ever run chat_accounts.sql or schema.sql again, run this
-- file again after it.
--
-- Who is where. A hotspot is `hotspots.status = 'active'` (the app says "open"),
-- 'planned' ("Opening soon") or 'paused' (staff switch). Wave 1 (Yaba, Lekki,
-- Victoria Island, Ikeja) is opened once, by this file; staff own the status
-- after that and a run again never changes it.
--
-- The server never learns where a Hopper is. Nothing here takes a position or
-- stores one. "Your hotspot" is worked out on the phone from the public zone
-- shapes that hotspot_list() returns; entering needs no fix at all.
--
-- What it adds:
--   tables         hotspot_visits (who is in which room now), hotspot_days (which
--                  hotspot, which play-day, 30 days), hotspot_quota (entries a
--                  day), hotspot_mutes (staff and automatic mutes), hotspot_words
--                  (the staff word list), hotspot_blocks (who a Hopper blocked
--                  from a hotspot: kept apart from the global blocks so a block
--                  cannot link an alias to a person). All have RLS on and nothing
--                  granted: only the functions below read or write them.
--   Hopper calls   hotspot_list (anyone), confirm_adult, enter_hotspot,
--                  leave_hotspot, hotspot_pulse, hotspot_room, my_hotspot,
--                  claim_hotspot_daily, report_hotspot (signed in). Messages go
--                  through the messages table as in every room.
--   staff calls    admin_hotspot_* (service role only): status, slow mode, mute,
--                  unmute, reports, clear, words.
--   internal       hotspot_leave_for (Play mode's spot trips call it so one avatar
--                  is in one place), purge_hotspot_data (hourly, pg_cron).
--
-- Rules, all in hotspot_rules() and chat_rate_limit():
--   chat      text only, 240 characters, at most 5 in 30 s and 40 an hour (counted
--             under a per-Hopper lock, so parallel posts cannot slip past), the same
--             text twice inside 60 s is refused, no link, email, phone number or
--             @name (the text is normalised first: lookalike letters, zero-width
--             characters, separators and spelled-out digits do not hide anything),
--             a staff word list, slow mode 00:00 to 05:00 Lagos (one message every
--             10 s). Visible for 24 hours and only to people in the room. Kept 7
--             days. The author shows as an alias with no look, never the handle.
--   who       an account (has_account) and a one-time "I'm 18 or older". A Hopper
--             whose birthday says under 18 can neither confirm nor enter.
--   presence  one avatar, one place. A head fades 10 to 20 minutes (random) after
--             the last ping, so nobody can read the moment someone left.
--   daily     10 XP once a play-day (06:00 to 06:00 Lagos) after a 5 minute stay;
--             a "Regular at <place>" badge after 4 stays in 30 days.
-- ============================================================================

-- --------------------------------------------------------- hotspots columns ---
-- slow_seconds, slow_from, slow_to: slow mode (one message per Hopper every
-- slow_seconds between the two clock times, Lagos). 0 switches it off.
-- max_here: the soft cap on avatars in the room. opened_at: set the first time a
-- zone is opened, so a run again never re-opens one staff paused.
alter table public.hotspots add column if not exists slow_seconds integer not null default 10 check (slow_seconds between 0 and 120);
alter table public.hotspots add column if not exists slow_from time not null default '00:00';
alter table public.hotspots add column if not exists slow_to time not null default '05:00';
alter table public.hotspots add column if not exists max_here integer not null default 100 check (max_here between 1 and 1000);
alter table public.hotspots add column if not exists opened_at timestamptz;

-- Wave 1 opens now; the rest read "Opening soon" until staff open them.
update public.hotspots set status = 'active', opened_at = now()
 where wave = 1 and status = 'planned' and opened_at is null;

-- ------------------------------------------------------- other tables widened ---
-- The 18+ confirmation lives with the other private details. under_18_at is set the
-- first time a birthday under 18 is written (trigger below) and is never cleared by
-- a later birthday: a Hopper cannot say 2012, be refused, then say 1990.
alter table public.profile_private add column if not exists adult_confirmed_at timestamptz;
alter table public.profile_private add column if not exists under_18_at timestamptz;

-- A report can name a hotspot (kept after the message is deleted at 7 days) and
-- the alias it was made against.
alter table public.reports add column if not exists hotspot_id uuid references public.hotspots(id) on delete set null;
alter table public.reports add column if not exists alias text;
-- counts: the report cited a message by that alias from the last 24 hours, so it can add
-- to an automatic mute. A report on a bare head (or an old message) only goes to staff.
alter table public.reports add column if not exists counts boolean not null default false;
create index if not exists reports_hotspot_idx on public.reports (target, hotspot_id, created_at) where kind = 'hotspot';

-- reports.kind gets 'hotspot'. Whatever other kinds the live check allows are kept.
do $$
declare
  v_def  text;
  v_list text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.reports'::regclass and c.conname = 'reports_kind_check';

  if v_def like '%''hotspot''%' then return; end if;

  v_list := case
    when v_def is null then array['room', 'dm', 'person']
    else array(select m[1] from regexp_matches(v_def, '''([^'']+)''', 'g') as m)
  end || 'hotspot'::text;

  alter table public.reports drop constraint if exists reports_kind_check;
  execute format(
    'alter table public.reports add constraint reports_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(a), ', ') from unnest(v_list) as a)
  );
end $$;

-- Hotspot messages are pruned by age every day and every hour; this keeps that cheap.
create index if not exists messages_hotspot_age_idx on public.messages (created_at) where channel like 'hotspot:%';

-- A hotspot message carries no avatar look: profiles are readable by everyone, so a real
-- look would link an alias to a handle. Rows from before that rule are scrubbed.
update public.messages set author_look = null where channel like 'hotspot:%' and author_look is not null;

-- ------------------------------------------------------------------ tables ---
-- Where each Hopper's avatar is now. One row per Hopper: one place at a time.
-- No coordinates, ever. fades_at is random (10 to 20 minutes after the last
-- ping), so the moment someone left cannot be read from the heads.
create table if not exists public.hotspot_visits (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  hotspot_id uuid not null references public.hotspots(id) on delete cascade,
  key        uuid not null references public.room_identities(id) on delete cascade,
  entered_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  fades_at   timestamptz not null
);
create index if not exists hotspot_visits_room_idx on public.hotspot_visits (hotspot_id, fades_at);

-- Which hotspot, which play-day. Written when a Hopper first enters it that day
-- (the "today" count); stayed_at when they have been there 5 minutes; xp_paid on
-- the one row that paid the day's 10 XP. Deleted after 30 days. No coordinates.
create table if not exists public.hotspot_days (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  play_day   date not null,
  hotspot_id uuid not null references public.hotspots(id) on delete cascade,
  entered_at timestamptz not null default now(),
  stayed_at  timestamptz,
  xp_paid    integer not null default 0,
  primary key (user_id, play_day, hotspot_id)
);
create index if not exists hotspot_days_room_idx on public.hotspot_days (hotspot_id, play_day);

-- Entries today, for the 30 a day limit.
create table if not exists public.hotspot_quota (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  play_day date not null,
  entries  integer not null default 0
);

-- A mute stops posting, nothing else. hotspot_id null means every hotspot. auto is
-- true for the ones the reports made by themselves.
create table if not exists public.hotspot_mutes (
  id         uuid primary key default gen_random_uuid(),
  hotspot_id uuid references public.hotspots(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  key        uuid references public.room_identities(id) on delete set null,
  until      timestamptz not null,
  reason     text not null default '',
  auto       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists hotspot_mutes_user_idx on public.hotspot_mutes (user_id, until);

-- Who a Hopper blocked from a hotspot (the alias they saw there). Apart from the global
-- blocks on purpose: a global block hides the person in event rooms, waves and DMs, so
-- blocking an alias with it would make their handle vanish from those lists and link the
-- alias to a person. These blocks work in hotspots only, in both directions.
create table if not exists public.hotspot_blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker    uuid not null references public.profiles(id) on delete cascade,
  blocked    uuid not null references public.profiles(id) on delete cascade,
  label      text not null,
  created_at timestamptz not null default now(),
  unique (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists hotspot_blocks_blocked_idx on public.hotspot_blocks (blocked);

-- Words a hotspot message may not contain (whole words, lower case). Staff edit
-- it with admin_hotspot_word_add and _remove. The first list is contact and
-- scam words only; add anything else in the admin desk.
create table if not exists public.hotspot_words (
  word     text primary key check (word = lower(btrim(word)) and char_length(word) between 2 and 40),
  added_at timestamptz not null default now()
);
insert into public.hotspot_words (word)
select w from unnest(array['whatsapp', 'telegram', 'snapchat', 'instagram', 'insta', 'dm me', 'inbox me',
                           'cashapp', 'bitcoin', 'forex', 'giveaway', 'send money']) as w
where not exists (select 1 from public.hotspot_words);

do $$
declare t text;
begin
  foreach t in array array['hotspot_visits', 'hotspot_days', 'hotspot_quota', 'hotspot_mutes', 'hotspot_words', 'hotspot_blocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- no policies on purpose: nobody reads these tables, only the functions in this file

-- ----------------------------------------------------------------- helpers ---
-- The play-day (06:00 to 06:00 Lagos) a moment belongs to. Same rule as
-- lagos_play_day() in play.sql, repeated so this file needs nothing from it.
create or replace function public.hotspot_play_day(p_ts timestamptz default now())
returns date language sql stable set search_path = public as $$
  select ((p_ts at time zone 'Africa/Lagos') - interval '6 hours')::date;
$$;

-- The numbers, in one place. The clients show them; the functions use them.
create or replace function public.hotspot_rules()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'max_len', 240,            -- characters in a message
    'burst', 5, 'burst_s', 30, -- messages in that many seconds
    'per_hour', 40,
    'dup_s', 60,               -- the same text twice inside this is refused
    'visible_h', 24,           -- how long a message can be read
    'keep_days', 7,            -- how long it is kept
    'stay_s', 300,             -- the stay that earns the daily reward
    'daily_xp', 10,
    'regular_days', 4,         -- stays at one hotspot, within 30 days, for the badge
    'entries_per_day', 30,
    'fade_min_s', 600, 'fade_max_s', 1200);
$$;

-- Messages allowed per channel: how many in how many seconds, and how many an
-- hour (null: no hourly limit). 8 in 30 s is the default everywhere; stamp_message
-- keeps its own 8 for the old rooms and a hotspot reads its number here.
create or replace function public.chat_rate_limit(p_channel text)
returns table (burst integer, window_s integer, per_hour integer)
language sql immutable set search_path = public as $$
  select case when p_channel like 'hotspot:%' then 5 else 8 end,
         30,
         case when p_channel like 'hotspot:%' then 40 end;
$$;

-- Is slow mode on at this moment? The window is Lagos clock time and may cross
-- midnight (from later than to). from = to means never.
create or replace function public.hotspot_slow_now(p_from time, p_to time, p_ts timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select case
           when p_from = p_to then false
           when p_from < p_to then (p_ts at time zone 'Africa/Lagos')::time >= p_from and (p_ts at time zone 'Africa/Lagos')::time < p_to
           else (p_ts at time zone 'Africa/Lagos')::time >= p_from or (p_ts at time zone 'Africa/Lagos')::time < p_to
         end;
$$;

-- A count as the app may show it: never an exact number under 3.
create or replace function public.hotspot_band(p_n bigint)
returns text language sql immutable as $$
  select case when p_n <= 0 then 'quiet' when p_n < 3 then 'few' when p_n < 20 then 'some' when p_n < 60 then 'busy' else 'packed' end;
$$;

-- The room is named after the place: the junction without the road in brackets
-- ("Lekki Phase 1 (Admiralty Way)" is "Lekki Phase 1"). Falls back to the zone name.
create or replace function public.hotspot_place_name(p_junction text, p_name text)
returns text language sql immutable as $$
  select coalesce(nullif(btrim(regexp_replace(coalesce(p_junction, ''), '\s*\([^)]*\)\s*$', '')), ''), p_name);
$$;

-- Zero-width and other invisible characters. What is STORED loses the ones only used to
-- hide or spoof text (zero-width space, word joiner, soft hyphen, direction overrides,
-- blank fillers) and keeps the joiners and variation selectors that emoji and some
-- scripts need. What is CHECKED loses every one of them, so a message made of nothing
-- visible is empty and a word cannot hide behind them.
create or replace function public.hotspot_strip_invisible(p_text text, p_for_check boolean default false)
returns text language sql immutable set search_path = public as $$
  select case when p_for_check
           then regexp_replace(coalesce(p_text, ''),
                  '[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯⠀ㅤ︀-️﻿ﾠ￹-￻\U000E0000-\U000E01EF]', '', 'g')
           else regexp_replace(coalesce(p_text, ''),
                  '[­͏؜᠎​‪-‮⁠-⁤⁦-⁩⠀ㅤ﻿ﾠ]', '', 'g')
         end;
$$;

-- The text as the filters read it: compatibility forms undone (fullwidth and mathematical
-- letters, ligatures, odd spaces), accents and invisible characters removed, Cyrillic and
-- Greek lookalikes turned into Latin letters, other scripts' digits into 0 to 9, lower case.
create or replace function public.hotspot_fold(p_text text)
returns text language sql immutable set search_path = public as $$
  select lower(translate(
           regexp_replace(hotspot_strip_invisible(normalize(coalesce(p_text, ''), NFKD), true), '[̀-ͯ]', '', 'g'),
           E'\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0425\u0423\u0406\u0408\u0405\u0430\u0435\u0456\u0458\u043A\u043C\u043D\u043E\u0440\u0441\u0442\u0443\u0445\u0455\u0501\u0391\u0392\u0395\u0396\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A5\u03A7\u03B1\u03B5\u03B9\u03BA\u03BD\u03BF\u03C1\u03C4\u03C5\u03C7\u03F2\u0131\u0251\u0261\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9\u0966\u0967\u0968\u0969\u096A\u096B\u096C\u096D\u096E\u096F\u09E6\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE\u09EF\u0E50\u0E51\u0E52\u0E53\u0E54\u0E55\u0E56\u0E57\u0E58\u0E59',
           'ABEKMHOPCTXYIJSaeijkmhopctyxsdABEZHIKMNOPTYXaeikvoptuxciag01234567890123456789012345678901234567890123456789'));
$$;

-- null when the text is fine, 'no_links' for a link, an email address, an @name or a
-- phone number, 'blocked_word' for a word on the staff list or a "ig: name" style label.
-- Everything is checked on the folded text (above), so lookalike letters, zero-width
-- characters, accents and fullwidth forms change nothing. Numbers: seven digits with up to
-- three non-letters between each pair (spaces, dots, dashes, slashes, commas...), after
-- spelled-out digits ("zero eight one") are turned into digits. "dot" said in words counts
-- as a dot. Words: whole words as listed (a space in the list allows nothing or a few
-- separators, so "dm me" also catches "dmme"), the letters of a word split by one or two
-- separators each ("w.h.a.t.s.a.p.p"), and for single words of 7 letters or more a word
-- broken up by spaces or punctuation ("wha tsapp"; this also catches "give away").
create or replace function public.hotspot_text_problem(p_body text)
returns text language plpgsql stable set search_path = public as $$
declare
  t     text := hotspot_fold(p_body);
  d     text;
  n     text;
  tight text;
  w     record;
  wt    text;
  sep   text := '[^a-z0-9]';
  listed text;
begin
  -- "yabaparty dot com", "zero eight zero one two three four five six"
  d := regexp_replace(t, '\s*[(\[{<]?\s*\y(dot|d0t|punkt)\y\s*[)\]}>]?\s*', '.', 'g');
  d := regexp_replace(d, '\y(zero|nil|oh)\y', '0', 'g');
  d := regexp_replace(d, '\yone\y', '1', 'g');
  d := regexp_replace(d, '\ytwo\y', '2', 'g');
  d := regexp_replace(d, '\ythree\y', '3', 'g');
  d := regexp_replace(d, '\yfour\y', '4', 'g');
  d := regexp_replace(d, '\yfive\y', '5', 'g');
  d := regexp_replace(d, '\ysix\y', '6', 'g');
  d := regexp_replace(d, '\yseven\y', '7', 'g');
  d := regexp_replace(d, '\yeight\y', '8', 'g');
  d := regexp_replace(d, '\ynine\y', '9', 'g');

  if d ~ '(https?://|www\.|ftp://)'
     or d ~ '(^|[^a-z0-9])[a-z0-9][a-z0-9-]*\.(com|net|org|ng|co|io|me|ly|gl|be|app|xyz|link|info|biz|tv|gg|ws|cc|tk|shop|site|online|club|live|vip|ai|dev|bio)([^a-z0-9]|$)'
     or d ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
     or d ~ '(^|[^a-z0-9])@[a-z0-9_.]{3,}'
     or d ~ '[0-9]([^a-z0-9]{0,3}[0-9]){6,}' then
    return 'no_links';
  end if;

  -- a little leet speak undone, spaces squeezed, then the words
  n := regexp_replace(translate(t, '0134@$5', 'oieaass'), '\s+', ' ', 'g');
  tight := regexp_replace(n, sep, '', 'g');

  -- "ig: yabaparty", "snap = name": a platform label followed by a handle
  if n ~ ('(^|' || sep || ')(ig|insta|snap|sc|tg|tiktok)' || sep || '{0,2}[:=]' || sep || '{0,2}[a-z0-9_.]{2,}') then
    return 'blocked_word';
  end if;

  for w in select hw.word from hotspot_words hw loop
    wt := regexp_replace(hotspot_fold(w.word), sep, '', 'g');
    continue when wt = '';
    -- the word as listed; a space in the list allows nothing or a few separators
    listed := '(^|' || sep || ')'
      || (select string_agg(regexp_replace(u.part, '([^a-z0-9])', '\\\1', 'g'), sep || '{0,2}' order by u.i)
            from unnest(regexp_split_to_array(btrim(regexp_replace(hotspot_fold(w.word), '\s+', ' ', 'g')), ' ')) with ordinality as u(part, i))
      || '(' || sep || '|$)';
    if n ~ listed
       -- the same word with one or two separators between every letter
       or (char_length(wt) >= 4
           and n ~ ('(^|' || sep || ')' || array_to_string(regexp_split_to_array(wt, ''), sep || '{1,2}') || '(' || sep || '|$)'))
       -- one long word that only shows once the spaces and punctuation are taken out (a word
       -- that is there in one piece inside a longer one, like "instagrammer", is left alone)
       or (char_length(wt) >= 7 and position(' ' in btrim(w.word)) = 0 and position(wt in n) = 0 and position(wt in tight) > 0) then
      return 'blocked_word';
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.hotspot_text_problem(text), public.hotspot_fold(text), public.hotspot_strip_invisible(text, boolean) from public, anon, authenticated;
grant execute on function public.hotspot_text_problem(text), public.hotspot_fold(text), public.hotspot_strip_invisible(text, boolean) to service_role;

create or replace function public.hotspot_muted(p_user uuid, p_hotspot uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hotspot_mutes m
                  where m.user_id = p_user and m.until > now() and (m.hotspot_id is null or m.hotspot_id = p_hotspot));
$$;

-- Has either of these two blocked the other from a hotspot?
create or replace function public.hotspot_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hotspot_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
revoke all on function public.hotspot_blocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hotspot_blocked(uuid, uuid) to service_role;

-- 18 or over: confirmed once, the birthday (if we have one) agrees, and no birthday under
-- 18 was ever written (under_18_at stays even if the birthday is changed later).
create or replace function public.hotspot_adult_ok(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profile_private pp
                  where pp.user_id = p_user and pp.adult_confirmed_at is not null and pp.under_18_at is null
                    and (pp.birthday is null or pp.birthday <= ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date));
$$;

-- The first time a birthday under 18 is written, remember it. set_private_details writes the
-- birthday as often as the Hopper likes, so without this the answer could be changed after a
-- refusal. A write that leaves the column alone keeps the value; staff clear it by hand
-- (update profile_private set under_18_at = null) if a Hopper mistyped.
create or replace function public.profile_private_remember_minor()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.birthday is not null and new.under_18_at is null
     and new.birthday > ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date then
    new.under_18_at := now();
  end if;
  return new;
end $$;
drop trigger if exists profile_private_remember_minor on public.profile_private;
create trigger profile_private_remember_minor before insert or update on public.profile_private
  for each row execute function public.profile_private_remember_minor();
update public.profile_private set under_18_at = now()
 where under_18_at is null and birthday is not null
   and birthday > ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date;

revoke all on function public.hotspot_muted(uuid, uuid), public.hotspot_adult_ok(uuid) from public, anon, authenticated;
grant execute on function public.hotspot_muted(uuid, uuid), public.hotspot_adult_ok(uuid) to service_role;
revoke all on function public.hotspot_play_day(timestamptz), public.hotspot_slow_now(time, time, timestamptz),
  public.hotspot_band(bigint), public.hotspot_place_name(text, text), public.chat_rate_limit(text) from public, anon, authenticated;
grant execute on function public.hotspot_play_day(timestamptz), public.hotspot_slow_now(time, time, timestamptz),
  public.hotspot_band(bigint), public.hotspot_place_name(text, text), public.chat_rate_limit(text) to service_role;
revoke all on function public.hotspot_rules() from public, anon, authenticated;
grant execute on function public.hotspot_rules() to service_role;

-- One avatar, one place. Takes the Hopper out of whichever hotspot they are in.
-- Play mode's spot trip calls this when it starts (spot_visits and this table
-- never hold the same Hopper); enter_hotspot does the same the other way.
create or replace function public.hotspot_leave_for(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from hotspot_visits where user_id = p_user;
  return found;
end $$;
revoke all on function public.hotspot_leave_for(uuid) from public, anon, authenticated;
grant execute on function public.hotspot_leave_for(uuid) to service_role;

-- ---------------------------------------------------- Ola's functions, plus ---
-- Each is chat_accounts.sql's body with one hotspot branch marked "hotspot".

-- A hotspot: the Hopper's avatar is in it (a visit that has not faded) and the
-- hotspot is open. Paused or not open yet: nobody is in the room.
create or replace function public.in_room(p_user uuid, p_channel text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if p_channel like 'group:%' then
    return exists (select 1 from event_group_members
                    where user_id = p_user and event_id::text = substr(p_channel, 7) and status = 'joined');
  elsif p_channel like 'hotspot:%' then   -- hotspot
    return exists (select 1 from hotspot_visits v join hotspots h on h.id = v.hotspot_id
                    where v.user_id = p_user and v.hotspot_id::text = substr(p_channel, 9)
                      and v.fades_at > now() and h.status = 'active');
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

-- When a room closes for good. An event room: three days after the event ends.
-- A hotspot never closes by the clock; it is closed ('-infinity') only while it
-- is not open (paused, not open yet, or gone).
create or replace function public.room_closes_at(p_channel text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case
           when p_channel like 'hotspot:%' then   -- hotspot
             case when exists (select 1 from hotspots h where h.id::text = substr(p_channel, 9) and h.status = 'active')
                  then null else '-infinity'::timestamptz end
           else (select coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '3 days'
                   from events e where e.id::text = p_channel)
         end;
$$;

-- Who can read a message. A hotspot: only people in the room, only the last 24 hours, and
-- not an alias either side blocked from a hotspot. The global blocks are left out of a
-- hotspot on purpose (see hotspot_blocks): applying them would make an alias vanish when
-- its person is blocked somewhere else. Everything else as before.
create or replace function public.message_visible(p_channel text, p_key uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select case
           when p_channel like 'hotspot:%' then   -- hotspot
             p_at > now() - interval '24 hours' and in_room(auth.uid(), p_channel)
             and not exists (
                   select 1 from room_identities ri
                    where ri.id = p_key and auth.uid() is not null and hotspot_blocked(auth.uid(), ri.user_id))
           else
             (case
                when p_channel like 'area:%' then false
                when p_channel like 'group:%' or p_channel like 'move:%' then in_room(auth.uid(), p_channel)
                when exists (select 1 from events e where e.id::text = p_channel)
                  then room_closes_at(p_channel) > now() and in_room(auth.uid(), p_channel)
                else true
              end)
             and not exists (
                   select 1 from room_identities ri
                    where ri.id = p_key and auth.uid() is not null and is_blocked(auth.uid(), ri.user_id))
         end;
$$;

-- The hotspot rules for one message. Called by stamp_message for hotspot:<id>
-- channels only. Raises the same kind of one-word codes as the old rooms:
--   need_account  no account            need_adult   18+ not confirmed (or under 18)
--   room_closed   not open / paused     not_in_hotspot  avatar not in this room
--   muted         staff or reports      no_images    text only
--   empty / too_long                    no_links     link, email, @name or phone number
--   blocked_word  staff word list       duplicate    same text inside 60 s
--   slow_mode     night, one every 10 s slow_down    5 in 30 s or 40 an hour
create or replace function public.stamp_hotspot_message(m public.messages, me uuid)
returns public.messages language plpgsql security definer set search_path = public as $$
declare
  hs_id   uuid;
  h       hotspots;
  r       room_identities;
  lim     record;
  txt     text;
  problem text;
  n       int;
  last_at timestamptz;
begin
  if m.channel !~ '^hotspot:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'room_closed'; end if;
  -- One post at a time per Hopper. The limits below count committed rows, so without this
  -- lock a burst of parallel posts all see "nothing yet" and every one gets through.
  perform pg_advisory_xact_lock(hashtextextended('hotspot-post:' || me::text, 0));
  hs_id := substr(m.channel, 9)::uuid;
  if not has_account() then raise exception 'need_account'; end if;
  if not hotspot_adult_ok(me) then raise exception 'need_adult'; end if;
  select * into h from hotspots where id = hs_id;
  if not found or h.status <> 'active' then raise exception 'room_closed'; end if;
  if not in_room(me, m.channel) then raise exception 'not_in_hotspot'; end if;
  if hotspot_muted(me, hs_id) then raise exception 'muted'; end if;
  if m.image_path is not null then raise exception 'no_images'; end if;

  -- What is kept has the hiding characters taken out; a body with nothing left that shows is empty.
  txt := btrim(hotspot_strip_invisible(coalesce(m.body, '')));
  if regexp_replace(hotspot_fold(txt), '\s', '', 'g') = '' then raise exception 'empty'; end if;
  if char_length(txt) > (hotspot_rules() ->> 'max_len')::int then raise exception 'too_long'; end if;
  problem := hotspot_text_problem(txt);
  if problem is not null then raise exception '%', problem; end if;

  -- Always the hotspot alias, never the handle; the anon flag is ignored.
  r := identity_for(me, m.channel, false);

  if exists (select 1 from messages x
              where x.channel = m.channel and x.author_key = r.id
                and x.created_at > now() - make_interval(secs => (hotspot_rules() ->> 'dup_s')::int)
                and lower(btrim(x.body)) = lower(txt)) then
    raise exception 'duplicate';
  end if;
  if h.slow_seconds > 0 and hotspot_slow_now(h.slow_from, h.slow_to) then
    select max(x.created_at) into last_at from messages x where x.channel = m.channel and x.author_key = r.id;
    if last_at > now() - make_interval(secs => h.slow_seconds) then raise exception 'slow_mode'; end if;
  end if;
  select * into lim from chat_rate_limit(m.channel);
  select count(*) into n from messages x
   where x.channel = m.channel and x.author_key = r.id and x.created_at > now() - make_interval(secs => lim.window_s);
  if n >= lim.burst then raise exception 'slow_down'; end if;
  if lim.per_hour is not null then
    select count(*) into n from messages x
     where x.channel = m.channel and x.author_key = r.id and x.created_at > now() - interval '1 hour';
    if n >= lim.per_hour then raise exception 'slow_down'; end if;
  end if;

  m.body          := txt;
  m.anon          := false;
  m.author_key    := r.id;
  m.author_handle := null;
  m.author_name   := r.alias;
  m.author_look   := null;   -- the real avatar would give the person away (profiles are readable by all)
  m.created_at    := now();
  -- Talking keeps the avatar in the room.
  update hotspot_visits set last_seen = now(), fades_at = now() + make_interval(secs => 600 + random() * 600)
   where user_id = me and hotspot_id = hs_id;
  return m;
end $$;
revoke all on function public.stamp_hotspot_message(public.messages, uuid) from public, anon, authenticated;
grant execute on function public.stamp_hotspot_message(public.messages, uuid) to service_role;

-- Same as chat_accounts.sql, plus: a hotspot message goes to stamp_hotspot_message.
create or replace function public.stamp_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r  room_identities;
  p  profiles;
  n  int;
begin
  if me is null then raise exception 'no_session'; end if;
  if new.channel like 'hotspot:%' then return public.stamp_hotspot_message(new, me); end if;   -- hotspot
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

-- Posting in a room counts as an active day (activity_log, 'post'). Chat in a
-- hotspot does not: it is not a night out, and the daily reward says "not a
-- streak day". Same as schema.sql otherwise.
create or replace function public.log_chat_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if new.channel like 'hotspot:%' then return new; end if;   -- hotspot
  select user_id into who from room_identities where id = new.author_key;
  if who is not null then insert into activity_log(user_id, action, source_id, outside_score) values(who, 'post', new.id, (select score from game_score_rules where key = 'post')) on conflict do nothing; end if;
  return new;
end $$;

-- Waving at a hotspot head waits for Play mode Phase 5 (the first wave would show
-- the sender's handle). Until then a hotspot key answers not_met. Same as
-- chat_accounts.sql otherwise.
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
  if ch like 'hotspot:%' then return 'not_met'; end if;   -- hotspot
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

-- Adding a hotspot head to your crew would put the real profile behind the alias in your crew
-- list (crew reads profiles, and profiles are readable by everyone). Until Phase 5 has a
-- mutual reveal, a hotspot key answers not_met, like send_wave. Same as chat_accounts.sql
-- otherwise. Returns: added | already | self | gone | blocked | not_met | no_session | need_account
create or replace function public.add_to_crew(p_key uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them uuid; ch text;
begin
  if me is null then return 'no_session'; end if;
  if not has_account() then return 'need_account'; end if;
  select user_id, channel into them, ch from room_identities where id = p_key;
  if them is null then return 'gone'; end if;
  if ch like 'hotspot:%' then return 'not_met'; end if;   -- hotspot
  if them = me then return 'self'; end if;
  if is_blocked(me, them) then return 'blocked'; end if;
  insert into crew (user_id, friend_id) values (me, them) on conflict do nothing;
  if not found then return 'already'; end if;
  return 'added';
end $$;

-- Blocking a hotspot alias is a hotspot block (hotspot_blocks), not a global one: a global
-- block also hides the person in event rooms, waves and DMs, which would show who the alias
-- is. Same as schema.sql otherwise.
create or replace function public.block_person(p_key uuid default null, p_dm uuid default null, p_label text default 'A Hopper')
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them uuid; ch text; al text;
begin
  if me is null then return false; end if;
  if p_key is not null then select user_id, channel, alias into them, ch, al from room_identities where id = p_key; end if;
  if p_dm is not null then
    select case when a = me then b else a end into them from dms where id = p_dm and me in (a, b);
    ch := null;
  end if;
  if them is null or them = me then return false; end if;
  if ch like 'hotspot:%' then   -- hotspot
    insert into hotspot_blocks (blocker, blocked, label) values (me, them, left(coalesce(al, 'A Hopper'), 60))
    on conflict (blocker, blocked) do nothing;
    return true;
  end if;
  insert into blocks (blocker, blocked, label) values (me, them, left(coalesce(p_label, 'A Hopper'), 60))
  on conflict (blocker, blocked) do nothing;
  update waves set status = 'declined', responded_at = now()
   where status = 'pending' and ((from_user = me and to_user = them) or (from_user = them and to_user = me));
  return true;
end $$;

-- The blocks you can lift: the global ones and the hotspot ones, newest first.
create or replace function public.my_blocks()
returns table (id uuid, label text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.id, x.label, x.created_at
    from (select b.id, b.label, b.created_at from blocks b where b.blocker = auth.uid()
          union all
          select hb.id, hb.label, hb.created_at from hotspot_blocks hb where hb.blocker = auth.uid()) x
   order by x.created_at desc;
$$;

create or replace function public.unblock(p_block uuid)
returns void language sql security definer set search_path = public as $$
  delete from blocks where id = p_block and blocker = auth.uid();
  delete from hotspot_blocks where id = p_block and blocker = auth.uid();
$$;

-- The Regular badges say which named account hangs out at which junction, so only their owner
-- reads them (the policy in schema.sql let everyone read every badge).
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select
  using (key not like 'regular-%' or user_id = auth.uid());

-- Housekeeping for hotspots, run hourly (pg_cron below) and by purge_expired_rooms:
-- messages over 7 days, visits that faded over an hour ago, day rows over 30 days,
-- old quota rows, mutes that ended over 30 days ago. Reports are not touched: they
-- keep their own excerpt.
create or replace function public.purge_hotspot_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare m int; v int; d int; u int; q int;
begin
  delete from messages where channel like 'hotspot:%' and created_at < now() - interval '7 days';
  get diagnostics m = row_count;
  delete from hotspot_visits where fades_at < now() - interval '1 hour';
  get diagnostics v = row_count;
  delete from hotspot_days where play_day < hotspot_play_day() - 30;
  get diagnostics d = row_count;
  delete from hotspot_mutes where until < now() - interval '30 days';
  get diagnostics u = row_count;
  delete from hotspot_quota where play_day < hotspot_play_day() - 2;
  get diagnostics q = row_count;
  return jsonb_build_object('messages', m, 'visits', v, 'days', d, 'mutes', u, 'quota', q);
end $$;
revoke all on function public.purge_hotspot_data() from public, anon, authenticated;
grant execute on function public.purge_hotspot_data() to service_role;

-- Same as chat_accounts.sql, plus: hotspot messages over 7 days go too, and the
-- hotspot housekeeping runs. Returns the picture paths to remove from Storage.
create or replace function public.purge_expired_rooms()
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
          or (m.channel like 'hotspot:%' and m.created_at < now() - interval '7 days')   -- hotspot
      returning m.image_path)
    select g.image_path from gone g where g.image_path is not null;

  delete from room_identities ri where ri.channel in (select pc.channel from purge_closed pc);
  perform public.purge_hotspot_data();   -- hotspot
end $$;
revoke all on function public.purge_expired_rooms() from public, anon, authenticated;
grant execute on function public.purge_expired_rooms() to service_role;

-- ------------------------------------------------------------ the public list ---
-- The hotspots, for anyone (signed in or not). The phone works out "your hotspot"
-- from zone_geojson (a point-in-polygon test with its own fix) and the distances
-- from lat and lng; the server never sees where the Hopper is. The shapes are
-- simplified to about 40 m, keeping the source's 5 decimals (rounding further
-- can make a thin zone cross itself). Paused rows are
-- returned so the phone can hide them and still pick "the nearest open one".
-- status: open | planned | paused. here_n / today_n are null under 3.
create or replace function public.hotspot_list()
returns table (
  id uuid, slug text, name text, zone_name text, zone_label text, side text, junction text, road_a text, road_b text,
  lat double precision, lng double precision, wave integer, status text, zone_geojson jsonb,
  here_band text, here_n integer, today_band text, today_n integer
)
language sql stable security definer set search_path = public as $$
  select h.id, h.slug, hotspot_place_name(h.junction, h.name), h.name, h.zone_label, h.side, h.junction, h.road_a, h.road_b,
         h.lat, h.lng, h.wave,
         case h.status when 'active' then 'open' else h.status end,
         st_asgeojson(st_simplifypreservetopology(h.zone_geom, 0.0004), 5)::jsonb,
         hotspot_band(x.here), case when x.here >= 3 then x.here::integer end,
         hotspot_band(x.today), case when x.today >= 3 then x.today::integer end
    from hotspots h
    cross join lateral (
      select case when h.status = 'active'
                  then (select count(*) from hotspot_visits v where v.hotspot_id = h.id and v.fades_at > now())
                  else 0 end as here,
             (select count(*) from hotspot_days d where d.hotspot_id = h.id and d.play_day = hotspot_play_day()) as today
    ) x
   where h.status in ('active', 'planned', 'paused')
   order by h.wave, h.name;
$$;
revoke all on function public.hotspot_list() from public;
grant execute on function public.hotspot_list() to anon, authenticated;

-- --------------------------------------------------------------- 18 or over ---
-- "I'm 18 or older", once. Needs an account. A Hopper whose birthday says under 18
-- is refused. Returns {ok:true, already} or {ok:false, reason}:
-- no_session, need_account, under_18.
create or replace function public.confirm_adult()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pp profile_private;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  select * into pp from profile_private where user_id = me;
  if found and (pp.under_18_at is not null
                or (pp.birthday is not null and pp.birthday > ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date)) then
    return jsonb_build_object('ok', false, 'reason', 'under_18');
  end if;
  if found and pp.adult_confirmed_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into profile_private (user_id, adult_confirmed_at) values (me, now())
  on conflict (user_id) do update set adult_confirmed_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'already', false);
end $$;
revoke all on function public.confirm_adult() from public, anon;
grant execute on function public.confirm_adult() to authenticated;

-- ------------------------------------------------------------ enter and leave ---
-- Put the avatar in a room. No position is sent or read. Enter again while the
-- visit is alive to refresh it. Returns {ok:true, ...} or {ok:false, reason}:
-- no_session, need_account, need_adult, not_found, not_open (planned), paused,
-- full (max_here avatars), slow_down (30 entries today).
create or replace function public.enter_hotspot(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  h     hotspots;
  r     room_identities;
  v     hotspot_visits;
  day   date := hotspot_play_day();
  fresh boolean;
  q     hotspot_quota;
  here  int;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if not hotspot_adult_ok(me) then return jsonb_build_object('ok', false, 'reason', 'need_adult'); end if;
  select * into h from hotspots where slug = lower(btrim(coalesce(p_slug, ''))) and status in ('active', 'planned', 'paused');
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if h.status = 'planned' then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if h.status = 'paused' then return jsonb_build_object('ok', false, 'reason', 'paused'); end if;

  -- one entry at a time per room (the cap) and per Hopper (the daily limit)
  perform pg_advisory_xact_lock(hashtextextended('hotspot:' || h.id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('hotspot-user:' || me::text, 0));

  select * into v from hotspot_visits where user_id = me;
  fresh := not found or v.hotspot_id <> h.id or v.fades_at <= now();
  if fresh then
    select count(*) into here from hotspot_visits where hotspot_id = h.id and fades_at > now() and user_id <> me;
    if here >= h.max_here then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
    select * into q from hotspot_quota where user_id = me;
    if found and q.play_day = day and q.entries >= (hotspot_rules() ->> 'entries_per_day')::int then
      return jsonb_build_object('ok', false, 'reason', 'slow_down');
    end if;
    insert into hotspot_quota (user_id, play_day, entries) values (me, day, 1)
    on conflict (user_id) do update
      set play_day = day, entries = case when hotspot_quota.play_day = day then hotspot_quota.entries + 1 else 1 end;
    -- one avatar, one place: out of any spot room too (Play mode's spot_visits, once it exists)
    if to_regclass('public.spot_visits') is not null then
      execute 'delete from public.spot_visits where user_id = $1' using me;
    end if;
  end if;

  r := identity_for(me, 'hotspot:' || h.id::text, false);
  insert into hotspot_visits (user_id, hotspot_id, key, entered_at, last_seen, fades_at)
  values (me, h.id, r.id, now(), now(), now() + make_interval(secs => 600 + random() * 600))
  on conflict (user_id) do update
    set hotspot_id = excluded.hotspot_id, key = excluded.key,
        entered_at = case when fresh then now() else hotspot_visits.entered_at end,
        last_seen = now(), fades_at = excluded.fades_at;
  insert into hotspot_days (user_id, play_day, hotspot_id) values (me, day, h.id) on conflict do nothing;

  return jsonb_build_object(
    'ok', true, 'already_here', not fresh,
    'hotspot', jsonb_build_object('id', h.id, 'slug', h.slug, 'name', hotspot_place_name(h.junction, h.name), 'zone_name', h.name),
    'channel', 'hotspot:' || h.id::text, 'key', r.id, 'alias', r.alias,
    'here_band', hotspot_band((select count(*) from hotspot_visits where hotspot_id = h.id and fades_at > now())),
    'slow', jsonb_build_object('on_now', h.slow_seconds > 0 and hotspot_slow_now(h.slow_from, h.slow_to),
                               'seconds', h.slow_seconds, 'from', left(h.slow_from::text, 5), 'to', left(h.slow_to::text, 5)),
    'rules', hotspot_rules());
end $$;
revoke all on function public.enter_hotspot(text) from public, anon;
grant execute on function public.enter_hotspot(text) to authenticated;

-- Take the avatar out. Always {ok:true, left:boolean}; {ok:false, reason:'no_session'}.
create or replace function public.leave_hotspot()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  return jsonb_build_object('ok', true, 'left', hotspot_leave_for(auth.uid()));
end $$;
revoke all on function public.leave_hotspot() from public, anon;
grant execute on function public.leave_hotspot() to authenticated;

-- Keep the avatar in the room. The app calls it about every 30 s while the room is
-- open. {ok:true, slug, here_band, here_n} or {ok:false, reason}: no_session,
-- not_in_hotspot (the visit faded or was never made: enter again), paused.
create or replace function public.hotspot_pulse()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v hotspot_visits; h hotspots; here bigint;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into v from hotspot_visits where user_id = me;
  if not found or v.fades_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_in_hotspot'); end if;
  select * into h from hotspots where id = v.hotspot_id;
  if h.status <> 'active' then
    delete from hotspot_visits where user_id = me;
    return jsonb_build_object('ok', false, 'reason', case when h.status = 'paused' then 'paused' else 'not_in_hotspot' end);
  end if;
  update hotspot_visits set last_seen = now(), fades_at = now() + make_interval(secs => 600 + random() * 600)
   where user_id = me and last_seen < now() - interval '5 seconds';
  select count(*) into here from hotspot_visits where hotspot_id = h.id and fades_at > now();
  return jsonb_build_object('ok', true, 'slug', h.slug, 'here_band', hotspot_band(here), 'here_n', case when here >= 3 then here end);
end $$;
revoke all on function public.hotspot_pulse() from public, anon;
grant execute on function public.hotspot_pulse() to authenticated;

-- The room, for someone in it: the heads (key, alias, look: no real name, no
-- handle, no position, no times; look is always null, so the app draws the alias face),
-- the counts and the night rule. Ordered by a hash of the key, the same for everyone:
-- nothing about who you know (crew, waves) reaches the list, because a one-sided crew
-- row or a wave would tell you which alias a known person is using. Hotspot blocks leave
-- the head out. Needs the avatar in the room: {ok:false, reason} no_session, not_found,
-- not_in_hotspot.
create or replace function public.hotspot_room(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  h     hotspots;
  mine  room_identities;
  heads jsonb;
  here  bigint;
  today bigint;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into h from hotspots where slug = lower(btrim(coalesce(p_slug, ''))) and status in ('active', 'planned', 'paused');
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not in_room(me, 'hotspot:' || h.id::text) then return jsonb_build_object('ok', false, 'reason', 'not_in_hotspot'); end if;
  select * into mine from room_identities where user_id = me and channel = 'hotspot:' || h.id::text and not anon;

  select coalesce(jsonb_agg(jsonb_build_object('key', y.key, 'alias', y.alias, 'look', null::text) order by y.rn), '[]'::jsonb)
    into heads
    from (
      select v.key, ri.alias, row_number() over (order by md5(v.key::text)) as rn
        from hotspot_visits v
        join room_identities ri on ri.id = v.key
       where v.hotspot_id = h.id and v.fades_at > now() and v.user_id <> me and not hotspot_blocked(me, v.user_id)
    ) y
   where y.rn <= 100;

  select count(*) into here from hotspot_visits where hotspot_id = h.id and fades_at > now();
  select count(*) into today from hotspot_days where hotspot_id = h.id and play_day = hotspot_play_day();
  return jsonb_build_object(
    'ok', true, 'slug', h.slug, 'name', hotspot_place_name(h.junction, h.name), 'channel', 'hotspot:' || h.id::text,
    'you', jsonb_build_object('key', mine.id, 'alias', mine.alias),
    'heads', heads,
    'here_band', hotspot_band(here), 'here_n', case when here >= 3 then here end,
    'today_band', hotspot_band(today), 'today_n', case when today >= 3 then today end,
    'slow', jsonb_build_object('on_now', h.slow_seconds > 0 and hotspot_slow_now(h.slow_from, h.slow_to),
                               'seconds', h.slow_seconds, 'from', left(h.slow_from::text, 5), 'to', left(h.slow_to::text, 5)));
end $$;
revoke all on function public.hotspot_room(text) from public, anon;
grant execute on function public.hotspot_room(text) to authenticated;

-- Where is my avatar, and what is left to do before I can enter? For when the app
-- opens. {ok:true, has_account, adult, in: null | {slug, name, channel, key, alias, entered_at}}.
create or replace function public.my_hotspot()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v record;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select h.slug, hotspot_place_name(h.junction, h.name) as name, h.id, vi.key, ri.alias, vi.entered_at into v
    from hotspot_visits vi join hotspots h on h.id = vi.hotspot_id join room_identities ri on ri.id = vi.key
   where vi.user_id = me and vi.fades_at > now() and h.status = 'active';
  return jsonb_build_object('ok', true, 'has_account', has_account(), 'adult', hotspot_adult_ok(me),
    'in', case when v.slug is null then null
               else jsonb_build_object('slug', v.slug, 'name', v.name, 'channel', 'hotspot:' || v.id::text,
                                       'key', v.key, 'alias', v.alias, 'entered_at', v.entered_at) end);
end $$;
revoke all on function public.my_hotspot() from public, anon;
grant execute on function public.my_hotspot() to authenticated;

-- ---------------------------------------------------------- the daily reward ---
-- After 5 minutes in a hotspot: 10 XP, once a play-day, wherever you are (hopping
-- between hotspots pays nothing extra). Every 5 minute stay is also counted for
-- the badge: 4 stays at one hotspot in 30 days earns "Regular at <place>". Not a
-- streak day and not part of the Outside Score, so nothing goes to activity_log.
-- {ok:true, xp (10 or 0), already, days_here, badge: null | {key, name}} or
-- {ok:false, reason}: no_session, need_account, not_in_hotspot, too_early (wait_s).
create or replace function public.claim_hotspot_daily()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  v      hotspot_visits;
  h      hotspots;
  day    date := hotspot_play_day();
  place  text;
  paid   boolean;
  v_xp   int := 0;
  stays  int;
  bkey   text;
  badge  jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  perform pg_advisory_xact_lock(hashtextextended('hotspot-claim:' || me::text, 0));
  select * into v from hotspot_visits where user_id = me;
  if not found or v.fades_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_in_hotspot'); end if;
  select * into h from hotspots where id = v.hotspot_id;
  if h.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_in_hotspot'); end if;
  if v.entered_at > now() - make_interval(secs => (hotspot_rules() ->> 'stay_s')::int) then
    return jsonb_build_object('ok', false, 'reason', 'too_early',
      'wait_s', ceil(extract(epoch from v.entered_at + make_interval(secs => (hotspot_rules() ->> 'stay_s')::int) - now()))::int);
  end if;
  place := hotspot_place_name(h.junction, h.name);

  insert into hotspot_days (user_id, play_day, hotspot_id) values (me, day, h.id) on conflict do nothing;
  update hotspot_days set stayed_at = coalesce(stayed_at, now()) where user_id = me and play_day = day and hotspot_id = h.id;

  paid := exists (select 1 from hotspot_days where user_id = me and play_day = day and xp_paid > 0);
  if not paid then
    v_xp := (hotspot_rules() ->> 'daily_xp')::int;
    update hotspot_days set xp_paid = v_xp where user_id = me and play_day = day and hotspot_id = h.id;
    update profiles set xp = xp + v_xp where id = me;
  end if;

  select count(*) into stays from hotspot_days
   where user_id = me and hotspot_id = h.id and stayed_at is not null and play_day > day - 30;
  if stays >= (hotspot_rules() ->> 'regular_days')::int then
    bkey := 'regular-' || h.slug;
    if not exists (select 1 from badges where user_id = me and key = bkey) then
      insert into badge_catalog (key, name, description)
      values (bkey, 'Regular at ' || place, 'Four days at ' || place || ' in a month.')
      on conflict (key) do update set name = excluded.name, description = excluded.description;
      perform award_badge(me, bkey);
      badge := jsonb_build_object('key', bkey, 'name', 'Regular at ' || place);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'xp', v_xp, 'already', not (v_xp > 0), 'days_here', stays, 'badge', badge);
end $$;
revoke all on function public.claim_hotspot_daily() from public, anon;
grant execute on function public.claim_hotspot_daily() to authenticated;

-- ------------------------------------------------------------------ reports ---
-- Report a message or a head (p_ref is a message id or a head's key) in a room you
-- are in. Goes to the reports queue in the admin desk as kind 'hotspot', with a
-- 400 character excerpt that outlives the message. 3 different people reporting one
-- alias in 24 hours mutes it in that hotspot for an hour; 6 mutes it in every
-- hotspot for 12 hours; staff can lift or lengthen either. Nothing is deleted.
-- Only a report that cites a message by that alias from the last 24 hours counts toward
-- those mutes (reports.counts): a report on a bare head only goes to staff, so a few
-- throwaway accounts cannot silence someone who has not said anything.
-- {ok:true} or {ok:false, reason}: no_session, bad_reason, gone, not_in_hotspot,
-- self, slow_down (20 reports a day), already (same alias, same hotspot, 24 hours).
create or replace function public.report_hotspot(p_ref uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  ch    text;
  k     uuid;
  ex    text;
  fresh boolean := false;
  them  uuid;
  a     text;
  hs    uuid;
  place text;
  why   text := left(btrim(coalesce(p_reason, '')), 300);
  n     int;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if why = '' then return jsonb_build_object('ok', false, 'reason', 'bad_reason'); end if;
  select m.channel, m.author_key, m.body, m.created_at > now() - interval '24 hours' into ch, k, ex, fresh
    from messages m where m.id = p_ref and m.channel like 'hotspot:%';
  if not found then
    fresh := false;
    select ri.channel, ri.id into ch, k from room_identities ri where ri.id = p_ref and ri.channel like 'hotspot:%';
  end if;
  if ch is null or k is null then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if not in_room(me, ch) then return jsonb_build_object('ok', false, 'reason', 'not_in_hotspot'); end if;
  select ri.user_id, ri.alias into them, a from room_identities ri where ri.id = k;
  if them is null then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if them = me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  hs := substr(ch, 9)::uuid;
  select hotspot_place_name(h.junction, h.name) into place from hotspots h where h.id = hs;

  select count(*) into n from reports where reporter = me and created_at > now() - interval '1 day';
  if n >= 20 then return jsonb_build_object('ok', false, 'reason', 'slow_down'); end if;
  if exists (select 1 from reports where reporter = me and target = them and kind = 'hotspot'
                and hotspot_id = hs and created_at > now() - interval '1 day') then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  insert into reports (reporter, target, kind, ref_id, excerpt, reason, hotspot_id, alias, counts)
  values (me, them, 'hotspot', p_ref, left(coalesce(place, '') || ' / ' || a || case when ex is not null then ': ' || ex else '' end, 400), why, hs, a, coalesce(fresh, false));

  select count(distinct reporter) into n from reports
   where kind = 'hotspot' and target = them and hotspot_id = hs and counts and created_at > now() - interval '1 day';
  if n >= 3 and not exists (select 1 from hotspot_mutes where user_id = them and hotspot_id = hs and auto and until > now()) then
    insert into hotspot_mutes (hotspot_id, user_id, key, until, reason, auto)
    values (hs, them, k, now() + interval '1 hour', 'Reported by ' || n || ' people', true);
  end if;
  select count(distinct reporter) into n from reports
   where kind = 'hotspot' and target = them and counts and created_at > now() - interval '1 day';
  if n >= 6 and not exists (select 1 from hotspot_mutes where user_id = them and hotspot_id is null and auto and until > now()) then
    insert into hotspot_mutes (hotspot_id, user_id, key, until, reason, auto)
    values (null, them, k, now() + interval '12 hours', 'Reported by ' || n || ' people', true);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.report_hotspot(uuid, text) from public, anon;
grant execute on function public.report_hotspot(uuid, text) to authenticated;

-- ------------------------------------------------------------------- staff ---
-- Service role only (the admin desk). None of these show a user id: staff work
-- with slugs, report ids, mute ids and the alias keys the reports list gives.

-- Open, plan or pause a hotspot ('open', 'planned', 'paused'). Anything but open
-- sends everyone out of the room at once. Split zones are not touched.
create or replace function public.admin_hotspot_set_status(p_slug text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s text; hid uuid;
begin
  s := case lower(coalesce(p_status, '')) when 'open' then 'active' when 'planned' then 'planned' when 'paused' then 'paused' end;
  if s is null then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  update hotspots set status = s, opened_at = case when s = 'active' then coalesce(opened_at, now()) else opened_at end
   where slug = p_slug and status in ('active', 'planned', 'paused') returning id into hid;
  if hid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s <> 'active' then delete from hotspot_visits where hotspot_id = hid; end if;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'status', lower(p_status));
end $$;

-- Slow mode: one message per Hopper every p_seconds (0 to 120; 0 is off) between
-- two Lagos clock times (null keeps what is set; same time twice is never).
create or replace function public.admin_hotspot_set_slow(p_slug text, p_seconds integer, p_from time default null, p_to time default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_seconds is null or p_seconds not between 0 and 120 then return jsonb_build_object('ok', false, 'reason', 'bad_seconds'); end if;
  update hotspots set slow_seconds = p_seconds, slow_from = coalesce(p_from, slow_from), slow_to = coalesce(p_to, slow_to)
   where slug = p_slug and status in ('active', 'planned', 'paused');
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Mute an alias (p_key, from a report or a head) for p_hours, in one hotspot or, with
-- p_hotspot null, in all of them. It stops posting only.
create or replace function public.admin_hotspot_mute(p_hotspot uuid, p_key uuid, p_hours numeric, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; mid uuid;
begin
  if p_hours is null or p_hours < 0.01 or p_hours > 24 * 365 then return jsonb_build_object('ok', false, 'reason', 'bad_hours'); end if;
  select ri.user_id into u from room_identities ri where ri.id = p_key and ri.channel like 'hotspot:%';
  if u is null then return jsonb_build_object('ok', false, 'reason', 'not_a_hotspot_alias'); end if;
  if p_hotspot is not null and not exists (select 1 from hotspots where id = p_hotspot) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  insert into hotspot_mutes (hotspot_id, user_id, key, until, reason, auto)
  values (p_hotspot, u, p_key, now() + make_interval(secs => p_hours * 3600), left(coalesce(p_reason, ''), 300), false)
  returning hotspot_mutes.id into mid;
  return jsonb_build_object('ok', true, 'mute', mid);
end $$;

-- Lift a mute (staff or automatic).
create or replace function public.admin_hotspot_unmute(p_mute uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from hotspot_mutes where id = p_mute;
  return jsonb_build_object('ok', found);
end $$;

-- The mutes in force (or all of them): which hotspot (null slug is all), the alias, until when.
create or replace function public.admin_hotspot_mutes(p_active_only boolean default true)
returns table (id uuid, hotspot_slug text, alias text, key uuid, until timestamptz, auto boolean, reason text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, h.slug, ri.alias, m.key, m.until, m.auto, m.reason, m.created_at
    from hotspot_mutes m
    left join hotspots h on h.id = m.hotspot_id
    left join room_identities ri on ri.id = m.key
   where not p_active_only or m.until > now()
   order by m.created_at desc;
$$;

-- Open (or all) reports on hotspot messages and heads, newest first. key is the alias
-- key to hand to admin_hotspot_mute; reporters_24h is how many different people
-- reported a message by that alias in that hotspot in the last day (the ones that count
-- toward the automatic mute). Close one the usual way
-- (reports.reviewed_at, the CLOSE button).
create or replace function public.admin_hotspot_reports(p_open_only boolean default true, p_limit integer default 100)
returns table (id uuid, hotspot_slug text, alias text, key uuid, excerpt text, reason text, created_at timestamptz, reviewed_at timestamptz, reporters_24h integer)
language sql stable security definer set search_path = public as $$
  select r.id, h.slug, r.alias, ri.id, r.excerpt, r.reason, r.created_at, r.reviewed_at,
         (select count(distinct x.reporter)::integer from reports x
           where x.kind = 'hotspot' and x.target = r.target and x.hotspot_id = r.hotspot_id and x.counts and x.created_at > now() - interval '1 day')
    from reports r
    left join hotspots h on h.id = r.hotspot_id
    left join room_identities ri on ri.user_id = r.target and ri.channel = 'hotspot:' || r.hotspot_id::text and not ri.anon
   where r.kind = 'hotspot' and (not p_open_only or r.reviewed_at is null)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- Delete the last p_minutes of a hotspot's messages (1 to 1440). Returns how many.
create or replace function public.admin_hotspot_clear(p_slug text, p_minutes integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare hid uuid; n int;
begin
  if p_minutes is null or p_minutes not between 1 and 1440 then return jsonb_build_object('ok', false, 'reason', 'bad_minutes'); end if;
  select id into hid from hotspots where slug = p_slug;
  if hid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  delete from messages where channel = 'hotspot:' || hid::text and created_at > now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

-- The word list.
create or replace function public.admin_hotspot_word_add(p_word text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w text := lower(btrim(coalesce(p_word, '')));
begin
  if char_length(w) not between 2 and 40 then return jsonb_build_object('ok', false, 'reason', 'bad_word'); end if;
  insert into hotspot_words (word) values (w) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_hotspot_word_remove(p_word text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from hotspot_words where word = lower(btrim(coalesce(p_word, '')));
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.admin_hotspot_set_status(text, text), public.admin_hotspot_set_slow(text, integer, time, time),
  public.admin_hotspot_mute(uuid, uuid, numeric, text), public.admin_hotspot_unmute(uuid), public.admin_hotspot_mutes(boolean),
  public.admin_hotspot_reports(boolean, integer), public.admin_hotspot_clear(text, integer),
  public.admin_hotspot_word_add(text), public.admin_hotspot_word_remove(text) from public, anon, authenticated;
grant execute on function public.admin_hotspot_set_status(text, text), public.admin_hotspot_set_slow(text, integer, time, time),
  public.admin_hotspot_mute(uuid, uuid, numeric, text), public.admin_hotspot_unmute(uuid), public.admin_hotspot_mutes(boolean),
  public.admin_hotspot_reports(boolean, integer), public.admin_hotspot_clear(text, integer),
  public.admin_hotspot_word_add(text), public.admin_hotspot_word_remove(text) to service_role;

-- ------------------------------------------------------------- scheduler ---
-- Every hour at :20. Needs pg_cron; without it, purge_expired_rooms (the daily
-- /api/cron/purge-rooms) runs the same housekeeping once a day.
do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'hoppaz-purge-hotspots';
  perform cron.schedule('hoppaz-purge-hotspots', '20 * * * *', 'select public.purge_hotspot_data()');
exception when others then
  raise notice 'pg_cron not available: enable it in Supabase (Database, Extensions), then run this file again.';
end $cron$;
