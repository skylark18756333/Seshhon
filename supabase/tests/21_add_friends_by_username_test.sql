-- Checks for adding friends by username (migration 0021). Runs after 01 to 16 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set a '''00000000-0000-0000-0000-000000002101'''
\set b '''00000000-0000-0000-0000-000000002102'''
\set c '''00000000-0000-0000-0000-000000002103'''
\set w '''00000000-0000-0000-0000-000000002104'''
\set n '''00000000-0000-0000-0000-000000002105'''
insert into auth.users (id) values (:a), (:b), (:c), (:w), (:n);
insert into public.profiles (id, name, adult_confirmed_at) values (:a, 'Ash', now()), (:b, 'Bea', now()), (:c, 'Cal', now()), (:w, 'Wynn', now());

set role authenticated;
select set_config('request.jwt.claim.sub', :n, false) \g /dev/null
select public.expect(public.username_free('ash_21'), 'a new username is free before signing up');
select public.expect_error($$select public.request_friend_by_username('ash_21')$$, 'you must finish signing up to add friends');
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.save_account('ash_21', 'long enough password') \g /dev/null
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.save_account('bea_21', 'long enough password') \g /dev/null
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.save_account('cal_21', 'long enough password') \g /dev/null
select set_config('request.jwt.claim.sub', :w, false) \g /dev/null
select public.save_account('wynn_21', 'long enough password') \g /dev/null
select public.set_safety('woman', true) \g /dev/null

select set_config('request.jwt.claim.sub', :n, false) \g /dev/null
select public.expect(not public.username_free('ASH_21'), 'a taken username is not free, whatever the case');
select public.expect_error($$select public.username_free('a!')$$, 'a badly formed username is refused');

-- Ash adds Bea by username; Bea accepts by adding Ash back.
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect(public.request_friend_by_username(' @Bea_21 ') = '{"ok": true, "name": "Bea", "state": "requested"}'::jsonb, 'Ash sends Bea a request by username');
select public.expect(public.request_friend_by_username('bea_21') ->> 'state' = 'requested', 'asking again does not make a second request');
select public.expect(public.request_friend_by_username('ash_21') ->> 'ok' = 'false', 'you cannot add yourself');
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect(public.request_friend_by_username('ash_21') ->> 'state' = 'accepted', 'adding someone who already asked you makes you friends');
select public.expect(public.api_state() -> 'friends' @> '[{"name": "Ash"}]'::jsonb, 'Bea now sees Ash as a friend');

-- Unknown, blocked and hidden people all look the same.
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect(public.request_friend_by_username('nobody_here') ->> 'message' like 'No one%', 'an unknown username finds no one');
reset role;
insert into public.friendships (requester, addressee, state) values (:a, :c, 'blocked');
set role authenticated;
select public.expect(public.request_friend_by_username('ash_21') ->> 'message' like 'No one%', 'someone who blocked you looks like no one');
select public.expect(public.request_friend_by_username('wynn_21') ->> 'message' like 'No one%', 'someone in women and non-binary only mode looks like no one');
reset role;
select public.expect((select count(*) from public.friendships where addressee = :w) = 0, 'no request reaches her');
set role authenticated;

-- Twenty misses a day, then it stops.
select public.request_friend_by_username('miss_' || i) from generate_series(1, 20) i \g /dev/null
select public.expect(public.request_friend_by_username('bea_21') ->> 'message' like 'Too many%', 'after 20 misses even a real username is refused for the day');
select public.expect_error($$select * from private.username_misses$$, 'nobody reads the misses table from the app');
reset role;
select 'ALL ADD-BY-USERNAME CHECKS PASSED';
