-- Correct the deterministic identity lock query without rewriting the already pushed migration.
-- ORDER BY must use only the projected DISTINCT key.
CREATE OR REPLACE FUNCTION public.lock_agency_followup_activity_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE row_scope record;
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 FOR row_scope IN
  SELECT DISTINCT prospect.id AS prospect_id
  FROM public.prospect_conversation_sources association
  JOIN public.prospect_source_links source_link ON source_link.id=association.source_link_id
  JOIN public.agency_prospects prospect ON prospect.id::text=source_link.source_record_key
  WHERE association.conversation_id=NEW.conversation_id
    AND source_link.source_system IN ('agency_crm','agency_crm_contact')
    AND source_link.source_system=CASE WHEN EXISTS(
      SELECT 1 FROM public.prospect_source_links preferred
      WHERE preferred.source_system='agency_crm_contact'
        AND preferred.source_record_key=prospect.id::text
    ) THEN 'agency_crm_contact' ELSE 'agency_crm' END
  ORDER BY prospect.id
 LOOP
  PERFORM public.lock_agency_followup_identity(row_scope.prospect_id);
 END LOOP;
 RETURN NEW;
END $$;
