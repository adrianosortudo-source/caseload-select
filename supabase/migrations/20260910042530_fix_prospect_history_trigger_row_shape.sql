-- The original shared trigger function referenced source-link-only fields in
-- an IF expression that also runs for prospect_conversations. PostgreSQL must
-- resolve OLD/NEW record fields for the trigger row type, so an activity insert
-- that updates its conversation failed with:
--   record "old" has no field "source_system"
-- Dispatch by trigger table before touching table-specific fields.

CREATE OR REPLACE FUNCTION public.prevent_prospect_history_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'prospect_conversations' THEN
      IF (OLD.organization_id IS DISTINCT FROM NEW.organization_id
          OR OLD.person_id IS DISTINCT FROM NEW.person_id)
         AND EXISTS (
           SELECT 1
           FROM public.prospect_activities
           WHERE conversation_id = OLD.id
         ) THEN
        RAISE EXCEPTION 'a conversation with activity history cannot be reassigned';
      END IF;

    WHEN 'prospect_source_links' THEN
      IF OLD.source_system IS DISTINCT FROM NEW.source_system
         OR OLD.source_record_key IS DISTINCT FROM NEW.source_record_key THEN
        RAISE EXCEPTION 'source system and source record key are immutable';
      END IF;

      IF (OLD.organization_id IS DISTINCT FROM NEW.organization_id
          OR OLD.person_id IS DISTINCT FROM NEW.person_id)
         AND EXISTS (
           SELECT 1
           FROM public.prospect_conversation_sources AS cs
           JOIN public.prospect_activities AS activity
             ON activity.conversation_id = cs.conversation_id
           WHERE cs.source_link_id = OLD.id
         ) THEN
        RAISE EXCEPTION 'a source link with activity history cannot be reassigned';
      END IF;

    ELSE
      RAISE EXCEPTION 'unsupported table % for prospect history reassignment trigger', TG_TABLE_NAME;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_prospect_history_reassignment()
  FROM PUBLIC, anon, authenticated;
