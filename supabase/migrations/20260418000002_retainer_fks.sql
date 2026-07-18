-- retainer_agreements FK constraints
-- Adds foreign keys so Supabase auto-join works in the /retainers page
-- and so cascade-delete keeps the table clean.
--
-- Idempotent: uses DO $$ blocks with existence checks.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'retainer_agreements_firm_id_fkey'
      AND table_name = 'retainer_agreements'
  ) THEN
    ALTER TABLE retainer_agreements
      ADD CONSTRAINT retainer_agreements_firm_id_fkey
      FOREIGN KEY (firm_id) REFERENCES intake_firms(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'retainer_agreements_session_id_fkey'
      AND table_name = 'retainer_agreements'
  ) THEN
    ALTER TABLE retainer_agreements
      ADD CONSTRAINT retainer_agreements_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES intake_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;
