-- Age gate: sign-up now asks for a date of birth and checks it on the server.
-- The date of birth is used for the check only. It is NOT stored; the database keeps
-- just the moment the person was confirmed as 18 or over.
-- Also lets the app label alcohol deals ("18+, ID required, drink responsibly").

drop function if exists public.api_sign_up(text, boolean);

create function public.api_sign_up(p_name text, p_birth_date date) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare today date := (now() at time zone 'Australia/Perth')::date;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_birth_date is null or p_birth_date > today or p_birth_date < date '1900-01-01' then
    raise exception 'Enter your date of birth.';
  end if;
  if p_birth_date > (today - interval '18 years')::date then
    raise exception 'Seshhon is for people aged 18 and over.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 24 then
    raise exception 'Enter a first name of up to 24 characters.';
  end if;
  insert into public.profiles (id, name, adult_confirmed_at)
  values (auth.uid(), btrim(p_name), now())
  on conflict (id) do update set name = excluded.name;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.api_sign_up(text, date) from public, anon, authenticated;
grant execute on function public.api_sign_up(text, date) to authenticated;

create or replace function public.api_state() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'night', public.night_of(),
    'me', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'invite_code', p.invite_code,
        'colour', coalesce((select s.colour::text from public.statuses s where s.user_id = p.id and s.colour <> 'off' and s.expires_at > now()), 'off'),
        'expires_at', (select s.expires_at from public.statuses s where s.user_id = p.id and s.colour <> 'off' and s.expires_at > now())
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'friends', coalesce((
      select jsonb_agg(
        jsonb_build_object('friendship', f.id, 'id', p.id, 'name', p.name, 'colour', coalesce(s.colour::text, 'off'), 'since', s.updated_at)
        order by case coalesce(s.colour::text, 'off') when 'on' then 0 when 'thinking' then 1 else 2 end, p.name
      )
      from public.friendships f
      join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
      left join public.statuses s on s.user_id = p.id
      where f.state = 'accepted'
    ), '[]'::jsonb),
    'requests_in', coalesce((
      select jsonb_agg(jsonb_build_object('friendship', f.id, 'name', p.name) order by f.created_at)
      from public.friendships f join public.profiles p on p.id = f.requester
      where f.state = 'requested' and f.addressee = auth.uid()
    ), '[]'::jsonb),
    'requests_out', coalesce((
      select jsonb_agg(jsonb_build_object('friendship', f.id, 'name', p.name) order by f.created_at)
      from public.friendships f join public.profiles p on p.id = f.addressee
      where f.state = 'requested' and f.requester = auth.uid()
    ), '[]'::jsonb),
    'seshes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'mine', s.creator = auth.uid(),
          'creator_name', (select p.name from public.profiles p where p.id = s.creator),
          'locked_venue', s.locked_venue,
          'am_member', public.is_sesh_member(s.id, auth.uid()),
          'members', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', p.name) order by m.joined_at)
            from public.sesh_members m left join public.profiles p on p.id = m.user_id
            where m.sesh_id = s.id
          ), '[]'::jsonb),
          'votes', coalesce((
            select jsonb_agg(jsonb_build_object('user_id', v.user_id, 'venue_id', v.venue_id, 'voted_at', v.voted_at))
            from public.venue_votes v where v.sesh_id = s.id
          ), '[]'::jsonb)
        )
        order by s.created_at desc
      )
      from public.seshes s
      where s.ended_at is null and s.created_at > now() - interval '8 hours'
    ), '[]'::jsonb),
    'venues', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id, 'name', v.name, 'kind', v.kind, 'closes', v.closes, 'is_example', v.is_example,
          'average', (select r.average from public.venue_ratings r where r.venue_id = v.id),
          'ratings', coalesce((select r.ratings from public.venue_ratings r where r.venue_id = v.id), 0),
          'my_stars', coalesce((select r.stars from public.ratings r where r.venue_id = v.id and r.user_id = auth.uid()), 0),
          'my_tags', coalesce((select to_jsonb(r.tags) from public.ratings r where r.venue_id = v.id and r.user_id = auth.uid()), '[]'::jsonb)
        )
        order by v.name
      )
      from public.venues v
    ), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id, 'venue_id', d.venue_id, 'type', d.type, 'title', d.title, 'is_alcohol', d.is_alcohol,
          'start_time', to_char(d.start_time, 'HH24:MI'), 'end_time', to_char(d.end_time, 'HH24:MI'),
          'running', public.deal_is_running(d),
          'used', coalesce(r.confirmed_at is not null, false),
          'code', case when r.confirmed_at is null and r.expires_at > now() then r.code end,
          'code_expires_at', case when r.confirmed_at is null and r.expires_at > now() then r.expires_at end
        )
        order by d.start_time, d.title
      )
      from public.deals d
      left join public.redemptions r on r.deal_id = d.id and r.user_id = auth.uid() and r.night = public.night_of()
      where d.active
    ), '[]'::jsonb),
    'staff_venues', coalesce((
      select jsonb_agg(vs.venue_id) from public.venue_staff vs where vs.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

-- Ratings privacy: you can only read your own ratings (stars and tags). Everyone still
-- sees the venue totals and averages, which come from a view that only exposes aggregates.
alter view public.venue_ratings set (security_invoker = false);
drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings for select to authenticated using (user_id = auth.uid());
