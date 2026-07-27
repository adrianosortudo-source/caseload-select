-- Change-request loop: reply threads, version-as-answer, feedback attachments.
--
-- Three gaps in the content approval system, found on a real DRG change
-- request (Damaris, 2026-07-09): no way to reply to a changes_requested
-- record on the record, no structural link between a change request and the
-- version that answers it, no attachments on the change request (the lawyer
-- resorted to WhatsApp for a screenshot).
--
-- Additive only. approval_records stays append-only: attachments are set at
-- INSERT time by the replaced RPC below, never by an UPDATE.

ALTER TABLE deliverable_comments
  ADD COLUMN IF NOT EXISTS approval_record_id uuid
    REFERENCES approval_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deliverable_comments_approval
  ON deliverable_comments(approval_record_id, created_at)
  WHERE approval_record_id IS NOT NULL;

ALTER TABLE deliverable_comments
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE deliverable_versions
  ADD COLUMN IF NOT EXISTS responds_to_approval_id uuid
    REFERENCES approval_records(id) ON DELETE SET NULL;

ALTER TABLE approval_records
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ─── record_approval_atomic: add p_attachments, default preserves old callers ─
--
-- CREATE OR REPLACE cannot widen a function's argument list: adding a
-- trailing parameter (even with a default) makes Postgres treat it as a
-- distinct overload rather than a replacement, leaving both signatures
-- present and record_approval_atomic ambiguous to every caller. Drop the
-- exact old 14-arg signature first so only the new 15-arg one remains.

DROP FUNCTION IF EXISTS public.record_approval_atomic(
  uuid, uuid, uuid, text, text, uuid, text, text, text, int, text, text, text, text
);

CREATE FUNCTION public.record_approval_atomic(
  p_deliverable_id    uuid,
  p_version_id        uuid,
  p_firm_id           uuid,
  p_decision          text,
  p_signer_role       text,
  p_signer_id         uuid,
  p_signer_name       text,
  p_signer_email      text,
  p_attestation       text,
  p_version_number    int,
  p_deliverable_title text,
  p_ip_address        text,
  p_user_agent        text,
  p_note              text,
  p_attachments        jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_version uuid;
  v_record_id       uuid;
  v_created_at      timestamptz;
BEGIN
  IF p_decision NOT IN ('approved', 'changes_requested') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid decision');
  END IF;

  SELECT current_version_id INTO v_current_version
  FROM content_deliverables
  WHERE id = p_deliverable_id AND firm_id = p_firm_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deliverable not found');
  END IF;

  IF v_current_version IS DISTINCT FROM p_version_id THEN
    RETURN jsonb_build_object('ok', false, 'stale', true, 'error', 'a newer version exists');
  END IF;

  INSERT INTO approval_records (
    deliverable_id, version_id, firm_id, decision, signer_role,
    signer_id, signer_name, signer_email, attestation,
    version_number, deliverable_title, ip_address, user_agent, note,
    attachments
  ) VALUES (
    p_deliverable_id, p_version_id, p_firm_id, p_decision, p_signer_role,
    p_signer_id, p_signer_name, p_signer_email, p_attestation,
    p_version_number, p_deliverable_title, p_ip_address, p_user_agent, p_note,
    COALESCE(p_attachments, '[]'::jsonb)
  )
  RETURNING id, created_at INTO v_record_id, v_created_at;

  IF p_decision = 'approved' THEN
    UPDATE content_deliverables
       SET status              = 'approved',
           approved_version_id = p_version_id,
           approved_at         = now(),
           updated_at          = now()
     WHERE id = p_deliverable_id;
  ELSE
    UPDATE content_deliverables
       SET status              = 'changes_requested',
           approved_version_id = NULL,
           approved_at         = NULL,
           updated_at          = now()
     WHERE id = p_deliverable_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'record_id',   v_record_id,
    'created_at',  v_created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_approval_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_approval_atomic TO service_role;

NOTIFY pgrst, 'reload schema';
