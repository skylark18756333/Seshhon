-- Checks push notifications (migration 0035). Runs after 01 to 34 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set ann '''00000000-0000-0000-0000-000000003301'''
\set ben '''00000000-0000-0000-0000-000000003302'''
\set cal '''00000000-0000-0000-0000-000000003303'''
\set dee '''00000000-0000-0000-0000-000000003304'''
\set eli '''00000000-0000-0000-0000-000000003305'''
\set fay '''00000000-0000-0000-0000-000000003306'''
\set gus '''00000000-0000-0000-0000-000000003307'''
\set ida '''00000000-0000-0000-0000-000000003308'''
\set hal '''00000000-0000-0000-0000-000000003309'''
insert into auth.users (id) values (:ann), (:ben), (:cal), (:dee), (:eli), (:fay), (:gus), (:ida), (:hal);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:ann, 'Ann Lee', now(), 'PUSHANN1'), (:ben, 'Ben', now(), 'PUSHBEN1'), (:cal, 'Cal', now(), 'PUSHCAL1'), (:dee, 'Dee', now(), 'PUSHDEE1'),
  (:eli, 'Eli', now(), 'PUSHELI1'), (:fay, 'Fay', now(), 'PUSHFAY1'), (:gus, 'Gus', now(), 'PUSHGUS1'), (:ida, 'Ida', now(), 'PUSHIDA1'),
  (:hal, 'Hal', now(), 'PUSHHAL1');
-- Ann is friends with everyone except Hal.
insert into public.friendships (requester, addressee, state) values
  (:ann, :ben, 'accepted'), (:ann, :cal, 'accepted'), (:ann, :dee, 'accepted'), (:ann, :eli, 'accepted'),
  (:ann, :fay, 'accepted'), (:ann, :gus, 'accepted'), (:ann, :ida, 'accepted');
select count(*) as n from private.push_queue \gset

-- ---------------------------------------------------------------- tokens
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.expect_error($$select * from private.push_tokens$$, 'nobody reads the token table from the app');
select public.expect_error($$select * from private.push_queue$$, 'nobody reads the queue from the app');
select public.expect_error($$select * from private.push_settings$$, 'nobody reads the settings table from the app');
select public.expect_error($$select private.push_enqueue(null, 'invite', null, 'x', 'y', 'home', null, null)$$, 'the app cannot queue notifications');
select public.expect_error($$select public.push_take(10)$$, 'the app cannot take notifications off the queue');
select public.expect_error($$select public.push_finish('{1}', '{}')$$, 'or finish them');
select public.expect_error($$select public.register_push_token('not a token')$$, 'a made-up token is refused');
select public.expect_error($$select public.register_push_token('ExponentPushToken[short]')$$, 'a too-short token is refused');
select public.expect((public.register_push_token('ExponentPushToken[annannannannannannann1]', 'android') ->> 'ok')::boolean, 'Ann registers her phone');
select public.expect((public.register_push_token('ExponentPushToken[annannannannannannann1]', 'android') ->> 'ok')::boolean, 'registering twice is fine');
reset role;
select public.expect((select count(*) from private.push_tokens where user_id = :ann) = 1, 'and it is stored once');
set role authenticated;
-- Another person signing in on the same phone takes the token over.
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.register_push_token('ExponentPushToken[annannannannannannann1]', 'android') \g /dev/null
reset role;
select public.expect((select user_id from private.push_tokens where token = 'ExponentPushToken[annannannannannannann1]') = :ben::uuid, 'the token moves to whoever signed in on that phone last');
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.unregister_push_token('ExponentPushToken[annannannannannannann1]') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_tokens where token = 'ExponentPushToken[annannannannannannann1]') = 1, 'Ann cannot remove a token that is now Ben''s');
set role authenticated;
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.unregister_push_token('ExponentPushToken[annannannannannannann1]') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_tokens) = 0, 'Ben removes it on log out');
-- Up to 5 phones per person.
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.register_push_token('ExponentPushToken[annphoneannphone' || g || ']', 'android') from generate_series(1, 7) g \g /dev/null
reset role;
select public.expect((select count(*) from private.push_tokens where user_id = :ann) = 5, 'a person keeps their newest 5 phones');
delete from private.push_tokens;

-- ---------------------------------------------------------------- settings
set role authenticated;
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.expect((public.my_push_settings() ->> 'registered')::boolean = false, 'no phone registered yet');
select public.expect(jsonb_array_length(public.my_push_settings() -> 'kinds') = 4, 'four kinds are built (home safe and favourite venues are not)');
select public.expect((select bool_and((k ->> 'on')::boolean = (k ->> 'kind' in ('friend_request', 'invite'))) from jsonb_array_elements(public.my_push_settings() -> 'kinds') k),
  'only friend requests and invites start on');
select public.expect_error($$select public.set_push_setting('home_safe', true)$$, 'a kind that is not built cannot be switched on yet');
select public.expect_error($$select public.set_push_setting('nonsense', true)$$, 'nor can one that does not exist');
select public.expect_error($$select public.set_push_setting('invite', null)$$, 'on or off, nothing else');
select public.expect((select (k ->> 'on')::boolean from jsonb_array_elements(public.set_push_setting('friend_green', true) -> 'kinds') k where k ->> 'kind' = 'friend_green'), 'Ben switches Friends going Green on');
select public.expect((select not (k ->> 'on')::boolean from jsonb_array_elements(public.set_push_setting('invite', false) -> 'kinds') k where k ->> 'kind' = 'invite'), 'and Sesh invites off');
select set_config('request.jwt.claim.sub', :cal, false) \g /dev/null
select public.expect((select not (k ->> 'on')::boolean from jsonb_array_elements(public.my_push_settings() -> 'kinds') k where k ->> 'kind' = 'friend_green'), 'Cal is not affected by Ben''s switches');
reset role;

-- ---------------------------------------------------------------- everyone registers; who opted in
-- Phones for everyone but Hal's friend-less case still counts: Hal has a phone and opts in too.
set role authenticated;
select set_config('request.jwt.claim.sub', u, false), public.register_push_token('ExponentPushToken[' || rpad(n, 22, 'x') || ']', 'android')
from (values (:ann, 'ann'), (:ben, 'ben'), (:cal, 'cal'), (:dee, 'dee'), (:eli, 'eli'), (:fay, 'fay'), (:gus, 'gus'), (:ida, 'ida'), (:hal, 'hal')) v(u, n) \g /dev/null
-- Everyone but Cal switches "friends going Green" on (Cal leaves the default, which is off).
select set_config('request.jwt.claim.sub', u, false), public.set_push_setting('friend_green', true)
from (values (:ben), (:dee), (:eli), (:gus), (:ida), (:hal), (:fay)) v(u) \g /dev/null
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.set_push_setting('invite', true) \g /dev/null
-- Everyone but Fay is Green or Amber themselves (so they may see their friends' status).
select set_config('request.jwt.claim.sub', u, false), public.set_status('on')
from (values (:ben), (:cal), (:dee), (:eli), (:gus)) v(u) \g /dev/null
select set_config('request.jwt.claim.sub', :ida, false) \g /dev/null
select public.set_status('thinking') \g /dev/null
-- Eli is hidden from by Ann; Dee is blocked by Ann without the friendship being removed (as a stale row could be).
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_status_hidden(:eli, true) \g /dev/null
reset role;
insert into public.blocks (blocker, blocked) values (:ann, :dee);
delete from private.push_queue; delete from private.push_sent;

-- ---------------------------------------------------------------- a friend goes Green
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_status('on') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where kind = 'friend_green' and recipient = :ben) = 1, 'Ben (friend, opted in, Green himself) is told Ann went Green');
select public.expect((select count(*) from private.push_queue where kind = 'friend_green' and recipient = :ida) = 1, 'Ida (Amber, so she can see Ann''s status) is told too');
select public.expect((select count(*) from private.push_queue where kind = 'friend_green' and recipient = :gus) = 1, 'Gus is told (Ann is not in women-only mode yet)');
select public.expect((select count(*) from private.push_queue where recipient = :cal) = 0, 'Cal did not opt in: nothing');
select public.expect((select count(*) from private.push_queue where recipient = :dee) = 0, 'Dee is blocked by Ann: nothing');
select public.expect((select count(*) from private.push_queue where recipient = :eli) = 0, 'Ann hid her status from Eli: nothing');
select public.expect((select count(*) from private.push_queue where recipient = :fay) = 0, 'Fay is Red herself and cannot see friends'' status: nothing');
select public.expect((select count(*) from private.push_queue where recipient = :hal) = 0, 'Hal is not Ann''s friend: nothing');
select public.expect((select count(*) from private.push_queue where recipient = :ann) = 0, 'Ann is not told about herself');
select public.expect((select count(*) from private.push_queue) = 3, 'exactly three notifications were queued');
select public.expect((select title from private.push_queue where recipient = :ben) = 'Ann just went Green' and (select body from private.push_queue where recipient = :ben) = 'Open Frendzy to see who is out.',
  'the text is her first name and a fixed sentence, nothing about where');
select public.expect((select data from private.push_queue where recipient = :ben) = '{"kind": "friend_green", "screen": "home"}'::jsonb, 'the tap data is only which screen to open');
-- Going Green again straight away does not tell them again, and neither does re-saving Green.
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.set_status('off') \g /dev/null
select public.set_status('on') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue) = 3, 'going Green again within 3 hours tells nobody again');
-- Amber and Red tell nobody.
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_status('thinking') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue) = 0, 'Amber tells nobody');

-- Women-only mode: Ann (a woman) switches it on; Ben/Gus (no gender said) are shut out, Ida (a woman) is not.
set role authenticated;
select set_config('request.jwt.claim.sub', :ida, false) \g /dev/null
select public.set_safety('woman', false) \g /dev/null
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_safety('woman', true) \g /dev/null
select public.set_status('off') \g /dev/null
reset role;
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_status('on') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :ben) = 0 and (select count(*) from private.push_queue where recipient = :gus) = 0,
  'women-only mode: friends who have not said they are a woman or non-binary get nothing');
select public.expect((select count(*) from private.push_queue where recipient = :ida and kind = 'friend_green') = 1, 'a woman friend still hears Ann went Green');
-- Turning a kind off removes what is waiting, and nothing more is queued.
set role authenticated;
select set_config('request.jwt.claim.sub', :ida, false) \g /dev/null
select public.set_push_setting('friend_green', false) \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :ida) = 0, 'switching a kind off drops what was waiting for it');

-- ---------------------------------------------------------------- friend requests
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :hal, false) \g /dev/null
select public.request_friend('PUSHBEN1') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :ben and kind = 'friend_request') = 1, 'Ben (default on) is told Hal wants to be friends');
select public.expect((select title from private.push_queue where recipient = :ben) = 'Hal wants to be friends', 'with only Hal''s first name');
set role authenticated;
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.answer_friend((select id from public.friendships where requester = :hal and addressee = :ben), true) \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :hal and kind = 'friend_request' and title = 'Ben accepted your friend request') = 1, 'Hal is told Ben accepted');
-- Ann's women-only mode: a request from Gus (no gender said) to Ann is refused by the app, so nothing is queued.
select public.expect((select count(*) from private.push_queue where recipient = :ann) = 0, 'nothing for Ann');
-- A switched-off kind and a blocked person.
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.set_push_setting('friend_request', false) \g /dev/null
select set_config('request.jwt.claim.sub', :cal, false) \g /dev/null
select public.request_friend('PUSHBEN1') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue) = 0, 'Ben switched friend requests off: nothing');
set role authenticated;
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.set_push_setting('friend_request', true) \g /dev/null
reset role;
insert into public.blocks (blocker, blocked) values (:ben, :eli);
insert into public.friendships (requester, addressee, state) values (:eli, :ben, 'requested');
select public.expect((select count(*) from private.push_queue where recipient = :ben) = 0, 'a request from someone Ben blocked: nothing');

-- ---------------------------------------------------------------- invites to a sesh
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :gus, false) \g /dev/null
select public.set_status('on') \g /dev/null
reset role;
delete from private.push_queue; delete from private.push_sent;
-- Gus's friends: Ann (Gus is not in women-only mode, so she is not hidden from him ... he is hidden from her).
insert into public.friendships (requester, addressee, state) values (:gus, :hal, 'accepted'), (:gus, :ben, 'accepted'), (:gus, :cal, 'accepted');
set role authenticated;
select set_config('request.jwt.claim.sub', :gus, false) \g /dev/null
select public.plan_sesh(now() + interval '2 days', array[:ben, :hal, :cal]::uuid[]) \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where kind = 'invite' and recipient = :hal) = 1, 'Hal (default on) is told Gus invited him to a planned sesh');
select public.expect((select count(*) from private.push_queue where kind = 'invite' and recipient = :cal) = 1, 'Cal is told too, though he is Green: the invite is addressed to him');
select public.expect((select count(*) from private.push_queue where kind = 'invite' and recipient = :ben) = 1, 'Ben is told as well');
select public.expect((select title from private.push_queue where recipient = :hal) = 'Gus invited you to a sesh' and (select body from private.push_queue where recipient = :hal) = 'Open Frendzy to see it and say if you are in.',
  'the text says who and nothing else: no time, place or other guests');
select public.expect((select data from private.push_queue where recipient = :hal) = '{"kind": "invite", "screen": "sesh"}'::jsonb, 'tap opens the Sesh tab');
select public.expect((select count(*) from private.push_queue where recipient = :gus) = 0, 'the host is not told');
-- Someone who turned invites off, and a block, get nothing.
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :hal, false) \g /dev/null
select public.set_push_setting('invite', false) \g /dev/null
reset role;
insert into public.blocks (blocker, blocked) values (:cal, :gus);
set role authenticated;
select set_config('request.jwt.claim.sub', :gus, false) \g /dev/null
select public.plan_sesh(now() + interval '3 days', array[:hal, :cal]::uuid[]) \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue) = 0, 'Hal switched invites off and Cal blocked Gus: nothing for either');
-- Women-only host: invited people she hides from get nothing.
delete from private.push_queue; delete from private.push_sent;
update private.push_settings set enabled = true where user_id = :hal and kind = 'invite';
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.plan_sesh(now() + interval '4 days', array[:ben, :ida]::uuid[]) \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :ben) = 0, 'Ann is in women-only mode, so Ben (no gender said) gets no invite push');
select public.expect((select count(*) from private.push_queue where recipient = :ida and kind = 'invite') = 1, 'Ida (a woman) does');
-- Hidden status: an invite from someone who hid from you gets nothing either.
delete from private.push_queue; delete from private.push_sent;
update private.push_settings set enabled = true where user_id = :eli and kind = 'invite';
insert into private.push_settings (user_id, kind, enabled) values (:eli, 'invite', true) on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.plan_sesh(now() + interval '5 days', array[:eli]::uuid[]) \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :eli) = 0, 'Ann hid her status from Eli, so an invite from Ann says nothing to him');

-- ---------------------------------------------------------------- a failure never blocks the action
-- (the triggers swallow errors): drop the table the queue writes to for a moment.
alter table private.push_queue rename to push_queue_away;
set role authenticated;
select set_config('request.jwt.claim.sub', :gus, false) \g /dev/null
select public.set_status('off') \g /dev/null
select public.expect((public.set_status('on')).colour = 'on', 'a broken queue does not stop someone going Green');
reset role;
alter table private.push_queue_away rename to push_queue;

-- ---------------------------------------------------------------- the sender's side (service role only)
delete from private.push_queue; delete from private.push_sent;
insert into private.push_queue (recipient, kind, title, body, data) values
  (:ben, 'invite', 'T1', 'B1', '{"kind":"invite","screen":"sesh"}'), (:hal, 'invite', 'T2', 'B2', '{}');
reset role;
-- push_take is for the service role only.
select public.expect(not has_function_privilege('authenticated', 'public.push_take(integer)', 'execute') and not has_function_privilege('anon', 'public.push_take(integer)', 'execute')
  and has_function_privilege('service_role', 'public.push_take(integer)', 'execute'), 'only the service role may take from the queue');
select public.expect(not has_function_privilege('authenticated', 'public.push_finish(bigint[], text[])', 'execute') and has_function_privilege('service_role', 'public.push_finish(bigint[], text[])', 'execute'), 'and finish');
set role service_role;
create temp table taken as select public.push_take(10) as t;
reset role;
select public.expect(jsonb_array_length((select t from taken)) = 2, 'the sender takes both waiting notifications');
select public.expect((select t -> 0 -> 'tokens' ->> 0 from taken) = 'ExponentPushToken[' || rpad('ben', 22, 'x') || ']', 'with the recipient''s token');
select public.expect(jsonb_array_length(public.push_take(10)) = 0, 'a claimed notification is not handed out twice');
select public.push_finish(array(select id from private.push_queue), array['ExponentPushToken[' || rpad('ben', 22, 'x') || ']']) \g /dev/null
select public.expect((select count(*) from private.push_queue) = 0, 'finished notifications are removed');
select public.expect((select count(*) from private.push_tokens where user_id = :ben) = 0, 'and a token Expo says is dead is forgotten');
-- A recipient who lost their token between queueing and sending is dropped, not sent.
insert into private.push_queue (recipient, kind, title, body) values (:ben, 'invite', 'T', 'B');
select public.expect(jsonb_array_length(public.push_take(10)) = 0, 'no token left: nothing is sent');
select public.expect((select count(*) from private.push_queue) = 0, 'and the notification is dropped');

-- ---------------------------------------------------------------- crew catch-ups
delete from private.push_queue; delete from private.push_sent;
select private.free_today() + 3 as d3 \gset
insert into public.friendships (requester, addressee, state) values (:ann, :ben, 'accepted') on conflict do nothing;
update private.safety set women_only = false where user_id = :ann;
insert into private.push_tokens (token, user_id) values ('ExponentPushToken[' || rpad('ben', 22, 'x') || ']', :ben) on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select (public.make_crew('Brunch') ->> 'id') as crew \gset
select public.invite_to_crew(:'crew', array[:ben, :cal]::uuid[]) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'enough', 2, '{}') \g /dev/null
select public.set_free(:'d3', 'night', true) \g /dev/null
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.answer_crew_invite(:'crew', true) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'enough', 2, '{}') \g /dev/null
select public.set_free(:'d3', 'night', true) \g /dev/null
select public.set_push_setting('catch_up', true) \g /dev/null
reset role;
-- Ann has a token and has not switched catch-ups on: only Ben is nudged.
select public.expect(private.push_catch_ups(true) = 1, 'one nudge: only Ben switched catch-ups on');
select public.expect((select count(*) from private.push_queue where kind = 'catch_up' and recipient = :ben) = 1, 'it went to Ben');
select public.expect((select title from private.push_queue where recipient = :ben) = 'Time for a catch-up?' and (select body from private.push_queue where recipient = :ben) like 'Brunch: 2 of % free % night', 'saying the crew, how many are free and when, with no names');
select public.expect((select data ->> 'screen' from private.push_queue where recipient = :ben) = 'crews', 'tap opens Crews');
select public.expect(private.push_catch_ups(true) = 0, 'a second run the same day sends nothing');
-- Ben hides his status from Ann, so Ann never counts Ben: with catch-ups on she gets nothing.
delete from private.push_queue; delete from private.push_sent;
set role authenticated;
select set_config('request.jwt.claim.sub', :ben, false) \g /dev/null
select public.set_status_hidden(:ann, true) \g /dev/null
select set_config('request.jwt.claim.sub', :ann, false) \g /dev/null
select public.set_push_setting('catch_up', true) \g /dev/null
reset role;
select private.push_catch_ups(true) as sent \gset
select public.expect(:sent = 0 and (select count(*) from private.push_queue) = 0, 'Ben hid his status from Ann: neither is nudged about the other');

select 'ALL PUSH NOTIFICATION CHECKS PASSED';
