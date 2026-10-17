-- Planning ahead works on any colour. Green still means "I'm out now".
-- Before, someone on red couldn't see their friends' planned seshes, so they couldn't say they're in or plan
-- their own from the Sesh tab. Now:
--   * Planning a sesh and saying "I'm in" to a friend's planned sesh work on green, amber or red.
--   * Someone on red sees their friends' seshes that are still to come (who planned it, when, who's in).
--     Tonight's seshes and everyone's status stay hidden from them, as before.
--   * Starting a sesh now stays green only, and that now includes "Start it now" on a planned sesh.
--   * When a planned sesh goes live, the app asks the people in it who aren't green to go green.
--     Nobody is switched automatically.
-- Women-only mode, hidden statuses and private seshes still hide people exactly as before.
-- Needs 0025. Safe to run more than once.

-- True when the sesh hasn't started yet.
create or replace function private.sesh_is_planned(p_sesh uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((select x.ended_at is null and x.created_at > now() from public.seshes x where x.id = p_sesh), false);
$$;
revoke all on function private.sesh_is_planned(uuid) from public, anon;
grant execute on function private.sesh_is_planned(uuid) to authenticated;

-- ---------------------------------------------------------------- access rules
-- Same as 0024, plus a friend's planned sesh is readable whatever your own colour.
drop policy if exists seshes_read on public.seshes;
create policy seshes_read on public.seshes for select to authenticated using (
  creator = auth.uid() or public.is_sesh_member(id, auth.uid())
  or (public.are_friends(creator, auth.uid()) and (public.i_am_visible() or (ended_at is null and created_at > now()))
      and not private.hidden_from_me(creator) and not private.sesh_closed_to_me(id))
);

drop policy if exists members_read on public.sesh_members;
create policy members_read on public.sesh_members for select to authenticated using (
  user_id = auth.uid() or public.is_sesh_member(sesh_id, auth.uid())
  or (public.are_friends(public.sesh_creator(sesh_id), auth.uid())
      and (public.i_am_visible() or private.sesh_is_planned(sesh_id))
      and not private.hidden_from_me(public.sesh_creator(sesh_id)) and not private.sesh_closed_to_me(sesh_id))
);

-- ---------------------------------------------------------------- starting a planned sesh early
-- Same as 0025, plus you need to be green, as for starting any sesh now.
create or replace function public.start_planned_sesh(p_sesh uuid) returns public.seshes
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.seshes;
begin
  if not exists (select 1 from public.seshes where id = p_sesh and creator = me and ended_at is null and created_at > now()) then
    raise exception 'Only the person who planned the sesh can start it early.';
  end if;
  if not exists (select 1 from public.statuses where user_id = me and colour = 'on' and expires_at > now()) then
    raise exception 'Go green to start it now.';
  end if;
  if exists (select 1 from public.seshes where creator = me and ended_at is null
             and created_at <= now() and created_at > now() - interval '8 hours') then
    raise exception 'You already have a sesh going. End it first.';
  end if;
  update public.seshes set created_at = now() where id = p_sesh returning * into s;
  return s;
end;
$$;
revoke all on function public.start_planned_sesh(uuid) from public, anon, authenticated;
grant execute on function public.start_planned_sesh(uuid) to authenticated;
