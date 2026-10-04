-- Checks for email two-step login (migration 0018). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000018a1'''
\set u2 '''00000000-0000-0000-0000-0000000018a2'''
\set s1 '''00000000-0000-0000-0000-0000000018b1'''
\set s2 '''00000000-0000-0000-0000-0000000018b2'''
\set s3 '''00000000-0000-0000-0000-0000000018b3'''
grant execute on function public.expect(boolean, text), public.expect_error(text, text) to needs_code;
insert into auth.users (id, is_anonymous) values (:u1, true), (:u2, true);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Sky', now()), (:u2, 'Tam', now());

-- ---- an account without email codes logs in as before
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s1)::text, false) \g /dev/null
select public.save_account('sky_1', 'correct horse battery') \g /dev/null
select public.expect((public.two_step_state() ->> 'needed') = 'false', 'no email yet: no code needed');
reset role;
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', :s2))) #>> '{claims,role}' = 'authenticated', 'no email yet: the hook leaves logins alone');

-- ---- only the Edge Function (service key) can make codes
set role authenticated;
select public.expect_error($$select public.two_step_make_code(auth.uid(), null, 'setup', 'a@b.co')$$, 'people cannot make their own codes');
reset role;
set role service_role;
select public.expect_error(format($$select public.two_step_make_code(%L, %L, 'setup', 'not an email')$$, :u1, :s1), 'a real email address is needed');
select public.expect_error(format($$select public.two_step_make_code(%L, %L, 'setup', 'a@b.co')$$, :u2, :s1), 'you need a username first');
select public.expect_error(format($$select public.two_step_make_code(%L, %L, 'login')$$, :u1, :s2), 'no login codes before an email is confirmed');
select public.two_step_make_code(:u1, :s1, 'setup', ' Sky@Example.com ') ->> 'code' as setup_code \gset
reset role;
select public.expect(:'setup_code' ~ '^\d{6}$', 'codes are 6 digits');
select public.expect((select email is null and pending_email = 'sky@example.com' and code_hash <> :'setup_code' from private.two_step where user_id = :u1), 'the email waits for its code and only a hash of the code is kept');

-- ---- confirming the email
set role authenticated;
select public.expect((public.two_step_check('000000') ->> 'ok') = 'false' or :'setup_code' = '000000', 'a wrong code does not work');
select public.expect((public.two_step_check(' ' || :'setup_code') ->> 'ok') = 'true', 'the right code confirms the email');
select public.expect((public.two_step_state() ->> 'needed') = 'false', 'the sign-in that confirmed it stays logged in');
select public.expect(public.my_account() ->> 'email' = 's•••@example.com', 'you only see a hint of your email');
select public.expect((public.two_step_check(:'setup_code') ->> 'ok') = 'false', 'a used code stops working');
select public.expect_error($$select * from private.two_step$$, 'nobody reads emails directly');
reset role;
select public.expect((select email from private.two_step where user_id = :u1) = 'sky@example.com', 'the email is saved');

-- ---- a new login is held back until its code
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', :s2))) #>> '{claims,role}' = 'needs_code', 'a new login gets the waiting role');
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', :s1))) #>> '{claims,role}' = 'authenticated', 'the confirmed sign-in keeps its normal role');
select public.expect(public.two_step_token_hook('{"user_id": "not a uuid", "claims": {"role": "authenticated"}}') #>> '{claims,role}' = 'authenticated', 'a broken hook call never blocks a login');
set role needs_code;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s2)::text, false) \g /dev/null
select public.expect((public.two_step_state() ->> 'needed') = 'true', 'the new login is told it needs a code');
select public.expect_error($$select public.api_state()$$, 'the waiting role can do nothing else');
select public.expect_error($$select public.my_account()$$, 'the waiting role cannot see the account');
reset role;
set role service_role;
select public.expect_error(format($$select public.two_step_make_code(%L, %L, 'login')$$, :u1, :s1), 'no codes for a sign-in that already had one');
select public.expect_error(format($$select public.two_step_make_code(%L, %L, 'setup', 'x@y.co')$$, :u1, :s2), 'changing the email needs a sign-in that had its code');
select public.two_step_make_code(:u1, :s2, 'login') ->> 'code' as login_code \gset
reset role;
set role needs_code;
do $$ begin for i in 1..5 loop perform public.two_step_check('999999x'); end loop; end $$;
select public.expect((public.two_step_check(:'login_code') ->> 'ok') = 'false', 'after 5 wrong tries, the code stops working');
reset role;
set role service_role;
select public.two_step_make_code(:u1, :s2, 'login') ->> 'code' as login_code \gset
reset role;
set role needs_code;
select public.expect((public.two_step_check(:'login_code') ->> 'ok') = 'true', 'a fresh code lets the login in');
reset role;
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', :s2))) #>> '{claims,role}' = 'authenticated', 'after the code, the next token is a normal one');

-- ---- too many emails
set role service_role;
select public.expect_error(format($q$do $x$ begin for i in 1..5 loop perform public.two_step_make_code(%L, %L, 'login'); end loop; end $x$$q$, :u1, :s3), 'at most 5 codes an hour');
reset role;
delete from private.two_step_sends where user_id = :u1;

-- ---- a recovery code skips the email once
-- (the test never kept the recovery code, so set a known one)
update public.account_logins set recovery_hash = extensions.crypt('AAAABBBBCCCCDDDD', extensions.gen_salt('bf', 4)) where user_id = :u1;
delete from public.recovery_attempts;
set role authenticated;
select public.recover_account('sky_1', 'AAAA-BBBB-CCCC-DDDD', 'new password 123') ->> 'ticket' as ticket \gset
reset role;
select public.expect(not exists (select 1 from private.two_step_sessions where user_id = :u1), 'a recovery signs out every earlier login');
set role needs_code;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s3)::text, false) \g /dev/null
select public.expect(not public.two_step_use_ticket('wrong'), 'a wrong ticket does nothing');
select public.expect(public.two_step_use_ticket(:'ticket'), 'the ticket lets the first login in');
select public.expect((public.two_step_state() ->> 'needed') = 'false', 'that login needs no email code');
select public.expect(not public.two_step_use_ticket(:'ticket'), 'a ticket works once');
reset role;

-- ---- signed out visitors and deleting the account
set role anon;
select public.expect_error($$select public.two_step_check('123456')$$, 'signed-out visitors cannot try codes');
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :s3)::text, false) \g /dev/null
select public.delete_account() \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.two_step where user_id = :u1), 'deleting the account deletes its email');
select 'ALL EMAIL TWO-STEP CHECKS PASSED';
