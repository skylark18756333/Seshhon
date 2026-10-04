-- Security hardening after a review of the whole database (October 2026).
--   1. Anything added to the database later starts locked, instead of open to everyone.
--   2. A blocked person can no longer undo the block or turn it into a friendship.
--   3. Only the functions can change a sesh, so its start time can't be moved to keep it alive.
--   4. Limits on friend requests, reports and rating tags, so one account can't flood the database.
--   5. Old data is deleted: a sesh (who joined, the votes, the chat) as soon as it ends, used deal codes after the night,
--      and sign-ins that never finished signing up after 2 days.
-- Safe to run more than once.

-- ---------------------------------------------------------------- 1. new tables and functions start locked
-- Supabase gives signed-out and signed-in visitors full rights on anything new in the public
-- schema. Each migration so far has taken those rights back by hand; this stops them being
-- handed out in the first place, so a forgotten "revoke" can't leave a new table open.
-- From now on a new table or function needs an explicit "grant" before the app can use it.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Postgres lets everyone (PUBLIC) call new functions, and that default can only be removed for all schemas at once.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------- 2. blocks stay blocked
-- Before: the person asked in any friendship row could change its state, including a block row
-- (block_user makes the blocker the requester, so the blocked person is the addressee). They could
-- set a block to 'accepted' and see the blocker's status again, or delete it and send a new request.
-- Now the person asked can only accept a pending request, and only the blocker can remove a block.
-- Blocking always goes through block_user().
drop policy if exists friendships_answer on public.friendships;
create policy friendships_answer on public.friendships for update to authenticated
  using (addressee = auth.uid() and state = 'requested')
  with check (addressee = auth.uid() and state = 'accepted');

drop policy if exists friendships_remove on public.friendships;
create policy friendships_remove on public.friendships for delete to authenticated
  using (
    (state <> 'blocked' and (requester = auth.uid() or addressee = auth.uid()))
    or (state = 'blocked' and requester = auth.uid())
  );

-- At most 30 friend requests a day per person, however they are sent.
create or replace function public.limit_friend_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'requested' and (
    select count(*) from public.friendships
    where requester = new.requester and state <> 'blocked' and created_at > now() - interval '1 day'
  ) >= 30 then
    raise exception 'You have sent a lot of friend requests today. Try again tomorrow.';
  end if;
  return new;
end;
$$;
drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit before insert on public.friendships
  for each row execute function public.limit_friend_requests();

-- ---------------------------------------------------------------- 3. seshes change only through functions
-- end_sesh(), lock_sesh() and start_sesh() all run with the owner's rights, so the app never
-- needs to write to the table directly. Before, the creator could edit any column, for example
-- moving created_at forward so a sesh (and its chat) never expired.
revoke insert, update, delete on public.seshes from authenticated;
drop policy if exists seshes_end on public.seshes;

-- ---------------------------------------------------------------- 4. limits on what one account can store
-- rate_venue() limits tags, but a direct write to the table could store any number of any size.
-- "not valid" means rows already there are not re-checked; every new or changed row is.
alter table public.ratings drop constraint if exists ratings_tags_limit;
alter table public.ratings add constraint ratings_tags_limit
  check (cardinality(tags) <= 5 and char_length(array_to_string(tags, '')) <= 120) not valid;

-- Same as 0004, plus at most 20 reports a day per person.
create or replace function public.report_message(p_message uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m public.messages;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if (select count(*) from public.reports where reporter = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of reports today. Try again tomorrow.';
  end if;
  select * into m from public.messages where id = p_message;
  if not found or not public.is_sesh_member(m.sesh_id, me) then raise exception 'That message is no longer there.'; end if;
  insert into public.reports (reporter, reported, sesh_id, message_body, reason)
  values (me, m.sender, m.sesh_id, m.body, left(coalesce(p_reason, ''), 200));
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------- 5. delete old data
-- Australian Privacy Principle 11.2: personal information that is no longer needed is destroyed.

-- Ending a sesh deletes it straight away, with who joined, the votes and the chat.
-- (Before, it was only marked as ended and kept.)
create or replace function public.end_sesh(p_sesh uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from public.seshes where id = p_sesh and creator = auth.uid();
  if not found then raise exception 'Only the person who started the sesh can end it.'; end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.end_sesh(uuid) from public, anon;
grant execute on function public.end_sesh(uuid) to authenticated;
create or replace function public.purge_old_data() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; k integer;
begin
  -- Seshes that have ended, or run out (8 hours after they started), with who joined, the votes and any chat left.
  delete from public.seshes where ended_at is not null or created_at < now() - interval '8 hours';
  get diagnostics k = row_count; n := n + k;
  -- Deal codes: a record is only needed for the night, so the same deal can't be used twice.
  delete from public.redemptions where night < public.night_of() - 1;
  get diagnostics k = row_count; n := n + k;
  -- Sign-ins that never finished signing up (no profile) after 2 days, e.g. under-18s or spam.
  -- Their age check records go with them. Only on real Supabase, where auth.users has these columns.
  begin
    execute $q$
      delete from auth.users u
      where u.is_anonymous and u.created_at < now() - interval '2 days'
        and not exists (select 1 from public.profiles p where p.id = u.id)
    $q$;
    get diagnostics k = row_count; n := n + k;
  exception when undefined_column or insufficient_privilege then
    null;
  end;
  return n;
end;
$$;

-- Chat clean-up (which also runs now and then when people chat) clears old data too.
create or replace function public.purge_chat() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.messages m
  where m.created_at < now() - interval '8 hours'
     or exists (select 1 from public.seshes s where s.id = m.sesh_id and (s.ended_at is not null or s.created_at < now() - interval '8 hours'));
  get diagnostics n = row_count;
  delete from public.reports where created_at < now() - interval '90 days';
  perform public.purge_old_data();
  return n;
end;
$$;

revoke all on function public.limit_friend_requests(), public.purge_old_data(), public.purge_chat()
  from public, anon, authenticated;
revoke all on function public.report_message(uuid, text) from public, anon;
grant execute on function public.report_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------- schedule
-- Switch on pg_cron if this project allows it (Supabase does), then run the clean-ups every
-- 5 minutes. Earlier migrations only scheduled them if pg_cron was already on.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    null; -- not available here (for example the local test database); the clean-ups still run from the chat
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('seshhon-expire-statuses', '*/5 * * * *', 'select public.expire_statuses()');
    perform cron.schedule('seshhon-purge-chat', '*/5 * * * *', 'select public.purge_chat()');
  end if;
end;
$$;
