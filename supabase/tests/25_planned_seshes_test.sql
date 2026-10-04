-- Checks for planned seshes (migration 0025). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set p '''00000000-0000-0000-0000-0000000025a1'''
\set q '''00000000-0000-0000-0000-0000000025a2'''
\set r '''00000000-0000-0000-0000-0000000025a3'''
\set z '''00000000-0000-0000-0000-0000000025a4'''
insert into auth.users (id) values (:p), (:q), (:r), (:z);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:p, 'Pia', now(), 'PIAPIAPI'), (:q, 'Quentin', now(), 'QUENQUEN'), (:r, 'Rae', now(), 'RAERAERA'), (:z, 'Zed', now(), 'ZEDZEDZE');
-- Pia is friends with Quentin and Rae. Zed is a stranger.
insert into public.friendships (requester, addressee, state) values (:p, :q, 'accepted'), (:p, :r, 'accepted');
insert into public.venues (id, name) values ('00000000-0000-0000-0000-0000000025b1', 'Planned Arms');

set role authenticated;
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.set_status('thinking') \g /dev/null
select set_config('request.jwt.claim.sub', :r, false) \g /dev/null
select public.set_status('thinking') \g /dev/null
select set_config('request.jwt.claim.sub', :z, false) \g /dev/null
select public.set_status('on') \g /dev/null

-- ---- planning one (Pia is only amber: you don't have to be green to plan ahead)
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.set_status('thinking') \g /dev/null
select public.expect_error($$select public.plan_sesh(now() - interval '1 hour')$$, 'not in the past');
select public.expect_error($$select public.plan_sesh(now() + interval '15 days')$$, 'not more than 2 weeks ahead');
select id as planned from public.plan_sesh(now() + interval '2 days') \gset
select public.expect((public.api_state() -> 'seshes' -> 0 ->> 'planned') = 'true', 'Pia sees her sesh as planned');
select public.expect((public.api_state() -> 'seshes' -> 0 ->> 'private') = 'false', 'open to all her friends');
select public.expect(public.is_sesh_member(:'planned', :p), 'and she is in it');

-- ---- friends see it, say they're in, vote and chat ahead of time
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Quentin sees the planned sesh');
select public.join_sesh(:'planned') \g /dev/null
select public.expect(public.is_sesh_member(:'planned', :q), 'and says he''s in');
select public.cast_vote(:'planned', '00000000-0000-0000-0000-0000000025b1') \g /dev/null
select public.send_message(:'planned', 'Saturday it is') \g /dev/null
select public.expect(jsonb_array_length(public.get_messages(:'planned')) = 1, 'and chats about it');
select set_config('request.jwt.claim.sub', :r, false) \g /dev/null
select public.join_sesh(:'planned') \g /dev/null
select public.cast_vote(:'planned', '00000000-0000-0000-0000-0000000025b1') \g /dev/null
select public.expect(not exists (select 1 from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = '00000000-0000-0000-0000-0000000025b1'),
  'votes in a planned sesh don''t make the venue glow busy tonight');
select set_config('request.jwt.claim.sub', :z, false) \g /dev/null
select public.expect((select count(*) from public.seshes where id = :'planned') = 0, 'a stranger doesn''t see it');

-- ---- old planning chat isn't wiped while the sesh is still to come
reset role;
update public.messages set created_at = now() - interval '1 day' where sesh_id = :'planned';
select public.purge_chat() \g /dev/null
select public.expect((select count(*) from public.messages where sesh_id = :'planned') = 1, 'a day-old message in a planned sesh is kept');
set role authenticated;

-- ---- a private pres address
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.expect_error(format($$select public.set_sesh_pres(%L, '12 Secret St')$$, :'planned'), 'only the host can set the pres address');
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.expect_error(format($$select public.set_sesh_pres(%L, '12 Secret St', now() + interval '3 days')$$, :'planned'), 'pres can''t be after the sesh starts');
select public.set_sesh_pres(:'planned', '12 Secret St', now() + interval '2 days' - interval '2 hours') \g /dev/null
select public.expect((public.api_state() -> 'seshes' -> 0 -> 'pres' ->> 'address') = '12 Secret St', 'Pia sees the address she added');
select public.expect_error('select * from private.sesh_pres', 'nobody reads the pres table directly');
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.expect((select x -> 'pres' from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'planned') ? 'shows_at', 'Quentin, who is in, knows there is a pres');
select public.expect(not ((select x -> 'pres' from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'planned') ? 'address'), 'but not the address 2 days early');
reset role;
update public.seshes set created_at = now() + interval '3 hours' where id = :'planned';
set role authenticated;
select public.expect((select x -> 'pres' ->> 'address' from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'planned') = '12 Secret St', 'he sees it from 4 hours before the start');
reset role;
insert into public.friendships (requester, addressee, state) values (:z, :p, 'accepted');
set role authenticated;
select set_config('request.jwt.claim.sub', :z, false) \g /dev/null
select public.expect((select x -> 'pres' from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'planned') = 'null'::jsonb, 'a friend who hasn''t said he''s in sees the sesh but no pres');
reset role;
delete from public.friendships where requester = :z and addressee = :p;
insert into public.blocks (blocker, blocked) values (:p, :q);
set role authenticated;
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.expect(coalesce((select x -> 'pres' from jsonb_array_elements(public.api_state() -> 'seshes') x where x ->> 'id' = :'planned'), 'null'::jsonb) = 'null'::jsonb, 'someone the host blocked never sees it');
reset role;
delete from public.blocks where blocker = :p and blocked = :q;
update public.seshes set created_at = now() + interval '2 days' where id = :'planned';
set role authenticated;

-- ---- a planned sesh doesn't stop you starting one now
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.set_status('on') \g /dev/null
select id as now_sesh from public.start_sesh() \gset
select public.expect(:'now_sesh' <> :'planned', 'starting a sesh now makes a new one, not the planned one');
select public.expect_error(format($$select public.start_planned_sesh(%L)$$, :'planned'), 'cannot start the planned one early while another is going');
select public.end_sesh(:'now_sesh') \g /dev/null

-- ---- only the planner can start it early, and then it's live
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.expect_error(format($$select public.start_planned_sesh(%L)$$, :'planned'), 'Quentin can''t start Pia''s sesh');
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.start_planned_sesh(:'planned') \g /dev/null
select public.expect((public.api_state() -> 'seshes' -> 0 ->> 'planned') = 'false', 'Pia starts it early and it''s live');
select public.expect(exists (select 1 from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = '00000000-0000-0000-0000-0000000025b1'),
  'now the two votes make the venue glow');
select public.end_sesh(:'planned') \g /dev/null

-- ---- a private planned sesh: only the friends picked see it
select id as secret from public.plan_sesh(now() + interval '3 hours', array[:r, :z]::uuid[]) \gset
select public.expect((select private from public.seshes where id = :'secret'), 'picking friends makes it private');
select set_config('request.jwt.claim.sub', :q, false) \g /dev/null
select public.expect((select count(*) from public.seshes where id = :'secret') = 0, 'Quentin, not picked, doesn''t see it');
select set_config('request.jwt.claim.sub', :r, false) \g /dev/null
select public.expect((select count(*) from public.seshes where id = :'secret') = 1, 'Rae, picked, does');

-- ---- a planned sesh that never starts is deleted 8 hours after its start time
reset role;
update public.seshes set created_at = now() - interval '8 hours 1 minute' where id = :'secret';
select public.purge_old_data() \g /dev/null
select public.expect(not exists (select 1 from public.seshes where id = :'secret'), 'deleted 8 hours after it was meant to start');
select public.expect(not exists (select 1 from public.sesh_invites where sesh_id = :'secret'), 'with its invite list');
select public.expect(not exists (select 1 from private.sesh_pres where sesh_id = :'planned'), 'and ending a sesh deleted its pres address');

-- ---- no more than 5 planned at once
set role authenticated;
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.plan_sesh(now() + make_interval(days => d)) from generate_series(1, 5) d \g /dev/null
select public.expect_error($$select public.plan_sesh(now() + interval '6 days')$$, 'only 5 planned at a time');
reset role;
select 'ALL PLANNED SESH CHECKS PASSED';
