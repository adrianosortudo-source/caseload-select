# Build Plan: Deliverables Change-Request Loop (Reply on Record + Version-as-Answer + Feedback Attachments)

**Version:** v1 (2026-07-09)
**Author:** Operator session (design approved by Adriano 2026-07-09)
**Executor:** Claude Sonnet 5, fresh session, repo root `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app`
**Read first:** this file top to bottom, then `CLAUDE.md` in the repo root (sections: Content approval (Phase 2), Database Access Invariant, Developer Gotchas + Deploy-Safety, Email Branding & Delivery).

---

## 1. Problem

The content approval system (tables `content_deliverables`, `deliverable_versions`, `deliverable_comments`, `approval_records`; UI at `/portal/[firmId]/deliverables/[id]`) closes the loop in one direction only. Field case, 2026-07-09: Damaris Guimaraes recorded CHANGES REQUESTED on the "[DECISION TOOL] Closing Clarity Map" deliverable with a substantive note. Three gaps surfaced:

1. **No on-record reply.** The operator cannot respond to a change request inside the portal. `approval_records` is append-only and one-directional; comments anchor to article passages, not to the approval record.
2. **No structural link between a change request and the version that answers it.** When the operator posts a corrected version, nothing ties it back to the request, so the approval record card reads as a dead end and the version picker gives no state.
3. **No attachments on the change request.** Damaris wrote, verbatim: "Como nao posso mandar print aqui, vou mandar no wtsp." Evidence leaks to WhatsApp and the LSO Rule 4.2-1 compliance record is incomplete.

This plan builds three work packages: **A** (reply threads on approval records), **B** (version-as-answer), **C** (attachments on change requests and replies), plus a shared migration, tests, and prod verification.

## 2. Ground rules and stop-lines (read before any code)

1. **Additive migration to prod FIRST, then code.** Every new column read is guarded (missing column or null value renders the surface unchanged). Follow the repo's deploy-safety pattern (CLAUDE.md, "Developer Gotchas + Deploy-Safety").
2. **`approval_records` stays append-only.** Never UPDATE an existing row. New data on it lands at INSERT time only (the attachments column, WP-C).
3. **No notification may reach any `drglaw.ca` address during build or testing.** All smoke testing runs on a fixture firm whose `firm_lawyers.email` rows are ALL operator-owned addresses (verify with a SELECT before the first test action). After every test mutation, check `notification_outbox` for queued rows and delete any that target a non-operator recipient BEFORE the 5-minute digest cron drains them. Do not post a version, comment, or approval on the DRG firm (`intake_firms` id `eec1d25e-...`).
4. **Do not post the real v2 of the Closing Clarity Map.** That is an operator action after this ships.
5. **Do not touch** `src/lib/screen-engine/`, the `(marketing)` route group, or anything in the Content Studio gate logic beyond what this plan names.
6. **Do not mint or reference any DR number.** A decision record will be registered separately by the operator. The `.claude/hooks/check-dr-registry.mjs` hook blocks unregistered DR references anyway.
7. **Copy rules are enforced by hooks:** no em dashes anywhere (including TS comments), no banned AI vocabulary, no italics in UI copy, no orphan words in rendered text blocks.
8. **`server-only` gotcha:** pure helpers that vitest loads (directly or transitively through a tested route) must not `import "server-only"`. Follow the existing split (`deliverables.ts` I/O vs `deliverables-pure.ts` pure).
9. **Deploy = commit + push.** The caseload-select app has GitHub git integration on Vercel; CLI-only deploys get silently reverted on the next push. Confirm the Vercel deployment reaches READY after pushing.
10. **Full gates before done:** `npm run lint`, `npx tsc --noEmit`, full vitest suite green.

## 3. Key files

| File | Role in this build |
|---|---|
| `supabase/migrations/20260623_content_approval.sql` | Reference only: current schema of the four tables |
| `supabase/migrations/20260623_approval_rpc_atomic.sql` | Reference: current `record_approval_atomic` definition, replaced in WP-0 |
| `src/lib/deliverables.ts` | I/O wrapper: `listDeliverables`, `getDeliverableDetail`, `addVersion`, `addComment`, `recordApproval`, `uploadDeliverableAsset`, `enqueueDeliverableNotification` |
| `src/lib/deliverables-pure.ts` | Pure validators, status machine, attestation copy |
| `src/lib/deliverables-auth.ts` | Actor resolution (operator vs lawyer vs client-reject) |
| `src/lib/types.ts` | `ContentDeliverable`, `DeliverableVersion`, `DeliverableComment`, `ApprovalRecord`, `DeliverableAnnotation` |
| `src/app/api/portal/[firmId]/deliverables/[deliverableId]/versions/route.ts` | New-version endpoint (JSON + multipart branches) |
| `src/app/api/portal/[firmId]/deliverables/[deliverableId]/comments/route.ts` | Comment endpoint |
| `src/app/api/portal/[firmId]/deliverables/[deliverableId]/approve/route.ts` | Sign-off endpoint (lawyer only) |
| `src/components/portal/DeliverableReview.tsx` | The whole review client: `VersionSelector`, `VersionComposer`, `SignOffPanel`, `ApprovalHistory` |
| `src/components/portal/DeliverableList.tsx` | List page (open-comment badge) |
| `src/app/api/portal/[firmId]/matters/[matterId]/messages/upload/route.ts` | Pattern reference for the attachment upload route (25 MB cap, mime allow-list) |
| `src/lib/matter-messages.ts` | Pattern reference: `signAttachments()` (1h TTL signing at list time) |

Before coding, read `getDeliverableDetail`, `addVersion`, `addComment`, `recordApproval` in full, plus the three routes and the four components named above. Match their conventions exactly (result-object returns `{ ok: true } | { ok: false; error }`, actor plumbing, sanitisation, notification enqueue style).

## 4. WP-0: Migration (one file, additive, applied to prod before any code deploys)

Create `supabase/migrations/20260709_deliverable_change_request_loop.sql`:

```sql
-- Change-request loop: reply threads, version-as-answer, feedback attachments.
-- Additive only. approval_records remains append-only (attachments are set at
-- INSERT time by the replaced RPC, never by UPDATE).

ALTER TABLE deliverable_comments
  ADD COLUMN IF NOT EXISTS approval_record_id uuid
    REFERENCES approval_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deliverable_comments_approval
  ON deliverable_comments(approval_record_id, created_at)
  WHERE approval_record_id IS NOT NULL;

ALTER TABLE deliverable_comments
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE deliverable_versions
  ADD COLUMN IF NOT EXISTS responds_to_approval_id uuid
    REFERENCES approval_records(id) ON DELETE SET NULL;

ALTER TABLE approval_records
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Then, in the same file, `CREATE OR REPLACE` the `record_approval_atomic` function. Copy the existing definition from `20260623_approval_rpc_atomic.sql` verbatim and make exactly two changes: add a trailing parameter `p_attachments jsonb DEFAULT '[]'::jsonb`, and include `attachments` in the INSERT column list with `COALESCE(p_attachments, '[]'::jsonb)`. Keep SECURITY DEFINER, the SELECT FOR UPDATE, the version-drift check, and the return shape byte-for-byte otherwise. The default keeps the old call signature valid, so the deployed app continues to work between migration apply and code deploy.

No new tables, so no new RLS work; the columns inherit the existing forced-RLS, service-role-only posture. Verify after apply: `SELECT column_name FROM information_schema.columns WHERE table_name IN ('deliverable_comments','deliverable_versions','approval_records');`

Apply to prod (project `ssxryjxifwiivghglqer`) via `supabase db push` or the Supabase MCP `apply_migration`, and confirm the four columns plus the replaced function exist before starting WP-A code.

## 5. WP-A: Reply thread on a change request

**Model.** A reply is a `deliverable_comments` row with `approval_record_id` set. Because `version_id` is NOT NULL on that table, anchor the reply to the approval record's own `version_id` (natural: the reply is about that reviewed version). `annotation` stays null. Threading depth is one level under the record (no reply-to-reply; ignore `parent_comment_id` for these).

**Types (`src/lib/types.ts`).**
- `DeliverableComment` gains `approval_record_id: string | null` and `attachments: DeliverableAttachment[]`.
- New `DeliverableAttachment` type `{ storage_path: string; signed_url?: string; name: string; size?: number; mime?: string }` (same shape as `MatterAttachment`; define it in types.ts next to the deliverable types rather than importing the matter one).
- `ApprovalRecord` gains `attachments: DeliverableAttachment[]` (WP-C uses it).
- `DeliverableVersion` gains `responds_to_approval_id: string | null` (WP-B uses it).

**`src/lib/deliverables.ts`.**
- `addComment` gains optional `approvalRecordId?: string | null` and `attachments?: DeliverableAttachment[]` inputs; insert both (attachments stripped of `signed_url` before insert). When `approvalRecordId` is set, prefix the notification `bodyPreview` with `Reply to change request: `.
- `listDeliverables` open-comment count: exclude approval-anchored rows so replies never inflate the "open comments" badge. Add `.is("approval_record_id", null)` to the grouped comments read. Guarded-read note: this filter is safe pre-migration only if the code deploys after the column exists, which the deploy order guarantees.
- `getDeliverableDetail`: sign attachment paths on comments and approvals before returning (new small helper mirroring `signVersionAssets`, 1h TTL, `firm-files` bucket).

**Comments route (`.../comments/route.ts`).**
- Accept optional `approval_record_id` and `attachments` in the body.
- Validate: the approval record exists, belongs to this deliverable and firm (one SELECT); reject otherwise with 400. When `approval_record_id` is present, force `version_id` to the record's `version_id` server-side (do not trust the client) and force `annotation` to null.
- Validate attachments (shared pure helper, see WP-C): max 5, each `storage_path` must start with `deliverables/{firmId}/{deliverableId}/feedback/`, name capped at 200 chars.

**UI (`DeliverableReview.tsx`, `ApprovalHistory`).** Rework `ApprovalHistory` into a threaded panel:
- Each approval record renders as today (decision label, vN, signer, timestamp, note). CHANGES REQUESTED notes render as the quoted head of a thread.
- Replies: comments with `approval_record_id === record.id`, chronological, indented under the record, showing author name or role label, body, timestamp, attachment chips (signed links).
- A "Reply" button per changes-requested record (visible to operator AND lawyer; both sides may need the channel) opens a one-textarea composer with a file picker (picker wiring lands in WP-C; ship the textarea in WP-A) and a "Post reply" submit that calls the comments endpoint with `approval_record_id`.
- `ApprovalHistory` will need `comments`, `firmId`, `deliverableId`, and a `refetch` callback as new props; thread the data from the parent, which already holds all comments.
- Exclude approval-anchored comments everywhere else they could leak: the passage-margin comment rail and any per-version comment filter must skip rows with `approval_record_id` set.

## 6. WP-B: Version-as-answer

**`src/lib/deliverables.ts` `addVersion`.** New optional input `respondsToApprovalId?: string | null`; write it to the new column. Everything else (status flip to `in_review`, approval-pointer clear, notification enqueue) is already correct and unchanged.

**Versions route (`.../versions/route.ts`).** Accept `responds_to_approval_id` in the JSON branch and a `responds_to_approval_id` field in the multipart branch. Validate it belongs to this deliverable, is a `changes_requested` decision, and pass through. Additionally, server-side default: if the deliverable's current status is `changes_requested` and the client sent nothing, resolve the LATEST changes-requested approval record for the deliverable and link it automatically. The loop closes even if an older client UI posts.

**UI, `VersionComposer`.** New props: the deliverable status and the latest changes-requested `ApprovalRecord` (or null). When present:
- Render a quoted context block above the form: label `RESPONDING TO CHANGES REQUESTED`, then `{signer_name}, v{version_number}, {date}`, then the record's note (truncate past 400 chars with an expand toggle).
- Relabel the note field from its current label to `What changed in this version` with placeholder `Answer the request point by point. This note goes to the reviewer with the re-review notification.`
- Submit passes `responds_to_approval_id`.

**UI, `ApprovalHistory` resolution line.** For each changes-requested record, look for a version with `responds_to_approval_id === record.id` (pass `versions` down as a prop). When found, render a resolution line under the thread:
- If that version is still the current one and status is `in_review`: `Addressed in v{n}, posted {date}. Awaiting re-review.`
- If the deliverable has since been approved: `Addressed in v{n}. Approved {date}.`
- The `v{n}` is a button that switches the selected version (same mechanism as the existing version-mismatch banner's "Switch to current").

**UI, `VersionSelector` labels.** Options carry state, not just numbers. Build labels from data already on the page:
- Current version: `v{n} (current, awaiting review)` when status is `in_review`; `v{n} (current, approved {date})` when approved; `v{n} (current, changes requested {date})` when a changes-requested record targets it and no newer version exists.
- Older versions: `v{n} (changes requested {date})` when a changes-requested record targets them, `v{n} (approved {date})` when an approval record does, plain `v{n}` otherwise.
- Compute in a small pure helper `versionOptionLabel(version, deliverable, approvals)` in `deliverables-pure.ts` so it is unit-testable. Dates via the existing `formatTimestamp` util at the call site (keep the pure helper free of I/O; it can take a preformatted date string or return a shape the component formats).

## 7. WP-C: Attachments on change requests and replies

**Upload route.** New `POST /api/portal/[firmId]/deliverables/[deliverableId]/attachments/route.ts`, modeled directly on the matter-messages upload route: operator or lawyer session (reuse the actor resolution in `deliverables-auth.ts`; reject clients), multipart single file, 25 MB cap, mime allow-list `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`. Store via the storage API under `deliverables/{firmId}/{deliverableId}/feedback/{uuid}-{safeName}` in `firm-files` (extend or parallel `uploadDeliverableAsset`; a `prefix` parameter on the existing helper is fine). Return `{ storage_path, name, size, mime }`. No `firm_files` rows (stays out of the Files hub, matching the existing deliverables-asset convention).

**Shared pure validator.** `validateDeliverableAttachments(attachments, firmId, deliverableId)` in `deliverables-pure.ts`: array max 5, each entry has the prefix-checked `storage_path`, non-empty `name` capped at 200 chars, optional numeric `size`, optional string `mime`. Used by the comments route (WP-A) and the approve route (below).

**Sign-off form (`SignOffPanel`, changes-requested branch).** When the lawyer selects "Request changes," alongside the existing note textarea render a file picker with helper text `Attach a screenshot if it helps explain the change (PNG, JPG, or PDF, up to 25 MB).` Files upload immediately on selection via the new route; uploaded files render as removable chips; submit includes the attachments array.

**Approve route + `recordApproval`.** The route accepts optional `attachments`, validates with the pure helper, passes to `recordApproval`, which forwards `p_attachments` to the RPC. The record is born with its evidence; no post-insert UPDATE.

**Reply composer (WP-A) picker.** Same route, same chips, attachments included in the comment POST.

**Rendering.** Attachment chips on approval records and replies in `ApprovalHistory`: filename, opens the signed URL in a new tab. Signed at read in `getDeliverableDetail` (WP-A helper).

**Notification touch.** When a changes-requested record carries attachments, append ` ({n} attachment{s})` to the existing operator-bound `bodyPreview` in `recordApproval`.

## 8. WP-T: Tests

Follow existing patterns in `src/lib/__tests__/` (see `record-approval-atomic.test.ts` for the RPC-mock style). New coverage, minimum:

1. `deliverables-pure`: `validateDeliverableAttachments` (happy path, over-count, wrong prefix, long name, empty name) and `versionOptionLabel` (current+in_review, current+approved, old+changes_requested, old+approved, plain).
2. Comments route: approval-anchored reply forces the record's `version_id` and null annotation; rejects an `approval_record_id` from another deliverable; rejects invalid attachments.
3. Versions route: `responds_to_approval_id` passthrough (JSON and multipart); server-side auto-link when status is `changes_requested` and the client omits it; rejects a record id from another deliverable.
4. Approve route: attachments validated and forwarded; RPC called with `p_attachments`.
5. `listDeliverables`: open-comment count excludes approval-anchored rows (mock the grouped read).
6. Upload route: mime rejection, size rejection, path shape.

Gates: `npm run lint`, `npx tsc --noEmit`, full `npx vitest run` green. Baseline suite is ~4,750 tests; zero regressions.

## 9. WP-D: Deploy and prod verification

Order is load-bearing:

1. Apply WP-0 migration to prod. Verify columns + replaced function (section 4 query).
2. Commit (conventional message, e.g. `feat: deliverables change-request loop (reply on record, version-as-answer, feedback attachments)`), push, confirm Vercel deployment READY.
3. Prod smoke test on the fixture firm only (stop-line 3). Session technique: mint an operator cookie from `PORTAL_SECRET` (documented in the operator memory `reference_prod_smoke_test_technique`). Script:
   a. Create a throwaway deliverable titled `FIXTURE: change-request loop smoke` on the fixture firm, post v1.
   b. As the fixture lawyer (or via direct insert through the approve route with the fixture lawyer session), record CHANGES REQUESTED with a note and one PNG attachment. Verify: `approval_records.attachments` populated, chip renders, signed URL opens.
   c. Post an operator reply on the record. Verify it renders threaded under the record, not in the passage margin, and `open_comments` on the list page stays unchanged.
   d. Post v2 through the composer. Verify: the quoted context block appeared, the version links back (`responds_to_approval_id` set), status flipped to IN REVIEW, the approval record shows `Addressed in v2 ... Awaiting re-review.`, the version picker shows both labeled options.
   e. Check `notification_outbox`: every row from steps a-d targets operator-owned addresses only.
   f. Archive the fixture deliverable and delete any leftover outbox rows from the test.
4. Report: what shipped, commit hash, deployment id, smoke evidence, any deviations.

## 10. Acceptance criteria

- A lawyer's CHANGES REQUESTED can carry image/PDF evidence, frozen into the append-only record at insert.
- The operator (and the lawyer) can reply on the record; replies are on-record comments, threaded under the request, notified through the existing digest, and invisible to the passage margin and the open-comments badge.
- Posting a corrected version from a `changes_requested` state links it to the request automatically, tells the reviewer what changed, flips status to IN REVIEW, and the record card plus version picker both read the true state instead of a dead end.
- `approval_records` never receives an UPDATE. All four tables remain service-role only.
- No notification reached any non-operator address during the build. DRG data untouched.
- Lint, typecheck, full suite green; migration applied to prod before the code deploy.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-09 | This build plan | After the loop ships, the real v2 of "[DECISION TOOL] Closing Clarity Map" must be posted for DRG with a point-by-point response to Damaris's 2026-07-09 change request (disbursements ~1500 note, 1299 purchase fee scope, mortgage fee 399-599 by lender, page formatting issue) | H | /portal/eec1d25e-.../deliverables | Operator posts v2 via the new composer once deployed | Adriano | Open |
| 2026-07-09 | This build plan | Damaris's WhatsApp screenshot of the formatting problem exists only in WhatsApp; once attachments ship, it should be re-attached to the record thread so the compliance trail is complete | M | approval_records / deliverable_comments | Attach the print to a reply on the v1 change request | Adriano | Open |
| 2026-07-09 | This build plan | A DR should be registered for the change-request loop doctrine (threaded replies, version-as-answer, attachments at insert on the append-only record) | M | 00_System/01_Doctrine/DECISION_RECORDS.md | Register next free DR number, then reference from the app CLAUDE.md | Adriano | Open |
