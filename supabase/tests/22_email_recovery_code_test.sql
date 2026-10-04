-- Checks for emailing the recovery code (migration 0022). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000022a1'''
\set u2 '''00000000-0000-0000-0000-0000000022a2'''
insert into auth.users (id, is_anonymous) values (:u1, true), (:u2, true);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Uma', now());

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :u1)::text, false) \g /dev/null
select public.save_account('uma_22', 'correct horse battery') ->> 'recovery_code' as code \gset
reset role;

set role service_role;
select public.expect_error(format($$select public.two_step_recovery_target(%L, 'uma_22', %L)$$, :u1, :'code'), 'no email until one is confirmed');
reset role;
insert into private.two_step (user_id, email) values (:u1, 'uma@example.com');

set role authenticated;
select public.expect_error(format($$select public.two_step_recovery_target(%L, 'uma_22', %L)$$, :u1, :'code'), 'people cannot ask for it themselves');
reset role;
set role service_role;
select public.expect_error(format($$select public.two_step_recovery_target(%L, 'uma_22', 'AAAA-BBBB-CCCC-DDDD')$$, :u1), 'only the current recovery code is sent');
select public.expect_error(format($$select public.two_step_recovery_target(null, 'uma_22', %L)$$, :'code'), 'someone must be signed in');
select public.expect(public.two_step_recovery_target(:u1, 'UMA_22', lower(:'code')) ->> 'email' = 'uma@example.com', 'the right code goes to the confirmed email');
select public.expect(public.two_step_recovery_target(:u2, 'uma_22', :'code') ->> 'email' = 'uma@example.com', 'after a recovery on a new phone, it still goes to the account''s own email');
select public.expect_error(format($q$do $x$ begin for i in 1..5 loop perform public.two_step_recovery_target(%L, 'uma_22', %L); end loop; end $x$$q$, :u1, :'code'), 'at most 5 emails an hour');
reset role;
select 'ALL EMAIL RECOVERY CODE CHECKS PASSED';
