-- MimiQ - canonical project audio assets
-- Keeps legacy columns for one compatibility release while making audio_assets
-- the durable project-owned source of truth.

alter table public.projects
  add column if not exists audio_assets jsonb not null default '[]'::jsonb;

alter table public.projects
  drop constraint if exists projects_audio_assets_is_array;

alter table public.projects
  add constraint projects_audio_assets_is_array
  check (jsonb_typeof(audio_assets) = 'array');

with legacy_assets as (
  select
    p.id,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', coalesce(v.version->>'id', gen_random_uuid()::text),
            'kind', 'vocal',
            'filename', coalesce(v.version->>'filename', 'vocal.wav'),
            'mimeType', 'audio/mpeg',
            'size', 0,
            'duration', null,
            'storagePath', v.version->>'url',
            'createdAt', coalesce(v.version->>'uploaded_at', p.created_at::text),
            'status', 'ready',
            'error', null
          )
        )
        from jsonb_array_elements(p.vocal_versions) as v(version)
        where
          nullif(v.version->>'url', '') is not null
          and (v.version->>'url') not like 'blob:%'
          and (v.version->>'url') not like 'data:%'
          and (v.version->>'url') not like 'filesystem:%'
      ),
      '[]'::jsonb
    )
    ||
    case
      when nullif(p.beat_file_url, '') is not null
        and p.beat_file_url not like 'blob:%'
        and p.beat_file_url not like 'data:%'
        and p.beat_file_url not like 'filesystem:%'
      then jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'beat',
          'filename', coalesce(p.beat_filename, 'beat.wav'),
          'mimeType', 'audio/mpeg',
          'size', 0,
          'duration', null,
          'storagePath', p.beat_file_url,
          'createdAt', p.created_at::text,
          'status', 'ready',
          'error', null
        )
      )
      else '[]'::jsonb
    end
    ||
    case
      when nullif(p.stem_split_url, '') is not null
        and p.stem_split_url not like 'blob:%'
        and p.stem_split_url not like 'data:%'
        and p.stem_split_url not like 'filesystem:%'
      then jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'stem',
          'filename', 'stem-split.zip',
          'mimeType', 'application/zip',
          'size', 0,
          'duration', null,
          'storagePath', p.stem_split_url,
          'createdAt', p.updated_at::text,
          'status', 'ready',
          'error', null
        )
      )
      else '[]'::jsonb
    end as audio_assets
  from public.projects p
  where jsonb_array_length(p.audio_assets) = 0
)
update public.projects p
set audio_assets = legacy_assets.audio_assets
from legacy_assets
where p.id = legacy_assets.id
  and jsonb_array_length(p.audio_assets) = 0
  and jsonb_array_length(legacy_assets.audio_assets) > 0;
