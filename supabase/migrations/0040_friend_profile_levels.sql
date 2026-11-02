-- Friend profile: levels, XP, badges and a short "about me" line.
-- XP only counts how often you go out with friends. It never stores where you went: no venues, no places,
-- no history. Each person has one row of running totals. The marker that stops a sesh counting twice is
-- deleted with the sesh, like everything else in it.
--   +50 XP when you join a friend's sesh (or say "I'm in" to a planned one)
--   +20 XP to the host for each friend who joins their sesh
--   At most 300 XP a day (Perth time), so nobody can farm it.
-- Level n needs 50 x (n-1)^2 XP: level 2 at 50, level 3 at 200, level 5 at 800, level 10 at 4,050.
-- Badges come from the totals, so they can't be faked.
-- friend_profile() shows a friend's page using the same rules as everywhere else: red is shown as "off",
-- amber only if they allow you, nothing if they hid their status from you, and blocked people get nothing.
-- Needs 0025 and 0029. Works with or without 0031 (crews) and 0036 (amber). Safe to run more than once.

create table if not exists private.xp (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  points integer not null default 0,
  seshes integer not null default 0,
  hosted integer not null default 0,
  planned integer not null default 0,
  day date,
  day_points integer not null default 0
);
alter table private.xp enable row level security;
revoke all on private.xp from public, anon, authenticated;

create table if not exists private.xp_seen (
  sesh_id uuid not null references public.seshes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (sesh_id, user_id)
);
alter table private.xp_seen enable row level security;
revoke all on private.xp_seen from public, anon, authenticated;

alter table public.profiles add column if not exists about text;
alter table public.profiles drop constraint if exists profiles_about_length;
alter table public.profiles add constraint profiles_about_length check (about is null or char_length(about) <= 80);

create or replace function private.add_xp(u uuid, pts integer, j integer, h integer, p integer) returns void
language plpgsql security definer set search_path = public, private as $$
declare d date := (now() at time zone 'Australia/Perth')::date; give integer;
begin
  insert into private.xp (user_id) values (u) on conflict do nothing;
  update private.xp set day_points = case when day = d then day_points else 0 end, day = d where user_id = u;
  select least(pts, greatest(0, 300 - day_points)) into give from private.xp where user_id = u;
  update private.xp set points = points + give, day_points = day_points + give,
    seshes = seshes + j, hosted = hosted + h, planned = planned + p
  where user_id = u;
end $$;
revoke all on function private.add_xp(uuid, integer, integer, integer, integer) from public, anon, authenticated;

-- Runs when someone joins a sesh. If anything goes wrong here the join still works.
create or replace function private.xp_on_join() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare s public.seshes; n integer;
begin
  begin
    select * into s from public.seshes where id = new.sesh_id;
    if not found or new.user_id = s.creator then return new; end if;
    insert into private.xp_seen (sesh_id, user_id) values (new.sesh_id, new.user_id) on conflict do nothing;
    get diagnostics n = row_count;
    if n = 0 then return new; end if;
    perform private.add_xp(new.user_id, 50, 1, 0, 0);
    insert into private.xp_seen (sesh_id, user_id) values (new.sesh_id, s.creator) on conflict do nothing;
    get diagnostics n = row_count;
    if s.created_at > now() then
      perform private.add_xp(s.creator, 20, 0, 0, n);
    else
      perform private.add_xp(s.creator, 20, 0, n, 0);
    end if;
  exception when others then
    return new;
  end;
  return new;
end $$;
revoke all on function private.xp_on_join() from public, anon, authenticated;
drop trigger if exists sesh_members_xp on public.sesh_members;
create trigger sesh_members_xp after insert on public.sesh_members
for each row execute function private.xp_on_join();

create or replace function private.level_json(u uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with x as (select coalesce(points, 0) pts, coalesce(seshes, 0) seshes, coalesce(hosted, 0) hosted, coalesce(planned, 0) planned
             from (select 1) one left join private.xp on user_id = u),
       f as (select count(*) friends from public.friendships where state = 'accepted' and (requester = u or addressee = u)),
       l as (select floor(sqrt(pts / 50.0))::integer + 1 lvl, pts, seshes, hosted, planned from x)
  select jsonb_build_object(
    'level', l.lvl, 'xp', l.pts, 'next', 50 * l.lvl * l.lvl, 'from', 50 * (l.lvl - 1) * (l.lvl - 1),
    'seshes', l.seshes + l.hosted + l.planned, 'friends', f.friends,
    'badges', to_jsonb(array_remove(array[
      case when l.seshes >= 1 then 'first_round' end,
      case when l.seshes >= 10 then 'regular' end,
      case when l.hosted >= 5 then 'ringleader' end,
      case when l.planned >= 3 then 'planner' end,
      case when f.friends >= 10 then 'social' end], null)))
  from l, f;
$$;
revoke all on function private.level_json(uuid) from public, anon, authenticated;

create or replace function public.friend_profile(p_friend uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := auth.uid(); pr public.profiles; st public.statuses; colour text := 'off'; crews jsonb := '[]'::jsonb; amber_ok boolean := false;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_friend is null then raise exception 'Pick a friend.'; end if;
  if p_friend <> me and (not public.are_friends(p_friend, me) or public.blocked_between(p_friend, me)) then
    raise exception 'You can only see your friends'' profiles.';
  end if;
  select * into pr from public.profiles where id = p_friend;
  select * into st from public.statuses where user_id = p_friend;
  -- Amber needs 0036. Without it, amber stays hidden from everyone.
  if st.colour = 'thinking' and to_regprocedure('private.amber_allowed(uuid)') is not null then
    execute 'select private.amber_allowed($1)' into amber_ok using p_friend;
  end if;
  if p_friend = me then
    colour := coalesce(case when st.expires_at > now() then st.colour::text end, 'off');
  elsif st.colour is not null and st.colour <> 'off' and st.expires_at > now() and public.i_am_visible()
        and not private.hidden_from_me(p_friend) and (st.colour <> 'thinking' or coalesce(amber_ok, false)) then
    colour := st.colour::text;
  end if;
  if to_regclass('private.crew_members') is not null then
    execute 'select coalesce(jsonb_agg(c.name order by c.name), ''[]''::jsonb) from private.crews c
             where exists (select 1 from private.crew_members m where m.crew_id = c.id and m.user_id = $1 and m.state = ''member'')
               and exists (select 1 from private.crew_members m where m.crew_id = c.id and m.user_id = $2 and m.state = ''member'')'
      into crews using me, p_friend;
  end if;
  return private.level_json(p_friend) || jsonb_build_object(
    'id', pr.id, 'name', pr.name, 'about', pr.about, 'colour', colour,
    'photo', (select picture from public.profile_photos where user_id = p_friend and not public.photo_hidden_from_me(p_friend)),
    'mutual', (select count(*) from public.friendships a join public.friendships b
                 on (case when a.requester = me then a.addressee else a.requester end)
                  = (case when b.requester = p_friend then b.addressee else b.requester end)
               where a.state = 'accepted' and b.state = 'accepted' and p_friend <> me
                 and (a.requester = me or a.addressee = me) and (b.requester = p_friend or b.addressee = p_friend)),
    'crews', crews,
    'together', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'at', s.created_at, 'host', h.name) order by s.created_at)
                 from public.seshes s join public.profiles h on h.id = s.creator
                 where p_friend <> me and s.ended_at is null and s.created_at > now() - interval '8 hours'
                   and exists (select 1 from public.sesh_members m where m.sesh_id = s.id and m.user_id = me)
                   and exists (select 1 from public.sesh_members m where m.sesh_id = s.id and m.user_id = p_friend)), '[]'::jsonb));
end $$;

create or replace function public.set_about(p_about text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text := nullif(btrim(coalesce(p_about, '')), '');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if char_length(t) > 80 then raise exception 'Keep it to 80 characters.'; end if;
  update public.profiles set about = t where id = me;
  return jsonb_build_object('about', t);
end $$;

revoke all on function public.friend_profile(uuid), public.set_about(text) from public, anon;
grant execute on function public.friend_profile(uuid), public.set_about(text) to authenticated;
