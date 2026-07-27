-- Phase 2: content approval system
--
-- The operator posts marketing deliverables (article drafts, ad copy, brand
-- assets, images, PDFs) for the firm's lawyer to review and formally sign off.
-- Under LSO Rule 4.2-1 the lawyer is responsible for their own marketing
-- content, so the sign-off is a compliance record: timestamped, versioned,
-- audit-logged, append-only.
--
-- Four tables:
--   content_deliverables  one item under review (carries status + current version pointer)
--   deliverable_versions  each revision (text body OR a stored asset)
--   deliverable_comments  annotations anchored to a SPECIFIC version (drift guard)
--   approval_records      append-only sign-off log (the compliance artifact)
--
-- All access is service-role only (Database Access Invariant). No RLS policy
-- grants anon or authenticated any reach here.

-- ─── content_deliverables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  content_kind text NOT NULL DEFAULT 'text'
    CHECK (content_kind IN ('text', 'image', 'pdf')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'changes_requested', 'approved', 'archived')),
  current_version_id uuid,
  approved_version_id uuid,
  approved_at timestamptz,
  created_by_role text NOT NULL DEFAULT 'operator'
    CHECK (created_by_role IN ('operator', 'lawyer')),
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_deliverables_firm
  ON content_deliverables(firm_id, status, updated_at DESC);

-- ─── deliverable_versions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deliverable_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES content_deliverables(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL,
  version_number int NOT NULL,
  body_html text,            -- text deliverables (sanitised before insert)
  storage_path text,         -- image / pdf object key in firm-files bucket
  asset_mime text,
  asset_size_bytes int,
  asset_name text,
  note text,                 -- operator changelog note for this revision
  created_by_role text NOT NULL DEFAULT 'operator'
    CHECK (created_by_role IN ('operator', 'lawyer')),
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deliverable_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_deliverable_versions_deliverable
  ON deliverable_versions(deliverable_id, version_number DESC);

-- current/approved pointers reference a version. SET NULL on delete so a
-- cascade-removed version does not block the parent row.
ALTER TABLE content_deliverables
  DROP CONSTRAINT IF EXISTS fk_deliverables_current_version;
ALTER TABLE content_deliverables
  ADD CONSTRAINT fk_deliverables_current_version
    FOREIGN KEY (current_version_id)
    REFERENCES deliverable_versions(id) ON DELETE SET NULL;

-- ─── deliverable_comments ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deliverable_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES content_deliverables(id) ON DELETE CASCADE,
  version_id uuid NOT NULL
    REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL,
  author_role text NOT NULL
    CHECK (author_role IN ('operator', 'lawyer')),
  author_id uuid,
  author_name text,
  -- annotation shape (null = general comment on the version):
  --   { type:'text',   start, end, quote }
  --   { type:'pin',    x, y }                 x,y normalised 0..1
  --   { type:'region', x, y, w, h }           normalised 0..1
  --   { type:'page',   page }                 1-based PDF page
  annotation jsonb,
  body text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by_role text CHECK (resolved_by_role IN ('operator', 'lawyer')),
  parent_comment_id uuid
    REFERENCES deliverable_comments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliverable_comments_version
  ON deliverable_comments(version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deliverable_comments_deliverable
  ON deliverable_comments(deliverable_id, created_at);

-- ─── approval_records (append-only compliance log) ───────────────────────────

CREATE TABLE IF NOT EXISTS approval_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES content_deliverables(id) ON DELETE CASCADE,
  version_id uuid NOT NULL
    REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL,
  decision text NOT NULL
    CHECK (decision IN ('approved', 'changes_requested')),
  signer_role text NOT NULL DEFAULT 'lawyer'
    CHECK (signer_role IN ('lawyer', 'operator')),
  signer_id uuid,
  signer_name text NOT NULL,
  signer_email text NOT NULL,
  attestation text NOT NULL,        -- frozen copy of the statement signed
  version_number int NOT NULL,      -- snapshot
  deliverable_title text NOT NULL,  -- snapshot
  ip_address text,
  user_agent text,
  note text,                        -- optional signer note (e.g. what to change)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_records_deliverable
  ON approval_records(deliverable_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_records_firm
  ON approval_records(firm_id, created_at DESC);
