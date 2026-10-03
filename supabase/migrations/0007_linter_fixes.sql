-- Fixes from Supabase's Security Advisor (October 2026). Safe to run more than once.

-- 1. "Function Search Path Mutable": pin these functions to the public schema, so nobody can
--    make them pick up a look-alike table or function from somewhere else.
alter function public.local_now(timestamptz) set search_path = public;
alter function public.night_of(timestamptz) set search_path = public;
alter function public.deal_is_running(public.deals, timestamptz) set search_path = public;
alter function public.new_invite_code() set search_path = public;
alter function public.check_alcohol_deal_count() set search_path = public;

-- 2. "Security Definer View" on venue_ratings. The view has to read everyone's ratings to work out
--    the averages, while people may only read their own ratings. That is now done by a function that
--    returns only the totals, and the view itself runs with the reader's own rights.
create or replace function public.venue_rating_totals()
returns table (venue_id uuid, average numeric, ratings bigint)
language sql stable security definer set search_path = public as $$
  select r.venue_id, round(avg(r.stars)::numeric, 1), count(*)
  from public.ratings r group by r.venue_id;
$$;
revoke all on function public.venue_rating_totals() from public, anon, authenticated;
grant execute on function public.venue_rating_totals() to authenticated;

create or replace view public.venue_ratings as
  select t.venue_id, t.average, t.ratings from public.venue_rating_totals() t;
alter view public.venue_ratings set (security_invoker = true);
revoke all on public.venue_ratings from public, anon, authenticated;
grant select on public.venue_ratings to authenticated;
