-- Decision reason-code taxonomy on Pass/Refer (qualification audit item 6,
-- 2026-07-02). Free-text status_note captures the "why" in prose only;
-- this adds a structured chip so the reason survives as data the future
-- band-vs-action feedback loop and calibration work can query and count.
--
-- Take carries no reason code: a positive action needs no "why not"
-- taxonomy, and the lead already becomes a client_matters row.
--
-- Internal only, by design: never surfaced on any client-facing copy
-- (decline templates, GHL webhook payloads, welcome drafts). Kept purely
-- on screened_leads for the operator/lawyer-facing admin and metrics
-- surfaces.
ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS decision_reason_code TEXT;

ALTER TABLE screened_leads
  DROP CONSTRAINT IF EXISTS screened_leads_decision_reason_code_check;

ALTER TABLE screened_leads
  ADD CONSTRAINT screened_leads_decision_reason_code_check
  CHECK (
    decision_reason_code IS NULL OR decision_reason_code IN (
      'too_small', 'out_of_area', 'conflict', 'capacity',
      'bad_fit_client', 'fee_mismatch', 'other'
    )
  );
