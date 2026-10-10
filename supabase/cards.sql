-- ============================================================================
-- Hoppaz: the card deck (back end)
-- Run order: schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql,
-- spawn_points_lagos.sql, box_guards.sql, daily_box.sql, play.sql, then THIS FILE,
-- then cards_s1_seed.sql (the 125 cards of Season 1, made by
-- scripts/cards/seed-sql.mjs). Safe to run again. Plan: docs/CARDS.md. Jae's calls:
-- docs/DECISIONS.md. Tests: supabase/tests/cards_test.sql.
--
-- Cards are mainly places, Nomad List style. Every card is tagged to a point in
-- Lagos; standing there stamps it Visited. Cards are never for sale: there is no
-- price, no naira and no way to hand a card to someone else in this file.
--
-- Why after play.sql: the claim result gets a `card` key, and play.sql's
-- claim_game_drop and daily_box.sql's open_daily_box call grant_card() from here.
-- Both calls only run for a card prize, so they cost nothing before this file is
-- loaded. This file holds no copy of claim_game_drop. If you ever re-run schema.sql
-- or spawning.sql, run play.sql again (and daily_box.sql after schema.sql): they put
-- the card hook back. Nothing here needs to run again.
--
-- What it adds:
--   card_seasons      the seasons. One is live; boxes draw only from the live one.
--   card_sets         the sets (a council, a campus series, the city-wide series).
--   cards             the catalogue: set, division, rarity, point (geog, plus lat and
--                     lng for the client), radius, the copy cap, the three image
--                     paths, text. Anyone reads the live ones (RLS).
--   card_stock        per card: the pick weight and the copies issued so far (the
--                     season copy counter). Service role only.
--   user_cards        the copies a Hopper holds, one row per copy. copy_no ("7 of 100")
--                     is set for capped cards only. A Hopper reads only their own.
--   card_visits       Visited stamps: user, card, a play-day date, whether XP was
--                     paid. No coordinates, no times. A Hopper reads only their own.
--   card_pity         per Hopper: card claims since a Rare and since an Epic.
--   card_rules        the numbers staff tune: odds, XP, distance mix, pity, visit rules.
--   drop_rewards.card_tier   a prize of type 'card' says which tier it pays.
--   game_drops.card_max_tier null = the box pays no card. A trigger refuses it from
--                     anon and authenticated, so organisers cannot mint cards; only
--                     definer functions and the service role set it.
--
-- How a box picks a card (grant_card, pick_card):
--   1. Tier. The prize row picked by claim_game_drop's existing picker names the
--      tier. add_card_prizes() writes the rows: special box Common 84, Rare 13, Epic
--      2.7, Legendary 0.3 (XP 10, 25, 60, 150); Golden Box Epic 97, Legendary 3 (XP
--      stays 150); spot box ten one-prize rows, 87 Common to 13 Rare.
--   2. Cap and pity. The tier is clamped to the box's card_max_tier. card_pity counts
--      card claims: the 10th claim since a Rare is lifted to Rare, the 60th since an
--      Epic to Epic (within the box cap). A lift tops the XP up to that tier's XP. If the
--      lifted tier has nothing left, the claim falls back to the prize tier (not to a
--      Rare), so a sold-out Epic cannot turn every later claim into a Rare.
--   3. Distance. From the box point: under 3 km 30%, 3 to 8 km 30%, the rest 40%.
--      An empty bucket passes its share to the others pro rata. Epic and Legendary
--      are city-wide (no buckets); no box point means no buckets; the city-wide
--      cards always count as far. The far share never drops below far_min (15%).
--   4. Card. Live cards of the tier in the bucket, by weight, halved if you own it,
--      none that this box already gave (unless the pool is too thin).
--   5. Sold out. A capped card takes a copy only below copies_total; no copy means
--      another card. A tier with nothing left rolls down one tier (the deck has no
--      Legendary, so its share lands on Epic), then to XP only. A card below its prize
--      tier pays its own tier's XP (a Legendary row that lands an Epic pays 60), except in
--      a box whose rows all pay one flat XP (the Golden Box keeps its 150).
--   6. Copy. A user_cards row; copy_no for capped cards (copy 1 is the first finder
--      for good). Duplicates count and pay nothing.
--   A walked box also stamps its card Visited if the claim point is inside the card's
--   radius (no XP). Avatar claims have no position and never stamp.
--
-- The client API (all RPC, called with the signed-in session):
--   card_catalog()                            anyone. {ok, season, tiers, counts, sets, cards}
--   my_collection()                           {ok, owned[], totals, sets[], pity, stamps}
--   visit_card(card_id, lat, lng, accuracy)   {ok, reason | already, xp, outside, ...}
--   claim_game_drop(...)                      gets `card` (null unless a card prize)
--   open_daily_box()                          gets `card` (null unless staff switch it on)
-- Service role: grant_card, pick_card, add_card_prizes, card_pool, card_json, card_rule.
--
-- Privacy. card_visits holds a play-day date and nothing else about where or when.
-- visit_card checks the position you send against the card and your heartbeat and
-- stores none of it; a paid stamp's activity_log row is dated to the start of the
-- play-day, not to the minute. user_cards holds the day you got a copy, no time, and
-- the box it came from (the box point is blanked after 48 hours, see PLAY-MODE.md).
--
-- Not in this file yet: set completion (XP, badge, title), Wanted: your shot,
-- the album's new-art dot, trading (not in v1). See docs/CARDS.md.
-- ============================================================================

-- ------------------------------------------------------- constraint lists ---
-- Each list gains one value and keeps every value already allowed. One DO block is
-- one statement, so the old check is never left dropped; a re-run changes nothing.
do $$
declare
  v_def  text;
  v_list text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.activity_log'::regclass and c.conname = 'activity_log_action_check';
  if v_def is null or v_def not like '%''card_visit''%' then
    v_list := case
      when v_def is null then array['checkin', 'quest', 'photo', 'post', 'drop', 'crew', 'daily']
      else array(select m[1] from regexp_matches(v_def, '''([^'']+)''', 'g') as m)
    end || 'card_visit'::text;
    alter table public.activity_log drop constraint if exists activity_log_action_check;
    execute format('alter table public.activity_log add constraint activity_log_action_check check (action in (%s))',
                   (select string_agg(quote_literal(a), ', ') from unnest(v_list) as a));
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.drop_rewards'::regclass and c.conname = 'drop_rewards_reward_type_check';
  if v_def is null or v_def not like '%''card''%' then
    v_list := case
      when v_def is null then array['xp', 'badge', 'discount', 'upgrade', 'ticket', 'collectible']
      else array(select m[1] from regexp_matches(v_def, '''([^'']+)''', 'g') as m)
    end || 'card'::text;
    alter table public.drop_rewards drop constraint if exists drop_rewards_reward_type_check;
    execute format('alter table public.drop_rewards add constraint drop_rewards_reward_type_check check (reward_type in (%s))',
                   (select string_agg(quote_literal(a), ', ') from unnest(v_list) as a));
  end if;
end $$;

-- A visit that pays XP is an outside day (the streak counts it) but scores nothing on the board.
insert into public.game_score_rules (key, score) values ('card_visit', 0) on conflict (key) do nothing;

-- ---------------------------------------------------------------- seasons ---
create table if not exists public.card_seasons (
  season     integer primary key check (season > 0),
  name       text not null,
  live       boolean not null default false,
  starts_on  date,
  ends_on    date,
  created_at timestamptz not null default now()
);
-- one live season at a time
create unique index if not exists card_seasons_one_live on public.card_seasons ((true)) where live;

-- ------------------------------------------------------------------- sets ---
create table if not exists public.card_sets (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  name       text not null,
  division   text not null,
  kind       text not null default 'council' check (kind in ('council', 'campus', 'city')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ cards ---
-- Rows are never deleted: a card is retired. A card with copies out is kept for good.
create table if not exists public.cards (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,                    -- the deck id, "YAB-01"
  season         integer not null references public.card_seasons(season),
  set_id         uuid not null references public.card_sets(id),
  division       text not null,
  name           text not null,
  category       text not null,
  rarity         text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  glyph          text,
  motif          text,
  known_for      text not null default '',
  lore           text not null default '',
  fact           text not null default '',
  fact_source    text,
  fact_url       text,
  question       text not null default '',
  home_area      text,
  -- Where the card is. place: the spot itself. area: the centre of its area, no single
  -- spot. citywide: the Lagos Island anchor, stamped from anywhere in Lagos.
  geog           geography(point, 4326) not null,
  lat            double precision generated always as (st_y(geog::geometry)) stored,
  lng            double precision generated always as (st_x(geog::geometry)) stored,
  geo_kind       text not null check (geo_kind in ('place', 'area', 'citywide')),
  geo_confidence text check (geo_confidence in ('high', 'medium', 'low')),
  geo_source     text,                                    -- "osm:way/123", "wikipedia:Title"
  geo_note       text,
  radius_m       integer check (radius_m between 25 and 500),  -- the Visited radius; null for citywide
  copies_total   integer check (copies_total > 0),        -- copies a season; null = unlimited
  numbered       boolean not null default false,          -- the card shows "7 of 100"
  front_path     text not null,
  back_path      text not null,
  thumb_path     text not null,
  art_kind       text not null default 'owned' check (art_kind in ('map', 'generated', 'photo', 'owned')),
  art_version    integer not null default 1,
  art_credit     text,
  status         text not null default 'draft' check (status in ('draft', 'live', 'retired')),
  signed_off     boolean not null default false,
  created_at     timestamptz not null default now(),
  check (status <> 'live' or signed_off),
  check ((rarity = 'common') = (copies_total is null)),
  check ((geo_kind = 'citywide') = (radius_m is null)),
  check (not numbered or copies_total is not null)
);
create index if not exists cards_geog_idx on public.cards using gist(geog);
create index if not exists cards_pick_idx on public.cards(season, rarity, status);
create index if not exists cards_set_idx on public.cards(set_id);

-- The pick weight and the season copy counter, apart from the public catalogue.
-- copies_issued only moves up, one statement at a time, and only below copies_total.
create table if not exists public.card_stock (
  card_id       uuid primary key references public.cards(id) on delete cascade,
  weight        numeric not null default 1 check (weight > 0),
  copies_issued integer not null default 0 check (copies_issued >= 0)
);

create or replace function public.cards_make_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into card_stock (card_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function public.cards_make_stock() from public, anon, authenticated;
grant execute on function public.cards_make_stock() to service_role;
drop trigger if exists cards_stock_row on public.cards;
create trigger cards_stock_row after insert on public.cards
  for each row execute function public.cards_make_stock();
insert into public.card_stock (card_id) select id from public.cards on conflict do nothing;

-- No card in a no-spawn zone (water, military, airport, power and so on), copied from
-- game_drops_guard_geog. A landmark inside one gets a public viewpoint point instead.
create or replace function public.cards_guard_geog()
returns trigger language plpgsql security definer set search_path = public as $$
declare zone_name text;
begin
  select z.name into zone_name from no_spawn_zones z where z.active and st_intersects(z.geog, new.geog) limit 1;
  if found then
    raise exception 'That card point is in a no-spawn area (%). Use a public viewpoint outside it.', zone_name using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.cards_guard_geog() from public, anon, authenticated;
grant execute on function public.cards_guard_geog() to service_role;
drop trigger if exists cards_guard on public.cards;
create trigger cards_guard before insert or update of geog on public.cards
  for each row execute function public.cards_guard_geog();

-- ------------------------------------------------------------ the Hopper's ---
create table if not exists public.user_cards (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  card_id   uuid not null references public.cards(id),
  copy_no   integer check (copy_no > 0),
  got_on    date not null default public.lagos_play_day(),   -- a play-day, never a time
  drop_id   uuid references public.game_drops(id) on delete set null,
  source    text not null default 'box' check (source in ('box', 'daily', 'staff')),
  source_id uuid                                             -- the drop_claims or daily_boxes row
);
create index if not exists user_cards_user_idx on public.user_cards(user_id, card_id);
create index if not exists user_cards_drop_idx on public.user_cards(drop_id) where drop_id is not null;
create unique index if not exists user_cards_copy_idx on public.user_cards(card_id, copy_no) where copy_no is not null;

-- Visited stamps. A play-day date and a yes or no, nothing about where or when.
create table if not exists public.card_visits (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  card_id    uuid not null references public.cards(id),
  visited_on date not null,
  xp_paid    boolean not null default false,
  primary key (user_id, card_id)
);
create index if not exists card_visits_day_idx on public.card_visits(user_id, visited_on);

-- Card claims since a Rare, and since an Epic. Drives the guarantees.
create table if not exists public.card_pity (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  since_rare integer not null default 0 check (since_rare >= 0),
  since_epic integer not null default 0 check (since_epic >= 0)
);

-- ------------------------------------------------------------------ rules ---
create table if not exists public.card_rules (
  key   text primary key,
  value jsonb not null,
  note  text not null default ''
);
-- Defaults only: a value staff changed is never overwritten on a re-run. A setting added
-- by a later version of this file is added to the row; the ones already there stay as they are.
insert into public.card_rules (key, value, note) values
  ('tier_xp', '{"common":10,"rare":25,"epic":60,"legendary":150}',
   'XP a box pays by card tier. A pity lift tops the claim up to the lifted tier.'),
  ('odds', '{"special":{"common":84,"rare":13,"epic":2.7,"legendary":0.3},"golden":{"epic":97,"legendary":3},"spot":{"common":87,"rare":13}}',
   'Prize rows add_card_prizes() writes. The special and Golden Box weight one row per tier; the spot box draws ten rows.'),
  ('flat_xp', '{"golden":150}',
   'XP every prize row of an odds set pays instead of the tier XP (the Golden Box stays 150).'),
  ('distance_mix', '{"near_m":3000,"mid_m":8000,"near":30,"mid":30,"far":40,"far_min":15}',
   'Share of picks by distance from the box: under near_m, to mid_m, the rest. far never drops below far_min. Epic and Legendary ignore it.'),
  ('pick', '{"owned_factor":0.5}',
   'A card you already own counts this much in the draw.'),
  ('pity', '{"rare_by":10,"epic_by":60}',
   'A Rare is guaranteed by the 10th card claim, an Epic by the 60th.'),
  ('visit', '{"xp":30,"xp_max_radius_m":150,"per_day":3,"apart_m":300,"slack_max_m":30,"fix_max_age_s":120,"speed_mps":50,"play_box":[6.30,6.80,3.05,3.95],"city_box":[6.20,6.95,2.65,4.45],"citywide":"lagos"}',
   'Visited: XP for a first stamp on a card with radius 150 m or less, 3 paid a play-day, none within apart_m of a paid stamp today. GPS accuracy adds at most slack_max_m. Inside play_box (Play''s own box) the heartbeat must be fresh, and only a stamp it backed pays XP; outside it a stamp is free. city_box is where a city-wide card stamps; set citywide to "refuse" and they cannot be stamped at all.'),
  ('daily_box', '{"max_tier":null}',
   'Cards from Today''s box on Me: null pays none, "common" or "rare" lets the box rarity pay a card up to that tier.')
on conflict (key) do update set value = excluded.value || public.card_rules.value, note = excluded.note;

create or replace function public.card_rule(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.card_rules where key = p_key;
$$;

create or replace function public.card_rank(p_tier text)
returns integer language sql immutable as $$
  select array_position(array['common', 'rare', 'epic', 'legendary'], p_tier);
$$;

-- --------------------------------------------------- the box's card columns ---
alter table public.drop_rewards add column if not exists card_tier text;
alter table public.game_drops add column if not exists card_max_tier text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.drop_rewards'::regclass and conname = 'drop_rewards_card_tier_check') then
    alter table public.drop_rewards add constraint drop_rewards_card_tier_check
      check ((reward_type = 'card') = (card_tier is not null) and (card_tier is null or card_tier in ('common', 'rare', 'epic', 'legendary')));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.game_drops'::regclass and conname = 'game_drops_card_max_tier_check') then
    alter table public.game_drops add constraint game_drops_card_max_tier_check
      check (card_max_tier is null or card_max_tier in ('common', 'rare', 'epic', 'legendary'));
  end if;
end $$;

-- Organisers cannot mint cards. Not security definer on purpose: current_user is the
-- role that ran the statement, so a definer function (Play's special box) passes and a
-- browser session does not.
create or replace function public.game_drops_guard_card()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.card_max_tier is not null
     and (tg_op = 'INSERT' or new.card_max_tier is distinct from old.card_max_tier) then
    raise exception 'Only staff can make a box that pays a card.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public.game_drops_guard_card() from public, anon, authenticated;
grant execute on function public.game_drops_guard_card() to service_role;
drop trigger if exists game_drops_card_guard on public.game_drops;
create trigger game_drops_card_guard before insert or update of card_max_tier on public.game_drops
  for each row execute function public.game_drops_guard_card();

-- --------------------------------------------------------------- card JSON ---
-- The shape the client gets everywhere (catalogue, collection, claim result). full
-- adds the text of the back; the catalogue leaves it out to stay small.
create or replace function public.card_json(p_card uuid, p_full boolean default true)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
           'id', c.id, 'key', c.key, 'name', c.name,
           'set', jsonb_build_object('key', s.key, 'name', s.name),
           'division', c.division, 'category', c.category, 'rarity', c.rarity,
           'numbered', c.numbered, 'copies_total', c.copies_total, 'known_for', c.known_for,
           'geo', jsonb_build_object('kind', c.geo_kind, 'lat', c.lat, 'lng', c.lng, 'radius_m', c.radius_m),
           'art', jsonb_build_object('front', c.front_path, 'back', c.back_path, 'thumb', c.thumb_path, 'version', c.art_version, 'credit', c.art_credit))
         || case when p_full then jsonb_build_object(
              'lore', c.lore, 'fact', c.fact, 'source', jsonb_build_object('title', c.fact_source, 'url', c.fact_url),
              'question', c.question, 'home_area', c.home_area, 'glyph', c.glyph, 'motif', c.motif)
            else '{}'::jsonb end
  from public.cards c join public.card_sets s on s.id = c.set_id
  where c.id = p_card;
$$;

-- ---------------------------------------------------------------- the pick ---
-- The cards a draw can land on: live season, live and signed off, this tier, not
-- sold out, not skipped. bucket is near, mid or far from the box point, or all when
-- there are no buckets (Epic and Legendary, or no box point). w is the draw weight.
create or replace function public.card_pool(p_user uuid, p_tier text, p_geog geography default null, p_skip uuid[] default '{}')
returns table(card_id uuid, bucket text, w numeric)
language sql stable security definer set search_path = public, extensions as $$
  with mix as (select coalesce((public.card_rule('distance_mix')->>'near_m')::double precision, 3000) as near_m,
                      coalesce((public.card_rule('distance_mix')->>'mid_m')::double precision, 8000) as mid_m,
                      coalesce((public.card_rule('pick')->>'owned_factor')::numeric, 0.5) as f)
  select c.id,
         case when p_geog is null or p_tier in ('epic', 'legendary') then 'all'
              when c.geo_kind = 'citywide' then 'far'
              when x.d < mix.near_m then 'near'
              when x.d < mix.mid_m then 'mid'
              else 'far' end,
         st.weight * case when exists (select 1 from user_cards u where u.user_id = p_user and u.card_id = c.id) then mix.f else 1 end
  from cards c
  join card_stock st on st.card_id = c.id
  join card_seasons se on se.season = c.season and se.live
  cross join mix
  -- the distance to the box on the sphere (no spheroid): a tenth of a percent off is nothing next to 3 km and 8 km
  cross join lateral (select case when p_geog is null then null else st_distance(c.geog, p_geog, false) end as d) x
  where c.status = 'live' and c.signed_off and c.rarity = p_tier
    and not (c.id = any (coalesce(p_skip, '{}'::uuid[])))
    and (c.copies_total is null or st.copies_issued < c.copies_total);
$$;

-- Draws one card of the tier, or null when there is none. Writes nothing (the copy is
-- taken by grant_card), so the odds can be measured over many draws. One statement:
-- the pool is read once, the bucket is chosen among the buckets that have cards (an
-- empty bucket passes its share on, pro rata), then a weighted draw inside the bucket.
create or replace function public.pick_card(p_user uuid, p_tier text, p_geog geography default null, p_skip uuid[] default '{}')
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  mix jsonb := public.card_rule('distance_mix');
  s_near numeric := coalesce((mix->>'near')::numeric, 30);
  s_mid numeric := coalesce((mix->>'mid')::numeric, 30);
  s_far numeric := coalesce((mix->>'far')::numeric, 40);
  far_min numeric := coalesce((mix->>'far_min')::numeric, 0);
  s_both numeric; picked uuid;
begin
  if public.card_rank(p_tier) is null then return null; end if;
  -- staff cannot starve the "from anywhere" share
  if s_far < far_min then
    if s_near + s_mid > 0 then
      s_both := s_near + s_mid;
      s_near := s_near * (100 - far_min) / s_both;
      s_mid := s_mid * (100 - far_min) / s_both;
    end if;
    s_far := far_min;
  end if;
  with p as (select * from public.card_pool(p_user, p_tier, p_geog, p_skip)),
       n as (select count(*) filter (where bucket = 'near') as near, count(*) filter (where bucket = 'mid') as mid,
                    count(*) filter (where bucket = 'far') as far, count(*) filter (where bucket = 'all') as everyone from p),
       cut as (select n.everyone,
                      case when n.near > 0 then s_near else 0 end as a,
                      case when n.near > 0 then s_near else 0 end + case when n.mid > 0 then s_mid else 0 end as ab,
                      case when n.near > 0 then s_near else 0 end + case when n.mid > 0 then s_mid else 0 end + case when n.far > 0 then s_far else 0 end as abc
               from n),
       pick as (select cut.everyone, cut.a, cut.ab, cut.abc, random() * cut.abc as roll from cut),
       chosen as (select case when pick.everyone > 0 or pick.abc <= 0 then 'any'   -- no buckets, or staff set every share that has cards to 0
                              when pick.roll < pick.a then 'near' when pick.roll < pick.ab then 'mid' else 'far' end as bk from pick)
  select p.card_id into picked from p, chosen
  where chosen.bk = 'any' or p.bucket = chosen.bk
  -- a weighted draw: the smallest -ln(u) / w wins with probability w / sum(w)
  order by -ln(1 - random()) / p.w
  limit 1;
  return picked;
end $$;
revoke all on function public.card_pool(uuid, text, geography, uuid[]), public.pick_card(uuid, text, geography, uuid[]) from public, anon, authenticated;
grant execute on function public.card_pool(uuid, text, geography, uuid[]), public.pick_card(uuid, text, geography, uuid[]) to service_role;

-- --------------------------------------------------------------- the grant ---
-- Gives a Hopper a card for a box. Called inside the claim by claim_game_drop (a card
-- prize on a box with card_max_tier) and by open_daily_box.
--   p_tier      the tier the prize row names
--   p_max_tier  the box cap (null: no card at all)
--   p_xp        the XP the prize row pays; the answer's xp is that, or the lifted
--               tier's XP when the guarantee lifted the card
--   p_drop      the box (its point steers the draw; it also keeps one box from giving
--               the same card twice)
--   p_lat, p_lng  where a walked box was opened; the card is stamped Visited if that
--               is inside its radius. Not stored.
-- Answers {card, xp} or null when no tier has a card left (XP only).
create or replace function public.grant_card(p_user uuid, p_tier text, p_drop uuid default null, p_max_tier text default null,
                                             p_xp integer default 0, p_lat double precision default null, p_lng double precision default null,
                                             p_source text default 'box', p_source_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  tiers constant text[] := array['common', 'rare', 'epic', 'legendary'];
  rules jsonb := public.card_rule('pity');
  pity card_pity; cd cards; base integer; cap integer; want integer; t integer; final integer; tries integer;
  pt geography; skip uuid[]; got uuid; v_copy integer; is_new boolean; stamped boolean := false; flat boolean; xp_out integer; cj jsonb;
begin
  if p_user is null or p_max_tier is null then return null; end if;
  base := public.card_rank(p_tier); cap := public.card_rank(p_max_tier);
  if base is null or cap is null then return null; end if;
  base := least(base, cap);
  -- one grant at a time per Hopper (claim_game_drop already holds the claim lock)
  perform pg_advisory_xact_lock(hashtextextended('cards:' || p_user::text, 0));
  insert into card_pity (user_id) values (p_user) on conflict do nothing;
  select * into pity from card_pity where user_id = p_user for update;

  -- the guarantees: the 10th claim since a Rare is a Rare, the 60th since an Epic an Epic
  want := base;
  if cap >= 3 and pity.since_epic + 1 >= (rules->>'epic_by')::integer then want := greatest(want, 3);
  elsif cap >= 2 and pity.since_rare + 1 >= (rules->>'rare_by')::integer then want := greatest(want, 2);
  end if;

  select coalesce(array_agg(card_id), '{}'::uuid[]) into skip from user_cards where drop_id = p_drop;
  select coalesce(g.geog, ev.geog) into pt from game_drops g left join events ev on ev.id = g.event_id where g.id = p_drop;

  t := want;
  while t >= 1 loop
    got := null;
    for pass in 1..2 loop
      -- pass 1 keeps clear of cards this box already gave; pass 2 allows them (a pool thinner than the box)
      continue when pass = 2 and cardinality(skip) = 0;
      tries := 0;
      while tries < 6 loop
        got := public.pick_card(p_user, tiers[t], pt, case when pass = 1 then skip else '{}'::uuid[] end);
        exit when got is null;
        select * into cd from cards where id = got;
        if cd.copies_total is null then v_copy := null; exit; end if;
        -- a capped card takes a copy only below its cap; a lost race means another card
        update card_stock set copies_issued = copies_issued + 1 where card_id = got and copies_issued < cd.copies_total returning copies_issued into v_copy;
        exit when found;
        got := null; tries := tries + 1;
      end loop;
      exit when got is not null;
    end loop;
    exit when got is not null;
    -- Nothing left in this tier. A tier a guarantee lifted us to falls back to the prize tier, not one tier down:
    -- a sold-out Epic owed at the 60th claim must not pay a Rare on every claim after (the Rare only if one is owed too).
    -- A prize tier itself rolls down one tier.
    t := case when t > base then (case when t = 3 and cap >= 2 and pity.since_rare + 1 >= (rules->>'rare_by')::integer then 2 else base end)
              else t - 1 end;
  end loop;
  if got is null then return null; end if;

  final := public.card_rank(cd.rarity);
  is_new := not exists (select 1 from user_cards where user_id = p_user and card_id = got);
  insert into user_cards (user_id, card_id, copy_no, drop_id, source, source_id) values (p_user, got, v_copy, p_drop, p_source, p_source_id);

  -- Rare or better zeroes since_rare; Epic or better zeroes both
  update card_pity set since_rare = case when final >= 2 then 0 else since_rare + 1 end,
                       since_epic = case when final >= 3 then 0 else since_epic + 1 end
  where user_id = p_user;

  -- a walked box that opened inside the card's radius stamps it, no XP
  if p_lat is not null and p_lng is not null and cd.geo_kind <> 'citywide'
     and st_dwithin(cd.geog, st_point(p_lng, p_lat)::geography, cd.radius_m) then
    insert into card_visits (user_id, card_id, visited_on) values (p_user, got, public.lagos_play_day()) on conflict do nothing;
  end if;
  stamped := exists (select 1 from card_visits where user_id = p_user and card_id = got);

  -- XP: a lift tops the row up to the lifted tier's XP. A card below the prize tier (a Legendary row that rolled down to
  -- Epic, a sold-out tier) pays its own tier's XP, never more than the row. A box whose card rows all pay one flat XP
  -- (the Golden Box, card_rules flat_xp) keeps it whichever card lands.
  flat := p_drop is not null
          and (select count(distinct r.xp_amount) from drop_rewards r where r.drop_id = p_drop and r.reward_type = 'card') = 1
          and exists (select 1 from jsonb_each_text(coalesce(public.card_rule('flat_xp'), '{}'::jsonb)) f where f.value::integer = p_xp);
  xp_out := case when final > base then greatest(coalesce(p_xp, 0), coalesce((public.card_rule('tier_xp')->>cd.rarity)::integer, 0))
                 when final < base and not flat then least(coalesce(p_xp, 0), coalesce((public.card_rule('tier_xp')->>cd.rarity)::integer, 0))
                 else coalesce(p_xp, 0) end;
  cj := public.card_json(got) || jsonb_build_object('copy_no', v_copy, 'is_new', is_new, 'lifted', final > base, 'visited', stamped);
  return jsonb_build_object('card', cj, 'xp', xp_out);
end $$;
revoke all on function public.grant_card(uuid, text, uuid, text, integer, double precision, double precision, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_card(uuid, text, uuid, text, integer, double precision, double precision, text, uuid) to service_role;

-- The card a Hopper got from a source (a daily box), for a repeat call that must answer the same.
create or replace function public.card_for_source(p_user uuid, p_source text, p_source_id uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select public.card_json(u.card_id) || jsonb_build_object('copy_no', u.copy_no, 'is_new', false, 'lifted', false,
           'visited', exists (select 1 from card_visits v where v.user_id = u.user_id and v.card_id = u.card_id))
  from user_cards u where u.user_id = p_user and u.source = p_source and u.source_id = p_source_id
  order by u.id limit 1;
$$;
revoke all on function public.card_json(uuid, boolean), public.card_for_source(uuid, text, uuid), public.card_rule(text) from public, anon, authenticated;
grant execute on function public.card_json(uuid, boolean), public.card_for_source(uuid, text, uuid), public.card_rule(text) to service_role;

-- ----------------------------------------------------------- box prizes ---
-- Writes the card prize rows of a box and sets its cap. Staff and the special-box and
-- spot code call it once per box (a second call replaces the card rows).
--   special   one row per tier, weights 84, 13, 2.7, 0.3, XP 10, 25, 60, 150
--   golden    Epic 97, Legendary 3, XP 150 either way
--   spot      ten rows, one prize each, the tier drawn 87 Common to 13 Rare
-- A tier the deck has no card for rolls down at claim time, so no row is edited by hand.
-- The rows are titled "Card", never "Epic card": the title is the receipt text a client may show
-- (my_drop_claims), and the card that lands can be a different tier from the row that was drawn.
-- The box cap is the top tier its odds can pay (a spot box is capped at Rare even when all ten
-- rows came out Common, so the Rare guarantee can still lift it).
-- Returns how many rows it wrote.
create or replace function public.add_card_prizes(p_drop uuid, p_odds text default 'special')
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  odds jsonb := public.card_rule('odds') -> p_odds; xp jsonb := public.card_rule('tier_xp'); flat integer := (public.card_rule('flat_xp') ->> p_odds)::integer;
  t text; w numeric; n integer := 0; top integer := 0; k integer; roll numeric; total numeric; run numeric; chosen text;
begin
  if odds is null then raise exception 'No card odds called %', p_odds; end if;
  if not exists (select 1 from game_drops where id = p_drop) then raise exception 'No such box'; end if;
  delete from drop_rewards where drop_id = p_drop and reward_type = 'card';
  select sum(value::numeric) into total from jsonb_each_text(odds);
  if p_odds = 'spot' then
    for k in 1..10 loop
      roll := random() * total; run := 0; chosen := null;
      for t, w in select key, value::numeric from jsonb_each_text(odds) order by public.card_rank(key) loop
        run := run + w;
        if chosen is null and roll < run then chosen := t; end if;
      end loop;
      insert into drop_rewards (drop_id, reward_type, title, quantity, weight, xp_amount, card_tier)
      values (p_drop, 'card', 'Card', 1, 1, coalesce(flat, (xp ->> chosen)::integer), chosen);
      n := n + 1;
    end loop;
  else
    for t, w in select key, value::numeric from jsonb_each_text(odds) loop
      insert into drop_rewards (drop_id, reward_type, title, weight, xp_amount, card_tier)
      values (p_drop, 'card', 'Card', w, coalesce(flat, (xp ->> t)::integer), t);
      n := n + 1;
    end loop;
  end if;
  select max(public.card_rank(key)) into top from jsonb_each_text(odds);
  update game_drops set card_max_tier = (array['common', 'rare', 'epic', 'legendary'])[top], reward_model = 'random' where id = p_drop;
  return n;
end $$;
revoke all on function public.add_card_prizes(uuid, text) from public, anon, authenticated;
grant execute on function public.add_card_prizes(uuid, text) to service_role;

-- Prize rows written before the title lost its tier word: the receipt of a card claim must not name a tier.
update public.drop_rewards set title = 'Card' where reward_type = 'card' and title ~* '^(common|rare|epic|legendary) card$';

-- --------------------------------------------------------------- visiting ---
-- "I'M HERE" on a card you hold. Stamps it Visited when your position is inside the
-- card's radius plus your GPS accuracy (that slack capped at 30 m): place cards 150 m
-- (a moved viewpoint 300 m), area cards 500 m, a city-wide card from anywhere in Lagos.
-- Once per card. A first stamp pays 30 XP when the radius is 150 m or less, 3 a
-- play-day, none within 300 m of a paid stamp today; a paid stamp is an outside day
-- (activity_log 'card_visit', score 0: the streak counts it, the board does not).
-- The checks are today's: one call at a time per Hopper (the claim lock), the
-- 50 m/s speed rule from the last located claim, and a heartbeat (play_tick) under
-- two minutes old inside Play's box. The position is used and thrown away.
-- XP needs that heartbeat: only a stamp the heartbeat backed pays (xp_skipped
-- 'unverified' otherwise), so a card in Badagry or Epe, where no heartbeat can run,
-- stamps for the memory and pays nothing. Known limit: play_tick_for has no speed rule
-- yet, so a client that sends a heartbeat at the card point after one far away is not
-- caught here; that rule belongs to Play (docs/CARDS.md, "Known limits"). What a paid
-- stamp costs is bounded: 3 a play-day, 90 XP.
-- The activity_log row is dated to the start of the play-day (06:00), not to the minute:
-- the streak needs the day, and the table must not hold the time of a stamp.
-- Answers {ok:true, already, xp, outside, visited_on, card:{id,key,name}, xp_skipped}
-- or {ok:false, reason}: no_session, location_required, not_found, not_owned, too_far
-- (distance_m, to 10 m), outside_lagos (city-wide cards), not_stampable (city-wide cards,
-- only if staff set card_rules visit.citywide to "refuse"), location_stale, too_fast.
create or replace function public.visit_card(p_card uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); rules jsonb := public.card_rule('visit'); today date := public.lagos_play_day();
  cd cards; v card_visits; fx play_fix; prev record; pos geography; dist double precision; slack double precision := 0;
  pbox jsonb := rules->'play_box'; cbox jsonb := rules->'city_box'; speed double precision := coalesce((rules->>'speed_mps')::double precision, 50);
  pay boolean := false; verified boolean := false; why text; paid_xp integer := 0; who jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_lat is null or p_lng is null or p_lat = 'NaN'::double precision or p_lng = 'NaN'::double precision
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return jsonb_build_object('ok', false, 'reason', 'location_required');
  end if;
  -- a card staff retired can still be stamped by the Hopper who holds it
  select * into cd from cards where id = p_card and status in ('live', 'retired') and signed_off;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('claim:' || me::text, 0));
  if not exists (select 1 from user_cards where user_id = me and card_id = cd.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_owned');
  end if;
  who := jsonb_build_object('id', cd.id, 'key', cd.key, 'name', cd.name);
  select * into v from card_visits where user_id = me and card_id = cd.id;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'xp', 0, 'outside', false, 'visited_on', v.visited_on, 'card', who);
  end if;
  pos := st_point(p_lng, p_lat)::geography;

  -- where you have to be
  if cd.geo_kind = 'citywide' then
    if coalesce(rules->>'citywide', 'lagos') = 'refuse' then
      return jsonb_build_object('ok', false, 'reason', 'not_stampable');
    end if;
    if not (p_lat between (cbox->>0)::double precision and (cbox->>1)::double precision
            and p_lng between (cbox->>2)::double precision and (cbox->>3)::double precision) then
      return jsonb_build_object('ok', false, 'reason', 'outside_lagos');
    end if;
  else
    if p_accuracy is not null and p_accuracy <> 'NaN'::double precision and p_accuracy > 0 then
      slack := least(p_accuracy, coalesce((rules->>'slack_max_m')::double precision, 30));
    end if;
    dist := st_distance(cd.geog, pos);
    if dist > cd.radius_m + slack then
      return jsonb_build_object('ok', false, 'reason', 'too_far', 'distance_m', round(dist / 10) * 10);
    end if;
  end if;

  -- and the position has to be believable
  if p_lat between (pbox->>0)::double precision and (pbox->>1)::double precision
     and p_lng between (pbox->>2)::double precision and (pbox->>3)::double precision then
    select * into fx from play_fix where user_id = me;
    if not found or fx.at < now() - make_interval(secs => coalesce((rules->>'fix_max_age_s')::double precision, 120)) then
      return jsonb_build_object('ok', false, 'reason', 'location_stale');
    end if;
    -- the heartbeat keeps a copy rounded to about 110 m, so 120 m of slack before the speed check
    if greatest(st_distance(st_point(fx.lng, fx.lat)::geography, pos) - 120, 0) / greatest(extract(epoch from now() - fx.at), 1) > speed then
      return jsonb_build_object('ok', false, 'reason', 'too_fast');
    end if;
    verified := true;   -- a fresh heartbeat, and the position is believable next to it
  end if;
  select c.lat, c.lng, c.claimed_at into prev from drop_claims c
    where c.user_id = me and c.lat is not null and c.lng is not null and c.claimed_at > now() - interval '2 hours'
    order by c.claimed_at desc limit 1;
  if found and st_distance(st_point(prev.lng, prev.lat)::geography, pos) / greatest(extract(epoch from now() - prev.claimed_at), 1) > speed then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;

  -- does this stamp pay
  if cd.radius_m is null or cd.radius_m > (rules->>'xp_max_radius_m')::integer then why := 'area';
  elsif not verified then why := 'unverified';
  elsif (select count(*) from card_visits where user_id = me and visited_on = today and xp_paid) >= (rules->>'per_day')::integer then why := 'daily_limit';
  elsif exists (select 1 from card_visits cv join cards o on o.id = cv.card_id
                where cv.user_id = me and cv.visited_on = today and cv.xp_paid and st_dwithin(o.geog, cd.geog, (rules->>'apart_m')::double precision)) then why := 'near_stamp';
  else pay := true; paid_xp := (rules->>'xp')::integer;
  end if;

  insert into card_visits (user_id, card_id, visited_on, xp_paid) values (me, cd.id, today, pay);
  if pay then
    update profiles set xp = xp + paid_xp where id = me;
    insert into activity_log (user_id, action, source_id, outside_score, created_at)
    values (me, 'card_visit', cd.id, coalesce((select score from game_score_rules where key = 'card_visit'), 0), public.lagos_play_day_start()) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'xp', paid_xp, 'outside', pay, 'xp_skipped', why, 'visited_on', today, 'card', who);
end $$;
revoke all on function public.visit_card(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.visit_card(uuid, double precision, double precision, double precision) to authenticated;

-- ----------------------------------------------------------- the app reads ---
-- The whole live catalogue in one call. tiers lists only the rarities the deck has a
-- live card for: show no other (this season has no Legendary).
create or replace function public.card_catalog()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'ok', true,
    'season', (select jsonb_build_object('season', s.season, 'name', s.name) from card_seasons s where s.live),
    'tiers', coalesce((select jsonb_agg(t.tier order by public.card_rank(t.tier)) from (
               select distinct c.rarity as tier from cards c where c.status = 'live' and c.signed_off) t), '[]'::jsonb),
    'counts', (select jsonb_object_agg(t.tier, (select count(*) from cards c where c.status = 'live' and c.signed_off and c.rarity = t.tier))
               from (values ('common'), ('rare'), ('epic'), ('legendary')) t(tier)),
    'sets', coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'name', s.name, 'division', s.division, 'kind', s.kind, 'count', x.n) order by s.division, s.name)
                      from card_sets s join (select set_id, count(*) n from cards where status = 'live' and signed_off group by set_id) x on x.set_id = s.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(public.card_json(c.id, false) order by c.division, c.key) from cards c where c.status = 'live' and c.signed_off), '[]'::jsonb));
$$;
revoke all on function public.card_catalog() from public;
grant execute on function public.card_catalog() to anon, authenticated;

-- The caller's cards: each owned card once with its copies, whether it is Visited,
-- set progress, the guarantee counters and today's paid stamps.
create or replace function public.my_collection()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); today date := public.lagos_play_day(); pity card_pity; rules jsonb := public.card_rule('pity'); visit jsonb := public.card_rule('visit');
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into pity from card_pity where user_id = me;
  return jsonb_build_object(
    'ok', true,
    'season', (select s.season from card_seasons s where s.live),
    'owned', coalesce((
      select jsonb_agg(jsonb_build_object(
               'card', public.card_json(o.card_id), 'count', o.n, 'copies', o.copies, 'first_on', o.first_on,
               'visited', o.visited_on is not null, 'visited_on', o.visited_on) order by public.card_rank(o.rarity) desc, o.key)
      from (select u.card_id, c.rarity, c.key, count(*) n, min(u.got_on) first_on, v.visited_on,
                   jsonb_agg(jsonb_build_object('copy_no', u.copy_no, 'got_on', u.got_on) order by u.got_on, u.copy_no nulls first, u.id) copies
            from user_cards u join cards c on c.id = u.card_id
            left join card_visits v on v.user_id = u.user_id and v.card_id = u.card_id
            where u.user_id = me group by u.card_id, c.rarity, c.key, v.visited_on) o), '[]'::jsonb),
    'totals', jsonb_build_object(
      'cards', (select count(distinct card_id) from user_cards where user_id = me),
      'copies', (select count(*) from user_cards where user_id = me),
      'visited', (select count(*) from card_visits where user_id = me),
      'of', (select count(*) from cards where status = 'live' and signed_off)),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object('key', s.key, 'name', s.name, 'division', s.division,
               'owned', x.owned, 'visited', x.visited, 'total', x.total) order by s.division, s.name)
      from card_sets s join (
        select c.set_id, count(*) filter (where c.status = 'live' and c.signed_off) total,
               count(*) filter (where exists (select 1 from user_cards u where u.user_id = me and u.card_id = c.id)) owned,
               count(*) filter (where exists (select 1 from card_visits v where v.user_id = me and v.card_id = c.id)) visited
        from cards c group by c.set_id) x on x.set_id = s.id
      where x.owned > 0), '[]'::jsonb),
    'pity', jsonb_build_object('since_rare', coalesce(pity.since_rare, 0), 'since_epic', coalesce(pity.since_epic, 0),
                               'rare_by', (rules->>'rare_by')::integer, 'epic_by', (rules->>'epic_by')::integer),
    'stamps', jsonb_build_object('paid_today', (select count(*) from card_visits where user_id = me and visited_on = today and xp_paid),
                                 'paid_max', (visit->>'per_day')::integer, 'xp', (visit->>'xp')::integer));
end $$;
revoke all on function public.my_collection() from public, anon;
grant execute on function public.my_collection() to authenticated;

-- ------------------------------------------------------------- lock down ---
-- Tables: nothing for anon and authenticated except the selects below, and RLS on.
-- Writes happen only through the definer functions above.
alter table public.card_seasons enable row level security;
alter table public.card_sets enable row level security;
alter table public.cards enable row level security;
alter table public.card_stock enable row level security;
alter table public.user_cards enable row level security;
alter table public.card_visits enable row level security;
alter table public.card_pity enable row level security;
alter table public.card_rules enable row level security;

revoke all on public.card_seasons, public.card_sets, public.cards, public.card_stock, public.user_cards,
              public.card_visits, public.card_pity, public.card_rules from anon, authenticated;
grant all on public.card_seasons, public.card_sets, public.cards, public.card_stock, public.user_cards,
             public.card_visits, public.card_pity, public.card_rules to service_role;
grant select on public.card_seasons, public.card_sets, public.cards to anon, authenticated;
grant select on public.user_cards, public.card_visits, public.card_pity to authenticated;

-- Anyone reads the live catalogue. card_stock (weights, counters) and card_rules have no policy.
drop policy if exists card_seasons_read on public.card_seasons;
create policy card_seasons_read on public.card_seasons for select to anon, authenticated using (true);
drop policy if exists card_sets_read on public.card_sets;
create policy card_sets_read on public.card_sets for select to anon, authenticated
  using (exists (select 1 from public.cards c where c.set_id = card_sets.id and c.status = 'live' and c.signed_off));
drop policy if exists cards_read on public.cards;
create policy cards_read on public.cards for select to anon, authenticated using (status = 'live' and signed_off);

-- A Hopper reads only their own copies, stamps and counters.
drop policy if exists user_cards_read_own on public.user_cards;
create policy user_cards_read_own on public.user_cards for select to authenticated using (user_id = auth.uid());
drop policy if exists card_visits_read_own on public.card_visits;
create policy card_visits_read_own on public.card_visits for select to authenticated using (user_id = auth.uid());
drop policy if exists card_pity_read_own on public.card_pity;
create policy card_pity_read_own on public.card_pity for select to authenticated using (user_id = auth.uid());
