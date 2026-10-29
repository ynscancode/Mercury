-- Local-only stand-in for the parts of Supabase the migration depends on.
-- Not deployed: Supabase provides auth.users, auth.uid() and these roles.
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase derives this from the request JWT. Locally a session GUC stands in,
-- so a test can "become" a user with: set local daybook.test_user_id = '...'
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('daybook.test_user_id', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public, auth to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
