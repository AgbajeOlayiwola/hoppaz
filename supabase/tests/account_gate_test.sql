-- ============================================================================
-- Hoppaz: account gate tests (welcome boxes open without an account)
-- Run against a LOCAL database that has schema.sql, chat_accounts.sql,
-- hunt_items.sql and spawning.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/account_gate_test.sql
--
-- One transaction that always rolls back. The last line printed is
-- ALL ACCOUNT GATE TESTS PASSED.
-- ============================================================================
begin;

create function pg_temp.eq(p_got text, p_want text, p_msg text) returns void language plpgsql as $f$
begin
  if p_got is distinct from p_want then raise exception 'TEST FAILED: % (got %, wanted %)', p_msg, p_got, p_want; end if;
end $f$;

create temp table fx (name text primary key, id uuid);
grant all on fx to public;

-- Water guard off for the fixtures only; a land point in Yaba.
alter table public.game_drops disable trigger game_drops_guard;

do $$
declare anon_id uuid := gen_random_uuid(); acct_id uuid := gen_random_uuid(); w uuid; s uuid; w2 uuid; st uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (anon_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, '{}', '{}', now(), now()),
         (acct_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gatetest-' || acct_id || '@gatetest.invalid', false, '{}', '{}', now(), now());
  insert into public.profiles (id) values (anon_id), (acct_id) on conflict do nothing;
  insert into game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id)
  values ('gate welcome', st_point(3.3790, 6.5158)::geography, now() - interval '1 min', now() + interval '1 hour', 60, 'proximity', 1, 'fixed', 'welcome', anon_id) returning id into w;
  insert into game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind)
  values ('gate street', st_point(3.3790, 6.5158)::geography, now() - interval '1 min', now() + interval '1 hour', 60, 'proximity', 5, 'fixed', 'spawn') returning id into s;
  insert into game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind)
  values ('gate staff', st_point(3.3790, 6.5158)::geography, now() - interval '1 min', now() + interval '1 hour', 60, 'proximity', 5, 'fixed', 'staff') returning id into st;
  insert into game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, owner_id)
  values ('gate welcome of the account holder', st_point(3.3790, 6.5158)::geography, now() - interval '1 min', now() + interval '1 hour', 60, 'proximity', 1, 'fixed', 'welcome', acct_id) returning id into w2;
  insert into drop_rewards (drop_id, reward_type, title, xp_amount) select id, 'xp', 'x', 50 from game_drops where id in (w, s, st, w2);
  insert into fx values ('anon', anon_id), ('acct', acct_id), ('welcome', w), ('street', s), ('staff', st), ('welcome_acct', w2);
end $$;

create function pg_temp.claim_as(p_user text, p_drop text) returns text language plpgsql as $f$
declare u uuid; d uuid; r jsonb;
begin
  select id into u from fx where name = p_user; select id into d from fx where name = p_drop;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    r := public.claim_game_drop(d, 6.5158, 3.3790, null);
    execute 'reset role';
    return coalesce(r->>'ok', '?') || ' ' || coalesce(r->>'reason', '');
  exception when others then
    execute 'reset role';
    return 'EXC ' || sqlerrm;
  end;
end $f$;

select pg_temp.eq(pg_temp.claim_as('anon', 'welcome'), 'true ', 'an anonymous Hopper opens their own welcome box');
select pg_temp.eq((select xp::text from profiles where id = (select id from fx where name = 'anon')), '50', 'and the XP lands on the same user, so signing up keeps it');
select pg_temp.eq(pg_temp.claim_as('anon', 'welcome_acct'), 'false not_yours', 'an anonymous Hopper cannot open someone elses welcome box');
select pg_temp.eq(pg_temp.claim_as('anon', 'street'), 'EXC need_account', 'an anonymous Hopper cannot open a street box');
select pg_temp.eq(pg_temp.claim_as('anon', 'staff'), 'EXC need_account', 'an anonymous Hopper cannot open a venue drop');
select pg_temp.eq(pg_temp.claim_as('acct', 'street'), 'true ', 'an account holder opens a street box');
select pg_temp.eq(pg_temp.claim_as('acct', 'welcome_acct'), 'true ', 'an account holder opens their own welcome box');

select 'ALL ACCOUNT GATE TESTS PASSED';
rollback;
