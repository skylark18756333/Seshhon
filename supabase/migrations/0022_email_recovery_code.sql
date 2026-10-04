-- Email the recovery code as well as showing it. When a recovery code is made (at sign up, on a password
-- change, or after using the old one) and the account has a confirmed email, the app asks the email-code
-- Edge Function to send it there. The code itself is still never stored: the app passes it to the
-- function, and this check only lets it through if it matches the account's current recovery code.
-- Needs 0018. Safe to run more than once.

-- Only the email-code Edge Function calls this (with the service key). p_user is whoever is signed in
-- (after a recovery, that is a temporary sign-in on the new phone). Returns the address to send to.
create or replace function public.two_step_recovery_target(p_user uuid, p_username text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  l public.account_logins;
  mail text;
begin
  if p_user is null then raise exception 'Sign in first.'; end if;
  select * into l from public.account_logins where username = lower(btrim(coalesce(p_username, '')));
  if not found or l.recovery_hash <> extensions.crypt(public.recovery_code_key(p_code), l.recovery_hash) then
    raise exception 'That recovery code is not the current one.';
  end if;
  select email into mail from private.two_step where user_id = l.user_id;
  if mail is null then raise exception 'Confirm your email first.'; end if;

  delete from private.two_step_sends where at < now() - interval '1 day';
  if (select count(*) from private.two_step_sends where user_id = l.user_id and at > now() - interval '1 hour') >= 5
     or (select count(*) from private.two_step_sends where user_id = l.user_id) >= 20 then
    raise exception 'Too many emails sent. Wait a while, then try again.';
  end if;
  insert into private.two_step_sends (user_id) values (l.user_id);
  return jsonb_build_object('email', mail);
end;
$$;

revoke all on function public.two_step_recovery_target(uuid, text, text) from public, anon, authenticated;
grant execute on function public.two_step_recovery_target(uuid, text, text) to service_role;
