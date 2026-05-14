-- Jim Manico audit APP-006: persist lawyer_id (not "lawyer" / "operator"
-- string) on every status change.
--
-- Today screened_leads.status_changed_by stores either "lawyer" or
-- "operator", which loses the identity of WHICH lawyer took or passed
-- a lead. With multi-lawyer firms (firm_lawyers table supports this
-- explicitly), PIPEDA Article 4.5.3 expects an audit trail tying
-- access to identity.
--
-- Migration:
--   1. Add status_changed_by_role text NOT NULL DEFAULT 'lawyer'
--      stores the ROLE separately so existing reporting that filters
--      by "operator" vs "lawyer" actor keeps working.
--   2. Existing status_changed_by values stay as-is during this
--      migration; the application starts writing lawyer_id (uuid as
--      text) on new actions. The column is text, so it accepts both
--      shapes during the transition.
--   3. No backfill — historical "lawyer" / "operator" values are kept
--      to preserve audit immutability.

ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS status_changed_by_role TEXT NOT NULL DEFAULT 'lawyer';

-- Optional CHECK constraint to validate role values. Defaulted DEFERRABLE
-- so it can be relaxed if a future role tier is added without a migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'screened_leads_status_changed_by_role_check'
  ) THEN
    ALTER TABLE screened_leads
      ADD CONSTRAINT screened_leads_status_changed_by_role_check
      CHECK (status_changed_by_role IN ('lawyer', 'operator', 'system', 'system:backstop'));
  END IF;
END $$;

COMMENT ON COLUMN screened_leads.status_changed_by IS
  'Lawyer UUID (or "system" / "system:backstop") that last changed the row status. Was "lawyer" / "operator" strings until 2026-05-14; from that point forward stores the actual lawyer_id from the portal session token for PIPEDA audit trail. Jim Manico audit APP-006.';

COMMENT ON COLUMN screened_leads.status_changed_by_role IS
  'Role of the actor that last changed status: lawyer | operator | system | system:backstop. Kept separately from status_changed_by so existing dashboards that filter by role keep working. Jim Manico audit APP-006.';
