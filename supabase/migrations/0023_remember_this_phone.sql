-- Remember this phone. Once the email code has been typed on a phone, the app can ask for a secret that lets
-- that phone's next logins skip the code for 30 days. The password is still needed every time.
-- The secret lives only on the phone; the database keeps a SHA-256 hash of it (it is 32 random bytes, so a
-- fast hash is enough). Changing the password, or using a recovery code, forgets every remembered phone.
-- Needs 0018. Safe to run more than once.

create table if not exists private.two_step_devices (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists two_step_devices_user on private.two_step_devices (user_id, created_at);
alter table private.two_step_devices enable row level security;
revoke all on private.two_step_devices from public, anon, authenticated;

create or replace function private.device_hash(p_token text) returns text
language sql immutable set search_path = public as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Called on a login that has just had its email code. Returns the secret for the phone to keep.
create or replace function public.two_step_remember_device() returns text
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from private.two_step where user_id = me and email is not null) then return null; end if;
  if not private.session_verified(me, private.my_session()) then raise exception 'Type the code from your email first.'; end if;
  delete from private.two_step_devices where user_id = me and expires_at < now();
  insert into private.two_step_devices (token_hash, user_id, expires_at) values (private.device_hash(token), me, now() + interval '30 days');
  -- At most 10 remembered phones; the oldest are forgotten first.
  delete from private.two_step_devices where token_hash in (
    select token_hash from private.two_step_devices where user_id = me order by created_at desc offset 10);
  return token;
end;
$$;

-- Called on a new login that is waiting for its email code. A remembered phone's secret lets it in instead.
create or replace function public.two_step_use_device(p_token text) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
begin
  if me is null or coalesce(p_token, '') = '' then return false; end if;
  if not exists (select 1 from private.two_step_devices
                 where token_hash = private.device_hash(p_token) and user_id = me and expires_at > now()) then
    return false;
  end if;
  perform private.mark_verified(me, private.my_session());
  return true;
end;
$$;

-- A new password (a password change, or a recovery code) forgets every remembered phone.
create or replace function private.forget_devices_on_password() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    delete from private.two_step_devices where user_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists two_step_forget_devices on auth.users;
create trigger two_step_forget_devices after update of encrypted_password on auth.users
  for each row execute function private.forget_devices_on_password();

revoke all on function private.device_hash(text), public.two_step_remember_device(), public.two_step_use_device(text),
  private.forget_devices_on_password()
  from public, anon, authenticated;
grant execute on function public.two_step_remember_device() to authenticated;
grant execute on function public.two_step_use_device(text) to authenticated, needs_code;
