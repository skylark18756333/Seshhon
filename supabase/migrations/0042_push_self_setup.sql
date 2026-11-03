-- 0042: push notifications set themselves up, so nobody has to copy a secret between the dashboard and the SQL editor.
--
-- Before this, the "push" Edge Function only ran once someone had (1) saved a PUSH_SECRET in Edge Function secrets and
-- (2) run private.set_push_config() with the same text. Neither was ever done, so nothing could be sent.
-- Now the database makes its own random secret (nobody ever sees it), stores it with the function's address in
-- private.push_config, and the function checks the secret it is sent against the database (push_secret_ok, service
-- role only). A PUSH_SECRET in Edge Function secrets still works if one is ever set, but is no longer needed.

create or replace function public.push_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.push_config c where c.secret is not null and length(c.secret) >= 16 and c.secret = p_secret);
$$;
revoke all on function public.push_secret_ok(text) from public, anon, authenticated;
grant execute on function public.push_secret_ok(text) to service_role;

-- The address of the "push" function on this project, and a fresh random secret, unless a config is already there.
do $$
begin
  if not exists (select 1 from private.push_config where url is not null and secret is not null) then
    perform private.set_push_config(
      'https://xfwrhetohauzhqqhkibm.supabase.co/functions/v1/push',
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    );
  end if;
end $$;

insert into private.migration_log (file) values ('0042_push_self_setup');
