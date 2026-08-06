-- Band D doctrine refactor (2026-05-15)
-- Engine sorts attention; lawyer decides outcome.
-- OOS leads now carry band='D' and status='triaging' so the lawyer
-- can Refer / Take / Pass instead of being silently auto-declined.
-- The 'referred' status is added for the new Refer action.
-- 'declined' status is retained for future engine-spam / abuse handling
-- but no longer used for routine out-of-scope intake.

-- 1. Extend band CHECK constraint to accept 'D'.
ALTER TABLE screened_leads DROP CONSTRAINT IF EXISTS screened_leads_band_check;
ALTER TABLE screened_leads ADD CONSTRAINT screened_leads_band_check
  CHECK (band IS NULL OR band IN ('A', 'B', 'C', 'D'));

-- 2. Extend status CHECK constraint to accept 'referred'.
ALTER TABLE screened_leads DROP CONSTRAINT IF EXISTS screened_leads_status_check;
ALTER TABLE screened_leads ADD CONSTRAINT screened_leads_status_check
  CHECK (status IN ('triaging', 'taken', 'passed', 'declined', 'referred'));

-- 3. Data migration: pre-existing OOS-declined rows fit the new model
--    as Band D triaging so they appear in the lawyer's active queue for review.
UPDATE screened_leads
SET status = 'triaging', band = 'D'
WHERE matter_type = 'out_of_scope' AND status = 'declined';

-- 4. Reload PostgREST schema cache so the new CHECK is honoured immediately.
NOTIFY pgrst, 'reload schema';
