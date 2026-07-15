# Historical reconciliation ledger, DRG Law Professional Corporation

Workstream 9 of the Content Studio publication-readiness and publishing-evidence mega-assignment. Firm: `eec1d25e-a047-4827-8e4a-6eb96becca2b`.

## Scope and honesty statement

This ledger covers every one of DRG's 8 content periods that exist in Content Studio as of 2026-07-15. It does not make historical backfill a prerequisite for publishing future content: the 5 periods classified `setup_required` below are current, future, or stalled work, never "already-published legacy content," and none of them needs reconciliation before their own future activation. Only the 3 periods classified `legacy_unreconciled` are in scope for historical reconciliation, and none of the 3 is complete. This ledger states plainly, per period, exactly what evidence was verified, what remains unverified, and why, rather than marking the system complete when external records (LinkedIn, Google Business Profile, a pending lawyer approval, a pending third-party website deploy) remain outside this session's reach.

## Per-period status

| Period | Lifecycle | Deliverables | Verified (webpage/PDF, live HTTP check) | Missing (confirmed absent) | Inaccessible with current permissions | Pending legal approval | Reconciliation status |
|---|---|---|---|---|---|---|---|
| Already published, retroactive review | `legacy_unreconciled` | 5 | 5 | 0 | 0 | 0 | Dry-run assessment complete; artifact registration not started |
| Decision tools | `legacy_unreconciled` | 3 | 3 | 0 | 0 | 0 | Dry-run assessment complete; artifact registration not started |
| The relocation clause | `legacy_unreconciled` | 13 active (1 excluded/archived) | 4 (2 webpage, 1 PDF, 1 landing page partial) | 4 (all confirmed 404 deploy gaps or never-authored PT content) | 5 (3 GBP, 2 LinkedIn) | 1 (PT companion article) | Dry-run assessment complete; artifact registration not started |
| The renewal clause | `setup_required` | 13 (all in_review) | n/a | n/a | n/a | n/a | Not in scope: stalled backlog, not legacy content |
| Equal shares, unequal control | `setup_required` | 13 (all in_review) | n/a | n/a | n/a | n/a | Not in scope: stalled backlog, not legacy content |
| Founder vesting | `setup_required` | 13 (all in_review) | n/a | n/a | n/a | n/a | Not in scope: current publishing week |
| Power of attorney in Ontario | `setup_required` | 13 (all in_review) | n/a | n/a | n/a | n/a | Not in scope: future week |
| Shareholder agreement clauses | `setup_required` | 13 (all in_review) | n/a | n/a | n/a | n/a | Not in scope: future week |

Totals across the 3 in-scope periods: 21 active deliverables, 12 confirmed `verified_and_bindable` (webpage/PDF evidence, live-checked 2026-07-15), 4 confirmed `missing` (all traced to a specific, named, pre-existing cause, either a `drg-law-website` deploy gap or content that was never authored in any language), 5 `inaccessible_with_current_permissions` (LinkedIn/GBP, this session has no account access to either platform), 1 `pending_legal_approval` (a specific deliverable, `b767ef14`, genuinely awaiting Damaris's review, untouched by any migration in this branch).

Full per-deliverable detail: `docs/reconciliation/already-published-retroactive-review-dry-run-manifest-2026-07-15.md`, `docs/reconciliation/decision-tools-dry-run-manifest-2026-07-15.md`, `docs/reconciliation/relocation-clause-dry-run-manifest-2026-07-15.md`.

## What was never invented

- No `publication_artifacts` row was created for any deliverable in any period. The verified-live HTTP checks above are dry-run evidence assessments, not artifact registrations; registering an artifact is a distinct, later, operator-performed step (per `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`) this session did not take.
- No URL, slug, or route was guessed for content that has no known destination. Every deliverable classified `missing` in the relocation-clause period was checked against the actual `drg-law-website` source tree, never assumed to exist because a sibling deliverable in the same theme has a live page.
- No approval status was changed. The one `in_review` deliverable found (`b767ef14`) remains `in_review`; no migration or script in this branch touches `content_deliverables.status` or `approval_records` for it.
- No period was activated (`enforced`). All 3 legacy periods remain `legacy_unreconciled`; none of this reconciliation work is a precondition this ledger imposes on the operator activating any of the 5 `setup_required` periods, which is the mega-assignment's explicit instruction (historical backfill is never a prerequisite for publishing future content).

## Genuine remaining blockers, all external to this session

1. **Artifact registration (all 3 in-scope periods, 12 deliverables).** An operator must personally load each verified-live URL or download each verified-live PDF and register it via the manual insert path, then run the deliverable's reconcile-artifacts action. This session verified the evidence exists; it did not, and should not, register it on the operator's behalf, since artifact registration is itself an attestation that a human checked the live result.
2. **`drg-law-website` deploy gap (4 confirmed 404s, all in the relocation-clause period).** `demolition-clause-ontario` (EN article), the relocation-clause checklist PT PDF, and the relocation-clause checklist PT landing page all have complete, authored source in the `drg-law-website` repository that has not been deployed (that project ships via manual `vercel --prod` deploys, no git integration). This is a pre-existing production gap independent of Publication Readiness; flagged as its own operator follow-up.
3. **LinkedIn and Google Business Profile account access (5 deliverables).** This session has no authorized read access to either platform. Whether these 3 GBP cards and 2 LinkedIn posts were ever actually published is unverified; an operator must confirm the live post (screenshot or dashboard link) and register it, matching the standing doctrine that a planned or approved post is never itself evidence of publication.
4. **Lawyer approval (1 deliverable).** The PT "Clause in the Margin" companion article for the demolition clause remains `in_review`. Only Damaris Regina Guimaraes can approve it; no reconciliation action substitutes for that sign-off.
5. **Two content-plan gaps needing an operator decision, not a fix.** (a) The relocation-clause period's PT counsel-note and PT companion articles have no PT page ever authored anywhere in `drg-law-website` source, a structural gap distinct from the deploy-gap items above. (b) The Decision Tools period's three tools have live PT routes on the site, but no PT-locale deliverable row was ever created in Content Studio to track them, the reverse gap: site ahead of the content plan.

## Reconciliation status honestly stated

Historical reconciliation for DRG's 3 legacy periods is genuinely incomplete. This ledger closes the evidence-discovery half (what exists, what does not, and exactly why for every one of the 21 active deliverables in scope) but the artifact-registration, deploy, third-party-account-access, and lawyer-approval steps above are all real, external, human-gated actions this session cannot perform. Marking any of the 3 periods `enforced` before those steps complete would be a false claim.
