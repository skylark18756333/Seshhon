-- Checks for the Security Advisor fixes (migration 0007). Runs after 01 to 06 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set r1 '''00000000-0000-0000-0000-0000000007a1'''
\set r2 '''00000000-0000-0000-0000-0000000007a2'''
insert into auth.users (id) values (:r1), (:r2);
insert into public.profiles (id, name, adult_confirmed_at) values (:r1, 'Ola', now()), (:r2, 'Pat', now());
insert into public.venues (id, name) values ('10000000-0000-0000-0000-0000000000f9', 'Linter Bar');
insert into public.ratings (venue_id, user_id, stars) values ('10000000-0000-0000-0000-0000000000f9', :r1, 2), ('10000000-0000-0000-0000-0000000000f9', :r2, 5);

select public.expect(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('local_now', 'night_of', 'deal_is_running', 'new_invite_code', 'check_alcohol_deal_count')
    and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
), 'every flagged function has a fixed search path');
select public.expect(exists (
  select 1 from pg_class where oid = 'public.venue_ratings'::regclass and 'security_invoker=true' = any (reloptions)
), 'venue_ratings runs with the reader''s own rights');

set role authenticated;
select set_config('request.jwt.claim.sub', :r1, false) \g /dev/null
select public.expect((select average from public.venue_ratings where venue_id = '10000000-0000-0000-0000-0000000000f9') = 3.5
  and (select ratings from public.venue_ratings where venue_id = '10000000-0000-0000-0000-0000000000f9') = 2, 'venue averages still count everyone''s ratings');
select public.expect((select count(*) from public.ratings where venue_id = '10000000-0000-0000-0000-0000000000f9') = 1, 'but you still only see your own rating');
reset role;
set role anon;
select public.expect_error($$select * from public.venue_ratings$$, 'signed-out visitors cannot read venue ratings');
reset role;
select 'ALL LINTER CHECKS PASSED';
