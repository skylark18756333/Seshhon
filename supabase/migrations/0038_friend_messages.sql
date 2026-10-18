-- Messages between friends that Frendzy cannot read and does not keep.
-- The phones lock each message (the key to unlock it never leaves the friend's phone), so this database only ever holds
-- scrambled text. A message sits here only until the friend's phone has collected it, then it is deleted. Anything
-- never collected is deleted after 7 days. Chat history lives on the phones, not here.
-- Needs 0011 (private schema, are_friends). Safe to run more than once.

-- Each person's PUBLIC key (the lock). The private key (the unlock) is made on the phone and stays there.
create table if not exists private.message_keys (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  public_key text not null check (char_length(public_key) between 20 and 100),
  updated_at timestamptz not null default now()
);
alter table private.message_keys enable row level security;
revoke all on private.message_keys from public, anon, authenticated;

-- Messages waiting to be collected. body is scrambled text; the server cannot read it.
create table if not exists private.message_queue (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  sender_key text not null check (char_length(sender_key) between 20 and 100),
  body text not null check (char_length(body) between 1 and 6000),
  created_at timestamptz not null default now()
);
create index if not exists message_queue_to on private.message_queue (to_user, created_at);
alter table private.message_queue enable row level security;
revoke all on private.message_queue from public, anon, authenticated;

-- Save my public key (the phone makes the pair; only the public half comes here).
create or replace function public.set_message_key(p_key text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into private.message_keys (user_id, public_key) values (auth.uid(), p_key)
  on conflict (user_id) do update set public_key = excluded.public_key, updated_at = now();
end;
$$;

-- A friend's public key, so my phone can lock a message only they can unlock. Friends only.
create or replace function public.friend_message_key(p_friend uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select k.public_key from private.message_keys k
  where k.user_id = p_friend and public.are_friends(p_friend, auth.uid());
$$;

-- Leave a scrambled message for a friend. Friends only (blocked people are not friends). Slow down floods.
create or replace function public.send_friend_message(p_to uuid, p_sender_key text, p_body text) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_to is null or p_to = me or not public.are_friends(p_to, me) then raise exception 'You can only message a friend.'; end if;
  if (select count(*) from private.message_queue where from_user = me and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down a little, then try again.';
  end if;
  if (select count(*) from private.message_queue where from_user = me and to_user = p_to) >= 200 then
    raise exception 'They have not collected your last messages yet.';
  end if;
  delete from private.message_queue where created_at < now() - interval '7 days';
  insert into private.message_queue (from_user, to_user, sender_key, body) values (me, p_to, p_sender_key, p_body)
  returning id into new_id;
  return new_id;
end;
$$;

-- Messages waiting for me (oldest first). They stay until my phone confirms it has them.
create or replace function public.my_friend_messages() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'from', q.from_user, 'key', q.sender_key, 'body', q.body, 'at', q.created_at)
                            order by q.created_at), '[]'::jsonb)
  from private.message_queue q
  where q.to_user = auth.uid() and q.created_at > now() - interval '7 days';
$$;

-- My phone has them: delete them from here.
create or replace function public.got_friend_messages(p_ids uuid[]) returns void
language sql security definer set search_path = public, private as $$
  delete from private.message_queue where to_user = auth.uid() and id = any (p_ids);
$$;

revoke all on function public.set_message_key(text), public.friend_message_key(uuid), public.send_friend_message(uuid, text, text),
  public.my_friend_messages(), public.got_friend_messages(uuid[]) from public, anon;
grant execute on function public.set_message_key(text), public.friend_message_key(uuid), public.send_friend_message(uuid, text, text),
  public.my_friend_messages(), public.got_friend_messages(uuid[]) to authenticated;

-- No longer friends: drop anything waiting between the two.
create or replace function private.forget_friend_messages() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.message_queue
  where (from_user = old.requester and to_user = old.addressee) or (from_user = old.addressee and to_user = old.requester);
  return old;
end;
$$;
revoke all on function private.forget_friend_messages() from public, anon, authenticated;
drop trigger if exists friendships_forget_messages on public.friendships;
create trigger friendships_forget_messages after delete on public.friendships
for each row execute function private.forget_friend_messages();
