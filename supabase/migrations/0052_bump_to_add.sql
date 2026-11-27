-- 0052: bump phones to add a friend. Both people open "Bump to add" and knock their phones together (or both tap
-- Bump). Each phone tells the server "I bumped just now"; two bumps within 2 seconds of each other are paired by
-- timing only. No location is sent or kept. If a third bump lands in the same 2 seconds it's too busy to tell who's
-- who, so that pair is called off and everyone is asked to bump again. Each person then sees the other's name and taps Add; when both do, they're friends
-- at once. Nothing happens otherwise, and bumps and pairs are deleted after a minute.
-- Needs 0001, 0004, 0019 and 0035. Safe to run more than once.
create table if not exists private.bumps (user_id uuid primary key references public.profiles (id) on delete cascade, at timestamptz not null default clock_timestamp(), pair uuid);
create table if not exists private.bump_pairs (id uuid primary key default gen_random_uuid(), a uuid not null references public.profiles (id) on delete cascade, b uuid not null references public.profiles (id) on delete cascade, at timestamptz not null default now(), a_ok boolean, b_ok boolean);
alter table private.bumps enable row level security;
alter table private.bump_pairs enable row level security;
revoke all on private.bumps, private.bump_pairs from public, anon, authenticated;

-- What my phone shows for a pair: the other person's name and username, and where the yes/no answers stand.
create or replace function private.bump_view(p uuid) returns jsonb language sql stable security definer set search_path = public, private as $f$
  select jsonb_build_object('pair', bp.id, 'id', o.id, 'name', o.name, 'username', (select l.username from public.account_logins l where l.user_id = o.id),
    'mine', case when bp.a = auth.uid() then bp.a_ok else bp.b_ok end, 'theirs', case when bp.a = auth.uid() then bp.b_ok else bp.a_ok end,
    'friends', exists (select 1 from public.friendships f where f.state = 'accepted' and ((f.requester = bp.a and f.addressee = bp.b) or (f.requester = bp.b and f.addressee = bp.a))))
  from private.bump_pairs bp join public.profiles o on o.id = case when bp.a = auth.uid() then bp.b else bp.a end
  where bp.id = p and auth.uid() in (bp.a, bp.b) and bp.at > now() - interval '1 minute' $f$;
revoke all on function private.bump_view(uuid) from public, anon, authenticated;

-- I bumped. Returns the pair if someone else bumped within 2 seconds, {"busy": true} if several did, or null (then
-- the phone asks bump_check for a moment, in case the other phone's bump arrives just after mine).
create or replace function public.bump() returns jsonb language plpgsql security definer set search_path = public, private as $f$
declare me uuid := auth.uid(); n integer; other uuid; p uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'Sign in first.'; end if;
  if private.role_of(me) = 'venue' then raise exception 'Venue accounts can''t add friends.'; end if;
  delete from private.bumps where at < now() - interval '1 minute';
  delete from private.bump_pairs where at < now() - interval '1 minute';
  insert into private.bumps (user_id, at, pair) values (me, clock_timestamp(), null) on conflict (user_id) do update set at = excluded.at, pair = null;
  select count(*), min(b.user_id::text)::uuid into n, other from private.bumps b
  where b.user_id <> me and b.pair is null and b.at between clock_timestamp() - interval '2 seconds' and clock_timestamp() + interval '2 seconds'
    and not public.blocked_between(me, b.user_id) and not private.hidden_for(me, b.user_id) and not private.hidden_for(b.user_id, me) and private.role_of(b.user_id) <> 'venue';
  if n = 0 then
    -- Two other people paired a moment ago, within my 2 seconds: a crowd is bumping, so nobody can be sure who's who.
    -- That pair is called off and everyone is asked to bump again.
    select bp.id into p from private.bump_pairs bp where bp.at > now() - interval '2 seconds' and me not in (bp.a, bp.b) limit 1;
    if p is null then return null; end if;
    update private.bumps set pair = null, at = now() - interval '10 seconds' where pair = p or user_id = me;
    delete from private.bump_pairs where id = p;
    return jsonb_build_object('busy', true);
  end if;
  if n > 1 then return jsonb_build_object('busy', true); end if;
  insert into private.bump_pairs (a, b) values (other, me) returning id into p;
  update private.bumps set pair = p where user_id in (me, other);
  return private.bump_view(p);
end $f$;

-- After bumping: has someone been paired with me yet?
create or replace function public.bump_check() returns jsonb language sql security definer set search_path = public, private as $f$
  select private.bump_view(b.pair) from private.bumps b where b.user_id = auth.uid() and b.pair is not null $f$;

-- Add (true) or No (false). When both say Add, they're friends at once (a waiting request either way is accepted).
create or replace function public.bump_answer(p_pair uuid, p_add boolean) returns jsonb language plpgsql security definer set search_path = public, private as $f$
declare bp private.bump_pairs; me uuid := auth.uid(); other uuid; f public.friendships;
begin
  select * into bp from private.bump_pairs where id = p_pair and me in (a, b) and at > now() - interval '1 minute';
  if not found then raise exception 'That bump has run out. Bump again.'; end if;
  if bp.a = me then update private.bump_pairs set a_ok = p_add where id = p_pair returning * into bp;
  else update private.bump_pairs set b_ok = p_add where id = p_pair returning * into bp; end if;
  other := case when bp.a = me then bp.b else bp.a end;
  if bp.a_ok and bp.b_ok then
    select * into f from public.friendships where (requester = me and addressee = other) or (requester = other and addressee = me);
    if not found then
      insert into public.friendships (requester, addressee) values (me, other) returning * into f;
    end if;
    if f.state = 'requested' then update public.friendships set state = 'accepted' where id = f.id; end if;
  end if;
  return private.bump_view(p_pair);
end $f$;

-- The pop-up asks again every second or so while waiting for the other person's answer.
create or replace function public.bump_status(p_pair uuid) returns jsonb language sql security definer set search_path = public, private as $f$ select private.bump_view(p_pair) $f$;

revoke all on function public.bump(), public.bump_check(), public.bump_answer(uuid, boolean), public.bump_status(uuid) from public, anon;
grant execute on function public.bump(), public.bump_check(), public.bump_answer(uuid, boolean), public.bump_status(uuid) to authenticated;
notify pgrst, 'reload schema';
insert into private.migration_log (file) values ('0052_bump_to_add');
