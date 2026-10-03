-- Checks for sesh chat (migration 0004). Runs after 01 to 03 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set g1 '''00000000-0000-0000-0000-0000000000a1'''
\set g2 '''00000000-0000-0000-0000-0000000000a2'''
\set g3 '''00000000-0000-0000-0000-0000000000a3'''
\set out '''00000000-0000-0000-0000-0000000000a4'''
insert into auth.users (id) values (:g1), (:g2), (:g3), (:out);
insert into public.profiles (id, name, adult_confirmed_at) values (:g1, 'Gia', now()), (:g2, 'Hal', now()), (:g3, 'Ida', now()), (:out, 'Outsider', now());
insert into public.friendships (requester, addressee, state) values (:g1, :g2, 'accepted'), (:g1, :g3, 'accepted'), (:g2, :g3, 'accepted');

-- everyone goes On, Gia starts a sesh, Hal and Ida join
set role authenticated;
select set_config('request.jwt.claim.sub', :g1, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.start_sesh() \g /dev/null
select set_config('request.jwt.claim.sub', :g2, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :g3, false) \g /dev/null
select public.set_status('on') \g /dev/null
reset role;
select id as sesh from public.seshes where creator = :g1 and ended_at is null \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :g2, false) \g /dev/null
select public.join_sesh(:'sesh') \g /dev/null
select set_config('request.jwt.claim.sub', :g3, false) \g /dev/null
select public.join_sesh(:'sesh') \g /dev/null

-- ---- signed out and outsiders
reset role;
set role anon;
select public.expect_error($$select public.get_messages('00000000-0000-0000-0000-000000000000')$$, 'a signed-out visitor cannot read chat');
select public.expect_error($$select * from public.messages$$, 'nobody reads the messages table directly (signed out)');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :out, false) \g /dev/null
select public.expect_error(format('select public.send_message(%L, %L)', :'sesh', 'hi'), 'someone outside the sesh cannot send');
select public.expect(public.get_messages(:'sesh') = '[]'::jsonb, 'someone outside the sesh reads nothing');
select public.expect_error($$select * from public.messages$$, 'signed-in people cannot read the messages table directly');
select public.expect_error($$select * from public.reports$$, 'nobody can read reports from the app');

-- ---- sending
select set_config('request.jwt.claim.sub', :g2, false) \g /dev/null
select public.send_message(:'sesh', '  Lowtide at 8?  ') \g /dev/null
select public.expect_error(format('select public.send_message(%L, %L)', :'sesh', '   '), 'an empty message is refused');
select public.expect_error(format('select public.send_message(%L, %L)', :'sesh', repeat('x', 501)), 'a message over 500 characters is refused');
select set_config('request.jwt.claim.sub', :g1, false) \g /dev/null
select public.expect(public.get_messages(:'sesh') -> 0 ->> 'body' = 'Lowtide at 8?', 'Gia reads Hal''s message, trimmed');
select public.expect(public.get_messages(:'sesh') -> 0 ->> 'name' = 'Hal', 'the message carries the sender''s name');
select public.send_message(:'sesh', 'Yes!') \g /dev/null
select set_config('request.jwt.claim.sub', :g3, false) \g /dev/null
select public.expect(jsonb_array_length(public.get_messages(:'sesh')) = 2, 'Ida sees both messages');

-- ---- blocking
select public.block_user(:g2) \g /dev/null
select public.expect(jsonb_array_length(public.get_messages(:'sesh')) = 1, 'Ida no longer sees Hal''s messages after blocking him');
select public.expect(public.blocked_list() -> 0 ->> 'name' = 'Hal', 'the blocked list names Hal');
select public.expect(public.api_state() -> 'blocked' -> 0 ->> 'name' = 'Hal', 'the app state includes the blocked list');
select public.expect(not exists (select 1 from jsonb_array_elements(public.api_state() -> 'friends') f where f ->> 'name' = 'Hal'), 'blocking removes the friend');
select set_config('request.jwt.claim.sub', :g2, false) \g /dev/null
select public.send_message(:'sesh', 'Hello?') \g /dev/null
select public.expect(not exists (select 1 from jsonb_array_elements(public.get_messages(:'sesh')) m where m ->> 'name' = 'Ida'), 'Hal cannot see Ida either');
select set_config('request.jwt.claim.sub', :g3, false) \g /dev/null
select public.unblock_user(:g2) \g /dev/null
select public.expect(jsonb_array_length(public.get_messages(:'sesh')) = 3, 'unblocking brings the messages back');

-- ---- reporting
select public.report_message((public.get_messages(:'sesh') -> 0 ->> 'id')::uuid, 'rude') \g /dev/null
reset role;
select public.expect((select count(*) from public.reports where reported = :g2 and message_body <> '' and reason = 'rude') = 1, 'a report keeps a copy of the message');

-- ---- rate limit
set role authenticated;
select set_config('request.jwt.claim.sub', :g1, false) \g /dev/null
do $$ begin for i in 1..19 loop perform public.send_message((select id from public.seshes where creator = auth.uid() and ended_at is null), 'm' || i); end loop; end $$;
select public.expect_error(format('select public.send_message(%L, %L)', :'sesh', 'one too many'), 'more than 20 messages a minute is refused');

-- ---- ending the sesh erases the chat
select public.end_sesh(:'sesh') \g /dev/null
reset role;
select public.expect((select count(*) from public.messages where sesh_id = :'sesh') = 0, 'ending the sesh erases every message');
set role authenticated;
select set_config('request.jwt.claim.sub', :g1, false) \g /dev/null
select public.expect(public.get_messages(:'sesh') = '[]'::jsonb, 'an ended sesh has no chat');
select public.expect_error(format('select public.send_message(%L, %L)', :'sesh', 'late'), 'nobody can chat in an ended sesh');
select public.expect_error(format('select public.end_sesh(%L)', '00000000-0000-0000-0000-0000000000b1'), 'only the starter can end a sesh');

-- ---- old chats are purged
reset role;
insert into public.seshes (id, creator, created_at) values ('00000000-0000-0000-0000-0000000000b1', :g1, now() - interval '9 hours');
insert into public.messages (sesh_id, sender, body, created_at) values ('00000000-0000-0000-0000-0000000000b1', :g1, 'ancient', now() - interval '9 hours');
insert into public.reports (reporter, reported, message_body, created_at) values (:g1, :g2, 'old report', now() - interval '91 days');
select public.purge_chat() \g /dev/null
select public.expect((select count(*) from public.messages where body = 'ancient') = 0, 'chat from an old sesh is purged');
select public.expect((select count(*) from public.reports where message_body = 'old report') = 0, 'reports older than 90 days are purged');

-- ---- deleting an account takes the person's messages and blocks, and unlinks their reports
insert into public.seshes (id, creator) values ('00000000-0000-0000-0000-0000000000b2', :g1);
insert into public.messages (sesh_id, sender, body) values ('00000000-0000-0000-0000-0000000000b2', :g2, 'bye');
set role authenticated;
select set_config('request.jwt.claim.sub', :g2, false) \g /dev/null
select public.delete_account() \g /dev/null
reset role;
select public.expect((select count(*) from public.messages where sender = :g2) = 0, 'deleting an account removes its messages');
select public.expect((select count(*) from public.reports where reported is null and reporter = :g3) = 1, 'a report about a deleted account stays but is no longer linked to them');
select 'ALL CHAT CHECKS PASSED';
