-- Restore the operator login prerequisite independently of prospect enrichment.
-- The production app from PR #313 calls this RPC on every operator session.
-- Definition and privileges match 20260923161812_prospect_enrichment_v1.sql.
-- Reapplying after that larger migration is safe; no membership data changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.revalidate_operator_membership_v1(
  p_lawyer_id uuid,
  p_firm_id uuid,
  p_record_sign_in boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  matched_id uuid;
BEGIN
  IF p_record_sign_in THEN
    UPDATE public.firm_lawyers
      SET last_signed_in_at = now()
      WHERE id = p_lawyer_id
        AND firm_id = p_firm_id
        AND role = 'operator'
        AND disabled = false
      RETURNING id INTO matched_id;
  ELSE
    SELECT id INTO matched_id
      FROM public.firm_lawyers
      WHERE id = p_lawyer_id
        AND firm_id = p_firm_id
        AND role = 'operator'
        AND disabled = false;
  END IF;
  RETURN matched_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revalidate_operator_membership_v1(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revalidate_operator_membership_v1(uuid,uuid,boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
