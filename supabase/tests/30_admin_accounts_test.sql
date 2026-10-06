-- Checks for admins creating and deleting accounts (migration 0030). Runs after the earlier tests and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
\set ad '''00000000-0000-0000-0000-0000000030a1'''
\set us '''00000000-0000-0000-0000-0000000030a2'''
\set ad2 '''00000000-0000-0000-0000-0000000030a3'''
insert into auth.users (id) values (:ad), (:us), (:ad2);
insert into public.profiles (id, name, adult_confirmed_at, invite_code) values (:ad, 'Adele', now(), 'ADELEADE'), (:us, 'Ursula', now(), 'URSULAUR'), (:ad2, 'Abe', now(), 'ABEABEAB');
insert into private.roles (user_id, role) values (:ad, 'admin'), (:ad2, 'admin');
insert into public.venues (id, name, kind) values ('10000000-0000-0000-0000-0000000030f1', 'Admin Bar', 'Bar');

set role authenticated;
select set_config('request.jwt.claim.sub', :us, false) \g /dev/null
select public.expect_error($$select public.admin_create_account('Nia', '1990-01-01', 'nia_new', 'longenough1', null)$$, 'a normal user cannot create accounts');
select public.expect_error($$select public.admin_delete_account('00000000-0000-0000-0000-0000000030a1', 'spam')$$, 'a normal user cannot delete accounts');
select public.expect_error($$select public.admin_find_accounts('ad')$$, 'a normal user cannot search accounts');

select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.expect_error($$select public.admin_create_account('Kid', (now() - interval '17 years')::date, 'kid_new', 'longenough1', null)$$, 'an under-18 account is refused');
select public.expect_error($$select public.admin_create_account('Nia', '1990-01-01', 'NI', 'longenough1', null)$$, 'a bad username is refused');
select public.expect_error($$select public.admin_create_account('Nia', '1990-01-01', 'nia_new', 'short', null)$$, 'a short password is refused');
create temp table made as select public.admin_create_account('Nia', '1990-01-01', 'Nia_New', 'longenough1', null) as r;
grant select on made to authenticated;
select public.expect((select r ->> 'username' from made) = 'nia_new' and (select r ->> 'recovery_code' from made) ~ '^[A-Z2-9]{4}-', 'an admin creates an account and gets its recovery code');
select public.expect_error($$select public.admin_create_account('Nia', '1990-01-01', 'nia_new', 'longenough1', null)$$, 'a taken username is refused');
reset role;
select public.expect((select email = 'nia_new@users.seshon.invalid' and encrypted_password = extensions.crypt('longenough1', encrypted_password) and email_confirmed_at is not null and not is_anonymous
  from auth.users where id = (select (r ->> 'id')::uuid from made)), 'the new account logs in with its username and password, no email needed');
select public.expect(exists (select 1 from auth.identities where user_id = (select (r ->> 'id')::uuid from made) and provider = 'email'), 'it has a sign-in identity');
select public.expect(exists (select 1 from public.profiles where id = (select (r ->> 'id')::uuid from made) and name = 'Nia'), 'it has a profile');
select public.expect((select recovery_hash = extensions.crypt(public.recovery_code_key(r ->> 'recovery_code'), recovery_hash) from public.account_logins, made where username = 'nia_new'), 'the recovery code works');
select public.expect(private.role_of((select (r ->> 'id')::uuid from made)) = 'user', 'it is a normal account');

set role authenticated;
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
create temp table made_v as select public.admin_create_account('Vera', '1985-05-05', 'admin_bar', 'longenough1', '10000000-0000-0000-0000-0000000030f1') as r;
reset role;
select public.expect(private.role_of((select (r ->> 'id')::uuid from made_v)) = 'venue'
  and exists (select 1 from public.venue_staff where user_id = (select (r ->> 'id')::uuid from made_v) and venue_id = '10000000-0000-0000-0000-0000000030f1'), 'an admin can create a venue account for a venue');
set role authenticated;
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.expect(jsonb_array_length(public.admin_find_accounts('nia')) = 1, 'an admin can find an account by name or username');
select public.expect_error($$select public.admin_delete_account('00000000-0000-0000-0000-0000000030a1', 'spam')$$, 'an admin cannot delete their own account here');
select public.expect_error($$select public.admin_delete_account('00000000-0000-0000-0000-0000000030a3', 'spam')$$, 'an admin cannot delete another admin');

-- Ursula has a friend, a sesh and a status. Deleting her removes all of it.
reset role;
insert into public.friendships (requester, addressee, state) values (:us, (select (r ->> 'id')::uuid from made), 'accepted');
insert into public.seshes (id, creator) values ('20000000-0000-0000-0000-0000000030c1', :us);
insert into public.sesh_members (sesh_id, user_id) values ('20000000-0000-0000-0000-0000000030c1', :us);
set role authenticated;
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.expect_error(format('select public.admin_delete_account(%L, %L)', :us, ' '), 'a reason is required');
reset role;
insert into public.account_logins (user_id, username, recovery_hash) values (:us, 'ursula_x', 'x');
insert into private.two_step (user_id, email) values (:us, 'Ursula@Example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.admin_delete_account(:us, 'Harassing people in sesh chat') \g /dev/null
select public.expect((select r ->> 'reason' from jsonb_array_elements(public.admin_removed_accounts()) r limit 1) = 'Harassing people in sesh chat'
  and (select (r ->> 'removed_by') = 'Adele' and (r ->> 'blocked')::boolean from jsonb_array_elements(public.admin_removed_accounts()) r limit 1), 'the reason and who removed them are kept');
select public.expect_error($$select public.admin_create_account('Ursula', '1990-01-01', 'Ursula_X', 'longenough1', null)$$, 'the removed username can''t be used again');
reset role;
select public.expect(not exists (select 1 from private.removed_accounts where reason like '%ursula%' or username_hash = 'ursula_x'), 'no plain username is kept');
select public.expect_error($$insert into private.two_step (user_id, pending_email) values ('00000000-0000-0000-0000-0000000030a2', 'ursula@example.com ')$$, 'the removed email can''t be used again');
set role authenticated;
select set_config('request.jwt.claim.sub', :us, false) \g /dev/null
select public.expect_error($$select public.admin_removed_accounts()$$, 'a normal user cannot see removed accounts');
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.admin_allow_back((select (r ->> 'id')::uuid from jsonb_array_elements(public.admin_removed_accounts()) r limit 1)) \g /dev/null
select public.expect((select r ->> 'username' from (select public.admin_create_account('Ursula', '1990-01-01', 'ursula_x', 'longenough1', null) as r) m) = 'ursula_x', 'after Allow back the username works again');
reset role;
select public.expect(not exists (select 1 from public.profiles where id = :us) and not exists (select 1 from auth.users where id = :us), 'deleting removes the profile and the sign-in');
select public.expect(not exists (select 1 from public.friendships where requester = :us or addressee = :us), 'and their friendships');
select public.expect(not exists (select 1 from public.seshes where id = '20000000-0000-0000-0000-0000000030c1'), 'and the seshes they started');
set role authenticated;
select set_config('request.jwt.claim.sub', :ad, false) \g /dev/null
select public.admin_delete_account((select (r ->> 'id')::uuid from made_v), 'Closed venue') \g /dev/null
reset role;
select public.expect(not exists (select 1 from public.venue_staff where venue_id = '10000000-0000-0000-0000-0000000030f1') and not exists (select 1 from private.roles where user_id = (select (r ->> 'id')::uuid from made_v)),
  'deleting a venue account also removes its venue link and role');
set role anon;
select public.expect_error($$select public.admin_create_account('Nia', '1990-01-01', 'anon_new', 'longenough1', null)$$, 'signed-out visitors cannot create accounts');
reset role;
select 'ALL ADMIN ACCOUNT CHECKS PASSED';
