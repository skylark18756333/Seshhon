-- Checks phone notifications for friend messages and sesh chat (migration 0048). Runs after the earlier tests.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set mo '''00000000-0000-0000-0000-000000004801'''
\set mi '''00000000-0000-0000-0000-000000004802'''
\set mu '''00000000-0000-0000-0000-000000004803'''
\set mx '''00000000-0000-0000-0000-000000004804'''
insert into auth.users (id) values (:mo), (:mi), (:mu), (:mx);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:mo, 'Mo Smith', now(), 'MPUSHMO1'), (:mi, 'Mia', now(), 'MPUSHMI1'), (:mu, 'Mus', now(), 'MPUSHMU1'), (:mx, 'Max', now(), 'MPUSHMX1');
insert into public.friendships (requester, addressee, state) values (:mo, :mi, 'accepted'), (:mo, :mu, 'accepted'), (:mi, :mu, 'accepted');
-- Mia and Mus have phones; Mo has none.
insert into private.push_tokens (token, user_id) values ('ExponentPushToken[miamiamiamiamiamia01]', :mi), ('ExponentPushToken[musmusmusmusmusmus01]', :mu);
delete from private.push_queue; delete from private.push_sent;

-- ---------------------------------------------------------------- friend messages
set role authenticated;
select set_config('request.jwt.claim.sub', :mo, false) \g /dev/null
select public.send_friend_message(:mi, 'senderkeysenderkeysenderkey1', 'locked.body') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :mi and kind = 'message') = 1, 'Mia is told about Mo''s message');
select public.expect((select title from private.push_queue where recipient = :mi) = 'New message from Mo', 'it says who wrote, by first name');
select public.expect((select body from private.push_queue where recipient = :mi) = 'Open Crewzy to read it.', 'and never what');
select public.expect((select data ->> 'screen' from private.push_queue where recipient = :mi) = 'messages', 'tap opens Chats');
set role authenticated;
select public.send_friend_message(:mi, 'senderkeysenderkeysenderkey1', 'locked.body2') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :mi and kind = 'message') = 1, 'a second message straight after does not buzz again');
-- Mia switches message notifications off.
set role authenticated;
select set_config('request.jwt.claim.sub', :mi, false) \g /dev/null
select public.set_push_setting('message', false) \g /dev/null
select set_config('request.jwt.claim.sub', :mu, false) \g /dev/null
select public.send_friend_message(:mi, 'senderkeysenderkeysenderkey2', 'locked.body3') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where recipient = :mi and kind = 'message') = 0, 'switched off: the waiting one is dropped and nothing more comes for Mia');
delete from private.push_queue; delete from private.push_sent;

-- ---------------------------------------------------------------- sesh chat
set role authenticated;
select set_config('request.jwt.claim.sub', :mo, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.start_sesh() \g /dev/null
select set_config('request.jwt.claim.sub', :mi, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :mu, false) \g /dev/null
select public.set_status('on') \g /dev/null
reset role;
select id as sesh from public.seshes where creator = :mo and ended_at is null \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :mi, false) \g /dev/null
select public.join_sesh(:'sesh') \g /dev/null
select set_config('request.jwt.claim.sub', :mu, false) \g /dev/null
select public.join_sesh(:'sesh') \g /dev/null
reset role;
delete from private.push_queue;
set role authenticated;
select public.send_message(:'sesh', 'Heading there at 9') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where kind = 'sesh_chat') = 1, 'one notification: Mo has no phone, Mus wrote it');
select public.expect((select recipient from private.push_queue where kind = 'sesh_chat') = :mi::uuid, 'it goes to Mia');
select public.expect((select title || ' / ' || body from private.push_queue where kind = 'sesh_chat') = 'Mus wrote in your sesh / Open Crewzy to read it.', 'saying who, never what');
select public.expect((select data ->> 'screen' from private.push_queue where kind = 'sesh_chat') = 'sesh', 'tap opens the sesh');
set role authenticated;
select public.send_message(:'sesh', 'Actually 9:30') \g /dev/null
reset role;
select public.expect((select count(*) from private.push_queue where kind = 'sesh_chat') = 1, 'a burst of chat buzzes once');
-- The sesh chat setting is shown on the You page.
set role authenticated;
select set_config('request.jwt.claim.sub', :mi, false) \g /dev/null
select public.expect((select count(*) from jsonb_array_elements(public.my_push_settings() -> 'kinds') k where k ->> 'kind' in ('message', 'sesh_chat')) = 2, 'both new switches are listed');
reset role;
delete from private.push_queue; delete from private.push_sent;

select 'ALL MESSAGE PUSH CHECKS PASSED';
