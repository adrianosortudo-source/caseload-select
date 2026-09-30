-- Avoid synchronously reprojecting the complete legacy firm inventory when an
-- enrichment package is applied to a firm that already has independent
-- authority. A first-authority package still triggers catch-up projection.
BEGIN;

CREATE OR REPLACE FUNCTION prospect_candidate_private.enrichment_firm_refresh_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Keep OLD access inside this branch: INSERT triggers have no OLD record.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IS DISTINCT FROM 'applied'
       AND NEW.state = 'applied'
       AND NEW.firm_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.gta_prospect_import_audit a
         JOIN public.gta_prospect_import_batches b ON b.id = a.import_batch_id
         WHERE a.firm_id = NEW.firm_id
           AND a.validation_state = 'accepted'
           AND a.action_state IN ('created', 'already_present')
           AND b.state = 'applied'
           -- A new-firm apply creates its own core import before transitioning
           -- the package. That audit is not prior authority for this decision.
           AND NOT (
             b.source_name = 'pe-' || replace(NEW.id::text, '-', '')
             AND b.source_sha256 = NEW.payload_sha256
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.prospect_research_candidate_history h
         WHERE h.item_kind = 'identity_link'
           AND h.source_table = 'verified_identity'
           AND h.verified_firm_id = NEW.firm_id
           -- The projection trigger runs first and records this package's own
           -- identity link before this refresh trigger runs.
           AND h.package_id IS DISTINCT FROM NEW.id
       ) THEN
      PERFORM prospect_candidate_private.refresh_legacy_firm(NEW.firm_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
