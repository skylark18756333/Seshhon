-- Customise your profile page: a cover photo, a colour theme, a frame round your photo, and which of your
-- badges show. Only your friends see it, through profile_style(), with the same rules as friend_profile() (0040):
-- strangers and blocked people get nothing, and women-only mode hides the cover just as it hides your photo.
-- Shown badges must be ones you've earned; anything else is dropped when the page is read.
-- Needs 0013 and 0040. Safe to run more than once.

create table if not exists private.profile_style (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  theme text not null default 'neon' check (theme in ('neon', 'sunset', 'ocean', 'pop', 'lime', 'mono')),
  frame text not null default 'glow' check (frame in ('glow', 'neon', 'gold', 'rainbow', 'none')),
  cover text check (cover is null or (cover ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' and char_length(cover) <= 150000)),
  badges text[] not null default '{}' check (cardinality(badges) <= 3),
  updated_at timestamptz not null default now()
);
alter table private.profile_style enable row level security;
revoke all on private.profile_style from public, anon, authenticated;

create or replace function public.profile_style(p_friend uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := auth.uid(); s private.profile_style; earned jsonb;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_friend is null then raise exception 'Pick a friend.'; end if;
  if p_friend <> me and (not public.are_friends(p_friend, me) or public.blocked_between(p_friend, me)) then
    raise exception 'You can only see your friends'' profiles.';
  end if;
  select * into s from private.profile_style where user_id = p_friend;
  earned := coalesce(private.level_json(p_friend) -> 'badges', '[]'::jsonb);
  return jsonb_build_object(
    'theme', coalesce(s.theme, 'neon'),
    'frame', coalesce(s.frame, 'glow'),
    'cover', case when p_friend = me or not public.photo_hidden_from_me(p_friend) then s.cover end,
    'badges', coalesce((select jsonb_agg(b order by i) from unnest(coalesce(s.badges, '{}')) with ordinality as t(b, i) where earned ? b), '[]'::jsonb));
end $$;

-- Change any of theme, frame and shown badges. Leave one out (null) to keep it as it is.
create or replace function public.set_profile_style(p_theme text default null, p_frame text default null, p_badges text[] default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_theme is not null and p_theme not in ('neon', 'sunset', 'ocean', 'pop', 'lime', 'mono') then raise exception 'Pick one of the themes.'; end if;
  if p_frame is not null and p_frame not in ('glow', 'neon', 'gold', 'rainbow', 'none') then raise exception 'Pick one of the frames.'; end if;
  if p_badges is not null and cardinality(p_badges) > 3 then raise exception 'Pick up to 3 badges to show.'; end if;
  insert into private.profile_style (user_id) values (me) on conflict do nothing;
  update private.profile_style set theme = coalesce(p_theme, theme), frame = coalesce(p_frame, frame),
    badges = coalesce(p_badges, badges), updated_at = now()
  where user_id = me;
  return public.profile_style(me);
end $$;

-- Your cover photo: a JPEG as a data address, or null to remove it.
create or replace function public.set_cover(p_cover text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_cover is not null and (p_cover !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' or char_length(p_cover) > 150000) then
    raise exception 'That photo could not be used. Try a different one.';
  end if;
  insert into private.profile_style (user_id) values (me) on conflict do nothing;
  update private.profile_style set cover = p_cover, updated_at = now() where user_id = me;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.profile_style(uuid), public.set_profile_style(text, text, text[]), public.set_cover(text) from public, anon;
grant execute on function public.profile_style(uuid), public.set_profile_style(text, text, text[]), public.set_cover(text) to authenticated;
