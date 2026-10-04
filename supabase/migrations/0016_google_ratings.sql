-- Google ratings, shown next to SeshOn's own ratings once a Google Places key is set up.
-- Google's terms allow keeping a venue's Google place ID (venues.places_id) but not its rating, so
-- the google-rating Edge Function fetches the rating fresh each time and nothing else is stored.
-- Each look-up costs money, so each person gets at most 100 a day.

create table if not exists public.google_lookups (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  n integer not null default 0,
  primary key (user_id, day)
);
alter table public.google_lookups enable row level security;   -- no policies: only the functions below touch it
revoke all on public.google_lookups from public, anon, authenticated;

-- Called by the Edge Function (service role only): counts the look-up and returns what Google needs.
create or replace function public.google_lookup_start(p_user uuid, p_venue uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare used integer; v public.venues;
begin
  select * into v from public.venues where id = p_venue;
  if v.id is null then raise exception 'That venue is no longer listed.'; end if;
  insert into public.google_lookups (user_id, day, n) values (p_user, (now() at time zone 'Australia/Perth')::date, 1)
  on conflict (user_id, day) do update set n = google_lookups.n + 1
  returning n into used;
  if used > 100 then raise exception 'Google ratings are paused for you until tomorrow.'; end if;
  return jsonb_build_object('name', v.name, 'lat', v.lat, 'lng', v.lng, 'place', v.places_id);
end;
$$;

-- Called by the Edge Function (service role only) to remember a venue's Google place ID.
create or replace function public.google_set_place(p_venue uuid, p_place text) returns void
language sql security definer set search_path = public as $$
  update public.venues set places_id = left(p_place, 300) where id = p_venue;
$$;

-- Old look-up counts are not needed.
create or replace function public.purge_google_lookups() returns void
language sql security definer set search_path = public as $$
  delete from public.google_lookups where day < (now() at time zone 'Australia/Perth')::date - 1;
$$;

revoke all on function public.google_lookup_start(uuid, uuid), public.google_set_place(uuid, text), public.purge_google_lookups()
  from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.google_lookup_start(uuid, uuid), public.google_set_place(uuid, text) to service_role;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('seshon-purge-google-lookups', '17 4 * * *', 'select public.purge_google_lookups()');
  end if;
end;
$$;
