-- =============================================================================
-- S8 Phase 1 · firm_lawyers role split + display fields
-- =============================================================================
-- The existing firm_lawyers.role takes 'lawyer' or 'operator'. Phase 1 splits
-- the firm-side role into 'admin' and 'staff' so visibility can be gated
-- without building a permission matrix the firm will never use.
--
-- Backward compatibility: existing 'lawyer' rows are treated as 'admin' by the
-- application resolver (legacy alias). No backfill required. The CHECK
-- constraint is extended in place to accept the new values alongside the old.
--
-- Adds display_name and title columns so the welcome-draft template (Story 8)
-- can merge in the lead lawyer's identity. Both nullable; the welcome-draft
-- builder falls back to a sensible default when missing.
-- =============================================================================

-- Drop the old constraint, add the new one with the extended value set.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'firm_lawyers_role_check'
      AND conrelid = 'public.firm_lawyers'::regclass
  ) THEN
    ALTER TABLE firm_lawyers DROP CONSTRAINT firm_lawyers_role_check;
  END IF;

  ALTER TABLE firm_lawyers
    ADD CONSTRAINT firm_lawyers_role_check
    CHECK (role IN ('lawyer', 'admin', 'staff', 'operator'));
END $$;

ALTER TABLE firm_lawyers
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN firm_lawyers.role IS
  'admin | staff | operator. ''lawyer'' is a legacy alias that the resolver treats as ''admin''. New rows should use admin or staff.';

COMMENT ON COLUMN firm_lawyers.display_name IS
  'First + last name, used by the welcome-draft template (Story 8). Falls back to name if null.';

COMMENT ON COLUMN firm_lawyers.title IS
  'Lawyer title (e.g., "Principal", "Associate") rendered in the welcome-draft signature. Optional.';

COMMENT ON COLUMN firm_lawyers.email_notifications_enabled IS
  'Per-staff email toggle for the batched notification outbox (Story 9). Default true. When false, queued rows for this recipient drop at drain time.';

NOTIFY pgrst, 'reload schema';
