-- Hide my status from some friends (for example family or an ex) while staying friends with them.
-- A hidden friend always sees you as red: you never show in their "Up for it now", and they can't see
-- or join seshes you start. They are not told, and nothing else changes: your photo, your name in their
-- friends list and seshes someone else runs stay as they were.
-- It works by adding "has this person hidden their status from me?" to private.hidden_from_me(), which
-- every status and sesh rule already asks (0011, 0024, 0025). Needs 0012 and 0013. Safe to run more than once.

create table if not exists private.status_hides (
  owner uuid not null references public.profiles (id) on delete cascade,
  viewer uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, viewer)
);
alter table private.status_hides enable row level security;
revoke all on private.status_hides from public, anon, authenticated;

-- Women-only mode on its own: the body hidden_from_me() had in 0012.
create or replace function private.women_only_hidden(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    owner <> auth.uid()
    and exists (select 1 from private.safety s where s.user_id = owner and s.women_only)
    and not private.in_safe_group(auth.uid()),
    false);
$$;
revoke all on function private.women_only_hidden(uuid) from public, anon;
grant execute on function private.women_only_hidden(uuid) to authenticated;

create or replace function private.hidden_from_me(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.women_only_hidden(owner)
    or exists (select 1 from private.status_hides h where h.owner = hidden_from_me.owner and h.viewer = auth.uid());
$$;

-- Photos keep following women-only mode only, so a hidden friend still sees your photo and can't tell.
create or replace function public.photo_hidden_from_me(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.women_only_hidden(owner);
$$;
revoke all on function public.photo_hidden_from_me(uuid) from public, anon, authenticated;

-- The friends you've hidden your status from, oldest first. Only ever your own list.
create or replace function public.my_status_hides() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce((select jsonb_agg(h.viewer order by h.created_at) from private.status_hides h where h.owner = auth.uid()), '[]'::jsonb);
$$;

-- Hide (true) or show (false) your status to one friend. Only accepted friends can be hidden.
create or replace function public.set_status_hidden(p_friend uuid, p_hidden boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if coalesce(p_hidden, false) then
    if p_friend is null or p_friend = me or not public.are_friends(p_friend, me) then
      raise exception 'You can only hide your status from a friend.';
    end if;
    insert into private.status_hides (owner, viewer) values (me, p_friend) on conflict do nothing;
  else
    delete from private.status_hides where owner = me and viewer = p_friend;
  end if;
  return public.my_status_hides();
end;
$$;
revoke all on function public.my_status_hides(), public.set_status_hidden(uuid, boolean) from public, anon;
grant execute on function public.my_status_hides(), public.set_status_hidden(uuid, boolean) to authenticated;

-- No longer friends: forget any hiding between the two, so nothing is kept that isn't needed.
create or replace function private.forget_status_hides() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.status_hides
  where (owner = old.requester and viewer = old.addressee) or (owner = old.addressee and viewer = old.requester);
  return old;
end;
$$;
revoke all on function private.forget_status_hides() from public, anon, authenticated;
drop trigger if exists friendships_forget_hides on public.friendships;
create trigger friendships_forget_hides after delete on public.friendships
for each row execute function private.forget_status_hides();
