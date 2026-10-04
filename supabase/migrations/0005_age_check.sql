-- Third-party age check: a selfie age estimate, with ID plus selfie only when the estimate is unsure.
-- The check itself runs on the provider's page (Yoti or Didit) and is driven by the Edge Function
-- in supabase/functions/age-check. This database keeps only the outcome: who passed, when, which
-- provider and which method. No photo, ID, date of birth or estimated age is stored here.
--
-- Off until switched on (see README, "Age check"):
--   update public.app_settings set age_check_provider = 'yoti', age_check_required = true;
--
-- Safe to run more than once.

-- ---------------------------------------------------------------- settings (one row)
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  age_check_required boolean not null default false,
  age_check_provider text not null default 'yoti' check (age_check_provider in ('yoti', 'didit'))
);
insert into public.app_settings default values on conflict do nothing;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;

-- ---------------------------------------------------------------- one row per age check attempt
create table if not exists public.age_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  provider_session text not null,
  result text not null default 'pending' check (result in ('pending', 'passed', 'failed')),
  method text,                       -- how they passed: 'face_estimate', 'id_document' or 'digital_id'
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (provider, provider_session)
);
create index if not exists age_checks_user on public.age_checks (user_id, created_at desc);
alter table public.age_checks enable row level security;
revoke all on public.age_checks from public, anon, authenticated;

alter table public.profiles add column if not exists age_verified_at timestamptz;

create or replace function public.age_check_required() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select age_check_required from public.app_settings), false);
$$;

create or replace function public.age_check_passed(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = u and age_verified_at is not null)
      or exists (select 1 from public.age_checks where user_id = u and result = 'passed');
$$;

-- What the app needs to know before and after sign-up.
create or replace function public.age_check_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', public.age_check_required(),
    'provider', (select age_check_provider from public.app_settings),
    'passed', public.age_check_passed(auth.uid()),
    'pending', exists (select 1 from public.age_checks where user_id = auth.uid() and result = 'pending'),
    'failed_today', (select count(*) from public.age_checks where user_id = auth.uid() and result = 'failed' and created_at > now() - interval '1 day')
  );
$$;

-- ---------------------------------------------------------------- sign-up now needs a passed check (when switched on)
-- Same as 0003, plus the age check. It now runs with the owner's rights so that the profiles table
-- can be closed to direct inserts: before this, a profile could be created without any age check.
create or replace function public.api_sign_up(p_name text, p_birth_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  if public.age_check_required() and not public.age_check_passed(auth.uid()) then
    raise exception 'Finish the age check first.';
  end if;
  insert into public.profiles (id, name, adult_confirmed_at, age_verified_at)
  values (auth.uid(), btrim(p_name), now(),
          (select max(decided_at) from public.age_checks where user_id = auth.uid() and result = 'passed'))
  on conflict (id) do update set name = excluded.name;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.api_sign_up(text, date) from public, anon, authenticated;
grant execute on function public.api_sign_up(text, date) to authenticated;

-- Profiles are only created through api_sign_up now.
revoke insert on public.profiles from authenticated;
drop policy if exists profiles_insert on public.profiles;

-- People who signed up before the check was switched on stay hidden (Red) until they pass it.
create or replace function public.set_status(new_colour public.status_colour) returns public.statuses
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  result public.statuses;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if new_colour <> 'off' and public.age_check_required() and not public.age_check_passed(me) then
    raise exception 'Finish the age check first.';
  end if;
  insert into public.statuses (user_id, colour, expires_at, updated_at)
  values (
    me, new_colour,
    case new_colour when 'on' then now() + interval '4 hours' when 'thinking' then now() + interval '2 hours' else null end,
    now()
  )
  on conflict (user_id) do update
    set colour = excluded.colour, expires_at = excluded.expires_at, updated_at = excluded.updated_at
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------- called only by the Edge Function (service role)
-- Before a new check: refuses if already passed or after 5 attempts in a day (each check costs money).
create or replace function public.age_check_can_start(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.age_check_passed(p_user) then raise exception 'You have already passed the age check.'; end if;
  if (select count(*) from public.age_checks where user_id = p_user and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many age check attempts today. Try again tomorrow.';
  end if;
  return jsonb_build_object('provider', (select age_check_provider from public.app_settings));
end;
$$;

create or replace function public.age_check_begin(p_user uuid, p_provider text, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  -- Any older unfinished attempt is abandoned: only the newest one counts.
  update public.age_checks set result = 'failed', decided_at = now() where user_id = p_user and result = 'pending';
  insert into public.age_checks (user_id, provider, provider_session) values (p_user, p_provider, p_session)
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;

create or replace function public.age_check_latest(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('id', c.id, 'provider', c.provider, 'provider_session', c.provider_session, 'result', c.result)
    from public.age_checks c where c.user_id = p_user order by c.created_at desc limit 1
  ), 'null'::jsonb);
$$;

create or replace function public.age_check_decide(p_check uuid, p_result text, p_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if p_result not in ('passed', 'failed') then raise exception 'Unknown result %', p_result; end if;
  update public.age_checks set result = p_result, method = p_method, decided_at = now()
  where id = p_check and result = 'pending' returning user_id into who;
  if who is not null and p_result = 'passed' then
    update public.profiles set age_verified_at = now() where id = who and age_verified_at is null;
  end if;
  return jsonb_build_object('result', p_result);
end;
$$;

-- Deleting an account also removes its age check records.
create or replace function public.forget_age_checks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.age_checks where user_id = old.id;
  return old;
end;
$$;
drop trigger if exists profiles_forget_age_checks on public.profiles;
create trigger profiles_forget_age_checks after delete on public.profiles
  for each row execute function public.forget_age_checks();

revoke all on function public.age_check_required(), public.age_check_passed(uuid), public.age_check_state(),
  public.age_check_can_start(uuid), public.age_check_begin(uuid, text, text), public.age_check_latest(uuid),
  public.age_check_decide(uuid, text, text), public.forget_age_checks()
  from public, anon, authenticated;
grant execute on function public.age_check_state() to authenticated;
grant execute on function public.set_status(public.status_colour) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.age_check_can_start(uuid), public.age_check_begin(uuid, text, text),
      public.age_check_latest(uuid), public.age_check_decide(uuid, text, text) to service_role;
  end if;
end;
$$;
