-- Checks for the second migration: invite links, privacy of the helpers, and the app's one-call state.
-- Continues from 01_rules_test.sql, so Ana (a) and Ben (b) are friends, Cal (c) is a stranger.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set a '''00000000-0000-0000-0000-00000000000a'''
\set b '''00000000-0000-0000-0000-00000000000b'''
\set c '''00000000-0000-0000-0000-00000000000c'''
\set s '''00000000-0000-0000-0000-00000000000d'''

-- ---- signed-out visitors
set role anon;
select public.expect_error($$select public.api_state()$$, 'a signed-out visitor cannot load the app state');
select public.expect_error($$select public.are_friends('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')$$, 'a signed-out visitor cannot ask who is friends');
select public.expect_error($$select * from public.venues$$, 'a signed-out visitor cannot read venues');
reset role;

-- ---- helpers only answer about the person asking
set role authenticated;
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect(not public.are_friends(:a, :b), 'a stranger cannot check whether two other people are friends');
select public.expect_error($$select push_token from public.profiles$$, 'nobody can read push tokens');
select public.expect_error($$select adult_confirmed_at from public.profiles$$, 'nobody can read sign-up details');
select public.expect_error($$update public.profiles set invite_code = 'AAAAAAAA'$$, 'you cannot choose your own invite code');

-- ---- invite links
select public.expect_error($$select public.request_friend('NOTACODE')$$, 'a made-up invite code is refused');
reset role;
select invite_code as a_code from public.profiles where id = :a \gset
select invite_code as c_code from public.profiles where id = :c \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect_error('select public.request_friend(' || quote_literal(:'c_code') || ')', 'your own invite code is refused');
select public.expect((select public.request_friend(lower(:'a_code')) ->> 'state') = 'requested', 'opening an invite link sends a request');
select public.expect((public.api_state() -> 'friends') = '[]'::jsonb, 'a request alone does not make you friends');
select public.expect(jsonb_array_length(public.api_state() -> 'requests_out') = 1, 'the request shows as waiting');

select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect((public.api_state() -> 'requests_in' -> 0 ->> 'name') = 'Cal', 'the person invited sees who asked');
select (public.api_state() -> 'requests_in' -> 0 ->> 'friendship') as req \gset
select public.answer_friend(:'req', true) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'friends') = 2, 'accepting makes you friends');

-- two people opening each other's links become friends without a second step
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
select public.request_friend(:'c_code') \g /dev/null
reset role;
select invite_code as s_code from public.profiles where id = :s \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect((select public.request_friend(:'s_code') ->> 'state') = 'accepted', 'opening each other''s links makes you friends straight away');

-- removing a friend
select (select f ->> 'friendship' from jsonb_array_elements(public.api_state() -> 'friends') f where f ->> 'name' = 'Staff') as sf \gset
select public.answer_friend(:'sf', false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'friends') = 1, 'either person can remove a friend');

-- ---- app state respects the access rules
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select colour from public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect((select f ->> 'colour' from jsonb_array_elements(public.api_state() -> 'friends') f where f ->> 'name' = 'Ana') = 'off', 'while you are Off, friends all read as Off');
select public.expect((public.api_state() -> 'seshes') = '[]'::jsonb, 'while you are Off, you cannot see friends'' seshes');
select colour from public.set_status('on') \g /dev/null
select public.expect((select f ->> 'colour' from jsonb_array_elements(public.api_state() -> 'friends') f where f ->> 'name' = 'Ana') = 'on', 'once you are On, you see a friend who is On');
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
select public.expect((public.api_state() -> 'friends') = '[]'::jsonb and (public.api_state() -> 'seshes') = '[]'::jsonb, 'a stranger sees no friends and no seshes');
select public.expect(jsonb_array_length(public.api_state() -> 'staff_venues') = 1, 'staff see which venue they work at');
select public.expect(jsonb_array_length(public.api_state() -> 'deals') >= 6 and jsonb_array_length(public.api_state() -> 'venues') >= 3, 'everyone sees venues and deals');

-- ---- sesh actions
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
-- Ana still has the locked sesh from the first test file; end it so a fresh one starts.
select public.end_sesh((public.api_state() -> 'seshes' -> 0 ->> 'id')::uuid) \g /dev/null
select id as sesh1 from public.start_sesh() \gset
select public.expect((select id from public.start_sesh()) = :'sesh1', 'starting again returns the sesh you already have');
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
select public.expect_error('select public.join_sesh(' || quote_literal(:'sesh1') || ')', 'a stranger cannot join through the app either');
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.join_sesh(:'sesh1') \g /dev/null
select public.cast_vote(:'sesh1', 'a0000000-0000-4000-8000-000000000002') \g /dev/null
select public.cast_vote(:'sesh1', 'a0000000-0000-4000-8000-000000000003') \g /dev/null
select public.expect((select count(*) from public.venue_votes where sesh_id = :'sesh1' and user_id = :c) = 1, 'changing your vote keeps one vote');
select public.expect_error('select public.end_sesh(' || quote_literal(:'sesh1') || ')', 'only the starter can end the sesh');
select public.expect((public.api_state() -> 'seshes' -> 0 -> 'members' -> 0 ->> 'name') = 'Ana', 'members can see each other''s names');
select public.leave_sesh(:'sesh1') \g /dev/null
select public.expect((select count(*) from public.venue_votes where sesh_id = :'sesh1' and user_id = :c) = 0, 'leaving takes your vote with you');
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.end_sesh(:'sesh1') \g /dev/null
select public.expect((public.api_state() -> 'seshes') = '[]'::jsonb, 'an ended sesh disappears');
select public.expect_error('select public.cast_vote(' || quote_literal(:'sesh1') || ', ''a0000000-0000-4000-8000-000000000002'')', 'no voting after a sesh ends');

-- ---- ratings through the app
select public.rate_venue('a0000000-0000-4000-8000-000000000002', 5, array['Good vibe']) \g /dev/null
select public.rate_venue('a0000000-0000-4000-8000-000000000002', 3, array['Good value']) \g /dev/null
select public.expect((select v ->> 'my_stars' from jsonb_array_elements(public.api_state() -> 'venues') v where v ->> 'name' = 'Bodega Nine') = '3', 'rating again replaces your earlier rating');
select public.expect_error($$select public.rate_venue('a0000000-0000-4000-8000-000000000002', 4, array['a','b','c','d','e','f'])$$, 'too many tags are refused');

-- ---- deleting an account
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.delete_account() \g /dev/null
reset role;
select public.expect((select count(*) from public.profiles where id = :c) = 0 and (select count(*) from public.friendships where requester = :c or addressee = :c) = 0, 'deleting an account removes the profile and friendships');
select 'ALL LIVE APP DATABASE CHECKS PASSED';
