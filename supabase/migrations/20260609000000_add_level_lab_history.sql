-- ============================================================
-- MimiQ — Level Lab history
-- Stores measured processed-export comparisons for a project.
-- ============================================================

create table if not exists public.level_lab_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chain_id text,
  vocal_version_id text,
  raw_path text,
  processed_path text,
  lufs_delta double precision not null,
  dynamic_range_delta double precision not null,
  verdict text not null check (verdict in ('improved', 'regressed', 'unknown')),
  next_action text,
  created_at timestamptz not null default now()
);

create index if not exists idx_level_lab_history_user_created
  on public.level_lab_history (user_id, created_at desc);

create index if not exists idx_level_lab_history_project_created
  on public.level_lab_history (project_id, created_at desc);

alter table public.level_lab_history enable row level security;

grant usage on schema public to authenticated;
grant select, insert on public.level_lab_history to authenticated;

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
  with check ((select auth.uid()) = user_id);
