-- Women-only mode and easier blocking.
--
-- Anyone can tell SeshOn their gender. It is optional, private, and never shown to anyone:
-- not to friends, not in a sesh, not in the app state of anyone else. It lives in its own
-- table in a "private" schema that the app's API cannot read at all.
--
-- A woman can switch on women-only mode. While it is on, people who have not told SeshOn they
-- are a woman cannot:
--   - see her green or amber status (to them she just looks red),
--   - send her a friend request from her invite link,
--   - see, join or chat in a sesh she started.
-- Turning it on also drops pending friend requests to her from those people, and takes them
-- out of a sesh she is running. Seshes started by someone else are that person's sesh: if she
-- joins one, the people in it can see her name there.
--
-- Also adds block_request(), so a friend request can be blocked without accepting it first.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.safety (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  gender text check (gender in ('woman', 'man', 'nonbinary')),
  women_only boolean not null default false,
  updated_at timestamptz not null default now(),
  check (not women_only or gender = 'woman')
);
alter table private.safety enable row level security;
revoke all on private.safety from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- True when the person asking should not see "owner" because owner is in women-only mode and
-- the person asking has not said they are a woman. It lives in the private schema, so the app
-- cannot call it directly to test other people; only the access rules below use it.
create or replace function private.hidden_from_me(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    owner <> auth.uid()
    and exists (select 1 from private.safety s where s.user_id = owner and s.women_only)
    and not exists (select 1 from private.safety s where s.user_id = auth.uid() and s.gender = 'woman'),
    false);
$$;
revoke all on function private.hidden_from_me(uuid) from public, anon;
grant execute on function private.hidden_from_me(uuid) to authenticated;

-- ---------------------------------------------------------------- access rules
-- Same rules as 0002, plus "not hidden from me".

drop policy if exists statuses_read on public.statuses;
create policy statuses_read on public.statuses for select to authenticated using (
  user_id = auth.uid()
  or (colour <> 'off' and expires_at > now() and public.are_friends(user_id, auth.uid()) and public.i_am_visible()
      and not private.hidden_from_me(user_id))
);

drop policy if exists seshes_read on public.seshes;
create policy seshes_read on public.seshes for select to authenticated using (
  creator = auth.uid() or public.is_sesh_member(id, auth.uid())
  or (public.are_friends(creator, auth.uid()) and public.i_am_visible() and not private.hidden_from_me(creator))
);

drop policy if exists members_read on public.sesh_members;
create policy members_read on public.sesh_members for select to authenticated using (
  user_id = auth.uid() or public.is_sesh_member(sesh_id, auth.uid())
  or (public.are_friends(public.sesh_creator(sesh_id), auth.uid()) and public.i_am_visible()
      and not private.hidden_from_me(public.sesh_creator(sesh_id)))
);

drop policy if exists members_join on public.sesh_members;
create policy members_join on public.sesh_members for insert to authenticated with check (
  user_id = auth.uid()
  and (public.sesh_creator(sesh_id) = auth.uid()
       or (public.are_friends(public.sesh_creator(sesh_id), auth.uid()) and not private.hidden_from_me(public.sesh_creator(sesh_id))))
);

-- ---------------------------------------------------------------- invite links
-- Same as 0002, but a new request to someone in women-only mode from someone who has not said
-- they are a woman gets the same answer as a bad link, so it does not give her gender away.
create or replace function public.request_friend(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other public.profiles;
  f public.friendships;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  select * into other from public.profiles where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'That invite link is not valid.'; end if;
  if other.id = me then raise exception 'That is your own invite link.'; end if;

  select * into f from public.friendships
  where (requester = me and addressee = other.id) or (requester = other.id and addressee = me);
  if found then
    if f.state = 'blocked' then raise exception 'That invite link is not valid.'; end if;
    if f.state = 'requested' and f.addressee = me then
      update public.friendships set state = 'accepted' where id = f.id;
      return jsonb_build_object('name', other.name, 'state', 'accepted');
    end if;
    return jsonb_build_object('name', other.name, 'state', f.state);
  end if;

  if private.hidden_from_me(other.id) then raise exception 'That invite link is not valid.'; end if;
  insert into public.friendships (requester, addressee) values (me, other.id);
  return jsonb_build_object('name', other.name, 'state', 'requested');
end;
$$;

-- ---------------------------------------------------------------- your own settings

-- Your gender (or null) and whether women-only mode is on. Only ever about the person asking.
create or replace function public.my_safety() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select jsonb_build_object('gender', s.gender, 'women_only', s.women_only) from private.safety s where s.user_id = auth.uid()),
    jsonb_build_object('gender', null, 'women_only', false));
$$;

-- p_gender: 'woman', 'man', 'nonbinary', or null / '' to not say.
create or replace function public.set_safety(p_gender text, p_women_only boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  g text := nullif(btrim(coalesce(p_gender, '')), '');
  wo boolean := coalesce(p_women_only, false);
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  if g is not null and g not in ('woman', 'man', 'nonbinary') then raise exception 'Pick one of the options, or leave it blank.'; end if;
  if wo and g is distinct from 'woman' then raise exception 'Women-only mode is for women.'; end if;

  -- Keep nothing when there is nothing to keep.
  if g is null and not wo then
    delete from private.safety where user_id = me;
    return public.my_safety();
  end if;

  insert into private.safety (user_id, gender, women_only, updated_at) values (me, g, wo, now())
  on conflict (user_id) do update set gender = excluded.gender, women_only = excluded.women_only, updated_at = now();

  if wo then
    -- Pending requests to her from people who have not said they are a woman.
    delete from public.friendships f
    where f.addressee = me and f.state = 'requested'
      and not exists (select 1 from private.safety s where s.user_id = f.requester and s.gender = 'woman');
    -- The same people leave any sesh she is running.
    delete from public.venue_votes v
    using public.seshes x
    where v.sesh_id = x.id and x.creator = me and x.ended_at is null and v.user_id <> me
      and not exists (select 1 from private.safety s where s.user_id = v.user_id and s.gender = 'woman');
    delete from public.sesh_members m
    using public.seshes x
    where m.sesh_id = x.id and x.creator = me and x.ended_at is null and m.user_id <> me
      and not exists (select 1 from private.safety s where s.user_id = m.user_id and s.gender = 'woman');
  end if;
  return public.my_safety();
end;
$$;

-- ---------------------------------------------------------------- block a request
-- Block the other person in a friend request (to you or from you) or a friendship.
create or replace function public.block_request(p_friendship uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select case when requester = me then addressee else requester end into other
  from public.friendships
  where id = p_friendship and (requester = me or addressee = me) and state <> 'blocked';
  if other is null then raise exception 'That request is no longer there.'; end if;
  return public.block_user(other);
end;
$$;

revoke all on function public.my_safety(), public.set_safety(text, boolean), public.block_request(uuid) from public, anon;
grant execute on function public.my_safety(), public.set_safety(text, boolean), public.block_request(uuid) to authenticated;
