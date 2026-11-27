-- Admins (Crewzy staff, private.roles) get full access on the website: open any venue and manage it as if they were
-- that venue (hours, name and kind, deals, events, stats), and change the app-wide settings. Every admin change is
-- written to private.admin_log, which the Admin page shows.
create table if not exists private.admin_log (id bigserial primary key, at timestamptz not null default now(), admin uuid, action text not null, detail jsonb not null default '{}'::jsonb);
alter table private.admin_log enable row level security;
revoke all on private.admin_log from public, anon, authenticated;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = public, private as $f$ select auth.uid() is not null and coalesce(private.role_of(auth.uid()), '') = 'admin' $f$;
create or replace function private.log_admin(p_action text, p_detail jsonb) returns void language sql security definer set search_path = public, private as $f$ insert into private.admin_log (admin, action, detail) values (auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb)) $f$;
revoke all on function private.is_admin(), private.log_admin(text, jsonb) from public, anon, authenticated;

-- The venue's own account, or an admin (logged). Used by the deal and event save and delete functions.
create or replace function private.require_my_venue(p_venue uuid) returns void language plpgsql security definer set search_path = public, private as $f$
begin
  if auth.uid() is not null and exists (select 1 from public.venue_staff s where s.venue_id = p_venue and s.user_id = auth.uid()) then return; end if;
  if private.is_admin() then perform private.log_admin('venue_change', jsonb_build_object('venue', p_venue, 'venue_name', (select name from public.venues where id = p_venue))); return; end if;
  raise exception 'Only this venue''s account can do that.';
end $f$;
revoke all on function private.require_my_venue(uuid) from public, anon, authenticated;

create or replace function public.set_venue_hours(p_venue uuid, p_hours text) returns void language plpgsql security definer set search_path = public, private as $f$
declare h text := nullif(btrim(regexp_replace(coalesce(p_hours, ''), '\s+', ' ', 'g')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.venue_staff s where s.venue_id = p_venue and s.user_id = auth.uid()) then
    if not private.is_admin() then raise exception 'Only staff at this venue can change its hours.'; end if;
    perform private.log_admin('venue_hours', jsonb_build_object('venue', p_venue, 'venue_name', (select name from public.venues where id = p_venue), 'hours', h));
  end if;
  if h is not null and (char_length(h) > 255 or h !~ '^[A-Za-z0-9 :;,+./-]+$') then raise exception 'Those hours could not be read. Use a format like: Mo-Fr 16:00-24:00; Sa,Su 12:00-02:00'; end if;
  update public.venues set opening_hours = h, hours_source = 'staff' where id = p_venue;
end $f$;
revoke all on function public.set_venue_hours(uuid, text) from public, anon, authenticated;
grant execute on function public.set_venue_hours(uuid, text) to authenticated;

-- Find a venue to open (admins only).
create or replace function public.admin_find_venues(p_q text) returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(x order by x->>'name') from (select jsonb_build_object('id', v.id, 'name', v.name, 'kind', v.kind,
    'has_account', exists (select 1 from public.venue_staff s where s.venue_id = v.id),
    'live', (select count(*) from public.deals d where d.venue_id = v.id and d.active)) x
    from public.venues v where coalesce(btrim(p_q), '') = '' or v.name ilike '%' || btrim(p_q) || '%'
    order by (select count(*) from public.deals d where d.venue_id = v.id and d.active) desc, v.name limit 40) q), '[]'::jsonb);
end $f$;

-- The venue page for any one venue, in the same shape as venue_overview() (admins only).
create or replace function public.admin_venue_overview(p_venue uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'kind', v.kind, 'hours', v.opening_hours,
    'deals', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'title', d.title, 'is_alcohol', d.is_alcohol, 'discount_pct', d.discount_pct, 'active', d.active,
      'start_time', to_char(d.start_time, 'HH24:MI'), 'end_time', to_char(d.end_time, 'HH24:MI'),
      'used_tonight', (select count(*) from public.redemptions r where r.deal_id = d.id and r.night = public.night_of() and r.confirmed_at is not null)) order by d.active desc, d.start_time, d.title)
      from public.deals d where d.venue_id = v.id), '[]'::jsonb)))
    from public.venues v where v.id = p_venue), '[]'::jsonb);
end $f$;

-- Rename a venue or change its kind (admins only).
create or replace function public.admin_save_venue(p_venue uuid, p_name text, p_kind text) returns void language plpgsql security definer set search_path = public, private as $f$
declare old public.venues;
begin
  perform private.require_admin();
  select * into old from public.venues where id = p_venue;
  if not found then raise exception 'That venue has gone.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'Give the venue a name of 2 to 80 characters.'; end if;
  update public.venues set name = btrim(p_name), kind = nullif(btrim(coalesce(p_kind, '')), '') where id = p_venue;
  perform private.log_admin('venue_details', jsonb_build_object('venue', p_venue, 'venue_name', btrim(p_name), 'old_name', old.name, 'old_kind', old.kind, 'kind', nullif(btrim(coalesce(p_kind, '')), '')));
end $f$;

-- App-wide settings (every column of public.app_settings) and the latest admin changes.
create or replace function public.admin_app_settings() returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  return jsonb_build_object('settings', coalesce((select to_jsonb(s) - 'id' from public.app_settings s limit 1), '{}'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'who', coalesce(p.name, 'Removed account'), 'action', l.action, 'detail', l.detail) order by l.at desc)
      from (select * from private.admin_log order by at desc limit 40) l left join public.profiles p on p.id = l.admin), '[]'::jsonb));
end $f$;

-- Change one app setting. p_value is the new value as JSON (true, false, "didit", ...).
create or replace function public.admin_set_app_setting(p_key text, p_value jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $f$
declare old jsonb;
begin
  perform private.require_admin();
  if p_key = 'id' or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = p_key) then raise exception 'There''s no setting called %.', p_key; end if;
  insert into public.app_settings default values on conflict do nothing;
  select to_jsonb(s) -> p_key into old from public.app_settings s limit 1;
  begin
    execute format('update public.app_settings set %I = (jsonb_populate_record(null::public.app_settings, $1)).%I', p_key, p_key) using jsonb_build_object(p_key, p_value);
  exception when check_violation or invalid_text_representation or not_null_violation then raise exception 'That value isn''t allowed for %.', p_key; end;
  perform private.log_admin('app_setting', jsonb_build_object('key', p_key, 'old', old, 'new', p_value));
  return public.admin_app_settings();
end $f$;

-- Deactivate (suspend) and reactivate an account. A suspended person can't sign in (Supabase's banned_until), is
-- set to red, and shows as suspended on the Admin page. Nothing is deleted, so it can be undone.
create table if not exists private.suspended (user_id uuid primary key references public.profiles (id) on delete cascade, at timestamptz not null default now(), by uuid, reason text not null);
alter table private.suspended enable row level security;
revoke all on private.suspended from public, anon, authenticated;
create or replace function private.set_banned(p_user uuid, p_on boolean) returns void language plpgsql security definer set search_path = public, private, auth as $f$
begin
  begin
    execute 'update auth.users set banned_until = $2 where id = $1' using p_user, case when p_on then 'infinity'::timestamptz else null end;
  exception when undefined_column then null; end;
end $f$;
revoke all on function private.set_banned(uuid, boolean) from public, anon, authenticated;
create or replace function public.admin_suspend(p_user uuid, p_reason text) returns void language plpgsql security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  if p_user = auth.uid() then raise exception 'You can''t suspend yourself.'; end if;
  if private.role_of(p_user) = 'admin' then raise exception 'That''s a Crewzy staff account. Take away its admin role in Supabase first.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why (kept on record).'; end if;
  insert into private.suspended (user_id, by, reason) values (p_user, auth.uid(), btrim(p_reason)) on conflict (user_id) do update set at = now(), by = excluded.by, reason = excluded.reason;
  update public.statuses set colour = 'off', expires_at = null, updated_at = now() where user_id = p_user;
  perform private.set_banned(p_user, true);
  perform private.log_admin('suspend', jsonb_build_object('user', p_user, 'name', (select name from public.profiles where id = p_user), 'reason', btrim(p_reason)));
end $f$;
create or replace function public.admin_unsuspend(p_user uuid) returns void language plpgsql security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  delete from private.suspended where user_id = p_user;
  perform private.set_banned(p_user, false);
  perform private.log_admin('unsuspend', jsonb_build_object('user', p_user, 'name', (select name from public.profiles where id = p_user)));
end $f$;

-- Account search, now with when they were last active (last status change) and whether they're suspended.
create or replace function public.admin_find_accounts(p_query text) returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  perform private.require_admin();
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'name') from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'username', l.username, 'role', private.role_of(p.id), 'created_at', p.created_at, 'me', p.id = auth.uid(),
      'last_active', (select st.updated_at from public.statuses st where st.user_id = p.id),
      'suspended', (select jsonb_build_object('at', su.at, 'reason', su.reason) from private.suspended su where su.user_id = p.id),
      'reports', (select count(*) from public.reports r where r.reported = p.id)) as x
    from public.profiles p left join public.account_logins l on l.user_id = p.id
    where lower(p.name) like '%' || q || '%' or l.username like '%' || q || '%' or p.id::text = q
    order by p.name limit 20) s), '[]'::jsonb);
end $f$;

-- The Admin dashboard: key numbers, 14-day trends, top venues and deals, and anything that needs looking at.
-- Everything is a count: no one is named except in the issues list (reported accounts), which only admins see.
create or replace function public.admin_dashboard() returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
declare today date := public.night_of(); alarms jsonb := '[]'::jsonb; n bigint;
begin
  perform private.require_admin();
  select count(*) into n from public.reports; if n > 0 then alarms := alarms || jsonb_build_object('level', 'red', 'text', n || ' reported message' || case when n = 1 then '' else 's' end || ' to look at', 'go', 'reports'); end if;
  select count(*) into n from private.venue_claims; if n > 0 then alarms := alarms || jsonb_build_object('level', 'amber', 'text', n || ' venue request' || case when n = 1 then '' else 's' end || ' waiting', 'go', 'claims'); end if;
  select count(*) into n from (select r.reported from public.reports r where r.created_at > now() - interval '7 days' group by r.reported having count(distinct r.reporter) >= 3) x;
  if n > 0 then alarms := alarms || jsonb_build_object('level', 'red', 'text', n || ' account' || case when n = 1 then '' else 's' end || ' reported by 3 or more people this week', 'go', 'reports'); end if;
  select count(*) into n from private.push_queue where created_at < now() - interval '10 minutes'; if n > 0 then alarms := alarms || jsonb_build_object('level', 'amber', 'text', n || ' phone notification' || case when n = 1 then '' else 's' end || ' stuck for over 10 minutes', 'go', 'settings'); end if;
  select count(*) into n from private.email_login_attempts where at > now() - interval '1 hour'; if n > 100 then alarms := alarms || jsonb_build_object('level', 'red', 'text', n || ' email login attempts in the last hour (possible attack)', 'go', 'settings'); end if;
  select count(*) into n from public.profiles where created_at > now() - interval '1 hour'; if n > 50 then alarms := alarms || jsonb_build_object('level', 'amber', 'text', n || ' sign-ups in the last hour (check for bots)', 'go', 'accounts'); end if;
  if not coalesce((select age_check_required from public.app_settings limit 1), false) then alarms := alarms || jsonb_build_object('level', 'amber', 'text', 'The 18+ age check is switched off', 'go', 'settings'); end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'people', (select count(*) from public.profiles p where coalesce(private.role_of(p.id), 'user') = 'user'),
      'new_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days' and coalesce(private.role_of(p.id), 'user') = 'user'),
      'active_24h', (select count(*) from public.statuses where updated_at > now() - interval '24 hours'),
      'active_7d', (select count(*) from public.statuses where updated_at > now() - interval '7 days'),
      'green_now', (select count(*) from public.statuses where colour = 'on' and (expires_at is null or expires_at > now())),
      'live_seshes', (select count(*) from public.seshes where ended_at is null and created_at > now() - interval '8 hours'),
      'venues', (select count(*) from public.venues),
      'venue_accounts', (select count(*) from private.roles where role = 'venue'),
      'live_deals', (select count(*) from public.deals where active),
      'venues_promoting', (select count(distinct venue_id) from public.deals where active),
      'deal_uses_7d', (select coalesce(sum(uses), 0) from private.deal_counts where night > today - 7),
      'suspended', (select count(*) from private.suspended)),
    'signups', (select jsonb_agg(jsonb_build_object('day', d::date, 'n', (select count(*) from public.profiles p where (p.created_at at time zone 'Australia/Perth')::date = d::date)) order by d) from generate_series(today - 13, today, interval '1 day') d),
    'venue_days', (select jsonb_agg(jsonb_build_object('day', d::date, 'picks', coalesce(c.picks, 0), 'votes', coalesce(c.votes, 0), 'stops', coalesce(c.stops, 0), 'uses', coalesce(c.uses, 0)) order by d)
      from generate_series(today - 13, today, interval '1 day') d left join (select night, sum(picks) picks, sum(votes) votes, sum(stops) stops, sum(uses) uses from private.venue_counts group by night) c on c.night = d::date),
    'top_venues', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', v.id, 'name', v.name, 'picks', sum(c.picks), 'votes', sum(c.votes), 'stops', sum(c.stops), 'uses', sum(c.uses)) x
      from private.venue_counts c join public.venues v on v.id = c.venue_id where c.night > today - 30 group by v.id, v.name order by sum(c.picks + c.votes + c.stops) desc, v.name limit 8) t), '[]'::jsonb),
    'top_deals', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', max(c.title), 'venue', v.name, 'uses', sum(c.uses)) x
      from private.deal_counts c join public.venues v on v.id = c.venue_id where c.night > today - 30 group by c.deal_id, v.name order by sum(c.uses) desc limit 8) t), '[]'::jsonb),
    'promoting', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', v.id, 'name', v.name, 'live', count(*), 'uses', (select coalesce(sum(dc.uses), 0) from private.deal_counts dc where dc.venue_id = v.id and dc.night > today - 30)) x
      from public.deals d join public.venues v on v.id = d.venue_id where d.active group by v.id, v.name order by count(*) desc, v.name limit 20) t), '[]'::jsonb),
    'alarms', alarms);
end $f$;

revoke all on function public.admin_suspend(uuid, text), public.admin_unsuspend(uuid), public.admin_find_accounts(text), public.admin_dashboard() from public, anon;
grant execute on function public.admin_suspend(uuid, text), public.admin_unsuspend(uuid), public.admin_find_accounts(text), public.admin_dashboard() to authenticated;
-- Announcements: an admin writes a short message and sends it to everyone as a phone notification, an in-app
-- banner, or both. The banner shows until it ends (default 3 days) or the person closes it.
create table if not exists public.announcements (id uuid primary key default gen_random_uuid(), at timestamptz not null default now(), by uuid, title text not null, body text not null, banner boolean not null default true, push boolean not null default false, ends_at timestamptz not null, pushed integer not null default 0);
alter table public.announcements enable row level security;
revoke all on public.announcements from public, anon, authenticated;
insert into private.push_kinds (kind, label, hint, default_on, live, sort) values ('announcement', 'Crewzy news', 'Now and then, important news from the Crewzy team.', true, true, 7) on conflict (kind) do nothing;
create or replace function public.current_announcement() returns jsonb language sql stable security definer set search_path = public, private as $f$
  select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'at', a.at) from public.announcements a where a.banner and a.ends_at > now() and auth.uid() is not null order by a.at desc limit 1 $f$;
create or replace function public.admin_announce(p_title text, p_body text, p_push boolean, p_banner boolean, p_days integer) returns jsonb language plpgsql security definer set search_path = public, private as $f$
declare a public.announcements; u record; n integer := 0;
begin
  perform private.require_admin();
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 60 then raise exception 'Give it a title of 3 to 60 characters.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 200 then raise exception 'Keep the message between 3 and 200 characters.'; end if;
  if not coalesce(p_push, false) and not coalesce(p_banner, false) then raise exception 'Pick a phone notification, a banner, or both.'; end if;
  insert into public.announcements (by, title, body, banner, push, ends_at) values (auth.uid(), btrim(p_title), btrim(p_body), coalesce(p_banner, false), coalesce(p_push, false), now() + make_interval(days => greatest(1, least(coalesce(p_days, 3), 14)))) returning * into a;
  if a.push then
    for u in select distinct t.user_id from private.push_tokens t where coalesce(private.role_of(t.user_id), 'user') = 'user' and not exists (select 1 from private.suspended s where s.user_id = t.user_id) loop
      if private.push_enqueue(u.user_id, 'announcement', null, a.title, a.body, 'home', 'ann:' || a.id, interval '1 day') then n := n + 1; end if;
    end loop;
    update public.announcements set pushed = n where id = a.id;
    perform private.push_poke();
  end if;
  perform private.log_admin('announcement', jsonb_build_object('title', a.title, 'push', a.push, 'banner', a.banner, 'pushed', n));
  return jsonb_build_object('id', a.id, 'pushed', n, 'reach', (select count(distinct user_id) from private.push_tokens));
end $f$;
create or replace function public.admin_announcements() returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  return jsonb_build_object('list', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'title', a.title, 'body', a.body, 'banner', a.banner, 'push', a.push, 'pushed', a.pushed, 'ends_at', a.ends_at, 'live', a.banner and a.ends_at > now(), 'who', coalesce(p.name, 'Removed account')) order by a.at desc)
    from (select * from public.announcements order by at desc limit 20) a left join public.profiles p on p.id = a.by), '[]'::jsonb),
    'phones', (select count(distinct t.user_id) from private.push_tokens t where coalesce(private.role_of(t.user_id), 'user') = 'user'));
end $f$;
create or replace function public.admin_end_announcement(p_id uuid) returns void language plpgsql security definer set search_path = public, private as $f$
begin
  perform private.require_admin();
  update public.announcements set ends_at = now() where id = p_id;
  perform private.log_admin('announcement_ended', jsonb_build_object('id', p_id, 'title', (select title from public.announcements where id = p_id)));
end $f$;
revoke all on function public.current_announcement(), public.admin_announce(text, text, boolean, boolean, integer), public.admin_announcements(), public.admin_end_announcement(uuid) from public, anon;
grant execute on function public.current_announcement(), public.admin_announce(text, text, boolean, boolean, integer), public.admin_announcements(), public.admin_end_announcement(uuid) to authenticated;
revoke all on function public.admin_find_venues(text), public.admin_venue_overview(uuid), public.admin_save_venue(uuid, text, text), public.admin_app_settings(), public.admin_set_app_setting(text, jsonb) from public, anon;
grant execute on function public.admin_find_venues(text), public.admin_venue_overview(uuid), public.admin_save_venue(uuid, text, text), public.admin_app_settings(), public.admin_set_app_setting(text, jsonb) to authenticated;
notify pgrst, 'reload schema';
insert into private.migration_log (file) values ('0053_admin_full_access');
