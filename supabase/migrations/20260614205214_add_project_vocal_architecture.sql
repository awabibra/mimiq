-- MimiQ - first-class project vocal architecture.
-- Stores the seven-track stack as project document state.

alter table public.projects
  add column if not exists vocal_architecture jsonb;

alter table public.projects
  drop constraint if exists projects_vocal_architecture_is_object;

alter table public.projects
  add constraint projects_vocal_architecture_is_object
  check (
    vocal_architecture is null
    or jsonb_typeof(vocal_architecture) = 'object'
  );
