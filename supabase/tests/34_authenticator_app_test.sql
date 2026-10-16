-- Checks for authenticator app codes and staff password resets (migration 0034). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set u1 '''00000000-0000-0000-0000-0000000033a1'''
\set u2 '''00000000-0000-0000-0000-0000000033a2'''
\set adm '''00000000-0000-0000-0000-0000000033a3'''
insert into auth.users (id, is_anonymous, encrypted_password) values
  (:u1, false, extensions.crypt('correct horse battery', extensions.gen_salt('bf', 4))),
  (:u2, false, extensions.crypt('another good one', extensions.gen_salt('bf', 4))),
  (:adm, false, extensions.crypt('staff password 1', extensions.gen_salt('bf', 4)));
insert into public.profiles (id, name, adult_confirmed_at) values (:u1, 'Tia', now()), (:u2, 'Bo', now()), (:adm, 'Staff', now());
insert into public.account_logins (user_id, username, recovery_hash) values
  (:u1, 'tia_33', extensions.crypt('AAAABBBBCCCCDDDD', extensions.gen_salt('bf', 4))),
  (:u2, 'bo_33', extensions.crypt('EEEEFFFFGGGGHHHH', extensions.gen_salt('bf', 4))),
  (:adm, 'staff_33', extensions.crypt('IIIIJJJJKKKKLLLL', extensions.gen_salt('bf', 4)));
insert into private.roles (user_id, role) values (:adm, 'admin') on conflict (user_id) do update set role = 'admin';

-- ---- the maths, against the RFC 6238 test secret ("12345678901234567890")
select public.expect(private.base32_bytes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ') = convert_to('12345678901234567890', 'UTF8'), 'base32 decodes');
select public.expect(private.totp_at('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59 / 30) = '287082', 'the code at 59 seconds matches the RFC');
select public.expect(private.totp_at('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1111111109 / 30) = '081804', 'the code at 1111111109 matches the RFC');
select public.expect(private.totp_at('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 2000000000 / 30) = '279037', 'the code at 2000000000 matches the RFC');

-- ---- turning it on
set role authenticated;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :u1)::text, false) \g /dev/null
select public.totp_start() as s \gset
select public.expect((:'s'::jsonb ->> 'uri') like 'otpauth://totp/Frendzy:tia_33?secret=%&issuer=Frendzy%' and length(:'s'::jsonb ->> 'secret') = 32, 'setting up gives a secret and an otpauth link');
select public.expect(not (public.my_account() ->> 'app')::boolean, 'it is not on until the first code');
reset role;
select private.totp_at(:'s'::jsonb ->> 'secret', floor(extract(epoch from now()) / 30)::bigint) as now_code,
  case when private.totp_at(:'s'::jsonb ->> 'secret', floor(extract(epoch from now()) / 30)::bigint) = '000000' then '111111' else '000000' end as wrong_code \gset
set role authenticated;
select public.expect((public.totp_confirm(:'wrong_code') ->> 'ok') = 'false', 'a wrong first code does not turn it on');
select public.expect((public.totp_confirm(:'now_code') ->> 'ok') = 'true', 'the app''s code turns it on');
select public.expect((public.my_account() ->> 'app')::boolean, 'the You page sees it is on');
select public.expect_error($$select * from private.totp$$, 'nobody reads the secrets');
select public.expect_error($$select public.totp_start()$$, 'it can''t be set up twice');
reset role;

-- ---- logging in with it
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', '00000000-0000-0000-0000-0000000033b1'))) -> 'claims' ->> 'role' = 'needs_code', 'a new login on an app account waits for a code');
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u2, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', '00000000-0000-0000-0000-0000000033b2'))) -> 'claims' ->> 'role' = 'authenticated', 'an account without codes is let straight in');
set role needs_code;
select set_config('request.jwt.claim.sub', :u1, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', '00000000-0000-0000-0000-0000000033b1')::text, false) \g /dev/null
select public.expect((public.two_step_state() ->> 'needed')::boolean and (public.two_step_state() ->> 'app')::boolean and not (public.two_step_state() ->> 'email')::boolean, 'the login screen knows to ask for the app''s code');
select public.expect((public.totp_check(:'now_code') ->> 'ok') = 'false', 'the code used to turn it on can''t be used again');
reset role;
-- the next step's code (a phone clock a little ahead)
select private.totp_at(:'s'::jsonb ->> 'secret', floor(extract(epoch from now()) / 30)::bigint + 1) as next_code \gset
set role needs_code;
select public.expect_error($$select public.totp_start()$$, 'a waiting login can''t change the app');
select public.expect((public.totp_check(:'next_code') ->> 'ok') = 'true', 'a fresh code from the app lets the login in');
select public.expect(not (public.two_step_state() ->> 'needed')::boolean, 'and this sign-in no longer waits');
reset role;
select public.expect(public.two_step_token_hook(jsonb_build_object('user_id', :u1, 'claims', jsonb_build_object('role', 'authenticated', 'session_id', '00000000-0000-0000-0000-0000000033b1'))) -> 'claims' ->> 'role' = 'authenticated', 'its next token has full access');

-- ---- wrong codes pause it
set role needs_code;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', '00000000-0000-0000-0000-0000000033b9')::text, false) \g /dev/null
do $$ begin for i in 1..5 loop perform public.totp_check('abc'); end loop; end $$;
select public.expect(public.totp_check('123456') ->> 'message' like 'Too many wrong codes%', 'after 5 wrong codes, app codes pause for 15 minutes');
reset role;
update private.totp set tries = 0 where user_id = :u1;

-- ---- turning it off
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :u1, 'session_id', :u1)::text, false) \g /dev/null
select public.expect((public.totp_off() ->> 'ok') = 'true', 'it can be turned off');
select public.expect(not (public.my_account() ->> 'app')::boolean, 'and the You page sees it is off');
reset role;

-- ---- staff set a new password
set role authenticated;
select set_config('request.jwt.claim.sub', :u2, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :u2, 'session_id', :u2)::text, false) \g /dev/null
select public.expect_error(format('select public.admin_set_password(%L, %L)', :u1, 'a brand new password'), 'only staff can set someone''s password');
select set_config('request.jwt.claim.sub', :adm, false) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :adm, 'session_id', :adm)::text, false) \g /dev/null
select public.expect_error(format('select public.admin_set_password(%L, %L)', :u2, 'short'), 'a short password is refused');
select public.expect((public.admin_set_password(:u2, 'a brand new password') ->> 'username') = 'bo_33', 'staff set a new password');
select public.expect_error(format('select public.admin_set_password(%L, %L)', :adm, 'a brand new password'), 'not their own, from here');
reset role;
select public.expect((select encrypted_password = extensions.crypt('a brand new password', encrypted_password) from auth.users where id = :u2), 'the new password is saved');
select 'ALL AUTHENTICATOR APP CHECKS PASSED';
