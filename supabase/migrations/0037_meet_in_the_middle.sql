-- Meet in the middle: venues that are fair for everyone in a live sesh, worked out from where they are.
-- Location rules (Sarah, 2026-10-04): nobody's location is shared by default. Here each person taps to share for one
-- sesh only. Their position is rounded to about 500 m before it is stored, it is never shown or sent to anyone
-- (the answer is only a list of venues, with no distances), and it is deleted when they tap stop, leave the sesh,
-- or the sesh ends (with the sesh, like the votes and the chat).

create table if not exists private.meet_spots (
  sesh_id uuid not null references public.seshes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  shared_at timestamptz not null default now(),
  primary key (sesh_id, user_id)
);
alter table private.meet_spots enable row level security;
-- No direct access: only the functions below read or write it.
revoke all on private.meet_spots from public, anon, authenticated;

-- How many have shared, whether you have, and (once 2 or more have) the fairest venues: the ones where the
-- person with the furthest to go has the least far to go. Venues only, never people or distances.
create or replace function public.meet_venues(p_sesh uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  n integer;
  picks jsonb := '[]'::jsonb;
begin
  if me is null or not public.is_sesh_member(p_sesh, me) or not public.sesh_is_live(p_sesh) then
    return jsonb_build_object('shared', 0, 'mine', false, 'venues', '[]'::jsonb);
  end if;
  select count(*) into n from private.meet_spots s
  where s.sesh_id = p_sesh and exists (select 1 from public.sesh_members m where m.sesh_id = p_sesh and m.user_id = s.user_id);
  if n >= 2 then
    select coalesce(jsonb_agg(x.id order by x.worst, x.total), '[]'::jsonb) into picks from (
      select v.id,
        max(d.km) as worst, sum(d.km) as total
      from public.venues v
      cross join lateral (
        select 12742 * asin(least(1, sqrt(
          power(sin(radians(v.lat - s.lat) / 2), 2) + cos(radians(s.lat)) * cos(radians(v.lat)) * power(sin(radians(v.lng - s.lng) / 2), 2)
        ))) as km
        from private.meet_spots s
        where s.sesh_id = p_sesh and exists (select 1 from public.sesh_members m where m.sesh_id = p_sesh and m.user_id = s.user_id)
      ) d
      where v.lat between -90 and 90 and v.lng between -180 and 180
      group by v.id
      order by max(d.km), sum(d.km)
      limit 6
    ) x;
  end if;
  return jsonb_build_object(
    'shared', n,
    'mine', exists (select 1 from private.meet_spots where sesh_id = p_sesh and user_id = me),
    'venues', picks
  );
end;
$$;

-- Share where you are for this sesh. Rounded to about 500 m (0.005 degrees) before it is kept.
create or replace function public.meet_share(p_sesh uuid, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not public.is_sesh_member(p_sesh, me) or not public.sesh_is_live(p_sesh) then
    raise exception 'Join the sesh to find a spot in the middle.';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That location does not look right.';
  end if;
  insert into private.meet_spots (sesh_id, user_id, lat, lng)
  values (p_sesh, me, round(p_lat / 0.005) * 0.005, round(p_lng / 0.005) * 0.005)
  on conflict (sesh_id, user_id) do update set lat = excluded.lat, lng = excluded.lng, shared_at = now();
  return public.meet_venues(p_sesh);
end;
$$;

-- Stop sharing: your position is deleted straight away.
create or replace function public.meet_stop(p_sesh uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from private.meet_spots where sesh_id = p_sesh and user_id = auth.uid();
  return public.meet_venues(p_sesh);
end;
$$;

-- Leaving a sesh deletes your shared position for it.
create or replace function private.forget_meet_spot() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.meet_spots where sesh_id = old.sesh_id and user_id = old.user_id;
  return old;
end;
$$;
revoke all on function private.forget_meet_spot() from public, anon, authenticated;
drop trigger if exists sesh_members_forget_meet_spot on public.sesh_members;
create trigger sesh_members_forget_meet_spot after delete on public.sesh_members
for each row execute function private.forget_meet_spot();

-- A sesh that is ended but not yet cleared away keeps nobody's position either.
create or replace function private.forget_meet_spots_on_end() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.ended_at is not null then delete from private.meet_spots where sesh_id = new.id; end if;
  return new;
end;
$$;
revoke all on function private.forget_meet_spots_on_end() from public, anon, authenticated;
drop trigger if exists seshes_forget_meet_spots on public.seshes;
create trigger seshes_forget_meet_spots after update of ended_at on public.seshes
for each row execute function private.forget_meet_spots_on_end();

revoke all on function public.meet_venues(uuid), public.meet_share(uuid, double precision, double precision), public.meet_stop(uuid) from public, anon;
grant execute on function public.meet_venues(uuid), public.meet_share(uuid, double precision, double precision), public.meet_stop(uuid) to authenticated;
