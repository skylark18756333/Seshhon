-- Inside a sesh: its own name, emoji, colour and cover photo, and switching it between invite-only and open to
-- all friends. Only the person who started it can change these; everyone who can see the sesh can read them.
-- They are deleted with the sesh. Making a sesh invite-only keeps everyone already in it (they are added to its
-- invites). The cover photo is a small JPEG kept as text, like profile cover photos (0041). Needs 0024.
-- Safe to run more than once.

alter table public.seshes add column if not exists name text;
alter table public.seshes add column if not exists emoji text;
alter table public.seshes add column if not exists colour text;
alter table public.seshes add column if not exists cover text;
alter table public.seshes add column if not exists cover_at timestamptz;

-- Can I see this sesh (and so its name, colour and cover)?
create or replace function private.can_see_sesh(p_sesh uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (
    select 1 from public.seshes s
    where s.id = p_sesh and s.ended_at is null
      and (s.creator = auth.uid() or public.is_sesh_member(s.id, auth.uid()) or not private.sesh_closed_to_me(s.id))
  );
$$;

-- The name, emoji, colour and invite-only of a sesh you can see (null for one you can't). cover_at says when the
-- cover photo last changed, so the phone only fetches the photo itself (sesh_cover) when it's new.
create or replace function public.sesh_details(p_sesh uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('name', s.name, 'emoji', s.emoji, 'colour', s.colour, 'private', s.private,
                            'cover_at', case when s.cover is null then null else s.cover_at end)
  from public.seshes s
  where s.id = p_sesh and private.can_see_sesh(s.id);
$$;
revoke all on function public.sesh_details(uuid) from public, anon;
grant execute on function public.sesh_details(uuid) to authenticated;

create or replace function public.sesh_cover(p_sesh uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select s.cover from public.seshes s where s.id = p_sesh and private.can_see_sesh(s.id);
$$;
revoke all on function public.sesh_cover(uuid) from public, anon;
grant execute on function public.sesh_cover(uuid) to authenticated;

-- Change the name (up to 40 characters, blank for none), the emoji (blank for none), the colour (one of the app's
-- sesh colours, blank for the theme's) and invite-only.
drop function if exists public.set_sesh_details(uuid, text, text, boolean);
create or replace function public.set_sesh_details(p_sesh uuid, p_name text, p_emoji text, p_private boolean, p_colour text)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_colour text := nullif(btrim(coalesce(p_colour, '')), '');
begin
  if not exists (select 1 from public.seshes s where s.id = p_sesh and s.creator = auth.uid() and s.ended_at is null) then
    raise exception 'Only the person who started the sesh can change it.';
  end if;
  if v_name is not null and char_length(v_name) > 40 then raise exception 'Keep the name to 40 characters.'; end if;
  if v_emoji is not null and char_length(v_emoji) > 8 then raise exception 'Pick one emoji.'; end if;
  if v_colour is not null and v_colour not in ('sunset', 'ocean', 'violet', 'gold', 'forest', 'pop') then
    raise exception 'Pick one of the colours.';
  end if;
  if p_private then   -- everyone already in stays in
    insert into public.sesh_invites (sesh_id, user_id)
    select m.sesh_id, m.user_id from public.sesh_members m where m.sesh_id = p_sesh
    on conflict do nothing;
  end if;
  update public.seshes set name = v_name, emoji = v_emoji, colour = v_colour, private = coalesce(p_private, private)
  where id = p_sesh;
end $$;
revoke all on function public.set_sesh_details(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.set_sesh_details(uuid, text, text, boolean, text) to authenticated;

-- Set the cover photo (a JPEG data address, at most 150,000 characters), or null to remove it.
create or replace function public.set_sesh_cover(p_sesh uuid, p_cover text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from public.seshes s where s.id = p_sesh and s.creator = auth.uid() and s.ended_at is null) then
    raise exception 'Only the person who started the sesh can change it.';
  end if;
  if p_cover is not null and (p_cover !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' or char_length(p_cover) > 150000) then
    raise exception 'That photo could not be used. Try a different one.';
  end if;
  update public.seshes set cover = p_cover, cover_at = now() where id = p_sesh;
end $$;
revoke all on function public.set_sesh_cover(uuid, text) from public, anon;
grant execute on function public.set_sesh_cover(uuid, text) to authenticated;

insert into private.migration_log (file) values ('0044_sesh_details');
