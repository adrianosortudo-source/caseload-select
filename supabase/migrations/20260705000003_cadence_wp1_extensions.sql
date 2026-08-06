-- CRM Migration Plan, Phase 2 rail 1, WP-1: cadence engine to functional-complete (still shadow).
--
-- Extends the 2026-07-03 shadow cadence engine (cadence_rules/cadence_steps/
-- cadence_runs/outbound_messages) with:
--   1. cadence_rules.exit_config: per-rule early-exit condition (J6 exits once
--      the matter's stage advances past retainer_pending, the documented
--      followup from the first brick).
--   2. A lead-only enrollment key so a cadence (J10 re-engagement) can enroll
--      off a screened_leads status flip rather than a matter_stage_events row
--      (a passed lead never becomes a client_matters row).
--   3. intake_firms.cadence_real_send: a per-firm real-send flag. Ships as
--      part of the dormant real-send dispatch path (cadence-dispatch.ts).
--      Defaults false and is NEVER flipped in this sprint; real sends also
--      require an env var (CADENCE_REAL_SEND_ENABLED) that is never added to
--      Vercel. Shadow stays the only thing that actually runs.
--   4. ghl_send_imports: the diff scaffold. An operator-uploaded CSV of GHL's
--      real sends, compared against the shadow ledger on the /admin/cadence-shadow
--      diff tab. Empty until an import happens.
--   5. Seeds J8 (Active Matter Update), J10 (Re-Engagement), J12 (Long-Term
--      Nurture) as global-default rules, completing the 7-cadence set this
--      sprint targets (J6/J7/J9/J11 already seeded).
--
-- Still shadow-only. No dispatch. No GHL change. No cutover.

BEGIN;

-- ============================================================
-- 1. exit_config on cadence_rules
-- ============================================================

ALTER TABLE public.cadence_rules
  ADD COLUMN IF NOT EXISTS exit_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. Lead-only enrollment idempotency key (for lead-status-sourced cadences)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_cadence_runs_key_lead
  ON public.cadence_runs (cadence_key, screened_lead_id)
  WHERE screened_lead_id IS NOT NULL AND matter_id IS NULL;

-- ============================================================
-- 3. Dormant real-send gate (per-firm flag, never flipped this sprint)
-- ============================================================

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS cadence_real_send boolean NOT NULL DEFAULT false;

-- ============================================================
-- 4. ghl_send_imports: diff scaffold for the shadow-vs-GHL comparison
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ghl_send_imports (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id       uuid        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  cadence_key   text,
  matter_id     uuid        REFERENCES public.client_matters(id) ON DELETE SET NULL,
  screened_lead_id uuid     REFERENCES public.screened_leads(id) ON DELETE SET NULL,
  step_number   int,
  sent_at       timestamptz,
  recipient_email text,
  subject       text,
  source_row    jsonb       NOT NULL DEFAULT '{}'::jsonb, -- raw imported CSV row, for audit
  imported_at   timestamptz NOT NULL DEFAULT now(),
  imported_by   text        -- operator session identifier
);

CREATE INDEX IF NOT EXISTS idx_ghl_send_imports_firm
  ON public.ghl_send_imports (firm_id, cadence_key, sent_at DESC);

ALTER TABLE public.ghl_send_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_send_imports FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.ghl_send_imports FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.ghl_send_imports TO service_role;

-- ============================================================
-- 5. Seed J8, J10, J12
-- ============================================================

-- J6 gains its exit condition: stop touching once the matter's stage is no
-- longer retainer_pending (the retainer got signed, or the matter moved on).
UPDATE public.cadence_rules
SET exit_config = '{"matter_stage_not_in": ["retainer_pending"]}'::jsonb
WHERE cadence_key = 'J6' AND firm_id IS NULL;

INSERT INTO public.cadence_rules (firm_id, cadence_key, name, trigger_type, trigger_config)
VALUES
  -- J8 fans out alongside J7 on the same retainer_pending -> active transition.
  (NULL, 'J8',  'Active Matter Update', 'field_change', '{"cadence_trigger": "client_won"}'::jsonb),
  -- J10 enrolls off a screened_leads status flip to "passed" (no matter exists).
  (NULL, 'J10', 'Re-Engagement',        'field_change', '{"cadence_trigger": "re_engagement", "source": "screened_leads_status", "status": "passed"}'::jsonb),
  -- J12 fans out alongside J11 on the same closing -> closed transition.
  (NULL, 'J12', 'Long-Term Nurture',    'field_change', '{"cadence_trigger": "relationship_milestone"}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.cadence_steps (cadence_rule_id, step_number, delay_hours, subject_template, body_template)
SELECT r.id, s.step_number, s.delay_hours, s.subject_template, s.body_template
FROM public.cadence_rules r
JOIN (
  VALUES
    -- J8 Active Matter Update: 3 touches (14d, 28d, 56d)
    ('J8', 1, 336,  'An update on your {matter_type}',        'Hi {first_name}, a short note on where your {matter_type} stands with {firm_name}. Reply if a question has come up.'),
    ('J8', 2, 672,  'Checking in on your matter',              'Hi {first_name}, following up on your {matter_type}. If there is anything you need from the firm at this stage, reply here.'),
    ('J8', 3, 1344, 'A four-week note on your matter',         'Hi {first_name}, a further note on your {matter_type} with {firm_name}. The firm will keep you posted as it moves forward.'),
    -- J10 Re-Engagement: 2 touches (90d, 180d)
    ('J10', 1, 2160, 'Checking back in',                       'Hi {first_name}, it has been a while since your last conversation with {firm_name} about your {matter_type}. If circumstances have changed, the firm is glad to take another look.'),
    ('J10', 2, 4320, 'Still here if useful',                   'Hi {first_name}, a final note from {firm_name}. If your {matter_type} situation resurfaces or changes, reply and the firm will pick it up.'),
    -- J12 Long-Term Nurture: 2 touches (18mo, 24mo)
    ('J12', 1, 13140, 'Eighteen months on',                    'Hi {first_name}, eighteen months since the firm worked on your {matter_type}. A quiet note in case anything related has come up.'),
    ('J12', 2, 17520, 'Two years on',                          'Hi {first_name}, two years since your {matter_type} with {firm_name}. If a follow-on question ever surfaces, the firm is here.')
) AS s(cadence_key, step_number, delay_hours, subject_template, body_template)
  ON s.cadence_key = r.cadence_key
WHERE r.firm_id IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
