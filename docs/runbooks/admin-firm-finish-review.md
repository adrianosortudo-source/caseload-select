# Scoped Admin firm-search finish review

Base: released main 234859ee4595bffc427a7c72d84128893a89cfd0 (PR393).
Branch: codex/admin-firm-search-finish-20261007. One owner and isolated worktree.

The list previously omitted canonical services such as Adil's Notary availability, discarded a registered identity when v3 had no supplemental identity observation, and reset existing filters/page after returning from a firm. The repair projects saved service names through the existing practice/text filters, restores only an exact-key high-confidence registry identity using installed v2 while retaining v3's UUID/business evidence, and persists existing controls under up_ query parameters. The actual firm detail Back control receives a bounded, validated local list URL. Candidate cr_ parameters, frozen cursor and unrelated navigation context remain intact.

## Diff-to-scope mapping recorded before push

| File | Authorized purpose |
| --- | --- |
| src/lib/gta-prospect-service-reader.ts | Defect1: bounded UUID-scoped canonical services with applied lineage/retraction checks and deduplication |
| src/app/admin/prospects/reconciled/route.ts | Defect1: attach services on both existing list paths; await fallback errors under existing handler |
| src/lib/gta-prospect-supplemental-evidence-reader.ts | Defect2: guarded installed v2 registry fallback for missing exact v3 identity |
| src/lib/gta-prospect-view-state.ts | Defect3: existing control/page URL codec and history restoration |
| src/app/admin/prospects/ReconciledProspects.tsx | Defect3: use persisted control state, guard existing filters/pagination until hydration restoration, and clear pagination with filters |
| src/lib/gta-prospect-return-path.ts | Defect3: bounded local Admin list return target; reject external, malformed or oversized URLs |
| src/app/admin/prospects/ReconciledResearchProfile.tsx | Defect3: exact firm UUID link carries current list/candidate return context |
| src/app/admin/prospects/ProspectResearchDetail.tsx | Defect3: actual visible Back control uses the validated local return target |
| src/app/admin/prospects/firms/[firmId]/page.tsx | Defect3: pass validated return context after the unchanged operator gate |
| src/lib/__tests__/gta-prospect-service-reader.test.ts | Direct defect1 provenance, retraction, wrong-firm, paging, dedup and existing-filter regressions |
| src/app/admin/prospects/reconciled/__tests__/route.test.ts | Direct defect1/2 authorization, exact Adil/city binding and visible failure regressions; prior guards retained |
| src/lib/__tests__/gta-prospect-supplemental-evidence-reader.test.ts | Direct defect2 exact-key fallback, explicit unresolved/distinct precedence and business-evidence preservation |
| src/lib/__tests__/gta-prospect-view-state.test.ts | Direct defect3 codec, false values, namespace isolation and invalid-value regressions |
| src/lib/__tests__/gta-prospect-return-path.test.ts | Direct defect3 safe local return/cursor round trip and unsafe/oversized target rejection |
| src/app/admin/prospects/reconciled/__tests__/supplemental-read-path.test.ts | Model only the added external read transport; retain every original actual-reader, lossless evidence, no-network and authorization assertion; add combined service/registry regressions |
| src/lib/__tests__/gta-prospect-research-read-projection-contract.test.ts | Preserve the source/security contract while recognizing the required awaited fixture response |
| src/app/dev/prospect-qualified-preview/admin-finish-synthetic.ts | Direct synthetic acceptance fixture; gated preview only, no ingestion |
| src/app/dev/prospect-qualified-preview/page.tsx | Existing preview gate selects the direct acceptance fixture |
| tests/prospect-enrichment/admin-finish.spec.ts | Direct rendered service/identity, exact firm link, actual detail Back plus history Back, deterministic blocked-script cold boot and persisted-first-selection assertion, frozen candidate context/filter/page and clear regressions |
| docs/runbooks/admin-firm-finish-contract.md | Finite finish scope, authority and deadlines |
| docs/runbooks/admin-firm-finish-checkpoint.md | Current execution checkpoint |
| docs/runbooks/admin-firm-finish-review.md | This pre-push scope review and verification/release boundary |

No unmapped file may enter the push. No migration, research import, record mutation, new business field/filter, credentials/settings or unrelated Desired Client change belongs to this diff. The installed v2 function was read-only verified October7 19:30UTC as service-role-executable, denied to anon/authenticated, with empty search_path and registry/explicit-observation precedence. Its existing privileges and SQL are unchanged.

## Verification boundary

Focused Vitest: 138 tests passed across eight files covering canonical service, supplemental identity, actual combined read path, route, view-state, bounded return-target security, source contract and existing record filters. The route regressions exposed and now cover both async fixture failures. Prior null-identity and PR392/393 correctness guards are retained. The first PR394 CI run exposed eleven failures in two unchanged test fixtures: their RPC-only mock lacked the installed v2 read and canonical service transport, and the source-string assertion expected an unawaited fixture response. Only external transport and that exact source spelling were updated; original correctness assertions remain and two combined-reader regressions were added.

The latest browser, TypeScript and lint results are recorded in the execution checkpoint and receipt before push. The direct browser regressions render the real list and detail components with gated synthetic data, and exercise both the actual visible Back link and browser-history Back. Only external data/route transport is substituted; live firm-detail/source acceptance remains required after approved release. Browser startup uses a temporary Webpack configuration because Turbopack rejected the local reused dependency junction. An initial TypeScript check during browser startup saw a transient missing generated routes file; the completed original check passed without a source/configuration change.

Head7a826 CI run37685389873 passed ten jobs, both deployments and the real PostgreSQL contract, but rendered acceptance reported17 passed/1 failed. The history-Back trace shows up_practiceArea was already missing from the outgoing detail return URL: the first select preceded client hydration/restoration, while city, advanced state and page persisted. Existing controls are now disabled only until restoration completes. The direct history regression blocks JavaScript during cold load, checks disabled controls, then checks the selected practice and its URL persistence before opening detail. All original return/count/cursor assertions remain; no timeout increase, assertion removal or unchanged-head rerun.

The documented real-database route is the existing CI Publication concurrency integration tests job: fresh isolated Supabase stack, all migrations, test:prospect-enrichment-integration and test:prospect-enrichment-rendered. Local disposable loopback Postgres 127.0.0.1:55436 returned ECONNREFUSED. No shared database, port or secret was changed; required exact-head CI supplies real-database verification.

Six protected checks are required with strict current-main matching: TypeScript typecheck, Full vitest suite, DR-039 brief-equality eval (language parity), Engine sync (DR-058), Publication concurrency integration tests (real Postgres), ESLint. Also inspect all other CI jobs and both deployment results on the final head.

## Remaining approved-release/live acceptance

Return the draft PR and exact-head checks for the user's separate merge gate. After approved merged-main deployment, verify authenticated Admin list and exact Adil firm: saved Notary service found by text and practice+Mississauga, Toronto exclusion, linked registered identity with dates, correct UUID detail and original service source, existing filters/page after Back, and preserved candidate search/cursor behavior. Record the deployed commit and actual response/read-back; do not substitute fixtures or CI for this proof.

Walker Mandy, Baker's two detailed service descriptions and Brar's dated9-versus10 roster reconciliation remain paused for the existing protected normal-route review/intake sequence after the code gate. Preserve dates, source evidence and Brar's affiliation caveat; do not infer delivery/qualification or overwrite conflicts. Return exact packages/source hashes and target identities before any authorized action. Afonso remains an identity hold. No Adil replay, installed migration replay or broad backlog/research campaign is authorized by this PR.
