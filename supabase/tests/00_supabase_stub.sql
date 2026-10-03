-- Stand-in for the parts of Supabase the migration relies on, so the database
-- can be tested on a plain local Postgres. Never run this on a real Supabase project.
create schema auth;
create table auth.users (
  id uuid primary key, email text, encrypted_password text, email_confirmed_at timestamptz,
  is_anonymous boolean not null default false, raw_app_meta_data jsonb, created_at timestamptz not null default now(), updated_at timestamptz
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create schema extensions;
create extension pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- Supabase hands these roles full rights on anything new in the public schema.
-- Copying that here means the tests prove the migration takes those rights back.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
