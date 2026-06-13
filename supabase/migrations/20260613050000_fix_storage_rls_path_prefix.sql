-- mimiq — Fix storage RLS policies for project-files bucket.
--
-- Root cause: Supabase Storage populates storage.objects.owner_id AFTER
-- the policy check fires during INSERT. Any policy that checks
-- "owner_id = auth.uid()" will always see owner_id as NULL at the time
-- of the check, causing every authenticated upload to fail with 400/403.
--
-- Fix: match on the path prefix (the first folder component) instead.
-- The app always writes paths as: userId/projectId/kind/uuid-filename
-- so (storage.foldername(name))[1] reliably equals the uploading user's id.

-- ── Read ──────────────────────────────────────────────────────────────────
drop policy if exists "Users can read their project files" on storage.objects;
create policy "Users can read their project files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ── Upload ────────────────────────────────────────────────────────────────
drop policy if exists "Users can upload their project files" on storage.objects;
create policy "Users can upload their project files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ── Update ────────────────────────────────────────────────────────────────
drop policy if exists "Users can update their project files" on storage.objects;
create policy "Users can update their project files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ── Delete ────────────────────────────────────────────────────────────────
drop policy if exists "Users can delete their project files" on storage.objects;
create policy "Users can delete their project files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ── Bucket MIME types ──────────────────────────────────────────────────────
-- Keep all common browser-variant MIME strings accepted so uploads are never
-- rejected at the content-type level. Browsers disagree on aiff/flac strings.
update storage.buckets
set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/flac',
    'audio/x-flac',
    'audio/aiff',
    'audio/x-aiff',
    'audio/aif',
    'audio/x-aif'
  ]
where id = 'project-files';
