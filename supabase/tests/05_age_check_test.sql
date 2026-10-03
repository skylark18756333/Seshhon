-- Checks for the third-party age check (migration 0005). Runs after 01 to 04 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set p '''00000000-0000-0000-0000-0000000000f1'''
\set q '''00000000-0000-0000-0000-0000000000f2'''
\set old '''00000000-0000-0000-0000-0000000000f3'''
\set sneak '''00000000-0000-0000-0000-0000000000f4'''
insert into auth.users (id) values (:p), (:q), (:old), (:sneak);

-- While the check is off (the default), sign-up works as before.
set role authenticated;
select set_config('request.jwt.claim.sub', :old, false) \g /dev/null
select public.expect((public.age_check_state() ->> 'required')::boolean = false, 'the age check is off until switched on');
select public.api_sign_up('Olly', date '1990-01-01') \g /dev/null
select public.expect_error($$insert into public.profiles (id, name, adult_confirmed_at) values ('00000000-0000-0000-0000-0000000000f4', 'Sneak', now())$$, 'nobody can create a profile without going through sign-up');
select public.expect_error($$update public.app_settings set age_check_required = false$$, 'people cannot switch the age check off');
select public.expect_error($$select * from public.age_checks$$, 'people cannot read the age check table directly');
select public.expect_error($$select public.age_check_decide('00000000-0000-0000-0000-000000000000', 'passed', 'face_estimate')$$, 'people cannot mark their own check as passed');
select public.expect_error($$select public.age_check_begin(auth.uid(), 'yoti', 'x')$$, 'people cannot start a check record themselves');
reset role;

update public.app_settings set age_check_required = true;

set role authenticated;
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.expect((public.age_check_state() ->> 'required')::boolean and not (public.age_check_state() ->> 'passed')::boolean, 'once switched on, a new person is told they need the check');
select public.expect_error($$select public.api_sign_up('Pia', date '1990-01-01')$$, 'sign-up is refused before the age check');
select public.expect_error($$select public.api_sign_up('Pia', ((now() at time zone 'Australia/Perth')::date - interval '17 years')::date)$$, 'the date of birth gate still applies');
reset role;

-- The Edge Function (service role) records a check that is still running, then a failed one.
set role service_role;
select public.expect(public.age_check_can_start(:p) ->> 'provider' = 'yoti', 'the function is told which provider to use');
select public.age_check_begin(:p, 'yoti', 'sess-1') \g /dev/null
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.expect((public.age_check_state() ->> 'pending')::boolean, 'a running check shows as pending');
select public.expect_error($$select public.api_sign_up('Pia', date '1990-01-01')$$, 'a pending check does not let you in');
reset role;
set role service_role;
select public.age_check_decide((public.age_check_latest(:p) ->> 'id')::uuid, 'failed', null) \g /dev/null
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.expect_error($$select public.api_sign_up('Pia', date '1990-01-01')$$, 'a failed check does not let you in');
select public.expect((public.age_check_state() ->> 'failed_today')::int = 1, 'the app can tell the check failed');
reset role;

-- A second attempt passes.
set role service_role;
select public.age_check_begin(:p, 'yoti', 'sess-2') \g /dev/null
select public.age_check_decide((public.age_check_latest(:p) ->> 'id')::uuid, 'passed', 'face_estimate') \g /dev/null
select public.expect(public.age_check_decide((public.age_check_latest(:p) ->> 'id')::uuid, 'failed', null) is not null
  and public.age_check_latest(:p) ->> 'result' = 'passed', 'a decided check cannot be changed afterwards');
select public.expect_error($$select public.age_check_can_start('00000000-0000-0000-0000-0000000000f1')$$, 'no new check once passed');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.api_sign_up('Pia', date '1990-01-01') \g /dev/null
select public.expect(public.api_state() #>> '{me,name}' = 'Pia', 'after passing, sign-up works');
select public.set_status('on') \g /dev/null
select public.expect(public.api_state() #>> '{me,colour}' = 'on', 'a verified person can go green');
reset role;
select public.expect((select age_verified_at is not null from public.profiles where id = :p), 'the profile keeps when they passed');

-- Someone who signed up before the switch stays hidden until they pass.
set role authenticated;
select set_config('request.jwt.claim.sub', :old, false) \g /dev/null
select public.expect_error($$select public.set_status('on')$$, 'an unchecked older account cannot go green');
select public.expect_error($$select public.set_status('thinking')$$, 'or amber');
select public.set_status('off') \g /dev/null
reset role;
set role service_role;
select public.age_check_begin(:old, 'didit', 'sess-3') \g /dev/null
select public.age_check_decide((public.age_check_latest(:old) ->> 'id')::uuid, 'passed', 'id_document') \g /dev/null
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :old, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect(public.api_state() #>> '{me,colour}' = 'on', 'once the older account passes, it can go green');
reset role;

-- Five attempts a day at most, because each one costs money.
set role service_role;
select public.age_check_begin(:q, 'yoti', 'q-' || n) from generate_series(1, 5) n \g /dev/null
select public.expect_error($$select public.age_check_can_start('00000000-0000-0000-0000-0000000000f2')$$, 'a sixth attempt in a day is refused');
reset role;
select public.expect((select count(*) from public.age_checks where user_id = :q and result = 'pending') = 1, 'only the newest attempt stays pending');

-- Deleting an account removes its age check records.
set role authenticated;
select set_config('request.jwt.claim.sub', :p, false) \g /dev/null
select public.delete_account() \g /dev/null
reset role;
select public.expect(not exists (select 1 from public.age_checks where user_id = :p), 'deleting your account removes your age checks');

select public.expect(not exists (
  select 1 from information_schema.columns where table_schema = 'public'
    and (column_name ilike '%birth%' or column_name ilike '%photo%' or column_name ilike '%selfie%' or column_name ilike '%image%' or column_name ilike '%estimate%')
), 'no date of birth, photo or age estimate is stored anywhere');

update public.app_settings set age_check_required = false;
select 'ALL AGE CHECK CHECKS PASSED';
