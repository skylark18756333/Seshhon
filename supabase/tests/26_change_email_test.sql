-- Checks for changing the login email (migration 0026). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000026a1'''
\set u2 '''00000000-0000-0000-0000-0000000026a2'''
\set s1 '''00000000-0000-0000-0000-0000000026b1'''
\set s2 '''00000000-0000-0000-0000-0000000026b2'''
insert into auth.users (id, is_anonymous) values (:u1, true), (:u2, true);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Vic', now()), (:u2, 'Wen', now());

set role authenticated;
select set_config('request.jwt.claim.sub', :u2, false) \g /dev/null
select public.expect_error($$select public.renew_recovery_code()$$, 'no recovery code without a username');
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s1)::text, false) \g /dev/null
select public.save_account('vic_23', 'correct horse battery') ->> 'recovery_code' as old_code \gset
reset role;

-- first email, confirmed from login s1
set role service_role;
select public.two_step_make_code(:u1, :s1, 'setup', 'vic@old.com') ->> 'code' as c1 \gset
reset role;
set role authenticated;
select public.expect((public.two_step_check(:'c1') ->> 'ok') = 'true', 'the first email is confirmed');
reset role;

-- changing it from a login that never had its code is refused
set role service_role;
select public.expect_error(format($$select public.two_step_make_code(%L, %L, 'setup', 'thief@bad.com')$$, :u1, :s2), 'a login still waiting for its code cannot change the email');
select public.two_step_make_code(:u1, :s1, 'setup', 'Vic@New.com') ->> 'code' as c2 \gset
reset role;
select public.expect((select email = 'vic@old.com' and pending_email = 'vic@new.com' from private.two_step where user_id = :u1), 'the old email stays in use until the new one is confirmed');

set role authenticated;
select public.expect((public.two_step_check(:'c2') ->> 'ok') = 'true', 'the code sent to the new email confirms it');
select public.expect(public.my_account() ->> 'email' = 'v•••@new.com', 'you see a hint of the new email');
select public.renew_recovery_code() ->> 'recovery_code' as new_code \gset
select public.expect(:'new_code' <> :'old_code', 'a fresh recovery code is made');
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s2)::text, false) \g /dev/null
select public.expect_error($$select public.renew_recovery_code()$$, 'a login still waiting for its code cannot make one');
reset role;

set role service_role;
select public.expect(public.two_step_recovery_target(:u1, 'vic_23', :'new_code') ->> 'email' = 'vic@new.com', 'the new recovery code goes to the new email');
select public.expect_error(format($$select public.two_step_recovery_target(%L, 'vic_23', %L)$$, :u1, :'old_code'), 'the old recovery code stops working');
reset role;
select 'ALL CHANGE EMAIL CHECKS PASSED';
