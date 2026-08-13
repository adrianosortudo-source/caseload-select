-- 20260808120000_caseload_prospect_erasure.sql
--
-- DR-114. Amends 20260807120000_caseload_prospects.sql, which shipped two
-- safety mechanisms that contradict each other:
--
--   caseload_prospect_consent_log.prospect_id  FK ... ON DELETE CASCADE
--   trg_block_caseload_prospect_consent_log_mutation  BEFORE DELETE OR UPDATE
--
-- Deleting a caseload_prospects row makes the cascade attempt a DELETE on the
-- child, which the append-only guard rejects with
--   P0001: this table is append-only: rows may only be inserted, never
--          updated or deleted (table: caseload_prospect_consent_log)
-- so the CASCADE clause advertises a behaviour that can never occur, and the
-- table has no erasure path at all. caseload_prospects holds name, firm name,
-- email and province, so that gap means a PIPEDA deletion request from one of
-- CaseLoad Select's own prospects cannot presently be honoured.
--
-- This file resolves the contradiction in the direction that keeps the consent
-- record whole:
--
--   1. Prospect rows are ANONYMISED, never deleted. Same house pattern
--      src/lib/data-retention.ts already applies to leads and screened_leads:
--      replace the identifying columns, keep the non-identifying answers so
--      funnel counts stay correct.
--   2. The FK becomes ON DELETE RESTRICT, and caseload_prospects itself gains
--      a BEFORE DELETE guard whose message names the supported path. The
--      schema now states what actually happens.
--   3. caseload_prospect_consent_log stays UNCONDITIONALLY append-only. Its
--      ip_address and user_agent are retained, not scrubbed: CASL section 13
--      puts the burden of proving consent on the sender, so the record that a
--      past contact was lawful must survive an erasure request rather than be
--      destroyed by it. Once the parent row is anonymised the consent row
--      carries no name, email, firm name or province, so those two fields
--      point at a subject who can no longer be identified from this data.
--      The narrow-exception precedent in
--      guard_marketing_lead_consent_log_mutation() was considered and not
--      followed: that exception permits a one-time forward backfill of a null
--      column, which ADDS evidence. A deletion exception removes it.
--
-- Per the migration-lineage process rule (DR-109), this file is NOT applied
-- here. Apply only via commit, push, PR, merge, then a deliberate
-- operator-run `supabase db push`. No MCP apply_migration, no
-- direct-from-local-checkout db push.

-- 1. The FK stops advertising a cascade that the child's guard blocks.
ALTER TABLE public.caseload_prospect_consent_log
  DROP CONSTRAINT IF EXISTS caseload_prospect_consent_log_prospect_id_fkey;

ALTER TABLE public.caseload_prospect_consent_log
  ADD CONSTRAINT caseload_prospect_consent_log_prospect_id_fkey
  FOREIGN KEY (prospect_id)
  REFERENCES public.caseload_prospects(id)
  ON DELETE RESTRICT;

-- 2. Erasure state on the parent row.
ALTER TABLE public.caseload_prospects
  ADD COLUMN IF NOT EXISTS anonymized_at        timestamptz,
  ADD COLUMN IF NOT EXISTS anonymization_reason text;

ALTER TABLE public.caseload_prospects
  DROP CONSTRAINT IF EXISTS caseload_prospects_anonymization_reason_check;

ALTER TABLE public.caseload_prospects
  ADD CONSTRAINT caseload_prospects_anonymization_reason_check
  CHECK (
    (anonymized_at IS NULL AND anonymization_reason IS NULL)
    OR (
      anonymized_at IS NOT NULL
      AND anonymization_reason IN ('subject_request', 'retention_sweep', 'internal_test_record')
    )
  );

COMMENT ON COLUMN public.caseload_prospects.anonymized_at IS
  'When this row''s identifying columns were replaced with the [anonymized] sentinel. NULL means the row still carries the prospect''s real contact details. Set only by anonymize_caseload_prospects(); rows are never deleted (DR-114).';

COMMENT ON COLUMN public.caseload_prospects.anonymization_reason IS
  'Why the row was anonymised: subject_request (a PIPEDA erasure request), retention_sweep (the daily runDataRetention pass at 730 days from submitted_at), or internal_test_record (an operator-created verification row). NULL exactly when anonymized_at is NULL.';

-- 3. Deletion is structurally unavailable, and the error says what to do
--    instead. The FK above already blocks deletion of any prospect that has
--    consent evidence, which in practice is every one of them, since
--    insert_caseload_prospect_with_consent() writes both rows in a single
--    transaction. This trigger closes the hypothetical evidence-free row and,
--    more usefully, replaces a foreign-key violation message with one that
--    names the supported path.
CREATE OR REPLACE FUNCTION public.block_caseload_prospect_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'caseload_prospects rows are never deleted (DR-114): consent evidence in caseload_prospect_consent_log is append-only and must outlive the prospect record. To honour an erasure request, call anonymize_caseload_prospects(p_prospect_id => ''%'', p_reason => ''subject_request'') instead.',
    OLD.id;
END;
$$;

-- No REVOKE on this one, matching block_append_only_mutation(): a function
-- whose entire body is a RAISE grants nothing to anyone, and PostgreSQL checks
-- EXECUTE on a trigger function at CREATE TRIGGER time rather than at fire
-- time, so revoking it afterwards buys nothing and risks the guard.
DROP TRIGGER IF EXISTS trg_block_caseload_prospect_delete ON public.caseload_prospects;
CREATE TRIGGER trg_block_caseload_prospect_delete
  BEFORE DELETE ON public.caseload_prospects
  FOR EACH ROW EXECUTE FUNCTION public.block_caseload_prospect_delete();

-- 4. The single definition of what anonymisation means for this table.
--
-- Three call shapes, exactly one selector per call:
--   p_prospect_id  one row, by id           (operator handling a named request)
--   p_email        every row for a subject  (an erasure request arrives by email)
--   p_before       every row older than a cutoff (the retention sweep)
--
-- Idempotent: rows already carrying anonymized_at are excluded, so a repeat
-- call returns anonymized_count 0 rather than restamping the timestamp.
--
-- Retained on purpose: practice_area, firm_size, prompt_reason, decision_role,
-- timeline and outcome are closed-option answers with no free text, so they
-- survive anonymisation and the funnel analytics stay correct, exactly as
-- band and the four-axis scores survive on screened_leads. Dropped on purpose:
-- practice_area_other and prompt_reason_other are free text the visitor typed
-- and can name themselves, a colleague or the firm.
CREATE OR REPLACE FUNCTION public.anonymize_caseload_prospects(
  p_prospect_id uuid        DEFAULT NULL,
  p_email       text        DEFAULT NULL,
  p_before      timestamptz DEFAULT NULL,
  p_reason      text        DEFAULT 'subject_request'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selectors int;
  v_ids       uuid[];
BEGIN
  v_selectors :=
      (CASE WHEN p_prospect_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN p_email       IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN p_before      IS NOT NULL THEN 1 ELSE 0 END);

  IF v_selectors <> 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'exactly one of p_prospect_id, p_email, p_before must be supplied'
    );
  END IF;

  IF p_reason IS NULL
     OR p_reason NOT IN ('subject_request', 'retention_sweep', 'internal_test_record') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid reason');
  END IF;

  WITH updated AS (
    UPDATE caseload_prospects
       SET name                 = '[anonymized]',
           firm_name            = '[anonymized]',
           email                = '[anonymized]',
           province             = '[anonymized]',
           practice_area_other  = NULL,
           prompt_reason_other  = NULL,
           anonymized_at        = now(),
           anonymization_reason = p_reason
     WHERE anonymized_at IS NULL
       AND (p_prospect_id IS NULL OR id = p_prospect_id)
       AND (p_email       IS NULL OR lower(email) = lower(p_email))
       AND (p_before      IS NULL OR submitted_at < p_before)
    RETURNING id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM updated;

  RETURN jsonb_build_object(
    'ok',               true,
    'anonymized_count', coalesce(array_length(v_ids, 1), 0),
    'prospect_ids',     to_jsonb(v_ids),
    'reason',           p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_caseload_prospects(uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_caseload_prospects(uuid, text, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION public.anonymize_caseload_prospects(uuid, text, timestamptz, text) IS
  'PIPEDA erasure for caseload_prospects (DR-114). Replaces the identifying columns with the [anonymized] sentinel and nulls the free-text answers, keeping the closed-option answers and outcome for aggregate reporting. Rows are never deleted: the linked caseload_prospect_consent_log evidence is unconditionally append-only and is retained intact, ip_address and user_agent included, as the record that consent was given. Exactly one selector per call (p_prospect_id, p_email or p_before). Idempotent. service_role only.';
