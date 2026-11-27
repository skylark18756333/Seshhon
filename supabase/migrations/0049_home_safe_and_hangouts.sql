-- 0049: "Home safe" ticks and hangout kinds. Needs 0001, 0004, 0035 and 0044. Safe to run more than once.
-- Home safe: in a live sesh each person can tick "home safe", and anyone in it can nudge the ones who haven't (a push
-- that says who asked, at most once every 15 minutes per sesh). No location. The ticks are deleted with the sesh.
-- Hangouts: the starter can say what kind of sesh it is (night out, food, coffee, gym, footy, chill, gig).
create table if not exists private.home_safe (sesh_id uuid not null references public.seshes (id) on delete cascade, user_id uuid not null references public.profiles (id) on delete cascade, at timestamptz not null default now(), primary key (sesh_id, user_id));
alter table private.home_safe enable row level security;
revoke all on private.home_safe from public, anon, authenticated;
alter table public.seshes add column if not exists hangout text;

create or replace function private.in_sesh(p_sesh uuid) returns boolean language sql stable security definer set search_path = public, private as $f$ select auth.uid() is not null and public.sesh_is_live(p_sesh) and (public.is_sesh_member(p_sesh, auth.uid()) or public.sesh_creator(p_sesh) = auth.uid()) $f$;
revoke all on function private.in_sesh(uuid) from public, anon, authenticated;

create or replace function public.home_safe_list(p_sesh uuid) returns jsonb language sql stable security definer set search_path = public, private as $f$ select case when private.in_sesh(p_sesh) then coalesce((select jsonb_agg(h.user_id order by h.at) from private.home_safe h where h.sesh_id = p_sesh), '[]'::jsonb) else '[]'::jsonb end $f$;

create or replace function public.home_safe(p_sesh uuid, p_safe boolean) returns jsonb language plpgsql security definer set search_path = public, private as $f$
begin
  if not private.in_sesh(p_sesh) then raise exception 'You are not in this sesh.'; end if;
  if p_safe then insert into private.home_safe (sesh_id, user_id) values (p_sesh, auth.uid()) on conflict do nothing;
  else delete from private.home_safe where sesh_id = p_sesh and user_id = auth.uid(); end if;
  return public.home_safe_list(p_sesh);
end $f$;

create or replace function public.home_safe_nudge(p_sesh uuid) returns integer language plpgsql security definer set search_path = public, private as $f$
declare r record; n integer := 0; who text;
begin
  if not private.in_sesh(p_sesh) then raise exception 'You are not in this sesh.'; end if;
  who := private.push_name(auth.uid());
  for r in select m.user_id from public.sesh_members m where m.sesh_id = p_sesh and m.user_id <> auth.uid() and not exists (select 1 from private.home_safe h where h.sesh_id = p_sesh and h.user_id = m.user_id) loop
    if private.push_enqueue(r.user_id, 'home_safe', auth.uid(), who || ' wants to know you got home OK', 'Tap Home safe in your sesh when you are in.', 'sesh', p_sesh::text, interval '15 minutes') then n := n + 1; end if;
  end loop;
  if n > 0 then perform private.push_poke(); end if;
  return n;
end $f$;

update private.push_kinds set label = 'Home safe', hint = 'When a mate checks you got home OK after a sesh.', default_on = true, live = true where kind = 'home_safe';

create or replace function public.set_sesh_hangout(p_sesh uuid, p_hangout text) returns void language plpgsql security definer set search_path = public, private as $f$
declare v text := nullif(btrim(coalesce(p_hangout, '')), '');
begin
  if not exists (select 1 from public.seshes s where s.id = p_sesh and s.creator = auth.uid() and s.ended_at is null) then raise exception 'Only the person who started the sesh can change it.'; end if;
  if v is not null and v not in ('night', 'food', 'coffee', 'gym', 'footy', 'chill', 'gig') then raise exception 'Pick one of the kinds.'; end if;
  update public.seshes set hangout = v where id = p_sesh;
end $f$;

create or replace function public.sesh_details(p_sesh uuid) returns jsonb language sql stable security definer set search_path = public, private as $f$ select jsonb_build_object('name', s.name, 'emoji', s.emoji, 'colour', s.colour, 'private', s.private, 'hangout', s.hangout, 'cover_at', case when s.cover is null then null else s.cover_at end) from public.seshes s where s.id = p_sesh and private.can_see_sesh(s.id) $f$;

revoke all on function public.home_safe_list(uuid), public.home_safe(uuid, boolean), public.home_safe_nudge(uuid), public.set_sesh_hangout(uuid, text) from public, anon;
grant execute on function public.home_safe_list(uuid), public.home_safe(uuid, boolean), public.home_safe_nudge(uuid), public.set_sesh_hangout(uuid, text) to authenticated;
notify pgrst, 'reload schema';
insert into private.migration_log (file) values ('0049_home_safe_and_hangouts');
