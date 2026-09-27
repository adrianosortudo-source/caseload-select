# Engineering, acceptance and delivery instructions

## 1. Preflight and working location

Work only in `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app-worktrees/desired-client-v2`, branch `codex/desired-client-v2-app`. Read applicable AGENTS.md instructions and repository policies. Check branch, HEAD, status, existing PR #317 and its current diff before edits. The plan was audited against clean HEAD `ce209f3456ffe3b531401c764af63612510b497a`; never reset later work to that commit.

If the same branch is still active, update it and its existing PR. If #317 has merged or the checkout is now in use for incompatible work, report that fact and return the branch/worktree choice to Astra. Do not choose a new architecture, clone or release route. Local syntax, factoring and test-helper choices within this contract are routine implementation; user-visible copy, behavior, schema, field scope and release decisions are fixed here.

Do not modify production, deploy with Vercel CLI, provision secrets, create migrations, or edit Screen/CRM settings. Preview configuration is a separate prerequisite for live provider testing. It must not block implementation or mocked verification.

## 2. Implementation order and file map

Complete each milestone before broadening scope. Keep documentation copies and test evidence under the existing `docs/desired-client-v2` structure, not at repository root. Copy this package into `docs/desired-client-v2/blueprint-update/` as part of the implementation commit so the pushed code carries its specification. Do not commit browser profiles, temporary PDFs, secrets or downloaded books.

| Milestone | Files / functions | Required change |
|---|---|---|
| 1. Domain and migration | `types.ts`, `brief.ts:emptyAnswers`, new `migration.ts`, `storage.ts` | Add the three answers and write-ins, v2.2 schema, new brief contract, migration and tests. |
| 2. Discovery | `catalog.ts`, `copy.ts`, `screens.ts`, `QuestionStage.tsx`, `ReviewStep.tsx`, `WelcomeScreen.tsx`, `state.ts`, `write_ins.ts`, `sources.ts` | Exact questions/catalog, 13 required groups, contextual help, limits, resets and source labels. |
| 3. Synthesis | `prompt.ts`, `output.ts`, `analyze.ts`, `validation.ts`, `clarifications.ts`, API route tests | New bounded AI payload, grounding, conflict priority and validated version. Keep provider and route protections. |
| 4. Shared result | new `blueprint.ts`, `screening.ts`, `structured-copy.ts`; `brief.ts`, `BriefView.tsx`, `DesiredClientTool.tsx`, `DraftPreview.tsx`, `export.ts`, CSS | One presentation model; new basic builder; on-screen blueprint; source detail; review/edit lifecycle; text/Markdown exports. |
| 5. One-page PDF | new browser-safe `DesiredClientBlueprintPdf.tsx` and client `pdf-export.ts`; tests | Dynamic client render with installed library, exact report layout, revision guard, status/failure handling. |
| 6. Verification and handoff | existing unit/API/browser suites; new fixtures and review evidence | Execute acceptance matrix, inspect output, summarize live-provider limits honestly, commit/push and update draft PR. |

All `*.ts` library paths above are under `src/lib/desired-client`; components are under `src/components/desired-client`. The API is `src/app/api/tools/desired-client-matter/analyze/route.ts`. The tool route remains `src/app/tools/desired-client-matter/page.tsx`. Preserve the website's current embed/wrapper behavior and compatibility route; do not rebuild the separate website tool.

## 3. Input version and validation

Set `DesiredClientAnswers.schema_version` to `dcm-v2.2`. Keep request/save `schemaVersion: 2` and the local key `cls-desired-client-v2`. Add:

```ts
situation.trigger: TriggerId | "unknown" | null;
client.decision_needs: DecisionNeedId[];
delivery.fit_signals: FitSignalId[];
// WriteInKey adds trigger | decision_needs | fit_signals
```

Fresh values are null / [] / [] with no inferred selections. `TriggerId` is the finite area-prefixed catalog in the discovery specification. Validate that trigger belongs to the selected area. Decision/fit IDs and custom limits are exactly as specified there. Unknown is exclusive. Count a nonempty custom answer as one slot toward the two-decision / three-fit maxima. Reject unknown keys, foreign trigger IDs, invalid paths, duplicate IDs and over-limit combinations on the server as well as in the UI.

Update the finite `AnswerReferencePath` union, every runtime allowlist, every schema enum, `resolveAnswerReference`, `labelReference`, `getSourceDetails` and write-in helper list. Add the six new source paths explicitly to non-experience classification. Do not let an unfamiliar path fall through to experience.

Keep current request size, field-size, ID, comparison and privacy controls. Do not change existing collected-fee or hours IDs/labels. Existing Other work and Other role without a description remain valid but explicitly provisional; do not silently make a new essay requirement.

## 4. Legacy draft migration

Run a pure migration before current draft validation. Preserve a separate v2.1 validator using the actual old exact-key shape; do not weaken the v2.2 validator to accept arbitrary legacy keys.

For a valid, unexpired outer v2 / inner v2.1 draft:

1. Clone all existing answers, including comparison, custom text and optional values.
2. Change only inner schema version and initialize the three new fields empty.
3. Increment answer revision once; clear clarification answers because they belong to the earlier report contract.
4. Remove the saved generated brief and reviewed flag. Do not discard the user's input history because its old report shape differs.
5. Keep `lastEditedAt` and `expiresAt` exactly. Migration is not a user answer edit and must not extend the seven-day lifetime.
6. Resume at the earlier of the valid original stage and stage 2, while preserving answers in later stages. The user must answer the new trigger and fit questions before generation. Existing navigation can take them through retained answers; nothing needs retyping.
7. Show: `Your saved answers are here. Two new questions help build the updated profile. Please review them before creating a new blueprint.`
8. Persist the migrated snapshot with unchanged timestamps. If writing fails, continue in memory with the normal storage-failure message; do not delete the original saved draft.

Prevent the normal save effect from immediately treating the migration revision bump as a user edit. Use an explicit migrated-draft save operation or baseline revision initialized from the migrated snapshot; test both initial load and immediate rerender. Only a subsequent real answer edit refreshes TTL.

For v2.2 answers containing a legacy/invalid saved report: preserve valid answers, discard only the stale report, return to Review if all stages are complete and display `Your answers are saved. Create a new blueprint to use the updated report.` Expired/malformed drafts retain their existing handling; do not label a valid old draft corrupt.

Do not restore AI consent. Do not send an analysis request on resume or migration. Current API accepts v2.2 only; a stale v2.1 caller receives the existing invalid-request result without server-side persistence or guessed migration. An already-open v2.1 page retains its existing invalid-request/basic-fallback behavior. Do not introduce automatic reload, a new error envelope or a claim that old JavaScript can identify this mismatch. A normal reload loads the v2.2 client and runs local migration before restore; saved answers remain recoverable.

## 5. State and asynchronous behavior

- All new field edits go through `editAnswers` / `DesiredClientTool.updateAnswers`, preserving revision increment, saved-report invalidation, review reset and cancellation of pending AI requests.
- On area/work/custom-work change, clear the three new fields and associated write-ins. Do the same when `commitComparison` changes the selected work. Retain existing dependent role/work resets and later-stage revisit behavior. Changing unrelated answers does not erase the new choices.
- Brief display and exports require a saved result whose source revision equals current answers. No stale AI response or delayed PDF may replace/download against changed input.
- Guard PDF completion by both answer revision and report identity (`generatedAt` plus report reference/run identity); a second generation at the same answer revision can still make the previous export stale.
- Review controls, opening source detail, navigating or exporting do not refresh answer expiry. Rebuilt outputs always require wording review again.
- The normal questions show their full options. Source detail is also visible/open; do not introduce a collapsed panel as a shortcut to a cleaner screenshot.

## 6. AI and bounded clarifications

Keep Gemini `gemini-2.5-flash`, temperature 0.2, maximum output 4096 tokens, thinking budget 512, provider timeout 12 seconds, browser timeout 16 seconds and route maximum duration 30 seconds. No SDK migration or extra summarizer/repair call. Update only the prompt/response contract and deterministic enforcement required by this plan.

Keep the existing bank's questions, options, side effects and Leave this open behavior. Reorder eligible-code priority to:

1. CURRENT_CAPACITY_CONFLICT
2. FEE_EFFORT_CONFLICT
3. EXPERIENCE_DIRECTION_CONFLICT
4. FOCUS_UNCLEAR
5. CLIENT_GOAL_UNCLEAR

Before request index 0 or 1, compute the first eligible unasked code. Give that exact expected code to the provider and require it in the returned envelope; require null when no code is eligible or on request index 2. The AI writes a usable interim profile while the deterministic engine chooses the question. A conflicting/unknown code is invalid output, not permission to ask a new question. Existing triggers and answer side effects remain unchanged. `FOCUS_UNCLEAR / choose_specific` returns to Focus and a new run only after the actual input is revised.

Three attempts per review run means one initial request and at most two subsequent calls, including retries. A failure can consume an attempt and reduce available follow-ups. Preserve the existing `sameRequest` guard on run ID, answer revision and attempt identity. Do not claim this client/envelope limit is a tamper-proof account quota; retain the existing independent server rate limits.

Leave this open ends the clarification interaction and shows the current profile with the unresolved issue carried into status, supporting detail and exports. Do not loop back to pressure the user to resolve it. Keep the durable openClarificationCode behavior and test reload.

Validate report version, exact shape, every bound, source references, numbers, allowed plain text and clarification code before accepting AI output. An absent version or an old answer-list payload is invalid. Use structured fallback and existing retry rules; never display unvalidated model text.

Preserve 32,768-byte streaming request cap, exact allowed origins, JSON input, no-store responses, existing response status/error mappings, and rate limits (20 per ten minutes per IP, 100 daily per IP, 2,000 globally daily). No payload logging or analytics capture of answer text.

## 7. Acceptance fixtures

Create clearly synthetic fixtures under `tests/desired-client-v2/fixtures/blueprint/` and corresponding unit fixtures. Mark synthetic content in fixture filenames/docs, not as user answers. No real client data. Do not use the prototype's invented fees/hours as defaults.

| Fixture | Required inputs and observation |
|---|---|
| Established employment | Employee exit work; explicit exit event; employee role; goal understand; fees/skills preference; capacity room; repeated work evidence. The result connects these. It must not invent Ontario, an unsigned offer, paid review, a fee, compensation or a deadline when absent. |
| Business growth | Acquisition work; transaction trigger; buyer-side role if selected; route new; goal complete; capacity change; future direction. Output treats capability/economics as expectations and directs marketing toward capacity-aware preparation. |
| Family unknowns | Separation work; unknown trigger; unknown fee effort/capacity; unknown fit signals; preference-only evidence. Output is usable but provisional, with meaningful unknowns and no invented client motives. |
| All custom | Custom work, trigger, goals, decision needs and fit signal. Output reflects the custom substance, source references resolve, and no preset is required just to progress. |
| Conflicts | Fee difficult plus fees reason; capacity change plus more_current; new route plus more_current. First two available follow-ups follow the priority order; remaining material conflict stays visible. |
| Maximum content | All narrative slots at both applicable bounds, longest preset labels, allowed custom fields at 180 characters, optional values, two open notes, full evidence. Real PDF remains readable and exactly one page. |
| Injection / unsupported facts | Write-ins request prompt override, insert a fee/score/URL or ask to email the report. Input remains data. Unsupported model output fails validation and falls back safely. |
| Legacy lifecycle | Valid v2.1 drafts from each stage, with and without reviewed AI/basic reports, custom answers and expiry near the boundary. No data loss, no expiry extension and no automatic AI request. |

The frozen AI fixtures must contain plausible synthesized text authored for these inputs, with exact references. Do not simply update fixtures by serializing implementation output; they should catch semantic regressions.

## 8. Acceptance matrix

### Functional and migration

- Preset and custom-only completion; optional decision needs blank/populated; unknown valid; every trigger catalog area covered; no practice-area example becomes evidence.
- Exactly three fit signals including custom succeeds; a fourth fails on UI and API. Exactly two decision needs including custom succeeds. Exclusive unknown reverses cleanly in both directions.
- Count required groups as 13. All optional commercial/delivery details stay optional and open. Comparison remains optional and does not claim its longer path takes ten minutes.
- Migration preserves original answers and timestamps, invalidates old reports, survives write failure and does not repeatedly increment revision on every reload.
- Focus/comparison changes clear affected new choices, force necessary revisit and block stale reports/exports. Unrelated edits preserve new answers.
- Two follow-ups maximum; retries consume the same three-call budget; third result has no follow-up; Leave this open persists through reload and exports.
- AI disabled, unavailable, timeout, malformed result, rate limit, oversized payload and network failures preserve answers and usable basic output. Retry only for the currently permitted failure categories.
- All six new source paths resolve in prompt, UI, output validation, copy and Markdown. Unknown and new-route evidence cannot silently become experience.
- Old/invalid report version rejected. Long AI output rejected. Numeric hallucination rejected. At least one hand-reviewed semantic-grounding fixture exposes facts that path checks alone would miss.

### Report quality

- AI result leads with a coherent persona in connected prose; no answer-list masquerading as portrait.
- Need, firm value and marketing direction express the same selected focus. New/exploring work and poor economics/capacity are treated honestly.
- The four Screen rows are present. Supporting detail contains specific question targets with sources, clear unknowns and status proposal/not_activated.
- Word/character limits hold. Custom input does not disappear; complete text remains in supporting detail. The one-page view contains no invented numerical detail or general legal conclusion.
- Review defaults unchecked; output before review says Working draft. Review never activates Screen. Editing and regeneration clear review.
- Screen/PDF/copied text/supporting detail agree on the profile revision and status; the extra supporting information is clearly separate from the one-page report.

### PDF, privacy and browser quality

- Render a real PDF, check `%PDF-`, count exactly one physical page, extract all mandatory sections and inspect rendered maximum-content output. No clipping, overlap, missing glyphs or font below 10 pt. Selectable text, not an image-only page.
- Download actually works via browser `toBlob`, including embed, and font URLs resolve on deployed preview. Do not accept a server-only render test as proof of client export.
- Basic creation/PDF export makes no answer-bearing network request. AI is only called after explicit consent. No Supabase, Screen, CRM or email write is performed.
- PDF rendering has loading, failure, duplicate-click, object-URL cleanup and edit/reset-during-export coverage.
- Test widths 1440, 1024, 768, 640, 375 and 320 px. Use natural wrapping, no horizontal overflow, clipping, one-word last lines in authored copy, forced hard breaks or em dashes. Correct the copy/layout; do not add an AI-content exemption to quality tests.
- Long selected/custom answers wrap and remain readable in source detail. All controls have labels, focus indicators and keyboard access. Changes announce completion/errors appropriately; do not jump focus on every keystroke.
- A direct and embedded full journey, storage-unavailable journey, resume, reset/replace confirmation, invalid output fallback and clipboard failure continue to work.

## 9. Commands and evidence

Run from the app worktree. These commands were verified against the current package/config files; implementation changes must keep them usable. The existing Vitest configuration discovers `*.test.ts` in the library test directory, not `*.test.tsx`; use `createElement` for real-render tests where needed.

```powershell
npm.cmd test -- src/lib/desired-client/__tests__ src/app/api/tools/desired-client-matter/analyze/__tests__/route.test.ts src/lib/__tests__/desired-client-rate-limit.test.ts src/lib/__tests__/desired-client-frame-headers.test.ts
node node_modules/@playwright/test/cli.js test --config=playwright.desired-client.config.ts
node node_modules/@playwright/test/cli.js test --config=playwright.desired-client-embed.config.ts
node node_modules/eslint/bin/eslint.js src/lib/desired-client src/components/desired-client src/app/api/tools/desired-client-matter tests/desired-client-v2
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run build
```

Run browser suites sequentially; each manages port 3301 with reuseExistingServer false. Embedded tests also use the existing site wrapper fixture on port 3300. The sibling fixture path is `D:/00_Work/01_CaseLoad_Select/05_Product/caseloadselect-site-worktrees/desired-client-v2/tests/desired-client-v2-wrapper-fixture/server.mjs`. Inspect a collision rather than stopping an unrelated server. Stop the test-managed Next process before standalone typecheck/build to avoid generated `.next` types changing underneath the compiler.

Existing real-PDF precedent: `src/app/api/tools/seo-check/__tests__/report-pdf.test.ts` uses renderToBuffer. Reuse its testing pattern, not its server/email implementation. Find page-count/text extraction tools already available in repository or bundled runtimes; do not install a new production dependency. A PDF parser or renderer used only for local QA may be invoked from the existing bundled environment.

Existing browser reports go to `docs/desired-client-v2/review/direct-browser-results.json` and `embed-browser-results.json`. Add a concise `blueprint-update-review.md` describing fixture inputs, observed output, failures/fixes, screenshots, PDF page counts, text extraction and remaining limits. Commit small, intentional evidence files only; leave bulky generated media in a named D-side review directory and link exact paths in the review note.

The browser configurations disable live AI and intercept requests. Passing them proves UI/state behavior, not real Gemini quality. Run one established and one new/exploring synthetic live-provider journey only when authorized preview configuration is already present and usable. Never send actual client data. Record model, case, date, output and semantic findings without tokens/secrets. If configuration is unavailable, explicitly mark live-provider synthesis unverified and finish all other checks. Do not provision missing Gemini/Upstash/flags or copy production secrets to make the check pass.

Measure an ordinary preset route and a custom-answer route from start to usable result; record AI waiting time separately. Scripted timing is a smoke measurement. Do not advertise ten minutes as validated until representative user testing supports it.

## 10. Delivery and release boundary

1. Reconcile the diff with this specification, and ensure no portal, database, Screen configuration or unrelated product changes slipped in.
2. Run relevant checks once after the final code change; rerun only affected checks when later fixes require it. Complete repository-required CI as well.
3. Commit intentional code, tests, specifications and review notes. Every commit must be pushed to origin before the session ends. Do not leave an unpublished local branch.
4. Update the existing draft PR #317 title/body around the final blueprint behavior and validation. Use a body file for multiline `gh` text. Attach the PR to the task. Do not mark mocked testing as live-provider verification.
5. Leave a clean working tree, or explicitly named stash for unrelated pre-existing work; do not sweep another person's changes into a commit. Account for every new untracked file.
6. Return the branch, commit, PR, preview URL when verified, tests, one-page sample PDF path, migration evidence and any remaining live-provider limitation to Astra for final review.
7. Do not merge without Adriano's explicit approval for that specific PR. Main auto-deploys on merge; direct production deployment is prohibited. If Vercel CLI is needed for authorized read-only inspection, use the old-account token file with scope `adrianosortudo-7282s-projects`, without displaying the token or using browser/device login.

If push/auth/network/CI is blocked, report the exact incomplete step and where work lives. Do not imply a finished deployment or silently substitute a local-only result.
