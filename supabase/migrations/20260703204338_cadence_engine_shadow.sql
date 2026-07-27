-- CRM Migration Plan, Phase 2 rail 1: cadence engine (email), SHADOW MODE.
--
-- Builds the generic Trigger-Condition-Action cadence engine specified in
-- CaseLoad_CRM_Migration_Plan_v1.md section 6.1 note 2 and section 7 Phase 2.
-- This is the in-house replacement for GHL's email drip workflows (J6 to J12),
-- built as a rule TABLE, not hardcoded per-journey functions.
--
-- SHADOW MODE is the hard default and the whole point of this first brick:
--   * The engine enrolls matters, schedules touches, evaluates the CASL send
--     gate (comms-gate.ts, DR-075 / audit H5), and writes what it WOULD send
--     into outbound_messages with shadow = true.
--   * It NEVER calls Resend. It sends nothing. It changes nothing in GHL.
--   * GHL keeps running the real cadences for DRG. Later, an operator diffs
--     the shadow ledger against GHL's actual sends before any cutover is
--     discussed. Per the plan, no rail is cut until the new rail is verified
--     in production.
--
-- Prerequisite gate H5 (blocking): consent_log + the CASL send gate must exist
-- before any rail is swapped. Both exist (consent_log applied 2026-06-26;
-- comms-gate.ts live). The shadow engine records the consent verdict on every
-- would-be send so the eventual real-send flip inherits an enforced gate.
--
-- Four tables, all service-role-only (Database Access Invariant):
--   cadence_rules    the rule definitions (trigger + metadata), J6/J7/J9/J11 seeded
--   cadence_steps    the ordered touches within a rule (offset + email template)
--   cadence_runs     one enrollment instance (a matter enrolled in a rule)
--   outbound_messages  the send ledger; shadow rows are would-have-sent, never dispatched
--
-- Idempotency mirrors the webhook_outbox / processed_channel_messages scaffolding:
--   one run per (cadence_key, matter_id); one outbound row per (cadence_run_id, step_number).
--
-- APPLIED to prod 2026-07-03 (verified: 4 tables, RLS enabled+forced, anon/
-- authenticated/PUBLIC grants revoked, service_role only, J6/J7/J9/J11 seeded).
-- pg_cron scheduling for the runner is NOT yet wired; a manual tick is the
-- only way this engine runs today.

BEGIN;

-- ============================================================
-- 1. cadence_rules: the Trigger-Condition-Action rule definitions
-- ============================================================
-- A rule with firm_id = NULL is a GLOBAL seed default. A rule with firm_id set
-- is a per-firm override (resolved firm-first, then global). This is the
-- "editable per firm" shape from the plan without forking the schema per firm.

CREATE TABLE IF NOT EXISTS public.cadence_rules (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id       uuid        REFERENCES public.intake_firms(id) ON DELETE CASCADE, -- NULL = global default
  cadence_key   text        NOT NULL,  -- 'J6' | 'J7' | 'J9' | 'J11' | ...
  name          text        NOT NULL,
  trigger_type  text        NOT NULL,  -- 'field_change' | 'threshold' | 'time_relative'
  -- trigger_config shape depends on trigger_type:
  --   field_change:  { "cadence_trigger": "retainer_awaiting" }  (matches journeyTriggerForTransition)
  --   threshold:     { "field": "value_score", "op": ">=", "value": 7 }
  --   time_relative: { "anchor": "retained_date", "offset_days": 180 }
  trigger_config jsonb      NOT NULL DEFAULT '{}'::jsonb,
  channel       text        NOT NULL DEFAULT 'email',
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cadence_rules_trigger_type_check') THEN
    ALTER TABLE public.cadence_rules ADD CONSTRAINT cadence_rules_trigger_type_check
      CHECK (trigger_type IN ('field_change', 'threshold', 'time_relative'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cadence_rules_channel_check') THEN
    ALTER TABLE public.cadence_rules ADD CONSTRAINT cadence_rules_channel_check
      CHECK (channel IN ('email', 'sms'));
  END IF;
END $$;

-- One rule per (firm, cadence_key). The partial unique indexes split NULL-firm
-- (global) from firm-scoped so a firm override coexists with the global default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cadence_rules_global_key
  ON public.cadence_rules (cadence_key) WHERE firm_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cadence_rules_firm_key
  ON public.cadence_rules (firm_id, cadence_key) WHERE firm_id IS NOT NULL;

-- ============================================================
-- 2. cadence_steps: the ordered touches within a rule
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cadence_steps (
  id               uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cadence_rule_id  uuid    NOT NULL REFERENCES public.cadence_rules(id) ON DELETE CASCADE,
  step_number      int     NOT NULL,
  delay_hours      int     NOT NULL,  -- offset from the run's anchor_at
  channel          text    NOT NULL DEFAULT 'email',
  subject_template text    NOT NULL DEFAULT '',
  body_template    text    NOT NULL DEFAULT '',
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cadence_steps_rule_step
  ON public.cadence_steps (cadence_rule_id, step_number);

-- ============================================================
-- 3. cadence_runs: one enrollment instance (matter enrolled in a rule)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cadence_runs (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id           uuid        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  cadence_rule_id   uuid        NOT NULL REFERENCES public.cadence_rules(id) ON DELETE CASCADE,
  cadence_key       text        NOT NULL,
  matter_id         uuid        REFERENCES public.client_matters(id) ON DELETE CASCADE,
  screened_lead_id  uuid        REFERENCES public.screened_leads(id) ON DELETE SET NULL,
  anchor_at         timestamptz NOT NULL,  -- time offsets compute from (the stage-change time)
  status            text        NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'exited'
  next_step_number  int         NOT NULL DEFAULT 1,
  exit_reason       text,
  enrolled_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cadence_runs_status_check') THEN
    ALTER TABLE public.cadence_runs ADD CONSTRAINT cadence_runs_status_check
      CHECK (status IN ('active', 'completed', 'exited'));
  END IF;
END $$;

-- One run per (cadence_key, matter_id): the enrollment idempotency key. A
-- second stage-change re-fire cannot double-enroll the same matter into J6.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cadence_runs_key_matter
  ON public.cadence_runs (cadence_key, matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cadence_runs_active
  ON public.cadence_runs (status, firm_id) WHERE status = 'active';

-- ============================================================
-- 4. outbound_messages: the send ledger (shadow rows never dispatch)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id             uuid        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  cadence_run_id      uuid        REFERENCES public.cadence_runs(id) ON DELETE SET NULL,
  cadence_key         text,
  step_number         int,
  matter_id           uuid        REFERENCES public.client_matters(id) ON DELETE SET NULL,
  screened_lead_id    uuid        REFERENCES public.screened_leads(id) ON DELETE SET NULL,
  channel             text        NOT NULL DEFAULT 'email',
  recipient_email     text,
  subject             text,
  body                text,
  -- shadow = true: the engine ran and logged what it WOULD send, but dispatched nothing.
  shadow              boolean     NOT NULL DEFAULT true,
  -- CASL send-gate verdict recorded at evaluation time (comms-gate.ts).
  consent_verdict     text        NOT NULL DEFAULT 'unknown',  -- 'allowed' | 'blocked' | 'unknown'
  consent_block_reason text,
  scheduled_for       timestamptz,
  status              text        NOT NULL DEFAULT 'scheduled', -- 'scheduled'|'shadow_logged'|'suppressed'|'sent'|'failed'
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_channel_check') THEN
    ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_channel_check
      CHECK (channel IN ('email', 'sms'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_consent_verdict_check') THEN
    ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_consent_verdict_check
      CHECK (consent_verdict IN ('allowed', 'blocked', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_status_check') THEN
    ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_status_check
      CHECK (status IN ('scheduled', 'shadow_logged', 'suppressed', 'sent', 'failed'));
  END IF;
END $$;

-- One ledger row per (cadence_run_id, step_number): a re-tick of the runner
-- cannot double-log the same touch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_messages_run_step
  ON public.outbound_messages (cadence_run_id, step_number) WHERE cadence_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbound_messages_firm
  ON public.outbound_messages (firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_shadow
  ON public.outbound_messages (firm_id, shadow, created_at DESC);

-- ============================================================
-- 5. RLS lockdown (Database Access Invariant: service-role only)
-- ============================================================

ALTER TABLE public.cadence_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_rules      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.cadence_steps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_steps      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.cadence_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_runs       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages  FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.cadence_rules      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.cadence_steps      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.cadence_runs       FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.outbound_messages  FROM anon, authenticated, PUBLIC;

GRANT ALL ON public.cadence_rules      TO service_role;
GRANT ALL ON public.cadence_steps      TO service_role;
GRANT ALL ON public.cadence_runs       TO service_role;
GRANT ALL ON public.outbound_messages  TO service_role;

-- ============================================================
-- 6. Seed the global default rule library (J6, J7, J9, J11)
-- ============================================================
-- These mirror src/lib/cadence-seed.ts (the same content in code, used by the
-- runner as the authored library and by tests). Copy is deliberately short and
-- LSO Rule 4.2-1 safe: no outcome promises, no time-relative reply promises, no
-- "specialist"/"expert" language. Final production copy is a Phase 3 concern;
-- this brick proves enrollment, scheduling, consent gating, and shadow logging.
-- Trigger keys match journeyTriggerForTransition (matter-stage-pure.ts) so the
-- shadow engine enrolls on exactly the signal GHL's matter_stage_changed gets.

INSERT INTO public.cadence_rules (firm_id, cadence_key, name, trigger_type, trigger_config)
VALUES
  (NULL, 'J6',  'Retainer Awaiting Signature',    'field_change', '{"cadence_trigger": "retainer_awaiting"}'::jsonb),
  (NULL, 'J7',  'Welcome and Onboarding',         'field_change', '{"cadence_trigger": "client_won"}'::jsonb),
  (NULL, 'J9',  'Google Review Request',          'field_change', '{"cadence_trigger": "review_request"}'::jsonb),
  (NULL, 'J11', 'Relationship Milestone',         'field_change', '{"cadence_trigger": "relationship_milestone"}'::jsonb)
ON CONFLICT DO NOTHING;

-- Steps, resolved by cadence_key against the global rows just inserted.
INSERT INTO public.cadence_steps (cadence_rule_id, step_number, delay_hours, subject_template, body_template)
SELECT r.id, s.step_number, s.delay_hours, s.subject_template, s.body_template
FROM public.cadence_rules r
JOIN (
  VALUES
    -- J6 Retainer Awaiting: 4 touches across 10 days
    ('J6', 1, 0,   'Your engagement letter with {firm_name}',        'Hi {first_name}, your engagement letter for the {matter_type} is ready for signature. Reply here if any question comes up before you sign.'),
    ('J6', 2, 48,  'A quick note on your engagement letter',          'Hi {first_name}, following up on the engagement letter for your {matter_type}. The firm holds the file ready to begin once it is signed.'),
    ('J6', 3, 120, 'Still here when you are ready',                    'Hi {first_name}, no rush on the {matter_type} engagement letter. If timing or terms need a change, tell the firm and it will adjust.'),
    ('J6', 4, 240, 'Closing the loop on your engagement letter',      'Hi {first_name}, the firm will keep the {matter_type} file open for you. When the engagement letter is signed, work begins.'),
    -- J7 Welcome and Onboarding: 4 touches across 7 days
    ('J7', 1, 0,   'Welcome to {firm_name}',                          'Hi {first_name}, welcome. Your {matter_type} is now open with the firm. This note is your starting point for what happens next.'),
    ('J7', 2, 24,  'What to expect on your matter',                   'Hi {first_name}, a short outline of the {matter_type} steps ahead and where your input will be needed. Questions are always welcome.'),
    ('J7', 3, 72,  'Documents and details for your file',             'Hi {first_name}, a checklist of documents that help move the {matter_type} forward. Send what you have; the firm will ask if anything else is needed.'),
    ('J7', 4, 168, 'Your first week with the firm',                   'Hi {first_name}, a check-in at the end of your first week on the {matter_type}. Reply if anything is unclear.'),
    -- J9 Google Review Request: 3 touches (0h, 72h, 168h)
    ('J9', 1, 0,   'Thank you from {firm_name}',                      'Hi {first_name}, thank you for trusting the firm with your {matter_type}. If the experience was a good one, a short review helps others find the firm.'),
    ('J9', 2, 72,  'A quick favour, if you have a moment',            'Hi {first_name}, following up on a review for your {matter_type}. A few honest sentences are plenty, and it makes a real difference.'),
    ('J9', 3, 168, 'Last note on leaving a review',                   'Hi {first_name}, a final note. If you would share a review of your {matter_type} experience, the firm would be grateful. Either way, thank you.'),
    -- J11 Relationship Milestone: 2 touches (6 months, 12 months)
    ('J11', 1, 4380, 'Six months on from your matter',                'Hi {first_name}, about six months since the firm worked on your {matter_type}. A quiet check-in: if anything related has come up, reply and the firm will pick it up.'),
    ('J11', 2, 8760, 'A year on from your matter',                    'Hi {first_name}, a year since your {matter_type} with the firm. If a follow-on question has surfaced, the firm is here. If all is settled, that is good to hear.')
) AS s(cadence_key, step_number, delay_hours, subject_template, body_template)
  ON s.cadence_key = r.cadence_key
WHERE r.firm_id IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
