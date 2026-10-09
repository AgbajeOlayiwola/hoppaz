-- ============================================================================
-- Hoppaz: hotspot candidates (data only, nothing reads it yet)
-- Run after spawning.sql (it needs the areas table). Safe to run again.
-- Spec: docs/HOTSPOTS.md. Made on 9 Oct 2026 from OpenStreetMap (c) OpenStreetMap
-- contributors, ODbL, with the Overpass query and rules written in that file.
--
-- Real road junctions for Jae to pick the first hotspots from, for Yaba and Lekki
-- Phase 1 only. A junction is a point where two roads with different names meet
-- (motorway, trunk, primary, secondary or tertiary). Junctions within 60 m of each
-- other are one. Motorway and trunk are included because Lagos tags its big roads
-- that way (Herbert Macaulay Way and Lekki-Epe Expressway are trunk). Each one is inside its own area by lagos_area_for's rule (nearest
-- area centroid), outside every active no-spawn zone, at least 60 m from water and
-- 100 m from military, prison, port and airport zones, and not on a bridge or tunnel.
-- Candidates in one area are at least 250 m apart. Names are as OpenStreetMap
-- spells them ("Murtula Muhammed Way" is Murtala Muhammed Way).
--
--   rank       1 is best inside its area (road class + traffic signals + roundabout
--              + public places within 150 m)
--   label      a local name for the place, a reading of the coordinates. Jae to confirm.
--   signals    traffic signals within 60 m
--   places     bus stops, markets, fuel, banks, food, schools, worship, clinics within 150 m
--   suggested  the first picks proposed in HOTSPOTS.md
--
-- Service role only, like spawn_points. Staff turn a candidate into a hotspot
-- when the hotspots table exists (build step 1 in HOTSPOTS.md).
-- ============================================================================

create table if not exists public.hotspot_candidates (
  id          uuid primary key default gen_random_uuid(),
  area        text not null references public.areas(name) on delete cascade,
  rank        integer not null,
  label       text not null default '',
  road_a      text not null,
  class_a     text not null check (class_a in ('motorway','trunk','primary','secondary','tertiary')),
  road_b      text not null,
  class_b     text not null check (class_b in ('motorway','trunk','primary','secondary','tertiary')),
  geog        geography(point,4326) not null,
  signals     integer not null default 0,
  places      integer not null default 0,
  score       numeric not null default 0,
  suggested   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (area, rank)
);
create index if not exists hotspot_candidates_geog_idx on public.hotspot_candidates using gist(geog);

alter table public.hotspot_candidates enable row level security;
revoke all on public.hotspot_candidates from anon, authenticated;
grant all on public.hotspot_candidates to service_role;

insert into public.hotspot_candidates (area, rank, label, road_a, class_a, road_b, class_b, geog, signals, places, score, suggested)
select v.area, v.rank, v.label, v.road_a, v.class_a, v.road_b, v.class_b, st_point(v.lng, v.lat)::geography, v.signals, v.places, v.score, v.suggested
from (values
  ('Yaba', 1, 'Jibowu', 'Herbert Macaulay Street', 'trunk', 'Murtula Muhammed Way', 'primary', 6.5167, 3.36862, 3, 0, 10, true),
  ('Yaba', 2, 'Ojuelegba', 'Western Avenue', 'primary', 'Ojuelegba Road', 'primary', 6.51006, 3.36317, 4, 0, 9, true),
  ('Yaba', 3, '', 'Herbert Macaulay Street', 'trunk', 'Agege Motor Road', 'trunk', 6.51671, 3.36537, 0, 0, 9, false),
  ('Yaba', 4, '', 'Herbert Macaulay Way', 'trunk', 'Wright Street', 'trunk', 6.49136, 3.38229, 0, 0, 9, false),
  ('Yaba', 5, '', 'Wright Street', 'trunk', 'Murtula Muhammed Way', 'primary', 6.49015, 3.37967, 0, 0, 7, false),
  ('Yaba', 6, '', 'Murtula Muhammed Way', 'primary', 'Ikorodu Road', 'primary', 6.51885, 3.36778, 0, 0, 6, false),
  ('Yaba', 7, 'Yaba market side', 'Murtula Muhammed Way', 'primary', 'Commercial Avenue', 'tertiary', 6.50575, 3.37336, 0, 4, 5.6, true),
  ('Yaba', 8, '', 'Itire Road', 'primary', 'Ishaga Road', 'secondary', 6.51174, 3.35895, 0, 0, 5, false),
  ('Yaba', 9, 'UNILAG Akoka gate', 'Akoka Road', 'primary', 'University Road', 'secondary', 6.51767, 3.38445, 0, 0, 5, false),
  ('Yaba', 10, '', 'Makoko Road', 'tertiary', 'Church Street', 'tertiary', 6.49604, 3.38696, 0, 6, 4.4, false),
  ('Yaba', 11, '', 'Bajulaye Road', 'secondary', 'Alakija Street', 'secondary', 6.52122, 3.37088, 0, 1, 4.4, false),
  ('Yaba', 12, '', 'University Road', 'primary', 'Birikisu Iyede Street', 'tertiary', 6.51681, 3.38114, 0, 0, 4, false),
  ('Yaba', 13, '', 'Alakija Street', 'secondary', 'Hussey Road', 'secondary', 6.51902, 3.37176, 0, 0, 4, false),
  ('Yaba', 14, '', 'Iwaya Road', 'tertiary', 'Olumo Street', 'tertiary', 6.50984, 3.38556, 0, 1, 2.4, false),
  ('Yaba', 15, '', 'Eletu Odibo Street', 'tertiary', 'Fola Agoro Street', 'tertiary', 6.52329, 3.38013, 0, 0, 2, false),
  ('Yaba', 16, '', 'Akinpelu Adesola Road', 'tertiary', 'Tafawa Balewa Way', 'tertiary', 6.51376, 3.3974, 0, 0, 2, false),
  ('Yaba', 17, '', 'International School Road', 'tertiary', 'Olumo Street', 'tertiary', 6.51118, 3.38835, 0, 0, 2, false),
  ('Yaba', 18, '', 'Aje Street', 'tertiary', 'Commercial Avenue', 'tertiary', 6.50603, 3.37756, 0, 0, 2, false),
  ('Lekki Phase 1', 1, 'Phase 1 Freedom Way', 'Lekki-Epe Expressway', 'trunk', 'Freedom Way', 'primary', 6.43307, 3.48222, 4, 4, 11.6, true),
  ('Lekki Phase 1', 2, '', 'Lekki-Epe Expressway', 'trunk', 'Kusenla Road', 'tertiary', 6.43421, 3.49089, 2, 4, 9.6, false),
  ('Lekki Phase 1', 3, '', 'Ikoyi Bridge Roundabout', 'primary', 'Admiralty Way', 'primary', 6.44677, 3.46119, 0, 1, 8.4, false),
  ('Lekki Phase 1', 4, '', 'Admiralty Way', 'primary', 'Bisola Durosimi Etti Drive', 'secondary', 6.43723, 3.45666, 0, 3, 7.2, false),
  ('Lekki Phase 1', 5, '', 'Lekki-Epe Expressway', 'trunk', 'Remi Olowude Way', 'secondary', 6.43076, 3.46809, 0, 2, 6.8, false),
  ('Lekki Phase 1', 6, '', 'Lekki-Epe Expressway', 'trunk', 'Akiogun Road', 'secondary', 6.43444, 3.45683, 0, 2, 6.8, false),
  ('Lekki Phase 1', 7, '', 'Lagos-Calabar Coastal Highway', 'trunk', 'Remi Olowude Way', 'secondary', 6.42547, 3.46828, 0, 0, 6, false),
  ('Lekki Phase 1', 8, '', 'Lekki-Epe Expressway', 'trunk', 'Hakeem Dickson Road', 'secondary', 6.43192, 3.47463, 0, 0, 6, false),
  ('Lekki Phase 1', 9, '', 'Lekki-Epe Expressway', 'trunk', 'Meadow Holloway Street', 'tertiary', 6.43359, 3.48794, 0, 0, 6, false),
  ('Lekki Phase 1', 10, '', 'Admiralty Way', 'primary', 'Freedom Way', 'primary', 6.44787, 3.48183, 0, 0, 6, false),
  ('Lekki Phase 1', 11, 'Phase 1 Admiralty Way', 'Admiralty Way', 'primary', 'Fatai Idowu Arobieke Street', 'tertiary', 6.44787, 3.47021, 0, 3, 5.2, true),
  ('Lekki Phase 1', 12, '', 'Admiralty Way', 'primary', 'Adebayo Doherty Road', 'tertiary', 6.44718, 3.46411, 0, 1, 4.4, false),
  ('Lekki Phase 1', 13, '', 'Bisola Durosimi Etti Drive', 'secondary', 'Hakeem Dickson Road', 'secondary', 6.43712, 3.47457, 0, 0, 4, false),
  ('Lekki Phase 1', 14, '', 'Bisola Durosimi Etti Drive', 'secondary', 'Adewunmi Adebimpe Street', 'secondary', 6.43711, 3.46879, 0, 0, 4, false),
  ('Lekki Phase 1', 15, '', 'Princely Court Road', 'secondary', 'Akiogun Road', 'secondary', 6.42591, 3.45714, 0, 0, 4, false),
  ('Lekki Phase 1', 16, '', 'Oniru Estate', 'tertiary', 'Water Corporation Road', 'tertiary', 6.42408, 3.45005, 0, 0, 3, false),
  ('Lekki Phase 1', 17, '', 'Bisola Durosimi Etti Drive', 'secondary', 'Adebayo Doherty Road', 'tertiary', 6.43714, 3.46408, 0, 0, 3, false),
  ('Lekki Phase 1', 18, '', 'Emma Abimbola Cole Street', 'tertiary', 'Freedom Way', 'tertiary', 6.44265, 3.48172, 0, 2, 2.8, false),
  ('Lekki Phase 1', 19, '', 'Fatai Idowu Arobieke Street', 'tertiary', 'Admiralty Road', 'tertiary', 6.45937, 3.47183, 0, 0, 2, false),
  ('Lekki Phase 1', 20, '', 'Adebayo Doherty Road', 'tertiary', 'Fola Osibo Street', 'tertiary', 6.44267, 3.46412, 0, 0, 2, false),
  ('Lekki Phase 1', 21, '', '2nd Avenue', 'tertiary', '3rd Avenue', 'tertiary', 6.45616, 3.46179, 0, 0, 2, false),
  ('Lekki Phase 1', 22, '', 'The Providence Street', 'tertiary', 'Otunba Adedoyin Ogungbe Crescent', 'tertiary', 6.43194, 3.46015, 0, 0, 2, false),
  ('Lekki Phase 1', 23, '', 'Hakeem Dickson Road', 'tertiary', 'Emma Abimbola Cole Street', 'tertiary', 6.44261, 3.47461, 0, 0, 2, false)
) as v(area, rank, label, road_a, class_a, road_b, class_b, lat, lng, signals, places, score, suggested)
on conflict (area, rank) do update
  set label = excluded.label, road_a = excluded.road_a, class_a = excluded.class_a, road_b = excluded.road_b,
      class_b = excluded.class_b, geog = excluded.geog, signals = excluded.signals, places = excluded.places,
      score = excluded.score, suggested = excluded.suggested;
