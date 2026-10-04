-- Checks for women-only mode and blocking a request (migration 0011). Runs after 01 to 10 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set w1 '''00000000-0000-0000-0000-000000000b01'''
\set w2 '''00000000-0000-0000-0000-000000000b02'''
\set m1 '''00000000-0000-0000-0000-000000000b03'''
\set m2 '''00000000-0000-0000-0000-000000000b04'''
\set q1 '''00000000-0000-0000-0000-000000000b05'''
insert into auth.users (id) values (:w1), (:w2), (:m1), (:m2), (:q1);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:w1, 'Wren', now(), 'WRENWREN'), (:w2, 'Willa', now(), 'WILLAWIL'), (:m1, 'Max', now(), 'MAXMAXMA'),
  (:m2, 'Milo', now(), 'MILOMILO'), (:q1, 'Quinn', now(), 'QUINNQUI');
-- Wren is friends with Willa and Max. Quinn has asked Wren to be friends.
insert into public.friendships (requester, addressee, state) values (:w1, :w2, 'accepted'), (:w1, :m1, 'accepted'), (:q1, :w1, 'requested');

set role authenticated;
select set_config('request.jwt.claim.sub', :w2, false) \g /dev/null
select public.set_safety('woman', false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect_error($$select public.set_safety('man', true)$$, 'only women can switch on women-only mode');
select public.expect_error($$select public.set_safety('robot', false)$$, 'an unknown gender is refused');
select public.expect_error($$select * from private.safety$$, 'nobody reads the gender table from the app');
select public.expect(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'hidden_from_me'), 'the helper is outside the public schema, so the app''s API cannot call it');

-- Wren goes On and starts a sesh. Max joins before she switches on women-only mode.
select set_config('request.jwt.claim.sub', :w1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.start_sesh() \g /dev/null
reset role;
select id as sesh from public.seshes where creator = :w1 and ended_at is null \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.join_sesh(:'sesh') \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :w1) = 1, 'before: Max sees Wren is green');

select set_config('request.jwt.claim.sub', :w1, false) \g /dev/null
select public.expect(public.set_safety('woman', true) = '{"gender": "woman", "women_only": true}'::jsonb, 'Wren switches on women-only mode');
select public.expect(public.my_safety() ->> 'women_only' = 'true', 'Wren reads back her own setting');
select public.expect((select count(*) from public.friendships where addressee = :w1 and state = 'requested') = 0, 'Quinn''s pending request is dropped');
select public.expect((select count(*) from public.sesh_members where sesh_id = :'sesh' and user_id = :m1) = 0, 'Max is taken out of Wren''s sesh');

select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :w1) = 0, 'Max no longer sees Wren''s status');
select public.expect((select count(*) from public.seshes where creator = :w1) = 0, 'Max no longer sees Wren''s sesh');
select public.expect((select count(*) from public.sesh_members where sesh_id = :'sesh') = 0, 'Max cannot see who is in Wren''s sesh');
select public.expect_error(format('select public.join_sesh(%L)', :'sesh'), 'Max cannot join Wren''s sesh');
select public.expect_error(format('select public.send_message(%L, %L)', :'sesh', 'hi'), 'Max cannot chat in Wren''s sesh');
select public.expect(public.api_state() -> 'friends' @> jsonb_build_array(jsonb_build_object('name', 'Wren', 'colour', 'off')), 'to Max, Wren just looks red');
select public.expect(public.my_safety() = '{"gender": null, "women_only": false}'::jsonb, 'Max only ever reads his own setting');

select set_config('request.jwt.claim.sub', :m2, false) \g /dev/null
select public.expect_error($$select public.request_friend('WRENWREN')$$, 'Milo cannot send Wren a request from her link');
select set_config('request.jwt.claim.sub', :q1, false) \g /dev/null
select public.set_safety('nonbinary', false) \g /dev/null
select public.expect_error($$select public.request_friend('WRENWREN')$$, 'someone who has not said they are a woman is also refused');

select set_config('request.jwt.claim.sub', :w2, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :w1) = 1, 'Willa still sees Wren''s status');
select public.expect((select count(*) from public.seshes where creator = :w1) = 1, 'Willa still sees Wren''s sesh');
select public.join_sesh(:'sesh') \g /dev/null
select public.send_message(:'sesh', 'On my way') \g /dev/null
select public.expect(true, 'Willa can join and chat in Wren''s sesh');

-- Turning it off brings Max back. Clearing everything keeps no row.
select set_config('request.jwt.claim.sub', :w1, false) \g /dev/null
select public.set_safety(null, false) \g /dev/null
reset role;
select public.expect((select count(*) from private.safety where user_id = :w1) = 0, 'clearing the settings deletes the row');
set role authenticated;
select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :w1) = 1, 'after: Max sees Wren is green again');

-- ---- blocking a friend request without accepting it
select set_config('request.jwt.claim.sub', :m2, false) \g /dev/null
select public.request_friend('WRENWREN') \g /dev/null
select set_config('request.jwt.claim.sub', :w1, false) \g /dev/null
select id as req from public.friendships where requester = :m2 and addressee = :w1 \gset
select public.block_request(:'req') \g /dev/null
select public.expect(public.blocked_list() @> jsonb_build_array(jsonb_build_object('name', 'Milo')), 'Wren blocked Milo from his request');
select set_config('request.jwt.claim.sub', :m2, false) \g /dev/null
select public.expect_error($$select public.request_friend('WRENWREN')$$, 'Milo cannot ask again');
select public.expect_error(format('select public.block_request(%L)', :'req'), 'Milo cannot use the blocked row to block back');
reset role;
set role anon;
select public.expect_error($$select public.set_safety('woman', true)$$, 'signed-out visitors cannot change safety settings');
select public.expect_error($$select public.my_safety()$$, 'signed-out visitors cannot read safety settings');
reset role;
select 'ALL WOMEN SAFETY CHECKS PASSED';
