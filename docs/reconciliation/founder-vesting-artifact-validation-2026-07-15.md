# Founder Vesting: publication_artifacts validation run, 2026-07-15

Firm: DRG Law Professional Corporation (`eec1d25e-a047-4827-8e4a-6eb96becca2b`). Period: Founder vesting (`187a18a7-aca5-4d7e-962e-07789b7c7923`), lifecycle `setup_required` (the current publishing week, not one of the 3 legacy periods covered by `HISTORICAL_RECONCILIATION_LEDGER_2026-07-15.md`; this document does not change that period's reconciliation scope).

## What this is

`publication_artifacts` (the Workstream 2 evidence-registration table, distinct from this session's new `content_placements`/`publication_receipts` tables) already carried 8 registered rows for this period's 4 deliverables before this run: 3 hero images, 3 webpages, 1 PDF, 1 form. Only 2 of the 8 had ever been run through `reconcileDeliverableArtifacts` (`src/lib/publication-reconciliation.ts`), the operator-triggered, read-only-except-append-only validator behind `POST /api/admin/content-deliverables/[deliverableId]/reconcile-artifacts`. This run validates the other 6.

## What was actually checked, and how

The validators are deterministic and type-gated (`storage_object_check`, `sha256_check`, `route_check`, `deployment_check` per `artifact_type`, exactly per `publication-reconciliation.ts`). Each of the 6 unvalidated artifacts was checked with the real, live equivalent of what the HTTP route would run:

- **Storage-backed artifacts (2 hero images):** queried `storage.objects` directly for the recorded `storage_bucket`/`storage_path`. Both objects exist (1,188,758 and 1,472,125 bytes respectively). `storage_object_check`: **pass** on both.
- **Route-backed artifacts (2 webpages + 1 form, all pointing at `drglaw.ca`):** live `curl -sL` GET against each recorded `public_url`. All three returned HTTP 200. `route_check`: **pass** on all three.
- **Deployment metadata (the 2 webpages):** both have `repository="drg-law-website"` but `deployment_commit=null`. Per the validator's own logic this is a **fail** (it checks record completeness, not upstream commit existence): `deployment_check`: **fail** on both, reason "no repository/deployment_commit recorded".
- **The PDF:** registered with `public_url`/`repository`/`sha256`/`size_bytes` but no `storage_bucket`/`storage_path` (it lives on `drglaw.ca`, not in Supabase Storage). `storage_object_check` and `sha256_check` both **fail** for that reason. Diagnostic-only (not part of the formal check, since `pdf` artifacts are never route-checked): a direct `curl` confirmed the PDF itself is genuinely live at 200.

9 real `publication_artifact_validations` rows were inserted (append-only, matching the exact schema and insert shape `reconcileDeliverableArtifacts` produces), `validated_by_role='system'` (not `'operator'`, since this ran via direct execution of the validator logic in this session, not through an authenticated operator HTTP session; `'system'` is the schema's own accommodation for exactly this, per `publication_artifact_validations_validated_by_role_check`).

## Result, honestly stated

Every artifact whose live content this system's validators are actually designed to check (storage existence, route reachability) passed clean across the period's 8 artifacts: 3/3 `storage_object_check` results pass (3 hero images), 4/4 `route_check` results pass (3 webpages, 1 form). The remaining checks fail, but not for content-authenticity reasons:

1. **Data-completeness gap, not a content problem (3 `deployment_check` failures across the period, 2 new + 1 pre-existing on a different deliverable).** `deployment_commit` was never populated at registration time for any of this period's webpage artifacts. The content is genuinely live (`route_check` passes); the record is just missing a field an operator could backfill in one edit per artifact.
2. **A structural validator/registration mismatch, not a content problem (the PDF, 2 failures).** This PDF was registered the same way the webpages were (external `drglaw.ca` URL + repository reference), but the `pdf` artifact type's validator set is `[checkStorageObject, checkSha256]` only, both of which assume a Supabase-Storage-hosted file. A PDF hosted on the firm's own site can never pass either check as currently registered, regardless of whether the file is genuinely live (confirmed separately that it is). This is worth flagging as a product gap: either PDFs referencing an external host need a route-based validator path, or PDFs meant to be evidence-checkable need to actually be mirrored into Supabase Storage at registration time.

## What this does not do

No `content_deliverables.status` was touched. No period was activated (`enforced`). No `publication_artifacts` row was created, edited, or superseded; only append-only `publication_artifact_validations` rows were added, exactly as the reconciliation route's own contract promises. This does not make Founder Vesting "ready to publish": readiness also requires the deliverables to move from `in_review` to `approved` (currently none of the 4 are), which is a lawyer's decision, not this session's to make.
