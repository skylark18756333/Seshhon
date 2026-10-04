-- Add a friend by typing their username, and pick a username and password when you sign up.
-- Same rules as an invite link: a request the other person accepts, nothing found for anyone who
-- has blocked you or is hidden from you (women and non-binary only mode), and no list of usernames
-- to browse. Only an exact username works, and each person gets 20 misses a day.
-- Needs 0008 (usernames) and 0011 (private schema). Safe to run more than once.

-- Misses, so nobody can guess usernames one after another. Kept for a day.
create table if not exists private.username_misses (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists username_misses_user on private.username_misses (user_id, at);
alter table private.username_misses enable row level security;
revoke all on private.username_misses from public, anon, authenticated;

-- Whether a username is free, so sign up can say "taken" before making the account.
-- Says nothing else about whoever has it.
create or replace function public.username_free(p_username text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare uname text := lower(btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then raise exception 'Pick a username of 3 to 20 letters, numbers or _.'; end if;
  return not exists (select 1 from public.account_logins where username = uname and user_id <> auth.uid())
     and not exists (select 1 from auth.users where lower(email) = public.login_email(uname) and id <> auth.uid());
end;
$$;

-- Send a friend request to an exact username. A wrong username, someone who blocked you, and someone
-- you can't see all get the same answer, so it never gives away who is on the app or why.
-- Misses return a message instead of an error, so the miss is counted.
create or replace function public.request_friend_by_username(p_username text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  uname text := lower(btrim(coalesce(p_username, '')));
  other public.profiles;
  f public.friendships;
  nobody constant jsonb := jsonb_build_object('ok', false, 'message', 'No one with that username. Check the spelling with your friend.');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  uname := ltrim(uname, '@');
  if uname !~ '^[a-z0-9_]{3,20}$' then
    return jsonb_build_object('ok', false, 'message', 'Usernames are 3 to 20 letters, numbers or _.');
  end if;

  delete from private.username_misses where at < now() - interval '1 day';
  if (select count(*) from private.username_misses where user_id = me) >= 20 then
    return jsonb_build_object('ok', false, 'message', 'Too many tries today. Send your friend your invite link instead.');
  end if;

  select p.* into other from public.account_logins l join public.profiles p on p.id = l.user_id where l.username = uname;
  if not found then
    insert into private.username_misses (user_id) values (me);
    return nobody;
  end if;
  if other.id = me then return jsonb_build_object('ok', false, 'message', 'That''s your own username.'); end if;

  select * into f from public.friendships
  where (requester = me and addressee = other.id) or (requester = other.id and addressee = me);
  if found then
    if f.state = 'blocked' then
      insert into private.username_misses (user_id) values (me);
      return nobody;
    end if;
    if f.state = 'requested' and f.addressee = me then
      update public.friendships set state = 'accepted' where id = f.id;
      return jsonb_build_object('ok', true, 'name', other.name, 'state', 'accepted');
    end if;
    return jsonb_build_object('ok', true, 'name', other.name, 'state', f.state::text);
  end if;

  if private.hidden_from_me(other.id) then
    insert into private.username_misses (user_id) values (me);
    return nobody;
  end if;
  insert into public.friendships (requester, addressee) values (me, other.id);
  return jsonb_build_object('ok', true, 'name', other.name, 'state', 'requested');
end;
$$;

revoke all on function public.username_free(text), public.request_friend_by_username(text) from public, anon, authenticated;
grant execute on function public.username_free(text), public.request_friend_by_username(text) to authenticated;
