-- Amber is private unless you allow it. Friends only see you while you are on green, or on amber if you have turned
-- "Show me to friends on amber" on (You > Safety). It is off for everyone until they choose, and red is never shown.
-- Your own status, your seshes and your photo are not affected: only the colour friends read from public.statuses.
-- It adds one condition to the statuses_read rule from 0011 (api_state reads friends' colours through it).
-- Needs 0011. Safe to run more than once.

create table if not exists private.amber_visible (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  allow boolean not null default false
);
alter table private.amber_visible enable row level security;
revoke all on private.amber_visible from public, anon, authenticated;

-- Has "owner" allowed friends to see them on amber?
create or replace function private.amber_allowed(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((select v.allow from private.amber_visible v where v.user_id = owner), false);
$$;
revoke all on function private.amber_allowed(uuid) from public, anon;
grant execute on function private.amber_allowed(uuid) to authenticated;

create or replace function public.my_amber_visible() returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.amber_allowed(auth.uid());
$$;

create or replace function public.set_amber_visible(p_allow boolean) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  insert into private.amber_visible (user_id, allow) values (me, coalesce(p_allow, false))
  on conflict (user_id) do update set allow = excluded.allow;
  return coalesce(p_allow, false);
end;
$$;
revoke all on function public.my_amber_visible(), public.set_amber_visible(boolean) from public, anon;
grant execute on function public.my_amber_visible(), public.set_amber_visible(boolean) to authenticated;

drop policy if exists statuses_read on public.statuses;
create policy statuses_read on public.statuses for select to authenticated using (
  user_id = auth.uid()
  or (colour <> 'off' and expires_at > now() and public.are_friends(user_id, auth.uid()) and public.i_am_visible()
      and not private.hidden_from_me(user_id)
      and (colour <> 'thinking' or private.amber_allowed(user_id)))
);

