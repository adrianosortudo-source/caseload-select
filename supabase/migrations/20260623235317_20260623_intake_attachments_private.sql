-- SECURITY FIX (F9), applied to prod 2026-06-23 via Supabase MCP.
--
-- intake-attachments held intake PII (ID scans, incident photos) in a PUBLIC
-- bucket: URL possession meant access with no expiry, inconsistent with the
-- private-bucket + short-signed-URL posture everywhere else. Flip it private.
-- Access now flows only through short-lived signed URLs minted by a firm-gated
-- route (/api/portal/[firmId]/intake-file), and the screen/upload route returns
-- that authorized route URL instead of a getPublicUrl() link.
--
-- Safe: the bucket holds zero objects and nothing in screened_leads or
-- intake_sessions references it (verified before applying), so there is no data
-- to migrate and no live link to break.

UPDATE storage.buckets SET public = false WHERE id = 'intake-attachments';
