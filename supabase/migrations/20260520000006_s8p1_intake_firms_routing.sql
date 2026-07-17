-- =============================================================================
-- S8 Phase 1 · intake_firms routing and configuration columns
-- =============================================================================
-- Six new columns on intake_firms to support Phase 1 surfaces:
--
--   default_lead_by_practice_area   JSONB  - map practice_area → firm_lawyer_id
--   default_lead_id                 UUID   - fallback lead lawyer
--   default_assignees               JSONB  - array of firm_lawyer_id UUIDs,
--                                            snapshotted onto each new matter
--   client_files_locked             BOOL   - per-firm files-folder-lock toggle
--   subdomain                       TEXT   - branded subdomain (e.g.,
--                                            "portal.firm.com" segment)
--   embed_origins                   JSONB  - CSP allow-list for iframe embeds
--
-- All defaults are safe so existing intake_firms rows continue to work
-- without backfill. The application resolver returns null when configuration
-- is missing and surfaces an operator-actionable 422 at take time.
-- =============================================================================

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS default_lead_by_practice_area JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_lead_id UUID REFERENCES firm_lawyers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_assignees JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS client_files_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subdomain TEXT,
  ADD COLUMN IF NOT EXISTS embed_origins JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Unique constraint on subdomain. Nullable column with a unique index permits
-- multiple NULL values (firms without a branded subdomain configured yet).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_intake_firms_subdomain_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_intake_firms_subdomain_unique
      ON intake_firms (subdomain)
      WHERE subdomain IS NOT NULL;
  END IF;
END $$;

-- JSONB shape guards (best-effort; the application enforces strictly).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intake_firms_default_lead_pa_object_check'
      AND conrelid = 'public.intake_firms'::regclass
  ) THEN
    ALTER TABLE intake_firms
      ADD CONSTRAINT intake_firms_default_lead_pa_object_check
      CHECK (jsonb_typeof(default_lead_by_practice_area) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intake_firms_default_assignees_array_check'
      AND conrelid = 'public.intake_firms'::regclass
  ) THEN
    ALTER TABLE intake_firms
      ADD CONSTRAINT intake_firms_default_assignees_array_check
      CHECK (jsonb_typeof(default_assignees) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intake_firms_embed_origins_array_check'
      AND conrelid = 'public.intake_firms'::regclass
  ) THEN
    ALTER TABLE intake_firms
      ADD CONSTRAINT intake_firms_embed_origins_array_check
      CHECK (jsonb_typeof(embed_origins) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN intake_firms.default_lead_by_practice_area IS
  'Map of practice_area string → firm_lawyer_id UUID string. Phase 1 Story 13. Used by resolveDefaultLead() in the take pipeline.';

COMMENT ON COLUMN intake_firms.default_lead_id IS
  'Fallback lead lawyer when no practice-area-specific lead is configured. NULL means no fallback; take returns 422.';

COMMENT ON COLUMN intake_firms.default_assignees IS
  'Array of firm_lawyer_id UUIDs snapshotted onto each new matter at take time. Phase 1 Story 13.';

COMMENT ON COLUMN intake_firms.client_files_locked IS
  'When true, client sessions cannot mutate folder structure under firm_files. Phase 1 Story 10. Default false.';

COMMENT ON COLUMN intake_firms.subdomain IS
  'Branded subdomain for the firm portal (e.g., "powellfirm" in portal.powellfirm.ca). Phase 1 Story 12. Distinct from custom_domain (full apex). Unique when set.';

COMMENT ON COLUMN intake_firms.embed_origins IS
  'JSONB array of CSP-allowlisted origins for matter iframe embeds. Phase 1 Story 16. Default empty (no embeds permitted).';

NOTIFY pgrst, 'reload schema';
