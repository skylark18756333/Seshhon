-- Frendzy staff can create and delete accounts from the Admin page, with no email needed.
--
-- Create: the admin types a first name, a date of birth (18 or over), a username and a password, and can
-- make it a venue account for a venue straight away. The new account logs in with that username and
-- password like anyone else, and the admin is shown its recovery code once to hand over. Where the
-- third-party age check is switched on, the person still does it the first time they log in.
--
-- Delete: removes the sign-in and the profile. Everything else hangs off those two and goes with
-- them (friends, statuses, seshes, chat, votes, ratings, photos, safety settings, roles, venue links).
-- An admin can't delete themselves or another admin; take the admin role away in SQL first.
--
-- Only admins (private.roles, migration 0019) can call these. Like save_account (0008), the
-- sign-in record is written straight into Supabase Auth's tables.

-- ---------------------------------------------------------------- find accounts
create or replace function public.admin_find_accounts(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  perform private.require_admin();
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object('id', p.id, 'name', p.name, 'username', l.username, 'role', private.role_of(p.id),
        'created_at', p.created_at, 'me', p.id = auth.uid()) as x
      from public.profiles p left join public.account_logins l on l.user_id = p.id
      where lower(p.name) like '%' || q || '%' or l.username like '%' || q || '%' or p.id::text = q
      order by p.name limit 20
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_find_accounts(text) from public, anon, authenticated;
grant execute on function public.admin_find_accounts(text) to authenticated;

-- ---------------------------------------------------------------- create
create or replace function public.admin_create_account(p_name text, p_birth_date date, p_username text, p_password text, p_venue uuid)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := gen_random_uuid();
  uname text := lower(btrim(coalesce(p_username, '')));
  nm text := btrim(coalesce(p_name, ''));
  mail text;
  code text := public.new_recovery_code();
  today date := (now() at time zone 'Australia/Perth')::date;
  col text; val text;
begin
  perform private.require_admin();
  if char_length(nm) not between 1 and 24 or nm ~ '[<>]' then raise exception 'Enter a first name of up to 24 characters.'; end if;
  if p_birth_date is null or p_birth_date > today or p_birth_date < date '1900-01-01' then raise exception 'Enter their date of birth.'; end if;
  if p_birth_date > (today - interval '18 years')::date then raise exception 'Frendzy is for people aged 18 and over.'; end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then raise exception 'Pick a username of 3 to 20 letters, numbers or _.'; end if;
  perform public.check_new_password(p_password);
  if p_venue is not null and not exists (select 1 from public.venues where id = p_venue) then raise exception 'Pick a venue from the list.'; end if;
  mail := public.login_email(uname);
  if exists (select 1 from public.account_logins where username = uname) or exists (select 1 from auth.users where lower(email) = mail) then
    raise exception 'That username is taken.';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, is_anonymous, raw_app_meta_data, created_at, updated_at)
  values (uid, mail, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(), false,
          '{"provider": "email", "providers": ["email"]}'::jsonb, now(), now());
  -- Supabase Auth's own columns. Its login code can't read empty (null) tokens, so they are set to ''.
  -- Each is set only if the column exists, so a change on Supabase's side can't break this.
  for col, val in select * from (values ('instance_id', '00000000-0000-0000-0000-000000000000'), ('aud', 'authenticated'), ('role', 'authenticated'),
      ('raw_user_meta_data', '{}'), ('confirmation_token', ''), ('recovery_token', ''), ('email_change_token_new', ''),
      ('email_change_token_current', ''), ('email_change', ''), ('phone_change', ''), ('phone_change_token', ''), ('reauthentication_token', '')) v(c, x)
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = col) then
      execute format('update auth.users set %1$I = %2$L where id = %3$L and %1$I is null', col, val, uid);
    end if;
  end loop;
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true), 'email', null, now(), now());

  insert into public.profiles (id, name, adult_confirmed_at) values (uid, nm, now());
  insert into public.account_logins (user_id, username, recovery_hash)
  values (uid, uname, extensions.crypt(public.recovery_code_key(code), extensions.gen_salt('bf', 8)));
  if p_venue is not null then
    insert into private.roles (user_id, role) values (uid, 'venue');
    insert into public.venue_staff (venue_id, user_id) values (p_venue, uid);
  end if;
  return jsonb_build_object('id', uid, 'name', nm, 'username', uname, 'recovery_code', code,
    'venue_name', (select name from public.venues where id = p_venue));
end;
$$;
revoke all on function public.admin_create_account(text, date, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_create_account(text, date, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------- delete
create or replace function public.admin_delete_account(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  if p_user = auth.uid() then raise exception 'You can''t delete your own account from here.'; end if;
  if private.role_of(p_user) = 'admin' then raise exception 'That''s a Frendzy staff account. Take away its admin role in Supabase first.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) and not exists (select 1 from auth.users where id = p_user) then
    raise exception 'That account has already gone.';
  end if;
  delete from public.seshes where creator = p_user;
  delete from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_delete_account(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_account(uuid) to authenticated;
