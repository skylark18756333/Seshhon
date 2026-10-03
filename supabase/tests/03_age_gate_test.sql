-- Checks for the age gate (migration 0003). Runs after 01 and 02 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set d '''00000000-0000-0000-0000-0000000000d1'''
\set e '''00000000-0000-0000-0000-0000000000e1'''
insert into auth.users (id) values (:d), (:e);

set role authenticated;
select set_config('request.jwt.claim.sub', :d, false) \g /dev/null
select public.expect_error($$select public.api_sign_up('Kid', ((now() at time zone 'Australia/Perth')::date - interval '17 years')::date)$$, 'a 17-year-old cannot sign up');
select public.expect_error($$select public.api_sign_up('Kid', ((now() at time zone 'Australia/Perth')::date - interval '18 years' + interval '1 day')::date)$$, 'someone who turns 18 tomorrow cannot sign up');
select public.expect_error($$select public.api_sign_up('Kid', (now() at time zone 'Australia/Perth')::date)$$, 'someone born today cannot sign up');
select public.expect_error($$select public.api_sign_up('Nope', null)$$, 'a missing date of birth is refused');
select public.expect_error($$select public.api_sign_up('Nope', ((now() at time zone 'Australia/Perth')::date + 1))$$, 'a future date of birth is refused');
select public.expect_error($$select public.api_sign_up('', date '1990-01-01')$$, 'an empty name is refused');
reset role;
select public.expect(not exists (select 1 from public.profiles where id = :d), 'no profile was created by the refused attempts');

set role authenticated;
select set_config('request.jwt.claim.sub', :d, false) \g /dev/null
select public.api_sign_up('Adult', ((now() at time zone 'Australia/Perth')::date - interval '18 years')::date) \g /dev/null
reset role;
select public.expect(exists (select 1 from public.profiles where id = :d), 'someone who turned 18 today can sign up');

set role authenticated;
select set_config('request.jwt.claim.sub', :e, false) \g /dev/null
select public.api_sign_up('Older', date '1990-05-01') \g /dev/null
select public.expect(public.api_state() #>> '{me,name}' = 'Older', 'the app loads after the new sign-up');
select public.expect((select bool_or((x ->> 'is_alcohol')::boolean) from jsonb_array_elements(public.api_state() -> 'deals') x), 'the app is told which deals are alcohol');
select public.rate_venue('a0000000-0000-4000-8000-000000000001', 4, array[]::text[]) \g /dev/null
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :d, false) \g /dev/null
select public.rate_venue('a0000000-0000-4000-8000-000000000001', 2, array[]::text[]) \g /dev/null
select public.expect((select count(*) from public.ratings) = 1, 'you can only read your own ratings');
select public.expect((select ratings from public.venue_ratings where venue_id = 'a0000000-0000-4000-8000-000000000001') = 2, 'venue totals still count everyone');
reset role;
select public.expect(not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name ilike '%birth%'), 'no date of birth is stored anywhere');
select 'ALL AGE GATE CHECKS PASSED';
