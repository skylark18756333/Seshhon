-- 0050: venue stats. Anonymous counts per venue, per night and hour: sesh votes, sesh picks (a sesh locked to the
-- venue), Sesh Map stops and confirmed deal codes, plus uses per deal. Nothing says who: no user ids, no locations.
-- The counts are kept apart from sesh data, so they stay after a sesh is wiped (data rule: seshes go when they end
-- or 8 hours after start). A venue account sees its own venue (venue_stats); admins can read any venue.
-- Needs 0001, 0019 and 0027. Safe to run more than once. Counting never blocks the app: any error is skipped.
create table if not exists private.venue_counts (venue_id uuid not null references public.venues (id) on delete cascade, night date not null, hour smallint not null, votes integer not null default 0, picks integer not null default 0, stops integer not null default 0, uses integer not null default 0, primary key (venue_id, night, hour));
create table if not exists private.deal_counts (deal_id uuid not null, venue_id uuid not null references public.venues (id) on delete cascade, title text not null, night date not null, uses integer not null default 0, primary key (deal_id, night));
alter table private.venue_counts enable row level security;
alter table private.deal_counts enable row level security;
revoke all on private.venue_counts, private.deal_counts from public, anon, authenticated;

create or replace function private.venue_bump(p_venue uuid, p_votes integer, p_picks integer, p_stops integer, p_uses integer) returns void language sql security definer set search_path = public, private as $f$ insert into private.venue_counts as c (venue_id, night, hour, votes, picks, stops, uses) values (p_venue, public.night_of(), extract(hour from public.local_now())::smallint, p_votes, p_picks, p_stops, p_uses) on conflict (venue_id, night, hour) do update set votes = c.votes + excluded.votes, picks = c.picks + excluded.picks, stops = c.stops + excluded.stops, uses = c.uses + excluded.uses $f$;
revoke all on function private.venue_bump(uuid, integer, integer, integer, integer) from public, anon, authenticated;

create or replace function private.count_vote() returns trigger language plpgsql security definer set search_path = public, private as $f$ begin begin if tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id then perform private.venue_bump(new.venue_id, 1, 0, 0, 0); end if; exception when others then null; end; return new; end $f$;
create or replace function private.count_pick() returns trigger language plpgsql security definer set search_path = public, private as $f$ begin begin if new.locked_venue is not null and (tg_op = 'INSERT' or new.locked_venue is distinct from old.locked_venue) then perform private.venue_bump(new.locked_venue, 0, 1, 0, 0); end if; exception when others then null; end; return new; end $f$;
create or replace function private.count_stop() returns trigger language plpgsql security definer set search_path = public, private as $f$ begin begin perform private.venue_bump(new.venue_id, 0, 0, 1, 0); exception when others then null; end; return new; end $f$;
create or replace function private.count_use() returns trigger language plpgsql security definer set search_path = public, private as $f$ declare d record; begin begin if new.confirmed_at is not null and old.confirmed_at is null then select id, venue_id, title into d from public.deals where id = new.deal_id; if found then perform private.venue_bump(d.venue_id, 0, 0, 0, 1); insert into private.deal_counts as c (deal_id, venue_id, title, night, uses) values (d.id, d.venue_id, d.title, public.night_of(), 1) on conflict (deal_id, night) do update set uses = c.uses + 1, title = excluded.title; end if; end if; exception when others then null; end; return new; end $f$;
revoke all on function private.count_vote(), private.count_pick(), private.count_stop(), private.count_use() from public, anon, authenticated;
drop trigger if exists venue_votes_count on public.venue_votes;
create trigger venue_votes_count after insert or update of venue_id on public.venue_votes for each row execute function private.count_vote();
drop trigger if exists seshes_count_pick on public.seshes;
create trigger seshes_count_pick after insert or update of locked_venue on public.seshes for each row execute function private.count_pick();
drop trigger if exists crawl_stops_count on public.crawl_stops;
create trigger crawl_stops_count after insert on public.crawl_stops for each row execute function private.count_stop();
drop trigger if exists redemptions_count on public.redemptions;
create trigger redemptions_count after update of confirmed_at on public.redemptions for each row execute function private.count_use();

-- Everything the venue page's Stats shows: this week and last week, the last 28 nights, busy times over 8 weeks
-- (weekday 0 = Sunday, by hour) and uses per deal per week over 8 weeks.
create or replace function public.venue_stats(p_venue uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $f$
declare t date := public.night_of(); r jsonb;
begin
  if coalesce(private.role_of(auth.uid()), '') <> 'admin' then perform private.require_my_venue(p_venue); end if;
  select jsonb_build_object(
    'week', (select jsonb_build_object('votes', coalesce(sum(votes), 0), 'picks', coalesce(sum(picks), 0), 'stops', coalesce(sum(stops), 0), 'uses', coalesce(sum(uses), 0)) from private.venue_counts where venue_id = p_venue and night > t - 7),
    'last_week', (select jsonb_build_object('votes', coalesce(sum(votes), 0), 'picks', coalesce(sum(picks), 0), 'stops', coalesce(sum(stops), 0), 'uses', coalesce(sum(uses), 0)) from private.venue_counts where venue_id = p_venue and night > t - 14 and night <= t - 7),
    'nights', (select coalesce(jsonb_agg(jsonb_build_object('night', g::date, 'votes', coalesce(x.votes, 0), 'picks', coalesce(x.picks, 0), 'stops', coalesce(x.stops, 0), 'uses', coalesce(x.uses, 0)) order by g), '[]'::jsonb) from generate_series(t - 27, t, interval '1 day') g left join (select night, sum(votes) votes, sum(picks) picks, sum(stops) stops, sum(uses) uses from private.venue_counts where venue_id = p_venue and night > t - 28 group by night) x on x.night = g::date),
    'busy', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'n', n)), '[]'::jsonb) from (select extract(dow from night)::int dow, hour, sum(votes + picks + stops + uses)::int n from private.venue_counts where venue_id = p_venue and night > t - 56 group by 1, 2) b),
    'deals', (select coalesce(jsonb_agg(jsonb_build_object('deal_id', deal_id, 'title', title, 'total', total, 'weeks', weeks) order by total desc), '[]'::jsonb) from (select deal_id, max(title) title, sum(uses)::int total, jsonb_agg(jsonb_build_object('week', (t - night) / 7, 'uses', uses)) weeks from private.deal_counts where venue_id = p_venue and night > t - 56 group by deal_id) d)
  ) into r;
  return r;
end $f$;
revoke all on function public.venue_stats(uuid) from public, anon;
grant execute on function public.venue_stats(uuid) to authenticated;
notify pgrst, 'reload schema';
insert into private.migration_log (file) values ('0050_venue_stats');
