-- Login codes from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...), as an
-- optional extra to the emailed codes (0018). Someone turns it on from the You page: the app scans a QR code
-- (or opens a link on the phone) and then shows a 6-digit code that changes every 30 seconds. After that, a new
-- login asks for the app's code. If they also have a confirmed email, they can ask for an email code instead.
-- The codes are the standard TOTP ones (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits), checked here in the
-- database. The app's secret lives in the private schema, which the API can't read. Each code works once, and
-- 5 wrong codes pause the app codes for 15 minutes.
--
-- Recovery codes are no longer shown in the app (people didn't save them). Forgetting a password is handled by
-- an emailed code (0032), and staff can now set a new password for an account from the Admin page.
-- Needs 0018, 0023 and 0030. Safe to run more than once. Run it BEFORE switching on the hook, or again after.

create table if not exists private.totp (
  user_id uuid primary key references auth.users (id) on delete cascade,
  secret text,                      -- base32; set once the first code is typed
  pending_secret text,              -- shown in the QR code, waiting for its first code
  enabled_at timestamptz,
  last_step bigint not null default 0,   -- the newest 30-second step already used, so a code works once
  tries integer not null default 0,
  tries_at timestamptz
);
alter table private.totp enable row level security;
revoke all on private.totp from public, anon, authenticated;

-- ---------------------------------------------------------------- the TOTP maths
create or replace function private.base32_bytes(p text) returns bytea
language plpgsql immutable set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s text := upper(regexp_replace(coalesce(p, ''), '[\s=-]', '', 'g'));
  buf bigint := 0;
  bits integer := 0;
  out bytea := ''::bytea;
  v integer;
begin
  for i in 1 .. char_length(s) loop
    v := strpos(alphabet, substr(s, i, 1)) - 1;
    if v < 0 then return null; end if;
    buf := ((buf << 5) | v) & 1099511627775;   -- keep 40 bits
    bits := bits + 5;
    if bits >= 8 then
      out := out || set_byte('\x00'::bytea, 0, ((buf >> (bits - 8)) & 255)::integer);
      bits := bits - 8;
    end if;
  end loop;
  return out;
end;
$$;

-- The 6-digit code for one 30-second step.
create or replace function private.totp_at(p_secret text, p_step bigint) returns text
language plpgsql immutable set search_path = public as $$
declare
  h bytea := extensions.hmac(int8send(p_step), private.base32_bytes(p_secret), 'sha1');
  o integer := get_byte(h, 19) & 15;
  bin bigint := ((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16) | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3)::bigint;
begin
  return lpad((bin % 1000000)::text, 6, '0');
end;
$$;

-- The step a typed code belongs to (this one, or one either side for a slow clock), if newer than p_after.
create or replace function private.totp_step(p_secret text, p_code text, p_after bigint) returns bigint
language plpgsql stable set search_path = public as $$
declare
  typed text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  now_step bigint := floor(extract(epoch from now()) / 30)::bigint;
begin
  if p_secret is null or length(typed) <> 6 then return null; end if;
  for st in reverse now_step + 1 .. now_step - 1 loop
    if st > coalesce(p_after, 0) and private.totp_at(p_secret, st) = typed then return st; end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------- turning it on and off (You page)
-- A new secret for the QR code. Nothing changes until its first code is typed (totp_confirm).
create or replace function public.totp_start() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  uname text;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  rnd bytea := extensions.gen_random_bytes(32);
  sec text := '';
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select username into uname from public.account_logins where user_id = me;
  if uname is null then raise exception 'Save a username and password first.'; end if;
  if exists (select 1 from private.totp where user_id = me and secret is not null) then raise exception 'Your authenticator app is already on.'; end if;
  for i in 0 .. 31 loop sec := sec || substr(alphabet, (get_byte(rnd, i) % 32) + 1, 1); end loop;   -- 160 bits
  insert into private.totp (user_id, pending_secret) values (me, sec)
  on conflict (user_id) do update set pending_secret = excluded.pending_secret, tries = 0;
  return jsonb_build_object('secret', sec,
    'uri', 'otpauth://totp/Frendzy:' || uname || '?secret=' || sec || '&issuer=Frendzy&algorithm=SHA1&digits=6&period=30');
end;
$$;

-- The first code from the app turns it on.
create or replace function public.totp_confirm(p_code text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t private.totp;
  st bigint;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into t from private.totp where user_id = me for update;
  if not found or t.pending_secret is null then return jsonb_build_object('ok', false, 'message', 'Start again: tap Set up an authenticator app.'); end if;
  if t.tries >= 5 and t.tries_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Too many wrong codes. Wait 15 minutes, then try again.');
  end if;
  st := private.totp_step(t.pending_secret, p_code, 0);
  if st is null then
    update private.totp set tries = case when tries_at > now() - interval '15 minutes' then tries + 1 else 1 end, tries_at = now() where user_id = me;
    return jsonb_build_object('ok', false, 'message', 'That code isn''t right. Type the 6 digits the app shows for Frendzy now.');
  end if;
  update private.totp set secret = pending_secret, pending_secret = null, enabled_at = now(), last_step = st, tries = 0 where user_id = me;
  return jsonb_build_object('ok', true);
end;
$$;

-- Turns the app codes off (from a full login only). Emailed codes, if set up, carry on.
create or replace function public.totp_off() returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from private.totp where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- logging in with it
-- Like two_step_check (0018), for a code from the app: the right one lets this sign-in in.
create or replace function public.totp_check(p_code text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t private.totp;
  st bigint;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into t from private.totp where user_id = me for update;
  if not found or t.secret is null then return jsonb_build_object('ok', false, 'message', 'This account doesn''t use an authenticator app.'); end if;
  if t.tries >= 5 and t.tries_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Too many wrong codes. Wait 15 minutes, or use an email code.');
  end if;
  st := private.totp_step(t.secret, p_code, t.last_step);
  if st is null then
    update private.totp set tries = case when tries_at > now() - interval '15 minutes' then tries + 1 else 1 end, tries_at = now() where user_id = me;
    return jsonb_build_object('ok', false, 'message', 'That code isn''t right. Check the app and try again.');
  end if;
  update private.totp set last_step = st, tries = 0 where user_id = me;
  perform private.mark_verified(me, private.my_session());
  return jsonb_build_object('ok', true);
end;
$$;

-- The same as 0018, and an account with the app turned on is held back too.
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
       and (exists (select 1 from private.two_step t where t.user_id = uid and t.email is not null)
            or exists (select 1 from private.totp a where a.user_id = uid and a.secret is not null))
       and not private.session_verified(uid, sid) then
      claims := jsonb_set(claims, '{role}', '"needs_code"');
    end if;
  exception when others then
    return event;   -- never block a login because of this check
  end;
  return jsonb_build_object('claims', claims);
end;
$$;

-- The same as 0018, plus whether the app ('app') and email codes ('email') are on.
create or replace function public.two_step_state() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t private.two_step;
  has_app boolean;
begin
  if me is null then return jsonb_build_object('on', false, 'needed', false); end if;
  select * into t from private.two_step where user_id = me;
  has_app := exists (select 1 from private.totp a where a.user_id = me and a.secret is not null);
  return jsonb_build_object(
    'on', t.email is not null or has_app,
    'needed', (t.email is not null or has_app) and not private.session_verified(me, private.my_session()),
    'hint', private.email_hint(coalesce(t.email, t.pending_email)),
    'email', t.email is not null,
    'app', has_app
  );
end;
$$;

-- The same as 0018, plus whether the authenticator app is on.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('username', l.username, 'email', private.email_hint(t.email), 'pending_email', private.email_hint(t.pending_email),
    'app', exists (select 1 from private.totp a where a.user_id = l.user_id and a.secret is not null))
  from public.account_logins l left join private.two_step t on t.user_id = l.user_id
  where l.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- staff: a new password for an account
-- For accounts with no email (like ones made on the Admin page): staff set a new password and hand it over.
-- It signs the account out everywhere. Email and app codes stay as they were. Not for other staff accounts.
create or replace function public.admin_set_password(p_user uuid, p_password text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  if p_user = auth.uid() then raise exception 'Change your own password on the You page.'; end if;
  if private.role_of(p_user) = 'admin' then raise exception 'That''s a Frendzy staff account. They can reset their own password by email.'; end if;
  if not exists (select 1 from public.account_logins where user_id = p_user) then raise exception 'That account has no username and password.'; end if;
  perform public.check_new_password(p_password);
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_user;
  begin
    delete from auth.sessions where user_id = p_user;
  exception when undefined_table then null;
  end;
  delete from private.two_step_sessions where user_id = p_user;
  return jsonb_build_object('ok', true, 'username', (select username from public.account_logins where user_id = p_user));
end;
$$;

-- ---------------------------------------------------------------- permissions
revoke all on function private.base32_bytes(text), private.totp_at(text, bigint), private.totp_step(text, text, bigint),
  public.totp_start(), public.totp_confirm(text), public.totp_off(), public.totp_check(text),
  public.two_step_token_hook(jsonb), public.two_step_state(), public.my_account(), public.admin_set_password(uuid, text)
  from public, anon, authenticated;
grant execute on function public.totp_start(), public.totp_confirm(text), public.totp_off(), public.my_account(),
  public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.totp_check(text), public.two_step_state() to authenticated, needs_code;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.two_step_token_hook(jsonb) to supabase_auth_admin';
  end if;
end $$;
