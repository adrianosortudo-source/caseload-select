# Luna handoff: finish CaseLoad Select Admin

Last reconciled: 2026-10-16 05:17:36 UTC
Owner: Luna, existing task `01a136c5-6012-7c40-bfa3-f50165951cb2`
Persistent Goal: already ACTIVE; keep that Goal as the single project Goal. Do not create a duplicate, pause it, or mark it complete at a milestone.
Worktree: `D:\00_Work\01_CaseLoad_Select\.worktrees\admin-oidc-comparison-20261013`
Branch: `codex/admin-final-completion-20261015`
Current reviewed code head: `fdcb29f47da0c3b67099ab39a9c0ab8915bce6ed`
Open task PR: [#406](https://github.com/adrianosortudo-source/caseload-select/pull/406)

## Outcome

Finish the authorized CaseLoad Select Admin research-enrichment project and prove every A1–A7 acceptance predicate with current, traceable evidence. A passing test, green CI, open or merged PR, READY deployment, migration, partial import, pilot, or completed subtask is only a checkpoint. Continue to the next eligible action after each checkpoint. The project is complete only when the final independent audit finds every A1–A7 predicate PASS with an evidence path and SHA-256, all authorized writes and reads are reconciled, all findings are resolved, and repository changes are pushed with a clean or explicitly preserved worktree.

The controlling detailed contract remains `D:\00_Work\01_CaseLoad_Select\07_Prospects\Admin_Enrichment_Completion_20260927\LUNA_COMPLETION_GOAL_20261015.txt`, its `LUNA_EXECUTION_PLAN_20261015.md`, and `LUNA_EXECUTION_CONTINUATION_20261016.md`. This file pins the current resumption order and current holds; it does not replace those acceptance definitions.

## Non-negotiable gates

1. **Current coordination hold:** The CRM owner has not yet confirmed that local verification is finished and coordinated a safe resume. Until that exact confirmation is recorded, do only remote, read-only PR/status/checkpoint work. Do not start heavyweight local tests, browser walks, database walks, production credentials, database changes, merges, or deployments. The current explicit no-merge/deploy hold remains in force until separately lifted. Do not infer that one hold lifts another.
2. **Migrator credential deferral:** Adriano answered “Leave it unchanged” about `CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_TOKEN`. Do not read, test, replace, configure, retry, or dispatch any workflow using it. Do not ask him to repeat this answer. T06 is WAITING_EXTERNAL; T07 is WAITING_DEPENDENCY. If the deferral is explicitly lifted later, still use separate protected preflight and apply gates for each exact migration.
3. **Casey & Moss recovery:** one-use recovery attempt 6 is spent. Never recover, retry, replay, reset, or resubmit it. Only the already authorized read-only content verification may continue after the coordination hold is lifted.
4. **Provider and source controls:** Preserve authentication, authorization, exact source/hash binding, review requirements, qualification decisions, lineage, warnings, and business holds. Never fabricate evidence, guess identities, change a frozen source to force a match, disable checks, bypass a provider gate, or use direct production deploy commands. Any new data-write scope needs exact current authorization and its protected review.
5. **No-stall rule:** After every action, inspect the result, save a sanitized receipt, hash it, append the event, update the state and acceptance records, then take the lowest-numbered READY action below. If blocked, record the exact missing actor/action and immediately do the next independent READY item. Do not ask whether to continue, repeat a passing action without changed input, or end at a milestone. If no authorized action is READY, leave the Goal ACTIVE and preserve the exact external gate; obey explicit pauses and the 23:00–07:00 Toronto work window.

## Fixed execution order

### 0. Reconcile the task before each resumption

Use only the worktree above. Read its `AGENTS.md`; refresh branch, HEAD, GitHub PR #406 state and base, exact-head checks, reviews/threads, and current deployment/read-back facts. Read the latest `execution-state.json`, `acceptance.json`, `FINAL_STATUS.md`, and last 50 lines of `execution-events.jsonl` from the completion evidence directory. Hash source inputs before relying on prior receipts. Keep the persistent Goal ACTIVE. Record the actual current time and confirm whether the coordination and no-merge/deploy holds have been explicitly lifted. Do not use this handoff’s timestamps as live facts.

### 1. Finish the current PR #406 remote review lane

As last checked, PR #406 is open and mergeable at `fdcb29f47da0c3b67099ab39a9c0ab8915bce6ed`; all 12 required checks and both Vercel preview checks passed, the rendered evidence artifact is uploaded, and the branch is current with `main`. No independent review or review thread was recorded. Refresh all of that against the exact current PR head.

Obtain the required independent review through the repository’s supported review process. Do not represent self-review as independent. If review finds a defect, fix only the scoped prospect-reader issue, update the PR, push the commit, rerun required checks on the exact new head, and obtain another independent review. The CRM-owner coordination hold blocks heavyweight local tests until coordination occurs. Do not merge or deploy while the explicit no-merge/deploy hold remains active. Once that hold is explicitly lifted, merge only after the final diff is in scope, the branch is current, all required checks/reviews pass and all threads are resolved. Use the PR merge path only; immediately verify GitHub’s automatic deployment and production commit/read-back. Never direct-deploy.

### 2. Resume T08 read-only Admin acceptance when coordinated

Do not access the browser or database before the CRM owner confirms local verification is complete and coordinates the resume. After confirmation, use the existing authenticated operator Admin session and read-only controls only.

1. Capture the current Admin URL, accessibility/UI state, coverage revision, count, warnings, active filters, and exact request/response evidence. Save a receipt before changing filters.
2. If the failed exact identity filter is still set, clear it once, capture the result, then make one global-text control search for literal `englobelaw.com`. Save result IDs, revision and warnings. If it returns the same timeout/SQLSTATE 57014, stop retrying that endpoint and follow the reader-repair path in step 1; do not call the failure a pass.
3. After any approved reader repair is deployed, rerun the frozen T04 search/filter matrix once per query. Reconcile all cursor pages and IDs to frozen A4 index SHA `5d6c27fec3f99a580e1e0c97c38d0b9a0ffbf0434fb9c0e1f44c1c48903b5535` and the 896-row frozen cohort. Keep the observed 10,740-candidate inventory at coverage revision 62732 separate; preserve visible coverage warnings and do not claim complete coverage while unexplained gaps remain. Tests dependent on an unapplied migration stay WAITING.
4. Inspect only the frozen candidate/revision pairs and exact source pointers specified by the controlling execution plan. For each, capture list, detail, history, warnings and all bounded original-content chunks; reassemble the prescribed bytes and verify the correct hash domain and source pointer. Do not substitute candidates.
5. For Casey & Moss, read only candidate `3cf30483-e790-4f3f-afc4-2adb592fc90a`, revision `5075a522-14d6-4661-bd51-df41093f8102`, coverage 62732 and its 33 approved chunks. Directly extract/hash the raw original text against `ca64b3658fb51870687279e703c5ad89485eca6684f90bfe415a44f52cbfc48a` and establish the exact frozen-source pointer crosswalk. Existing values `c234…`, `593b…` and `5419…` are different hash domains and do not satisfy that raw-text check. Current frozen pointers 140, 141 and 819 do not match Admin pointer 30; resolve from exact source evidence or leave this row WAITING. Do not touch recovery attempt 6.
6. Verify the preserved Baker & Company assessment/linkage and Adil’s existing six-service pilot using their exact IDs, source receipts, values, history and server replay. Create no new pilot and make no write.
7. Prove unauthorized-role denial only in the supported isolated test harness; never attempt a forbidden live write. Save row-level receipts, update the exact acceptance rows, and continue to the next READY task.

### 3. Keep T06/T07 in their fixed gate order

While the token deferral remains, perform only token-independent static/source checks and permitted read-only ledger checks. Do not inspect or alter the credential, dispatch a workflow, apply SQL, or repeat a credential request. If and only if Adriano explicitly lifts that exact deferral, do T06 first for `20261013214000_prospect_bounded_original_evidence_v2.sql`: bind the current source and exact receipt; run the protected read-only preflight; verify it proves the sole exact target; obtain the separately required protected apply approval; apply once; and read back ledger, function ownership, ACLs, search path and history. Stop that lane on 401/403 or uncertainty. Only after T06 read-back passes, repeat the separate exact-source preflight/apply/read-back sequence for T07 `20261014153626_prospect_candidate_global_field_filter_fastpath.sql`. Do not combine the migrations.

### 4. Finish T01/T05 reconciliation, then T09 delivery

Refresh T01 source inventories and all T05 input hashes. As last verified, T05 has 34 exact original package bodies and 19 missing held-evidence bodies. Preserve that distinction and revalidate every item against its current run, manifest, source, authorization, attempt state and destination. Use fresh signed comparisons just in time and the approved uploader for package-bearing comparisons; the OIDC identity remains restricted to its approved empty-package bootstrap/resume comparison. Run the unchanged dry-run first, process serially, and verify destination read-back before considering an item complete. Keep the 19 missing held bodies WAITING_EXTERNAL. Do not reuse expired signatures, exceed attempts, or retry an uncertain write before checking destination state. Any current production-write/credential hold blocks the write; continue read-only reconciliation and exact packet preparation meanwhile.

### 5. T10 complete the authorized backlog

Start only when T05, T08, current exact scope authorization and protected intake prerequisites pass. Process current-derived children 1–28 in ascending order, then historical children 1–18 in ascending order. Skip an item only when its exact accepted state and destination body are read back. Serialize writes per firm; preserve all identity, evidence, qualification and policy holds. Checkpoint every 20 successful items and immediately continue. Reconcile revisions, bodies, idempotency keys, canonical firms, events, warnings, hashes and receipts separately. Diagnose the saved Child 5 `whole_firm_manifest_revision_coverage_mismatch` using its frozen source/compilation binding; never change source chunks or spend another retry to force it through.

### 6. T11 prove repeatable data-only operation

After T10, select exactly the next two already-completed producer deltas by completion time, then work-key order. At least one must contain a genuine new or corrected sourced fact for an existing firm. Do not fabricate producer runs or facts and do not start unrelated research. Process both as data-only runs through comparison, exact authorization, intake/review, evidence retention, Admin/search read-back and identical duplicate-safe replay, with no code deployment between the two. Freeze and drain the real final high-water mark. If qualifying deltas do not exist, record the precise missing upstream artifact/actor, leave A6 WAITING_EXTERNAL, and continue any other READY task.

### 7. T12 audit and close only on evidence

Obtain an independent read-only audit of A1–A6. Resolve each finding at its owning task and rerun only the affected proof. Verify A1 source/cohort/lineage accounting; A2 actual schema plus authenticated list/filter/detail/history/full-content reads; A3 an existing-firm update, preserved history and duplicate-safe replay; A4 all frozen candidate categories and ten-case acceptance; A5 full historical/current-derived delivery and gap reconciliation; A6 two genuine data-only runs and high-water drain; and A7 the independent audit and reproducible final receipt.

For each predicate require status PASS, exact evidence path and SHA-256, and current read-back where applicable. Reconcile all code commits to `origin`, verify the worktree is clean or explicitly preserved, and append the final event/status. Only then mark the existing persistent Goal complete. If any predicate is failed, waiting, stale, unreviewed or unexplained, keep it ACTIVE and take the lowest-numbered READY action.

## Checkpoint fields after every action

Record real UTC time; T-task and A-predicate; action; input identifiers and hashes; sanitized outcome; evidence path and SHA-256; production-write count; current hold(s); task status; and exact next action. Append to `execution-events.jsonl`; update `execution-state.json`, `acceptance.json` and `FINAL_STATUS.md` without deleting history. Never put secret contents, session cookies or private credentials in receipts.

## Exact state at handoff

- PR #406: open; exact head `fdcb29f47da0c3b67099ab39a9c0ab8915bce6ed`; 12 checks and both preview checks green at last verification; independent review missing; not merged.
- Immediate remote action: refresh PR state, then obtain independent review. Current CRM-owner coordination hold prevents heavyweight local tests/browser/database work; current no-merge/deploy hold prevents merge and deployment.
- T08: Casey & Moss raw-text hash and frozen pointer crosswalk remain pending. The previous full-chunk response hash does not prove the required raw-text hash. Authenticated Admin evidence also has visible coverage warnings.
- T06: WAITING_EXTERNAL under the explicit migrator-token deferral. T07: WAITING_DEPENDENCY.
- T09: 34 exact original package bodies are candidates for revalidated authorized processing; 19 missing held-evidence bodies remain WAITING_EXTERNAL. Current authorization and operational holds must be rechecked before any write.
- T10–T12 and A1–A7 final acceptance: incomplete. Existing Goal must remain ACTIVE.
