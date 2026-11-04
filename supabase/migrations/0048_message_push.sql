-- 0048: phone notifications for new messages from friends and for sesh chat.
-- Before this, only friend requests, sesh invites, friends going Green and crew catch-ups sent a notification; new
-- messages only showed inside the app. A notification never carries the message itself: friend messages are locked so
-- only the phones can read them, and sesh chat stays inside the app too. It says only who wrote.
-- Each sender sends at most one notification a minute per person (one per sesh for sesh chat), so a burst of
-- messages does not buzz the phone over and over. Blocks, hidden status and women-only mode are honoured by
-- private.push_enqueue, as for every other kind. Both kinds are on by default and can be switched off on the You page.
-- Needs 0004, 0035 and 0038. Safe to run more than once.

insert into private.push_kinds (kind, label, hint, default_on, live, sort) values
  ('message', 'Messages', 'When a friend sends you a message. It says who, never what.', true, true, 3),
  ('sesh_chat', 'Sesh chat', 'When someone writes in a sesh you are in. It says who, never what.', true, true, 4)
on conflict (kind) do update set label = excluded.label, hint = excluded.hint, default_on = excluded.default_on, live = true, sort = excluded.sort;
update private.push_kinds set sort = 5 where kind = 'friend_green';
update private.push_kinds set sort = 6 where kind = 'catch_up';

-- A friend left a message for you.
create or replace function private.push_on_friend_message() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  begin
    if private.push_enqueue(new.to_user, 'message', new.from_user, 'New message from ' || private.push_name(new.from_user),
         'Open Crewzy to read it.', 'messages', new.from_user::text, interval '1 minute') then
      perform private.push_poke();
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function private.push_on_friend_message() from public, anon, authenticated;
drop trigger if exists message_queue_push on private.message_queue;
create trigger message_queue_push after insert on private.message_queue
for each row execute function private.push_on_friend_message();

-- Someone wrote in a sesh: tell the other people in it.
create or replace function private.push_on_sesh_chat() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare r record; n integer := 0; who text;
begin
  begin
    who := private.push_name(new.sender);
    for r in select m.user_id from public.sesh_members m where m.sesh_id = new.sesh_id and m.user_id <> new.sender loop
      if private.push_enqueue(r.user_id, 'sesh_chat', new.sender, who || ' wrote in your sesh',
           'Open Crewzy to read it.', 'sesh', new.sesh_id::text || ':' || new.sender::text, interval '1 minute') then
        n := n + 1;
      end if;
    end loop;
    if n > 0 then perform private.push_poke(); end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function private.push_on_sesh_chat() from public, anon, authenticated;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
for each row execute function private.push_on_sesh_chat();

insert into private.migration_log (file) values ('0048_message_push');
