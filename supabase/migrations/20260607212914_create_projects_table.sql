-- ============================================================
-- MimiQ — Projects
-- The project is the durable working document for all tool rooms.
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  beat_file_url text,
  beat_filename text,
  vocal_versions jsonb not null default '[]'::jsonb,
  current_vocal_index integer not null default 0 check (current_vocal_index >= 0),
  generated_chains jsonb not null default '[]'::jsonb,
  mix_room_report jsonb,
  level_lab_report jsonb,
  stem_split_url text,
  last_opened_at timestamptz not null default now()
);

create index if not exists idx_projects_user_last_opened
  on public.projects (user_id, last_opened_at desc);

alter table public.projects enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects to authenticated;

drop policy if exists "Users can read their projects" on public.projects;
create policy "Users can read their projects"
  on public.projects
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their projects" on public.projects;
create policy "Users can create their projects"
  on public.projects
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their projects" on public.projects;
create policy "Users can update their projects"
  on public.projects
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their projects" on public.projects;
create policy "Users can delete their projects"
  on public.projects
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  52428800,
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/aiff',
    'audio/x-aiff'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their project files" on storage.objects;
create policy "Users can read their project files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-files'
    and owner_id = (select auth.uid()::text)
  );

drop policy if exists "Users can upload their project files" on storage.objects;
create policy "Users can upload their project files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-files'
    and owner_id = (select auth.uid()::text)
  );

drop policy if exists "Users can update their project files" on storage.objects;
create policy "Users can update their project files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'project-files'
    and owner_id = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'project-files'
    and owner_id = (select auth.uid()::text)
  );

drop policy if exists "Users can delete their project files" on storage.objects;
create policy "Users can delete their project files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-files'
    and owner_id = (select auth.uid()::text)
  );
