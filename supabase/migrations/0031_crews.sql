-- Crews, besties and free time. A person can have up to 5 besties (one to one, both have to say yes) and be in
-- up to 10 crews (named groups of up to 15 people, all friends of the person who made it, each of whom has to
-- accept the invite). Inside a crew or with a bestie, each person can share when they're free so Frendzy can
-- suggest a catch-up. Ordinary friends never see any of it: there is no "all friends" option.
--
-- Free time is ticked by hand: Morning, Arvo or Night, for today and the next 13 days, plus an optional
-- "usually free" pattern (for example Friday nights) that fills the grid for you. A tick you remove stays
-- removed for that day. Nothing is read from a phone calendar. No reasons, places or event names are stored.
-- A day's slots are deleted once the day has passed (public.purge_free_time, hourly when pg_cron exists).
--
-- Everything is off until you switch it on, crew by crew and bestie by bestie: share off / "free this week"
-- (others only see whether you are free sometime this week) / exact times, what you like to do together, how
-- often to suggest, how many people it takes and which days to never suggest. Suggestions only use people who
-- share exact times with you, and you have to share exact times too. A person who has hidden their status from
-- you, whom you have hidden it from, who is blocked either way, or who is hidden by women-only mode never
-- shows free time to you and never counts in your suggestions (private.hidden_from_me, 0011 and 0029).
-- "Plan it" makes a planned sesh (0025) for that day and time, invited to the crew.
--
-- Every table is in the private schema with no policies, so the app reaches it only through the functions
-- below. Needs 0025 and 0029. Safe to run more than once.

-- ---------------------------------------------------------------- tables
create table if not exists private.crews (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
create table if not exists private.crew_members (
  crew_id uuid not null references private.crews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'member')),
  created_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index if not exists crew_members_user on private.crew_members (user_id);

create table if not exists private.besties (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'requested' check (state in ('requested', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists besties_pair on private.besties (least(requester, addressee), greatest(requester, addressee));
create index if not exists besties_addressee on private.besties (addressee);

-- One row per person per crew or bestie. No row means everything off.
create table if not exists private.share_settings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  crew_id uuid references private.crews (id) on delete cascade,
  bestie uuid references public.profiles (id) on delete cascade,
  share text not null default 'off' check (share in ('off', 'week', 'exact')),
  hangouts text[] not null default '{}',
  suggest text not null default 'off' check (suggest in ('off', 'weekly', 'enough')),
  min_free integer not null default 3 check (min_free between 2 and 15),
  quiet_days integer[] not null default '{}',
  check ((crew_id is null) <> (bestie is null))
);
create unique index if not exists share_settings_crew on private.share_settings (user_id, crew_id) where crew_id is not null;
create unique index if not exists share_settings_bestie on private.share_settings (user_id, bestie) where bestie is not null;

create table if not exists private.free_slots (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  part text not null check (part in ('morning', 'arvo', 'night')),
  free boolean not null,   -- false: ticked off a day the "usually free" pattern would have filled
  primary key (user_id, day, part)
);
create table if not exists private.free_pattern (
  user_id uuid not null references public.profiles (id) on delete cascade,
  dow integer not null check (dow between 0 and 6),   -- 0 is Sunday
  part text not null check (part in ('morning', 'arvo', 'night')),
  primary key (user_id, dow, part)
);
-- Suggestions someone tapped "Not now" on or turned into a plan.
create table if not exists private.catch_up_dismissed (
  user_id uuid not null references public.profiles (id) on delete cascade,
  target uuid not null,
  day date not null,
  part text not null,
  primary key (user_id, target, day, part)
);

alter table private.crews enable row level security;
alter table private.crew_members enable row level security;
alter table private.besties enable row level security;
alter table private.share_settings enable row level security;
alter table private.free_slots enable row level security;
alter table private.free_pattern enable row level security;
alter table private.catch_up_dismissed enable row level security;
revoke all on private.crews, private.crew_members, private.besties, private.share_settings,
  private.free_slots, private.free_pattern, private.catch_up_dismissed from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- Today, in the same time zone the rest of the app uses.
create or replace function private.free_today() returns date
language sql stable as $$ select public.local_now()::date; $$;

-- Is this person free in that slot? An explicit tick or un-tick wins, otherwise their usual pattern.
create or replace function private.is_free(p_user uuid, p_day date, p_part text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select s.free from private.free_slots s where s.user_id = p_user and s.day = p_day and s.part = p_part),
    exists (select 1 from private.free_pattern f where f.user_id = p_user and f.dow = extract(dow from p_day)::int and f.part = p_part));
$$;

create or replace function private.free_this_week(p_user uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (
    select 1 from generate_series(0, 6) n
    cross join (values ('morning'), ('arvo'), ('night')) v(part)
    where private.is_free(p_user, private.free_today() + n, v.part));
$$;

-- Two people may see and count each other's free time: not blocked either way, not hidden by women-only mode or
-- by either of them hiding their status from the other.
create or replace function private.free_visible(p_other uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select p_other <> auth.uid()
    and not public.blocked_between(auth.uid(), p_other)
    and not private.hidden_from_me(p_other)
    and not exists (select 1 from private.status_hides h where h.owner = auth.uid() and h.viewer = p_other);
$$;

create or replace function private.share_of(p_user uuid, p_crew uuid, p_bestie uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select coalesce((select s.share from private.share_settings s
    where s.user_id = p_user and ((p_crew is not null and s.crew_id = p_crew) or (p_bestie is not null and s.bestie = p_bestie))), 'off');
$$;

create or replace function private.share_json(p_user uuid, p_crew uuid, p_bestie uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce((
    select jsonb_build_object('share', s.share, 'hangouts', to_jsonb(s.hangouts), 'suggest', s.suggest, 'min', s.min_free, 'quiet', to_jsonb(s.quiet_days))
    from private.share_settings s
    where s.user_id = p_user and ((p_crew is not null and s.crew_id = p_crew) or (p_bestie is not null and s.bestie = p_bestie))),
    jsonb_build_object('share', 'off', 'hangouts', '[]'::jsonb, 'suggest', 'off', 'min', 3, 'quiet', '[]'::jsonb));
$$;

create or replace function private.is_bestie(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.besties b where b.state = 'accepted'
    and ((b.requester = p_a and b.addressee = p_b) or (b.requester = p_b and b.addressee = p_a)));
$$;
create or replace function private.in_crew(p_crew uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.crew_members m where m.crew_id = p_crew and m.user_id = p_user and m.state = 'member');
$$;
create or replace function private.crew_count(p_user uuid) returns integer
language sql stable security definer set search_path = public, private as $$
  select count(*)::int from private.crew_members m where m.user_id = p_user and m.state = 'member';
$$;
create or replace function private.bestie_count(p_user uuid) returns integer
language sql stable security definer set search_path = public, private as $$
  select count(*)::int from private.besties b where b.state = 'accepted' and p_user in (b.requester, b.addressee);
$$;
revoke all on function private.free_today(), private.is_free(uuid, date, text), private.free_this_week(uuid), private.free_visible(uuid),
  private.share_of(uuid, uuid, uuid), private.share_json(uuid, uuid, uuid), private.is_bestie(uuid, uuid), private.in_crew(uuid, uuid),
  private.crew_count(uuid), private.bestie_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- my free time
-- The next 14 days with the parts I'm free in, and my usual pattern as "dow:part" (Sunday is 0).
create or replace function public.my_free_time() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'today', private.free_today(),
    'days', (
      select jsonb_agg(jsonb_build_object('day', private.free_today() + n, 'free', coalesce((
        select jsonb_agg(v.part order by v.rank) from (values ('morning', 1), ('arvo', 2), ('night', 3)) v(part, rank)
        where private.is_free(auth.uid(), private.free_today() + n, v.part)), '[]'::jsonb)) order by n)
      from generate_series(0, 13) n),
    'pattern', coalesce((select jsonb_agg(f.dow || ':' || f.part order by f.dow, f.part) from private.free_pattern f where f.user_id = auth.uid()), '[]'::jsonb)
  ) end;
$$;

-- Tick (or un-tick) one slot. Only today and the next 13 days.
create or replace function public.set_free(p_day date, p_part text, p_free boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_part is null or p_part not in ('morning', 'arvo', 'night') then raise exception 'Pick Morning, Arvo or Night.'; end if;
  if p_day is null or p_day < private.free_today() or p_day > private.free_today() + 13 then
    raise exception 'You can share free time for today and the next 2 weeks.';
  end if;
  insert into private.free_slots (user_id, day, part, free) values (me, p_day, p_part, coalesce(p_free, false))
  on conflict (user_id, day, part) do update set free = excluded.free;
  if random() < 0.05 then perform public.purge_free_time(); end if;
  return public.my_free_time();
end;
$$;

-- "Usually free": entries like '5:night' (Friday night). An empty list clears it.
create or replace function public.set_free_pattern(p_pattern text[]) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); e text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if coalesce(array_length(p_pattern, 1), 0) > 21 then raise exception 'That is too many times.'; end if;
  foreach e in array coalesce(p_pattern, '{}'::text[]) loop
    if e !~ '^[0-6]:(morning|arvo|night)$' then raise exception 'That time is not one Frendzy knows.'; end if;
  end loop;
  delete from private.free_pattern where user_id = me;
  insert into private.free_pattern (user_id, dow, part)
  select me, split_part(x, ':', 1)::int, split_part(x, ':', 2) from (select distinct unnest(coalesce(p_pattern, '{}'::text[])) x) q;
  return public.my_free_time();
end;
$$;

-- Busy this week: nothing free for today and the next 6 days, whatever the pattern says.
create or replace function public.busy_this_week() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  insert into private.free_slots (user_id, day, part, free)
  select me, private.free_today() + n, v.part, false
  from generate_series(0, 6) n
  cross join (values ('morning'), ('arvo'), ('night')) v(part)
  on conflict (user_id, day, part) do update set free = false;
  return public.my_free_time();
end;
$$;

-- Slots from days that have passed. Nothing is kept for later.
create or replace function public.purge_free_time() returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer := 0; k integer;
begin
  delete from private.free_slots where day < private.free_today();
  get diagnostics k = row_count; n := n + k;
  delete from private.catch_up_dismissed where day < private.free_today();
  get diagnostics k = row_count; n := n + k;
  return n;
end;
$$;

-- ---------------------------------------------------------------- besties
create or replace function public.request_bestie(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); b private.besties;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_user is null or p_user = me or not public.are_friends(me, p_user) or public.blocked_between(me, p_user) then
    raise exception 'You can only pick a friend as a bestie.';
  end if;
  select * into b from private.besties x where (x.requester = me and x.addressee = p_user) or (x.requester = p_user and x.addressee = me);
  if found then
    if b.state = 'accepted' then return jsonb_build_object('ok', true, 'state', 'accepted'); end if;
    if b.requester = me then return jsonb_build_object('ok', true, 'state', 'requested'); end if;
    -- They already asked you: asking back is saying yes.
    return public.answer_bestie(p_user, true);
  end if;
  if (select count(*) from private.besties x where me in (x.requester, x.addressee)) >= 5 then
    raise exception 'You can have up to 5 besties.';
  end if;
  insert into private.besties (requester, addressee) values (me, p_user);
  return jsonb_build_object('ok', true, 'state', 'requested');
end;
$$;

create or replace function public.answer_bestie(p_user uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from private.besties where requester = p_user and addressee = me and state = 'requested') then
    raise exception 'There is no bestie request from that person.';
  end if;
  if not coalesce(p_accept, false) then
    delete from private.besties where requester = p_user and addressee = me;
    return jsonb_build_object('ok', true, 'state', 'none');
  end if;
  if not public.are_friends(me, p_user) or public.blocked_between(me, p_user) then
    delete from private.besties where requester = p_user and addressee = me;
    raise exception 'You can only pick a friend as a bestie.';
  end if;
  if private.bestie_count(me) >= 5 or private.bestie_count(p_user) >= 5 then
    raise exception 'You can have up to 5 besties.';
  end if;
  update private.besties set state = 'accepted' where requester = p_user and addressee = me;
  return jsonb_build_object('ok', true, 'state', 'accepted');
end;
$$;

-- Ends a bestie, or cancels or declines a request. Anyone can do it at any time, and nobody is told.
create or replace function public.remove_bestie(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  delete from private.besties where (requester = me and addressee = p_user) or (requester = p_user and addressee = me);
  delete from private.share_settings where (user_id = me and bestie = p_user) or (user_id = p_user and bestie = me);
  delete from private.catch_up_dismissed where (user_id = me and target = p_user) or (user_id = p_user and target = me);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- crews
create or replace function public.make_crew(p_name text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); nm text := btrim(coalesce(p_name, '')); c private.crews;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if char_length(nm) < 1 or char_length(nm) > 30 then raise exception 'Give the crew a name of up to 30 characters.'; end if;
  if private.crew_count(me) >= 10 then raise exception 'You can be in up to 10 crews.'; end if;
  insert into private.crews (owner, name) values (me, nm) returning * into c;
  insert into private.crew_members (crew_id, user_id, state) values (c.id, me, 'member');
  return jsonb_build_object('ok', true, 'id', c.id);
end;
$$;

create or replace function public.rename_crew(p_crew uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  if char_length(nm) < 1 or char_length(nm) > 30 then raise exception 'Give the crew a name of up to 30 characters.'; end if;
  update private.crews set name = nm where id = p_crew and owner = auth.uid();
  if not found then raise exception 'Only the person who made the crew can rename it.'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Invites friends of mine to a crew I made. They are in only once they accept. Up to 15 people, invited or in.
create or replace function public.invite_to_crew(p_crew uuid, p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); u uuid; n integer := 0;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from private.crews where id = p_crew and owner = me) then
    raise exception 'Only the person who made the crew can invite people.';
  end if;
  for u in select distinct x from unnest(coalesce(p_users, '{}'::uuid[])) x loop
    if u = me or not public.are_friends(me, u) or public.blocked_between(me, u) then continue; end if;
    if exists (select 1 from private.crew_members where crew_id = p_crew and user_id = u) then continue; end if;
    if (select count(*) from private.crew_members where crew_id = p_crew) >= 15 then
      raise exception 'A crew can have up to 15 people.';
    end if;
    insert into private.crew_members (crew_id, user_id, state) values (p_crew, u, 'invited');
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Pick a friend who is not already in the crew.'; end if;
  return jsonb_build_object('ok', true, 'invited', n);
end;
$$;

create or replace function public.answer_crew_invite(p_crew uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); c private.crews;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select cr.* into c from private.crews cr join private.crew_members m on m.crew_id = cr.id
  where cr.id = p_crew and m.user_id = me and m.state = 'invited';
  if not found then raise exception 'There is no invite to that crew.'; end if;
  if not coalesce(p_accept, false) then
    delete from private.crew_members where crew_id = p_crew and user_id = me;
    return jsonb_build_object('ok', true, 'state', 'none');
  end if;
  if not public.are_friends(me, c.owner) or public.blocked_between(me, c.owner) then
    delete from private.crew_members where crew_id = p_crew and user_id = me;
    raise exception 'You can only join a crew made by a friend.';
  end if;
  if private.crew_count(me) >= 10 then raise exception 'You can be in up to 10 crews.'; end if;
  update private.crew_members set state = 'member' where crew_id = p_crew and user_id = me;
  return jsonb_build_object('ok', true, 'state', 'member');
end;
$$;

-- Takes one person out of one crew: their row, their settings and their dismissed suggestions for it.
create or replace function private.drop_from_crew(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare c private.crews; next_owner uuid;
begin
  delete from private.crew_members where crew_id = p_crew and user_id = p_user;
  delete from private.share_settings where user_id = p_user and crew_id = p_crew;
  delete from private.catch_up_dismissed where user_id = p_user and target = p_crew;
  select * into c from private.crews where id = p_crew;
  if found and c.owner = p_user then
    -- The crew carries on under whoever has been in it longest, or goes if nobody else is in it.
    select user_id into next_owner from private.crew_members where crew_id = p_crew and state = 'member' order by created_at, user_id limit 1;
    if next_owner is null then delete from private.crews where id = p_crew;
    else update private.crews set owner = next_owner where id = p_crew;
    end if;
  end if;
end;
$$;

-- Leave a crew (or turn an invite down). Quiet: nobody is told, and sharing with it stops straight away.
create or replace function public.leave_crew(p_crew uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform private.drop_from_crew(p_crew, auth.uid());
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.remove_from_crew(p_crew uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.crews where id = p_crew and owner = auth.uid()) or p_user = auth.uid() then
    raise exception 'Only the person who made the crew can take someone out of it.';
  end if;
  perform private.drop_from_crew(p_crew, p_user);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_crew(p_crew uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.catch_up_dismissed where target = p_crew;
  delete from private.crews where id = p_crew and owner = auth.uid();
  if not found then raise exception 'Only the person who made the crew can delete it.'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- No longer friends (unfriended, or blocked): no besties, and out of each other's crews.
create or replace function private.forget_crews() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare r record;
begin
  if old.state <> 'accepted' then return old; end if;
  delete from private.besties
  where (requester = old.requester and addressee = old.addressee) or (requester = old.addressee and addressee = old.requester);
  delete from private.share_settings
  where (user_id = old.requester and bestie = old.addressee) or (user_id = old.addressee and bestie = old.requester);
  for r in
    select m.crew_id, m.user_id from private.crew_members m join private.crews c on c.id = m.crew_id
    where (c.owner = old.requester and m.user_id = old.addressee) or (c.owner = old.addressee and m.user_id = old.requester)
  loop
    perform private.drop_from_crew(r.crew_id, r.user_id);
  end loop;
  return old;
end;
$$;
revoke all on function private.drop_from_crew(uuid, uuid), private.forget_crews() from public, anon, authenticated;
drop trigger if exists friendships_forget_crews on public.friendships;
create trigger friendships_forget_crews after delete on public.friendships
for each row execute function private.forget_crews();

-- ---------------------------------------------------------------- settings
-- p_kind 'crew' (p_target is the crew) or 'bestie' (p_target is the friend). Everything starts off.
create or replace function public.set_share_settings(
  p_kind text, p_target uuid, p_share text, p_hangouts text[], p_suggest text, p_min integer, p_quiet integer[]
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); h text[] := coalesce(p_hangouts, '{}'::text[]); q integer[] := coalesce(p_quiet, '{}'::integer[]); d integer;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_kind = 'crew' then
    if not private.in_crew(p_target, me) then raise exception 'You are not in that crew.'; end if;
  elsif p_kind = 'bestie' then
    if not private.is_bestie(me, p_target) then raise exception 'That person is not your bestie.'; end if;
  else
    raise exception 'Pick a crew or a bestie.';
  end if;
  if p_share is null or p_share not in ('off', 'week', 'exact') then raise exception 'Pick how much to share.'; end if;
  if p_suggest is null or p_suggest not in ('off', 'weekly', 'enough') then raise exception 'Pick how often to suggest.'; end if;
  if p_min is null or p_min < 2 or p_min > 15 then raise exception 'Pick between 2 and 15 people.'; end if;
  if not (h <@ array['night_out', 'coffee', 'lunch', 'gym', 'footy']) or coalesce(array_length(h, 1), 0) > 5 then
    raise exception 'Pick from night out, coffee, lunch, gym and footy.';
  end if;
  foreach d in array q loop
    if d < 0 or d > 6 then raise exception 'Pick days of the week.'; end if;
  end loop;
  h := array(select distinct x from unnest(h) x order by x);
  q := array(select distinct x from unnest(q) x order by x);
  if p_kind = 'crew' then
    insert into private.share_settings (user_id, crew_id, share, hangouts, suggest, min_free, quiet_days)
    values (me, p_target, p_share, h, p_suggest, p_min, q)
    on conflict (user_id, crew_id) where crew_id is not null
    do update set share = excluded.share, hangouts = excluded.hangouts, suggest = excluded.suggest, min_free = excluded.min_free, quiet_days = excluded.quiet_days;
    return private.share_json(me, p_target, null);
  end if;
  insert into private.share_settings (user_id, bestie, share, hangouts, suggest, min_free, quiet_days)
  values (me, p_target, p_share, h, p_suggest, p_min, q)
  on conflict (user_id, bestie) where bestie is not null
  do update set share = excluded.share, hangouts = excluded.hangouts, suggest = excluded.suggest, min_free = excluded.min_free, quiet_days = excluded.quiet_days;
  return private.share_json(me, null, p_target);
end;
$$;

-- ---------------------------------------------------------------- what the Crews screen shows
-- Besties and crews (with their invites), my settings for each, and who is free this week without saying when.
create or replace function public.crews_state() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'today', private.free_today(),
    'besties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name,
        'state', case when b.state = 'accepted' then 'accepted' when b.requester = auth.uid() then 'out' else 'in' end,
        'settings', private.share_json(auth.uid(), null, p.id),
        'week', case when b.state = 'accepted' and private.share_of(auth.uid(), null, p.id) <> 'off'
                          and private.share_of(p.id, null, auth.uid()) <> 'off' and private.free_visible(p.id)
                     then private.free_this_week(p.id) end
      ) order by p.name)
      from private.besties b
      join public.profiles p on p.id = case when b.requester = auth.uid() then b.addressee else b.requester end
      where auth.uid() in (b.requester, b.addressee) and not public.blocked_between(auth.uid(), p.id)
    ), '[]'::jsonb),
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'mine', c.owner = auth.uid(), 'state', me.state,
        'invited_by', (select o.name from public.profiles o where o.id = c.owner),
        'settings', private.share_json(auth.uid(), c.id, null),
        'members', case when me.state = 'member' then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'state', m.state,
            'week', case when m.state = 'member' and p.id <> auth.uid() and private.share_of(auth.uid(), c.id, null) <> 'off'
                              and private.share_of(p.id, c.id, null) <> 'off' and private.free_visible(p.id)
                         then private.free_this_week(p.id) end
          ) order by (p.id = auth.uid()) desc, m.created_at)
          from private.crew_members m join public.profiles p on p.id = m.user_id
          where m.crew_id = c.id and (p.id = auth.uid() or not (public.blocked_between(auth.uid(), p.id) or private.women_only_hidden(p.id)))
        ), '[]'::jsonb) else '[]'::jsonb end
      ) order by me.state desc, c.name)
      from private.crews c join private.crew_members me on me.crew_id = c.id and me.user_id = auth.uid()
    ), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------- suggestions
-- Slots tomorrow or later where enough of a crew (or a bestie and me) are free. Only for crews and besties where
-- I share exact times and have suggestions on. Counts only people who share exact times with that crew or me
-- and whom I may see. Quiet days and slots I said "not now" to are left out. "Once a week" gives the one best
-- slot in the next 7 days; "whenever enough are free" gives the best 3 in the next 2 weeks.
create or replace function public.catch_up_suggestions() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  t date := private.free_today();
  out jsonb := '[]'::jsonb;
  sc record; slot record;
  cand uuid[]; sharers uuid[]; total integer;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  for sc in
    select 'crew'::text as kind, c.id as target, c.name as label, s.suggest, s.min_free, s.quiet_days, s.hangouts
    from private.share_settings s join private.crews c on c.id = s.crew_id
    where s.user_id = me and s.share = 'exact' and s.suggest <> 'off' and private.in_crew(c.id, me)
    union all
    select 'bestie', p.id, p.name, s.suggest, 2, s.quiet_days, s.hangouts
    from private.share_settings s join public.profiles p on p.id = s.bestie
    where s.user_id = me and s.share = 'exact' and s.suggest <> 'off' and private.is_bestie(me, p.id)
  loop
    if sc.kind = 'crew' then
      cand := array(select m.user_id from private.crew_members m where m.crew_id = sc.target and m.state = 'member' and m.user_id <> me and private.free_visible(m.user_id));
      sharers := array(select u from unnest(cand) u where private.share_of(u, sc.target, null) = 'exact');
    else
      cand := array(select u from (select sc.target as u) x where private.free_visible(u));
      sharers := array(select u from unnest(cand) u where private.share_of(u, null, me) = 'exact');
    end if;
    total := 1 + coalesce(array_length(cand, 1), 0);
    for slot in
      select (t + n) as day, v.part, array_agg(u) as who
      from generate_series(1, case when sc.suggest = 'weekly' then 7 else 13 end) n
      cross join (values ('night', 1), ('arvo', 2), ('morning', 3)) v(part, rank)
      cross join unnest(sharers) u
      where private.is_free(u, t + n, v.part) and private.is_free(me, t + n, v.part)
        and not (extract(dow from t + n)::int = any (sc.quiet_days))
        and not exists (select 1 from private.catch_up_dismissed d where d.user_id = me and d.target = sc.target and d.day = t + n and d.part = v.part)
      group by n, v.part, v.rank
      having 1 + count(*) >= greatest(2, sc.min_free)
      order by count(*) desc, n, v.rank
      limit case when sc.suggest = 'weekly' then 1 else 3 end
    loop
      out := out || jsonb_build_object(
        'kind', sc.kind, 'target', sc.target, 'label', sc.label, 'day', slot.day, 'part', slot.part,
        'free', 1 + array_length(slot.who, 1), 'of', total, 'hangouts', to_jsonb(sc.hangouts),
        'names', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb) from public.profiles p where p.id = any (slot.who)));
    end loop;
  end loop;
  return out;
end;
$$;

create or replace function public.dismiss_catch_up(p_target uuid, p_day date, p_part text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_part is null or p_part not in ('morning', 'arvo', 'night') or p_day is null then raise exception 'That suggestion is not valid.'; end if;
  insert into private.catch_up_dismissed (user_id, target, day, part) values (auth.uid(), p_target, p_day, p_part) on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- "Plan it": a planned sesh (0025) at p_at, invited to the crew (or the bestie), and the suggestion goes away.
-- p_at is the start time the phone worked out for that day and part. Needs at least one friend to invite.
create or replace function public.plan_catch_up(p_kind text, p_target uuid, p_day date, p_part text, p_at timestamptz) returns public.seshes
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); who uuid[]; s public.seshes;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_part is null or p_part not in ('morning', 'arvo', 'night') or p_day is null then raise exception 'That suggestion is not valid.'; end if;
  if p_kind = 'crew' then
    if not private.in_crew(p_target, me) then raise exception 'You are not in that crew.'; end if;
    who := array(select m.user_id from private.crew_members m
      where m.crew_id = p_target and m.state = 'member' and m.user_id <> me and not public.blocked_between(me, m.user_id));
  elsif p_kind = 'bestie' then
    if not private.is_bestie(me, p_target) then raise exception 'That person is not your bestie.'; end if;
    who := array[p_target];
  else
    raise exception 'Pick a crew or a bestie.';
  end if;
  if coalesce(array_length(who, 1), 0) = 0 then raise exception 'There is nobody to invite yet.'; end if;
  s := public.plan_sesh(p_at, who);
  insert into private.catch_up_dismissed (user_id, target, day, part) values (me, p_target, p_day, p_part) on conflict do nothing;
  return s;
end;
$$;

-- ---------------------------------------------------------------- who may call what
revoke all on function
  public.my_free_time(), public.set_free(date, text, boolean), public.set_free_pattern(text[]), public.busy_this_week(), public.purge_free_time(),
  public.request_bestie(uuid), public.answer_bestie(uuid, boolean), public.remove_bestie(uuid),
  public.make_crew(text), public.rename_crew(uuid, text), public.invite_to_crew(uuid, uuid[]), public.answer_crew_invite(uuid, boolean),
  public.leave_crew(uuid), public.remove_from_crew(uuid, uuid), public.delete_crew(uuid),
  public.set_share_settings(text, uuid, text, text[], text, integer, integer[]), public.crews_state(), public.catch_up_suggestions(),
  public.dismiss_catch_up(uuid, date, text), public.plan_catch_up(text, uuid, date, text, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.my_free_time(), public.set_free(date, text, boolean), public.set_free_pattern(text[]), public.busy_this_week(),
  public.request_bestie(uuid), public.answer_bestie(uuid, boolean), public.remove_bestie(uuid),
  public.make_crew(text), public.rename_crew(uuid, text), public.invite_to_crew(uuid, uuid[]), public.answer_crew_invite(uuid, boolean),
  public.leave_crew(uuid), public.remove_from_crew(uuid, uuid), public.delete_crew(uuid),
  public.set_share_settings(text, uuid, text, text[], text, integer, integer[]), public.crews_state(), public.catch_up_suggestions(),
  public.dismiss_catch_up(uuid, date, text), public.plan_catch_up(text, uuid, date, text, timestamptz)
to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('seshhon-purge-free-time', '7 * * * *', 'select public.purge_free_time()');
  end if;
end;
$$;
