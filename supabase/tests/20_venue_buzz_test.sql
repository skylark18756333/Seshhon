-- Checks busy and trending venues for the map (migration 0020). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000020a1'''
\set u2 '''00000000-0000-0000-0000-0000000020a2'''
\set u3 '''00000000-0000-0000-0000-0000000020a3'''
\set busy '''10000000-0000-0000-0000-0000000020f1'''
\set lone '''10000000-0000-0000-0000-0000000020f2'''
\set hot '''10000000-0000-0000-0000-0000000020f3'''
\set old '''10000000-0000-0000-0000-0000000020f4'''
\set gone '''10000000-0000-0000-0000-0000000020f5'''
insert into auth.users (id) values (:u1), (:u2), (:u3);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Bo', now()), (:u2, 'Cy', now()), (:u3, 'Di', now());
insert into public.venues (id, name) values (:busy, 'Buzz Bar'), (:lone, 'Lone Bar'), (:hot, 'Hot Bar'), (:old, 'Old Bar'), (:gone, 'Gone Bar');

-- A live sesh where two people voted for Buzz Bar, a live sesh where one person voted for Lone Bar,
-- and a sesh from 9 hours ago where two people voted for Gone Bar.
insert into public.seshes (id, creator) values ('20000000-0000-0000-0000-0000000020c1', :u1), ('20000000-0000-0000-0000-0000000020c2', :u3);
insert into public.seshes (id, creator, created_at) values ('20000000-0000-0000-0000-0000000020c3', :u1, now() - interval '9 hours');
insert into public.sesh_members (sesh_id, user_id) values
  ('20000000-0000-0000-0000-0000000020c1', :u1), ('20000000-0000-0000-0000-0000000020c1', :u2), ('20000000-0000-0000-0000-0000000020c2', :u3),
  ('20000000-0000-0000-0000-0000000020c3', :u1), ('20000000-0000-0000-0000-0000000020c3', :u2);
insert into public.venue_votes (sesh_id, user_id, venue_id) values
  ('20000000-0000-0000-0000-0000000020c1', :u1, :busy), ('20000000-0000-0000-0000-0000000020c1', :u2, :busy),
  ('20000000-0000-0000-0000-0000000020c2', :u3, :lone),
  ('20000000-0000-0000-0000-0000000020c3', :u1, :gone), ('20000000-0000-0000-0000-0000000020c3', :u2, :gone);
-- Hot Bar: two ratings this week. Old Bar: two ratings from last month.
insert into public.ratings (venue_id, user_id, stars) values (:hot, :u1, 5), (:hot, :u2, 4);
insert into public.ratings (venue_id, user_id, stars, updated_at) values (:old, :u1, 5, now() - interval '30 days'), (:old, :u2, 5, now() - interval '30 days');

set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false) \g /dev/null
select public.expect(((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :busy) ->> 'busy')::int = 1, 'a venue two people in a live sesh are heading to glows');
select public.expect((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :lone) is null, 'one person heading somewhere never shows, so a glow can''t point at them');
select public.expect((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :gone) is null, 'a sesh older than 8 hours does not count');
select public.expect(((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :hot) ->> 'trending')::boolean, 'two ratings this week make a venue trending');
select public.expect((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :old) is null, 'old ratings do not');
select public.expect(not exists (select 1 from jsonb_array_elements(public.api_buzz()) b, jsonb_object_keys(b) k where k not in ('id', 'busy', 'trending')),
  'only counts come back, never who');
-- Locking in counts everyone in the sesh, not just voters.
reset role;
update public.seshes set locked_venue = :lone where id = '20000000-0000-0000-0000-0000000020c1';
set role authenticated;
select public.expect(((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :lone) ->> 'busy')::int = 1, 'a locked-in venue counts everyone in that sesh');
select public.expect((select b from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :busy) is null, 'votes stop counting once the sesh locks in somewhere else');
reset role;
set role anon;
select public.expect_error($$select public.api_buzz()$$, 'signed-out visitors cannot see busy venues');
reset role;
select 'ALL VENUE BUZZ CHECKS PASSED';
