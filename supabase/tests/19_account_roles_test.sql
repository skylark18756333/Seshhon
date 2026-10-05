-- Checks for account types: user, venue and admin (migration 0019). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set ad '''00000000-0000-0000-0000-0000000017a1'''
\set vo '''00000000-0000-0000-0000-0000000017a2'''
\set us '''00000000-0000-0000-0000-0000000017a3'''
\set fr '''00000000-0000-0000-0000-0000000017a4'''
\set ven '''10000000-0000-0000-0000-0000000017f1'''
insert into auth.users (id) values (:ad), (:vo), (:us), (:fr);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:ad, 'Ada', now(), 'ADAADAAD'), (:vo, 'Vic', now(), 'VICVICVI'), (:us, 'Uma', now(), 'UMAUMAUM'), (:fr, 'Fred', now(), 'FREDFRED');
insert into public.venues (id, name, kind) values (:ven, 'Roles Bar', 'Bar');
insert into public.friendships (requester, addressee, state) values (:vo, :fr, 'accepted');
-- Frenzy staff make Ada an admin by hand, the only way to get the role.
insert into private.roles (user_id, role) values (:ad, 'admin');

set role authenticated;
select set_config('request.jwt.claim.sub', :us, false) \g /dev/null
select public.expect(public.my_role() ->> 'role' = 'user', 'a new account is a normal user');
select public.expect_error($$select * from private.roles$$, 'nobody reads the roles table from the app');
select public.expect_error($$insert into private.roles (user_id, role) values ('00000000-0000-0000-0000-0000000017a3', 'admin')$$, 'nobody can make themselves an admin');
select public.expect_error($$select public.admin_overview()$$, 'a normal user cannot open the admin page');
select public.expect_error($$select public.admin_decide_claim('00000000-0000-0000-0000-000000000000', true, null)$$, 'a normal user cannot approve venue requests');
select public.expect_error($$select public.venue_save_deal(null, '10000000-0000-0000-0000-0000000017f1', 'Food', 'Cheap chips', '17:00', '18:00', false, null, true)$$, 'a normal user cannot add deals to a venue');
select public.expect_error($$select public.claim_venue('10000000-0000-0000-0000-0000000017f1', 'Uma', '12', null, null)$$, 'a venue request needs a real phone number');

-- Vic asks to run Roles Bar, and Ada approves.
select set_config('request.jwt.claim.sub', :vo, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect(public.claim_venue(:ven, 'Vic Owner', '0400 000 000', null, 'I own it') -> 'claim' ->> 'status' = 'pending', 'anyone can ask to run a venue');
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.expect(public.my_role() ->> 'role' = 'admin', 'Ada is an admin');
select public.expect(jsonb_array_length(public.admin_overview() -> 'claims') = 1, 'the admin sees the venue request');
select public.admin_decide_claim((select (public.admin_overview() -> 'claims' -> 0 ->> 'id')::uuid), true, null) \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.venue_claims), 'contact details are deleted once a request is decided');
select public.expect(not exists (select 1 from public.friendships where requester = :vo or addressee = :vo), 'a venue account has no friends');
set role authenticated;

select set_config('request.jwt.claim.sub', :vo, false) \g /dev/null
select public.expect(public.my_role() ->> 'role' = 'venue', 'Vic is now a venue account');
select public.expect(public.my_role() -> 'venues' -> 0 ->> 'name' = 'Roles Bar', 'Vic runs Roles Bar');
select public.expect((select colour::text from public.statuses where user_id = :vo) = 'off', 'approval turns the status off');
select public.expect_error($$select public.set_status('on')$$, 'a venue account cannot go green');
select public.expect_error($$select public.start_sesh()$$, 'a venue account cannot start a sesh');
select public.expect_error($$select public.request_friend('UMAUMAUM')$$, 'a venue account cannot add friends');
select public.expect_error($$select public.admin_overview()$$, 'a venue account cannot open the admin page');
select public.expect_error($$insert into public.ratings (venue_id, user_id, stars) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-0000000017a2', 5)$$, 'a venue account cannot rate venues');
select public.venue_save_deal(null, :ven, 'Events', 'Quiz night', '19:00', '22:00', true, null, true) \g /dev/null
select public.expect((select not is_alcohol from public.deals where title = 'Quiz night'), 'a venue can add an event, and events are never drink deals');
select public.venue_save_deal(null, :ven, 'Food', '2-for-1 pizzas', '17:00', '21:00', false, null, true) \g /dev/null
select public.expect(exists (select 1 from public.deals where title = '2-for-1 pizzas' and venue_id = :ven), 'a 2-for-1 food deal is fine');
select public.expect_error($$select public.venue_save_deal(null, '10000000-0000-0000-0000-0000000017f1', 'Drinks', '2-for-1 cocktails', '17:00', '18:00', true, null, true)$$, '2-for-1 cocktails are refused');
select public.expect_error($$select public.venue_save_deal(null, '10000000-0000-0000-0000-0000000017f1', 'Food', 'Free beer with any burger', '17:00', '18:00', false, null, true)$$, 'free drinks are refused even on a food deal');
select public.expect_error($$select public.venue_save_deal(null, '10000000-0000-0000-0000-0000000017f1', 'Events', 'Bottomless brunch', '11:00', '14:00', false, null, true)$$, 'bottomless is refused');
select public.expect_error($$select public.venue_save_deal(null, '10000000-0000-0000-0000-0000000017f1', 'Drinks', '$5 schooners', '17:00', '18:00', true, null, true)$$, 'cheap drink pricing is refused');
select public.expect_error($$select public.venue_save_deal(null, '10000000-0000-0000-0000-0000000017f1', 'Drinks', 'Half off wine', '20:00', '21:00', true, 50, true)$$, 'drink deals still finish by 7pm');
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time) values ('10000000-0000-0000-0000-0000000017f1', 'Drinks', 'Free shots at 6', '17:00', '18:00')$$, 'the rules also apply to straight table writes');
select public.expect_error($$select public.venue_save_deal(null, 'a0000000-0000-4000-8000-000000000001', 'Food', 'Chips', '17:00', '18:00', false, null, true)$$, 'a venue cannot add deals to someone else''s venue');
select public.expect(jsonb_array_length(public.venue_overview() -> 0 -> 'deals') = 2, 'the venue page lists the venue''s deals and events');
select public.venue_delete_deal((select id from public.deals where title = 'Quiz night')) \g /dev/null
select public.expect(not exists (select 1 from public.deals where title = 'Quiz night'), 'a venue can delete its own event');

-- Uma asks and is turned down: she sees the note, and her details are gone.
select set_config('request.jwt.claim.sub', :us, false) \g /dev/null
select public.claim_venue(:ven, 'Uma', '0400111222', '12345678901', null) \g /dev/null
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.admin_decide_claim((select (public.admin_overview() -> 'claims' -> 0 ->> 'id')::uuid), false, 'We could not reach you on that number.') \g /dev/null
select set_config('request.jwt.claim.sub', :us, false) \g /dev/null
select public.expect(public.my_role() -> 'claim' ->> 'note' = 'We could not reach you on that number.', 'a turned-down request shows the note');
select public.expect(public.my_role() ->> 'role' = 'user', 'a turned-down account stays a normal user');
reset role;
select public.expect((select phone is null and abn is null from private.venue_claims where user_id = :us), 'a turned-down request keeps no contact details');

-- The admin takes the venue back: Vic is a normal account again.
set role authenticated;
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.admin_pause_deal((select id from public.deals where title = '2-for-1 pizzas' and venue_id = :ven)) \g /dev/null
select public.expect((select not active from public.deals where title = '2-for-1 pizzas' and venue_id = :ven), 'an admin can pause any deal');
select public.admin_remove_venue_account(:vo, :ven) \g /dev/null
select set_config('request.jwt.claim.sub', :vo, false) \g /dev/null
select public.expect(public.my_role() ->> 'role' = 'user', 'with no venue left the account is a normal user again');
reset role;
set role anon;
select public.expect_error($$select public.my_role()$$, 'signed-out visitors cannot ask about roles');
reset role;
select 'ALL ACCOUNT ROLE CHECKS PASSED';
