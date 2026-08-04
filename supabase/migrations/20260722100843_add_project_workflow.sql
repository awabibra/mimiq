-- MimiQ project workflow: immutable evidence, deterministic mix plans, and
-- a certified capability catalogue. Workflow state is derived in the app.

create table if not exists public.project_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_type text not null check (run_type in ('diagnosis', 'verification')),
  input_asset_ids text[] not null default '{}'::text[],
  analysis_version text not null,
  measurements jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  limitations text[] not null default '{}'::text[],
  fallback_used boolean not null default false,
  fallback_reason text,
  created_at timestamptz not null default now(),
  constraint project_analysis_measurements_object
    check (jsonb_typeof(measurements) = 'object'),
  constraint project_analysis_findings_array
    check (jsonb_typeof(findings) = 'array'),
  constraint project_analysis_provenance_object
    check (jsonb_typeof(provenance) = 'object')
);

create index if not exists project_analysis_runs_project_created_idx
  on public.project_analysis_runs (project_id, created_at desc);

create table if not exists public.plugin_catalog (
  id text primary key,
  name text not null,
  manufacturer text not null,
  daw text check (
    daw is null
    or daw = any (array['Logic Pro', 'FL Studio', 'Ableton Live', 'Pro Tools']::text[])
  ),
  bundle_id text check (
    bundle_id is null
    or bundle_id = any (
      array[
        'waves_gold',
        'waves_ultimate',
        'fabfilter',
        'soundtoys',
        'antares_auto_tune'
      ]::text[]
    )
  ),
  capability text not null check (
    capability = any (
      array['equalizer', 'compressor', 'de_esser', 'pitch', 'reverb', 'delay']::text[]
    )
  ),
  parameter_schema jsonb not null default '{}'::jsonb,
  verified_ranges jsonb not null default '{}'::jsonb,
  stock boolean not null default false,
  coverage_status text not null default 'draft'
    check (coverage_status in ('draft', 'certified', 'unsupported')),
  catalogue_version text not null,
  verified_at timestamptz,
  source_note text not null,
  constraint plugin_catalog_parameter_schema_object
    check (jsonb_typeof(parameter_schema) = 'object'),
  constraint plugin_catalog_verified_ranges_object
    check (jsonb_typeof(verified_ranges) = 'object'),
  constraint plugin_catalog_owner_mapping
    check ((stock and daw is not null and bundle_id is null) or (not stock and bundle_id is not null))
);

create index if not exists plugin_catalog_selection_idx
  on public.plugin_catalog (capability, coverage_status, daw, bundle_id);

create table if not exists public.project_mix_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  analysis_run_id uuid not null references public.project_analysis_runs(id) on delete restrict,
  target_profile jsonb not null default '{}'::jsonb,
  plugin_catalogue_version text not null,
  instructions jsonb not null default '[]'::jsonb,
  completion_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_mix_plans_target_object
    check (jsonb_typeof(target_profile) = 'object'),
  constraint project_mix_plans_instructions_array
    check (jsonb_typeof(instructions) = 'array'),
  constraint project_mix_plans_completion_object
    check (jsonb_typeof(completion_state) = 'object')
);

create index if not exists project_mix_plans_project_created_idx
  on public.project_mix_plans (project_id, created_at desc);

alter table public.projects
  add column if not exists target_profile jsonb not null default '{}'::jsonb,
  add column if not exists active_analysis_run_id uuid references public.project_analysis_runs(id) on delete set null,
  add column if not exists active_mix_plan_id uuid references public.project_mix_plans(id) on delete set null;

alter table public.projects
  drop constraint if exists projects_target_profile_object;

alter table public.projects
  add constraint projects_target_profile_object
    check (jsonb_typeof(target_profile) = 'object');

alter table public.project_analysis_runs enable row level security;
alter table public.project_mix_plans enable row level security;
alter table public.plugin_catalog enable row level security;

grant usage on schema public to authenticated;
grant select, insert on public.project_analysis_runs to authenticated;
grant select, insert, update on public.project_mix_plans to authenticated;
grant select on public.plugin_catalog to authenticated;

drop policy if exists "Users can read project analysis runs" on public.project_analysis_runs;
create policy "Users can read project analysis runs"
  on public.project_analysis_runs for select to authenticated
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_analysis_runs.project_id
        and projects.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can create project analysis runs" on public.project_analysis_runs;
create policy "Users can create project analysis runs"
  on public.project_analysis_runs for insert to authenticated
  with check (
    exists (
      select 1 from public.projects
      where projects.id = project_analysis_runs.project_id
        and projects.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can read project mix plans" on public.project_mix_plans;
create policy "Users can read project mix plans"
  on public.project_mix_plans for select to authenticated
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_mix_plans.project_id
        and projects.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can create project mix plans" on public.project_mix_plans;
create policy "Users can create project mix plans"
  on public.project_mix_plans for insert to authenticated
  with check (
    exists (
      select 1 from public.projects
      where projects.id = project_mix_plans.project_id
        and projects.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update project mix plans" on public.project_mix_plans;
create policy "Users can update project mix plans"
  on public.project_mix_plans for update to authenticated
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_mix_plans.project_id
        and projects.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.projects
      where projects.id = project_mix_plans.project_id
        and projects.user_id = (select auth.uid())
    )
  );

drop policy if exists "Authenticated users can read certified plugins" on public.plugin_catalog;
create policy "Authenticated users can read certified plugins"
  on public.plugin_catalog for select to authenticated
  using (coverage_status = 'certified');

insert into public.plugin_catalog (
  id, name, manufacturer, daw, capability, parameter_schema, verified_ranges,
  stock, coverage_status, catalogue_version, verified_at, source_note
)
values
  ('logic-channel-eq', 'Channel EQ', 'Apple', 'Logic Pro', 'equalizer',
    '{"filter_types":["bell","low_cut","high_shelf"],"parameters":["frequency_hz","gain_db","q"]}',
    '{"frequency_hz":[20,20000],"gain_db":[-24,24],"q":[0.1,100]}',
    true, 'certified', 'stock-v1', now(), 'Logic Pro stock equalizer capability verified for bounded frequency, gain, and Q instructions.'),
  ('logic-compressor', 'Compressor', 'Apple', 'Logic Pro', 'compressor',
    '{"parameters":["threshold_db","ratio","attack_ms","release_ms"]}',
    '{"threshold_db":[-50,0],"ratio":[1,30],"attack_ms":[0,200],"release_ms":[5,5000]}',
    true, 'certified', 'stock-v1', now(), 'Logic Pro stock compressor capability.'),
  ('logic-deesser-2', 'DeEsser 2', 'Apple', 'Logic Pro', 'de_esser',
    '{"parameters":["frequency_hz","reduction_db"]}',
    '{"frequency_hz":[2000,20000],"reduction_db":[0,20]}',
    true, 'certified', 'stock-v1', now(), 'Logic Pro stock de-esser capability.'),
  ('fl-parametric-eq-2', 'Fruity Parametric EQ 2', 'Image-Line', 'FL Studio', 'equalizer',
    '{"filter_types":["peaking","high_pass","shelf"],"parameters":["frequency_hz","gain_db","bandwidth_octaves"]}',
    '{"frequency_hz":[20,20000],"gain_db":[-18,18],"bandwidth_octaves":[0.01,5]}',
    true, 'certified', 'stock-v1', now(), 'FL Studio stock equalizer capability; Q is converted to bandwidth before display.'),
  ('fl-fruity-limiter', 'Fruity Limiter', 'Image-Line', 'FL Studio', 'compressor',
    '{"parameters":["threshold_db","ratio","attack_ms","release_ms"]}',
    '{"threshold_db":[-60,0],"ratio":[1,20],"attack_ms":[0,1000],"release_ms":[1,1000]}',
    true, 'certified', 'stock-v1', now(), 'FL Studio stock compression capability.'),
  ('fl-maximus-deesser', 'Maximus', 'Image-Line', 'FL Studio', 'de_esser',
    '{"parameters":["band_low_hz","band_high_hz","threshold_db","gain_db"]}',
    '{"band_low_hz":[2000,10000],"band_high_hz":[5000,20000],"threshold_db":[-60,0],"gain_db":[-18,0]}',
    true, 'certified', 'stock-v1', now(), 'FL Studio stock multiband capability used only for bounded sibilance control.'),
  ('ableton-eq-eight', 'EQ Eight', 'Ableton', 'Ableton Live', 'equalizer',
    '{"filter_types":["bell","low_cut","shelf"],"parameters":["frequency_hz","gain_db","q"]}',
    '{"frequency_hz":[10,22000],"gain_db":[-15,15],"q":[0.1,18]}',
    true, 'certified', 'stock-v1', now(), 'Ableton Live stock equalizer capability.'),
  ('ableton-compressor', 'Compressor', 'Ableton', 'Ableton Live', 'compressor',
    '{"parameters":["threshold_db","ratio","attack_ms","release_ms"]}',
    '{"threshold_db":[-60,0],"ratio":[1,20],"attack_ms":[0.01,1000],"release_ms":[1,3000]}',
    true, 'certified', 'stock-v1', now(), 'Ableton Live stock compressor capability.'),
  ('ableton-multiband-deesser', 'Multiband Dynamics', 'Ableton', 'Ableton Live', 'de_esser',
    '{"parameters":["high_crossover_hz","threshold_db","ratio"]}',
    '{"high_crossover_hz":[2000,12000],"threshold_db":[-60,0],"ratio":[1,20]}',
    true, 'certified', 'stock-v1', now(), 'Ableton Live stock multiband capability used only for bounded sibilance control.'),
  ('protools-eq3-7band', 'EQ3 7-Band', 'Avid', 'Pro Tools', 'equalizer',
    '{"filter_types":["bell","high_pass","shelf"],"parameters":["frequency_hz","gain_db","q"]}',
    '{"frequency_hz":[20,20000],"gain_db":[-18,18],"q":[0.1,10]}',
    true, 'certified', 'stock-v1', now(), 'Pro Tools stock equalizer capability.'),
  ('protools-dyn3-compressor', 'Dyn3 Compressor/Limiter', 'Avid', 'Pro Tools', 'compressor',
    '{"parameters":["threshold_db","ratio","attack_ms","release_ms"]}',
    '{"threshold_db":[-60,0],"ratio":[1,100],"attack_ms":[0.01,300],"release_ms":[5,3000]}',
    true, 'certified', 'stock-v1', now(), 'Pro Tools stock compressor capability.'),
  ('protools-dyn3-deesser', 'Dyn3 De-Esser', 'Avid', 'Pro Tools', 'de_esser',
    '{"parameters":["frequency_hz","threshold_db","range_db"]}',
    '{"frequency_hz":[2000,20000],"threshold_db":[-60,0],"range_db":[0,20]}',
    true, 'certified', 'stock-v1', now(), 'Pro Tools stock de-esser capability.')
on conflict (id) do update set
  name = excluded.name,
  manufacturer = excluded.manufacturer,
  daw = excluded.daw,
  capability = excluded.capability,
  parameter_schema = excluded.parameter_schema,
  verified_ranges = excluded.verified_ranges,
  stock = excluded.stock,
  coverage_status = excluded.coverage_status,
  catalogue_version = excluded.catalogue_version,
  verified_at = excluded.verified_at,
  source_note = excluded.source_note;
