-- Checks for username and password login (migration 0008). Runs after 01 to 07 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000008a1'''
\set u2 '''00000000-0000-0000-0000-0000000008a2'''
\set u3 '''00000000-0000-0000-0000-0000000008a3'''
insert into auth.users (id, is_anonymous) values (:u1, true), (:u2, true), (:u3, true);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Quinn', now()), (:u2, 'Rae', now());

set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false) \g /dev/null
select public.expect_error($$select public.save_account('nosignup', 'longenoughpw')$$, 'you must finish signing up first');
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select public.expect(public.my_account() is null, 'no username until you save one');
select public.expect_error($$select public.save_account('ab', 'longenoughpw')$$, 'usernames are at least 3 characters');
select public.expect_error($$select public.save_account('bad name!', 'longenoughpw')$$, 'usernames are letters, numbers and _ only');
select public.expect_error($$select public.save_account('quinn', 'short')$$, 'passwords are at least 10 characters');
select public.save_account(' Quinn_1 ', 'correct horse battery') ->> 'recovery_code' as code1 \gset
select public.expect(:'code1' ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$', 'saving gives a recovery code');
select public.expect(public.my_account() ->> 'username' = 'quinn_1', 'the username is saved in lower case');
select set_config('request.jwt.claim.sub', :u2, false) \g /dev/null
select public.expect_error($$select public.save_account('QUINN_1', 'another password')$$, 'a username can only be taken once');
select public.expect_error($$select * from public.account_logins$$, 'nobody reads usernames or recovery codes directly');
select public.expect_error($$select * from public.recovery_attempts$$, 'nobody reads recovery attempts directly');
reset role;

select public.expect((select email from auth.users where id = :u1) = 'quinn_1@users.seshon.invalid', 'the login email is made from the username');
select public.expect((select encrypted_password = extensions.crypt('correct horse battery', encrypted_password) and not is_anonymous and email_confirmed_at is not null from auth.users where id = :u1), 'the password is stored as a bcrypt hash and the account is permanent');
select public.expect((select count(*) from auth.identities where user_id = :u1 and provider = 'email') = 1, 'Supabase gets an email identity for the login');
select public.expect(not exists (select 1 from public.account_logins where recovery_hash like '%' || replace(:'code1', '-', '') || '%'), 'the recovery code itself is not stored');

-- ---- recovery from a new phone (a fresh anonymous sign-in)
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false) \g /dev/null
select public.expect(public.recover_account('quinn_1', 'AAAA-AAAA-AAAA-AAAA', 'new password 123') ->> 'ok' = 'false', 'a wrong recovery code does not work');
select public.expect(public.recover_account('nobody_here', 'AAAA-AAAA-AAAA-AAAA', 'new password 123') ->> 'message' = 'That username and recovery code don''t match.', 'an unknown username gets the same answer');
select public.recover_account('quinn_1', lower(replace(:'code1', '-', ' ')), 'new password 123') ->> 'recovery_code' as code2 \gset
select public.expect(:'code2' <> :'code1', 'the right code (any case or spacing) works and gives a new code');
select public.expect(public.recover_account('quinn_1', :'code1', 'third password 1') ->> 'ok' = 'false', 'a used recovery code stops working');
reset role;
select public.expect((select encrypted_password = extensions.crypt('new password 123', encrypted_password) from auth.users where id = :u1), 'the password was changed');

-- ---- five wrong tries a day
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false) \g /dev/null
do $$ begin for i in 1..5 loop perform public.recover_account('quinn_1', 'WRONG', 'whatever password'); end loop; end $$;
select public.expect(public.recover_account('quinn_1', :'code2', 'whatever password') ->> 'message' like 'Too many tries%', 'after 5 wrong codes, even the right one waits a day');
reset role;

-- ---- signed out visitors and deleting the account
set role anon;
select public.expect_error($$select public.recover_account('quinn_1', 'x', 'yyyyyyyyyyyy')$$, 'signed-out visitors cannot try recovery codes');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select public.delete_account() \g /dev/null
reset role;
select public.expect(not exists (select 1 from public.account_logins where user_id = :u1), 'deleting your account removes your username');
select 'ALL USERNAME LOGIN CHECKS PASSED';
