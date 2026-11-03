-- 0043: seshes can be planned up to a year ahead (was 2 weeks), so people can plan birthdays, trips and big nights
-- well in advance (Sarah, 2026-11-03). Same as plan_sesh in 0025 except for that one limit. Everything else stays:
-- a planned sesh is still deleted 8 hours after its start, and you can still have at most 5 planned at once.
-- Needs 0025. Safe to run more than once.

create or replace function public.plan_sesh(p_at timestamptz, p_friends uuid[] default null) returns public.seshes
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  picked boolean := coalesce(array_length(p_friends, 1), 0) > 0;
  s public.seshes;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_at is null or p_at < now() + interval '5 minutes' then raise exception 'Pick a time later than now.'; end if;
  if p_at > now() + interval '366 days' then raise exception 'You can plan a sesh up to a year ahead.'; end if;
  if (select count(*) from public.seshes where creator = me and ended_at is null and created_at > now()) >= 5 then
    raise exception 'You already have 5 seshes planned. Cancel one first.';
  end if;
  if coalesce(array_length(p_friends, 1), 0) > 50 then raise exception 'Pick up to 50 friends.'; end if;
  insert into public.seshes (creator, private, created_at) values (me, picked, p_at) returning * into s;
  insert into public.sesh_members (sesh_id, user_id) values (s.id, me);
  if picked and private.invite_friends(s.id, p_friends) = 0 then raise exception 'Pick at least one friend.'; end if;
  return s;
end;
$$;

revoke all on function public.plan_sesh(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.plan_sesh(timestamptz, uuid[]) to authenticated;

insert into private.migration_log (file) values ('0043_plan_a_year_ahead');
