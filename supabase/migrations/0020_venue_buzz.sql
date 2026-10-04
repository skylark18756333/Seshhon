-- Busy and trending venues for the map's glows and tags.
-- Counts only, never who: no names, no ids of people, no locations. A venue shows as busy only when at
-- least 2 people in live seshes are heading there (voted for it, or in a sesh that locked it in), so a
-- glow can't point at one person. Trending means at least 2 people rated it in the last 7 days.
-- Seshes and votes are deleted when a sesh ends, so "busy" only ever reflects tonight.

create or replace function public.api_buzz() returns jsonb
language sql stable security definer set search_path = public as $$
  with live as (
    select s.id, s.locked_venue from public.seshes s
    where s.ended_at is null and s.created_at > now() - interval '8 hours'
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
