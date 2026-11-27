-- 0051: invite links that make you friends straight away. Tapping "Send your invite link" now hands out a fresh
-- link that lasts 7 days: whoever signs up or opens it becomes your friend at once (no request to accept), so a new
-- person never lands on an empty Home. The old permanent link (profiles.invite_code) still works, but only as a
-- friend request, so an old link posted somewhere public can't add strangers. Blocks and hidden status still win.
-- Needs 0002 and 0011. Safe to run more than once.
create table if not exists private.quick_invites (code text primary key, owner uuid not null references public.profiles (id) on delete cascade, expires_at timestamptz not null);
alter table private.quick_invites enable row level security;
revoke all on private.quick_invites from public, anon, authenticated;

-- My current quick link: reused while it has more than a day left, otherwise a new one (old ones are tidied away).
create or replace function public.quick_invite() returns text language plpgsql security definer set search_path = public, private as $f$
declare me uuid := auth.uid(); c text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'Sign in first.'; end if;
  delete from private.quick_invites where expires_at < now();
  select code into c from private.quick_invites where owner = me and expires_at > now() + interval '1 day' order by expires_at desc limit 1;
  if c is null then
    c := 'Q' || public.new_invite_code();
    insert into private.quick_invites (code, owner, expires_at) values (c, me, now() + interval '7 days');
  end if;
  return c;
end $f$;

create or replace function public.request_friend(p_code text) returns jsonb language plpgsql security definer set search_path = public as $f$
declare me uuid := auth.uid(); v_code text := upper(btrim(coalesce(p_code, ''))); other public.profiles; f public.friendships; quick boolean := false;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  select p.* into other from private.quick_invites q join public.profiles p on p.id = q.owner where q.code = v_code and q.expires_at > now();
  if found then quick := true; else select * into other from public.profiles where invite_code = v_code; end if;
  if other.id is null then raise exception 'That invite link is not valid or has run out. Ask for a new one.'; end if;
  if other.id = me then raise exception 'That is your own invite link.'; end if;
  select * into f from public.friendships where (requester = me and addressee = other.id) or (requester = other.id and addressee = me);
  if found then
    if f.state = 'blocked' then raise exception 'That invite link is not valid.'; end if;
    if f.state = 'requested' and (f.addressee = me or quick) then
      update public.friendships set state = 'accepted' where id = f.id;
      return jsonb_build_object('name', other.name, 'state', 'accepted');
    end if;
    return jsonb_build_object('name', other.name, 'state', f.state);
  end if;
  if private.hidden_from_me(other.id) then raise exception 'That invite link is not valid.'; end if;
  if quick then
    -- Sent as a request and accepted at once, so the link's owner gets the usual "accepted" notification.
    insert into public.friendships (requester, addressee) values (me, other.id) returning * into f;
    update public.friendships set state = 'accepted' where id = f.id;
    return jsonb_build_object('name', other.name, 'state', 'accepted');
  end if;
  insert into public.friendships (requester, addressee) values (me, other.id);
  return jsonb_build_object('name', other.name, 'state', 'requested');
end $f$;

revoke all on function public.quick_invite() from public, anon;
grant execute on function public.quick_invite() to authenticated;
notify pgrst, 'reload schema';
insert into private.migration_log (file) values ('0051_quick_invites');
