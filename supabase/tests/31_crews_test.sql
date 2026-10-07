-- Checks crews, besties and free time (migration 0031). Runs after 01 to 30 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set cat '''00000000-0000-0000-0000-000000003101'''
\set dan '''00000000-0000-0000-0000-000000003102'''
\set eve '''00000000-0000-0000-0000-000000003103'''
\set fay '''00000000-0000-0000-0000-000000003104'''
\set gus '''00000000-0000-0000-0000-000000003105'''
insert into auth.users (id) values (:cat), (:dan), (:eve), (:fay), (:gus);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values
  (:cat, 'Cat', now(), 'CREWCAT1'), (:dan, 'Dan', now(), 'CREWDAN1'), (:eve, 'Eve', now(), 'CREWEVE1'),
  (:fay, 'Fay', now(), 'CREWFAY1'), (:gus, 'Gus', now(), 'CREWGUS1');
-- Cat is friends with Dan, Eve and Gus (not Fay). Dan and Eve are friends too.
insert into public.friendships (requester, addressee, state) values
  (:cat, :dan, 'accepted'), (:cat, :eve, 'accepted'), (:cat, :gus, 'accepted'), (:dan, :eve, 'accepted');
-- Three days from now, its day of the week, and a Friday-ish day for the pattern.
select private.free_today() as t0, private.free_today() + 3 as d3, extract(dow from private.free_today() + 3)::int as dow3,
       private.free_today() + 4 as d4 \gset

set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null

-- ---------------------------------------------------------------- no direct access
select public.expect_error($$select * from private.crews$$, 'nobody reads the crews table from the app');
select public.expect_error($$select * from private.free_slots$$, 'nobody reads free slots from the app');
select public.expect_error($$select * from private.share_settings$$, 'nobody reads sharing settings from the app');
select public.expect_error($$select * from private.besties$$, 'nobody reads the besties table from the app');
select public.expect_error($$select public.purge_free_time()$$, 'the clean-up is not something the app can call');
select public.expect_error($$select private.is_free(null, null, null)$$, 'the free-time helpers are private');
select public.expect(public.crews_state() -> 'crews' = '[]'::jsonb and public.crews_state() -> 'besties' = '[]'::jsonb, 'a new person has no crews and no besties');
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'and no suggestions');

-- ---------------------------------------------------------------- crews
select public.expect_error($$select public.make_crew('')$$, 'a crew needs a name');
select public.expect_error(format('select public.make_crew(%L)', repeat('x', 31)), 'a crew name is up to 30 characters');
select (public.make_crew('The Girls') ->> 'id') as crew \gset
select public.expect(public.crews_state() -> 'crews' -> 0 ->> 'name' = 'The Girls' and (public.crews_state() -> 'crews' -> 0 ->> 'mine')::boolean, 'Cat made The Girls');
select public.expect(public.crews_state() -> 'crews' -> 0 -> 'settings' ->> 'share' = 'off' and public.crews_state() -> 'crews' -> 0 -> 'settings' ->> 'suggest' = 'off',
  'sharing and suggestions start off');
select public.expect_error(format('select public.invite_to_crew(%L, array[%L]::uuid[])', :'crew', :fay), 'Cat cannot invite someone who is not her friend');
select public.expect((public.invite_to_crew(:'crew', array[:dan, :eve, :gus, :fay]::uuid[]) ->> 'invited')::int = 3, 'Cat invites her three friends and Fay is skipped');
select public.expect_error(format('select public.invite_to_crew(%L, array[%L]::uuid[])', :'crew', :dan), 'inviting the same friend again does nothing');

select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.expect(public.crews_state() -> 'crews' -> 0 ->> 'state' = 'invited' and public.crews_state() -> 'crews' -> 0 -> 'members' = '[]'::jsonb,
  'Dan sees the invite but not who is in the crew yet');
select public.expect_error(format('select public.set_share_settings(''crew'', %L, ''exact'', ''{}'', ''off'', 3, ''{}'')', :'crew'), 'Dan cannot share with a crew he has not joined');
select public.expect_error(format('select public.invite_to_crew(%L, array[%L]::uuid[])', :'crew', :eve), 'only the person who made the crew can invite');
select public.answer_crew_invite(:'crew', true) \g /dev/null
select public.expect(jsonb_array_length(public.crews_state() -> 'crews' -> 0 -> 'members') = 4, 'Dan joins and sees the four people in it (two still invited)');
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.answer_crew_invite(:'crew', true) \g /dev/null
select set_config('request.jwt.claim.sub', :gus, false) \g /dev/null
select public.answer_crew_invite(:'crew', false) \g /dev/null
select public.expect(public.crews_state() -> 'crews' = '[]'::jsonb, 'Gus turned the invite down and is not in the crew');
select public.expect_error(format('select public.answer_crew_invite(%L, true)', :'crew'), 'and the invite is gone');

-- The size limits: 15 people in a crew, 10 crews a person.
reset role;
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000032' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 12) g;
insert into public.profiles (id, name, adult_confirmed_at) select ('00000000-0000-0000-0000-0000000032' || lpad(g::text, 2, '0'))::uuid, 'Extra' || g, now() from generate_series(1, 12) g;
insert into public.friendships (requester, addressee, state) select :cat, ('00000000-0000-0000-0000-0000000032' || lpad(g::text, 2, '0'))::uuid, 'accepted' from generate_series(1, 12) g;
set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect((public.invite_to_crew(:'crew', array(select ('00000000-0000-0000-0000-0000000032' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 12) g)) ->> 'invited')::int = 12,
  'Cat fills the crew to 15 with twelve more invites');
select public.expect_error(format('select public.invite_to_crew(%L, array[%L]::uuid[])', :'crew', :gus), 'the 16th person is refused: up to 15 in a crew');
reset role;
delete from private.crew_members where crew_id = :'crew' and user_id::text like '00000000-0000-0000-0000-0000000032%';
set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.make_crew('Crew ' || g) from generate_series(2, 10) g \g /dev/null
select public.expect_error($$select public.make_crew('One too many')$$, 'Cat cannot be in an 11th crew');
select public.expect(jsonb_array_length(public.crews_state() -> 'crews') = 10, 'Cat is in ten crews');
select (x ->> 'id') as spare from jsonb_array_elements(public.crews_state() -> 'crews') x where x ->> 'name' = 'Crew 10' \gset
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.expect_error(format('select public.delete_crew(%L)', :'spare'), 'only the person who made a crew can delete it');
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.delete_crew(:'spare') \g /dev/null
select public.expect(jsonb_array_length(public.crews_state() -> 'crews') = 9, 'Cat deletes a spare crew and is in nine');
select public.rename_crew(:'crew', 'The Girls Crew') \g /dev/null
select public.expect(exists (select 1 from jsonb_array_elements(public.crews_state() -> 'crews') x where x ->> 'name' = 'The Girls Crew'), 'Cat renames the crew');
select public.rename_crew(:'crew', 'The Girls') \g /dev/null
reset role;
delete from private.crews where name like 'Crew %';   -- the spare crews are not needed any more
set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null

-- ---------------------------------------------------------------- free time, by hand
select public.expect_error(format('select public.set_free(%L, ''lunch'', true)', :'d3'), 'only Morning, Arvo and Night');
select public.expect_error(format('select public.set_free(%L, ''night'', true)', (:'t0'::date - 1)::text), 'a day that has passed cannot be ticked');
select public.expect_error(format('select public.set_free(%L, ''night'', true)', (:'t0'::date + 14)::text), 'neither can a day more than 2 weeks away');
select public.expect(jsonb_array_length(public.my_free_time() -> 'days') = 14 and public.my_free_time() -> 'days' -> 0 ->> 'day' = :'t0', 'the grid is today and the next 13 days');
select public.expect(public.set_free(:'d3', 'night', true) -> 'days' -> 3 -> 'free' = '["night"]'::jsonb, 'Cat ticks Night on day 3');
select public.set_free(:'d3', 'arvo', true) \g /dev/null
select public.expect(public.set_free(:'d3', 'arvo', false) -> 'days' -> 3 -> 'free' = '["night"]'::jsonb, 'and un-ticks Arvo again');

-- Sharing is off until switched on: nothing is suggested and nobody sees anything.
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'nothing is suggested while everything is off');
select public.expect_error(format('select public.set_share_settings(''crew'', %L, ''everyone'', ''{}'', ''off'', 3, ''{}'')', :'crew'), 'there is no everyone option');
select public.expect_error(format('select public.set_share_settings(''friends'', %L, ''exact'', ''{}'', ''off'', 3, ''{}'')', :'crew'), 'sharing is only with a crew or a bestie');
select public.expect_error(format('select public.set_share_settings(''crew'', %L, ''exact'', ''{golf}'', ''off'', 3, ''{}'')', :'crew'), 'hangouts come from the list');
select public.expect_error(format('select public.set_share_settings(''crew'', %L, ''exact'', ''{}'', ''off'', 1, ''{}'')', :'crew'), 'at least 2 people');
select public.expect_error(format('select public.set_share_settings(''crew'', %L, ''exact'', ''{}'', ''off'', 3, ''{7}'')', :'crew'), 'quiet days are 0 to 6');
select public.expect(public.set_share_settings('crew', :'crew', 'exact', '{coffee,night_out}', 'enough', 3, array[]::int[]) ->> 'share' = 'exact', 'Cat shares exact times with the crew and wants suggestions');
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'enough', 3, '{}') \g /dev/null
select public.set_free(:'d3', 'night', true) \g /dev/null
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'off', 3, '{}') \g /dev/null
select public.set_free(:'d3', 'night', true) \g /dev/null
select public.set_free(:'d3', 'morning', true) \g /dev/null

select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect(jsonb_array_length(public.catch_up_suggestions()) = 1, 'Cat gets one suggestion');
select public.expect(public.catch_up_suggestions() -> 0 ->> 'day' = :'d3' and public.catch_up_suggestions() -> 0 ->> 'part' = 'night'
  and (public.catch_up_suggestions() -> 0 ->> 'free')::int = 3 and (public.catch_up_suggestions() -> 0 ->> 'of')::int = 3
  and public.catch_up_suggestions() -> 0 ->> 'label' = 'The Girls', 'it is Night on day 3 for The Girls, 3 of 3 free');
select public.expect(public.catch_up_suggestions() -> 0 -> 'names' = '["Dan","Eve"]'::jsonb, 'with the names of the others who share exact times');
select public.expect(public.catch_up_suggestions() -> 0 -> 'hangouts' = '["coffee","night_out"]'::jsonb, 'and the hangouts Cat picked');
select public.expect(public.catch_up_suggestions() -> 0 ->> 'kind' = 'crew', 'it is a crew suggestion');

-- Eve, who never switched suggestions on, is not sent any; and one who shares nothing sees nothing.
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'Eve turned suggestions off, so she gets none');

-- Minimum people, quiet days, "Not now".
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{coffee,night_out}', 'enough', 4, '{}') \g /dev/null
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'with "at least 4 of us" there is nothing to suggest for 3');
select public.set_share_settings('crew', :'crew', 'exact', '{coffee,night_out}', 'enough', 3, array[:dow3]) \g /dev/null
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'a quiet day is never suggested');
select public.set_share_settings('crew', :'crew', 'exact', '{coffee,night_out}', 'weekly', 3, '{}') \g /dev/null
select public.expect(jsonb_array_length(public.catch_up_suggestions()) = 1, 'once a week gives the best slot');

-- Eve only shares "free this week": she is no longer counted for slots, but Cat can see she is free this week.
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.set_share_settings('crew', :'crew', 'week', '{}', 'off', 3, '{}') \g /dev/null
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'Eve sharing only "free this week" leaves 2 free, under the 3 needed');
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'enough', 2, '{}') \g /dev/null
select public.expect((public.catch_up_suggestions() -> 0 ->> 'free')::int = 2 and public.catch_up_suggestions() -> 0 -> 'names' = '["Dan"]'::jsonb, 'with 2 needed it is Cat and Dan, and Eve is not named');
select public.expect(exists (
  select 1 from jsonb_array_elements(public.crews_state() -> 'crews' -> 0 -> 'members') m
  where m ->> 'name' = 'Eve' and (m ->> 'week')::boolean), 'Cat sees that Eve is free this week, without when');

-- Dismissing: "Not now".
select public.dismiss_catch_up(:'crew', :'d3', 'night') \g /dev/null
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, '"Not now" hides that suggestion');
reset role;
delete from private.catch_up_dismissed;
set role authenticated;
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'off', 3, '{}') \g /dev/null

-- ---------------------------------------------------------------- privacy: hidden status and blocks
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.set_status_hidden(:cat, true) \g /dev/null
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect((public.catch_up_suggestions() -> 0 ->> 'free')::int = 2 and public.catch_up_suggestions() -> 0 -> 'names' = '["Eve"]'::jsonb,
  'Dan hid his status from Cat, so he does not count for her (it is Cat and Eve)');
select public.expect((select (m ->> 'week') is null from jsonb_array_elements(public.crews_state() -> 'crews' -> 0 -> 'members') m where m ->> 'name' = 'Dan'),
  'and Cat cannot see whether Dan is free this week');
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.set_share_settings('crew', :'crew', 'exact', '{}', 'enough', 2, '{}') \g /dev/null
select public.expect(public.catch_up_suggestions() -> 0 -> 'names' = '["Eve"]'::jsonb and (public.catch_up_suggestions() -> 0 ->> 'of')::int = 2,
  'and it works the other way: Dan''s suggestion leaves Cat out (Dan and Eve, 2 of 2)');
select public.set_status_hidden(:cat, false) \g /dev/null

-- Women-only mode: Dan is a man, Cat a woman with women-only on.
reset role;
insert into private.safety (user_id, gender, women_only) values (:cat, 'woman', true) on conflict (user_id) do update set gender = 'woman', women_only = true;
set role authenticated;
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.expect(public.catch_up_suggestions() -> 0 -> 'names' = '["Eve"]'::jsonb and (public.catch_up_suggestions() -> 0 ->> 'of')::int = 2,
  'Cat is women-only, so Dan never counts her free time');
select public.expect(not exists (select 1 from jsonb_array_elements(public.crews_state() -> 'crews' -> 0 -> 'members') m where m ->> 'name' = 'Cat'), 'and does not even see her in the crew');
reset role;
update private.safety set women_only = false where user_id = :cat;
set role authenticated;

-- ---------------------------------------------------------------- Plan it
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect_error(format('select public.plan_catch_up(''crew'', %L, %L, ''night'', now() + interval ''3 days'')', :fay, :'d3'), 'Cat cannot plan for a crew she is not in');
select public.expect_error(format('select public.plan_catch_up(''crew'', %L, %L, ''night'', now() - interval ''1 day'')', :'crew', :'d3'), 'the time has to be later than now');
select (public.plan_catch_up('crew', :'crew', :'d3', 'night', now() + interval '3 days')).id as planned \gset
reset role;
select public.expect((select private and created_at > now() from public.seshes where id = :'planned'), 'Plan it makes a planned sesh, private to the crew');
select public.expect((select array_agg(user_id order by user_id) from public.sesh_invites where sesh_id = :'planned') = array[:dan, :eve]::uuid[],
  'invited to the people in the crew who are Cat''s friends (not Gus, who said no, and not Fay)');
set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect(public.catch_up_suggestions() = '[]'::jsonb, 'the suggestion goes away once it is planned');
select set_config('request.jwt.claim.sub', :gus, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect((select count(*) from public.seshes where id = :'planned') = 0, 'Gus cannot see the planned sesh');
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.set_status('on') \g /dev/null
select public.expect((select count(*) from public.seshes where id = :'planned') = 1, 'Dan can');

-- ---------------------------------------------------------------- usually free, and busy this week
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect_error($$select public.set_free_pattern('{9:night}')$$, 'the pattern only takes real days and parts');
select public.expect(public.set_free_pattern('{1:night,1:arvo}') -> 'pattern' = '["1:arvo","1:night"]'::jsonb, 'Cat is usually free Monday arvos and nights');
select public.expect((select count(*) from jsonb_array_elements(public.my_free_time() -> 'days') d
  where extract(dow from (d ->> 'day')::date) = 1 and d -> 'free' = '["arvo","night"]'::jsonb) = (select count(*) from generate_series(0, 13) n where extract(dow from :'t0'::date + n) = 1),
  'every Monday in the grid fills itself in');
select public.set_free(((select (d ->> 'day')::date from jsonb_array_elements(public.my_free_time() -> 'days') d where extract(dow from (d ->> 'day')::date) = 1 order by d ->> 'day' limit 1)), 'night', false) \g /dev/null
select public.expect((select d -> 'free' from jsonb_array_elements(public.my_free_time() -> 'days') d where extract(dow from (d ->> 'day')::date) = 1 order by d ->> 'day' limit 1) = '["arvo"]'::jsonb,
  'one Monday can be un-ticked without losing the pattern');
select public.expect((select count(*) from jsonb_array_elements(public.my_free_time() -> 'days') d where d -> 'free' <> '[]'::jsonb) >= 2, 'the other Mondays are still ticked');
select public.expect((select count(*) from jsonb_array_elements(public.busy_this_week() -> 'days') d where d -> 'free' <> '[]'::jsonb and (d ->> 'day')::date < :'t0'::date + 7) = 0,
  'busy this week clears the next 7 days in one tap');
select public.expect((select count(*) from jsonb_array_elements(public.my_free_time() -> 'days') d where d -> 'free' <> '[]'::jsonb and (d ->> 'day')::date >= :'t0'::date + 7) >= 1,
  'but not the second week');
select public.set_free_pattern('{}') \g /dev/null

-- ---------------------------------------------------------------- slots are deleted once the day has passed
reset role;
insert into private.free_slots (user_id, day, part, free) values (:cat, :'t0'::date - 1, 'night', true), (:cat, :'t0'::date - 5, 'arvo', true), (:cat, :'t0'::date, 'morning', true)
  on conflict (user_id, day, part) do update set free = true;
insert into private.catch_up_dismissed (user_id, target, day, part) values (:cat, :cat, :'t0'::date - 1, 'night');
select public.expect(public.purge_free_time() >= 3, 'the clean-up deletes passed days');
select public.expect(not exists (select 1 from private.free_slots where day < :'t0'::date) and exists (select 1 from private.free_slots where day = :'t0'::date and part = 'morning'),
  'today stays, yesterday and older are gone');
select public.expect(not exists (select 1 from private.catch_up_dismissed where day < :'t0'::date), 'dismissed suggestions of passed days go too');
set role authenticated;

-- ---------------------------------------------------------------- leaving, removing, and unfriending
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.leave_crew(:'crew') \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.share_settings where user_id = :eve and crew_id = :'crew'), 'leaving a crew deletes her sharing settings for it straight away');
set role authenticated;
select public.expect(public.crews_state() -> 'crews' = '[]'::jsonb, 'Eve is out of the crew');
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect(not exists (select 1 from jsonb_array_elements(public.crews_state() -> 'crews' -> 0 -> 'members') m where m ->> 'name' = 'Eve'), 'and Cat no longer sees her in it');
select public.expect_error(format('select public.remove_from_crew(%L, %L)', :'crew', :cat), 'the person who made a crew cannot remove themselves (they leave it instead)');
select public.invite_to_crew(:'crew', array[:eve]::uuid[]) \g /dev/null
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.answer_crew_invite(:'crew', true) \g /dev/null
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.remove_from_crew(:'crew', :eve) \g /dev/null
-- Cat blocks Dan: he is out of her crew with his settings, and she is out of his view.
select public.block_user(:dan) \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.crew_members where crew_id = :'crew' and user_id = :dan), 'blocking someone takes them out of your crew');
select public.expect(not exists (select 1 from private.share_settings where user_id = :dan and crew_id = :'crew'), 'and deletes their settings for it');
-- Only Cat is left; she leaves, so the crew goes.
set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.leave_crew(:'crew') \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.crews where id = :'crew'), 'when the last person leaves the crew is deleted');
set role authenticated;

-- The person who made a crew leaves: it carries on under whoever has been in it longest.
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select (public.make_crew('Footy boys') ->> 'id') as footy \gset
select public.invite_to_crew(:'footy', array[:dan]::uuid[]) \g /dev/null
select set_config('request.jwt.claim.sub', :dan, false) \g /dev/null
select public.answer_crew_invite(:'footy', true) \g /dev/null
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.leave_crew(:'footy') \g /dev/null
reset role;
select public.expect((select owner from private.crews where id = :'footy') = :dan, 'the crew goes to Dan when Eve, who made it, leaves');
set role authenticated;

-- ---------------------------------------------------------------- besties
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect_error(format('select public.request_bestie(%L)', :fay), 'only a friend can be a bestie');
select public.expect_error(format('select public.request_bestie(%L)', :cat), 'and not yourself');
select public.expect(public.request_bestie(:eve) ->> 'state' = 'requested', 'Cat asks Eve to be her bestie');
select public.expect(public.crews_state() -> 'besties' -> 0 ->> 'state' = 'out', 'it shows as waiting for Eve');
select public.expect_error(format('select public.set_share_settings(''bestie'', %L, ''exact'', ''{}'', ''off'', 2, ''{}'')', :eve), 'nothing can be shared until she says yes');
select public.expect_error(format('select public.answer_bestie(%L, true)', :eve), 'Cat cannot accept her own request');
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.expect(public.crews_state() -> 'besties' -> 0 ->> 'state' = 'in', 'Eve sees the request');
select public.expect(public.answer_bestie(:cat, true) ->> 'state' = 'accepted', 'Eve says yes');
select public.expect(public.crews_state() -> 'besties' -> 0 ->> 'state' = 'accepted', 'and they are besties');

-- Both share exact times: a one to one suggestion, "both free".
select public.set_share_settings('bestie', :cat, 'exact', '{coffee}', 'enough', 2, '{}') \g /dev/null
select public.set_free(:'d4', 'arvo', true) \g /dev/null
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.set_share_settings('bestie', :eve, 'exact', '{coffee}', 'enough', 2, '{}') \g /dev/null
select public.set_free(:'d4', 'arvo', true) \g /dev/null
select public.expect(public.catch_up_suggestions() @> jsonb_build_array(jsonb_build_object('kind', 'bestie', 'label', 'Eve', 'day', :'d4', 'part', 'arvo', 'free', 2, 'of', 2)),
  'Cat gets "You and Eve are both free" for the bestie');
select public.expect((select (m ->> 'week')::boolean from jsonb_array_elements(public.crews_state() -> 'besties') m limit 1), 'and sees that her bestie is free this week');
select (public.plan_catch_up('bestie', :eve, :'d4', 'arvo', now() + interval '4 days')).id as coffee \gset
reset role;
select public.expect((select array_agg(user_id) from public.sesh_invites where sesh_id = :'coffee') = array[:eve]::uuid[], 'Plan it for a bestie invites just her');
set role authenticated;

-- The limit of 5 besties.
reset role;
insert into private.besties (requester, addressee, state)
  select :cat, ('00000000-0000-0000-0000-0000000032' || lpad(g::text, 2, '0'))::uuid, 'accepted' from generate_series(1, 4) g;
set role authenticated;
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.expect_error(format('select public.request_bestie(%L)', '00000000-0000-0000-0000-000000003205'), 'Cat cannot ask a 6th bestie');
select public.expect_error(format('select public.request_bestie(%L)', :gus), 'not even one who is a friend');
reset role;
delete from private.besties where requester = :cat and addressee::text like '00000000-0000-0000-0000-0000000032%';
set role authenticated;

-- Ending a bestie is quiet and stops everything.
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.remove_bestie(:eve) \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.besties where :cat in (requester, addressee) and :eve in (requester, addressee)), 'removing a bestie ends it');
select public.expect(not exists (select 1 from private.share_settings where bestie is not null and user_id in (:cat, :eve)), 'and both sides'' sharing settings with each other');
set role authenticated;

-- Unfriending ends a bestie too, and blocking leaves no crew membership.
select set_config('request.jwt.claim.sub', :cat, false) \g /dev/null
select public.request_bestie(:eve) \g /dev/null
select set_config('request.jwt.claim.sub', :eve, false) \g /dev/null
select public.answer_bestie(:cat, true) \g /dev/null
select public.answer_friend(f.id, false) from public.friendships f where f.requester = :cat and f.addressee = :eve \g /dev/null
reset role;
select public.expect(not exists (select 1 from private.besties where :eve in (requester, addressee)), 'unfriending someone ends the bestie');

-- ---------------------------------------------------------------- the person who deletes their account
delete from public.profiles where id = :dan;
select public.expect(not exists (select 1 from private.crew_members where user_id = :dan) and not exists (select 1 from private.free_slots where user_id = :dan),
  'deleting an account takes the person out of every crew and deletes their free time');

select 'ALL CREWS AND FREE TIME CHECKS PASSED';
