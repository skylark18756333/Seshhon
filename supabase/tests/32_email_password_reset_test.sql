-- Checks for resetting a password with an emailed code (migration 0032). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000032a1'''
\set u2 '''00000000-0000-0000-0000-0000000032a2'''
\set u3 '''00000000-0000-0000-0000-0000000032a3'''
insert into auth.users (id, is_anonymous, encrypted_password) values
  (:u1, false, extensions.crypt('correct horse battery', extensions.gen_salt('bf', 4))),
  (:u2, false, extensions.crypt('another good one', extensions.gen_salt('bf', 4))),
  (:u3, true, null);
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Ren', now()), (:u2, 'Kit', now());
insert into public.account_logins (user_id, username, recovery_hash) values
  (:u1, 'ren_32', extensions.crypt('AAAABBBBCCCCDDDD', extensions.gen_salt('bf', 4))),
  (:u2, 'kit_32', extensions.crypt('EEEEFFFFGGGGHHHH', extensions.gen_salt('bf', 4)));
insert into private.two_step (user_id, email, pending_email) values (:u1, 'ren@example.com', null), (:u2, null, 'kit@example.com');

-- ---- making codes (only the Edge Function, with the service key)
set role anon;
select public.expect_error($$select public.reset_make_code('ren@example.com')$$, 'signed-out visitors cannot make codes');
reset role;
set role authenticated;
select public.expect_error($$select public.reset_make_code('ren@example.com')$$, 'signed-in people cannot make codes either');
reset role;
select public.reset_make_code(' REN@Example.com ') as made \gset
select public.expect(jsonb_array_length(:'made'::jsonb -> 'sends') = 1 and (:'made'::jsonb -> 'sends' -> 0 ->> 'username') = 'ren_32', 'a confirmed email gets one code, for its account');
select public.expect(jsonb_array_length(public.reset_make_code('nobody@example.com') -> 'sends') = 0, 'an email with no account gets no code');
select public.expect(jsonb_array_length(public.reset_make_code('kit@example.com') -> 'sends') = 0, 'an email that was never confirmed gets no code');
select public.expect(not exists (select 1 from private.reset_sends where email_hash like '%@%'), 'only hashes of emails are kept');
select public.expect(not exists (select 1 from private.reset_codes where code_hash = (:'made'::jsonb -> 'sends' -> 0 ->> 'code')), 'only a hash of the code is kept');
select (:'made'::jsonb -> 'sends' -> 0 ->> 'code') as code, case when (:'made'::jsonb -> 'sends' -> 0 ->> 'code') = '000000' then '111111' else '000000' end as wrong \gset

-- ---- using the code
set role authenticated;
select set_config('request.jwt.claim.sub', :u3, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u3, 'session_id', :u3)::text, false) \g /dev/null
select public.expect_error($$select * from private.reset_codes$$, 'nobody reads the codes');
select public.expect((public.reset_password('ren@example.com', :'wrong', 'brand new password') ->> 'ok') = 'false', 'a wrong code does not work');
select public.expect((public.reset_password('kit@example.com', :'code', 'brand new password') ->> 'ok') = 'false', 'the code only works with its own email');
select public.expect_error(format('select public.reset_password(%L, %L, %L)', 'ren@example.com', :'code', 'short'), 'a short new password is refused');
select public.reset_password('Ren@Example.com', :'code', 'brand new password') as r \gset
select public.expect((:'r'::jsonb ->> 'username') = 'ren_32' and (:'r'::jsonb ? 'ticket'), 'the right code sets the password and gives the username');
select public.expect((public.reset_password('ren@example.com', :'code', 'another new password') ->> 'ok') = 'false', 'a code works only once');
reset role;
select public.expect((select encrypted_password = extensions.crypt('brand new password', encrypted_password) from auth.users where id = :u1), 'the new password is saved');
select public.expect((select ticket_hash is not null from private.two_step where user_id = :u1), 'the next login can skip the email code once');

-- ---- a code stops after 5 wrong tries
select (public.reset_make_code('ren@example.com') -> 'sends' -> 0 ->> 'code') as code2 \gset
set role authenticated;
do $$ begin for i in 1..5 loop perform public.reset_password('ren@example.com', 'abc', 'brand new password'); end loop; end $$;
select public.expect((public.reset_password('ren@example.com', :'code2', 'brand new password 3') ->> 'ok') = 'false', 'after 5 wrong tries the code stops working');
reset role;

-- ---- limits on sending
select public.reset_make_code('ren@example.com') \g /dev/null
select public.expect_error($$select public.reset_make_code('ren@example.com')$$, 'at most 3 codes an hour for an email');
select public.expect_error($$select public.reset_make_code('not an email')$$, 'a made-up email is refused');
delete from private.reset_sends;
delete from public.recovery_attempts where username like 'reset:%';

set role anon;
select public.expect_error($$select public.reset_password('ren@example.com', '123456', 'brand new password')$$, 'signed-out visitors cannot reset directly');
reset role;
select 'ALL EMAIL PASSWORD RESET CHECKS PASSED';
