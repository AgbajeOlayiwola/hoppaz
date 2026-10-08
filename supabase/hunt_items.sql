-- ============================================================================
-- Hoppaz: camera-hunt collectibles
-- Run in the Supabase SQL editor after schema.sql. Safe to run again.
--
-- Five 3D items (drawn in src/lib/huntModels.ts) that staff hide at events. A
-- game drop with a hunt_item is found through the camera (CameraHunt) and
-- claimed with the drop's usual checks: inside the drop radius, while it is
-- open, once per Hopper. The reward is whatever the drop's reward pool holds;
-- the item itself lands in the Hopper's collection.
-- ============================================================================

alter table public.game_drops add column if not exists hunt_item text;
alter table public.game_drops drop constraint if exists game_drops_hunt_item_check;
alter table public.game_drops add constraint game_drops_hunt_item_check
  check (hunt_item is null or hunt_item in ('golden-danfo', 'jollof-pot', 'gangan-drum', 'golden-cowrie', 'eko-disco-ball'));

-- The items as collectibles, so a drop's reward can point at one.
insert into public.collectibles (key, name, description, emoji) values
  ('golden-danfo',   'Golden Danfo',        'The yellow bus that runs Lagos, dipped in gold. Legendary.', '🚌'),
  ('jollof-pot',     'Party Jollof Pot',    'Smoky party jollof, straight off the firewood. Common.', '🍲'),
  ('gangan-drum',    'Gangan Talking Drum', 'Squeeze the cords and it talks. Rare.', '🪘'),
  ('golden-cowrie',  'Golden Cowrie',       'Money before money, in gold. Epic.', '🐚'),
  ('eko-disco-ball', 'Eko Disco Ball',      'Every Island rooftop has one spinning somewhere. Rare.', '🪩')
on conflict (key) do update set name = excluded.name, description = excluded.description, emoji = excluded.emoji;

-- Your claimed drops, now saying which hunt item each one was.
drop function if exists public.my_drop_claims();
create function public.my_drop_claims()
returns table(drop_id uuid, title text, partner text, reward text, description text, code text, claimed_at timestamptz, hunt_item text, event_title text)
language sql stable security definer set search_path = public as $$
 select c.drop_id, d.title, p.name, r.title, r.description, v.code, c.claimed_at, d.hunt_item, e.title
 from drop_claims c
 join game_drops d on d.id = c.drop_id
 left join events e on e.id = d.event_id
 left join partners p on p.id = d.partner_id
 left join drop_rewards r on r.id = c.reward_id
 left join drop_reward_codes v on v.reward_id = r.id and v.claimed_by = c.user_id
 where c.user_id = auth.uid() order by c.claimed_at desc;
$$;
