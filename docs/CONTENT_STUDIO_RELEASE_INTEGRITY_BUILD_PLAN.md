---
doc-type: build-plan
scope: content-studio-release-integrity-and-review-efficiency
status: approved
version: v1.1
approved-by: operator (2026-07-12)
supersedes: null
related:
  - docs/audits/CODEX-AUDIT-2026-07-06.md
  - docs/audits/CODEX-CONTENT-STUDIO-FINDINGS-2026-07-06.md
  - docs/CONTENT_STUDIO_FINISH_BUILD_PLAN.md
last-edited: 2026-07-13
---

# Content Studio Release Integrity Build Plan

Operator-approved 2026-07-12. This plan deliberately rejects the broader
"closed-loop authority platform" expansion in favor of making the current
review-and-release workflow structurally trustworthy, then reducing the
lawyer's review burden. Everything here is subordinate to getting DRG's first
five pieces reviewed, approved, published, and indexed.

## Objective

For the next release, Content Studio does five things exceptionally well:

1. Create a deliverable without partial database state.
2. Record every validation result required by the legal gate.
3. Preserve an immutable approval history.
4. Ensure revisions answer the lawyer's actual change request.
5. Make the next review faster by showing exactly what changed.

## Execution mechanics (applies to every item)

- The shared working tree carries a concurrent session's in-progress work.
  Every item ships as its own small commit cherry-applied onto a clean
  `git worktree` off `origin/main`, opened as an isolated PR (the PR #13 /
  PR #15 pattern). Never commit from the dirty shared tree.
- Migrations apply to prod BEFORE the reading code deploys (repo
  deploy-safety pattern). New-column/table reads stay guarded.
- Focused tests for every behavior changed; `tsc --noEmit` clean; the
  pre-existing unrelated failures in `legacy-surface-auth.test.ts` and
  `portal-operator-view.test.ts` (concurrent-session files) are known and
  excluded from acceptance.
- No notifications may reach the firm from any fixture used in live
  verification; fixtures are prefixed `FIXTURE:` and archived after.

## Workstream 1: Release integrity (items 1-6, strict order)

### 1. Fail closed when approval history cannot be loaded

Approval-history query errors in deliverable detail and the release gates
become explicit errors, never a successful response with missing linkage.

Acceptance:
- History query errors produce an error state, not an empty list.
- Export and publish-record remain unavailable in that state.
- The operator sees a recovery message naming what failed.
- Missing history is distinguished from genuinely empty history.
- Tests cover: database error, zero approvals, valid approvals.

### 2. Require change-request linkage on the answering version

Corrected framing: `responds_to_approval_id` lives on `deliverable_versions`.
A new version posted while the deliverable is `changes_requested` must carry
a valid link to the open change-request record; the lawyer's next approval
then covers that version. Enforcement sits at version creation plus a
database-level composite check.

Acceptance:
- The referenced record belongs to the same firm AND same deliverable.
- It is a change-request record (`decision='changes_requested'`), never an
  approval.
- Invalid or absent linkage fails closed whenever linkage is required.
- The lawyer can see which request the revision answers.
- Existing legitimate flows (first version, non-change-request revisions)
  continue working.

### 3. Make validation persistence mandatory

Confirmed false-green: `runAndRecordValidation` currently logs a failed
`recordValidationRun` to console and still returns success, while the legal
gate reads the RECORDED run. A validation is not complete until its durable
record exists.

Acceptance:
- `recordValidationRun` failure fails the whole operation.
- The UI never presents an unrecorded validation as release-ready.
- The legal gate and the immediate validation response reference the same
  stored run.
- Retrying is safe and does not create contradictory records for the same
  version.
- A regression test reproduces the current false-green path and proves it
  closed.

### 4. Enforce append-only approvals in Postgres

Mechanism note: the app accesses Postgres exclusively as service-role, which
bypasses RLS and grants but not triggers. Enforcement is trigger-based.

Acceptance:
- Triggers block UPDATE and DELETE on `approval_records`.
- Reassignment of firm, deliverable, version, or signer on an existing row
  is impossible.
- INSERT through `record_approval_atomic` continues to work.
- The migration ships with database-level tests (SQL assertions run at
  apply time or in the contract-test harness).
- Any administrative exception is explicit, narrow, and auditable.

### 5. Make deliverable creation atomic

The legal-gate advance currently performs createDeliverable, then
addVersion, then the piece update as sequential writes. Collapse into one
RPC (the `record_approval_atomic` precedent).

Acceptance:
- Deliverable, first version, and `content_pieces.deliverable_id` link are
  created together or not at all.
- Duplicate retries are safe (idempotent on the piece).
- Firm and piece ownership are checked inside the transaction.
- No orphan deliverables or versions from intermediate failure.
- Operator-visible behavior is unchanged on the success path.

### 6. Close migration-governance debt

Folds into the existing open lane (Task #12,
`RUNBOOK_20260626_content_studio_apply.md`), not a parallel effort.
Coordination constraint: `operator_preview_log` is DR-084 surface with
concurrent-session files still uncommitted; this item touches ONLY
`supabase/migrations/` and CI config, never their working files.

Acceptance:
- Canonical migrations apply cleanly to an empty database.
- Duplicate consent migrations reconciled safely.
- Stale DRAFT language removed from applied migrations.
- `operator_preview_log` receives RLS enable/force/revoke hardening.
- CI detects ordering, syntax, and reproducibility failures
  (also retires the DR-058 engine-sync CI debt if cheap to include).

## Workstream 2: Review efficiency (after Workstream 1 is stable)

### 7. Changed-claims review view

The highest-leverage reviewer-facing improvement; it attacks the real
bottleneck, which is the lawyer's review time. Storage choice: the diff is
a pure function of two immutable version rows, recomputed on demand. No
schema growth; it can never drift from the versions it describes.

For each revision, show: claims added, claims removed, material wording
changes, which change-request item each change addresses, whether sources
changed, and cosmetic edits separated from substantive edits.

Acceptance:
- The lawyer can review changed claims without rereading the whole piece.
- The complete final rendering stays one click away.
- The comparison uses the exact versions under review.
- The diff is deterministically reproducible from the review record.
- Nothing implies automated classification replaces legal judgment.

### 8. Three-claim taxonomy

Binding rule / market practice / DRG judgment. Implemented through
generation instructions and validation warnings, not an evidence-management
subsystem.

Acceptance:
- Generation prompts explain each category.
- Ambiguous category use is flagged (warn-level).
- Binding-rule claims carry stricter source expectations.
- DRG judgment is presented as professional judgment, attributed.
- The taxonomy surfaces in the changed-claims view where useful.

### 9. Portuguese-native compliance checks

Native-language patterns, not translated English regexes. Builds on the F5
language-neutral additions.

Acceptance:
- `pt_jurisdiction_disclosure` becomes release-blocking (fail-level) for
  public articles.
- Common Portuguese legal-marketing risk phrases covered (timing promises,
  specialist claims, superlatives, outcome promises, fake scarcity).
- PT fixtures include natively written passing and failing examples.
- EN and PT policies remain independently testable.
- A Portuguese reader can understand why a check failed.

## Workstream 3: Brief and entity safeguards (deliberately lightweight)

### 10. Information-gain decision on the brief

Before creating a piece, prompt the operator to choose: Create, Update,
Merge, or Decline. Surface overlapping existing pieces and the current
`no_cannibalization` result at creation time. The system prompts the
editorial decision; it never makes it.

Acceptance:
- The operator records why the piece deserves to exist.
- Potential overlap is visible before generation.
- The decision persists as part of the brief history.

### 11. Entity truth extension

Extend `strategy_json.canonical_nap` (already feeding `validateEntityPresent`
and the JSON-LD), never a second registry. The Day 1 Ownership Matrix
playbook stays the human-facing source; this becomes its machine-readable
representation.

Suggested fields: canonical firm name, address, phones by purpose, primary
domain, lawyer names and titles, official profile URLs, `sameAs` identities,
former affiliations that must not read as current, effective dates,
verification notes.

Acceptance:
- Existing entity and JSON-LD validators read this source.
- Conflicting phones, profiles, employers, or addresses are flagged.
- Changes are versioned and attributable.

## Sequence

| Order | Deliverable | Why now |
|---|---|---|
| 1 | Approval-history fail-closed | Removes silent uncertainty |
| 2 | Required validation persistence | Eliminates a confirmed false green |
| 3 | Database-enforced immutable approvals | Protects the compliance record |
| 4 | Mandatory change-request linkage | Preserves review-chain meaning |
| 5 | Atomic deliverable creation | Removes partial workflow states |
| 6 | Migration CI and cleanup | Prevents structural regressions |
| 7 | Changed-claims review | Reduces the human bottleneck |
| 8 | Claim taxonomy | Sharpens legal review |
| 9 | Portuguese-native validation | Closes a real language gap |
| 10 | Information-gain prompt | Cheap editorial discipline |
| 11 | Entity truth extension | Prevents recurring factual drift |

## Operational learnings incorporated (v1.1)

The first production use of structured suggestions exposed controls that are
not optional implementation detail. They are part of release integrity.

### A. A resolved comment must also be answered

`resolved=true` is not evidence that a lawyer's question was answered. For a
lawyer-authored question, the operator must first post a direct reply in the
same thread, in the language of the question when practical, and only then
resolve the comment. The reply should state what changed and why. A wording
change without a written answer is incomplete.

### B. Comment threads continue across versions

Passage comments are anchored to the version in which they were made, but the
thread must remain discoverable on the current version, like Google Docs. If a
revision removes or changes the quoted passage, render the thread as
unanchored rather than hiding it. Replies inherit the parent thread and must
not become a separate comment merely because the answer is delivered in a new
version. Selecting an older version remains available for historical context.

### C. A correction has a required audit sequence

The normal sequence is: lawyer comment → direct operator reply → suggestion or
tracked wording change → new immutable version → review notification → lawyer
approval. The system must preserve the IDs linking each step. Publication is
never implied by answering a comment.

### D. Version-changing writes include their side effects

Any operation that creates a review version must also create the applied
suggestion event, clear and then stamp `review_notified_at` only after the
notification outbox row is queued, and leave the deliverable in `in_review`.
Emergency SQL writes are permitted only with a compensating checklist that
reproduces these side effects and records the operator, reason, and affected
IDs.

### E. Release verification includes an authenticated portal pass

Remote build success and unauthenticated HTTP checks are necessary but not
sufficient. Before calling a release complete, test as both operator and
lawyer: create a comment, reply to it, switch versions, apply a suggestion,
confirm approval is blocked by open suggestions, and confirm the notification
and audit history. Use reversible, low-risk fixture wording for live checks.

## Explicitly deferred

Do not build until the first five DRG pieces are published and roughly 60-90
days of performance data exist: website publication adapters, production-page
hash verification, Search Console ingestion, AI-answer monitoring,
attribution funnels, format-performance recommendations, automated editorial
calendars, content incident management, multisource question registers, and
any standalone Content Studio product offering.

Reconsideration trigger is evidence: repeated publication volume, measurable
search visibility, recurring maintenance problems, or demand from another
paying firm.

Content Studio's present role: an internal operating advantage that makes
the CaseLoad Select retainer safer, faster, and more defensible. It is not a
second product competing for attention.
