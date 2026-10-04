-- Opens women-only mode (0011) to non-binary people.
-- The mode can now be turned on by a woman or a non-binary person. While it is on, only people
-- who have told SeshOn they are a woman or non-binary can see their status, add them, or see,
-- join and chat in seshes they start. Gender stays private, as in 0011.

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'private.safety'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%women_only%'
  loop
    execute format('alter table private.safety drop constraint %I', c);
  end loop;
end;
$$;
alter table private.safety add constraint safety_mode_needs_gender check (not women_only or gender in ('woman', 'nonbinary'));

-- True when "u" has said they are a woman or non-binary. Private, like hidden_from_me.
create or replace function private.in_safe_group(u uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.safety s where s.user_id = u and s.gender in ('woman', 'nonbinary'));
$$;
revoke all on function private.in_safe_group(uuid) from public, anon, authenticated;

create or replace function private.hidden_from_me(owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    owner <> auth.uid()
    and exists (select 1 from private.safety s where s.user_id = owner and s.women_only)
    and not private.in_safe_group(auth.uid()),
    false);
$$;

create or replace function public.set_safety(p_gender text, p_women_only boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  g text := nullif(btrim(coalesce(p_gender, '')), '');
  wo boolean := coalesce(p_women_only, false);
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Finish signing up first.'; end if;
  if g is not null and g not in ('woman', 'man', 'nonbinary') then raise exception 'Pick one of the options, or leave it blank.'; end if;
  if wo and (g is null or g not in ('woman', 'nonbinary')) then raise exception 'This mode is for women and non-binary people.'; end if;

  -- Keep nothing when there is nothing to keep.
  if g is null and not wo then
    delete from private.safety where user_id = me;
    return public.my_safety();
  end if;

  insert into private.safety (user_id, gender, women_only, updated_at) values (me, g, wo, now())
  on conflict (user_id) do update set gender = excluded.gender, women_only = excluded.women_only, updated_at = now();

  if wo then
    -- Pending requests to them from people outside the group.
    delete from public.friendships f
    where f.addressee = me and f.state = 'requested' and not private.in_safe_group(f.requester);
    -- The same people leave any sesh they are running.
    delete from public.venue_votes v
    using public.seshes x
    where v.sesh_id = x.id and x.creator = me and x.ended_at is null and v.user_id <> me and not private.in_safe_group(v.user_id);
    delete from public.sesh_members m
    using public.seshes x
    where m.sesh_id = x.id and x.creator = me and x.ended_at is null and m.user_id <> me and not private.in_safe_group(m.user_id);
  end if;
  return public.my_safety();
end;
$$;
