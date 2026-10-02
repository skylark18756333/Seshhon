-- Stand-in for the parts of Supabase the migration relies on, so the database
-- can be tested on a plain local Postgres. Never run this on a real Supabase project.
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create role authenticated nologin;
create role anon nologin;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
