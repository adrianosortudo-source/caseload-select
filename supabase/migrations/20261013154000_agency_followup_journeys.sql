-- Reusable, operator-reviewed follow-up journeys for the Agency CRM.
-- This migration is prepared for review only. Do not apply it from this worktree.

CREATE TABLE public.agency_followup_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_key text NOT NULL CHECK (char_length(btrim(journey_key)) BETWEEN 1 AND 120),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 240),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'active', 'retired')),
  timezone text NOT NULL CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 120),
  business_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  local_window_start time NOT NULL DEFAULT '09:00',
  local_window_end time NOT NULL DEFAULT '17:00',
  minimum_spacing_hours integer NOT NULL DEFAULT 168 CHECK (minimum_spacing_hours >= 0),
  created_by_operator_id uuid NOT NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_key, version),
  CHECK (cardinality(business_days) BETWEEN 1 AND 7),
  CHECK (business_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CHECK (local_window_end > local_window_start)
);
CREATE INDEX agency_followup_journeys_state_idx
  ON public.agency_followup_journeys (state, journey_key, version DESC);
CREATE UNIQUE INDEX agency_followup_journeys_one_active_idx
  ON public.agency_followup_journeys (journey_key)
  WHERE state = 'active';

CREATE TABLE public.agency_followup_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL CHECK (char_length(btrim(template_key)) BETWEEN 1 AND 120),
  version integer NOT NULL CHECK (version > 0),
  channel text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 1000),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved', 'retired')),
  approved_by_operator_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  approved_at timestamptz NULL,
  created_by_operator_id uuid NOT NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, version),
  CHECK ((state = 'approved' AND approved_by_operator_id IS NOT NULL AND approved_at IS NOT NULL) OR state <> 'approved')
);
CREATE INDEX agency_followup_template_versions_key_idx
  ON public.agency_followup_template_versions (template_key, version DESC);

CREATE TABLE public.agency_followup_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.agency_followup_journeys(id) ON DELETE RESTRICT,
  step_number smallint NOT NULL CHECK (step_number BETWEEN 1 AND 100),
  template_version_id uuid NOT NULL REFERENCES public.agency_followup_template_versions(id) ON DELETE RESTRICT,
  delay_business_days integer NOT NULL DEFAULT 0 CHECK (delay_business_days >= 0 AND delay_business_days <= 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, step_number)
);
CREATE INDEX agency_followup_steps_template_idx ON public.agency_followup_steps (template_version_id);

CREATE TABLE public.agency_followup_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.agency_followup_journeys(id) ON DELETE RESTRICT,
  prospect_id uuid NOT NULL REFERENCES public.agency_prospects(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'active', 'paused', 'stopped', 'completed', 'cancelled')),
  eligibility_state text NOT NULL DEFAULT 'pending' CHECK (eligibility_state IN ('pending', 'eligible', 'ineligible', 'unknown')),
  eligibility_evidence_ref text NULL CHECK (eligibility_evidence_ref IS NULL OR char_length(btrim(eligibility_evidence_ref)) BETWEEN 1 AND 2000),
  recipient_name_snapshot text NULL CHECK (recipient_name_snapshot IS NULL OR char_length(recipient_name_snapshot) <= 300),
  recipient_email_snapshot text NULL CHECK (recipient_email_snapshot IS NULL OR char_length(recipient_email_snapshot) <= 320),
  recipient_sha256 text NOT NULL CHECK (recipient_sha256 ~ '^[a-f0-9]{64}$'),
  released_by_operator_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  released_at timestamptz NULL,
  release_basis text NULL CHECK (release_basis IS NULL OR char_length(btrim(release_basis)) BETWEEN 1 AND 2000),
  started_at timestamptz NULL,
  stopped_at timestamptz NULL,
  stopped_reason text NULL CHECK (stopped_reason IS NULL OR char_length(btrim(stopped_reason)) BETWEEN 1 AND 2000),
  created_by_operator_id uuid NOT NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((released_by_operator_id IS NULL AND released_at IS NULL AND release_basis IS NULL) OR
    (released_by_operator_id IS NOT NULL AND released_at IS NOT NULL AND release_basis IS NOT NULL)),
  CHECK ((state IN ('stopped', 'cancelled') AND stopped_at IS NOT NULL AND stopped_reason IS NOT NULL) OR
    state NOT IN ('stopped', 'cancelled'))
);
CREATE UNIQUE INDEX agency_followup_enrollments_one_open_per_journey_idx
  ON public.agency_followup_enrollments (journey_id, prospect_id)
  WHERE state IN ('draft', 'active', 'paused');
CREATE INDEX agency_followup_enrollments_queue_idx
  ON public.agency_followup_enrollments (state, updated_at DESC);
CREATE INDEX agency_followup_enrollments_prospect_idx
  ON public.agency_followup_enrollments (prospect_id, created_at DESC);

CREATE TABLE public.agency_followup_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.agency_followup_enrollments(id) ON DELETE RESTRICT,
  step_id uuid NOT NULL REFERENCES public.agency_followup_steps(id) ON DELETE RESTRICT,
  step_number smallint NOT NULL CHECK (step_number BETWEEN 1 AND 100),
  template_version_id uuid NOT NULL REFERENCES public.agency_followup_template_versions(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'awaiting_review' CHECK (state IN (
    'awaiting_review', 'approved', 'scheduled', 'claimed', 'accepted', 'blocked', 'cancelled', 'unknown', 'failed'
  )),
  content_snapshot jsonb NOT NULL CHECK (jsonb_typeof(content_snapshot) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  recipient_name_snapshot text NULL CHECK (recipient_name_snapshot IS NULL OR char_length(recipient_name_snapshot) <= 300),
  recipient_email_snapshot text NOT NULL CHECK (char_length(btrim(recipient_email_snapshot)) BETWEEN 3 AND 320),
  recipient_sha256 text NOT NULL CHECK (recipient_sha256 ~ '^[a-f0-9]{64}$'),
  approved_content_sha256 text NULL CHECK (approved_content_sha256 IS NULL OR approved_content_sha256 ~ '^[a-f0-9]{64}$'),
  approved_recipient_sha256 text NULL CHECK (approved_recipient_sha256 IS NULL OR approved_recipient_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_by_operator_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NULL,
  scheduled_at timestamptz NULL,
  logical_message_key text NOT NULL UNIQUE CHECK (char_length(btrim(logical_message_key)) BETWEEN 1 AND 500),
  provider_idempotency_key text NOT NULL UNIQUE CHECK (char_length(btrim(provider_idempotency_key)) BETWEEN 1 AND 500),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text NULL CHECK (lease_owner IS NULL OR char_length(btrim(lease_owner)) BETWEEN 1 AND 200),
  lease_until timestamptz NULL,
  provider_message_id text NULL CHECK (provider_message_id IS NULL OR char_length(btrim(provider_message_id)) BETWEEN 1 AND 500),
  provider_accepted_at timestamptz NULL,
  last_error_code text NULL CHECK (last_error_code IS NULL OR char_length(btrim(last_error_code)) <= 300),
  unknown_since timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_id),
  CHECK ((reviewed_by_operator_id IS NULL AND reviewed_at IS NULL AND approved_content_sha256 IS NULL AND approved_recipient_sha256 IS NULL) OR
    (reviewed_by_operator_id IS NOT NULL AND reviewed_at IS NOT NULL AND approved_content_sha256 IS NOT NULL AND approved_recipient_sha256 IS NOT NULL)),
  CHECK (state NOT IN ('approved', 'scheduled', 'claimed', 'accepted') OR
    (reviewed_by_operator_id IS NOT NULL AND approved_content_sha256 = content_sha256 AND approved_recipient_sha256 = recipient_sha256)),
  CHECK (state NOT IN ('scheduled', 'claimed', 'accepted') OR scheduled_at IS NOT NULL),
  CHECK ((state = 'claimed' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR state <> 'claimed'),
  CHECK ((state = 'accepted' AND provider_message_id IS NOT NULL AND provider_accepted_at IS NOT NULL) OR state <> 'accepted'),
  CHECK ((state = 'unknown' AND unknown_since IS NOT NULL) OR state <> 'unknown')
);
CREATE INDEX agency_followup_messages_queue_idx
  ON public.agency_followup_messages (state, scheduled_at, created_at)
  WHERE state IN ('scheduled', 'claimed');
CREATE INDEX agency_followup_messages_enrollment_idx
  ON public.agency_followup_messages (enrollment_id, step_number);

CREATE TABLE public.agency_followup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NULL REFERENCES public.agency_followup_enrollments(id) ON DELETE RESTRICT,
  journey_id uuid NULL REFERENCES public.agency_followup_journeys(id) ON DELETE RESTRICT,
  template_version_id uuid NULL REFERENCES public.agency_followup_template_versions(id) ON DELETE RESTRICT,
  message_id uuid NULL REFERENCES public.agency_followup_messages(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'journey_created', 'journey_activated', 'journey_retired', 'template_created', 'template_approved',
    'enrolled', 'eligibility_changed', 'released', 'paused', 'resumed', 'stopped', 'cancelled',
    'message_changed', 'message_approved', 'message_scheduled', 'message_blocked', 'message_claimed',
    'provider_attempted', 'provider_accepted', 'provider_failed', 'provider_unknown',
    'reply_observed', 'booking_observed', 'unsubscribe_observed', 'bounce_observed',
    'complaint_observed', 'suppression_resolved'
  )),
  idempotency_key text NULL UNIQUE CHECK (idempotency_key IS NULL OR char_length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_payload) = 'object'),
  actor_operator_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (enrollment_id IS NOT NULL OR journey_id IS NOT NULL OR template_version_id IS NOT NULL)
);
CREATE INDEX agency_followup_events_enrollment_idx
  ON public.agency_followup_events (enrollment_id, occurred_at DESC, id DESC);
CREATE INDEX agency_followup_events_message_idx
  ON public.agency_followup_events (message_id, occurred_at DESC, id DESC)
  WHERE message_id IS NOT NULL;
CREATE INDEX agency_followup_events_journey_idx
  ON public.agency_followup_events (journey_id, occurred_at DESC, id DESC)
  WHERE journey_id IS NOT NULL;
CREATE INDEX agency_followup_events_template_idx
  ON public.agency_followup_events (template_version_id, occurred_at DESC, id DESC)
  WHERE template_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_agency_followup_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'agency follow-up events are append-only';
END;
$$;
CREATE TRIGGER agency_followup_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_event_mutation();

CREATE OR REPLACE FUNCTION public.reject_agency_followup_template_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agency follow-up template versions are immutable; create a new version';
  END IF;
  IF NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.created_by_operator_id IS DISTINCT FROM OLD.created_by_operator_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'agency follow-up template content is immutable; create a new version';
  END IF;
  IF OLD.state = 'retired' THEN
    RAISE EXCEPTION 'retired agency follow-up template versions are immutable';
  END IF;
  IF OLD.state = 'approved' AND NEW.state NOT IN ('approved', 'retired') THEN
    RAISE EXCEPTION 'approved agency follow-up template versions cannot return to draft';
  END IF;
  IF NEW.state = 'approved' AND (NEW.approved_by_operator_id IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'approval actor and time are required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agency_followup_template_versions_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_template_mutation();

CREATE OR REPLACE FUNCTION public.reject_agency_followup_journey_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'draft'
       AND NOT EXISTS (SELECT 1 FROM public.agency_followup_enrollments WHERE journey_id = OLD.id)
       AND NOT EXISTS (SELECT 1 FROM public.agency_followup_events WHERE journey_id = OLD.id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'agency follow-up journey versions are immutable';
  END IF;
  IF NEW.journey_key IS DISTINCT FROM OLD.journey_key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.timezone IS DISTINCT FROM OLD.timezone
     OR NEW.business_days IS DISTINCT FROM OLD.business_days
     OR NEW.local_window_start IS DISTINCT FROM OLD.local_window_start
     OR NEW.local_window_end IS DISTINCT FROM OLD.local_window_end
     OR NEW.minimum_spacing_hours IS DISTINCT FROM OLD.minimum_spacing_hours
     OR NEW.created_by_operator_id IS DISTINCT FROM OLD.created_by_operator_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'agency follow-up journey configuration is immutable; create a new version';
  END IF;
  IF NOT ((OLD.state = 'draft' AND NEW.state = 'active') OR
          (OLD.state = 'active' AND NEW.state = 'retired') OR OLD.state = NEW.state) THEN
    RAISE EXCEPTION 'invalid agency follow-up journey state transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agency_followup_journeys_version_immutable
  BEFORE UPDATE OR DELETE ON public.agency_followup_journeys
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_journey_mutation();

CREATE OR REPLACE FUNCTION public.reject_agency_followup_step_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.agency_followup_journeys WHERE id = OLD.journey_id AND state = 'draft')
       AND NOT EXISTS (SELECT 1 FROM public.agency_followup_enrollments WHERE journey_id = OLD.journey_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'agency follow-up journey steps are immutable; create a new journey version';
END;
$$;
CREATE TRIGGER agency_followup_steps_immutable
  BEFORE UPDATE OR DELETE ON public.agency_followup_steps
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_step_mutation();

-- Only a draft journey with approved immutable templates can become active.
-- The unique partial index enforces one active version per journey key.
CREATE OR REPLACE FUNCTION public.activate_agency_followup_journey(p_journey_id uuid, p_actor_operator_id uuid)
RETURNS public.agency_followup_journeys
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target public.agency_followup_journeys;
BEGIN
  SELECT * INTO target
  FROM public.agency_followup_journeys
  WHERE id = p_journey_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'journey version not found'; END IF;
  IF target.state <> 'draft' THEN RAISE EXCEPTION 'only a draft journey version can be activated'; END IF;
  IF p_actor_operator_id IS NULL THEN RAISE EXCEPTION 'operator identity is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_followup_steps WHERE journey_id = target.id) THEN
    RAISE EXCEPTION 'journey needs at least one step';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.agency_followup_steps step
    JOIN public.agency_followup_template_versions template_version
      ON template_version.id = step.template_version_id
    WHERE step.journey_id = target.id AND template_version.state <> 'approved'
  ) THEN
    RAISE EXCEPTION 'every journey step must use an approved template version';
  END IF;
  WITH retired AS (
    UPDATE public.agency_followup_journeys
  SET state = 'retired', updated_at = now()
    WHERE journey_key = target.journey_key AND state = 'active'
    RETURNING id, journey_key, version
  )
  INSERT INTO public.agency_followup_events (journey_id, event_type, idempotency_key, event_payload, actor_operator_id)
  SELECT retired.id, 'journey_retired', 'journey-retired:' || retired.id::text,
         jsonb_build_object('journeyKey', retired.journey_key, 'version', retired.version), p_actor_operator_id
  FROM retired
  ON CONFLICT (idempotency_key) DO NOTHING;
  UPDATE public.agency_followup_journeys
  SET state = 'active', updated_at = now()
  WHERE id = target.id
  RETURNING * INTO target;
  INSERT INTO public.agency_followup_events (journey_id, event_type, idempotency_key, event_payload, actor_operator_id)
  VALUES (target.id, 'journey_activated', 'journey-activated:' || target.id::text,
          jsonb_build_object('journeyKey', target.journey_key, 'version', target.version, 'activatedAt', target.updated_at),
          p_actor_operator_id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN target;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_agency_followup_message_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
     OR NEW.recipient_email_snapshot IS DISTINCT FROM OLD.recipient_email_snapshot
     OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot
     OR NEW.recipient_sha256 IS DISTINCT FROM OLD.recipient_sha256 THEN
    NEW.reviewed_by_operator_id := NULL;
    NEW.reviewed_at := NULL;
    NEW.approved_content_sha256 := NULL;
    NEW.approved_recipient_sha256 := NULL;
    IF NEW.state IN ('approved', 'scheduled', 'claimed') THEN
      NEW.state := 'awaiting_review';
      NEW.scheduled_at := NULL;
      NEW.lease_owner := NULL;
      NEW.lease_until := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER agency_followup_message_content_invalidate_approval
  BEFORE UPDATE ON public.agency_followup_messages
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_agency_followup_message_approval();

-- Atomic claims prevent two workers from taking the same scheduled message.
-- Expired claims become UNKNOWN and are never automatically reclaimed because
-- provider acceptance may have occurred before a worker stopped responding.
CREATE OR REPLACE FUNCTION public.claim_agency_followup_messages(
  p_worker_id text,
  p_now timestamptz DEFAULT now(),
  p_lease_seconds integer DEFAULT 120,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.agency_followup_messages
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;
  IF p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid claim limit'; END IF;

  WITH expired AS (
    UPDATE public.agency_followup_messages
    SET state = 'unknown', unknown_since = p_now, last_error_code = 'lease_expired_outcome_unknown',
        lease_owner = NULL, lease_until = NULL, updated_at = p_now
    WHERE state = 'claimed' AND lease_until <= p_now
    RETURNING id, enrollment_id
  )
  INSERT INTO public.agency_followup_events (enrollment_id, message_id, event_type, idempotency_key, event_payload)
  SELECT expired.enrollment_id, expired.id, 'provider_unknown', 'lease-expired:' || expired.id::text,
         jsonb_build_object('reason', 'lease_expired_outcome_unknown', 'observedAt', p_now)
  FROM expired
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.agency_followup_messages
    WHERE state = 'scheduled' AND scheduled_at <= p_now
    ORDER BY scheduled_at, created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.agency_followup_messages AS message
  SET state = 'claimed', lease_owner = btrim(p_worker_id),
      lease_until = p_now + make_interval(secs => p_lease_seconds),
      attempt_count = message.attempt_count + 1, updated_at = p_now
  FROM candidates
  WHERE message.id = candidates.id
  RETURNING message.*;
END;
$$;

ALTER TABLE public.agency_followup_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_journeys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.agency_followup_journeys FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.agency_followup_template_versions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.agency_followup_steps FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.agency_followup_enrollments FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.agency_followup_messages FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.agency_followup_events FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.agency_followup_journeys TO service_role;
GRANT ALL ON public.agency_followup_template_versions TO service_role;
GRANT ALL ON public.agency_followup_steps TO service_role;
GRANT ALL ON public.agency_followup_enrollments TO service_role;
GRANT ALL ON public.agency_followup_messages TO service_role;
GRANT SELECT, INSERT ON public.agency_followup_events TO service_role;
REVOKE ALL ON FUNCTION public.claim_agency_followup_messages(text, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agency_followup_messages(text, timestamptz, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.activate_agency_followup_journey(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_agency_followup_journey(uuid, uuid) TO service_role;
