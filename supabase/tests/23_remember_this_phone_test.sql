-- Checks for remembering a phone (migration 0023). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000023a1'''
\set u2 '''00000000-0000-0000-0000-0000000023a2'''
\set s1 '''00000000-0000-0000-0000-0000000023b1'''
\set s2 '''00000000-0000-0000-0000-0000000023b2'''
\set s3 '''00000000-0000-0000-0000-0000000023b3'''
\set s4 '''00000000-0000-0000-0000-0000000023b4'''
insert into auth.users (id, is_anonymous) values (:u1, true), (:u2, true);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Rae', now()), (:u2, 'Max', now());

set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s1)::text, false) \g /dev/null
select public.save_account('rae_23', 'correct horse battery') \g /dev/null
select public.expect(public.two_step_remember_device() is null, 'no email codes: nothing to remember');
reset role;
insert into private.two_step (user_id, email) values (:u1, 'rae@example.com'), (:u2, 'max@example.com');

-- ---- only a login that has had its code can remember the phone
set role authenticated;
select public.expect_error('select public.two_step_remember_device()', 'a login without its code cannot remember the phone');
reset role;
select private.mark_verified(:u1, :s1) \g /dev/null
set role authenticated;
select public.two_step_remember_device() as token \gset
select public.expect(length(:'token') = 64, 'the phone gets a long random secret');
reset role;
select public.expect(not exists (select 1 from private.two_step_devices where token_hash = :'token'), 'only a hash of the secret is kept');
select public.expect(private.session_verified(:u1, :s2) = false, 'a new login starts without its code');

-- ---- a new login on the remembered phone skips the code
set role needs_code;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s2)::text, false) \g /dev/null
select public.expect(public.two_step_use_device('not the secret') = false, 'a wrong secret does nothing');
select public.expect(public.two_step_use_device(null) = false, 'no secret does nothing');
select public.expect(public.two_step_use_device(:'token') = true, 'the remembered phone is let in');
reset role;
select public.expect(private.session_verified(:u1, :s2), 'that login now counts as having had its code');
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', :s2))) #>> '{claims,role}' = 'authenticated', 'its next token is a normal one');

-- ---- the secret is no use on someone else's account
set role needs_code;
select set_config('request.jwt.claim.sub', :u2, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u2, 'session_id', :s3)::text, false) \g /dev/null
select public.expect(public.two_step_use_device(:'token') = false, 'another account cannot use the secret');
reset role;
select public.expect(not private.session_verified(:u2, :s3), 'so that login still needs its code');

-- ---- people cannot reach the table
set role authenticated;
select public.expect_error('select * from private.two_step_devices', 'the remembered phones cannot be read');
reset role;
set role anon;
select public.expect_error($$select public.two_step_use_device('x')$$, 'signed-out visitors cannot try secrets');
reset role;

-- ---- an old secret runs out
update private.two_step_devices set expires_at = now() - interval '1 minute' where user_id = :u1;
set role needs_code;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s3)::text, false) \g /dev/null
select public.expect(public.two_step_use_device(:'token') = false, 'after 30 days the code is needed again');
reset role;

-- ---- at most 10 phones per account
select private.mark_verified(:u1, :s4) \g /dev/null
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s4)::text, false) \g /dev/null
select count(public.two_step_remember_device()) from generate_series(1, 12) \g /dev/null
reset role;
select public.expect((select count(*) from private.two_step_devices where user_id = :u1) = 10, 'only the newest 10 phones are kept');

-- ---- a new password forgets every remembered phone
set role authenticated;
select public.two_step_remember_device() as token2 \gset
select public.save_account('rae_23', 'another long password') \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.two_step_devices where user_id = :u1), 'changing the password forgets them all');
set role needs_code;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s3)::text, false) \g /dev/null
select public.expect(public.two_step_use_device(:'token2') = false, 'so an old secret no longer works');
reset role;
select 'ALL REMEMBER THIS PHONE CHECKS PASSED';
