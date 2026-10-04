-- Checks for venue opening hours (migration 0015). Runs after 01 to 14 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set st '''00000000-0000-0000-0000-0000000015a1'''
\set gu '''00000000-0000-0000-0000-0000000015a2'''
insert into auth.users (id) values (:st), (:gu);
insert into public.profiles (id, name, adult_confirmed_at) values (:st, 'Sam', now()), (:gu, 'Gus', now());
insert into public.venues (id, name, osm_id, opening_hours, hours_source) values ('10000000-0000-0000-0000-0000000015f1', 'Hours Bar', 'node/1501', 'Mo-Su 12:00-22:00', 'osm');
insert into public.venue_staff (venue_id, user_id) values ('10000000-0000-0000-0000-0000000015f1', :st);

set role authenticated;
select set_config('request.jwt.claim.sub', :gu, false) \g /dev/null
select public.expect((select v ->> 'hours' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Hours Bar') = 'Mo-Su 12:00-22:00', 'everyone sees a venue''s opening hours');
select public.expect((select v ->> 'hours' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Lowtide Bar') is not null, 'example venues have hours');
select public.expect_error($$select public.set_venue_hours('10000000-0000-0000-0000-0000000015f1', 'Mo-Su 00:00-24:00')$$, 'someone who does not work there cannot change the hours');
select set_config('request.jwt.claim.sub', :st, false) \g /dev/null
select public.set_venue_hours('10000000-0000-0000-0000-0000000015f1', '  Mo-Th 16:00-24:00;   Fr,Sa 16:00-02:00 ') \g /dev/null
select public.expect((select v ->> 'hours' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Hours Bar') = 'Mo-Th 16:00-24:00; Fr,Sa 16:00-02:00', 'staff can change their venue''s hours');
select public.expect_error($$select public.set_venue_hours('10000000-0000-0000-0000-0000000015f1', '<script>')$$, 'hours with odd characters are refused');
reset role;
-- A later OpenStreetMap import leaves staff hours alone.
insert into public.venues (osm_id, name, kind, lat, lng, opening_hours, hours_source) values ('node/1501', 'Hours Bar', 'Bar', -31.95, 115.86, 'Mo-Su 10:00-11:00', 'osm')
on conflict (osm_id) do update set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lng = excluded.lng,
  opening_hours = case when venues.hours_source = 'staff' then venues.opening_hours else excluded.opening_hours end,
  hours_source = case when venues.hours_source = 'staff' then 'staff' else excluded.hours_source end;
select public.expect((select opening_hours from public.venues where osm_id = 'node/1501') = 'Mo-Th 16:00-24:00; Fr,Sa 16:00-02:00', 'an import never overwrites hours staff have set');
set role authenticated;
select set_config('request.jwt.claim.sub', :st, false) \g /dev/null
select public.set_venue_hours('10000000-0000-0000-0000-0000000015f1', '') \g /dev/null
select public.expect((select v ->> 'hours' from jsonb_array_elements(public.api_venues()) v where v ->> 'name' = 'Hours Bar') is null, 'staff can clear the hours');
reset role;
set role anon;
select public.expect_error($$select public.set_venue_hours('10000000-0000-0000-0000-0000000015f1', 'Mo-Su 12:00-22:00')$$, 'signed-out visitors cannot change hours');
reset role;
select 'ALL VENUE HOURS CHECKS PASSED';
