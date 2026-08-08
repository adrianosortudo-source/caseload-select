-- 20260807120000_caseload_prospects.sql
--
-- BUILD_PLAN_start_conversation_flow_v1.md section 3.2: the "Start a
-- conversation" flow persists a CaseLoad-Select-owned prospect (not a
-- client-firm lead) plus a durable consent record before the visitor's
-- browser ever sees an outcome screen.
--
-- Two tables, following the split marketing_lead_consent_log already
-- established: the submission itself carries typed columns for every
-- answer (not a JSON blob -- each answer is independently queryable and
-- independently NOT-NULL-checkable), and the consent evidence lives in its
-- own append-only table so the durable "what was consented to, when, from
-- what user agent" record can never be edited by anything that touches the
-- prospect row itself.
--
-- Per the migration-lineage process rule (DR-109), this file is NOT applied
-- here. Apply only via commit, push, PR, merge, then a deliberate
-- operator-run `supabase db push`. No MCP apply_migration, no
-- direct-from-local-checkout db push.
--
-- Born exposed per the Database Access Invariant: RLS is enabled and forced
-- and every grant to anon, authenticated, and PUBLIC is revoked in this same
-- file. The app reads and writes through the service role only, from
-- POST /api/start-conversation.

CREATE TABLE IF NOT EXISTS public.caseload_prospects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Q1: What kind of law does your firm practice?
  practice_area         text NOT NULL,
  practice_area_other   text,

  -- Q2: How many lawyers work at the firm?
  firm_size             text NOT NULL,

  -- Q3: What prompted you to reach out now?
  prompt_reason         text NOT NULL,
  prompt_reason_other   text,

  -- Q4: Who decides on marketing spend at the firm?
  decision_role         text NOT NULL,

  -- Q5: When would you want the work to start?
  timeline              text NOT NULL,

  -- Section 2.6 outcome rule result. Internal only -- never shown to the
  -- visitor as a rejection or a score, just which closing screen rendered.
  outcome               text NOT NULL CHECK (outcome IN ('booking', 'reply')),

  -- Contact screen (section 2.3).
  name                  text NOT NULL,
  firm_name             text NOT NULL,
  email                 text NOT NULL,
  province              text NOT NULL,

  submitted_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caseload_prospects_email
  ON public.caseload_prospects USING btree (email);

CREATE INDEX IF NOT EXISTS idx_caseload_prospects_submitted_at
  ON public.caseload_prospects USING btree (submitted_at);

ALTER TABLE public.caseload_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caseload_prospects FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.caseload_prospects FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE public.caseload_prospects IS
  'CaseLoad Select''s own prospect capture from the public "Start a conversation" flow (BUILD_PLAN_start_conversation_flow_v1.md). Distinct from screened_leads and marketing_lead_consent_log''s subject, which are always a CLIENT FIRM''s inquiries -- this table is CaseLoad Select''s own inbound demand. Every answer is a typed column, not a JSON blob. Service-role access only.';

-- Consent evidence, modelled on marketing_lead_consent_log
-- (20260727221123_marketing_lead_consent_log.sql): a durable, write-ahead
-- record of what was consented to, when, and from what user agent. Unlike
-- marketing_lead_consent_log there is no later best-effort mutation to
-- accommodate (no GHL sync in v1, see plan section 3.6/8), so this table is
-- fully immutable rather than "immutable except one field" -- the shared
-- block_append_only_mutation() guard (first defined in
-- 20260715191156_20260715130000_approval_records_append_only.sql) is exactly
-- that: unconditional, no administrative exception.
CREATE TABLE IF NOT EXISTS public.caseload_prospect_consent_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id           uuid NOT NULL REFERENCES public.caseload_prospects(id) ON DELETE CASCADE,
  consent_text_version  text NOT NULL,
  consent_label         text NOT NULL,
  ip_address            text,
  user_agent            text,
  captured_at           timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caseload_prospect_consent_log_prospect
  ON public.caseload_prospect_consent_log USING btree (prospect_id);

ALTER TABLE public.caseload_prospect_consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caseload_prospect_consent_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.caseload_prospect_consent_log FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE public.caseload_prospect_consent_log IS
  'Append-only (structurally guarded) consent evidence for caseload_prospects submissions: what was consented to (consent_label, consent_text_version), when (captured_at), and from what ip/user agent. Write-ahead: the route inserts this row, or its counterpart caseload_prospects row, only after body.consent.granted === true; an unchecked box persists nothing at all. Service-role access only.';

DROP TRIGGER IF EXISTS trg_block_caseload_prospect_consent_log_mutation
  ON public.caseload_prospect_consent_log;
CREATE TRIGGER trg_block_caseload_prospect_consent_log_mutation
  BEFORE UPDATE OR DELETE ON public.caseload_prospect_consent_log
  FOR EACH ROW EXECUTE FUNCTION public.block_append_only_mutation();

-- Atomic two-table write, same shape as record_approval_atomic
-- (20260623000001_approval_rpc_atomic.sql): "a single SECURITY DEFINER
-- function that does [both inserts] inside ONE transaction. Either both
-- land or neither does." caseload_prospect_consent_log has a hard FK to
-- caseload_prospects, so a partial failure here would either strand a
-- prospect row with no durable consent evidence (a genuine compliance gap)
-- or, if the route inserted evidence first, be structurally impossible
-- (the FK would reject it). This function removes the question entirely.
CREATE OR REPLACE FUNCTION public.insert_caseload_prospect_with_consent(
  p_practice_area        text,
  p_practice_area_other  text,
  p_firm_size            text,
  p_prompt_reason        text,
  p_prompt_reason_other  text,
  p_decision_role        text,
  p_timeline             text,
  p_outcome              text,
  p_name                 text,
  p_firm_name            text,
  p_email                text,
  p_province             text,
  p_consent_text_version text,
  p_consent_label        text,
  p_ip_address           text,
  p_user_agent           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prospect_id uuid;
  v_created_at  timestamptz;
BEGIN
  IF p_outcome NOT IN ('booking', 'reply') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid outcome');
  END IF;

  INSERT INTO caseload_prospects (
    practice_area, practice_area_other, firm_size,
    prompt_reason, prompt_reason_other, decision_role, timeline, outcome,
    name, firm_name, email, province
  ) VALUES (
    p_practice_area, p_practice_area_other, p_firm_size,
    p_prompt_reason, p_prompt_reason_other, p_decision_role, p_timeline, p_outcome,
    p_name, p_firm_name, p_email, p_province
  )
  RETURNING id, created_at INTO v_prospect_id, v_created_at;

  INSERT INTO caseload_prospect_consent_log (
    prospect_id, consent_text_version, consent_label,
    ip_address, user_agent, captured_at
  ) VALUES (
    v_prospect_id, p_consent_text_version, p_consent_label,
    p_ip_address, p_user_agent, now()
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'prospect_id', v_prospect_id,
    'created_at',  v_created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.insert_caseload_prospect_with_consent FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_caseload_prospect_with_consent TO service_role;
