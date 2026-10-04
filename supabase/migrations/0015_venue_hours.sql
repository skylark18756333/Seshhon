-- Opening hours. opening_hours uses OpenStreetMap's format, for example "Mo-Th 11:00-23:00; Fr,Sa 11:00-02:00".
-- The venue import fills it in from OpenStreetMap, and venue staff can change it. Once staff have set
-- the hours (hours_source = 'staff'), a later import leaves them alone.
alter table public.venues add column if not exists opening_hours text;
alter table public.venues add column if not exists hours_source text;
alter table public.venues drop constraint if exists venues_opening_hours_check;
alter table public.venues add constraint venues_opening_hours_check
  check (opening_hours is null or (char_length(opening_hours) between 1 and 255 and opening_hours !~ '[<>]'));
alter table public.venues drop constraint if exists venues_hours_source_check;
alter table public.venues add constraint venues_hours_source_check check (hours_source is null or hours_source in ('osm', 'staff'));

create or replace function public.api_venues() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', v.id, 'name', v.name, 'kind', v.kind, 'closes', v.closes, 'is_example', v.is_example,
      'hours', v.opening_hours,
      'average', t.average,
      'ratings', coalesce(t.ratings, 0),
      'my_stars', coalesce(mine.stars, 0),
      'my_tags', coalesce(to_jsonb(mine.tags), '[]'::jsonb)
    )
    order by v.name
  ), '[]'::jsonb)
  from public.venues v
  left join public.venue_ratings t on t.venue_id = v.id
  left join public.ratings mine on mine.venue_id = v.id and mine.user_id = auth.uid();
$$;

-- Venue staff set their venue's hours. An empty value clears them ("hours unknown").
create or replace function public.set_venue_hours(p_venue uuid, p_hours text) returns void
language plpgsql security definer set search_path = public as $$
declare h text := nullif(btrim(regexp_replace(coalesce(p_hours, ''), '\s+', ' ', 'g')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.venue_staff s where s.venue_id = p_venue and s.user_id = auth.uid()) then
    raise exception 'Only staff at this venue can change its hours.';
  end if;
  if h is not null and (char_length(h) > 255 or h !~ '^[A-Za-z0-9 :;,+./-]+$') then
    raise exception 'Those hours could not be read. Use a format like: Mo-Fr 16:00-24:00; Sa,Su 12:00-02:00';
  end if;
  update public.venues set opening_hours = h, hours_source = 'staff' where id = p_venue;
end;
$$;
revoke all on function public.set_venue_hours(uuid, text) from public, anon, authenticated;
grant execute on function public.set_venue_hours(uuid, text) to authenticated;

-- Example venue hours, so the app has something to show before a real import.
update public.venues set opening_hours = 'Mo-Su 16:00-01:00', hours_source = 'osm' where id = 'a0000000-0000-4000-8000-000000000001' and opening_hours is null;
update public.venues set opening_hours = 'Tu-Su 12:00-24:00; Mo off', hours_source = 'osm' where id = 'a0000000-0000-4000-8000-000000000002' and opening_hours is null;
update public.venues set opening_hours = 'We-Sa 19:00-24:00', hours_source = 'osm' where id = 'a0000000-0000-4000-8000-000000000003' and opening_hours is null;
