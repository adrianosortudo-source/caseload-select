-- Content Studio foundation
-- Editorial planning layer for per-firm content strategy, calendar slots,
-- content pieces, piece versions, and AI provenance.
--
-- RLS: service-role only. No anon or authenticated access.
-- Per Database Access Invariant (DR-063, locked 2026-06-05).

-- ─────────────────────────────────────────────────────────────────────────────
-- firm_content_strategies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS firm_content_strategies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  name                text NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft', 'active', 'archived')),
  default_locale      text NOT NULL DEFAULT 'en',
  bilingual_enabled   boolean NOT NULL DEFAULT false,
  jurisdiction        text NOT NULL DEFAULT 'Ontario',
  strategy_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
  format_specs        jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, version)
);

CREATE INDEX IF NOT EXISTS idx_firm_content_strategies_firm
  ON firm_content_strategies (firm_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- content_calendar_slots
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_calendar_slots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  strategy_id         uuid REFERENCES firm_content_strategies(id) ON DELETE SET NULL,
  week_of             date NOT NULL,
  publish_date        date NOT NULL,
  cadence_kind        text NOT NULL CHECK (
                        cadence_kind IN (
                          'tuesday_primary',
                          'thursday_day2',
                          'monthly_letter',
                          'quarterly_tool'
                        )
                      ),
  territory           text,
  planned_format      text NOT NULL CHECK (
                        planned_format IN (
                          'counsel_note',
                          'clause_in_the_margin',
                          'decision_tool',
                          'counsel_letter'
                        )
                      ),
  theme               text NOT NULL,
  status              text NOT NULL DEFAULT 'planned' CHECK (
                        status IN (
                          'planned',
                          'briefed',
                          'drafting',
                          'legal_review',
                          'production',
                          'shipped',
                          'skipped'
                        )
                      ),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_calendar_slots_firm_publish
  ON content_calendar_slots (firm_id, publish_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- content_pieces
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_pieces (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  calendar_slot_id    uuid REFERENCES content_calendar_slots(id) ON DELETE SET NULL,
  strategy_id         uuid REFERENCES firm_content_strategies(id) ON DELETE SET NULL,
  strategy_version    integer,
  deliverable_id      uuid,
  title_working       text NOT NULL,
  format              text NOT NULL CHECK (
                        format IN (
                          'counsel_note',
                          'clause_in_the_margin',
                          'decision_tool',
                          'counsel_letter'
                        )
                      ),
  language_mode       text NOT NULL DEFAULT 'en' CHECK (
                        language_mode IN ('en', 'pt', 'bilingual')
                      ),
  workflow_gate       text NOT NULL DEFAULT 'discovery' CHECK (
                        workflow_gate IN (
                          'discovery',
                          'position',
                          'draft',
                          'legal_gate',
                          'authoring',
                          'production'
                        )
                      ),
  status              text NOT NULL DEFAULT 'draft' CHECK (
                        status IN (
                          'draft',
                          'in_review',
                          'changes_requested',
                          'approved',
                          'production',
                          'published',
                          'archived'
                        )
                      ),
  source_brief        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ship_checks         jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_name          text,
  review_date         date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_pieces_firm_status
  ON content_pieces (firm_id, status, workflow_gate);

CREATE INDEX IF NOT EXISTS idx_content_pieces_slot
  ON content_pieces (calendar_slot_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- content_piece_versions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_piece_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id            uuid NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  version_number      integer NOT NULL,
  language            text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'pt')),
  body_structured     jsonb NOT NULL DEFAULT '[]'::jsonb,
  body_markdown       text,
  seo_metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_notes        jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_hash           text,
  created_by          text,
  created_with_ai_run_id uuid,
  is_current          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (piece_id, version_number, language)
);

CREATE INDEX IF NOT EXISTS idx_content_piece_versions_piece_current
  ON content_piece_versions (piece_id, is_current);

-- ─────────────────────────────────────────────────────────────────────────────
-- content_ai_runs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_ai_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  piece_id              uuid REFERENCES content_pieces(id) ON DELETE SET NULL,
  piece_version_id      uuid REFERENCES content_piece_versions(id) ON DELETE SET NULL,
  run_type              text NOT NULL CHECK (
                          run_type IN (
                            'draft',
                            'revise',
                            'validate_deterministic',
                            'validate_voice',
                            'validate_lso',
                            'generate_derivatives'
                          )
                        ),
  status                text NOT NULL DEFAULT 'queued' CHECK (
                          status IN ('queued', 'running', 'succeeded', 'failed')
                        ),
  model                 text,
  input_hash            text,
  output_hash           text,
  prompt_context_version integer,
  prompt_context        jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  result                jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_ai_runs_piece
  ON content_ai_runs (piece_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_ai_runs_status
  ON content_ai_runs (status, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_content_studio_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS firm_content_strategies_updated_at ON firm_content_strategies;
CREATE TRIGGER firm_content_strategies_updated_at
  BEFORE UPDATE ON firm_content_strategies
  FOR EACH ROW EXECUTE FUNCTION set_content_studio_updated_at();

DROP TRIGGER IF EXISTS content_calendar_slots_updated_at ON content_calendar_slots;
CREATE TRIGGER content_calendar_slots_updated_at
  BEFORE UPDATE ON content_calendar_slots
  FOR EACH ROW EXECUTE FUNCTION set_content_studio_updated_at();

DROP TRIGGER IF EXISTS content_pieces_updated_at ON content_pieces;
CREATE TRIGGER content_pieces_updated_at
  BEFORE UPDATE ON content_pieces
  FOR EACH ROW EXECUTE FUNCTION set_content_studio_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: enable + force + revoke + service-role-only
-- Per Database Access Invariant (locked 2026-06-05)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE firm_content_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_content_strategies FORCE ROW LEVEL SECURITY;
ALTER TABLE content_calendar_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_calendar_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE content_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_pieces FORCE ROW LEVEL SECURITY;
ALTER TABLE content_piece_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_piece_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE content_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ai_runs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON firm_content_strategies FROM anon, authenticated, PUBLIC;
REVOKE ALL ON content_calendar_slots FROM anon, authenticated, PUBLIC;
REVOKE ALL ON content_pieces FROM anon, authenticated, PUBLIC;
REVOKE ALL ON content_piece_versions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON content_ai_runs FROM anon, authenticated, PUBLIC;
