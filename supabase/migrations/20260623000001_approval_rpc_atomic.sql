-- Codex re-audit F-04 regression fix, applied to prod 2026-06-23 via Supabase
-- MCP.
--
-- The application-layer reorder in ed2cd02 created a crash window where
-- content_deliverables.status='approved' could land WITHOUT the matching
-- append-only approval_records row (the LSO 4.2-1 compliance artifact).
-- Replace it with a single SECURITY DEFINER function that does the version
-- drift check + the immutable insert + the status update inside ONE
-- transaction. Either both land or neither does. SELECT FOR UPDATE serializes
-- concurrent sign-offs on the same deliverable.

CREATE OR REPLACE FUNCTION public.record_approval_atomic(
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
  p_note              text
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
    version_number, deliverable_title, ip_address, user_agent, note
  ) VALUES (
    p_deliverable_id, p_version_id, p_firm_id, p_decision, p_signer_role,
    p_signer_id, p_signer_name, p_signer_email, p_attestation,
    p_version_number, p_deliverable_title, p_ip_address, p_user_agent, p_note
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
