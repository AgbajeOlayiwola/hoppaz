-- Gives one test Hopper 12 cards in the LOCAL database: a Rare and Epic mix over four divisions, one duplicate,
-- one city-wide card, two of them Visited. Safe to run again: it clears that Hopper's cards and stamps first.
-- The two Epics get fixed copy numbers (7 and 12) and their counters move past them, so a real draw never collides.
-- Rares take the next free number, so each run moves a Rare's counter up by one; harmless at 1,000 copies.
--
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v me=<user id> < scripts/cards/give-test-cards.sql
--
-- Needs supabase/cards.sql and cards_s1_seed.sql loaded. check-collection.mjs runs it for the E2E C Hopper.
select set_config('hoppaz.me', :'me', false);

delete from card_visits where user_id = :'me';
delete from user_cards where user_id = :'me';

update card_stock set copies_issued = greatest(copies_issued, 7) where card_id = (select id from cards where key = 'YAB-01');
update card_stock set copies_issued = greatest(copies_issued, 12) where card_id = (select id from cards where key = 'YAB-03');
insert into user_cards (user_id, card_id, copy_no, source) select :'me', id, 7, 'staff' from cards where key = 'YAB-01';
insert into user_cards (user_id, card_id, copy_no, source) select :'me', id, 12, 'staff' from cards where key = 'YAB-03';

do $$
declare k text; cid uuid; n integer;
begin
  foreach k in array array['YAB-12', 'IKD-IKO-04', 'IKD-IKO-01', 'IKJ-ONI-01'] loop
    update card_stock s set copies_issued = s.copies_issued + 1 from cards c where c.id = s.card_id and c.key = k returning s.copies_issued, c.id into n, cid;
    insert into user_cards (user_id, card_id, copy_no, source) values (current_setting('hoppaz.me')::uuid, cid, n, 'staff');
  end loop;
end $$;

insert into user_cards (user_id, card_id, source)
  select :'me', c.id, 'staff' from cards c where c.key in ('YAB-07', 'YAB-16', 'IKD-IGB-09', 'MUS-45', 'AMO-03');
insert into user_cards (user_id, card_id, source) select :'me', id, 'staff' from cards, generate_series(1, 2) where key = 'YAB-10';

insert into card_visits (user_id, card_id, visited_on, xp_paid)
  select :'me', id, public.lagos_play_day(), false from cards where key in ('YAB-01', 'YAB-07');
