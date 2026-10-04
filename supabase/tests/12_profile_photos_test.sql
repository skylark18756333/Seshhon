-- Checks for profile photos (migration 0012). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set p1 '''00000000-0000-0000-0000-000000000c01'''
\set p2 '''00000000-0000-0000-0000-000000000c02'''
\set p3 '''00000000-0000-0000-0000-000000000c03'''
\set p4 '''00000000-0000-0000-0000-000000000c04'''
insert into auth.users (id) values (:p1), (:p2), (:p3), (:p4);
insert into public.profiles (id, name, adult_confirmed_at) values (:p1, 'Pia', now()), (:p2, 'Quin', now()), (:p3, 'Rae', now()), (:p4, 'Stranger', now());
-- Pia and Quin are friends, Pia and Rae are friends but Rae blocked Pia, Stranger is nobody's friend.
insert into public.friendships (requester, addressee, state) values (:p1, :p2, 'accepted'), (:p1, :p3, 'accepted');
insert into public.blocks (blocker, blocked) values (:p3, :p1);
\set pic '''data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='''

set role authenticated;
select set_config('request.jwt.claim.sub', :p2, false) \g /dev/null
select public.set_photo(:pic) \g /dev/null
select set_config('request.jwt.claim.sub', :p3, false) \g /dev/null
select public.set_photo(:pic) \g /dev/null
select set_config('request.jwt.claim.sub', :p4, false) \g /dev/null
select public.set_photo(:pic) \g /dev/null
select set_config('request.jwt.claim.sub', :p1, false) \g /dev/null
select public.expect(public.friend_photos() = '{}'::jsonb or not (public.friend_photos() ? :p1), 'no photo yet for Pia');
select public.set_photo(:pic) \g /dev/null
select public.expect(public.friend_photos() ? :p1, 'Pia sees her own photo');
select public.expect(public.friend_photos() ? :p2, 'Pia sees her friend Quin''s photo');
select public.expect(not (public.friend_photos() ? :p3), 'a friend who blocked Pia keeps their photo from her');
select public.expect(not (public.friend_photos() ? :p4), 'a stranger''s photo stays hidden');
select public.expect_error($$select public.set_photo('<script>')$$, 'something that is not a JPEG photo is refused');
select public.expect_error($$select public.set_photo('data:image/jpeg;base64,' || repeat('A', 70000))$$, 'an oversized photo is refused');
select public.expect_error($$select * from public.profile_photos$$, 'the photo table cannot be read directly');
select public.set_photo(null) \g /dev/null
select public.expect(not (public.friend_photos() ? :p1), 'Pia can remove her photo');
select set_config('request.jwt.claim.sub', :p3, false) \g /dev/null
select public.expect(not (public.friend_photos() ? :p1), 'Rae, who blocked Pia, does not get her photo either');
reset role;
set role anon;
select public.expect_error($$select public.friend_photos()$$, 'signed-out visitors cannot read photos');
reset role;
select 'ALL PROFILE PHOTO CHECKS PASSED';
