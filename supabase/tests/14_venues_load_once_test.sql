-- Checks that venues load on their own (migration 0014). Runs after 01 to 13 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000014a1'''
\set u2 '''00000000-0000-0000-0000-0000000014a2'''
insert into auth.users (id) values (:u1), (:u2);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Vi', now()), (:u2, 'Wen', now());
insert into public.venues (id, name) values ('10000000-0000-0000-0000-0000000014f1', 'Load Once Bar');
insert into public.ratings (venue_id, user_id, stars, tags) values ('10000000-0000-0000-0000-0000000014f1', :u1, 4, '{Good vibe}'), ('10000000-0000-0000-0000-0000000014f1', :u2, 2, '{}');

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select public.expect(not (public.api_state() ? 'venues'), 'the regular refresh no longer carries venues');
select public.expect(public.api_state() ? 'deals' and public.api_state() ? 'friends', 'the regular refresh still carries everything else');
select public.expect((select v ->> 'average' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Load Once Bar') = '3.0', 'venue averages count everyone''s ratings');
select public.expect((select (v ->> 'ratings')::int from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Load Once Bar') = 2, 'venue rating counts are right');
select public.expect((select v ->> 'my_stars' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Load Once Bar') = '4'
  and (select v -> 'my_tags' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Load Once Bar') = '["Good vibe"]'::jsonb, 'you see your own stars and tags');
select set_config('request.jwt.claim.sub', :u2, false) \g /dev/null
select public.expect((select v ->> 'my_stars' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Load Once Bar') = '2', 'and someone else sees theirs');
select public.expect((select v ->> 'my_stars' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Lowtide Bar') = '0', 'an unrated venue shows no stars');
reset role;
set role anon;
select public.expect_error($$select public.api_venues()$$, 'signed-out visitors cannot load venues');
reset role;
select 'ALL VENUES LOAD ONCE CHECKS PASSED';
