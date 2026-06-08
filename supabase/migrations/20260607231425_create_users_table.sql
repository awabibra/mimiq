-- ============================================================
-- MimiQ — User preferences
-- Stores durable onboarding preferences for each authenticated user.
-- ============================================================

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  daw text,
  genres text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.users to authenticated;

drop policy if exists "Users can read their own profile" on public.users;
create policy "Users can read their own profile"
  on public.users
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.users;
create policy "Users can create their own profile"
  on public.users
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can delete their own profile" on public.users;
create policy "Users can delete their own profile"
  on public.users
  for delete
  to authenticated
  using ((select auth.uid()) = id);
