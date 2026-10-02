-- Seshhon database, first version.
-- Run this once in a new Supabase project (SQL editor, or `supabase db push`).
-- It creates the tables, the access rules (who can see and change what),
-- and the functions the app calls for status, deal codes and locking a sesh.

-- ---------------------------------------------------------------- types
create type public.status_colour as enum ('on', 'thinking', 'off');
create type public.friendship_state as enum ('requested', 'accepted', 'blocked');
create type public.deal_type as enum ('Food', 'Drinks', 'Entry', 'Events');

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  -- Sign-up is refused unless the person confirms they are 18 or over.
  adult_confirmed_at timestamptz not null,
  push_token text,
  created_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  state public.friendship_state not null default 'requested',
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- One row per pair of people, whoever asked first.
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

create table public.statuses (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  colour public.status_colour not null default 'off',
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text,
  lat double precision,
  lng double precision,
  closes text,
  places_id text
);

-- People who may enter deals and confirm codes for a venue.
create table public.venue_staff (
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (venue_id, user_id)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  type public.deal_type not null,
  title text not null check (char_length(title) between 3 and 80),
  start_time time not null,
  end_time time not null,
  is_alcohol boolean not null default false,
  discount_pct integer check (discount_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  -- Limits from the WA policy on responsible promotion of liquor, applied to
  -- every alcohol deal: at most 50% off, at most 60 minutes, finished by 7pm.
  -- Have a liquor lawyer confirm these before changing them.
  constraint alcohol_discount_limit check (not is_alcohol or coalesce(discount_pct, 0) <= 50),
  constraint alcohol_length_limit check (not is_alcohol or end_time - start_time <= interval '60 minutes'),
  constraint alcohol_ends_by_7pm check (not is_alcohol or end_time <= time '19:00')
);

create table public.seshes (
  id uuid primary key default gen_random_uuid(),
  creator uuid not null references public.profiles (id) on delete cascade,
  locked_venue uuid references public.venues (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.sesh_members (
  sesh_id uuid not null references public.seshes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (sesh_id, user_id)
);

create table public.venue_votes (
  sesh_id uuid not null references public.seshes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (sesh_id, user_id)
);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null,
  -- The night the code belongs to. A night runs until 5am, so 1am counts as the night before.
  night date not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  -- One use per person, per deal, per night.
  unique (deal_id, user_id, night)
);

create table public.ratings (
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

-- ---------------------------------------------------------------- helpers
-- These run with the table owner's rights so access rules can call them
-- without the rules checking themselves in a loop.

create function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.state = 'accepted'
      and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
  );
$$;

create function public.is_sesh_member(s uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sesh_members m where m.sesh_id = s and m.user_id = u);
$$;

create function public.sesh_creator(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select creator from public.seshes where id = s;
$$;

create function public.is_venue_staff(v uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.venue_staff vs where vs.venue_id = v and vs.user_id = u);
$$;

-- The pilot runs in Perth, so deal hours and "tonight" use Perth time.
create function public.local_now(at timestamptz default now()) returns timestamp
language sql stable as $$ select at at time zone 'Australia/Perth'; $$;

create function public.night_of(at timestamptz default now()) returns date
language sql stable as $$ select (public.local_now(at) - interval '5 hours')::date; $$;

create function public.deal_is_running(d public.deals, at timestamptz default now()) returns boolean
language sql stable as $$
  select d.active and public.local_now(at)::time >= d.start_time and public.local_now(at)::time < d.end_time;
$$;

-- A venue can run at most two alcohol deals at a time.
create function public.check_alcohol_deal_count() returns trigger
language plpgsql as $$
begin
  if new.is_alcohol and new.active and (
    select count(*) from public.deals d
    where d.venue_id = new.venue_id and d.is_alcohol and d.active and d.id <> new.id
  ) >= 2 then
    raise exception 'A venue can run at most two alcohol deals per day.';
  end if;
  return new;
end;
$$;
create trigger deals_alcohol_count before insert or update on public.deals
  for each row execute function public.check_alcohol_deal_count();

-- ---------------------------------------------------------------- functions the app calls

-- Set your status. On lasts 4 hours, Thinking 2 hours, Off has no end.
create function public.set_status(new_colour public.status_colour) returns public.statuses
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  result public.statuses;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  insert into public.statuses (user_id, colour, expires_at, updated_at)
  values (
    me, new_colour,
    case new_colour when 'on' then now() + interval '4 hours' when 'thinking' then now() + interval '2 hours' else null end,
    now()
  )
  on conflict (user_id) do update
    set colour = excluded.colour, expires_at = excluded.expires_at, updated_at = excluded.updated_at
  returning * into result;
  return result;
end;
$$;

-- Turn expired statuses Off. Scheduled every five minutes at the end of this file.
create function public.expire_statuses() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.statuses set colour = 'off', expires_at = null, updated_at = now()
  where colour <> 'off' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Get a code for a deal. Fails if the deal is not running or you used it tonight.
create function public.request_deal_code(p_deal uuid) returns public.redemptions
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d public.deals;
  r public.redemptions;
  tonight date := public.night_of();
  fresh text := 'SESH-' || (1000 + floor(random() * 9000))::int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into d from public.deals where id = p_deal;
  if not found then raise exception 'That deal does not exist.'; end if;
  if not public.deal_is_running(d) then raise exception 'That deal is not running right now.'; end if;

  select * into r from public.redemptions where deal_id = p_deal and user_id = me and night = tonight;
  if found and r.confirmed_at is not null then
    raise exception 'You have already used this deal tonight.';
  end if;
  if found and r.expires_at > now() then
    return r; -- the code you already have is still good
  end if;

  insert into public.redemptions (deal_id, user_id, code, night, expires_at)
  values (p_deal, me, fresh, tonight, now() + interval '15 minutes')
  on conflict (deal_id, user_id, night) do update
    set code = excluded.code, expires_at = excluded.expires_at
  returning * into r;
  return r;
end;
$$;

-- Venue staff confirm a code. Works once, only for their own venue, only before it runs out.
create function public.confirm_deal_code(p_code text) returns public.redemptions
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.redemptions;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select red.* into r
  from public.redemptions red
  join public.deals d on d.id = red.deal_id
  where red.code = p_code and red.night = public.night_of() and public.is_venue_staff(d.venue_id, me)
  order by red.expires_at desc
  limit 1;
  if not found then raise exception 'That code is not valid at your venue tonight.'; end if;
  if r.confirmed_at is not null then raise exception 'That code has already been used.'; end if;
  if r.expires_at <= now() then raise exception 'That code has run out. Ask for a new one.'; end if;
  update public.redemptions set confirmed_at = now(), confirmed_by = me where id = r.id returning * into r;
  return r;
end;
$$;

-- Start a sesh. You must be On, and you join it straight away.
create function public.start_sesh() returns public.seshes
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.seshes;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.statuses where user_id = me and colour = 'on' and expires_at > now()) then
    raise exception 'You need to be On to start a sesh.';
  end if;
  insert into public.seshes (creator) values (me) returning * into s;
  insert into public.sesh_members (sesh_id, user_id) values (s.id, me);
  return s;
end;
$$;

-- Lock in the venue with the most votes. Ties go to the venue that got its votes first.
create function public.lock_sesh(p_sesh uuid) returns public.seshes
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.seshes;
  winner uuid;
begin
  select * into s from public.seshes where id = p_sesh;
  if not found or s.creator <> me then raise exception 'Only the person who started the sesh can lock it in.'; end if;
  select venue_id into winner
  from public.venue_votes where sesh_id = p_sesh
  group by venue_id
  order by count(*) desc, min(voted_at) asc
  limit 1;
  if winner is null then raise exception 'Nobody has voted yet.'; end if;
  update public.seshes set locked_venue = winner where id = p_sesh returning * into s;
  return s;
end;
$$;

-- Average rating per venue.
create view public.venue_ratings with (security_invoker = true) as
  select venue_id, round(avg(stars)::numeric, 1) as average, count(*) as ratings
  from public.ratings group by venue_id;

-- ---------------------------------------------------------------- access rules
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.statuses enable row level security;
alter table public.venues enable row level security;
alter table public.venue_staff enable row level security;
alter table public.deals enable row level security;
alter table public.seshes enable row level security;
alter table public.sesh_members enable row level security;
alter table public.venue_votes enable row level security;
alter table public.redemptions enable row level security;
alter table public.ratings enable row level security;

-- Profiles: you see yourself, your friends, and people with a pending request to or from you.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.friendships f
    where f.state <> 'blocked'
      and ((f.requester = auth.uid() and f.addressee = profiles.id) or (f.addressee = auth.uid() and f.requester = profiles.id))
  )
);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Friendships: only the two people involved. Only the person asked can accept.
create policy friendships_read on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
create policy friendships_request on public.friendships for insert to authenticated
  with check (requester = auth.uid() and state = 'requested');
create policy friendships_answer on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid());
create policy friendships_remove on public.friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- Statuses: you see your own. Friends see yours only while it is On or Thinking and not run out.
-- Changes go through set_status(), so there are no insert or update rules here.
create policy statuses_read on public.statuses for select to authenticated using (
  user_id = auth.uid()
  or (colour <> 'off' and expires_at > now() and public.are_friends(user_id, auth.uid()))
);

-- Venues and deals: any signed-in person can read. Venue staff manage their own deals.
create policy venues_read on public.venues for select to authenticated using (true);
create policy venue_staff_read on public.venue_staff for select to authenticated using (user_id = auth.uid());
create policy deals_read on public.deals for select to authenticated using (true);
create policy deals_insert on public.deals for insert to authenticated with check (public.is_venue_staff(venue_id, auth.uid()));
create policy deals_update on public.deals for update to authenticated
  using (public.is_venue_staff(venue_id, auth.uid())) with check (public.is_venue_staff(venue_id, auth.uid()));

-- Seshes: the creator, the members, and the creator's friends (so they can join).
create policy seshes_read on public.seshes for select to authenticated using (
  creator = auth.uid() or public.is_sesh_member(id, auth.uid()) or public.are_friends(creator, auth.uid())
);
create policy seshes_end on public.seshes for update to authenticated using (creator = auth.uid()) with check (creator = auth.uid());

create policy members_read on public.sesh_members for select to authenticated using (
  user_id = auth.uid() or public.is_sesh_member(sesh_id, auth.uid()) or public.are_friends(public.sesh_creator(sesh_id), auth.uid())
);
create policy members_join on public.sesh_members for insert to authenticated with check (
  user_id = auth.uid() and public.are_friends(public.sesh_creator(sesh_id), auth.uid())
);
create policy members_leave on public.sesh_members for delete to authenticated using (user_id = auth.uid());

-- Votes: members of the sesh see them; each member casts or changes only their own.
create policy votes_read on public.venue_votes for select to authenticated using (public.is_sesh_member(sesh_id, auth.uid()));
create policy votes_cast on public.venue_votes for insert to authenticated
  with check (user_id = auth.uid() and public.is_sesh_member(sesh_id, auth.uid()));
create policy votes_change on public.venue_votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_sesh_member(sesh_id, auth.uid()));
create policy votes_remove on public.venue_votes for delete to authenticated using (user_id = auth.uid());

-- Redemptions: you see your own. Codes are made and confirmed only through the functions above.
create policy redemptions_read on public.redemptions for select to authenticated using (user_id = auth.uid());

-- Ratings: anyone signed in can read; you write only your own.
create policy ratings_read on public.ratings for select to authenticated using (true);
create policy ratings_insert on public.ratings for insert to authenticated with check (user_id = auth.uid());
create policy ratings_update on public.ratings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- permissions
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.friendships to authenticated;
-- The person asked can change only the state (accept or block), not who the request is between.
grant update (state) on public.friendships to authenticated;
grant select on public.statuses, public.venues, public.venue_staff, public.redemptions, public.venue_ratings to authenticated;
grant select, insert, update on public.deals to authenticated;
grant select, update on public.seshes to authenticated;
grant select, insert, delete on public.sesh_members to authenticated;
grant select, insert, update, delete on public.venue_votes to authenticated;
grant select, insert, update on public.ratings to authenticated;

revoke execute on all functions in schema public from public;
grant execute on function
  public.are_friends(uuid, uuid), public.is_sesh_member(uuid, uuid), public.sesh_creator(uuid),
  public.is_venue_staff(uuid, uuid), public.local_now(timestamptz), public.night_of(timestamptz),
  public.deal_is_running(public.deals, timestamptz), public.set_status(public.status_colour),
  public.request_deal_code(uuid), public.confirm_deal_code(text), public.start_sesh(), public.lock_sesh(uuid)
to authenticated;

-- ---------------------------------------------------------------- schedule
-- Turn expired statuses Off every five minutes, if the pg_cron extension is switched on
-- (Supabase dashboard: Database, Extensions, pg_cron). Without it, expired statuses are
-- still hidden from friends by the access rule above; they just stay stored until changed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('seshhon-expire-statuses', '*/5 * * * *', 'select public.expire_statuses()');
  end if;
end;
$$;
