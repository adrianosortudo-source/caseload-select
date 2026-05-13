-- Firm onboarding intake — verification document upload columns + storage bucket
--
-- Extends firm_onboarding_intake with metadata for the optional business
-- verification document upload (Articles of Incorporation / utility bill /
-- tax document for Meta's WhatsApp Business Account verification).
--
-- The actual file lives in Supabase Storage in the firm-onboarding-docs
-- bucket (private). The row stores the storage path, original filename,
-- size, and MIME type so the operator can fetch the file via signed URL.

ALTER TABLE firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS verification_doc_storage_path text,
  ADD COLUMN IF NOT EXISTS verification_doc_original_name text,
  ADD COLUMN IF NOT EXISTS verification_doc_size_bytes integer,
  ADD COLUMN IF NOT EXISTS verification_doc_mime_type text;

COMMENT ON COLUMN firm_onboarding_intake.verification_doc_storage_path IS
  'Path inside the firm-onboarding-docs Supabase Storage bucket. Use signed URLs to access.';

-- Private storage bucket for verification documents.
-- The bucket is private; access happens via service-role on the server side.
-- 10 MB size limit. PDF, JPEG, PNG only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firm-onboarding-docs',
  'firm-onboarding-docs',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
