-- Reconstructed 2026-07-27 by the migration-lineage remediation (Phase 0b).
--
-- This migration was applied to production at ledger version 20260722180056
-- ("add_content_deliverable_published_at") with no corresponding file ever
-- committed to git -- a genuine zero-source ledger row, distinct from the 73
-- duplicate-pair rows the 2026-07-18 incident describes. Content is
-- reconstructed from introspection of the live column
-- (public.content_deliverables.published_at: date, nullable, no default, no
-- index, comment as below) and applied nowhere -- the column already exists
-- in production. This file exists so `supabase db push --dry-run` has
-- something to reconcile against this ledger row, and so the schema is
-- documented in git the way every other column on this table is.
--
-- published_at is read by isPublished() (deliverables-pure.ts) and drives the
-- "Published" status label, which outranks every other label including a
-- standing-authorization pre-approval -- see displayStatusLabel's doc
-- comment. It is a WEAKER claim than publication_receipts: an operator's
-- record that a piece went out, not durable per-destination proof.

alter table public.content_deliverables
  add column if not exists published_at date;

comment on column public.content_deliverables.published_at is
  'Date this deliverable was confirmed live on its publication destination.';
