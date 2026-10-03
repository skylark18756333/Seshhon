-- Seshhon database, second step: everything the live web app needs.
-- Adds invite links, a single "give me everything" call for the app, and the
-- remaining actions (join, vote, end a sesh, rate, delete account).

-- ---------------------------------------------------------------- invite codes
-- Eight characters from an alphabet with no look-alikes (no I, L, O, 0 or 1).
create function public.new_invite_code() returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

alter table public.profiles add column invite_code text;
update public.profiles set invite_code = public.new_invite_code() where invite_code is null;
alter table public.profiles alter column invite_code set default public.new_invite_code();
alter table public.profiles alter column invite_code set not null;
alter table public.profiles add constraint profiles_invite_code_unique unique (invite_code);

-- Example venues are marked so the app can label them as examples.
alter table public.venues add column is_example boolean not null default false;

-- ---------------------------------------------------------------- tighter helpers
-- The helpers only answer questions about the person asking, so nobody can use
-- them to check on two other people.

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (auth.uid() = a or auth.uid() = b) and exists (
    select 1 from public.friendships f
    where f.state = 'accepted'
      and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
  );
$$;

create or replace function public.is_sesh_member(s uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = u and exists (select 1 from public.sesh_members m where m.sesh_id = s and m.user_id = u);
$$;

create or replace function public.is_venue_staff(v uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = u and exists (select 1 from public.venue_staff vs where vs.venue_id = v and vs.user_id = u);
$$;

-- True when the person asking (b) is in a live sesh with a.
create function public.shares_sesh(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = b and exists (
    select 1
    from public.sesh_members m1
    join public.sesh_members m2 on m2.sesh_id = m1.sesh_id
    join public.seshes s on s.id = m1.sesh_id
    where m1.user_id = a and m2.user_id = b
      and s.ended_at is null and s.created_at > now() - interval '8 hours'
  );
$$;

-- True while the person asking is On or Thinking.
create function public.i_am_visible() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.statuses s
    where s.user_id = auth.uid() and s.colour <> 'off' and s.expires_at > now()
  );
$$;

-- Fair's fair: while you are Off you cannot see who else is On, or their seshes.
drop policy statuses_read on public.statuses;
create policy statuses_read on public.statuses for select to authenticated using (
  user_id = auth.uid()
  or (colour <> 'off' and expires_at > now() and public.are_friends(user_id, auth.uid()) and public.i_am_visible())
);

drop policy seshes_read on public.seshes;
create policy seshes_read on public.seshes for select to authenticated using (
  creator = auth.uid() or public.is_sesh_member(id, auth.uid())
  or (public.are_friends(creator, auth.uid()) and public.i_am_visible())
);

drop policy members_read on public.sesh_members;
create policy members_read on public.sesh_members for select to authenticated using (
  user_id = auth.uid() or public.is_sesh_member(sesh_id, auth.uid())
  or (public.are_friends(public.sesh_creator(sesh_id), auth.uid()) and public.i_am_visible())
);

-- People in the same live sesh can see each other's name.
create policy profiles_read_sesh on public.profiles for select to authenticated
  using (public.shares_sesh(id, auth.uid()));

-- The person who started a sesh can rejoin it after leaving.
drop policy members_join on public.sesh_members;
create policy members_join on public.sesh_members for insert to authenticated with check (
  user_id = auth.uid()
  and (public.sesh_creator(sesh_id) = auth.uid() or public.are_friends(public.sesh_creator(sesh_id), auth.uid()))
);

-- ---------------------------------------------------------------- sign-up and friends

create function public.api_sign_up(p_name text, p_adult boolean) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_adult is not true then raise exception 'Seshhon is for people aged 18 and over.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 24 then
    raise exception 'Enter a first name of up to 24 characters.';
  end if;
  insert into public.profiles (id, name, adult_confirmed_at)
  values (auth.uid(), btrim(p_name), now())
  on conflict (id) do update set name = excluded.name;
  return '{}'::jsonb;
end;
$$;

-- Opening someone's invite link sends them a friend request. They still have to accept,
-- unless they had already asked you, in which case you are now friends.
create function public.request_friend(p_code text) returns jsonb
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

  insert into public.friendships (requester, addressee) values (me, other.id);
  return jsonb_build_object('name', other.name, 'state', 'requested');
end;
$$;

-- Accept a request, or (with p_accept false) decline it, cancel it, or remove a friend.
create function public.answer_friend(p_friendship uuid, p_accept boolean) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if p_accept then
    update public.friendships set state = 'accepted'
    where id = p_friendship and addressee = auth.uid() and state = 'requested';
    if not found then raise exception 'That request is no longer there.'; end if;
  else
    delete from public.friendships
    where id = p_friendship and (requester = auth.uid() or addressee = auth.uid());
  end if;
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------- sesh actions

-- Starting a second sesh returns the one you already have running.
create or replace function public.start_sesh() returns public.seshes
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.seshes;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.statuses where user_id = me and colour = 'on' and expires_at > now()) then
    raise exception 'You need to be On to start a sesh.';
  end if;
  select * into s from public.seshes
  where creator = me and ended_at is null and created_at > now() - interval '8 hours'
  order by created_at desc limit 1;
  if found then
    insert into public.sesh_members (sesh_id, user_id) values (s.id, me) on conflict do nothing;
    return s;
  end if;
  insert into public.seshes (creator) values (me) returning * into s;
  insert into public.sesh_members (sesh_id, user_id) values (s.id, me);
  return s;
end;
$$;

create function public.join_sesh(p_sesh uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (
    select 1 from public.seshes
    where id = p_sesh and ended_at is null and created_at > now() - interval '8 hours'
  ) then
    raise exception 'That sesh has ended.';
  end if;
  insert into public.sesh_members (sesh_id, user_id) values (p_sesh, auth.uid()) on conflict do nothing;
  return '{}'::jsonb;
end;
$$;

create function public.leave_sesh(p_sesh uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.venue_votes where sesh_id = p_sesh and user_id = auth.uid();
  delete from public.sesh_members where sesh_id = p_sesh and user_id = auth.uid();
  return '{}'::jsonb;
end;
$$;

-- Vote for a venue, change your vote, or (with p_venue null) take it back.
create function public.cast_vote(p_sesh uuid, p_venue uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (
    select 1 from public.seshes
    where id = p_sesh and ended_at is null and locked_venue is null and created_at > now() - interval '8 hours'
  ) then
    raise exception 'Voting has closed for that sesh.';
  end if;
  if p_venue is null then
    delete from public.venue_votes where sesh_id = p_sesh and user_id = auth.uid();
  else
    insert into public.venue_votes (sesh_id, user_id, venue_id) values (p_sesh, auth.uid(), p_venue)
    on conflict (sesh_id, user_id) do update set venue_id = excluded.venue_id, voted_at = now();
  end if;
  return '{}'::jsonb;
end;
$$;

create function public.end_sesh(p_sesh uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  update public.seshes set ended_at = now() where id = p_sesh and creator = auth.uid();
  if not found then raise exception 'Only the person who started the sesh can end it.'; end if;
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------- ratings and account

create function public.rate_venue(p_venue uuid, p_stars integer, p_tags text[]) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  tags text[] := coalesce(p_tags, '{}');
begin
  if coalesce(array_length(tags, 1), 0) > 5 or exists (select 1 from unnest(tags) t where char_length(t) > 24) then
    raise exception 'Too many tags.';
  end if;
  insert into public.ratings (venue_id, user_id, stars, tags, updated_at)
  values (p_venue, auth.uid(), p_stars, tags, now())
  on conflict (venue_id, user_id) do update set stars = excluded.stars, tags = excluded.tags, updated_at = now();
  return '{}'::jsonb;
end;
$$;

-- Removes the person's profile and everything attached to it.
create function public.delete_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  delete from public.profiles where id = me;
  begin
    delete from auth.users where id = me;
  exception when insufficient_privilege then
    null; -- the sign-in record stays, but it no longer has any Seshhon data
  end;
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------- everything the app shows, in one call
-- Runs with the caller's own rights, so the access rules decide what comes back.
create function public.api_state() returns jsonb
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
    'venues', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id, 'name', v.name, 'kind', v.kind, 'closes', v.closes, 'is_example', v.is_example,
          'average', (select r.average from public.venue_ratings r where r.venue_id = v.id),
          'ratings', coalesce((select r.ratings from public.venue_ratings r where r.venue_id = v.id), 0),
          'my_stars', coalesce((select r.stars from public.ratings r where r.venue_id = v.id and r.user_id = auth.uid()), 0),
          'my_tags', coalesce((select to_jsonb(r.tags) from public.ratings r where r.venue_id = v.id and r.user_id = auth.uid()), '[]'::jsonb)
        )
        order by v.name
      )
      from public.venues v
    ), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id, 'venue_id', d.venue_id, 'type', d.type, 'title', d.title,
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
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------- permissions
-- Supabase gives signed-out and signed-in visitors full rights on every new table and
-- function by default. Take all of that away, then hand back only what the app needs.
revoke all on all tables in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Other people can read only your id, name and invite code, never your push token.
grant select (id, name, invite_code, created_at) on public.profiles to authenticated;
grant insert (id, name, adult_confirmed_at), update (name, push_token) on public.profiles to authenticated;
-- The person asked can change only the state (accept or block), not who the request is between.
grant select, insert, delete on public.friendships to authenticated;
grant update (state) on public.friendships to authenticated;
grant select on public.statuses, public.venues, public.venue_staff, public.redemptions, public.venue_ratings to authenticated;
grant select, insert, update on public.deals to authenticated;
grant select, update on public.seshes to authenticated;
grant select, insert, delete on public.sesh_members to authenticated;
grant select, insert, update, delete on public.venue_votes to authenticated;
grant select, insert, update on public.ratings to authenticated;

-- Signed-out visitors can call nothing. Signed-in people can call only what is listed.
grant execute on function
  public.are_friends(uuid, uuid), public.is_sesh_member(uuid, uuid), public.sesh_creator(uuid),
  public.is_venue_staff(uuid, uuid), public.shares_sesh(uuid, uuid), public.i_am_visible(), public.new_invite_code(),
  public.local_now(timestamptz), public.night_of(timestamptz), public.deal_is_running(public.deals, timestamptz),
  public.set_status(public.status_colour), public.request_deal_code(uuid), public.confirm_deal_code(text),
  public.start_sesh(), public.lock_sesh(uuid), public.join_sesh(uuid), public.leave_sesh(uuid),
  public.cast_vote(uuid, uuid), public.end_sesh(uuid), public.api_sign_up(text, boolean),
  public.request_friend(text), public.answer_friend(uuid, boolean), public.rate_venue(uuid, integer, text[]),
  public.delete_account(), public.api_state()
to authenticated;
