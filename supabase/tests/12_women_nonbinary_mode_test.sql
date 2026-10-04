-- Checks that women-only mode includes non-binary people (migration 0012). Runs after 01 to 11 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set n1 '''00000000-0000-0000-0000-000000000c01'''
\set n2 '''00000000-0000-0000-0000-000000000c02'''
\set w1 '''00000000-0000-0000-0000-000000000c03'''
\set m1 '''00000000-0000-0000-0000-000000000c04'''
\set m2 '''00000000-0000-0000-0000-000000000c05'''
insert into auth.users (id) values (:n1), (:n2), (:w1), (:m1), (:m2);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:n1, 'Nico', now(), 'NICONICO'), (:n2, 'Noor', now(), 'NOORNOOR'), (:w1, 'Wynn', now(), 'WYNNWYNN'), (:m1, 'Mack', now(), 'MACKMACK'), (:m2, 'Moss', now(), 'MOSSMOSS');
insert into public.friendships (requester, addressee, state) values (:n1, :w1, 'accepted'), (:n1, :m1, 'accepted');

set role authenticated;
select set_config('request.jwt.claim.sub', :w1, false) \g /dev/null
select public.set_safety('woman', false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect_error($$select public.set_safety('man', true)$$, 'men still cannot turn the mode on');
select public.expect_error($$select public.set_safety(null, true)$$, 'nor can someone who has not given a gender');

select set_config('request.jwt.claim.sub', :n1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect(public.set_safety('nonbinary', true) ->> 'women_only' = 'true', 'a non-binary person can turn the mode on');
select set_config('request.jwt.claim.sub', :w1, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :n1) = 1, 'a woman friend still sees Nico');
select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :n1) = 0, 'a man friend does not');
select set_config('request.jwt.claim.sub', :m2, false) \g /dev/null
select public.set_safety('man', false) \g /dev/null
select public.expect_error($$select public.request_friend('NICONICO')$$, 'a man cannot add Nico');
select set_config('request.jwt.claim.sub', :n2, false) \g /dev/null
select public.set_safety('nonbinary', false) \g /dev/null
select public.expect(public.request_friend('NICONICO') ->> 'state' = 'requested', 'another non-binary person can add Nico');
select public.expect(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'in_safe_group'), 'the new helper is outside the public schema too');
reset role;
select 'ALL WOMEN AND NON-BINARY MODE CHECKS PASSED';
