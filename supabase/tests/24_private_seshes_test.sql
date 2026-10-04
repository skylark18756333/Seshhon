-- Checks for private seshes (migration 0024). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set h '''00000000-0000-0000-0000-0000000024a1'''
\set i '''00000000-0000-0000-0000-0000000024a2'''
\set o '''00000000-0000-0000-0000-0000000024a3'''
\set x '''00000000-0000-0000-0000-0000000024a4'''
\set l '''00000000-0000-0000-0000-0000000024a5'''
insert into auth.users (id) values (:h), (:i), (:o), (:x), (:l);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:h, 'Hana', now(), 'HANAHANA'), (:i, 'Ira', now(), 'IRAIRAIR'), (:o, 'Oli', now(), 'OLIOLIOL'),
  (:x, 'Xan', now(), 'XANXANXA'), (:l, 'Lou', now(), 'LOULOULO');
-- Hana is friends with Ira, Oli and Lou. Xan is a stranger.
insert into public.friendships (requester, addressee, state) values (:h, :i, 'accepted'), (:h, :o, 'accepted'), (:l, :h, 'accepted');

set role authenticated;
select set_config('request.jwt.claim.sub', :i, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :o, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :x, false) \g /dev/null
select public.set_status('on') \g /dev/null
select set_config('request.jwt.claim.sub', :l, false) \g /dev/null
select public.set_status('thinking') \g /dev/null

-- ---- starting one
select set_config('request.jwt.claim.sub', :h, false) \g /dev/null
select public.expect_error(format($$select public.start_private_sesh(array[%L]::uuid[])$$, :i), 'you need to be green to start one');
select public.set_status('on') \g /dev/null
select public.expect_error($$select public.start_private_sesh('{}'::uuid[])$$, 'you have to pick someone');
select public.expect_error(format($$select public.start_private_sesh(array[%L]::uuid[])$$, :x), 'picking only strangers is the same as picking no one');
select id as sesh from public.start_private_sesh(array[:i, :x]::uuid[]) \gset
select public.expect((select private from public.seshes where id = :'sesh'), 'the sesh is private');
select public.expect_error(format($$select public.start_private_sesh(array[%L]::uuid[])$$, :i), 'one sesh at a time');
select public.expect((public.api_state() -> 'seshes' -> 0 ->> 'private') = 'true', 'Hana sees her sesh is private');
select public.expect((public.api_state() -> 'seshes' -> 0 -> 'invited') = jsonb_build_array(:i), 'and who she picked (the stranger was skipped)');
select public.expect_error('select * from public.sesh_invites', 'nobody reads the invites table directly');

-- ---- the picked friend sees it and can join
select set_config('request.jwt.claim.sub', :i, false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Ira, who was picked, sees the sesh');
select public.expect((public.api_state() -> 'seshes' -> 0 -> 'invited') = 'null'::jsonb, 'but not the list of who else was picked');
select public.join_sesh(:'sesh') \g /dev/null
select public.expect(public.is_sesh_member(:'sesh', :i), 'and joins it');

-- ---- a friend who wasn't picked sees nothing
select set_config('request.jwt.claim.sub', :o, false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 0, 'Oli, a friend who wasn''t picked, doesn''t see it');
select public.expect((select count(*) from public.seshes where id = :'sesh') = 0, 'not even by reading the table');
select public.expect((select count(*) from public.sesh_members where sesh_id = :'sesh') = 0, 'or who is in it');
select public.expect_error('select public.join_sesh(' || quote_literal(:'sesh') || ')', 'and cannot join it');
select public.expect_error(format($$insert into public.sesh_members (sesh_id, user_id) values (%L, %L)$$, :'sesh', :o), 'not even directly');
select public.expect_error(format($$select public.invite_to_sesh(%L, array[%L]::uuid[])$$, :'sesh', :o), 'and cannot invite himself');

-- ---- a stranger sees nothing
select set_config('request.jwt.claim.sub', :x, false) \g /dev/null
select public.expect((select count(*) from public.seshes where id = :'sesh') = 0, 'a stranger doesn''t see it');

-- ---- inviting more later
select set_config('request.jwt.claim.sub', :h, false) \g /dev/null
select public.expect((public.invite_to_sesh(:'sesh', array[:l, :x]::uuid[]) ->> 'invited') = '1', 'Hana invites Lou later (the stranger is skipped again)');
select set_config('request.jwt.claim.sub', :l, false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Lou, on amber, now sees it');
select public.join_sesh(:'sesh') \g /dev/null
select public.expect((select count(*) from public.sesh_members where sesh_id = :'sesh') = 3, 'and joins; Lou sees all three in it');

-- ---- an ordinary sesh is still open to every friend
select set_config('request.jwt.claim.sub', :h, false) \g /dev/null
select public.end_sesh(:'sesh') \g /dev/null
reset role;
select public.expect(not exists (select 1 from public.sesh_invites where sesh_id = :'sesh'), 'ending the sesh deletes its invites');
set role authenticated;
select set_config('request.jwt.claim.sub', :h, false) \g /dev/null
select id as open_sesh from public.start_sesh() \gset
select public.expect_error(format($$select public.invite_to_sesh(%L, array[%L]::uuid[])$$, :'open_sesh', :o), 'an ordinary sesh has no invite list');
select set_config('request.jwt.claim.sub', :o, false) \g /dev/null
select public.expect(jsonb_array_length(public.api_state() -> 'seshes') = 1, 'Oli sees an ordinary sesh as before');
select public.expect((public.api_state() -> 'seshes' -> 0 ->> 'private') = 'false', 'and it says it isn''t private');
reset role;
select 'ALL PRIVATE SESH CHECKS PASSED';
