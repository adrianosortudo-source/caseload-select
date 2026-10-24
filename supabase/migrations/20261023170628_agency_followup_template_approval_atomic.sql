-- Keep template approval and its append-only audit event in one transaction.
CREATE OR REPLACE FUNCTION public.approve_agency_followup_template_version(
  p_template_version_id uuid,
  p_actor_operator_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_template public.agency_followup_template_versions%ROWTYPE;
  v_reviewed_at timestamptz := now();
BEGIN
  IF p_actor_operator_id IS NULL THEN
    RAISE EXCEPTION 'operator identity is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.firm_lawyers
    WHERE id = p_actor_operator_id
      AND role = 'operator'
      AND disabled = false
  ) THEN
    RAISE EXCEPTION 'only an active operator may approve an agency follow-up template version';
  END IF;

  UPDATE public.agency_followup_template_versions
  SET state = 'approved',
      approved_by_operator_id = p_actor_operator_id,
      approved_at = v_reviewed_at
  WHERE id = p_template_version_id
    AND state = 'draft'
  RETURNING * INTO v_template;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'only a draft agency follow-up template version can be approved';
  END IF;

  INSERT INTO public.agency_followup_events (
    template_version_id,
    event_type,
    idempotency_key,
    event_payload,
    actor_operator_id
  )
  VALUES (
    v_template.id,
    'template_approved',
    'template-approved:' || v_template.id::text || ':' || p_actor_operator_id::text,
    jsonb_build_object(
      'templateKey', v_template.template_key,
      'version', v_template.version,
      'contentSha256', v_template.content_sha256,
      'reviewerId', p_actor_operator_id,
      'reviewedAt', v_reviewed_at
    ),
    p_actor_operator_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_agency_followup_template_version(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_agency_followup_template_version(uuid, uuid)
  TO service_role;
