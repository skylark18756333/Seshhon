-- Checks for planning on any colour (migration 0033). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set a '''00000000-0000-0000-0000-0000000033a1'''
\set b '''00000000-0000-0000-0000-0000000033a2'''
\set c '''00000000-0000-0000-0000-0000000033a3'''
insert into auth.users (id) values (:a), (:b), (:c);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:a, 'Ari', now(), 'ARIARIAR'), (:b, 'Bo', now(), 'BOBOBOBO'), (:c, 'Cy', now(), 'CYCYCYCY');
-- Ari is friends with Bo and Cy. Everyone is red to start with.
insert into public.friendships (requester, addressee, state) values (:a, :b, 'accepted'), (:a, :c, 'accepted');

set role authenticated;
-- ---- planning on red
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.set_status('off') \g /dev/null
select id as later from public.plan_sesh(now() + interval '1 day') \gset
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Ari, on red, plans a sesh and sees it');
select public.expect_error('select public.start_sesh()', 'but starting one now still needs green');

-- ---- a friend on red sees it and says they're in
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.set_status('off') \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Bo, on red, sees Ari''s planned sesh');
select public.expect(jsonb_array_length(public.api_state() -> 'seshes' -> 0 -> 'members') = 1, 'and who''s in it');
select public.join_sesh(:'later') \g /dev/null
select public.expect(public.is_sesh_member(:'later', :b), 'and says he''s in while still red');
select public.expect(jsonb_array_length(public.api_state() -> 'friends') = 1, 'his friends list is there as before');
select public.expect((public.api_state() -> 'friends' -> 0 ->> 'colour') = 'off', 'but nobody''s status shows while he''s red');

-- ---- tonight's seshes stay hidden from someone on red
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.start_sesh() \g /dev/null
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Ari, on red, sees his planned sesh but not Cy''s sesh tonight');

-- ---- starting it early needs green
select public.expect_error(format($$select public.start_planned_sesh(%L)$$, :'later'), 'Ari can''t start it early on red');
select public.set_status('on') \g /dev/null
select public.start_planned_sesh(:'later') \g /dev/null
select public.expect(not (select x ->> 'planned' from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'later')::boolean, 'on green he can');

-- ---- once live, Bo (still red) still sees the sesh he's in
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect(exists (select 1 from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'later'), 'Bo still sees the sesh he''s in after it goes live');
reset role;
select 'ALL PLAN ON ANY COLOUR CHECKS PASSED';
