-- Checks for the security hardening (migration 0006). Runs after 01 to 05 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set k1 '''00000000-0000-0000-0000-0000000000c1'''
\set k2 '''00000000-0000-0000-0000-0000000000c2'''
\set k3 '''00000000-0000-0000-0000-0000000000c3'''
insert into auth.users (id) values (:k1), (:k2), (:k3);
insert into public.profiles (id, name, adult_confirmed_at) values (:k1, 'Kit', now()), (:k2, 'Lou', now()), (:k3, 'Max', now());
insert into public.friendships (requester, addressee, state) values (:k1, :k2, 'accepted');

-- ---- a block can't be undone by the person blocked
set role authenticated;
select set_config('request.jwt.claim.sub', :k1, false) \g /dev/null
select public.block_user(:k2) \g /dev/null
select set_config('request.jwt.claim.sub', :k2, false) \g /dev/null
update public.friendships set state = 'accepted' where requester = :k1 and addressee = :k2;
delete from public.friendships where requester = :k1 and addressee = :k2;
reset role;
select public.expect((select state from public.friendships where requester = :k1 and addressee = :k2) = 'blocked', 'the person blocked cannot turn the block into a friendship or remove it');

-- ---- a request can only be accepted, not quietly turned into a block the wrong way round
set role authenticated;
select set_config('request.jwt.claim.sub', :k3, false) \g /dev/null
insert into public.friendships (requester, addressee) values (:k3, :k1);
select set_config('request.jwt.claim.sub', :k1, false) \g /dev/null
select public.expect_error(format('update public.friendships set state = %L where requester = %L and addressee = %L', 'blocked', :k3, :k1), 'the person asked cannot set a request to blocked directly');
reset role;
select public.expect((select state from public.friendships where requester = :k3 and addressee = :k1) = 'requested', 'a request can only be accepted directly; blocking goes through block_user');

-- ---- the blocker can still unblock
set role authenticated;
select set_config('request.jwt.claim.sub', :k1, false) \g /dev/null
select public.unblock_user(:k2) \g /dev/null
reset role;
select public.expect(not exists (select 1 from public.friendships where requester = :k1 and addressee = :k2), 'the blocker can unblock');

-- ---- friend request limit
insert into auth.users (id) select ('00000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 31) i;
insert into public.profiles (id, name, adult_confirmed_at) select ('00000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid, 'P' || i, now() from generate_series(1, 31) i;
set role authenticated;
select set_config('request.jwt.claim.sub', :k2, false) \g /dev/null
do $$ begin
  for i in 1..30 loop
    insert into public.friendships (requester, addressee) values ('00000000-0000-0000-0000-0000000000c2', ('00000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid);
  end loop;
end $$;
select public.expect_error($$insert into public.friendships (requester, addressee) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0001-000000000031')$$, 'no more than 30 friend requests a day');
reset role;

-- ---- seshes change only through the functions
insert into public.seshes (id, creator) values ('00000000-0000-0000-0000-0000000000d1', :k1);
set role authenticated;
select set_config('request.jwt.claim.sub', :k1, false) \g /dev/null
select public.expect_error($$update public.seshes set created_at = now() + interval '1 year' where creator = '00000000-0000-0000-0000-0000000000c1'$$, 'a sesh''s start time cannot be moved to keep it alive');
select public.expect((select public.end_sesh('00000000-0000-0000-0000-0000000000d1')) = '{}'::jsonb, 'the creator can still end a sesh');

-- ---- rating tags are limited however they are written
select public.expect_error($$insert into public.ratings (venue_id, user_id, stars, tags) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 3, array['a','b','c','d','e','f'])$$, 'no more than 5 rating tags');
select public.expect_error(format('insert into public.ratings (venue_id, user_id, stars, tags) values (%L, %L, 3, array[%L])', '10000000-0000-0000-0000-000000000002', :k1, repeat('x', 200)), 'rating tags cannot be huge');
reset role;

-- ---- report limit
insert into public.seshes (id, creator) values ('00000000-0000-0000-0000-0000000000d2', :k1);
insert into public.sesh_members (sesh_id, user_id) values ('00000000-0000-0000-0000-0000000000d2', :k1), ('00000000-0000-0000-0000-0000000000d2', :k3);
insert into public.messages (id, sesh_id, sender, body) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d2', :k3, 'hey');
insert into public.reports (reporter, reported, message_body) select :k1, :k3, 'r' || i from generate_series(1, 20) i;
set role authenticated;
select set_config('request.jwt.claim.sub', :k1, false) \g /dev/null
select public.expect_error($$select public.report_message('00000000-0000-0000-0000-0000000000e1', 'again')$$, 'no more than 20 reports a day');
reset role;

-- ---- old data is deleted
insert into public.seshes (id, creator, created_at) values ('00000000-0000-0000-0000-0000000000d3', :k1, now() - interval '8 days');
insert into public.sesh_members (sesh_id, user_id) values ('00000000-0000-0000-0000-0000000000d3', :k1);
insert into public.redemptions (deal_id, user_id, code, night, expires_at)
  select id, :k1, 'SESH-1111', public.night_of() - 3, now() - interval '3 days' from public.deals limit 1;
select public.purge_old_data() \g /dev/null
select public.expect(not exists (select 1 from public.seshes where id = '00000000-0000-0000-0000-0000000000d3'), 'seshes older than 7 days are deleted');
select public.expect(not exists (select 1 from public.sesh_members where sesh_id = '00000000-0000-0000-0000-0000000000d3'), 'and who joined them');
select public.expect(not exists (select 1 from public.redemptions where user_id = :k1 and code = 'SESH-1111'), 'deal codes from earlier nights are deleted');
select public.expect(exists (select 1 from public.seshes where id = '00000000-0000-0000-0000-0000000000d2'), 'recent seshes are kept');

-- ---- nobody can call the clean-up or the trigger function
set role authenticated;
select public.expect_error($$select public.purge_old_data()$$, 'a signed-in person cannot run the clean-up');
reset role;

-- ---- anything new starts locked
create table public.zz_new_table (id int);
create function public.zz_new_function() returns int language sql as $$ select 1 $$;
select public.expect(not has_table_privilege('anon', 'public.zz_new_table', 'select') and not has_table_privilege('authenticated', 'public.zz_new_table', 'select'), 'a new table is closed until granted');
select public.expect(not has_function_privilege('anon', 'public.zz_new_function()', 'execute') and not has_function_privilege('authenticated', 'public.zz_new_function()', 'execute'), 'a new function is closed until granted');
drop table public.zz_new_table;
drop function public.zz_new_function();

-- ---- signed-out visitors still get nothing at all
select public.expect(not exists (
  select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
), 'signed-out visitors have no rights on any table');
select public.expect(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('expect', 'expect_error')
), 'signed-out visitors cannot call any function');
select 'ALL SECURITY CHECKS PASSED';
