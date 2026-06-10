-- ============================================================
-- MimiQ - Level Lab history
-- Stores measured Level Lab reports per authenticated project owner.
-- ============================================================

create table if not exists public.level_lab_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chain_id text,
  vocal_version_id text,
  processed_path text,
  score numeric,
  report jsonb not null default '{}'::jsonb,
  delta jsonb not null default '{}'::jsonb,
  deltas jsonb,
  next_action text,
  created_at timestamptz not null default now()
);

alter table if exists public.level_lab_history
  add column if not exists processed_path text,
  add column if not exists score numeric,
  add column if not exists deltas jsonb,
  add column if not exists next_action text;

create index if not exists idx_level_lab_history_project_created
  on public.level_lab_history (project_id, created_at desc);

create index if not exists idx_level_lab_history_user_created
  on public.level_lab_history (user_id, created_at desc);

alter table public.level_lab_history enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.level_lab_history to authenticated;

drop policy if exists "Users can read their level lab history" on public.level_lab_history;
create policy "Users can read their level lab history"
  on public.level_lab_history
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their level lab history" on public.level_lab_history;
create policy "Users can create their level lab history"
  on public.level_lab_history
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.projects
      where projects.id = level_lab_history.project_id
        and projects.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update their level lab history" on public.level_lab_history;
create policy "Users can update their level lab history"
  on public.level_lab_history
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their level lab history" on public.level_lab_history;
create policy "Users can delete their level lab history"
  on public.level_lab_history
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
