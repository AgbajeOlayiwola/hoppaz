-- ============================================================================
-- Hoppaz Night Map: seed data. Lagos only.
-- Run after schema.sql. Safe to re-run.
-- Event titles and venues below are a realistic sample night, not a confirmed
-- listing. Replace them with the real week before you let anyone in.
-- ============================================================================

insert into public.areas (name, side, centroid) values
  ('Ikeja',           'mainland', st_point(3.3490, 6.6010)::geography),
  ('Magodo',          'mainland', st_point(3.3780, 6.6160)::geography),
  ('Maryland',        'mainland', st_point(3.3650, 6.5700)::geography),
  ('Ogudu',           'mainland', st_point(3.3880, 6.5770)::geography),
  ('Gbagada',         'mainland', st_point(3.3960, 6.5520)::geography),
  ('Shomolu',         'mainland', st_point(3.3830, 6.5400)::geography),
  ('Mushin',          'mainland', st_point(3.3450, 6.5270)::geography),
  ('Yaba',            'mainland', st_point(3.3750, 6.5090)::geography),
  ('Surulere',        'mainland', st_point(3.3520, 6.4970)::geography),
  ('Apapa',           'mainland', st_point(3.3630, 6.4480)::geography),
  ('Festac',          'mainland', st_point(3.2860, 6.4660)::geography),
  ('Lagos Island',    'island',   st_point(3.3990, 6.4550)::geography),
  ('Ikoyi',           'island',   st_point(3.4360, 6.4520)::geography),
  ('Victoria Island', 'island',   st_point(3.4240, 6.4290)::geography),
  ('Lekki Phase 1',   'island',   st_point(3.4700, 6.4410)::geography),
  ('Ajah',            'island',   st_point(3.5650, 6.4680)::geography)
on conflict (name) do update set side = excluded.side, centroid = excluded.centroid;

-- -------------------------------------------------------------- events -----
-- starts_at is anchored to the coming Friday night in Lagos time so the seed
-- stays inside the map's time window whenever you run it.
with friday as (
  select (date_trunc('week', (now() at time zone 'Africa/Lagos')) + interval '4 days')::date as d
),
rows(title, venue_name, area, lng, lat, hhmm, price, vibe, source, base_heat) as (values
  ('Soundgarden',          'South Social',             'Lekki Phase 1',   3.4655, 6.4386, '23:00', 10000, 'afro',      'hoppaz',  72),
  ('Element After Dark',   'Element House',            'Lekki Phase 1',   3.4548, 6.4428, '23:30',  8000, 'techno',    'partner', 64),
  ('Shrine Friday',        'New Afrika Shrine',        'Ikeja',           3.3449, 6.6060, '19:00',     0, 'live band', 'partner', 58),
  ('Sailors Deck',         'Sailors Lounge',           'Victoria Island', 3.4405, 6.4262, '22:00',  7000, 'rave',      'partner', 55),
  ('Yaba Rooftop Session', 'Herbert Macaulay rooftop', 'Yaba',            3.3742, 6.5078, '22:00',  4000, 'amapiano',  'hopper',  50),
  ('Hard Rock Fridays',    'Hard Rock Cafe',           'Victoria Island', 3.4165, 6.4225, '21:00', 10000, 'afro',      'partner', 48),
  ('Laughter Cave',        'Bogobiri House',           'Ikoyi',           3.4318, 6.4506, '20:00',  5000, 'comedy',    'partner', 46),
  ('Jara Sundown',         'Jara Beach',               'Ajah',            3.5620, 6.4590, '16:00', 10000, 'beach',     'partner', 44),
  ('Freedom Park Live',    'Freedom Park',             'Lagos Island',    3.3965, 6.4489, '21:00',  3000, 'live band', 'partner', 42),
  ('Good Beach Night',     'The Good Beach',           'Lekki Phase 1',   3.5180, 6.4255, '18:00',  7500, 'beach',     'partner', 38),
  ('Brewery Friday',       'Bature Brewery',           'Lekki Phase 1',   3.4876, 6.4347, '21:00',  5000, 'rooftop',   'partner', 36),
  ('Muri Night Market',    'Muri Okunola Park',        'Victoria Island', 3.4248, 6.4291, '18:00',     0, 'food',      'partner', 32),
  ('Terra Late Show',      'Terra Kulture',            'Victoria Island', 3.4345, 6.4278, '17:00',  7500, 'live band', 'partner', 26),
  ('Gbagada House Party',  'off Diya Street',          'Gbagada',         3.3930, 6.5523, '22:00',  2000, 'afro',      'hopper',  22),
  ('Surulere Street Jam',  'Adeniran Ogunsanya',       'Surulere',        3.3496, 6.4987, '20:00',  1500, 'afro',      'hopper',  20),
  ('Festac Block Party',   '7th Avenue',               'Festac',          3.2871, 6.4663, '19:00',  2500, 'amapiano',  'hopper',  18)
)
insert into public.events (title, venue_name, area, geog, starts_at, price_naira, vibe, source, base_heat, status)
select r.title, r.venue_name, r.area,
       st_point(r.lng, r.lat)::geography,
       ((f.d::text || ' ' || r.hhmm)::timestamp at time zone 'Africa/Lagos')
         + case when r.hhmm < '06:00' then interval '1 day' else interval '0' end,
       r.price, r.vibe, r.source, r.base_heat, 'live'
from rows r cross join friday f
where not exists (select 1 from public.events e where e.title = r.title);

-- ----------------------------------------------------------------- hop -----
insert into public.hops (name, hop_date, price_naira, boarding, status)
select 'HOP 02 · FREEDOM', date '2026-10-09', 25000,
       'Board 6:00pm, bus leaves 7:00pm and does not wait', 'selling'
where not exists (select 1 from public.hops where name = 'HOP 02 · FREEDOM');

with h as (select id from public.hops where name = 'HOP 02 · FREEDOM' limit 1),
stops(idx, name, area, lng, lat, stop_time, role) as (values
  (1, 'New Afrika Shrine',      'Ikeja',         3.3449, 6.6060, '7:00pm',  'assembly point'),
  (2, 'Freedom Park',           'Lagos Island',  3.3965, 6.4489, '8:30pm',  'island warm-up'),
  (3, 'Laughter Cave, Bogobiri','Ikoyi',         3.4318, 6.4506, '10:00pm', 'comedy break'),
  (4, 'South Social',           'Lekki Phase 1', 3.4655, 6.4386, '11:30pm', 'grand finale')
)
insert into public.hop_stops (hop_id, idx, name, area, geog, stop_time, role)
select h.id, s.idx, s.name, s.area, st_point(s.lng, s.lat)::geography, s.stop_time, s.role
from stops s cross join h
on conflict (hop_id, idx) do nothing;
