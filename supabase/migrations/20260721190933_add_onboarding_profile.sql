alter table public.users
  add column if not exists plugins text[] not null default '{}'::text[],
  add column if not exists onboarding_completed_at timestamptz;

alter table public.users
  drop constraint if exists users_daw_supported,
  drop constraint if exists users_plugins_supported,
  drop constraint if exists users_onboarding_requires_daw;

alter table public.users
  add constraint users_daw_supported
    check (
      daw is null
      or daw = any (
        array['Logic Pro', 'FL Studio', 'Ableton Live', 'Pro Tools']::text[]
      )
    ),
  add constraint users_plugins_supported
    check (
      plugins <@ array[
        'waves_gold',
        'waves_ultimate',
        'fabfilter',
        'soundtoys',
        'antares_auto_tune'
      ]::text[]
    ),
  add constraint users_onboarding_requires_daw
    check (onboarding_completed_at is null or daw is not null);

grant select, insert, update, delete on public.users to authenticated;
