-- Venue map: the app shows venues on a map and filters them by distance.
-- Only venue positions come from the database. A person's own location stays on their phone:
-- the app measures distances there and never sends or stores where anyone is.

create or replace function public.venue_pins()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'lat', v.lat, 'lng', v.lng)), '[]'::jsonb)
  from public.venues v
  where v.lat between -90 and 90 and v.lng between -180 and 180;
$$;
revoke all on function public.venue_pins() from public, anon, authenticated;
grant execute on function public.venue_pins() to authenticated;

-- Pins for the three example venues (made-up places around Northbridge, Perth).
update public.venues set lat = -31.9478, lng = 115.8571 where id = 'a0000000-0000-4000-8000-000000000001' and lat is null;
update public.venues set lat = -31.9465, lng = 115.8605 where id = 'a0000000-0000-4000-8000-000000000002' and lat is null;
update public.venues set lat = -31.9512, lng = 115.8540 where id = 'a0000000-0000-4000-8000-000000000003' and lat is null;
