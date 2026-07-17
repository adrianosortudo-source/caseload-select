-- =============================================================================
-- S8 Phase 1 · explainer_articles + matter_explainer_assignments
-- =============================================================================
-- Operator-curated matter-stage explainer library (Story 15). Articles are
-- tagged by practice_area and matter_stage. The lawyer assigns one or more
-- articles to a matter; the client sees them on /portal/[firmId]/m/[matterId]/explainers.
--
-- Phase 1 is operator-authored. Per-firm authoring is Phase 3.
--
-- The migration scaffolds the table and inserts 10 placeholder slugs. The
-- actual body content is written by the operator in a follow-up content pass
-- (see docs/explainer-content-runbook.md).
-- =============================================================================

CREATE TABLE IF NOT EXISTS explainer_articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  title           text NOT NULL,
  body_html       text NOT NULL DEFAULT '',
  practice_area   text NOT NULL,
  matter_stage    text NOT NULL,
  ordering        integer NOT NULL DEFAULT 0,
  published       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'explainer_articles_stage_check'
      AND conrelid = 'public.explainer_articles'::regclass
  ) THEN
    ALTER TABLE explainer_articles
      ADD CONSTRAINT explainer_articles_stage_check
      CHECK (matter_stage IN ('intake', 'retainer_pending', 'active', 'closing', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_explainer_articles_pa_stage
  ON explainer_articles (practice_area, matter_stage, ordering)
  WHERE published = true;

CREATE INDEX IF NOT EXISTS idx_explainer_articles_published
  ON explainer_articles (published, updated_at DESC);

-- updated_at maintenance
DROP TRIGGER IF EXISTS trg_touch_explainer_articles_updated_at ON explainer_articles;
CREATE TRIGGER trg_touch_explainer_articles_updated_at
  BEFORE UPDATE ON explainer_articles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE explainer_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE explainer_articles FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- matter_explainer_assignments: many-to-many between matters and articles
-- =============================================================================

CREATE TABLE IF NOT EXISTS matter_explainer_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid NOT NULL REFERENCES client_matters(id) ON DELETE CASCADE,
  article_id            uuid NOT NULL REFERENCES explainer_articles(id) ON DELETE CASCADE,
  assigned_by_lawyer_id uuid REFERENCES firm_lawyers(id) ON DELETE SET NULL,
  assigned_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uniq_matter_explainer_assignment'
  ) THEN
    CREATE UNIQUE INDEX uniq_matter_explainer_assignment
      ON matter_explainer_assignments (matter_id, article_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matter_explainer_assignments_matter
  ON matter_explainer_assignments (matter_id, assigned_at DESC);

ALTER TABLE matter_explainer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_explainer_assignments FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- Seed (placeholder slugs only; body content authored in follow-up content pass)
-- =============================================================================

INSERT INTO explainer_articles (slug, title, practice_area, matter_stage, ordering, published, body_html)
VALUES
  ('intake-what-happens-next', 'What happens after you submit your inquiry', 'general', 'intake', 1, false, ''),
  ('retainer-pending-what-the-retainer-means', 'What the retainer agreement covers', 'general', 'retainer_pending', 1, false, ''),
  ('active-typical-timeline', 'What a typical timeline looks like for your matter type', 'general', 'active', 1, false, ''),
  ('active-real-estate-closing-prep', 'Preparing for your real estate closing', 'real_estate', 'active', 1, false, ''),
  ('active-litigation-discovery-prep', 'What to expect during discovery', 'litigation', 'active', 1, false, ''),
  ('active-family-mediation-prep', 'Preparing for a family-law mediation session', 'family_law', 'active', 1, false, ''),
  ('active-immigration-document-checklist', 'Documents to gather for your immigration matter', 'immigration', 'active', 1, false, ''),
  ('active-corporate-shareholder-agreement-overview', 'What a shareholder agreement covers', 'corporate', 'active', 1, false, ''),
  ('closing-what-to-expect', 'What happens as your matter wraps up', 'general', 'closing', 1, false, ''),
  ('closed-keeping-your-records', 'Keeping your matter records after the file is closed', 'general', 'closed', 1, false, '')
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE explainer_articles IS
  'Operator-curated matter-stage explainer library. Phase 1 S8 Story 15. Body content authored in a follow-up pass per docs/explainer-content-runbook.md.';

COMMENT ON COLUMN explainer_articles.published IS
  'Article is hidden from the assignment picker and the client surface until set to true. Seed inserts published=false; operator flips to true once body_html is authored.';

COMMENT ON TABLE matter_explainer_assignments IS
  'Many-to-many between matters and explainer articles. Lawyer assigns; client reads.';

NOTIFY pgrst, 'reload schema';
