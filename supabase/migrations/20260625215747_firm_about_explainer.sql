-- Per-firm standing "About this content" explainer for the deliverables
-- portal. One row per firm, rendered as a collapsible panel above the
-- deliverables list at /portal/[firmId]/deliverables. Operator-authored,
-- read by the firm's lawyer.
--
-- New public table: born exposed, so RLS is enabled + forced and every grant
-- to anon / authenticated / PUBLIC is revoked in this same file. The app reads
-- and writes through the service role only (Database Access Invariant rule 2).
--
-- NOT applied to prod by the build session (operator-gated migration). Apply
-- via the Supabase SQL editor or `supabase db push`, then publish the firm's
-- content with the INSERT surfaced in the build report. Idempotent.

CREATE TABLE IF NOT EXISTS firm_about (
  firm_id    uuid PRIMARY KEY REFERENCES intake_firms(id) ON DELETE CASCADE,
  body_html  text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE firm_about ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_about FORCE ROW LEVEL SECURITY;
REVOKE ALL ON firm_about FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE firm_about IS
  'Per-firm standing "About this content" explainer shown above the deliverables list in the portal. Operator-authored HTML (sanitised with the deliverable/explainer allowlist before write). Service-role access only.';
