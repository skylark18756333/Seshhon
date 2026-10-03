-- Checks for the venue map (migration 0009). Runs after 01 to 08 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set m1 '''00000000-0000-0000-0000-0000000008a1'''
insert into auth.users (id) values (:m1);
insert into public.profiles (id, name, adult_confirmed_at) values (:m1, 'Mo', now());
insert into public.venues (id, name, lat, lng) values ('10000000-0000-0000-0000-0000000008f1', 'Pinned Bar', -31.95, 115.86);
insert into public.venues (id, name) values ('10000000-0000-0000-0000-0000000008f2', 'No Pin Bar');
insert into public.venues (id, name, lat, lng) values ('10000000-0000-0000-0000-0000000008f3', 'Broken Pin Bar', 200, 115.86);

set role authenticated;
select set_config('request.jwt.claim.sub', :m1, false) \g /dev/null
select public.expect((select count(*) from jsonb_to_recordset(public.venue_pins()) as p(id uuid, lat float8, lng float8) where id = '10000000-0000-0000-0000-0000000008f1') = 1, 'signed-in people get venue pins');
select public.expect((select count(*) from jsonb_to_recordset(public.venue_pins()) as p(id uuid, lat float8, lng float8) where id in ('10000000-0000-0000-0000-0000000008f2', '10000000-0000-0000-0000-0000000008f3')) = 0, 'venues without a valid position have no pin');
select public.expect((select count(*) from jsonb_to_recordset(public.venue_pins()) as p(id uuid, lat float8, lng float8) where id = 'a0000000-0000-4000-8000-000000000001' and lat < -31) = 1, 'example venues have pins');
reset role;
set role anon;
select public.expect_error($$select public.venue_pins()$$, 'signed-out visitors cannot read venue pins');
reset role;
select 'ALL VENUE MAP CHECKS PASSED';
