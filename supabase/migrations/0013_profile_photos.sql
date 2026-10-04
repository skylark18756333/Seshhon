-- Profile photos: a small picture on each person's circle.
--
-- The app shrinks the photo on the phone to a 160 x 160 JPEG (about 10 KB) and saves it here as
-- text in a column called "picture" (a column named photo would trip the check that age checks
-- never store photos), so no file storage or new web address is needed. Nobody can read this table directly.
-- friend_photos() hands out only:
--   - your own photo,
--   - photos of accepted friends you have not blocked and who have not blocked you,
--   - and, once women-only mode (migrations 0011 and 0012) is installed, not the photo of someone
--     in that mode to a person that mode keeps out. It asks private.hidden_from_me(), the same
--     check that hides their status, so the two can never disagree.
-- A photo is removed with the account (on delete cascade) or when its owner removes it.

create table if not exists public.profile_photos (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  picture text not null check (picture ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' and char_length(picture) <= 60000),
  updated_at timestamptz not null default now()
);
alter table public.profile_photos enable row level security;
revoke all on public.profile_photos from public, anon, authenticated;

-- Women-only mode lives in migrations 0011 and 0012, which may be installed before or after this one.
-- This asks it when it is there, and otherwise hides nothing.
create or replace function public.photo_hidden_from_me(owner uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare hidden boolean;
begin
  if to_regprocedure('private.hidden_from_me(uuid)') is null then return false; end if;
  execute 'select private.hidden_from_me($1)' into hidden using owner;
  return coalesce(hidden, false);
end $$;
revoke all on function public.photo_hidden_from_me(uuid) from public, anon, authenticated;

create or replace function public.friend_photos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  return coalesce((
    select jsonb_object_agg(p.user_id, p.picture)
    from public.profile_photos p
    where p.user_id = me
       or (public.are_friends(p.user_id, me) and not public.blocked_between(p.user_id, me) and not public.photo_hidden_from_me(p.user_id))
  ), '{}'::jsonb);
end $$;
revoke all on function public.friend_photos() from public, anon, authenticated;
grant execute on function public.friend_photos() to authenticated;

-- Saves your photo, or removes it when p_photo is null.
create or replace function public.set_photo(p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'Sign in first.'; end if;
  if p_photo is null then
    delete from public.profile_photos where user_id = me;
    return jsonb_build_object('ok', true);
  end if;
  if p_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' or char_length(p_photo) > 60000 then
    raise exception 'That photo could not be used. Try a different one.';
  end if;
  insert into public.profile_photos (user_id, picture) values (me, p_photo)
  on conflict (user_id) do update set picture = excluded.picture, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_photo(text) from public, anon, authenticated;
grant execute on function public.set_photo(text) to authenticated;
