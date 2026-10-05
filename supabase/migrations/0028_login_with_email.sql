-- Logging in, or using a recovery code, with the confirmed email instead of the username.
-- Supabase Auth only knows the hidden <username>@users.seshon.invalid address (0008), so the app first asks
-- public.email_login_name for the username behind an email. It only answers someone who also has the right
-- password, so it never shows whether an email has an account, or links an email to a username. Wrong tries
-- are limited per email, whether or not the email has an account. recover_account now takes an email too.
-- Needs 0018. Safe to run more than once.

-- Wrong tries, kept for a day. Only a hash of the email is stored here.
create table if not exists private.email_login_attempts (
  email_hash text not null,
  at timestamptz not null default now()
);
create index if not exists email_login_attempts_hash on private.email_login_attempts (email_hash, at);
alter table private.email_login_attempts enable row level security;
revoke all on private.email_login_attempts from public, anon, authenticated;

create index if not exists two_step_email on private.two_step (email);

create or replace function public.email_login_name(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  mail text := lower(btrim(coalesce(p_email, '')));
  key text := encode(extensions.digest(mail, 'sha256'), 'hex');
  r record;
  found_name text;
  tried boolean := false;
begin
  if mail = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'message', 'Enter your email and password.');
  end if;
  delete from private.email_login_attempts where at < now() - interval '1 day';
  if (select count(*) from private.email_login_attempts where email_hash = key and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'message', 'Too many tries for that email. Try again in an hour, or use your username.');
  end if;
  for r in
    select l.username, u.encrypted_password
    from private.two_step t
    join public.account_logins l on l.user_id = t.user_id
    join auth.users u on u.id = t.user_id
    where t.email = mail and u.encrypted_password is not null
    limit 5
  loop
    tried := true;
    if r.encrypted_password = extensions.crypt(p_password, r.encrypted_password) then
      found_name := r.username;
      exit;
    end if;
  end loop;
  -- An email with no account takes as long as one with a wrong password.
  if not tried then
    perform extensions.crypt(p_password, '$2a$10$0123456789012345678901uL3RCLz6lvNkYVBqdFJTWbeHqyZ9Qb6');
  end if;
  if found_name is null then
    insert into private.email_login_attempts (email_hash) values (key);
    return jsonb_build_object('ok', false, 'message', 'That email and password don''t match.');
  end if;
  return jsonb_build_object('ok', true, 'username', found_name);
end;
$$;

-- The same as 0018, except that an email can be given instead of the username.
create or replace function public.recover_account(p_username text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  given text := lower(btrim(coalesce(p_username, '')));
  by_email boolean := position('@' in given) > 0;
  -- Wrong tries are counted against what was typed (a hash, for an email).
  tries_key text := case when position('@' in given) > 0 then 'email:' || encode(extensions.digest(given, 'sha256'), 'hex') else given end;
  uname text;
  l public.account_logins;
  code text := public.new_recovery_code();
  ticket text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform public.check_new_password(p_password);
  delete from public.recovery_attempts where at < now() - interval '1 day';
  if (select count(*) from public.recovery_attempts where username = tries_key) >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Too many tries for that ' || case when by_email then 'email' else 'username' end || '. Try again tomorrow.');
  end if;
  if by_email then
    select a.* into l from private.two_step t join public.account_logins a on a.user_id = t.user_id
    where t.email = given and a.recovery_hash = extensions.crypt(public.recovery_code_key(p_code), a.recovery_hash)
    limit 1;
  else
    select * into l from public.account_logins where username = given
      and recovery_hash = extensions.crypt(public.recovery_code_key(p_code), recovery_hash);
  end if;
  if l.user_id is null then
    insert into public.recovery_attempts (username) values (tries_key);
    return jsonb_build_object('ok', false, 'message', case when by_email then 'That email and recovery code don''t match.' else 'That username and recovery code don''t match.' end);
  end if;
  uname := l.username;

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
  delete from public.recovery_attempts where username = tries_key;
  return jsonb_build_object('ok', true, 'username', uname, 'recovery_code', code, 'ticket', ticket);
end;
$$;

revoke all on function public.email_login_name(text, text), public.recover_account(text, text, text) from public, anon, authenticated;
grant execute on function public.email_login_name(text, text) to anon, authenticated;
grant execute on function public.recover_account(text, text, text) to authenticated;
