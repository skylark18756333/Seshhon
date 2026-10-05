-- Planned seshes. A sesh can be planned for a date and time up to 2 weeks ahead. The friends it's for (all
-- friends, or only the ones picked, as with a private sesh) can see it straight away, say they're in, vote on
-- where to go and chat about it. It goes live at the planned time, or earlier if the person who planned it
-- taps "Start now".
--
-- A sesh's created_at is when it starts: for a planned sesh that is the planned time. So every rule that
-- already counts "8 hours after it started" (the clean-up, chat, joining, voting, the Sesh Map stops) counts
-- from the planned start, and a planned sesh that never gets going is deleted 8 hours after its start time
-- with everything in it. Cancelling one deletes it straight away, like ending a sesh.
--
-- A planned sesh doesn't count as "on" until it starts: it never makes a venue glow busy, and it doesn't
-- stop anyone starting a sesh now.
--
-- Also adds a private pres (pre-drinks) address the host can add to a sesh: see "pres address" below.
-- Needs 0024. Safe to run more than once.

create index if not exists seshes_creator_start on public.seshes (creator, created_at);

-- ---------------------------------------------------------------- planning one
-- p_at: when it starts. p_friends: null or empty for all friends, or the friends picked for a private one.
create or replace function public.plan_sesh(p_at timestamptz, p_friends uuid[] default null) returns public.seshes
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  picked boolean := coalesce(array_length(p_friends, 1), 0) > 0;
  s public.seshes;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_at is null or p_at < now() + interval '5 minutes' then raise exception 'Pick a time later than now.'; end if;
  if p_at > now() + interval '14 days' then raise exception 'You can plan a sesh up to 2 weeks ahead.'; end if;
  if (select count(*) from public.seshes where creator = me and ended_at is null and created_at > now()) >= 5 then
    raise exception 'You already have 5 seshes planned. Cancel one first.';
  end if;
  if coalesce(array_length(p_friends, 1), 0) > 50 then raise exception 'Pick up to 50 friends.'; end if;
  insert into public.seshes (creator, private, created_at) values (me, picked, p_at) returning * into s;
  insert into public.sesh_members (sesh_id, user_id) values (s.id, me);
  if picked and private.invite_friends(s.id, p_friends) = 0 then raise exception 'Pick at least one friend.'; end if;
  return s;
end;
$$;

-- The person who planned it can start it early. It then runs (and is deleted) like any sesh started now.
create or replace function public.start_planned_sesh(p_sesh uuid) returns public.seshes
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.seshes;
begin
  if not exists (select 1 from public.seshes where id = p_sesh and creator = me and ended_at is null and created_at > now()) then
    raise exception 'Only the person who planned the sesh can start it early.';
  end if;
  if exists (select 1 from public.seshes where creator = me and ended_at is null
             and created_at <= now() and created_at > now() - interval '8 hours') then
    raise exception 'You already have a sesh going. End it first.';
  end if;
  update public.seshes set created_at = now() where id = p_sesh returning * into s;
  return s;
end;
$$;

revoke all on function public.plan_sesh(timestamptz, uuid[]), public.start_planned_sesh(uuid) from public, anon, authenticated;
grant execute on function public.plan_sesh(timestamptz, uuid[]), public.start_planned_sesh(uuid) to authenticated;

-- ---------------------------------------------------------------- starting one now
-- Same as 0002 and 0024, except a sesh planned for later doesn't count as the one you already have going.
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
  where creator = me and ended_at is null and created_at <= now() and created_at > now() - interval '8 hours'
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
  if exists (select 1 from public.seshes where creator = me and ended_at is null
             and created_at <= now() and created_at > now() - interval '8 hours') then
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
revoke all on function public.start_sesh(), public.start_private_sesh(uuid[]) from public, anon, authenticated;
grant execute on function public.start_sesh(), public.start_private_sesh(uuid[]) to authenticated;

-- ---------------------------------------------------------------- chat clean-up
-- Same as 0006, except chat in a sesh that hasn't started yet is kept until the sesh itself is deleted,
-- so plans made days ahead aren't wiped after 8 hours. Started seshes work exactly as before.
create or replace function public.purge_chat() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.messages m
  where (m.created_at < now() - interval '8 hours'
         and not exists (select 1 from public.seshes s where s.id = m.sesh_id and s.created_at > now()))
     or exists (select 1 from public.seshes s where s.id = m.sesh_id and (s.ended_at is not null or s.created_at < now() - interval '8 hours'));
  get diagnostics n = row_count;
  delete from public.reports where created_at < now() - interval '90 days';
  perform public.purge_old_data();
  return n;
end;
$$;
revoke all on function public.purge_chat() from public, anon, authenticated;

-- ---------------------------------------------------------------- busy venues
-- Same as 0020, except seshes planned for later don't make a venue glow: busy means people heading there now.
-- (If 0020 hasn't been run yet, this adds it. Run 0020 before this one, not after.)
create or replace function public.api_buzz() returns jsonb
language sql stable security definer set search_path = public as $$
  with live as (
    select s.id, s.locked_venue from public.seshes s
    where s.ended_at is null and s.created_at <= now() and s.created_at > now() - interval '8 hours'
  ),
  heading as (
    select l.locked_venue as venue_id, m.user_id from live l join public.sesh_members m on m.sesh_id = l.id
    where l.locked_venue is not null
    union
    select v.venue_id, v.user_id from live l join public.venue_votes v on v.sesh_id = l.id
    where l.locked_venue is null
  ),
  busy as (
    select venue_id, count(distinct user_id) as people from heading group by venue_id having count(distinct user_id) >= 2
  ),
  trend as (
    select venue_id, count(*) as recent from public.ratings
    where updated_at > now() - interval '7 days' group by venue_id having count(*) >= 2
    order by count(*) desc limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(b.venue_id, t.venue_id),
    'busy', case when b.people >= 10 then 3 when b.people >= 5 then 2 when b.people >= 2 then 1 else 0 end,
    'trending', t.venue_id is not null
  )), '[]'::jsonb)
  from busy b full join trend t on t.venue_id = b.venue_id
  where auth.uid() is not null;
$$;
revoke all on function public.api_buzz() from public, anon, authenticated;
grant execute on function public.api_buzz() to authenticated;

-- ---------------------------------------------------------------- pres address
-- The person who started a sesh can add a private address for pres (pre-drinks), usually someone's home.
-- It is kept in its own table that nobody can read directly, so friends who can see the sesh can't see it.
-- Only people who have said they're in see it, and only from 4 hours before the sesh starts (the host always
-- sees what they typed). Anyone blocked by or blocking the host never sees it. It never goes on the map or
-- into venue glows, and it is deleted with the sesh.
create table if not exists private.sesh_pres (
  sesh_id uuid primary key references public.seshes (id) on delete cascade,
  address text not null check (char_length(address) between 1 and 200),
  pres_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.sesh_pres enable row level security;   -- no policies: only the functions below use it
revoke all on private.sesh_pres from public, anon, authenticated;

-- p_address empty or null removes it. p_at (optional) is when pres starts.
create or replace function public.set_sesh_pres(p_sesh uuid, p_address text, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  addr text := btrim(coalesce(p_address, ''));
  starts timestamptz;
begin
  select created_at into starts from public.seshes
  where id = p_sesh and creator = auth.uid() and ended_at is null and created_at > now() - interval '8 hours';
  if not found then raise exception 'Only the person who started the sesh can set the pres address.'; end if;
  if addr = '' then
    delete from private.sesh_pres where sesh_id = p_sesh;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  if char_length(addr) > 200 then raise exception 'Keep the address under 200 characters.'; end if;
  if p_at is not null and (p_at > starts or p_at < starts - interval '12 hours') then
    raise exception 'Pres has to be on the day, before the sesh starts.';
  end if;
  insert into private.sesh_pres (sesh_id, address, pres_at) values (p_sesh, addr, p_at)
  on conflict (sesh_id) do update set address = excluded.address, pres_at = excluded.pres_at, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_sesh_pres(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_sesh_pres(uuid, text, timestamptz) to authenticated;

-- What the person asking may know about a sesh's pres: null if there is none or they aren't in the sesh,
-- {"at", "shows_at"} without the address until 4 hours before the start, then the address too.
create or replace function private.sesh_pres_for_me(p_sesh uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case
    when x.creator = auth.uid() then jsonb_build_object('address', p.address, 'at', p.pres_at, 'shows_at', x.created_at - interval '4 hours')
    when public.is_sesh_member(x.id, auth.uid()) and not public.blocked_between(x.creator, auth.uid())
         and not private.hidden_from_me(x.creator) then
      case when now() >= x.created_at - interval '4 hours'
        then jsonb_build_object('address', p.address, 'at', p.pres_at, 'shows_at', x.created_at - interval '4 hours')
        else jsonb_build_object('at', p.pres_at, 'shows_at', x.created_at - interval '4 hours') end
  end
  from public.seshes x join private.sesh_pres p on p.sesh_id = x.id
  where x.id = p_sesh;
$$;
revoke all on function private.sesh_pres_for_me(uuid) from public, anon;
grant execute on function private.sesh_pres_for_me(uuid) to authenticated;

-- ---------------------------------------------------------------- app state
-- Same as 0024, plus when each sesh starts, whether it is still only planned, and its pres (as above).
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
          'starts_at', s.created_at,
          'planned', s.created_at > now(),
          'pres', private.sesh_pres_for_me(s.id),
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
