-- Checks the Sesh Map crawl stops (migration 0027). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set org '''00000000-0000-0000-0000-0000000026a1'''
\set mate '''00000000-0000-0000-0000-0000000026a2'''
\set out '''00000000-0000-0000-0000-0000000026a3'''
\set s '''20000000-0000-0000-0000-0000000026c1'''
\set old '''20000000-0000-0000-0000-0000000026c2'''
\set v1 '''10000000-0000-0000-0000-0000000026f1'''
\set v2 '''10000000-0000-0000-0000-0000000026f2'''
\set v3 '''10000000-0000-0000-0000-0000000026f3'''
insert into auth.users (id) values (:org), (:mate), (:out);
insert into public.profiles (id, name, adult_confirmed_at) values (:org, 'Org', now()), (:mate, 'Mate', now()), (:out, 'Out', now());
insert into public.venues (id, name) values (:v1, 'First Bar'), (:v2, 'Second Bar'), (:v3, 'Third Bar');
insert into public.seshes (id, creator) values (:s, :org);
insert into public.seshes (id, creator, created_at) values (:old, :org, now() - interval '9 hours');
insert into public.sesh_members (sesh_id, user_id) values (:s, :org), (:s, :mate), (:old, :org);

set role authenticated;
select set_config('request.jwt.claim.sub', :org, false) \g /dev/null
select public.crawl_add(:s, :v1) \g /dev/null
select public.crawl_add(:s, :v2) \g /dev/null
select set_config('request.jwt.claim.sub', :mate, false) \g /dev/null
select public.crawl_add(:s, :v3) \g /dev/null
select public.expect((select string_agg(x ->> 'venue_id', ',' order by (x ->> 'position')::int) from jsonb_array_elements(public.sesh_crawl(:s)) x)
  = concat_ws(',', :v1, :v2, :v3), 'anyone in the sesh can add stops, and they keep the order they were added');
select public.expect_error(format('select public.crawl_add(%L, %L)', :s, :v1), 'a venue cannot be on the map twice');
select public.expect_error(format('select public.crawl_move(%L, %L, 1)', :s, :v1), 'only the organiser changes the order');
select public.expect_error(format('select public.crawl_remove(%L, %L)', :s, :v1), 'a mate cannot remove someone else''s stop');
select public.expect_error(format('select public.crawl_done(%L, %L, true)', :s, :v1), 'only the organiser ticks off stops');
select public.expect(not exists (select 1 from jsonb_array_elements(public.sesh_crawl(:s)) x, jsonb_object_keys(x) k where k not in ('venue_id', 'position', 'done', 'mine')),
  'stops never say who added them, only whether it was you');

select set_config('request.jwt.claim.sub', :org, false) \g /dev/null
select public.crawl_move(:s, :v3, -1) \g /dev/null
select public.expect((select string_agg(x ->> 'venue_id', ',' order by (x ->> 'position')::int) from jsonb_array_elements(public.sesh_crawl(:s)) x)
  = concat_ws(',', :v1, :v3, :v2), 'the organiser moves a stop earlier');
select public.crawl_move(:s, :v1, -1) \g /dev/null
select public.expect((select x ->> 'venue_id' from jsonb_array_elements(public.sesh_crawl(:s)) x where (x ->> 'position')::int = 1) = :v1, 'the first stop cannot move earlier');
select public.crawl_done(:s, :v1, true) \g /dev/null
select public.expect(((select x from jsonb_array_elements(public.sesh_crawl(:s)) x where x ->> 'venue_id' = :v1) ->> 'done')::boolean, 'the organiser ticks off a stop');
select public.crawl_remove(:s, :v1) \g /dev/null
select public.expect((select string_agg(x ->> 'position', ',' order by (x ->> 'position')::int) from jsonb_array_elements(public.sesh_crawl(:s)) x) = '1,2',
  'removing a stop numbers the rest 1, 2 again');

select set_config('request.jwt.claim.sub', :mate, false) \g /dev/null
select public.crawl_remove(:s, :v3) \g /dev/null
select public.expect(jsonb_array_length(public.sesh_crawl(:s)) = 1, 'a mate can remove a stop they added');

select set_config('request.jwt.claim.sub', :out, false) \g /dev/null
select public.expect(public.sesh_crawl(:s) = '[]'::jsonb, 'someone outside the sesh sees no stops');
select public.expect_error(format('select public.crawl_add(%L, %L)', :s, :v1), 'someone outside the sesh cannot add stops');
select public.expect_error('select count(*) from public.crawl_stops', 'nobody reads the table directly');

select set_config('request.jwt.claim.sub', :org, false) \g /dev/null
select public.expect_error(format('select public.crawl_add(%L, %L)', :old, :v1), 'a sesh older than 8 hours takes no new stops');
reset role;
set role anon;
select public.expect_error(format('select public.sesh_crawl(%L)', :s), 'signed-out visitors cannot see stops');
reset role;

-- A sesh planned for tomorrow can have its crawl planned ahead, and it never makes a venue glow busy.
reset role;
insert into public.seshes (id, creator, created_at) values ('20000000-0000-0000-0000-0000000026c9', :org, now() + interval '1 day');
insert into public.sesh_members (sesh_id, user_id) values ('20000000-0000-0000-0000-0000000026c9', :org), ('20000000-0000-0000-0000-0000000026c9', :mate);
set role authenticated;
select set_config('request.jwt.claim.sub', :mate, false) \g /dev/null
select public.crawl_add('20000000-0000-0000-0000-0000000026c9', :v2) \g /dev/null
select public.expect(jsonb_array_length(public.sesh_crawl('20000000-0000-0000-0000-0000000026c9')) = 1, 'a planned sesh can have its stops planned ahead');
select public.expect(not exists (select 1 from jsonb_array_elements(public.api_buzz()) b where b ->> 'id' = :v2), 'crawl stops never make a venue glow busy');
reset role;

-- Ending the sesh deletes its stops with it.
set role authenticated;
select set_config('request.jwt.claim.sub', :org, false) \g /dev/null
select public.end_sesh(:s) \g /dev/null
reset role;
select public.expect(not exists (select 1 from public.crawl_stops where sesh_id = :s), 'ending the sesh deletes its Sesh Map');
select 'ALL SESH MAP CHECKS PASSED';
