-- Ported verbatim from commit 8b97eb8 (branch fix/restore-marketing-homepage);
-- see 20260713234759_deliverable_suggestions.sql for full provenance detail.
-- Filename reconciled to production's actual applied ledger version
-- (20260714001604).

-- Cover the foreign keys introduced by the append-only suggestion workflow.
create index if not exists deliverable_suggestions_deliverable_idx
  on public.deliverable_suggestions (deliverable_id);
create index if not exists deliverable_suggestion_events_resulting_version_idx
  on public.deliverable_suggestion_events (resulting_version_id);
