-- Checks meet in the middle (migration 0037). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set org '''00000000-0000-0000-0000-0000000037a1'''
\set mate '''00000000-0000-0000-0000-0000000037a2'''
\set out '''00000000-0000-0000-0000-0000000037a3'''
\set s '''20000000-0000-0000-0000-0000000037c1'''
\set west '''10000000-0000-0000-0000-0000000037f1'''
\set mid '''10000000-0000-0000-0000-0000000037f2'''
\set east '''10000000-0000-0000-0000-0000000037f3'''
insert into auth.users (id) values (:org), (:mate), (:out);
insert into public.profiles (id, name, adult_confirmed_at) values (:org, 'Org', now()), (:mate, 'Mate', now()), (:out, 'Out', now());
-- Far from every other test venue, so only these three are near.
insert into public.venues (id, name, lat, lng) values (:west, 'West Bar', -20.0, 118.0), (:mid, 'Middle Bar', -20.0, 118.1), (:east, 'East Bar', -20.0, 118.2);
insert into public.seshes (id, creator) values (:s, :org);
insert into public.sesh_members (sesh_id, user_id) values (:s, :org), (:s, :mate);

set role authenticated;
select set_config('request.jwt.claim.sub', :org, false) \g /dev/null
select public.expect((public.meet_venues(:s) -> 'venues') = '[]'::jsonb, 'no venues before anyone shares');
select public.meet_share(:s, -20.0012, 118.0013) \g /dev/null
select public.expect((public.meet_venues(:s) ->> 'shared')::int = 1 and (public.meet_venues(:s) -> 'venues') = '[]'::jsonb,
  'one person sharing is not enough to find a middle');
select public.expect((public.meet_venues(:s) ->> 'mine')::boolean, 'you can see that you are sharing');

select set_config('request.jwt.claim.sub', :mate, false) \g /dev/null
select public.expect(not (public.meet_venues(:s) ->> 'mine')::boolean, 'a mate who has not shared is told so');
select public.meet_share(:s, -20.0, 118.2) \g /dev/null
select public.expect((public.meet_venues(:s) -> 'venues' ->> 0) = :mid, 'the venue in the middle comes first');
select public.expect((select array_agg(k order by k) from jsonb_object_keys(public.meet_venues(:s)) k) = array['mine', 'shared', 'venues'],
  'the answer has venues and a count, never anyone''s position');
select public.expect(not exists (select 1 from jsonb_array_elements(public.meet_venues(:s) -> 'venues') x where jsonb_typeof(x) <> 'string'),
  'venues are bare ids, with no distances');
select public.expect_error('select count(*) from private.meet_spots', 'nobody reads the positions directly');

select set_config('request.jwt.claim.sub', :out, false) \g /dev/null
select public.expect((public.meet_venues(:s) -> 'venues') = '[]'::jsonb and (public.meet_venues(:s) ->> 'shared')::int = 0,
  'someone outside the sesh learns nothing');
select public.expect_error(format('select public.meet_share(%L, -20, 118)', :s), 'someone outside the sesh cannot share');
reset role;

select public.expect((select lat from private.meet_spots where sesh_id = :s and user_id = :org) = -20.0
  and (select lng from private.meet_spots where sesh_id = :s and user_id = :org) = 118.0, 'positions are rounded to about 500 m');

set role authenticated;
select set_config('request.jwt.claim.sub', :mate, false) \g /dev/null
select public.meet_stop(:s) \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.meet_spots where user_id = :mate), 'stop sharing deletes your position straight away');

set role authenticated;
select set_config('request.jwt.claim.sub', :mate, false) \g /dev/null
select public.meet_share(:s, -20.0, 118.2) \g /dev/null
select public.leave_sesh(:s) \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.meet_spots where user_id = :mate), 'leaving the sesh deletes your position');

set role authenticated;
select set_config('request.jwt.claim.sub', :org, false) \g /dev/null
select public.end_sesh(:s) \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.meet_spots where sesh_id = :s), 'ending the sesh deletes every position');
