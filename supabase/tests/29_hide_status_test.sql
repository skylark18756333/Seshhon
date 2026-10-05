-- Checks for hiding your status from some friends (migration 0029). Runs after 01 to 28 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set h1 '''00000000-0000-0000-0000-000000002901'''
\set h2 '''00000000-0000-0000-0000-000000002902'''
\set h3 '''00000000-0000-0000-0000-000000002903'''
\set h4 '''00000000-0000-0000-0000-000000002904'''
insert into auth.users (id) values (:h1), (:h2), (:h3), (:h4);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:h1, 'Hana', now(), 'HIDEHAN1'), (:h2, 'Mum', now(), 'HIDEMUM1'), (:h3, 'Mate', now(), 'HIDEMAT1'), (:h4, 'Stranger', now(), 'HIDESTR1');
-- Hana is friends with Mum and Mate. Mum and Mate are friends too.
insert into public.friendships (requester, addressee, state) values (:h1, :h2, 'accepted'), (:h1, :h3, 'accepted'), (:h2, :h3, 'accepted');
insert into public.profile_photos (user_id, picture) values (:h1, 'data:image/jpeg;base64,AAAA');

set role authenticated;
select set_config('request.jwt.claim.sub', :h2, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :h3, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :h1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.start_sesh() \g /dev/null
reset role;
select id as sesh from public.seshes where creator = :h1 and ended_at is null \gset
set role authenticated;

select public.expect_error($$select * from private.status_hides$$, 'nobody reads the hides table from the app');
select public.expect_error(format('select public.set_status_hidden(%L, true)', :h4), 'Hana cannot hide from someone who is not her friend');
select public.expect(public.set_status_hidden(:h2, true) = jsonb_build_array(:h2::uuid), 'Hana hides her status from Mum');
select public.expect(public.set_status_hidden(:h2, true) = jsonb_build_array(:h2::uuid), 'hiding twice is fine');

-- Mum sees Hana as red, can't see or join her sesh, but still sees her name and photo.
select set_config('request.jwt.claim.sub', :h2, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :h1) = 0, 'Mum no longer sees Hana''s status');
select public.expect(public.api_state() -> 'friends' @> jsonb_build_array(jsonb_build_object('name', 'Hana', 'colour', 'off')), 'to Mum, Hana just looks red and is still a friend');
select public.expect((select count(*) from public.seshes where creator = :h1) = 0, 'Mum cannot see Hana''s sesh');
select public.expect_error(format('select public.join_sesh(%L)', :'sesh'), 'Mum cannot join Hana''s sesh');
select public.expect(public.friend_photos() ? :h1, 'Mum still sees Hana''s photo, so nothing gives it away');
select public.expect(public.my_status_hides() = '[]'::jsonb, 'Mum only reads her own list, which is empty');
select public.expect((select count(*) from public.statuses where user_id = :h3) = 1, 'Mum still sees Mate as normal');

-- Mate sees nothing different.
select set_config('request.jwt.claim.sub', :h3, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :h1) = 1, 'Mate still sees Hana is green');
select public.expect((select count(*) from public.seshes where creator = :h1) = 1, 'Mate still sees Hana''s sesh');

-- Hana still sees Mum: hiding only works one way.
select set_config('request.jwt.claim.sub', :h1, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :h2) = 1, 'Hana still sees Mum''s status');

-- Showing it again.
select public.expect(public.set_status_hidden(:h2, false) = '[]'::jsonb, 'Hana shows her status to Mum again');
select set_config('request.jwt.claim.sub', :h2, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :h1) = 1, 'Mum sees Hana is green again');

-- Removing the friend forgets the hide.
select set_config('request.jwt.claim.sub', :h1, false) \g /dev/null
select public.set_status_hidden(:h3, true) \g /dev/null
reset role;
delete from public.friendships where requester = :h1 and addressee = :h3;
select public.expect(not exists (select 1 from private.status_hides where owner = :h1), 'unfriending deletes the hide');

select 'ALL HIDE STATUS CHECKS PASSED';
