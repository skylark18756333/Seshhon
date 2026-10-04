-- Account types: user, venue and admin.
--
--   user   Everyone. The normal Frenzy app: status, friends, seshes, map, events.
--   venue  A business account that runs one or more venues' pages: hours, events and deals, and
--          confirming deal codes. It is kept apart from the social side: a venue account cannot
--          go green or amber, add friends, start or join a sesh, or rate venues.
--   admin  Frenzy staff only. Admins see the Admin page: venue requests to approve, venue
--          accounts, live deals and events, and reported messages. Admins keep the normal app.
--
-- Roles live in private.roles, which the app cannot read or change at all. Nobody can make
-- themselves an admin from the app. Frenzy staff add an admin by hand in the Supabase SQL Editor:
--
--   insert into private.roles (user_id, role) values ('<the person''s ID from their You page>', 'admin')
--   on conflict (user_id) do update set role = 'admin';
--
-- A venue account comes from a request: someone taps "Run a venue?" on their You page, picks the
-- venue and leaves contact details. An admin approves it, which turns that account into a venue
-- account for that venue. The contact details are deleted once the request is decided.

-- ---------------------------------------------------------------- tables
create schema if not exists private;

create table if not exists private.roles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('venue', 'admin')),
  granted_at timestamptz not null default now()
);
alter table private.roles enable row level security;
revoke all on private.roles from public, anon, authenticated;

create table if not exists private.venue_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rejected')),
  contact_name text check (char_length(contact_name) <= 60),
  phone text check (char_length(phone) <= 30),
  abn text check (char_length(abn) <= 20),
  message text check (char_length(message) <= 300),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists venue_claims_one_each on private.venue_claims (user_id);
alter table private.venue_claims enable row level security;
revoke all on private.venue_claims from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function private.role_of(u uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select coalesce((select r.role from private.roles r where r.user_id = u), 'user');
$$;
revoke all on function private.role_of(uuid) from public, anon, authenticated;

create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.role_of(auth.uid()) <> 'admin' then
    raise exception 'Only Frenzy staff can do that.';
  end if;
end;
$$;
revoke all on function private.require_admin() from public, anon, authenticated;

-- Cheap-drink promotions. WA liquor rules frown on them, so Frenzy never lists them, whoever posts
-- the deal. Some words are never allowed (bottomless, shots, all you can drink). Multi-buys, free
-- drinks and "$5 drinks" pricing are refused on anything that is about drinks; "2-for-1 pizzas" is fine.
create or replace function private.cheap_drink_promo(p_title text, p_alcohol boolean, p_type text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_title, '')) ~ '(bottomless|all\s*you\s*can\s*drink|\mshots?\M|\mshooters?\M|drinking\s*game|boat\s*race|\mskol)'
    or ((coalesce(p_alcohol, false) or p_type = 'Drinks'
         or lower(coalesce(p_title, '')) ~ '(drink|beer|wine|cocktail|spirit|vodka|rum\M|gin\M|tequila|whisk|bourbon|cider|prosecco|champagne|bubbles|pint|schooner|middy|jug|pitcher|bottle|booze|bar\s*tab|bevv?ie)')
        and lower(coalesce(p_title, '')) ~ '(\m[0-9]+\s*(for|4|-for-)\s*[0-9]+\M|two\s*for\s*one|buy\s*(one|1)|\mbogo\M|\mfree\M|unlimited|\$\s*[0-9]|cheap|half\s*price\s*all|double\s*(up|shot|pour))');
$$;
revoke all on function private.cheap_drink_promo(text, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- rules on every deal
-- Applies to every way a deal is saved, including straight table writes by venue staff.
create or replace function private.check_deal() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  if new.title ~ '[<>]' then raise exception 'Leave out < and > in the title.'; end if;
  if new.type = 'Events' then new.is_alcohol := false; end if;
  if private.cheap_drink_promo(new.title, new.is_alcohol, new.type::text) then
    raise exception 'Frenzy can''t list cheap-drink promotions such as 2-for-1 or free drinks, shots or bottomless drinks (WA liquor rules). Try food, entry or an event instead.';
  end if;
  return new;
end;
$$;
revoke all on function private.check_deal() from public, anon, authenticated;
drop trigger if exists deals_check on public.deals;
create trigger deals_check before insert or update on public.deals for each row execute function private.check_deal();

-- ---------------------------------------------------------------- venue accounts stay off the social side
create or replace function private.no_social_for_business() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare who uuid;
begin
  if tg_table_name = 'statuses' and to_jsonb(new) ->> 'colour' = 'off' then return new; end if;
  if tg_table_name = 'friendships' then
    if private.role_of((to_jsonb(new) ->> 'requester')::uuid) = 'venue' or private.role_of((to_jsonb(new) ->> 'addressee')::uuid) = 'venue' then
      raise exception 'Venue accounts can''t add friends. Use a personal account for that.';
    end if;
    return new;
  end if;
  who := coalesce(to_jsonb(new) ->> 'user_id', to_jsonb(new) ->> 'creator')::uuid;
  if private.role_of(who) = 'venue' then
    if tg_table_name = 'ratings' then raise exception 'Venue accounts can''t rate venues.'; end if;
    raise exception 'Venue accounts can''t go out on a sesh. Use a personal account for that.';
  end if;
  return new;
end;
$$;
revoke all on function private.no_social_for_business() from public, anon, authenticated;
drop trigger if exists statuses_not_business on public.statuses;
create trigger statuses_not_business before insert or update on public.statuses for each row execute function private.no_social_for_business();
drop trigger if exists seshes_not_business on public.seshes;
create trigger seshes_not_business before insert on public.seshes for each row execute function private.no_social_for_business();
drop trigger if exists members_not_business on public.sesh_members;
create trigger members_not_business before insert on public.sesh_members for each row execute function private.no_social_for_business();
drop trigger if exists ratings_not_business on public.ratings;
create trigger ratings_not_business before insert or update on public.ratings for each row execute function private.no_social_for_business();
drop trigger if exists friendships_not_business on public.friendships;
create trigger friendships_not_business before insert on public.friendships for each row execute function private.no_social_for_business();

-- ---------------------------------------------------------------- everyone: my account type
create or replace function public.my_role() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'role', private.role_of(auth.uid()),
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name) order by v.name)
      from public.venue_staff s join public.venues v on v.id = s.venue_id where s.user_id = auth.uid()
    ), '[]'::jsonb),
    'claim', (
      select jsonb_build_object('id', c.id, 'venue_id', c.venue_id, 'venue_name', v.name, 'status', c.status, 'note', c.note)
      from private.venue_claims c join public.venues v on v.id = c.venue_id where c.user_id = auth.uid()
    )
  ) end;
$$;
revoke all on function public.my_role() from public, anon, authenticated;
grant execute on function public.my_role() to authenticated;

-- Ask Frenzy to make this account the venue account for a venue. One request at a time; a new
-- request replaces an old one.
create or replace function public.claim_venue(p_venue uuid, p_contact text, p_phone text, p_abn text, p_message text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := auth.uid();
  contact text := nullif(btrim(coalesce(p_contact, '')), '');
  ph text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  abn text := nullif(regexp_replace(coalesce(p_abn, ''), '[^0-9]', '', 'g'), '');
  msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if private.role_of(me) <> 'user' then raise exception 'This account already has a venue or staff role.'; end if;
  if not exists (select 1 from public.venues where id = p_venue) then raise exception 'Pick a venue from the list.'; end if;
  if contact is null or char_length(contact) > 60 then raise exception 'Enter the name of the person we should talk to.'; end if;
  if ph is null or char_length(ph) not between 8 and 15 then raise exception 'Enter a phone number we can call to check.'; end if;
  if abn is not null and char_length(abn) <> 11 then raise exception 'An ABN has 11 digits. Leave it empty if you don''t have it handy.'; end if;
  if msg is not null and char_length(msg) > 300 then raise exception 'Keep the note under 300 characters.'; end if;
  if contact ~ '[<>]' or coalesce(msg, '') ~ '[<>]' then raise exception 'Leave out < and >.'; end if;
  insert into private.venue_claims (user_id, venue_id, contact_name, phone, abn, message)
  values (me, p_venue, contact, ph, abn, msg)
  on conflict (user_id) do update set venue_id = excluded.venue_id, status = 'pending', contact_name = excluded.contact_name,
    phone = excluded.phone, abn = excluded.abn, message = excluded.message, note = null, created_at = now(), decided_at = null;
  return public.my_role();
end;
$$;
revoke all on function public.claim_venue(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_venue(uuid, text, text, text, text) to authenticated;

create or replace function public.cancel_venue_claim() returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from private.venue_claims where user_id = auth.uid();
  return public.my_role();
end;
$$;
revoke all on function public.cancel_venue_claim() from public, anon, authenticated;
grant execute on function public.cancel_venue_claim() to authenticated;

-- ---------------------------------------------------------------- venue accounts
create or replace function private.require_my_venue(p_venue uuid) returns void
language plpgsql stable security definer set search_path = public, private as $$
begin
  if auth.uid() is null or not exists (select 1 from public.venue_staff s where s.venue_id = p_venue and s.user_id = auth.uid()) then
    raise exception 'Only this venue''s account can do that.';
  end if;
end;
$$;
revoke all on function private.require_my_venue(uuid) from public, anon, authenticated;

-- Everything on the venue page: each of my venues with all its deals and events (paused ones too)
-- and how many codes were used tonight.
create or replace function public.venue_overview() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'name', v.name, 'kind', v.kind, 'hours', v.opening_hours,
    'deals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'type', d.type, 'title', d.title, 'is_alcohol', d.is_alcohol, 'discount_pct', d.discount_pct, 'active', d.active,
        'start_time', to_char(d.start_time, 'HH24:MI'), 'end_time', to_char(d.end_time, 'HH24:MI'),
        'used_tonight', (select count(*) from public.redemptions r where r.deal_id = d.id and r.night = public.night_of() and r.confirmed_at is not null)
      ) order by d.active desc, d.start_time, d.title)
      from public.deals d where d.venue_id = v.id
    ), '[]'::jsonb)
  ) order by v.name), '[]'::jsonb)
  from public.venue_staff s join public.venues v on v.id = s.venue_id
  where s.user_id = auth.uid();
$$;
revoke all on function public.venue_overview() from public, anon, authenticated;
grant execute on function public.venue_overview() to authenticated;

-- Add (p_deal null) or change a deal or event at my venue.
create or replace function public.venue_save_deal(p_deal uuid, p_venue uuid, p_type text, p_title text, p_start text, p_end text,
  p_is_alcohol boolean, p_discount integer, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  t public.deal_type;
  st time; en time;
  out_id uuid;
begin
  perform private.require_my_venue(p_venue);
  if p_type not in ('Food', 'Drinks', 'Entry', 'Events') then raise exception 'Pick a kind of deal.'; end if;
  t := p_type::public.deal_type;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 80 then raise exception 'Give it a title of 3 to 80 characters.'; end if;
  begin st := p_start::time; en := p_end::time;
  exception when others then raise exception 'Pick a start and end time.'; end;
  if en <= st then raise exception 'It has to finish after it starts, on the same night (before midnight).'; end if;
  if p_discount is not null and p_discount not between 0 and 100 then raise exception 'The discount must be between 0 and 100%%.'; end if;
  if p_deal is null then
    insert into public.deals (venue_id, type, title, start_time, end_time, is_alcohol, discount_pct, active)
    values (p_venue, t, p_title, st, en, coalesce(p_is_alcohol, false), p_discount, coalesce(p_active, true))
    returning id into out_id;
  else
    update public.deals set type = t, title = p_title, start_time = st, end_time = en, is_alcohol = coalesce(p_is_alcohol, false),
      discount_pct = p_discount, active = coalesce(p_active, true)
    where id = p_deal and venue_id = p_venue returning id into out_id;
    if out_id is null then raise exception 'That deal is not at this venue.'; end if;
  end if;
  return out_id;
exception
  when check_violation then
    raise exception 'Drink deals must be at most 50%% off, last at most an hour and finish by 7pm (WA liquor rules).';
end;
$$;
revoke all on function public.venue_save_deal(uuid, uuid, text, text, text, text, boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.venue_save_deal(uuid, uuid, text, text, text, text, boolean, integer, boolean) to authenticated;

create or replace function public.venue_delete_deal(p_deal uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare v uuid;
begin
  select venue_id into v from public.deals where id = p_deal;
  if v is null then raise exception 'That deal has already gone.'; end if;
  perform private.require_my_venue(v);
  delete from public.deals where id = p_deal;
end;
$$;
revoke all on function public.venue_delete_deal(uuid) from public, anon, authenticated;
grant execute on function public.venue_delete_deal(uuid) to authenticated;

-- ---------------------------------------------------------------- admin (Frenzy staff)
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'people', (select count(*) from public.profiles),
      'venue_accounts', (select count(*) from private.roles where role = 'venue'),
      'live_seshes', (select count(*) from public.seshes where ended_at is null and created_at > now() - interval '8 hours'),
      'live_deals', (select count(*) from public.deals where active)
    ),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'user_id', c.user_id, 'user_name', p.name, 'venue_id', c.venue_id, 'venue_name', v.name,
        'contact_name', c.contact_name, 'phone', c.phone, 'abn', c.abn, 'message', c.message, 'created_at', c.created_at,
        'venue_has_account', exists (select 1 from public.venue_staff s where s.venue_id = c.venue_id)
      ) order by c.created_at)
      from private.venue_claims c join public.profiles p on p.id = c.user_id join public.venues v on v.id = c.venue_id
      where c.status = 'pending'
    ), '[]'::jsonb),
    'venue_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'user_name', p.name, 'venue_id', s.venue_id, 'venue_name', v.name) order by v.name, p.name)
      from public.venue_staff s join public.profiles p on p.id = s.user_id join public.venues v on v.id = s.venue_id
    ), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'venue_name', v.name, 'type', d.type, 'title', d.title, 'is_alcohol', d.is_alcohol,
        'start_time', to_char(d.start_time, 'HH24:MI'), 'end_time', to_char(d.end_time, 'HH24:MI')) order by v.name, d.start_time)
      from public.deals d join public.venues v on v.id = d.venue_id where d.active
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'reported_name', p.name, 'message_body', r.message_body, 'reason', r.reason, 'created_at', r.created_at) order by r.created_at desc)
      from public.reports r left join public.profiles p on p.id = r.reported
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to authenticated;

-- Approve: the account becomes a venue account for that venue. Its friends, status and seshes
-- are cleared, because venue accounts stay off the social side. Reject: the person sees the note.
-- Either way the contact details are deleted.
create or replace function public.admin_decide_claim(p_claim uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c private.venue_claims;
begin
  perform private.require_admin();
  select * into c from private.venue_claims where id = p_claim and status = 'pending';
  if c.id is null then raise exception 'That request has already been decided.'; end if;
  if p_approve then
    if private.role_of(c.user_id) = 'admin' then raise exception 'A staff account can''t become a venue account.'; end if;
    insert into private.roles (user_id, role) values (c.user_id, 'venue') on conflict (user_id) do update set role = 'venue', granted_at = now();
    insert into public.venue_staff (venue_id, user_id) values (c.venue_id, c.user_id) on conflict do nothing;
    delete from public.friendships where requester = c.user_id or addressee = c.user_id;
    delete from public.sesh_members where user_id = c.user_id;
    delete from public.seshes where creator = c.user_id;
    update public.statuses set colour = 'off', expires_at = null where user_id = c.user_id;
    delete from private.venue_claims where id = c.id;
  else
    update private.venue_claims set status = 'rejected', note = left(nullif(btrim(coalesce(p_note, '')), ''), 200),
      contact_name = null, phone = null, abn = null, message = null, decided_at = now()
    where id = c.id;
  end if;
  return public.admin_overview();
end;
$$;
revoke all on function public.admin_decide_claim(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_decide_claim(uuid, boolean, text) to authenticated;

-- Take a venue away from a venue account. With no venues left, it goes back to a normal account.
create or replace function public.admin_remove_venue_account(p_user uuid, p_venue uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  delete from public.venue_staff where user_id = p_user and venue_id = p_venue;
  if not exists (select 1 from public.venue_staff where user_id = p_user) then
    delete from private.roles where user_id = p_user and role = 'venue';
  end if;
  return public.admin_overview();
end;
$$;
revoke all on function public.admin_remove_venue_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_venue_account(uuid, uuid) to authenticated;

create or replace function public.admin_pause_deal(p_deal uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  update public.deals set active = false where id = p_deal;
  return public.admin_overview();
end;
$$;
revoke all on function public.admin_pause_deal(uuid) from public, anon, authenticated;
grant execute on function public.admin_pause_deal(uuid) to authenticated;

create or replace function public.admin_dismiss_report(p_report uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.require_admin();
  delete from public.reports where id = p_report;
  return public.admin_overview();
end;
$$;
revoke all on function public.admin_dismiss_report(uuid) from public, anon, authenticated;
grant execute on function public.admin_dismiss_report(uuid) to authenticated;
