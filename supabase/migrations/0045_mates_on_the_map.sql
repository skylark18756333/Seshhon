-- 0045: mates on the map in a live sesh (Sarah chose "Yes, opt-in, rough area" on 2026-11-03).
-- Builds on 0037 (Meet in the middle): the same one switch shares your rough spot (rounded to ~500 m) for this sesh
-- only. Anyone sharing now also sees the other sharing members of the sesh as faces at their rough spot.
-- Nothing new is stored, and the spot is still deleted when you stop, leave or the sesh ends.
-- Safe to run more than once.

-- Anyone sharing now said yes when the switch said nobody would see them, so those shares are cleared: everyone
-- switches it on again under the new wording.
delete from private.meet_spots;

create or replace function public.meet_venues(p_sesh uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  n integer;
  picks jsonb := '[]'::jsonb;
  mates jsonb := '[]'::jsonb;
begin
  if me is null or not public.is_sesh_member(p_sesh, me) or not public.sesh_is_live(p_sesh) then
    return jsonb_build_object('shared', 0, 'mine', false, 'venues', '[]'::jsonb, 'mates', '[]'::jsonb);
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
  -- Mates on the map (Sarah, 2026-11-03): only to someone who is sharing too, only the other members of this live
  -- sesh who switched sharing on, and only their rounded (~500 m) spot. Gone when they stop, leave or the sesh ends.
  if exists (select 1 from private.meet_spots where sesh_id = p_sesh and user_id = me) then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.user_id, 'name', p.name, 'lat', s.lat, 'lng', s.lng) order by p.name), '[]'::jsonb)
      into mates
    from private.meet_spots s
    join public.profiles p on p.id = s.user_id
    where s.sesh_id = p_sesh and s.user_id <> me
      and exists (select 1 from public.sesh_members m where m.sesh_id = p_sesh and m.user_id = s.user_id)
      and not public.blocked_between(s.user_id, me);
  end if;
  return jsonb_build_object(
    'shared', n,
    'mine', exists (select 1 from private.meet_spots where sesh_id = p_sesh and user_id = me),
    'venues', picks,
    'mates', mates
  );
end;
$$;

revoke all on function public.meet_venues(uuid) from public, anon;
grant execute on function public.meet_venues(uuid) to authenticated;

insert into private.migration_log (file) values ('0045_mates_on_the_map') on conflict do nothing;
