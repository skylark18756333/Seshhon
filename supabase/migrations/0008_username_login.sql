-- Optional username and password, so people can get back into their account on a new phone.
-- No email address is asked for or stored. Behind the scenes Supabase Auth needs an "email" to log in
-- with, so the app uses <username>@users.seshon.invalid, a domain that can never receive mail.
-- Instead of "forgot password" emails, each person gets a one-time recovery code to save.
--
-- Needs in Supabase: Authentication > Sign In / Providers > Email switched ON (for password logins),
-- with "Confirm email" left ON so nobody can make accounts with real email addresses.
-- Safe to run more than once.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables (nobody reads these directly)
create table if not exists public.account_logins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  recovery_hash text not null,          -- bcrypt hash of the recovery code; the code itself is never stored
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_logins enable row level security;
revoke all on public.account_logins from public, anon, authenticated;

-- Wrong recovery codes, so each username gets at most 5 tries a day. Kept for a day.
create table if not exists public.recovery_attempts (
  username text not null,
  at timestamptz not null default now()
);
create index if not exists recovery_attempts_username on public.recovery_attempts (username, at);
alter table public.recovery_attempts enable row level security;
revoke all on public.recovery_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.login_email(p_username text) returns text
language sql immutable set search_path = public as $$
  select p_username || '@users.seshon.invalid';
$$;

-- 16 characters with no look-alikes (no I, L, O, 0 or 1), shown as XXXX-XXXX-XXXX-XXXX.
create or replace function public.new_recovery_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(16);
  code text := '';
begin
  for i in 0..15 loop
    code := code || substr(alphabet, 1 + get_byte(bytes, i) % 31, 1);
    if i in (3, 7, 11) then code := code || '-'; end if;
  end loop;
  return code;
end;
$$;

-- Recovery codes are compared without dashes, spaces or case.
create or replace function public.recovery_code_key(p_code text) returns text
language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.check_new_password(p_password text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if char_length(coalesce(p_password, '')) < 10 then raise exception 'Use a password of at least 10 characters.'; end if;
  if octet_length(p_password) > 72 then raise exception 'Use a password of at most 72 characters.'; end if;
end;
$$;

-- ---------------------------------------------------------------- what the app calls

-- Add (or change) your username and password. Returns a new recovery code to save.
create or replace function public.save_account(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  uname text := lower(btrim(coalesce(p_username, '')));
  mail text;
  code text := public.new_recovery_code();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then raise exception 'Pick a username of 3 to 20 letters, numbers or _.'; end if;
  perform public.check_new_password(p_password);
  mail := public.login_email(uname);
  if exists (select 1 from public.account_logins where username = uname and user_id <> me)
     or exists (select 1 from auth.users where lower(email) = mail and id <> me) then
    raise exception 'That username is taken.';
  end if;

  update auth.users
  set email = mail,
      encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      is_anonymous = false,
      raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider": "email", "providers": ["email"]}'::jsonb,
      updated_at = now()
  where id = me;

  -- Supabase keeps one "identity" per sign-in method.
  delete from auth.identities where user_id = me and provider = 'email';
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (me::text, me, jsonb_build_object('sub', me::text, 'email', mail, 'email_verified', true), 'email', now(), now(), now());

  insert into public.account_logins (user_id, username, recovery_hash)
  values (me, uname, extensions.crypt(public.recovery_code_key(code), extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update
    set username = excluded.username, recovery_hash = excluded.recovery_hash, updated_at = now();
  return jsonb_build_object('username', uname, 'recovery_code', code);
end;
$$;

-- Your username, or null if you haven't saved your account.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('username', username) from public.account_logins where user_id = auth.uid();
$$;

-- Set a new password with the recovery code. Called from a new phone (signed in anonymously first,
-- so the bot check applies). The used code stops working and a new one is returned.
-- Wrong codes return a message instead of an error, so the attempt is counted.
create or replace function public.recover_account(p_username text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uname text := lower(btrim(coalesce(p_username, '')));
  l public.account_logins;
  code text := public.new_recovery_code();
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform public.check_new_password(p_password);
  delete from public.recovery_attempts where at < now() - interval '1 day';
  if (select count(*) from public.recovery_attempts where username = uname) >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Too many tries for that username. Try again tomorrow.');
  end if;
  select * into l from public.account_logins where username = uname;
  if not found or l.recovery_hash <> extensions.crypt(public.recovery_code_key(p_code), l.recovery_hash) then
    insert into public.recovery_attempts (username) values (uname);
    return jsonb_build_object('ok', false, 'message', 'That username and recovery code don''t match.');
  end if;

  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = l.user_id;
  -- Sign the account out everywhere else, in case someone else had it.
  begin
    delete from auth.sessions where user_id = l.user_id;
  exception when undefined_table then null;
  end;
  update public.account_logins
  set recovery_hash = extensions.crypt(public.recovery_code_key(code), extensions.gen_salt('bf', 8)), updated_at = now()
  where user_id = l.user_id;
  delete from public.recovery_attempts where username = uname;
  return jsonb_build_object('ok', true, 'username', uname, 'recovery_code', code);
end;
$$;

-- ---------------------------------------------------------------- clean-up
-- Same as 0006, except unfinished sign-ins now also include anyone who tried to sign up straight to
-- Supabase Auth with an email address (switched on for password logins) and never confirmed it.
create or replace function public.purge_old_data() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; k integer;
begin
  delete from public.seshes where ended_at is not null or created_at < now() - interval '8 hours';
  get diagnostics k = row_count; n := n + k;
  delete from public.redemptions where night < public.night_of() - 1;
  get diagnostics k = row_count; n := n + k;
  begin
    execute $q$
      delete from auth.users u
      where (u.is_anonymous or u.email_confirmed_at is null) and u.created_at < now() - interval '2 days'
        and not exists (select 1 from public.profiles p where p.id = u.id)
    $q$;
    get diagnostics k = row_count; n := n + k;
  exception when undefined_column or insufficient_privilege then
    null;
  end;
  return n;
end;
$$;
revoke all on function public.purge_old_data() from public, anon, authenticated;

-- ---------------------------------------------------------------- permissions
revoke all on function public.login_email(text), public.new_recovery_code(), public.recovery_code_key(text),
  public.check_new_password(text), public.save_account(text, text), public.my_account(),
  public.recover_account(text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_account(text, text), public.my_account(), public.recover_account(text, text, text)
  to authenticated;
