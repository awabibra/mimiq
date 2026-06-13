-- MimiQ - accept browser-specific project audio MIME types.
-- Browsers disagree on FLAC/AIFF MIME strings, so keep all currently
-- supported formats explicit on the private project-files bucket.

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
