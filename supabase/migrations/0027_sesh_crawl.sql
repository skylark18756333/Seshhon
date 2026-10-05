-- Sesh Map: plan a crawl of venues for tonight's sesh, as numbered stops on a map.
-- The stops belong to the sesh. Only people in the sesh can see or change them, and they are deleted with
-- the sesh (when it is ended, or 8 hours after it started), like the votes and the chat.
-- Stops are venues, never people: nobody's location is sent or stored.
-- Anyone in the sesh can add a stop. The person who started the sesh can reorder, tick off and remove any
-- stop; everyone else can remove the stops they added.

create table if not exists public.crawl_stops (
  sesh_id uuid not null references public.seshes (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  position integer not null,
  added_by uuid references public.profiles (id) on delete set null,
  done boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (sesh_id, venue_id)
);
alter table public.crawl_stops enable row level security;
-- No direct access: the app only goes through the functions below.
revoke all on public.crawl_stops from public, anon, authenticated;

-- The stops in order. Empty unless you are in the sesh and it is still live.
create or replace function public.sesh_crawl(p_sesh uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'venue_id', c.venue_id, 'position', c.position, 'done', c.done, 'mine', c.added_by = auth.uid()
  ) order by c.position), '[]'::jsonb)
  from public.crawl_stops c
  where c.sesh_id = p_sesh
    and auth.uid() is not null
    and public.is_sesh_member(p_sesh, auth.uid())
    and public.sesh_is_live(p_sesh);
$$;

-- Numbers the stops 1, 2, 3... again after one is removed or moved.
create or replace function private.renumber_crawl(p_sesh uuid) returns void
language sql security definer set search_path = public as $$
  update public.crawl_stops c set position = r.n
  from (select venue_id, row_number() over (order by position, added_at) as n from public.crawl_stops where sesh_id = p_sesh) r
  where c.sesh_id = p_sesh and c.venue_id = r.venue_id and c.position <> r.n;
$$;

create or replace function public.crawl_add(p_sesh uuid, p_venue uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not public.is_sesh_member(p_sesh, me) or not public.sesh_is_live(p_sesh) then
    raise exception 'Join the sesh to add stops.';
  end if;
  if not exists (select 1 from public.venues where id = p_venue) then raise exception 'That venue is no longer listed.'; end if;
  if exists (select 1 from public.crawl_stops where sesh_id = p_sesh and venue_id = p_venue) then
    raise exception 'That venue is already on the Sesh Map.';
  end if;
  if (select count(*) from public.crawl_stops where sesh_id = p_sesh) >= 12 then
    raise exception 'A Sesh Map can have up to 12 stops.';
  end if;
  insert into public.crawl_stops (sesh_id, venue_id, position, added_by)
  values (p_sesh, p_venue, coalesce((select max(position) from public.crawl_stops where sesh_id = p_sesh), 0) + 1, me);
  return public.sesh_crawl(p_sesh);
end;
$$;

create or replace function public.crawl_remove(p_sesh uuid, p_venue uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not public.is_sesh_member(p_sesh, me) or not public.sesh_is_live(p_sesh) then
    raise exception 'Join the sesh to change its stops.';
  end if;
  delete from public.crawl_stops
  where sesh_id = p_sesh and venue_id = p_venue
    and (added_by = me or public.sesh_creator(p_sesh) = me);
  if not found then raise exception 'Only the person who started the sesh, or who added the stop, can remove it.'; end if;
  perform private.renumber_crawl(p_sesh);
  return public.sesh_crawl(p_sesh);
end;
$$;

-- p_step: -1 moves the stop one earlier, 1 moves it one later.
create or replace function public.crawl_move(p_sesh uuid, p_venue uuid, p_step integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  here integer;
  there integer;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if public.sesh_creator(p_sesh) is distinct from me or not public.sesh_is_live(p_sesh) then
    raise exception 'Only the person who started the sesh can change the order.';
  end if;
  if p_step not in (-1, 1) then raise exception 'Move one stop at a time.'; end if;
  select position into here from public.crawl_stops where sesh_id = p_sesh and venue_id = p_venue;
  if here is null then raise exception 'That stop is no longer on the Sesh Map.'; end if;
  there := here + p_step;
  if exists (select 1 from public.crawl_stops where sesh_id = p_sesh and position = there) then
    update public.crawl_stops set position = case when venue_id = p_venue then there else here end
    where sesh_id = p_sesh and (venue_id = p_venue or position = there);
  end if;
  return public.sesh_crawl(p_sesh);
end;
$$;

-- Ticks a stop off (or back on) as the group moves on to the next one.
create or replace function public.crawl_done(p_sesh uuid, p_venue uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if public.sesh_creator(p_sesh) is distinct from me or not public.sesh_is_live(p_sesh) then
    raise exception 'Only the person who started the sesh can tick off stops.';
  end if;
  update public.crawl_stops set done = coalesce(p_done, false) where sesh_id = p_sesh and venue_id = p_venue;
  if not found then raise exception 'That stop is no longer on the Sesh Map.'; end if;
  return public.sesh_crawl(p_sesh);
end;
$$;

revoke all on function private.renumber_crawl(uuid) from public, anon, authenticated;
revoke all on function public.sesh_crawl(uuid), public.crawl_add(uuid, uuid), public.crawl_remove(uuid, uuid),
  public.crawl_move(uuid, uuid, integer), public.crawl_done(uuid, uuid, boolean) from public, anon;
grant execute on function public.sesh_crawl(uuid), public.crawl_add(uuid, uuid), public.crawl_remove(uuid, uuid),
  public.crawl_move(uuid, uuid, integer), public.crawl_done(uuid, uuid, boolean) to authenticated;
