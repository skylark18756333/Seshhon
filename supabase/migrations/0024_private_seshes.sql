-- Private seshes. Starting a sesh can now be private: only the friends picked for it (and the person who
-- started it) can see it, see who is in it, or join it. Everyone else sees nothing, not even that it exists.
-- The person who started it can invite more friends later. An ordinary sesh works exactly as before.
-- Invites are deleted with the sesh. Needs 0011. Safe to run more than once.

alter table public.seshes add column if not exists private boolean not null default false;

create table if not exists public.sesh_invites (
  sesh_id uuid not null references public.seshes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (sesh_id, user_id)
);
create index if not exists sesh_invites_user on public.sesh_invites (user_id);
alter table public.sesh_invites enable row level security;   -- no policies: only the functions below use it
revoke all on public.sesh_invites from public, anon, authenticated;

-- True when the sesh is private and the person asking was not picked for it (and did not start it).
create or replace function private.sesh_closed_to_me(p_sesh uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((
    select x.private and x.creator <> auth.uid()
       and not exists (select 1 from public.sesh_invites i where i.sesh_id = x.id and i.user_id = auth.uid())
    from public.seshes x where x.id = p_sesh), false);
$$;
revoke all on function private.sesh_closed_to_me(uuid) from public, anon;
grant execute on function private.sesh_closed_to_me(uuid) to authenticated;

-- Who was picked for a private sesh, only for the person who started it (null for anyone else).
create or replace function private.sesh_invited(p_sesh uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when x.private and x.creator = auth.uid() then coalesce((
    select jsonb_agg(i.user_id) from public.sesh_invites i where i.sesh_id = x.id), '[]'::jsonb) end
  from public.seshes x where x.id = p_sesh;
$$;
revoke all on function private.sesh_invited(uuid) from public, anon;
grant execute on function private.sesh_invited(uuid) to authenticated;

-- ---------------------------------------------------------------- access rules
-- Same as 0011, plus "not a private sesh I wasn't picked for" for friends who aren't in it.
drop policy if exists seshes_read on public.seshes;
create policy seshes_read on public.seshes for select to authenticated using (
  creator = auth.uid() or public.is_sesh_member(id, auth.uid())
  or (public.are_friends(creator, auth.uid()) and public.i_am_visible() and not private.hidden_from_me(creator)
      and not private.sesh_closed_to_me(id))
);

drop policy if exists members_read on public.sesh_members;
create policy members_read on public.sesh_members for select to authenticated using (
  user_id = auth.uid() or public.is_sesh_member(sesh_id, auth.uid())
  or (public.are_friends(public.sesh_creator(sesh_id), auth.uid()) and public.i_am_visible()
      and not private.hidden_from_me(public.sesh_creator(sesh_id)) and not private.sesh_closed_to_me(sesh_id))
);

drop policy if exists members_join on public.sesh_members;
create policy members_join on public.sesh_members for insert to authenticated with check (
  user_id = auth.uid()
  and (public.sesh_creator(sesh_id) = auth.uid()
       or (public.are_friends(public.sesh_creator(sesh_id), auth.uid()) and not private.hidden_from_me(public.sesh_creator(sesh_id))
           and not private.sesh_closed_to_me(sesh_id)))
);

-- ---------------------------------------------------------------- starting and inviting
-- Adds the picked friends to a private sesh. Only accepted friends count; anyone else is skipped.
create or replace function private.invite_friends(p_sesh uuid, p_friends uuid[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer;
begin
  insert into public.sesh_invites (sesh_id, user_id)
  select p_sesh, f from (select distinct unnest(coalesce(p_friends, '{}'::uuid[])) as f) x
  where f <> auth.uid() and public.are_friends(f, auth.uid())
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.start_private_sesh(p_friends uuid[]) returns public.seshes
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  s public.seshes;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.statuses where user_id = me and colour = 'on' and expires_at > now()) then
    raise exception 'You need to be On to start a sesh.';
  end if;
  if exists (select 1 from public.seshes where creator = me and ended_at is null and created_at > now() - interval '8 hours') then
    raise exception 'You already have a sesh going. End it first to start a private one.';
  end if;
  if coalesce(array_length(p_friends, 1), 0) = 0 then raise exception 'Pick at least one friend.'; end if;
  if coalesce(array_length(p_friends, 1), 0) > 50 then raise exception 'Pick up to 50 friends.'; end if;
  insert into public.seshes (creator, private) values (me, true) returning * into s;
  insert into public.sesh_members (sesh_id, user_id) values (s.id, me);
  if private.invite_friends(s.id, p_friends) = 0 then raise exception 'Pick at least one friend.'; end if;
  return s;
end;
$$;

-- The person who started a private sesh can invite more friends while it is on.
create or replace function public.invite_to_sesh(p_sesh uuid, p_friends uuid[]) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n integer;
begin
  if not exists (select 1 from public.seshes where id = p_sesh and creator = auth.uid() and private
                 and ended_at is null and created_at > now() - interval '8 hours') then
    raise exception 'Only the person who started a private sesh can invite people to it.';
  end if;
  if coalesce(array_length(p_friends, 1), 0) > 50 then raise exception 'Pick up to 50 friends.'; end if;
  n := private.invite_friends(p_sesh, p_friends);
  return jsonb_build_object('ok', true, 'invited', n);
end;
$$;

revoke all on function private.invite_friends(uuid, uuid[]), public.start_private_sesh(uuid[]), public.invite_to_sesh(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.start_private_sesh(uuid[]), public.invite_to_sesh(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------- app state
-- Same as 0014, plus whether each sesh is private and, for the person who started it, who was picked.
create or replace function public.api_state() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'night', public.night_of(),
    'me', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'invite_code', p.invite_code,
        'colour', coalesce((select s.colour::text from public.statuses s where s.user_id = p.id and s.colour <> 'off' and s.expires_at > now()), 'off'),
        'expires_at', (select s.expires_at from public.statuses s where s.user_id = p.id and s.colour <> 'off' and s.expires_at > now())
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'friends', coalesce((
      select jsonb_agg(
        jsonb_build_object('friendship', f.id, 'id', p.id, 'name', p.name, 'colour', coalesce(s.colour::text, 'off'), 'since', s.updated_at)
        order by case coalesce(s.colour::text, 'off') when 'on' then 0 when 'thinking' then 1 else 2 end, p.name
      )
      from public.friendships f
      join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
      left join public.statuses s on s.user_id = p.id
      where f.state = 'accepted'
    ), '[]'::jsonb),
    'requests_in', coalesce((
      select jsonb_agg(jsonb_build_object('friendship', f.id, 'name', p.name) order by f.created_at)
      from public.friendships f join public.profiles p on p.id = f.requester
      where f.state = 'requested' and f.addressee = auth.uid()
    ), '[]'::jsonb),
    'requests_out', coalesce((
      select jsonb_agg(jsonb_build_object('friendship', f.id, 'name', p.name) order by f.created_at)
      from public.friendships f join public.profiles p on p.id = f.addressee
      where f.state = 'requested' and f.requester = auth.uid()
    ), '[]'::jsonb),
    'seshes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'mine', s.creator = auth.uid(),
          'creator_name', (select p.name from public.profiles p where p.id = s.creator),
          'locked_venue', s.locked_venue,
          'private', s.private,
          'invited', private.sesh_invited(s.id),
          'am_member', public.is_sesh_member(s.id, auth.uid()),
          'members', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', p.name) order by m.joined_at)
            from public.sesh_members m left join public.profiles p on p.id = m.user_id
            where m.sesh_id = s.id
          ), '[]'::jsonb),
          'votes', coalesce((
            select jsonb_agg(jsonb_build_object('user_id', v.user_id, 'venue_id', v.venue_id, 'voted_at', v.voted_at))
            from public.venue_votes v where v.sesh_id = s.id
          ), '[]'::jsonb)
        )
        order by s.created_at desc
      )
      from public.seshes s
      where s.ended_at is null and s.created_at > now() - interval '8 hours'
    ), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id, 'venue_id', d.venue_id, 'type', d.type, 'title', d.title, 'is_alcohol', d.is_alcohol,
          'start_time', to_char(d.start_time, 'HH24:MI'), 'end_time', to_char(d.end_time, 'HH24:MI'),
          'running', public.deal_is_running(d),
          'used', coalesce(r.confirmed_at is not null, false),
          'code', case when r.confirmed_at is null and r.expires_at > now() then r.code end,
          'code_expires_at', case when r.confirmed_at is null and r.expires_at > now() then r.expires_at end
        )
        order by d.start_time, d.title
      )
      from public.deals d
      left join public.redemptions r on r.deal_id = d.id and r.user_id = auth.uid() and r.night = public.night_of()
      where d.active
    ), '[]'::jsonb),
    'staff_venues', coalesce((
      select jsonb_agg(vs.venue_id) from public.venue_staff vs where vs.user_id = auth.uid()
    ), '[]'::jsonb),
    'blocked', public.blocked_list()
  );
$$;
