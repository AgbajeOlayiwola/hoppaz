-- ============================================================================
-- Hoppaz: box guards (no box in the water)
-- Run order: schema.sql, hunt_items.sql, spawning.sql, spawn_points_lagos.sql,
-- then this file in the Supabase SQL editor. Safe to run again.
--
-- Why: the spawner already keeps street boxes out of zones, but nothing stopped
-- any other insert (a staff drop from the admin desk, a test script, a welcome
-- box placed as a last resort) from landing in the sea or the lagoon, and a
-- beach spot can sit right on the waterline. This file makes the database
-- refuse such a box, whoever inserts it.
--
-- What it adds:
--   no_spawn_zones.zone_type   what kind of place a zone is: water, military,
--                              airport, prison, port, landfill, power, estate
--                              or staff (a zone staff drew by hand). Worked out
--                              from reason and source_ref for every row that has
--                              none, and for every new one. Water is a type, not
--                              a guess from the name: the sea is "Atlantic
--                              Ocean", the creeks are called anything, and many
--                              water shapes are just "Water".
--   game_drops guard           a trigger on insert, and on update of geog or
--                              kind. A drop that has its own point (geog) is
--                              refused when the point lies inside an active
--                              water zone, whatever its kind: "That spot is in
--                              the water. Pick a spot on land." Street boxes
--                              (kind spawn) and welcome boxes are also refused
--                              inside any other active zone. A staff drop tied
--                              to an event and without its own point is left
--                              alone, it uses the venue. Rows already in the
--                              table are not rechecked, and claiming a box
--                              (which only changes claimed_count) never trips it.
--   spawn_points water margin  a spot within 40 m of an active water zone is
--                              switched off, now and whenever a spot is added or
--                              moved: a pin that close to the waterline can
--                              show in the sea once the map tiles and the OSM
--                              shapes disagree by a few metres. A beach stays
--                              only if it is on the sand, not at the waterline.
--                              Staff can still switch such a spot on by hand;
--                              it stays on until it is moved or imported again.
--
-- spawn_points_lagos.sql (made by scripts/spawn-points/import-osm.mjs) writes
-- zone_type itself from the next regeneration on. The copy made before that
-- does not, and does not need to: this file fills the column in.
-- ============================================================================

begin;

-- ------------------------------------------------------------- zone types ---
alter table public.no_spawn_zones add column if not exists zone_type text;

-- The type for a zone with none. The sea and the harbour mouth are named by
-- their source_ref (both from the importer), every other zone by its reason.
-- A reason nobody recognises is a hand-made zone: staff.
create or replace function public.no_spawn_zone_type(p_reason text, p_source_ref text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_source_ref in ('derived/sea', 'lagos-core/sea', 'lagos-core/harbour-mouth') then 'water'
    else case lower(btrim(coalesce(p_reason, '')))
           when 'water' then 'water'
           when 'military' then 'military'
           when 'airport' then 'airport'
           when 'prison' then 'prison'
           when 'port' then 'port'
           when 'landfill' then 'landfill'
           when 'power plant' then 'power'
           when 'private estate' then 'estate'
           else 'staff'
         end
  end;
$$;
revoke all on function public.no_spawn_zone_type(text, text) from public, anon, authenticated;
grant execute on function public.no_spawn_zone_type(text, text) to service_role;

-- A zone inserted or edited without a type gets one.
create or replace function public.no_spawn_zones_fill_type()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.zone_type is null then new.zone_type := public.no_spawn_zone_type(new.reason, new.source_ref); end if;
  return new;
end $$;
revoke all on function public.no_spawn_zones_fill_type() from public, anon, authenticated;
grant execute on function public.no_spawn_zones_fill_type() to service_role;
drop trigger if exists no_spawn_zones_type on public.no_spawn_zones;
create trigger no_spawn_zones_type before insert or update of reason, source_ref, zone_type on public.no_spawn_zones
  for each row execute function public.no_spawn_zones_fill_type();

update public.no_spawn_zones set zone_type = public.no_spawn_zone_type(reason, source_ref) where zone_type is null;
alter table public.no_spawn_zones alter column zone_type set not null;
alter table public.no_spawn_zones drop constraint if exists no_spawn_zones_zone_type_check;
alter table public.no_spawn_zones add constraint no_spawn_zones_zone_type_check
  check (zone_type in ('water','military','airport','prison','port','landfill','power','estate','staff'));

-- ------------------------------------------------- spawn spots by the water ---
create or replace function public.spawn_points_keep_off_water()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active and exists (
    select 1 from no_spawn_zones z where z.active and z.zone_type = 'water' and st_dwithin(z.geog, new.geog, 40)
  ) then
    new.active := false;
  end if;
  return new;
end $$;
revoke all on function public.spawn_points_keep_off_water() from public, anon, authenticated;
grant execute on function public.spawn_points_keep_off_water() to service_role;
drop trigger if exists spawn_points_water on public.spawn_points;
create trigger spawn_points_water before insert or update of geog on public.spawn_points
  for each row execute function public.spawn_points_keep_off_water();

-- The spots that are already there.
update public.spawn_points sp set active = false
where sp.active
  and exists (select 1 from public.no_spawn_zones z where z.active and z.zone_type = 'water' and st_dwithin(z.geog, sp.geog, 40));

-- ----------------------------------------------------------- the box guard ---
create or replace function public.game_drops_guard_geog()
returns trigger language plpgsql security definer set search_path = public as $$
declare zone_name text;
begin
  -- a drop tied to an event with no point of its own uses the venue: nothing to check
  if new.geog is null then return new; end if;
  if exists (select 1 from no_spawn_zones z where z.active and z.zone_type = 'water' and st_intersects(z.geog, new.geog)) then
    raise exception 'That spot is in the water. Pick a spot on land.' using errcode = 'check_violation';
  end if;
  if new.kind in ('spawn', 'welcome') then
    select z.name into zone_name from no_spawn_zones z where z.active and st_intersects(z.geog, new.geog) limit 1;
    if found then
      raise exception 'That spot is in a no-box area (%). Pick another spot.', zone_name using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.game_drops_guard_geog() from public, anon, authenticated;
grant execute on function public.game_drops_guard_geog() to service_role;
drop trigger if exists game_drops_guard on public.game_drops;
create trigger game_drops_guard before insert or update of geog, kind on public.game_drops
  for each row execute function public.game_drops_guard_geog();

commit;

select zone_type, count(*) as zones, count(*) filter (where active) as active
from public.no_spawn_zones group by zone_type order by zone_type;
