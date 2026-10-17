-- Amber is private unless you allow it, friend by friend. A friend sees you on green. They see you on amber only if you
-- have switched "can see me on amber" on for that friend (You > Your friends). Nobody is allowed until you choose, and red is
-- never shown. Your own status, your seshes and your photo are not affected: only the colour friends read from public.statuses.
-- It adds one condition to the statuses_read rule (0011), which api_state reads friends' colours through.
-- Needs 0011. Safe to run more than once.

create table if not exists private.amber_allows (
  owner uuid not null references public.profiles (id) on delete cascade,
  viewer uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, viewer)
);
alter table private.amber_allows enable row level security;
revoke all on private.amber_allows from public, anon, authenticated;

-- Has "owner" allowed the person asking (the signed-in user) to see them on amber?
create or replace function private.amber_allowed(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.amber_allows a where a.owner = amber_allowed.owner and a.viewer = auth.uid());
$$;
revoke all on function private.amber_allowed(uuid) from public, anon;
grant execute on function private.amber_allowed(uuid) to authenticated;

-- The friends you let see you on amber. Only ever your own list.
create or replace function public.my_amber_allows() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce((select jsonb_agg(a.viewer order by a.created_at) from private.amber_allows a where a.owner = auth.uid()), '[]'::jsonb);
$$;

-- Let one friend see you on amber (true) or not (false). Only accepted friends.
create or replace function public.set_amber_allowed(p_friend uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if coalesce(p_allow, false) then
    if p_friend is null or p_friend = me or not public.are_friends(p_friend, me) then
      raise exception 'You can only allow a friend.';
    end if;
    insert into private.amber_allows (owner, viewer) values (me, p_friend) on conflict do nothing;
  else
    delete from private.amber_allows where owner = me and viewer = p_friend;
  end if;
  return public.my_amber_allows();
end;
$$;
revoke all on function public.my_amber_allows(), public.set_amber_allowed(uuid, boolean) from public, anon;
grant execute on function public.my_amber_allows(), public.set_amber_allowed(uuid, boolean) to authenticated;

-- No longer friends: forget the allowance between the two.
create or replace function private.forget_amber_allows() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.amber_allows
  where (owner = old.requester and viewer = old.addressee) or (owner = old.addressee and viewer = old.requester);
  return old;
end;
$$;
revoke all on function private.forget_amber_allows() from public, anon, authenticated;
drop trigger if exists friendships_forget_amber on public.friendships;
create trigger friendships_forget_amber after delete on public.friendships
for each row execute function private.forget_amber_allows();

drop policy if exists statuses_read on public.statuses;
create policy statuses_read on public.statuses for select to authenticated using (
  user_id = auth.uid()
  or (colour <> 'off' and expires_at > now() and public.are_friends(user_id, auth.uid()) and public.i_am_visible()
      and not private.hidden_from_me(user_id)
      and (colour <> 'thinking' or private.amber_allowed(user_id)))
);
