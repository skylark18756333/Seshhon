-- Checks the access rules and functions. Any failed check stops the script with an error.
-- Run with: supabase/tests/run.sh
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

-- People: a (Ana) and b (Ben) become friends, c (Cal) is a stranger, s works at the venue.
\set a '''00000000-0000-0000-0000-00000000000a'''
\set b '''00000000-0000-0000-0000-00000000000b'''
\set c '''00000000-0000-0000-0000-00000000000c'''
\set s '''00000000-0000-0000-0000-00000000000d'''
\set venue '''10000000-0000-0000-0000-000000000001'''
\set venue2 '''10000000-0000-0000-0000-000000000002'''
\set allday '''20000000-0000-0000-0000-000000000001'''
\set paused '''20000000-0000-0000-0000-000000000002'''
\set evening '''20000000-0000-0000-0000-000000000003'''

-- expect_error passes only when the statement is refused; expect passes only when the value is true.
create function public.expect_error(stmt text, label text) returns text language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return 'PASS  ' || label || '  [refused: ' || sqlerrm || ']';
  end;
  raise exception 'FAIL  %: the statement should have been refused', label;
end;
$$;
create function public.expect(ok boolean, label text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL  %', label; end if;
  return 'PASS  ' || label;
end;
$$;
grant execute on function public.expect_error(text, text), public.expect(boolean, text) to authenticated, anon, service_role;   -- anon too: 0006 stops new functions being callable by everyone

insert into auth.users (id) values (:a), (:b), (:c), (:s);
insert into public.venues (id, name) values (:venue, 'Test Bar'), (:venue2, 'Other Bar');

-- ---- sign-up
set role authenticated;
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.api_sign_up('Ana', date '1990-01-01') \g /dev/null
select public.expect_error($$insert into public.profiles (id, name, adult_confirmed_at) values ('00000000-0000-0000-0000-00000000000b', 'Fake', now())$$, 'cannot create a profile for someone else');
select public.expect_error($$insert into public.profiles (id, name) values ('00000000-0000-0000-0000-00000000000a', 'NoAge')$$, 'cannot sign up without confirming 18+');
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.api_sign_up('Ben', date '1990-01-01') \g /dev/null
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.api_sign_up('Cal', date '1990-01-01') \g /dev/null
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
select public.api_sign_up('Staff', date '1990-01-01') \g /dev/null
reset role;
insert into public.venue_staff (venue_id, user_id) values (:venue, :s);

-- ---- friends
set role authenticated;
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect((select count(*) from public.profiles) = 1, 'before friending, you see only your own profile');
insert into public.friendships (requester, addressee) values (:a, :b);
update public.friendships set state = 'accepted' where requester = :a;
select public.expect((select state from public.friendships) = 'requested', 'the person who asked cannot accept their own request');
select public.expect_error($$insert into public.friendships (requester, addressee, state) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'accepted')$$, 'cannot create a friendship that is already accepted');

select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect((select count(*) from public.friendships) = 0, 'a stranger cannot see other people''s friendships');

select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
update public.friendships set state = 'accepted' where addressee = :b;
select public.expect(public.are_friends(:a, :b), 'the person asked can accept');
select public.expect_error($$update public.friendships set requester = '00000000-0000-0000-0000-00000000000c'$$, 'cannot rewrite who a friendship is between');
select public.expect((select count(*) from public.profiles) = 2, 'friends can see each other''s profile');

-- ---- status
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select colour from public.set_status('on') \g /dev/null
select public.expect((select expires_at - now() between interval '3 hours 59 minutes' and interval '4 hours' from public.statuses where user_id = :a), 'On lasts 4 hours');
select public.expect_error($$update public.statuses set expires_at = now() + interval '1 year'$$, 'cannot edit a status directly');
select public.expect_error($$insert into public.statuses (user_id, colour) values ('00000000-0000-0000-0000-00000000000b', 'on')$$, 'cannot set someone else''s status');

select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :a) = 0, 'a friend who is Off cannot see that you are On');
select colour from public.set_status('thinking') \g /dev/null
select public.expect((select colour from public.statuses where user_id = :a) = 'on', 'a friend who is Thinking or On sees that you are On');
select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect((select count(*) from public.statuses) = 0, 'a stranger cannot see your status');

select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select colour from public.set_status('thinking') \g /dev/null
select public.expect((select expires_at - now() between interval '1 hour 59 minutes' and interval '2 hours' from public.statuses where user_id = :a), 'Thinking lasts 2 hours');
select colour from public.set_status('off') \g /dev/null
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :a) = 0, 'a friend cannot see you when you are Off');

select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select colour from public.set_status('on') \g /dev/null
reset role;
update public.statuses set expires_at = now() - interval '1 minute' where user_id = :a;
set role authenticated;
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect((select count(*) from public.statuses where user_id = :a) = 0, 'a status that has run out is hidden from friends straight away');
reset role;
select public.expect(public.expire_statuses() = 1, 'the scheduled job turns one expired status Off');
select public.expect((select colour from public.statuses where user_id = :a) = 'off', 'the expired status is now stored as Off');

-- ---- deal rules
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time, is_alcohol, discount_pct) values ('10000000-0000-0000-0000-000000000001', 'Drinks', '60% off drinks', '17:00', '18:00', true, 60)$$, 'alcohol cannot be more than 50% off');
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time, is_alcohol, discount_pct) values ('10000000-0000-0000-0000-000000000001', 'Drinks', 'Two hour happy hour', '16:00', '18:00', true, 20)$$, 'an alcohol deal cannot run longer than 60 minutes');
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time, is_alcohol, discount_pct) values ('10000000-0000-0000-0000-000000000001', 'Drinks', 'Late happy hour', '19:00', '20:00', true, 20)$$, 'an alcohol deal cannot run after 7pm');
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time) values ('10000000-0000-0000-0000-000000000001', 'Food', 'Backwards deal', '21:00', '20:00')$$, 'a deal must end after it starts');
insert into public.deals (venue_id, type, title, start_time, end_time, is_alcohol, discount_pct) values
  (:venue, 'Drinks', 'Happy hour one', '17:00', '18:00', true, 25),
  (:venue, 'Drinks', 'Happy hour two', '18:00', '19:00', true, 50);
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time, is_alcohol, discount_pct) values ('10000000-0000-0000-0000-000000000001', 'Drinks', 'Happy hour three', '12:00', '13:00', true, 10)$$, 'a venue cannot run a third alcohol deal');
insert into public.deals (id, venue_id, type, title, start_time, end_time, active) values
  (:allday, :venue, 'Food', 'All day food deal', '00:00', '23:59:59', true),
  (:paused, :venue, 'Food', 'Paused food deal', '00:00', '23:59:59', false),
  (:evening, :venue, 'Food', '2-for-1 pizzas', '17:00', '21:00', true);
select public.expect(public.deal_is_running(d, '2026-10-02 18:00+08'), 'a 5pm to 9pm deal is running at 6pm Perth time') from public.deals d where id = :evening;
select public.expect(not public.deal_is_running(d, '2026-10-02 21:00+08'), 'and is not running at 9pm') from public.deals d where id = :evening;
select public.expect(public.night_of('2026-10-03 01:30+08') = date '2026-10-02', '1:30am still counts as the night before');

set role authenticated;
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time) values ('10000000-0000-0000-0000-000000000001', 'Food', 'Customer made deal', '17:00', '21:00')$$, 'a customer cannot create deals');
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
insert into public.deals (venue_id, type, title, start_time, end_time) values (:venue, 'Entry', 'Staff made deal', '20:00', '23:00');
select public.expect_error($$insert into public.deals (venue_id, type, title, start_time, end_time) values ('10000000-0000-0000-0000-000000000002', 'Entry', 'Wrong venue deal', '20:00', '23:00')$$, 'staff cannot create deals for another venue');

-- ---- deal codes
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect((select code from public.request_deal_code(:allday)) ~ '^SESH-[0-9]{4}$', 'a running deal gives a code');
select public.expect((select code from public.request_deal_code(:allday)) = (select code from public.redemptions where user_id = :a), 'asking again returns the same live code');
select public.expect_error($$select public.request_deal_code('20000000-0000-0000-0000-000000000002')$$, 'no code for a deal that is not running');
select public.expect_error($$update public.redemptions set confirmed_at = now()$$, 'a customer cannot confirm their own code');
select public.expect_error($$select public.confirm_deal_code((select code from public.redemptions limit 1))$$, 'a customer cannot call the staff confirm function for a venue they do not work at');

select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect((select count(*) from public.redemptions) = 0, 'you cannot see another person''s codes');

reset role;
select code as a_code from public.redemptions where user_id = :a \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
select public.expect((select confirmed_at is not null from public.confirm_deal_code(:'a_code')), 'venue staff can confirm the code');
select public.expect_error('select public.confirm_deal_code(' || quote_literal(:'a_code') || ')', 'a code cannot be confirmed twice');
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect_error($$select public.request_deal_code('20000000-0000-0000-0000-000000000001')$$, 'a used deal cannot be used again the same night');

-- an expired code cannot be confirmed
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select code from public.request_deal_code(:allday) \g /dev/null
reset role;
update public.redemptions set expires_at = now() - interval '1 minute' where user_id = :b;
select code as b_code from public.redemptions where user_id = :b \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :s, false) \g /dev/null
select public.expect_error('select public.confirm_deal_code(' || quote_literal(:'b_code') || ')', 'a code that has run out cannot be confirmed');
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select code from public.request_deal_code(:allday) \g /dev/null
select public.expect((select expires_at > now() from public.redemptions where user_id = :b), 'a run-out code is replaced with a fresh one');

-- ---- sesh
select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect_error($$select public.start_sesh()$$, 'cannot start a sesh while Off');
select colour from public.set_status('on') \g /dev/null
select id as sesh from public.start_sesh() \gset
select public.expect((select count(*) from public.sesh_members where sesh_id = :'sesh') = 1, 'the person who starts a sesh is in it');
insert into public.venue_votes (sesh_id, user_id, venue_id) values (:'sesh', :a, :venue);

select set_config('request.jwt.claim.sub', :c, false) \g /dev/null
select public.expect((select count(*) from public.seshes) = 0, 'a stranger cannot see the sesh');
select public.expect_error('insert into public.sesh_members (sesh_id, user_id) values (' || quote_literal(:'sesh') || ', ''00000000-0000-0000-0000-00000000000c'')', 'a stranger cannot join the sesh');
select public.expect_error('insert into public.venue_votes (sesh_id, user_id, venue_id) values (' || quote_literal(:'sesh') || ', ''00000000-0000-0000-0000-00000000000c'', ''10000000-0000-0000-0000-000000000002'')', 'a stranger cannot vote');

select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
select public.expect((select count(*) from public.seshes) = 1, 'a friend can see the sesh');
select public.expect((select count(*) from public.venue_votes) = 0, 'votes are hidden until you join');
insert into public.sesh_members (sesh_id, user_id) values (:'sesh', :b);
insert into public.venue_votes (sesh_id, user_id, venue_id) values (:'sesh', :b, :venue2);
select public.expect((select count(*) from public.venue_votes) = 2, 'members see every vote');
select public.expect_error('insert into public.venue_votes (sesh_id, user_id, venue_id) values (' || quote_literal(:'sesh') || ', ''00000000-0000-0000-0000-00000000000a'', ''10000000-0000-0000-0000-000000000002'')', 'cannot vote as someone else');
select public.expect_error('select public.lock_sesh(' || quote_literal(:'sesh') || ')', 'only the person who started the sesh can lock it in');

select set_config('request.jwt.claim.sub', :a, false) \g /dev/null
select public.expect((select locked_venue from public.lock_sesh(:'sesh')) = :venue, 'on a tie the venue voted for first is locked in');

-- ---- ratings
insert into public.ratings (venue_id, user_id, stars, tags) values (:venue, :a, 4, '{Good vibe}');
select public.expect_error($$insert into public.ratings (venue_id, user_id, stars) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 1)$$, 'cannot rate as someone else');
select public.expect_error($$insert into public.ratings (venue_id, user_id, stars) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 6)$$, 'stars must be 1 to 5');
select set_config('request.jwt.claim.sub', :b, false) \g /dev/null
insert into public.ratings (venue_id, user_id, stars) values (:venue, :b, 2);
select public.expect((select average = 3.0 and ratings = 2 from public.venue_ratings where venue_id = :venue), 'the venue average counts each person once');

-- ---- signed-out visitors get nothing
reset role;
grant execute on function public.expect(boolean, text) to anon;
set role anon;
select public.expect(not has_table_privilege('anon', 'public.profiles', 'select') and not has_table_privilege('anon', 'public.statuses', 'select') and not has_table_privilege('anon', 'public.deals', 'select'), 'signed-out visitors cannot read any table');
reset role;
select 'ALL DATABASE CHECKS PASSED';
