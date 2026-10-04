-- Checks for Google rating look-ups (migration 0016). Runs after 01 to 15 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set g1 '''00000000-0000-0000-0000-0000000016a1'''
insert into auth.users (id) values (:g1);
insert into public.profiles (id, name, adult_confirmed_at) values (:g1, 'Gia', now());
insert into public.venues (id, name, lat, lng) values ('10000000-0000-0000-0000-0000000016f1', 'Google Bar', -31.95, 115.86);

set role authenticated;
select set_config('request.jwt.claim.sub', :g1, false) \g /dev/null
select public.expect_error($$select public.google_lookup_start('00000000-0000-0000-0000-0000000016a1', '10000000-0000-0000-0000-0000000016f1')$$, 'people cannot call the look-up counter themselves');
select public.expect_error($$select public.google_set_place('10000000-0000-0000-0000-0000000016f1', 'x')$$, 'people cannot set a Google place ID themselves');
select public.expect_error($$select * from public.google_lookups$$, 'people cannot read the look-up counts');
reset role;
set role service_role;
select public.expect((public.google_lookup_start(:g1, '10000000-0000-0000-0000-0000000016f1') ->> 'name') = 'Google Bar', 'the Edge Function gets the venue name for Google');
select public.google_set_place('10000000-0000-0000-0000-0000000016f1', 'ChIJtest') \g /dev/null
select public.expect((public.google_lookup_start(:g1, '10000000-0000-0000-0000-0000000016f1') ->> 'place') = 'ChIJtest', 'the Google place ID is remembered');
reset role;
update public.google_lookups set n = 100 where user_id = :g1;
set role service_role;
select public.expect_error($$select public.google_lookup_start('00000000-0000-0000-0000-0000000016a1', '10000000-0000-0000-0000-0000000016f1')$$, 'after 100 look-ups in a day, Google ratings pause for that person');
reset role;
select 'ALL GOOGLE RATING CHECKS PASSED';
