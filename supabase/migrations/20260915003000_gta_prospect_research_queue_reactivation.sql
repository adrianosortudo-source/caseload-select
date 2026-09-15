-- Controlled reactivation of deferred GTA public-research work.
--
-- This does not create firms, contacts, outreach, or evidence. It moves only
-- retry-held work back to pending and records an immutable reason before the
-- existing worker re-applies its terms and robots gates.

ALTER TABLE public.gta_prospect_research_work_attempts
  DROP CONSTRAINT IF EXISTS gta_prospect_research_work_attempts_event_type_check;

ALTER TABLE public.gta_prospect_research_work_attempts
  ADD CONSTRAINT gta_prospect_research_work_attempts_event_type_check
  CHECK (event_type IN ('claimed', 'renewed', 'lease_expired', 'deferred', 'resolved', 'requeued'));

CREATE OR REPLACE FUNCTION public.requeue_gta_prospect_research_work_items(
  p_source_system text,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reopened_count integer := 0;
BEGIN
  IF coalesce(p_source_system, '') !~ '^[-_a-z0-9]{1,120}$'
    OR char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 2000
  THEN
    RAISE EXCEPTION 'invalid GTA prospect research queue reactivation';
  END IF;

  WITH reopened AS (
    UPDATE public.gta_prospect_research_work_items AS queue
    SET state = 'pending', next_attempt_at = NULL, last_error = NULL, updated_at = now()
    WHERE queue.source_system = p_source_system
      AND queue.state = 'retry'
    RETURNING queue.id, queue.attempt_count
  ), audit AS (
    INSERT INTO public.gta_prospect_research_work_attempts (
      work_item_id, attempt_number, event_type, worker_id, note
    )
    SELECT id, attempt_count, 'requeued', NULL, btrim(p_reason)
    FROM reopened
    RETURNING 1
  )
  SELECT count(*) INTO reopened_count FROM audit;

  RETURN reopened_count;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_gta_prospect_research_work_items(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.requeue_gta_prospect_research_work_items(text, text)
  TO service_role;

COMMENT ON FUNCTION public.requeue_gta_prospect_research_work_items(text, text) IS
  'Service-only, source-scoped reactivation of retry-held public GTA research work. Preserves an append-only requeued audit event and does not waive current terms or robots gates.';

NOTIFY pgrst, 'reload schema';