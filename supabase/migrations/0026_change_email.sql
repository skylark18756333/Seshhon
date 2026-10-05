-- Changing the login email. The new address is confirmed with a 6-digit code in the same way as the first
-- one (0018 already allows that from a login that has had its code). Once it's confirmed, the app makes a
-- fresh recovery code with this function and emails a copy to the new address (0022), because the old
-- code was only ever stored as a hash and can't be sent again. The old code stops working.
-- Needs 0018. Safe to run more than once.

create or replace function public.renew_recovery_code() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  uname text;
  code text := public.new_recovery_code();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select username into uname from public.account_logins where user_id = me;
  if uname is null then raise exception 'Save a username and password first.'; end if;
  if exists (select 1 from private.two_step where user_id = me and email is not null)
     and not private.session_verified(me, private.my_session()) then
    raise exception 'Type the code from your email first.';
  end if;
  update public.account_logins
  set recovery_hash = extensions.crypt(public.recovery_code_key(code), extensions.gen_salt('bf', 8)), updated_at = now()
  where user_id = me;
  return jsonb_build_object('username', uname, 'recovery_code', code);
end;
$$;

revoke all on function public.renew_recovery_code() from public, anon, authenticated;
grant execute on function public.renew_recovery_code() to authenticated;
