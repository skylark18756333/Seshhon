-- Forgot your password? Email me a code. Someone who has lost both their password and their recovery code
-- types their confirmed email, gets a 6-digit code there (sent by the email-code Edge Function), and picks
-- a new password with it. Only a bcrypt hash of each code is stored, and the answer never shows whether an
-- email has an account. Codes last 15 minutes and stop after 5 wrong tries. Each email gets at most 3 codes
-- an hour and 10 a day, and at most 10 wrong codes a day, whether or not it has an account.
-- Like a recovery code (0018/0028), a new password signs the account out everywhere, forgets remembered
-- phones (0023), and lets the next login skip the email code once (it was just proved).
-- Needs 0018 and 0028. Safe to run more than once.

create table if not exists private.reset_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  expires timestamptz not null,
  tries integer not null default 0
);
alter table private.reset_codes enable row level security;
revoke all on private.reset_codes from public, anon, authenticated;

-- Codes asked for, by a hash of the email typed. Kept for a day.
create table if not exists private.reset_sends (
  email_hash text not null,
  at timestamptz not null default now()
);
create index if not exists reset_sends_hash on private.reset_sends (email_hash, at);
alter table private.reset_sends enable row level security;
revoke all on private.reset_sends from public, anon, authenticated;

-- Makes a reset code for each account whose confirmed email is p_email (usually one). Only the email-code
-- Edge Function calls this, with the service key. An email with no account gives an empty list.
create or replace function public.reset_make_code(p_email text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  mail text := lower(btrim(coalesce(p_email, '')));
  key text := encode(extensions.digest(mail, 'sha256'), 'hex');
  r record;
  code text;
  sends jsonb := '[]'::jsonb;
begin
  if mail !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(mail) > 254 then raise exception 'Enter a real email address.'; end if;
  delete from private.reset_sends where at < now() - interval '1 day';
  if (select count(*) from private.reset_sends where email_hash = key and at > now() - interval '1 hour') >= 3
     or (select count(*) from private.reset_sends where email_hash = key) >= 10 then
    raise exception 'Too many codes for that email. Wait a while, then try again.';
  end if;
  insert into private.reset_sends (email_hash) values (key);
  for r in
    select t.user_id, l.username from private.two_step t join public.account_logins l on l.user_id = t.user_id
    where t.email = mail order by l.username limit 5
  loop
    code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
    insert into private.reset_codes (user_id, code_hash, expires, tries)
    values (r.user_id, extensions.crypt(code, extensions.gen_salt('bf', 8)), now() + interval '15 minutes', 0)
    on conflict (user_id) do update set code_hash = excluded.code_hash, expires = excluded.expires, tries = 0;
    sends := sends || jsonb_build_object('email', mail, 'code', code, 'username', r.username);
  end loop;
  return jsonb_build_object('sends', sends);
end;
$$;

-- The email, the code from it, and a new password. Called from the app's temporary sign-in, like recover_account.
create or replace function public.reset_password(p_email text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  mail text := lower(btrim(coalesce(p_email, '')));
  tries_key text := 'reset:' || encode(extensions.digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex');
  typed text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  ticket text := encode(extensions.gen_random_bytes(18), 'hex');
  uid uuid;
  uname text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform public.check_new_password(p_password);
  delete from public.recovery_attempts where at < now() - interval '1 day';
  if (select count(*) from public.recovery_attempts where username = tries_key) >= 10 then
    return jsonb_build_object('ok', false, 'message', 'Too many tries for that email. Try again tomorrow.');
  end if;
  select c.user_id, l.username into uid, uname
  from private.two_step t
  join private.reset_codes c on c.user_id = t.user_id
  join public.account_logins l on l.user_id = t.user_id
  where t.email = mail and c.expires > now() and c.tries < 5 and length(typed) = 6
    and c.code_hash = extensions.crypt(typed, c.code_hash)
  limit 1;
  if uid is null then
    insert into public.recovery_attempts (username) values (tries_key);
    update private.reset_codes c set tries = c.tries + 1
    from private.two_step t where t.user_id = c.user_id and t.email = mail;
    return jsonb_build_object('ok', false, 'message', 'That code isn''t right, or it has run out. Check the email, or send a new code.');
  end if;

  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = uid;
  -- Sign the account out everywhere else, in case someone else had it.
  begin
    delete from auth.sessions where user_id = uid;
  exception when undefined_table then null;
  end;
  delete from private.two_step_sessions where user_id = uid;
  update private.two_step set ticket_hash = extensions.crypt(ticket, extensions.gen_salt('bf', 8)), ticket_expires = now() + interval '15 minutes'
  where user_id = uid;
  delete from private.reset_codes where user_id = uid;
  delete from public.recovery_attempts where username = tries_key;
  return jsonb_build_object('ok', true, 'username', uname, 'ticket', ticket);
end;
$$;

revoke all on function public.reset_make_code(text), public.reset_password(text, text, text) from public, anon, authenticated;
grant execute on function public.reset_make_code(text) to service_role;
grant execute on function public.reset_password(text, text, text) to authenticated;
