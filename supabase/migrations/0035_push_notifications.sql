-- Push notifications for the phone app.
--
-- WHAT IT STORES (all in the private schema, no policies, so the app only reaches it through the functions below):
--   private.push_tokens   the phone's Expo push token, one row per phone (up to 5 per person). A phone that signs
--                         in as someone else takes the token over; logging out removes it.
--   private.push_kinds    the kinds of notification, whether each is on by default, and whether it is built yet.
--   private.push_settings one row per person per kind they changed from the default.
--   private.push_queue    notifications waiting to be sent. The recipient's tokens are looked up only at the moment
--                         of sending, so a logged-out phone or a switched-off kind gets nothing.
--   private.push_sent     "already told them about this" marks, so the same thing is never sent twice in a row.
--   private.push_config   the address and shared secret of the "push" Edge Function (see the bottom of this file).
--
-- DEFAULTS (what a person gets before they touch the switches):
--   ON   friend_request  someone added you, or accepted you. It is an answer to something addressed to you.
--   ON   invite          a friend invited you to a sesh. Same: it is addressed to you.
--   OFF  friend_green    "a friend went Green". It tells you when other people are out, so it is only sent after
--                        you switch it on, and never more than once every 3 hours per friend.
--   OFF  catch_up        "enough of your crew are free". It summarises free time that people shared with a crew,
--                        so it is opt-in as well, and at most one a day.
--   Not built yet (rows exist with live = false, so nothing is ever sent for them): home_safe (a "did you get home
--   OK?" nudge) and favourite_venue (alerts for venues you follow). To build one: write a trigger or job that calls
--   private.push_enqueue(...) with that kind, then set live = true. Every rule below is applied inside
--   push_enqueue, so a new kind cannot skip them.
--
-- WHO GETS NOTHING, EVER (push_enqueue checks all of these for every notification):
--   - someone with no token, or who switched that kind off
--   - someone blocked either way (public.blocks)
--   - when the notification is about a person (the actor): anyone that person hides from, i.e. women-only mode
--     (0011/0012) when the recipient has not said they are a woman or non-binary, and anyone they hid their status
--     from (0029). It is the same rule private.hidden_from_me() applies in the app, but for an explicit recipient,
--     because a database trigger has no "person asking" (private.hidden_for).
--   - "went Green" only goes to accepted friends who are On or Amber themselves, because the app only shows a
--     friend's status to someone who is visible themselves (public.i_am_visible, 0002).
--   - The text only ever has a first name and a fixed sentence. No location, venue, time or sesh members, and it
--     never says who else was told. The tap data is just which screen to open.
--
-- Sending works like this: the triggers below put a row in private.push_queue, then poke the "push" Edge Function
-- (supabase/functions/push) through pg_net when it is set up. pg_cron pokes it every minute as a back-up. The function
-- calls push_take() (service role only), sends through Expo's push service, then calls push_finish(), which also drops
-- tokens Expo says are dead. A failed push never stops the action that caused it: every trigger swallows errors.
--
-- Needs 0011, 0012, 0024, 0029 and 0031. Safe to run more than once.

create schema if not exists private;

-- ---------------------------------------------------------------- tables
create table if not exists private.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,80}\]$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null default 'android' check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on private.push_tokens (user_id);

create table if not exists private.push_kinds (
  kind text primary key,
  label text not null,
  hint text not null,
  default_on boolean not null,
  live boolean not null default false,
  sort integer not null default 0
);
insert into private.push_kinds (kind, label, hint, default_on, live, sort) values
  ('friend_request', 'Friend requests', 'When someone adds you, or accepts your request.', true, true, 1),
  ('invite', 'Sesh invites', 'When a friend invites you to a sesh.', true, true, 2),
  ('friend_green', 'Friends going Green', 'When a friend you can see goes Green. Off until you switch it on, so Frendzy never tells you who is out unless you ask.', false, true, 3),
  ('catch_up', 'Crew catch-ups', 'A nudge when enough of a crew or bestie are free at the same time. At most one a day.', false, true, 4),
  ('home_safe', 'Home safe', 'A nudge to say you got home OK. Coming later.', false, false, 5),
  ('favourite_venue', 'Favourite venues', 'Alerts from venues you follow. Coming later.', false, false, 6)
on conflict (kind) do update set label = excluded.label, hint = excluded.hint, default_on = excluded.default_on, sort = excluded.sort;
-- "live" is not touched on a re-run, so a kind built later stays switched on.

create table if not exists private.push_settings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null references private.push_kinds (kind) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table if not exists private.push_queue (
  id bigint generated always as identity primary key,
  recipient uuid not null references public.profiles (id) on delete cascade,
  kind text not null references private.push_kinds (kind) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0
);
create index if not exists push_queue_waiting on private.push_queue (id) where claimed_at is null;

create table if not exists private.push_sent (
  recipient uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  at timestamptz not null default now(),
  primary key (recipient, kind, dedupe_key)
);

create table if not exists private.push_config (
  only_row boolean primary key default true check (only_row),
  url text,
  secret text
);

alter table private.push_tokens enable row level security;
alter table private.push_kinds enable row level security;
alter table private.push_settings enable row level security;
alter table private.push_queue enable row level security;
alter table private.push_sent enable row level security;
alter table private.push_config enable row level security;
revoke all on private.push_tokens, private.push_kinds, private.push_settings, private.push_queue, private.push_sent,
  private.push_config from public, anon, authenticated;

-- ---------------------------------------------------------------- rules
-- True when "owner" is hidden from "viewer": the owner is in women-only mode and the viewer has not said they are a
-- woman or non-binary, or the owner hid their status from the viewer. private.hidden_from_me() for an explicit person.
create or replace function private.hidden_for(p_owner uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select p_owner <> p_viewer and (
    (exists (select 1 from private.safety s where s.user_id = p_owner and s.women_only) and not private.in_safe_group(p_viewer))
    or exists (select 1 from private.status_hides h where h.owner = p_owner and h.viewer = p_viewer));
$$;
revoke all on function private.hidden_for(uuid, uuid) from public, anon, authenticated;

-- Puts one notification in the queue if every rule allows it. Returns whether it did. p_actor is the person it is
-- about (null for none); p_key and p_cooldown stop the same thing being sent again within the cooldown.
create or replace function private.push_enqueue(
  p_to uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_screen text, p_key text, p_cooldown interval
) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare k private.push_kinds; wanted boolean; got boolean;
begin
  if p_to is null or p_to = p_actor then return false; end if;
  select * into k from private.push_kinds where kind = p_kind and live;
  if not found then return false; end if;
  if not exists (select 1 from private.push_tokens where user_id = p_to) then return false; end if;
  select coalesce((select s.enabled from private.push_settings s where s.user_id = p_to and s.kind = p_kind), k.default_on) into wanted;
  if not wanted then return false; end if;
  if p_actor is not null and (public.blocked_between(p_actor, p_to) or private.hidden_for(p_actor, p_to)) then return false; end if;
  if p_key is not null then
    insert into private.push_sent (recipient, kind, dedupe_key) values (p_to, p_kind, p_key)
    on conflict (recipient, kind, dedupe_key) do update set at = now() where private.push_sent.at < now() - p_cooldown
    returning true into got;
    if got is null then return false; end if;
  end if;
  insert into private.push_queue (recipient, kind, title, body, data)
  values (p_to, p_kind, left(p_title, 100), left(p_body, 200), jsonb_build_object('kind', p_kind, 'screen', p_screen));
  return true;
end;
$$;
revoke all on function private.push_enqueue(uuid, text, uuid, text, text, text, text, interval) from public, anon, authenticated;

-- Wakes the "push" Edge Function so it sends what is waiting. Does nothing until private.set_push_config() has been
-- run and the pg_net extension is on; the once-a-minute job below covers the gap either way.
create or replace function private.push_poke() returns void
language plpgsql security definer set search_path = public, private as $$
declare c private.push_config;
begin
  select * into c from private.push_config;
  if not found or c.url is null or c.secret is null then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using c.url, jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secret), '{}'::jsonb;
exception when others then
  null;
end;
$$;
revoke all on function private.push_poke() from public, anon, authenticated;

-- Run once in the SQL editor after deploying the Edge Function (nobody else can call it):
--   select private.set_push_config('https://YOUR-PROJECT.supabase.co/functions/v1/push', 'the same secret as PUSH_SECRET');
create or replace function private.set_push_config(p_url text, p_secret text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if p_url is null or p_url !~ '^https://' or coalesce(length(p_secret), 0) < 16 then
    raise exception 'Give the function address (https://...) and a secret of at least 16 characters.';
  end if;
  insert into private.push_config (only_row, url, secret) values (true, p_url, p_secret)
  on conflict (only_row) do update set url = excluded.url, secret = excluded.secret;
end;
$$;
revoke all on function private.set_push_config(text, text) from public, anon, authenticated;

create or replace function private.push_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(split_part(btrim(name), ' ', 1), ''), 'A friend') from public.profiles where id = p_user;
$$;
revoke all on function private.push_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- triggers (each one swallows errors: a push must never break the action)
-- A friend goes Green: tell the friends who are allowed to see that, and who asked to hear it.
create or replace function private.push_on_status() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare r record; n integer := 0; who text;
begin
  begin
    if new.colour = 'on' and new.expires_at > now()
       and (tg_op = 'INSERT' or old.colour is distinct from 'on' or old.expires_at is null or old.expires_at <= now()) then
      who := private.push_name(new.user_id);
      for r in
        select case when f.requester = new.user_id then f.addressee else f.requester end as friend
        from public.friendships f where f.state = 'accepted' and new.user_id in (f.requester, f.addressee)
      loop
        -- The app only shows a friend's status to someone who is On or Amber themselves, so the push follows suit.
        if exists (select 1 from public.statuses s where s.user_id = r.friend and s.colour <> 'off' and s.expires_at > now())
           and private.push_enqueue(r.friend, 'friend_green', new.user_id, who || ' just went Green', 'Open Frendzy to see who is out.', 'home', new.user_id::text, interval '3 hours') then
          n := n + 1;
        end if;
      end loop;
      if n > 0 then perform private.push_poke(); end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function private.push_on_status() from public, anon, authenticated;
drop trigger if exists statuses_push on public.statuses;
create trigger statuses_push after insert or update on public.statuses
for each row execute function private.push_on_status();

-- Invited to a sesh (planned or started). It is addressed to the invited person, so it does not need them to be On
-- themselves; it says only who invited them.
create or replace function private.push_on_invite() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare host uuid;
begin
  begin
    select creator into host from public.seshes where id = new.sesh_id and ended_at is null;
    if host is not null and private.friends_pair(host, new.user_id)
       and private.push_enqueue(new.user_id, 'invite', host, private.push_name(host) || ' invited you to a sesh', 'Open Frendzy to see it and say if you are in.', 'sesh', new.sesh_id::text, interval '1 day') then
      perform private.push_poke();
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function private.push_on_invite() from public, anon, authenticated;
drop trigger if exists sesh_invites_push on public.sesh_invites;
create trigger sesh_invites_push after insert on public.sesh_invites
for each row execute function private.push_on_invite();

-- A friend request arrived, or the one you sent was accepted.
create or replace function private.push_on_friendship() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare sent boolean := false;
begin
  begin
    if tg_op = 'INSERT' and new.state = 'requested' then
      sent := private.push_enqueue(new.addressee, 'friend_request', new.requester, private.push_name(new.requester) || ' wants to be friends',
        'Open Frendzy to say yes or no.', 'home', new.requester::text, interval '1 day');
    elsif tg_op = 'UPDATE' and old.state = 'requested' and new.state = 'accepted' then
      sent := private.push_enqueue(new.requester, 'friend_request', new.addressee, private.push_name(new.addressee) || ' accepted your friend request',
        'You are friends on Frendzy now.', 'home', 'accepted-' || new.addressee::text, interval '1 day');
    end if;
    if sent then perform private.push_poke(); end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function private.push_on_friendship() from public, anon, authenticated;
drop trigger if exists friendships_push on public.friendships;
create trigger friendships_push after insert or update on public.friendships
for each row execute function private.push_on_friendship();

-- Two people who are accepted friends (are_friends() only answers for the person asking, which a trigger does not have).
create or replace function private.friends_pair(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.state = 'accepted' and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;
revoke all on function private.friends_pair(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- crew catch-up nudges
-- Once an hour (daytime only, local time) for each person who switched "Crew catch-ups" on: take their best suggestion
-- from catch_up_suggestions() (0031), asked as that person so it counts exactly who they may see, and send one nudge.
-- At most one a day, and never the same slot twice in a week. It says the crew or bestie's name and how many are free.
create or replace function private.push_catch_ups(p_any_hour boolean default false) returns integer
language plpgsql security definer set search_path = public, private as $$
declare
  u record; sug jsonb; item jsonb; sent integer := 0; hour integer := extract(hour from public.local_now())::int;
  parts jsonb := '{"morning": "morning", "arvo": "arvo", "night": "night"}';
begin
  delete from private.push_queue where created_at < now() - interval '1 day';
  delete from private.push_sent where at < now() - interval '14 days';
  if not p_any_hour and (hour < 9 or hour > 20) then return 0; end if;
  for u in
    select distinct t.user_id from private.push_tokens t
    where coalesce((select s.enabled from private.push_settings s where s.user_id = t.user_id and s.kind = 'catch_up'),
                   (select k.default_on from private.push_kinds k where k.kind = 'catch_up'))
      and not exists (select 1 from private.push_sent d where d.recipient = t.user_id and d.kind = 'catch_up' and d.dedupe_key = 'daily' and d.at > now() - interval '20 hours')
  loop
    begin
      perform set_config('request.jwt.claim.sub', u.user_id::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
      sug := public.catch_up_suggestions();
      for item in select * from jsonb_array_elements(sug) loop
        if private.push_enqueue(u.user_id, 'catch_up', null, 'Time for a catch-up?',
             (item ->> 'label') || ': ' || (item ->> 'free') || ' of ' || (item ->> 'of') || ' free ' || trim(to_char((item ->> 'day')::date, 'FMDay')) || ' ' || coalesce(parts ->> (item ->> 'part'), 'night'),
             'crews', (item ->> 'target') || '|' || (item ->> 'day') || '|' || (item ->> 'part'), interval '7 days') then
          insert into private.push_sent (recipient, kind, dedupe_key) values (u.user_id, 'catch_up', 'daily')
          on conflict (recipient, kind, dedupe_key) do update set at = now();
          sent := sent + 1;
          exit;
        end if;
      end loop;
    exception when others then
      null;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if sent > 0 then perform private.push_poke(); end if;
  return sent;
end;
$$;
revoke all on function private.push_catch_ups(boolean) from public, anon, authenticated;

-- Once a minute: poke the sender if anything is waiting (covers a poke that was lost, and the case where pg_net is off).
create or replace function private.push_poke_if_waiting() returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from private.push_queue where attempts < 3 and (claimed_at is null or claimed_at < now() - interval '2 minutes')) then
    perform private.push_poke();
  end if;
end;
$$;
revoke all on function private.push_poke_if_waiting() from public, anon, authenticated;

-- ---------------------------------------------------------------- what the app calls
-- Saves this phone's token against the signed-in account. A token belongs to one account at a time: signing in as
-- someone else on the same phone takes it over. Up to 5 phones per person (the newest 5 stay).
create or replace function public.register_push_token(p_token text, p_platform text default 'android') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid(); plat text := lower(btrim(coalesce(p_platform, 'android')));
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,80}\]$' then raise exception 'That is not a push token.'; end if;
  if plat not in ('android', 'ios') then plat := 'android'; end if;
  insert into private.push_tokens (token, user_id, platform) values (p_token, me, plat)
  on conflict (token) do update set user_id = me, platform = excluded.platform, updated_at = now();
  delete from private.push_tokens where user_id = me and token in (
    select token from private.push_tokens where user_id = me order by updated_at desc, created_at desc offset 5);
  return jsonb_build_object('ok', true);
end;
$$;

-- Removes this phone's token (or, with no token given, every phone's) from the signed-in account. Never touches anyone else's.
create or replace function public.unregister_push_token(p_token text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  delete from private.push_tokens where user_id = me and (p_token is null or token = p_token);
  return jsonb_build_object('ok', true);
end;
$$;

-- The switches: every kind that is built, with whether it is on for this person. "registered" says whether any phone
-- of theirs can receive pushes at all.
create or replace function public.my_push_settings() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'registered', exists (select 1 from private.push_tokens where user_id = me),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'label', k.label, 'hint', k.hint,
        'on', coalesce((select s.enabled from private.push_settings s where s.user_id = me and s.kind = k.kind), k.default_on))
        order by k.sort)
      from private.push_kinds k where k.live), '[]'::jsonb));
end;
$$;

create or replace function public.set_push_setting(p_kind text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  if p_enabled is null or not exists (select 1 from private.push_kinds where kind = p_kind and live) then raise exception 'That is not a notification you can switch.'; end if;
  insert into private.push_settings (user_id, kind, enabled) values (me, p_kind, p_enabled)
  on conflict (user_id, kind) do update set enabled = excluded.enabled, updated_at = now();
  -- Switching a kind off also drops anything of that kind still waiting.
  if not p_enabled then delete from private.push_queue where recipient = me and kind = p_kind; end if;
  return public.my_push_settings();
end;
$$;

revoke all on function public.register_push_token(text, text), public.unregister_push_token(text), public.my_push_settings(),
  public.set_push_setting(text, boolean) from public, anon, authenticated;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text), public.my_push_settings(),
  public.set_push_setting(text, boolean) to authenticated;

-- ---------------------------------------------------------------- what the "push" Edge Function calls (service role only)
-- Claims up to p_limit waiting notifications and gives each with its recipient's tokens. Anything whose recipient has
-- since lost every token or switched that kind off is dropped here. A claim that is not finished within 2 minutes
-- is offered again, up to 3 tries.
create or replace function public.push_take(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare out jsonb;
begin
  delete from private.push_queue q
  where not exists (select 1 from private.push_tokens t where t.user_id = q.recipient)
     or not coalesce((select s.enabled from private.push_settings s where s.user_id = q.recipient and s.kind = q.kind),
                     (select k.default_on from private.push_kinds k where k.kind = q.kind), false)
     or q.attempts >= 3 and (q.claimed_at is null or q.claimed_at < now() - interval '2 minutes');
  with picked as (
    select id from private.push_queue
    where claimed_at is null or claimed_at < now() - interval '2 minutes'
    order by id limit least(greatest(coalesce(p_limit, 50), 1), 100) for update skip locked
  ), claimed as (
    update private.push_queue q set claimed_at = now(), attempts = q.attempts + 1
    from picked where q.id = picked.id returning q.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'title', c.title, 'body', c.body, 'data', c.data,
    'tokens', (select coalesce(jsonb_agg(t.token), '[]'::jsonb) from private.push_tokens t where t.user_id = c.recipient)
  ) order by c.id), '[]'::jsonb) into out from claimed c;
  return out;
end;
$$;

-- Marks notifications as sent (removes them) and forgets tokens Expo says no longer exist.
create or replace function public.push_finish(p_done bigint[], p_dead_tokens text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.push_queue where id = any (coalesce(p_done, '{}'::bigint[]));
  delete from private.push_tokens where token = any (coalesce(p_dead_tokens, '{}'::text[]));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.push_take(integer), public.push_finish(bigint[], text[]) from public, anon, authenticated;
grant execute on function public.push_take(integer), public.push_finish(bigint[], text[]) to service_role;

-- ---------------------------------------------------------------- schedule
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    null;   -- not available here (for example the local test database); the once-a-minute job still sends
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('seshhon-push-send', '* * * * *', 'select private.push_poke_if_waiting()');
    perform cron.schedule('seshhon-push-catch-ups', '11 * * * *', 'select private.push_catch_ups()');
  end if;
end;
$$;
