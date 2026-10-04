-- Email two-step login. When someone saves a username and password, they also give an email address
-- and confirm it with a 6-digit code. After that, every new login asks for a fresh code sent to that
-- email, as well as the password.
--
-- The email address is private: it lives in the "private" schema, which the app's API cannot read,
-- and nobody (not even the owner) gets it back in full, only a hint like s•••@gmail.com.
-- The codes are sent by the email-code Edge Function (supabase/functions/email-code), which holds the
-- email service key. Only a bcrypt hash of each code is stored.
--
-- How a login is held back until the code is typed: the Supabase "Customize Access Token" hook
-- (Authentication > Hooks) runs two_step_token_hook() every time a sign-in token is made. If the account
-- has email codes on and this sign-in hasn't had its code yet, the token gets the role "needs_code",
-- which can only check a code and nothing else. After the code, the app fetches a fresh token and gets
-- the normal "authenticated" role. If the hook ever fails, it lets the login through as before.
--
-- Accounts saved before this change keep logging in with just their password until they add an email.
-- A recovery code still gets you back in if you lose your email.
-- Safe to run more than once. Run it BEFORE switching on the hook.

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- the waiting role
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'needs_code') then
    create role needs_code nologin noinherit;
  end if;
  -- The API (PostgREST) signs in as "authenticator" and switches to the role in each token.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant needs_code to authenticator';
  end if;
end $$;
grant usage on schema public to needs_code;

-- ---------------------------------------------------------------- tables (nobody reads these directly)
create table if not exists private.two_step (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,                       -- the confirmed address; null until the first code is typed
  pending_email text,               -- an address waiting for its code
  code_hash text,                   -- bcrypt hash of the latest code
  code_purpose text check (code_purpose in ('setup', 'login')),
  code_expires timestamptz,
  code_tries integer not null default 0,
  ticket_hash text,                 -- after a recovery code: lets the next login skip the email code once
  ticket_expires timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.two_step enable row level security;
revoke all on private.two_step from public, anon, authenticated;

-- Sign-ins that have had their code. Rows go when the sign-in itself is gone.
create table if not exists private.two_step_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now()
);
create index if not exists two_step_sessions_user on private.two_step_sessions (user_id);
alter table private.two_step_sessions enable row level security;
revoke all on private.two_step_sessions from public, anon, authenticated;

-- Codes sent, so each account gets at most 5 emails an hour and 20 a day. Kept for a day.
create table if not exists private.two_step_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists two_step_sends_user on private.two_step_sends (user_id, at);
alter table private.two_step_sends enable row level security;
revoke all on private.two_step_sends from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- The sign-in (Supabase Auth session) the current request belongs to.
create or replace function private.my_session() returns uuid
language plpgsql stable set search_path = public as $$
begin
  return (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid;
exception when others then
  return null;
end;
$$;

-- s•••@gmail.com
create or replace function private.email_hint(p_email text) returns text
language sql immutable set search_path = public as $$
  select case when p_email is null then null
    else left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2) end;
$$;

create or replace function private.session_verified(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select p_session is not null
     and exists (select 1 from private.two_step_sessions s where s.session_id = p_session and s.user_id = p_user);
$$;

create or replace function private.mark_verified(p_user uuid, p_session uuid) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if p_session is null then return; end if;
  insert into private.two_step_sessions (session_id, user_id) values (p_session, p_user)
  on conflict (session_id) do nothing;
  -- Tidy up sign-ins that no longer exist.
  begin
    delete from private.two_step_sessions s
    where s.user_id = p_user and not exists (select 1 from auth.sessions a where a.id = s.session_id);
  exception when undefined_table then null;
  end;
end;
$$;

-- ---------------------------------------------------------------- the token hook
-- Supabase Auth calls this every time it makes a sign-in token (logging in and every refresh).
create or replace function public.two_step_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  claims jsonb := event -> 'claims';
  uid uuid;
  sid uuid;
begin
  begin
    uid := (event ->> 'user_id')::uuid;
    sid := (claims ->> 'session_id')::uuid;
    if claims ->> 'role' = 'authenticated'
       and exists (select 1 from private.two_step t where t.user_id = uid and t.email is not null)
       and not private.session_verified(uid, sid) then
      claims := jsonb_set(claims, '{role}', '"needs_code"');
    end if;
  exception when others then
    return event;   -- never block a login because of this check
  end;
  return jsonb_build_object('claims', claims);
end;
$$;

-- ---------------------------------------------------------------- what the app calls

-- Whether this sign-in still needs its email code.
create or replace function public.two_step_state() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t private.two_step;
begin
  if me is null then return jsonb_build_object('on', false, 'needed', false); end if;
  select * into t from private.two_step where user_id = me;
  return jsonb_build_object(
    'on', t.email is not null,
    'needed', t.email is not null and not private.session_verified(me, private.my_session()),
    'hint', private.email_hint(coalesce(t.email, t.pending_email))
  );
end;
$$;

-- Your username, and the hint for your login email.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('username', l.username, 'email', private.email_hint(t.email), 'pending_email', private.email_hint(t.pending_email))
  from public.account_logins l left join private.two_step t on t.user_id = l.user_id
  where l.user_id = auth.uid();
$$;

-- Makes a code to email. Only the email-code Edge Function calls this (with the service key), after
-- checking who is asking with Supabase Auth. Returns the address and the code to send.
--   'setup': start using (or change to) p_email. Needs a saved username, and if codes are already on,
--            a sign-in that has had its code.
--   'login': a code for the sign-in p_session.
create or replace function public.two_step_make_code(p_user uuid, p_session uuid, p_purpose text, p_email text default null)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  t private.two_step;
  mail text := lower(btrim(coalesce(p_email, '')));
  code text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
begin
  if p_user is null then raise exception 'Sign in first.'; end if;
  select * into t from private.two_step where user_id = p_user;
  if p_purpose = 'setup' then
    if not exists (select 1 from public.account_logins where user_id = p_user) then raise exception 'Save a username and password first.'; end if;
    if mail !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(mail) > 254 then raise exception 'Enter a real email address.'; end if;
    if t.email is not null and not private.session_verified(p_user, p_session) then raise exception 'Type the code from your email first.'; end if;
  elsif p_purpose = 'login' then
    if t.email is null then raise exception 'This account doesn''t use email codes.'; end if;
    if private.session_verified(p_user, p_session) then raise exception 'You''re already logged in.'; end if;
    mail := t.email;
  else
    raise exception 'Unknown code type.';
  end if;

  delete from private.two_step_sends where at < now() - interval '1 day';
  if (select count(*) from private.two_step_sends where user_id = p_user and at > now() - interval '1 hour') >= 5
     or (select count(*) from private.two_step_sends where user_id = p_user) >= 20 then
    raise exception 'Too many codes sent. Wait a while, then try again.';
  end if;
  insert into private.two_step_sends (user_id) values (p_user);

  insert into private.two_step (user_id, pending_email, code_hash, code_purpose, code_expires, code_tries, updated_at)
  values (p_user, case when p_purpose = 'setup' then mail end, extensions.crypt(code, extensions.gen_salt('bf', 8)), p_purpose, now() + interval '10 minutes', 0, now())
  on conflict (user_id) do update set
    pending_email = case when p_purpose = 'setup' then mail else private.two_step.pending_email end,
    code_hash = excluded.code_hash, code_purpose = excluded.code_purpose, code_expires = excluded.code_expires,
    code_tries = 0, updated_at = now();
  return jsonb_build_object('email', mail, 'code', code);
end;
$$;

-- Check the code from the email. Right code: this sign-in is let in (and for 'setup', the email is saved).
-- Wrong codes return a message, and after 5 the code stops working.
create or replace function public.two_step_check(p_code text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t private.two_step;
  typed text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into t from private.two_step where user_id = me for update;
  if not found or t.code_hash is null or t.code_expires < now() or t.code_tries >= 5 then
    return jsonb_build_object('ok', false, 'message', 'That code has run out. Send a new one.');
  end if;
  if t.code_hash <> extensions.crypt(typed, t.code_hash) then
    update private.two_step set code_tries = code_tries + 1 where user_id = me;
    return jsonb_build_object('ok', false, 'message', 'That code isn''t right. Check the email and try again.');
  end if;
  if t.code_purpose = 'setup' then
    update private.two_step set email = pending_email, pending_email = null, code_hash = null, code_tries = 0, updated_at = now() where user_id = me;
  else
    update private.two_step set code_hash = null, code_tries = 0, updated_at = now() where user_id = me;
  end if;
  perform private.mark_verified(me, private.my_session());
  return jsonb_build_object('ok', true, 'email', private.email_hint(coalesce(t.pending_email, t.email)));
end;
$$;

-- After a recovery code, the first login skips the email code once (for when the email is lost too).
create or replace function public.two_step_use_ticket(p_ticket text) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t private.two_step;
begin
  if me is null or coalesce(p_ticket, '') = '' then return false; end if;
  select * into t from private.two_step where user_id = me for update;
  if not found or t.ticket_hash is null or t.ticket_expires < now()
     or t.ticket_hash <> extensions.crypt(p_ticket, t.ticket_hash) then
    return false;
  end if;
  update private.two_step set ticket_hash = null, ticket_expires = null where user_id = me;
  perform private.mark_verified(me, private.my_session());
  return true;
end;
$$;

-- Same as 0008, plus a one-time ticket so the login straight after a recovery doesn't need the email.
create or replace function public.recover_account(p_username text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uname text := lower(btrim(coalesce(p_username, '')));
  l public.account_logins;
  code text := public.new_recovery_code();
  ticket text := encode(extensions.gen_random_bytes(18), 'hex');
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
  delete from private.two_step_sessions where user_id = l.user_id;
  update private.two_step set ticket_hash = extensions.crypt(ticket, extensions.gen_salt('bf', 8)), ticket_expires = now() + interval '15 minutes'
  where user_id = l.user_id;
  update public.account_logins
  set recovery_hash = extensions.crypt(public.recovery_code_key(code), extensions.gen_salt('bf', 8)), updated_at = now()
  where user_id = l.user_id;
  delete from public.recovery_attempts where username = uname;
  return jsonb_build_object('ok', true, 'username', uname, 'recovery_code', code, 'ticket', ticket);
end;
$$;

-- ---------------------------------------------------------------- permissions
revoke all on function private.my_session(), private.email_hint(text), private.session_verified(uuid, uuid),
  private.mark_verified(uuid, uuid), public.two_step_token_hook(jsonb), public.two_step_state(), public.my_account(),
  public.two_step_make_code(uuid, uuid, text, text), public.two_step_check(text), public.two_step_use_ticket(text),
  public.recover_account(text, text, text)
  from public, anon, authenticated;
grant execute on function public.two_step_state(), public.two_step_check(text), public.two_step_use_ticket(text)
  to authenticated, needs_code;
grant execute on function public.my_account(), public.recover_account(text, text, text) to authenticated;
grant execute on function public.two_step_make_code(uuid, uuid, text, text) to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.two_step_token_hook(jsonb) to supabase_auth_admin';
  end if;
end $$;
