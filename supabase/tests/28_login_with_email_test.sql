-- Checks for logging in and recovering with an email (migration 0028). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000028a1'''
\set u2 '''00000000-0000-0000-0000-0000000028a2'''
\set u3 '''00000000-0000-0000-0000-0000000028a3'''
insert into auth.users (id, is_anonymous, encrypted_password) values
  (:u1, false, extensions.crypt('correct horse battery', extensions.gen_salt('bf', 4))),
  (:u2, false, extensions.crypt('another good one', extensions.gen_salt('bf', 4))),
  (:u3, true, null);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Lou', now()), (:u2, 'Max', now());
insert into public.account_logins (user_id, username, recovery_hash) values
  (:u1, 'lou_28', extensions.crypt('AAAABBBBCCCCDDDD', extensions.gen_salt('bf', 4))),
  (:u2, 'max_28', extensions.crypt('EEEEFFFFGGGGHHHH', extensions.gen_salt('bf', 4)));
insert into private.two_step (user_id, email, pending_email) values (:u1, 'lou@example.com', null), (:u2, null, 'max@example.com');

-- ---- logging in with an email
set role anon;
select public.expect((public.email_login_name(' LOU@Example.com ', 'correct horse battery') ->> 'username') = 'lou_28', 'the confirmed email and the right password give the username');
select public.expect((public.email_login_name('lou@example.com', 'wrong password') ->> 'ok') = 'false', 'a wrong password gives nothing');
select public.expect(public.email_login_name('lou@example.com', 'wrong password') ->> 'message' = public.email_login_name('nobody@example.com', 'wrong password') ->> 'message', 'an email with no account gets the same answer');
select public.expect((public.email_login_name('max@example.com', 'another good one') ->> 'ok') = 'false', 'an email that was never confirmed does not log in');
select public.expect(not (public.email_login_name('lou@example.com', 'wrong password') ? 'username'), 'a wrong password never sees the username');
select public.expect_error($$select * from private.email_login_attempts$$, 'nobody reads the tries');
reset role;
select public.expect(not exists (select 1 from private.email_login_attempts where email_hash like '%@%'), 'only hashes of emails are kept');
set role anon;
do $$ begin for i in 1..10 loop perform public.email_login_name('lou@example.com', 'wrong password'); end loop; end $$;
select public.expect(public.email_login_name('lou@example.com', 'correct horse battery') ->> 'message' like 'Too many tries%', 'after 10 wrong tries in an hour, the email is paused');
reset role;
delete from private.email_login_attempts;

-- ---- recovering with an email
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u3, 'session_id', :u3)::text, false) \g /dev/null
select public.expect((public.recover_account('lou@example.com', 'EEEE-FFFF-GGGG-HHHH', 'brand new password') ->> 'message') = 'That email and recovery code don''t match.', 'another account''s code does not work with this email');
select public.expect((public.recover_account('max@example.com', 'EEEE-FFFF-GGGG-HHHH', 'brand new password') ->> 'ok') = 'false', 'an email that was never confirmed cannot recover');
select public.recover_account('Lou@Example.com', 'aaaa-bbbb-cccc-dddd', 'brand new password') as r \gset
select public.expect((:'r'::jsonb ->> 'username') = 'lou_28' and (:'r'::jsonb ? 'ticket'), 'the email and the right recovery code work, and give the username');
select public.expect((public.recover_account('max_28', 'EEEE-FFFF-GGGG-HHHH', 'brand new password 2') ->> 'ok') = 'true', 'a username still works too');
do $$ begin for i in 1..5 loop perform public.recover_account('lou@example.com', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'brand new password'); end loop; end $$;
select public.expect(public.recover_account('lou@example.com', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'brand new password') ->> 'message' like 'Too many tries for that email%', 'at most 5 wrong tries a day for an email');
reset role;
select public.expect((select encrypted_password = extensions.crypt('brand new password', encrypted_password) from auth.users where id = :u1), 'the new password is saved');
select public.expect(not exists (select 1 from public.recovery_attempts where username like '%@%'), 'emails are not stored with the tries');
set role anon;
select public.expect_error($$select public.recover_account('lou@example.com', 'AAAA-BBBB-CCCC-DDDD', 'brand new password')$$, 'signed-out visitors cannot recover directly');
reset role;
select 'ALL EMAIL LOG IN CHECKS PASSED';
