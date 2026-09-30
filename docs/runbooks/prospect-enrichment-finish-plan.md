# Finish Admin prospect research enrichment

Current schema-release execution uses [the consolidated release runbook](./prospect-enrichment-complete-release.md): one manual workflow run, one protected read-only preflight job and one dependent protected release job after evidence review. This supersedes the separate dispatch sequence below for the initial eleven-pending migration state only. Existing individual workflows remain recovery tools. The implemented consolidation must pass required tests and actual protected execution before being called complete. CLI-owned artifacts remain under their existing profile-contained output roots; the completion directory records pointers and hashes rather than broadening those filesystem allowlists.

Owner: the existing “Reconcile Luna research in Admin” chat. Executor: Luna in that same chat after model handoff. Date: 2026-09-27. This is the controlling completion plan for this project; older technical runbooks remain implementation references, but their stale release status and repeated conversational approval requests are superseded by current user authorization and AGENTS.md. Provider-enforced protections remain binding.

## 1. Deliverable and fixed decisions

Make research about every examined firm reusable in Admin Prospects, irrespective of campaign qualification. Verified facts enrich the correct existing firm; unresolved identity retains a searchable candidate with its complete evidence and explicit unresolved state. Held, rejected and incomplete candidates remain visible. Sources, observation dates, prior revisions and conflicts remain accessible. Campaign eligibility is independent of research visibility.

Use the implemented enrichment architecture, compiler, durable outbox, protected intake, operator review and reader. Do not replace the system, add another database, redesign the entire Admin UI, or start new prospect research. This project does not own the first-50 target.

The execution order is fixed: activate the required schema; demonstrate a real existing-firm update; demonstrate held/rejected/incomplete visibility; deliver the historical backlog; reconcile the delta; prove subsequent producer updates and duplicate-safe replay. The pilot is a test gate, not a stopping point.

### Live execution checkpoint (2026-09-29)

The earlier read-only check after the timed-out coverage writer is GitHub Actions run `36582680139`. Its verified receipt shows the exact prefix of nine migrations, both candidate migrations pending, no coverage trigger/function installed, and a dry-run containing only those two migrations. The dependent apply job was cancelled before any write approval. Production schema and prospect research data remain unchanged by that attempt. This checkpoint supersedes older references in this plan to runs `36361852842` and `36582374553` as the current pending preflight.

The release defect was the coverage migration's monolithic historical-row scan running inside one 240-second transaction under a 300-second temporary database credential. The current implementation branch replaces that scan with a private, durable UUID-keyset progress table and an automatically draining, max-100-row batch worker. Each batch has a 60-second transaction-local timeout; lost responses are reconciled against persisted status before retry. This branch is not yet released or run in production. Next: complete code and real-Postgres CI, merge through the task-scoped authority in `AGENTS.md`, run the two protected reviews, verify all historical backfill rows and profile-link read-back, then continue A2-A7 without pausing after schema completion.

All new private artifacts belong under `D:\00_Work\01_CaseLoad_Select\07_Prospects\Admin_Enrichment_Completion_20260927`. Read existing frozen evidence where it already lives; do not move, overwrite or duplicate the full archive. Keep raw research, credentials and signed comparisons out of Git. Code remains in the canonical repository's D: Git worktrees.

## 2. Authority and external holds

The user's standing authorization covers task-scoped commits, pushes and merges after final-head checks, including this plan/rules PR. Do not ask for each merge. Complete necessary non-destructive production work through the existing guarded workflows and supported intake under the user's task authorization. Bind every operation to its actual reviewed source SHA, target, hashes and resulting receipts. Do not treat an old approval artifact as approval for changed bytes; generate the new exact execution record referencing the real standing authorization and technical review.

The user's migration-token deferral has been lifted. The protected migration secret is installed and verified in the intended GitHub environment; never expose its value or replace it again without a new failure. Do not reset the shared Postgres password or rotate app runtime keys. Run `36582680139` completed the required read-only reconciliation and confirmed the post-timeout clean state described above. Any subsequent production write requires the current branch merged and the new run's two provider-enforced `Production prospect migrations` reviews; preserve those reviews and inspect the exact artifact before the second review.

Do not make qualification decisions, infer missing facts, guess aliases, delete history, send outreach, create CRM leads, or change unrelated production services. These are exclusions, not reasons to re-ask about routine in-scope implementation.

## 3. Continuous execution and checkpoint contract

Create `execution-state.json`, `execution-events.jsonl`, `acceptance.json`, and `FINAL_STATUS.md` in the private completion directory. Reuse these four files rather than producing repeated summary packages. State includes: plan version; source/main SHA; active operation; completed acceptance IDs; exact remaining action; source cutoff; source/run/package IDs; receipt paths and hashes; per-candidate counts; dependency holds; last error signature; last progress time. Never store credentials.

For every operation: read state; verify dependencies and authorization; execute; verify returned receipt and read-back; checkpoint atomically; immediately select the next ready operation below. A commit, green CI, PR merge, deployment, migration, pilot, batch or report is never a terminal state. Review checkpoints are internal verification work, not requests for conversational permission.

Use at most three workers plus the coordinator: release verification, receipt/identity reconciliation, and browser acceptance. Only the coordinator dispatches production writes and merges. Workers may inspect/review disjoint work and return exact evidence. Never permit concurrent writers to the same firm or migration workflow.

After a transient network failure, allow two bounded retries only for demonstrably idempotent reads or requests with an unchanged idempotency key. On a 401/403 or unchanged deterministic failure, record the cause and execute the next independent action. For an uncertain write, inspect its receipt/ledger first; never blindly replay a migration or import. Fix code defects through the PR loop and resume the failed gate.

Within an active session, continue without asking “shall I continue?” or ending after a milestone. At compaction/model switch, resume from this state without rebuilding inventories. If all remaining operations require one unavailable external prerequisite, report `blocked_external`, name the exact action and preserve the ready-to-resume state. Do not claim continuous background execution from an idle chat. The existing supervisory chat may resume work under its existing authorization; do not create a duplicate monitor.

## 4. Establish the exact completion cohort (A1)

The additive migration writer and its protected access repair are in shared source. The migration-token deferral is lifted and protected secret installation is verified. The post-timeout read-only run `36582680139` succeeded and its exact database receipt is preserved under `D:\00_Work\01_CaseLoad_Select\07_Prospects\Admin_Enrichment_Completion_20260929\RECOVERY_RUN_36582680139`. It confirms prefix nine, both candidate migrations pending, no coverage objects, and the exact two-file dry-run. Continue using that verified evidence as the recovery baseline; do not repeat credential setup or create another full inventory.

Read the frozen 691-key/896-revision packet and its exact existing manifest. It contains 186 evidence-hold envelopes and 710 package-less held bodies. Verify hashes and the existing compiler's full manifest coverage; never equate candidate keys, revisions, packages and firms.

Keep the separate 891-revision run and historical 67-record import distinct. Reconcile their actual source events and receipts; do not concatenate counts or reimport shared events. Use the already prepared 43-key delta and ten-import receipt crosswalk as starting evidence, not proof of current completeness.

At the start of production delivery, freeze one additional delta from the producer's completed, durably checkpointed outputs and record its UTC cutoff. Include every research revision up to that cutoff, with explicit source-level exceptions. Queued but unresearched firms remain inventory with unknown fields. Do not wait for all prospect research to finish. Changes after cutoff are subsequent incremental runs.

Produce one exact delivery inventory: each in-scope revision has one destination disposition (`already_verified`, `deliver_evidence`, `retain_identity_hold`, `retain_schema_hold`, or `source_unavailable`). Domain/name similarity never establishes a firm join. A source-unavailable item remains a blocking coverage exception until its source is recovered or the user explicitly changes scope; do not silently exclude it.

## 5. Restore production readers (A2)

Historical app evidence showed that the main registry and operator access work while enrichment Runs/Packages and candidate coverage fail. The runs reader calls `list_prospect_enrichment_run_summaries_v1`; packages reads `prospect_enrichment_packages` then `prospect_enrichment_runs`. Their definitions are in base migration `20260923161812_prospect_enrichment_v1.sql`. PGRST202/205 do not alone establish physical database absence; schema-cache visibility is a separate possibility. No successful production schema, catalog or migration-ledger read has been completed by the current preflight attempt.

After run `36361852842` receives its required environment approval, use the current pushed workflows and release contracts, not copied commands from an older runbook paragraph. Read workflow_dispatch choices and current CLI help to construct exact inputs; no invented flags. The read-only preflight comes first. Only after it succeeds may the plan claim actual schema, ACL, function-signature or migration-history evidence.

### Current reader repair checkpoint (2026-09-30)

The protected recovery has since verified the complete 33-table coverage backfill (8,716 projected rows), the profile-link migration, and an empty coverage-only dry run in Actions run `36649630031`. The live candidate reader still fails with a PostgreSQL statement timeout, so A2 is not complete. PR #348 is being extended with a source-search-first reader migration plus the historical cutoff regression. Production release must use `.github/workflows/prospect-candidate-reader-repair.yml`: its first protected job is read-only and exports the exact ledger, prerequisite catalog, migration hash and dry-run evidence; the dependent second job requires a new review, rechecks the same dispatch SHA and artifact, applies only the reader migration, then verifies exact stored statements, permissions, indexes and an empty pending plan. Keep the apply job blocked on any mismatch. Afterward prove the authenticated live candidate, run and package readers and existing operator access before continuing A3-A7.

Fixed branches:

1. Objects and ledger exactly match: apply no migration; test the app's actual project/schema configuration, service-role permissions and PostgREST cache. Refresh schema cache through an authorized supported operation only when stale visibility is demonstrated; re-read endpoints.
2. Qualification objects match source but the two qualification ledger versions are missing: use `qualification-preflight`, review its catalog hash, then `qualification-repair` with the exact confirmation/hash. Never run metadata repair merely to hide missing schema.
3. Enrichment objects are absent and the exact reviewed base release is pending: run `dry-run` then `apply` in `prospect-enrichment-migration-gate.yml` against the same reviewed main SHA. Verify exact source/ledger bytes and post-apply pending plan.
4. Base release and prerequisite operator RPC are verified; candidate suffix is pending: use the pinned two-review recovery flow. Its read-only preflight requires the exact prefix nine, both remaining migrations, no coverage catalog/backfill objects, full source coverage and the exact two-file dry-run. The schema migration must only install schema, triggers and durable progress state. Then process legacy source rows in bounded resumable batches until every source table status is complete. A prefix-ten retry must inspect database checkpoints and resume incomplete rows without replaying the migration. Independent backfill read-back, exact ledger/source checks and an empty coverage-only dry-run must pass before the final profile-link migration can run. Never dispatch a production writer before the current read-only artifact and second protected review exist.
5. Any unexpected ledger/catalog mismatch: retain the evidence; prepare a narrow forward-only repair with meaningful migration tests and independent review; push, merge, then repeat preflight. Never edit already-applied SQL or widen the allowlist to conceal drift.

Preserve required reviewer protections and approved target `ssxryjxifwiivghglqer`. Never use a broad unguarded `db push`. After any partial/uncertain apply, read the ledger before attempting another write. Do not revert data by destructive rollback; repair forward.

A2 passes only when authenticated production candidate, run and package lists return valid data (empty is acceptable before delivery), detail/history endpoints work for available records, and existing registry/operator access still works. A deployed PR or successful migration process is insufficient.

## 6. Produce the first concrete live result (A3)

Use Casey & Moss as the first proposed existing-firm update because the saved September 27 receipt and observed Admin profile show a matching stable ID and specific field gaps. That UI match is not sufficient: the profile remained provisional and did not display the database UUID. Obtain an exact current canonical UUID and registered stable-ID/domain match through the authenticated protected comparison, bound to the latest source receipt, before any canonical update. If that proof is absent or conflicting, retain its identity hold and use the lexically first exact-identity, non-conflicting existing firm from the prepared 19-match set; never guess a replacement identity.

Export a fresh authenticated signed Admin comparison. Use the compiler/reconciliation adapter to propose the latest supported facts, preserving source dates and existing historical observations. For an exact already-existing source event, link existing; for a genuinely new sourced observation, accept new; for unsupported/conflicting data, retain only with the specific reason. Select only supported non-conflicting profile values through the existing review contract. Keep campaign qualification unchanged.

Review the exact package and field choices, execute supported protected intake/apply under standing task authorization, retain the receipt, and verify the same firm in live Admin. Verify roster/count, supported practices, contacts, advertising observation/date and sources where provided. Verify these same indexed facts through the actual search/filter controls. If a filter or projection is missing, implement the smallest reader/UI/index fix, test, push, merge and rerun this acceptance before bulk delivery.

If the current apply API cannot represent a required evidenced field, add a tested typed destination/adapter under the existing architecture; do not dump facts into an unsearchable note and call enrichment complete.

Replay the identical package: require stable firm/event identities and zero duplicate evidence. Save before/after values, source pointers, receipt and rendered proof. Continue immediately to A4.

## 7. Prove every candidate state is represented (A4)

Use the frozen packet's fixed inspection cases: qualified-source, held, rejected, identity-uncertain and package-less schema-held candidate. Keep their exact manifest identities and decisions. Render original findings, evidence/source/date, gaps and history for all five categories; test search and state filters, including explicit unknown. A rejected campaign decision must not hide the firm's supported facts. An unresolved identity remains a candidate, not a fabricated canonical-firm link.

If the existing compiler's pilot command requires two candidates per category, use its prescribed ordinal selection and validate all ten; do not weaken its gate to force five. The five frozen cases remain additional specific assertions. Never substitute a qualified candidate for a held/incomplete case.

## 8. Deliver all historical research and the frozen delta (A5)

Use the existing compiler's immutable request bodies, hashes and idempotency keys. Reconcile against fresh signed Admin comparisons; refresh comparisons before their 15-minute validity limit for every request. Rebound payloads require a new immutable reviewed manifest; preserve old bytes and lineage.

For the mixed frozen run, register manifest chunks, upload all 710 held bodies, finalize hash-bound coverage, then stage approved envelopes in the existing ordinal delivery order. Do not use `--manifest-only` to discard the 186 envelopes or bypass a mixed-run guard. Holds remain holds; valid envelope structure is not evidence approval.

All 186 frozen envelopes currently carry evidence holds. Standing execution authority does not clear those holds. Private evidence retention/staging may preserve them as held, but canonical apply requires the individual review contract to pass for the specific fact and identity. Retain unsupported facts with their reason; never batch-promote the held envelopes because their schemas validate.

Perform field review using A3's fixed link/new/retain rules. Process canonical updates only for exact verified firm identities; preserve other findings in searchable candidate profiles. Use the supported API for bounded delivery, not manual clicking per firm. Start serially; increase only to the existing supported concurrency, never overlapping writes to one firm. Use batches of 20 for verification/checkpointing, not as stopping points.

After each batch, reconcile expected revisions/items, receipts, visibility and indexed facts; repair failed items and continue all other ready items. At end, compare the full manifest mechanically, not just a UI sample. Required counts: expected equals accounted; every retained revision has verified readable content/hash; no unexplained missing item; no duplicate source events; no unintended canonical identity merges; no changed qualification decision.

Resolve the ten recent import receipts and historical 67-record batch against exact payload/source/event evidence. Missing crosswalk evidence is a hold, never a reason to duplicate an import. These historical lineages must be accounted for even if they overlap the frozen cohort.

## 9. Prove recurring data-only enrichment (A6)

After backlog/delta acceptance, connect the existing whole-firm producer to the same validated export/outbox/intake path. Keep research gathering and qualification criteria unchanged. A completed firm result must checkpoint its evidence, enqueue its delta, receive intake/review/apply or explicit hold status, and reconcile Admin visibility. Never label `submitted` or database persistence alone as synced.

Use the next two available completed producer deltas, in completion-time then work-key order, as acceptance runs. At least one must update an already-existing firm with a genuinely new or corrected sourced fact and preserve the preceding history. Do not manufacture observations to create a test. If none is available, use an existing newer not-yet-delivered revision beyond the historical cutoff; if still none, record the external dependency and continue all other acceptance work.

Both runs must require no code deployment, retain receipts, pass field/search/filter verification, and survive identical retry without duplicates. A business evidence/identity hold is an acceptable explicit research disposition only when its full evidence and reason are visible and searchable; it is not a successful canonical sync.

Immediately before final acceptance, record a final producer high-water mark and mechanically drain/reconcile every durably completed revision through it, including all arrivals after the initial delivery cutoff. The two acceptance runs do not substitute for this complete delta accounting. Later arrivals remain in the active durable queue with explicit pending status and normal automatic processing; an endlessly growing research queue does not redefine the finished historical cohort.

## 10. Final acceptance and handoff (A7)

Finish only after A1 through A6 pass. Store evidence links and expected/actual counts for each in `acceptance.json`; no self-attested boolean without proof. Distinguish `researchVisible`, `canonicalProfileVerified`, and `qualificationEligible` for every key. Business holds may remain if fully retained and visible; technical loss, failed readers and unexplained coverage gaps cannot be counted as finished.

The final user result must include the working Admin link; the live before/after firm example; evidence of held/rejected/incomplete visibility; total revisions and distinct keys accounted separately; exact remaining business holds with reasons; subsequent update/replay proof; and the producer entry command or documented invocation. State any unsatisfied gate plainly. Push all task commits, ensure the worktree is clean or explicitly preserved, and leave a single reproducible resume instruction.

Do not mark complete from an estimate, PR count, document, isolated import or database receipt. Do not ask for another milestone approval. Completion is the demonstrated operating workflow above.
