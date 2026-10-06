-- Frendzy staff can create and delete accounts from the Admin page, with no email needed.
--
-- Create: the admin types a first name, a date of birth (18 or over), a username and a password, and can
-- make it a venue account for a venue straight away. The new account logs in with that username and
-- password like anyone else, and the admin is shown its recovery code once to hand over. Where the
-- third-party age check is switched on, the person still does it the first time they log in.
--
-- Delete (for breaking the rules): the admin must give a reason. It removes the sign-in and the profile.
-- Everything else hangs off those two and goes with them (friends, statuses, seshes, chat, votes,
-- ratings, photos, safety settings, roles, venue links). A short record is kept (when, who, why), and
-- the same username and email can't sign up again unless an admin allows them back.
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

-- ---------------------------------------------------------------- removed accounts
-- One row per account an admin deleted: when, by whom and why. No profile data is kept, only
-- scrambled (hashed) copies of the username and the confirmed email, so the same username or email
-- can't be used to sign straight back up. A new username and a new email still can.
create table if not exists private.removed_accounts (
  id uuid primary key default gen_random_uuid(),
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 200),
  username_hash text,
  email_hash text
);
alter table private.removed_accounts enable row level security;
revoke all on private.removed_accounts from public, anon, authenticated;
create index if not exists removed_accounts_username on private.removed_accounts (username_hash);
create index if not exists removed_accounts_email on private.removed_accounts (email_hash);

create or replace function private.removed_key(p text) returns text
language sql immutable set search_path = public as $$
  select case when nullif(btrim(coalesce(p, '')), '') is null then null
    else encode(extensions.digest(lower(btrim(p)), 'sha256'), 'hex') end;
$$;

-- Every way of picking a username (sign up, change username, admin create) goes through account_logins.
create or replace function private.no_removed_username() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from private.removed_accounts where username_hash = private.removed_key(new.username)) then
    raise exception 'That username is taken.';
  end if;
  return new;
end;
$$;
drop trigger if exists no_removed_username on public.account_logins;
create trigger no_removed_username before insert or update of username on public.account_logins
  for each row execute function private.no_removed_username();

-- Every way of adding or changing the login email goes through private.two_step.
create or replace function private.no_removed_email() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from private.removed_accounts
             where email_hash in (private.removed_key(new.pending_email), private.removed_key(new.email))) then
    raise exception 'That email can''t be used on Frendzy.';
  end if;
  return new;
end;
$$;
drop trigger if exists no_removed_email on private.two_step;
create trigger no_removed_email before insert or update of email, pending_email on private.two_step
  for each row execute function private.no_removed_email();

-- ---------------------------------------------------------------- delete
-- Removes an account for breaking the rules. A reason is required and kept in private.removed_accounts.
drop function if exists public.admin_delete_account(uuid);
create or replace function public.admin_delete_account(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare why text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_admin();
  if p_user = auth.uid() then raise exception 'You can''t delete your own account from here.'; end if;
  if private.role_of(p_user) = 'admin' then raise exception 'That''s a Frendzy staff account. Take away its admin role in Supabase first.'; end if;
  if char_length(why) not between 3 and 200 then raise exception 'Say why this account is being removed (3 to 200 characters).'; end if;
  if not exists (select 1 from public.profiles where id = p_user) and not exists (select 1 from auth.users where id = p_user) then
    raise exception 'That account has already gone.';
  end if;
  insert into private.removed_accounts (removed_by, reason, username_hash, email_hash)
  values (auth.uid(), why,
    private.removed_key((select username from public.account_logins where user_id = p_user)),
    private.removed_key((select email from private.two_step where user_id = p_user)));
  delete from public.seshes where creator = p_user;
  delete from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_delete_account(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

-- The removed list for the Admin page: newest first, with the reason and which admin did it.
create or replace function public.admin_removed_accounts() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'removed_at', r.removed_at, 'reason', r.reason,
      'removed_by', (select name from public.profiles where id = r.removed_by),
      'blocked', r.username_hash is not null or r.email_hash is not null) order by r.removed_at desc)
    from (select * from private.removed_accounts order by removed_at desc limit 100) r
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_removed_accounts() from public, anon, authenticated;
grant execute on function public.admin_removed_accounts() to authenticated;

-- Let a removed person sign up again with the same username and email. The reason stays on record.
create or replace function public.admin_allow_back(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  update private.removed_accounts set username_hash = null, email_hash = null where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_allow_back(uuid) from public, anon, authenticated;
grant execute on function public.admin_allow_back(uuid) to authenticated;
