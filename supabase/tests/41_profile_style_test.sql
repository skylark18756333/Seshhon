-- Checks the profile page settings (0041). Any failed check stops the script with an error.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

\set q1 '''00000000-0000-0000-0000-000000004101'''
\set q2 '''00000000-0000-0000-0000-000000004102'''
\set q3 '''00000000-0000-0000-0000-000000004103'''
insert into auth.users (id) values (:q1), (:q2), (:q3);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:q1, 'Rae', now(), 'STYLRAE1'), (:q2, 'Kit', now(), 'STYLKIT1'), (:q3, 'Stranger', now(), 'STYLSTR1');
insert into public.friendships (requester, addressee, state) values (:q1, :q2, 'accepted');
insert into private.xp (user_id, seshes) values (:q1, 1);

set role authenticated;
select set_config('request.jwt.claim.sub', :q1, false) \g /dev/null
select public.expect_error($$select * from private.profile_style$$, 'nobody reads the style table from the app');
select public.expect(public.profile_style(:q1) ->> 'theme' = 'neon' and public.profile_style(:q1) ->> 'frame' = 'glow', 'everyone starts on neon with a glow frame');
select public.expect(public.set_profile_style('sunset', 'rainbow', array['first_round', 'regular']) -> 'badges' = '["first_round"]'::jsonb, 'only badges Rae has earned show');
select public.expect(public.set_profile_style(p_frame => 'gold') ->> 'theme' = 'sunset', 'changing the frame keeps the theme');
select public.expect_error($$select public.set_profile_style('bogus')$$, 'an unknown theme is refused');
select public.expect_error($$select public.set_profile_style(p_badges => array['a','b','c','d'])$$, 'more than 3 badges is refused');
select public.set_cover('data:image/jpeg;base64,AAAA') \g /dev/null
select public.expect_error($$select public.set_cover('http://example.com/x.jpg')$$, 'a cover that is not a photo is refused');

select set_config('request.jwt.claim.sub', :q2, false) \g /dev/null
select public.expect(public.profile_style(:q1) ->> 'frame' = 'gold' and public.profile_style(:q1) ->> 'cover' is not null, 'Kit sees Rae''s frame and cover');
select set_config('request.jwt.claim.sub', :q3, false) \g /dev/null
select public.expect_error(format('select public.profile_style(%L)', :q1), 'a stranger cannot read Rae''s page settings');

select set_config('request.jwt.claim.sub', :q1, false) \g /dev/null
select public.set_cover(null) \g /dev/null
select public.expect(public.profile_style(:q1) ->> 'cover' is null, 'Rae removes her cover');

select public.expect((public.friend_profile(:q1) -> 'counts' ->> 'joined')::int = 1 and (public.friend_profile(:q1) -> 'counts' ->> 'friends')::int = 1, 'the page gets badge progress counts');

select 'ALL PROFILE STYLE CHECKS PASSED';
