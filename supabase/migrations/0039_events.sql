-- Events that are not tied to a venue: festivals, concerts and gigs at parks,
-- stadiums or arenas. Admins add and edit them; everyone can read live ones.
-- Run in Supabase SQL editor, then the last line records it.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  kind text not null default 'Concert' check (kind in ('Concert', 'Festival', 'Gig', 'Other')),
  place text not null check (char_length(place) between 2 and 120),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source_url text check (source_url is null or source_url like 'https://%'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.events enable row level security;

drop policy if exists events_read_live on public.events;
create policy events_read_live on public.events for select
  using (active and ends_at > now());

create or replace function public.api_events() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.starts_at), '[]'::jsonb)
  from (
    select id, title, kind, place, lat, lng, starts_at, ends_at, source_url
    from public.events
    where active and ends_at > now()
  ) x;
$$;

grant execute on function public.api_events() to anon, authenticated;

insert into private.migration_log (file) values ('0039_events');
