-- Checks levels, XP, badges and the friend profile (0040). Any failed check stops the script with an error.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

\set p1 '''00000000-0000-0000-0000-000000004001'''
\set p2 '''00000000-0000-0000-0000-000000004002'''
\set p3 '''00000000-0000-0000-0000-000000004003'''
\set p4 '''00000000-0000-0000-0000-000000004004'''
insert into auth.users (id) values (:p1), (:p2), (:p3), (:p4);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:p1, 'Pia', now(), 'PROFPIA1'), (:p2, 'Max', now(), 'PROFMAX1'), (:p3, 'Lou', now(), 'PROFLOU1'), (:p4, 'Stranger', now(), 'PROFSTR1');
insert into public.friendships (requester, addressee, state) values (:p1, :p2, 'accepted'), (:p1, :p3, 'accepted'), (:p2, :p3, 'accepted');

set role authenticated;
select set_config('request.jwt.claim.sub', :p2, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :p1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.start_sesh() \g /dev/null
reset role;
select id as sesh from public.seshes where creator = :p1 and ended_at is null \gset
set role authenticated;

select public.expect_error($$select * from private.xp$$, 'nobody reads the XP table from the app');
select public.expect((public.friend_profile(:p1) ->> 'xp')::int = 0, 'starting a sesh on your own earns nothing');

select set_config('request.jwt.claim.sub', :p2, false) \g /dev/null
select public.join_sesh(:'sesh') \g /dev/null
select public.expect((public.friend_profile(:p2) ->> 'xp')::int = 50, 'Max gets 50 XP for joining Pia''s sesh');
select public.expect(public.friend_profile(:p2) -> 'badges' ? 'first_round', 'Max earns the first round badge');
select public.expect((public.friend_profile(:p1) ->> 'xp')::int = 20, 'Pia gets 20 XP because a friend joined');
select public.expect(public.friend_profile(:p1) ->> 'colour' = 'on', 'Max sees Pia is green');
select public.expect((public.friend_profile(:p1) ->> 'mutual')::int = 1, 'Pia and Max have one friend in common');
select public.expect(jsonb_array_length(public.friend_profile(:p1) -> 'together') = 1, 'Max sees the sesh they are both in');

reset role;
delete from public.sesh_members where sesh_id = :'sesh' and user_id = :p2;
set role authenticated;
select public.join_sesh(:'sesh') \g /dev/null
select public.expect((public.friend_profile(:p2) ->> 'xp')::int = 50, 'leaving and joining again earns nothing more');

-- Hidden status, amber and red are never leaked.
select set_config('request.jwt.claim.sub', :p1, false) \g /dev/null
select public.set_status_hidden(:p2, true) \g /dev/null
select set_config('request.jwt.claim.sub', :p2, false) \g /dev/null
select public.expect(public.friend_profile(:p1) ->> 'colour' = 'off', 'a friend Pia hides from sees her as red');
select set_config('request.jwt.claim.sub', :p1, false) \g /dev/null
select public.set_status_hidden(:p2, false) \g /dev/null
select public.set_status('thinking') \g /dev/null
select set_config('request.jwt.claim.sub', :p2, false) \g /dev/null
select public.expect(public.friend_profile(:p1) ->> 'colour' = 'off', 'amber stays hidden until Pia allows it');
select set_config('request.jwt.claim.sub', :p1, false) \g /dev/null
select public.set_amber_allowed(:p2, true) \g /dev/null
select set_config('request.jwt.claim.sub', :p2, false) \g /dev/null
select public.expect(public.friend_profile(:p1) ->> 'colour' = 'thinking', 'amber shows once Pia allows Max');

-- Only friends.
select set_config('request.jwt.claim.sub', :p4, false) \g /dev/null
select public.expect_error(format('select public.friend_profile(%L)', :p1), 'a stranger cannot open Pia''s profile');
select public.expect_error('select public.friend_profile(null)', 'no friend picked is refused');
reset role;
update public.friendships set state = 'blocked' where requester = :p1 and addressee = :p3;
set role authenticated;
select set_config('request.jwt.claim.sub', :p3, false) \g /dev/null
select public.expect_error(format('select public.friend_profile(%L)', :p1), 'a blocked person cannot open Pia''s profile');

select public.expect(public.set_about('Good vibes only') ->> 'about' = 'Good vibes only', 'Lou sets an about line');
select public.expect_error($$select public.set_about(repeat('x', 81))$$, 'about lines over 80 characters are refused');

-- Daily cap.
reset role;
select private.add_xp(:p3, 1000, 0, 0, 0);
select public.expect((select points from private.xp where user_id = :p3) = 300, 'no more than 300 XP a day');

-- The marker that stops double counting goes with the sesh.
delete from public.seshes where id = :'sesh';
select public.expect(not exists (select 1 from private.xp_seen where sesh_id = :'sesh'), 'nothing about the sesh is kept after it is deleted');

select 'ALL FRIEND PROFILE CHECKS PASSED';
