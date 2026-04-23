-- intake-attachments Storage Bucket
-- Public-read bucket for Round 3 file uploads.
--
-- Security model:
--   Writes:          service-role only. Upload route (src/app/api/screen/upload/route.ts)
--                    uses supabaseAdmin; its server-side OTP check is the access gate.
--   Reads (SELECT):  public. Required so getPublicUrl() returns accessible URLs for
--                    intake attachments shared with operators.
--   Updates/deletes: service-role only (not exposed).
--
-- File-size and MIME limits are enforced both at the bucket (below) and in the
-- upload route (belt-and-braces).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-attachments',
  'intake-attachments',
  true,
  10485760,   -- 10 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public SELECT - required so getPublicUrl() returns accessible URLs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'intake_attachments_public_read'
  ) THEN
    CREATE POLICY "intake_attachments_public_read"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'intake-attachments');
  END IF;
END $$;

-- Drop the stale anon INSERT policy if a prior revision of this migration
-- ever created it in any environment. Writes go through service-role only -
-- anon has no legitimate write path to this bucket.
DROP POLICY IF EXISTS "intake_attachments_anon_insert" ON storage.objects;

NOTIFY pgrst, 'reload schema';
