-- Summitra: Auth-backed profiles + RLS
--
-- BREAKING. Run this in the Supabase SQL editor BEFORE the JS rewrite.
-- The current app logs in by reading public.profiles.password with the anon key.
-- After this script:
--   - that login path fails (password column gone, anon cannot read profiles)
--   - session inserts from the old client fail (RLS requires auth.uid())
--   - testers must re-register after the client is updated
--
-- Dashboard (not SQL) after this runs:
--   Authentication → Providers → Email: enabled
--   Authentication → Settings: Confirm email OFF for beta (or ON if you want verification)
--   Authentication → Settings: Minimum password length 8
--   Do not put the service_role key in the frontend

begin;

-- --------------------------------------------------------------------------
-- 1. Retire the plaintext profiles table (keep a locked copy for forensics)
-- --------------------------------------------------------------------------
-- If a previous attempt already renamed it, skip.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles_legacy_plaintext'
  ) then
    alter table public.profiles rename to profiles_legacy_plaintext;
  end if;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

alter table if exists public.profiles_legacy_plaintext enable row level security;

revoke all on table public.profiles_legacy_plaintext from anon, authenticated, public;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles_legacy_plaintext'
  ) then
    drop policy if exists "legacy_profiles_deny_all" on public.profiles_legacy_plaintext;
    -- No policies + RLS = API cannot read plaintext passwords
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2. New profiles: id is auth.users.id. No password column.
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  username text not null,
  display_name text,
  age integer,
  analytics_preference text,
  created_at timestamptz not null default now()
);

-- In case the table already existed from a partial run, guarantee shape:
alter table public.profiles
  add column if not exists email text,
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists age integer,
  add column if not exists analytics_preference text,
  add column if not exists created_at timestamptz not null default now();

alter table public.profiles drop column if exists password;

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email))
  where email is not null;

-- --------------------------------------------------------------------------
-- 3. Create profile row when Auth creates a user
--    Client signUp will pass username / display_name / age / analytics_preference
--    in raw_user_meta_data (JS change comes next).
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    username,
    display_name,
    age,
    analytics_preference
  )
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(nullif(new.raw_user_meta_data->>'age', '')::integer, 0),
    coalesce(new.raw_user_meta_data->>'analytics_preference', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- --------------------------------------------------------------------------
-- 4. Sessions: bind to auth uid. Old rows have no JWT user — wipe them.
-- --------------------------------------------------------------------------
alter table if exists public.sessions
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Old telemetry cannot be attributed to auth.users. Clear it for a clean RLS cutover.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sessions'
  ) then
    execute 'truncate table public.sessions';
  end if;
end $$;

-- Keep owner as a display label; security must not depend on it.
-- user_id is required for every new row.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sessions'
      and column_name = 'user_id'
  ) then
    alter table public.sessions alter column user_id set not null;
  end if;
end $$;

create index if not exists sessions_user_id_idx on public.sessions (user_id);

-- --------------------------------------------------------------------------
-- 5. Grants: anon gets nothing. authenticated gets least privilege.
-- --------------------------------------------------------------------------
revoke all on table public.profiles from anon, authenticated, public;
grant select, update on table public.profiles to authenticated;

revoke all on table public.sessions from anon, authenticated, public;
grant select, insert on table public.sessions to authenticated;

-- --------------------------------------------------------------------------
-- 6. RLS
-- --------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.sessions enable row level security;
alter table public.sessions force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_insert_own" on public.sessions;
drop policy if exists "sessions_update_own" on public.sessions;
drop policy if exists "sessions_delete_own" on public.sessions;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- Users may edit profile fields, not their id.
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy: rows come only from handle_new_user() (security definer).

create policy "sessions_select_own"
  on public.sessions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "sessions_insert_own"
  on public.sessions
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- No update/delete on sessions from the client.

commit;
