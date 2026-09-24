# Rich qualification evidence reader: acceptance contract

The Admin Prospects supplemental reader preserves legacy boolean maps and recursive JSON research as an immutable snapshot. The criteria root must be a plain object (including a null-prototype object). Arrays are allowed below the root; non-JSON values, non-finite numbers, class instances, and cycles are rejected.

Limits are inclusive: root depth is zero; each object property or array element adds one; depth 12 is accepted and depth 13 is rejected. The UTF-8 byte length of the JSON-serialized snapshot must be at most 262144 bytes (256 KiB), including object keys and JSON escaping. An invalid or excessive record fails validation without truncating its evidence.

The supplemental GBP display reads explicit booleans: true is `Supported evidence`; false is `Needs evidence`; null, absent, or nonboolean research is `Not assessed`. Unknown evidence is not promoted into a negative finding. Rich evidence and import qualification gates remain unchanged.

## Synthetic validation

Run the five focused Vitest files: `gta-prospect-supplemental-evidence-reader.test.ts`, `supplemental-gbp-labels.test.ts`, `supplemental-evidence-import-ui-contract.test.ts`, `gta-prospect-supplemental-evidence-migration-contract.test.ts`, and `gta-prospect-evidence-import.test.ts`. They cover 39 cases, including depth 12/13 for objects and arrays, serialized UTF-8 262143/262144/262145 bytes, escaped characters, non-plain roots, mixed legacy/rich rows, and the three GBP labels rendered by the actual component.

Run `npx playwright test --config playwright.prospect-qualified.config.ts --grep "supplemental GBP"`. The preview is enabled only by the existing `PROSPECT_QUALIFICATION_PREVIEW=1` gate and `?supplementalGbp=1`; the test uses three synthetic records and intercepts every API request. It checks the exact labels and document overflow at 1440, 1024, 768, 640, 375 and 320 pixels. Screenshots are saved under `test-results/prospect-qualified-evidence/*-supplemental-gbp-after.png`, with the GBP column scrolled into the existing table viewport on small screens. The horizontal table is the structural layout exception in `src/app/admin/prospects/ReconciledProspects.tsx`; no copy width or production layout changes are made.

The broader pre-existing default-preview suite currently fails before its copy audit because `getByLabel("Owner identified")` matches both an owner-contact select option and the Owner identified select. That selector and both selects existed at starting SHA `e14782329f8de6968a8233c0838dbee54db27df0`. The unrelated contact-status badge/action also fails the broad full-width audit in the synthetic preview. The focused GBP check does not claim those pre-existing full-page gates passed; their existing assertions are retained unchanged.

Run `npx tsc --noEmit`, scoped ESLint, and all required CI checks on the pushed PR head. No migration, database write, production verification, or merge is part of these tests. Any prior approval referring to the earlier PR head must be held until the corrected head and checks are reviewable; merging still requires explicit approval for PR #312.

## Reconciled GET regression

`src/app/admin/prospects/reconciled/__tests__/supplemental-read-path.test.ts` invokes the actual GET route and all its actual readers. Only the Supabase transport, authentication session, and unrelated static cohorts are replaced with synthetic inputs. Network fetch is prohibited; no credentials, database or Admin system are used.

The route cases verify a 200 response with `private, no-store`, lossless rich/legacy criteria attached by source key, preservation of true/false/null through JSON serialization and actual component rendering, no attachment for unmatched supplemental source keys, an authorization gate before any RPC, and route-level 500 responses for non-JSON, depth and byte-limit violations. No route or application implementation is changed by this follow-up.

Run `npx vitest run src/app/admin/prospects/reconciled/__tests__/supplemental-read-path.test.ts src/app/admin/prospects/reconciled/__tests__/route.test.ts src/lib/__tests__/gta-prospect-supplemental-evidence-reader.test.ts src/app/admin/prospects/__tests__/supplemental-gbp-labels.test.ts`: this was 43 focused tests on PR #312; the combined PR #313 suite adds container-boundary and identity-provenance cases. Each pushed combined head requires its own complete CI.

## Combined draft PR #313

PR #313 replays only its 44 commits after shared base `e14782329f8de6968a8233c0838dbee54db27df0` onto verified PR #312 head `6ce24dbee4761121a80992c87a80f41bb6811be2`. The preserved original feature head is `d3b9868d21fd3a39a784754f0a69c743fc3daae5`. It remains a draft based on `codex/prospect-rich-criteria`; this integration grants no merge or production permission.

The combined reader retains the v2 RPC, required identity_source provenance, registry completeness checks, forbidden criteria keys and immutable rich JSON. Every node, including an empty object or array, is allowed through depth 12 and rejected at 13. The byte cap is exactly 262144 serialized UTF-8 bytes. The display keeps getLegacyCriterion and identity provenance while preserving all three GBP labels. The route test now uses the exact v2 transport/schema and checks both stable-registry and supplemental-observation provenance without bypassing the independent firm identity reader.

Local integration checks: 20 direct tests against the actual reader passed using Node native type stripping and injected synthetic RPC results; the native extractor/CLI smoke passed four synthetic status cases with zero research reads or network requests; four changed/shared TypeScript files passed syntax diagnostics. Full local Vitest, ESLint and semantic typecheck were unavailable because this worktree runtime is incomplete; the migration-gate test could not load js-yaml. No dependency-install retry was made. The unchanged lockfile and complete CI on the pushed combined head remain authoritative.
