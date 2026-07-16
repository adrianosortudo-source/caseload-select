# Simplicity Axis, Remaining Work: Execution Handoff (Sonnet)

| | |
|---|---|
| Date | 2026-07-16 |
| Status | Phases A, C (minus item 1), D, E executed and verified. Phase B and Phase C item 1 blocked on Gate G4 (operator sentinel file). Phase F blocked on Gate G1 (branch/deploy decision). See Section 3 (Execution log) below. |
| Executor | Claude Sonnet session |
| Parent plan | `docs/simplicity-axis-unification-plan-v1.md` (read Sections 4-11 first) |
| Decision record | DR-103 in `00_System/01_Doctrine/DECISION_RECORDS.md` (read it in full first) |

## 0. Context in three sentences

DR-103 (2026-07-15) unified the CaseLoad Screen four-axis display on **Simplicity**: the engine's internal `complexity` axis (0-10, subtractive drag) is unchanged everywhere (code keys, wire contract, DB column), and lawyer/prospect-facing surfaces display it as Simplicity = 10 − complexity so all four axes read higher-is-better. The core change already shipped in the working tree: `src/lib/screen-brief-html.ts`, its test file (28/28 green, full suite 4,847/4,850 with only pre-existing failures), app `CLAUDE.md`, DR-103, and methodology D018 entries. This handoff covers everything that was deliberately deferred: the scoring-port explanation prose, the marketing/sales/docs copy sweep, the screen-demo relabel, the voice prompt disk files, and doc hygiene.

## 1. Global guardrails (read before any edit)

**The word "complexity" is only wrong when it names the scored axis.** Classification rule for every hit you find:

- **AXIS usage (change it):** lists of the four axes ("value, complexity, urgency, and readiness"), axis card labels, axis score labels ("Complexity 4/10"), badge rows. These become Simplicity, and any displayed score flips to 10 − x.
- **PROSE usage (leave it):** sentences describing matters as legally complex ("a complex commercial dispute", "depending on complexity", "high-complexity consultative work"). Legal complexity is real and often the commercially attractive work. Never mechanically replace the word.
- **LEGACY-CPI usage (never touch):** anything on the frozen CPI v2.1 system, where `complexity_score` is a 0-25 POSITIVE sub-score inside Value (higher complexity = more points, the opposite polarity). Renaming or inverting there corrupts a separate live system.

**NEVER-TOUCH list (a find-and-replace into any of these is a critical failure):**

- The engine: `src/lib/screen-engine/` (app) and `CaseLoadScreen_2.0_2026-05-03/src/engine/` (sandbox). Zero edits. `band.ts:683` already emits the correct "Simplicity" summary string; leave it.
- The `estate_complexity` slot id (slotRegistry, selector, control, discovery-floor): a persisted question id in `slot_answers`.
- Legacy CPI files: `src/lib/screen-prompt.ts`, `default-question-modules.ts`, `scoring.ts`, `cpi.ts`, `cpi-calculator.ts`, `score-components.ts`, `score-rationale.ts`, `case-value.ts`, `few-shot-examples.ts`, `src/app/api/screen/`, `src/app/api/v1/leads/`, the `leads` table, `LiveScoringPanel.tsx`, `LawyerViewPanel.tsx`, `test-screen/page.tsx`, `leads/[id]/page.tsx`, `DemoPortalResult.tsx`.
- The wire contract and persistence keys: `axes.complexity` in `intake-v2-security.ts`, `screened_leads.complexity_score`, `brief_json.four_axis.complexity`, `axis_reasoning.complexity`. Display-only means these names never change.
- Queue cards `TriageQueueCard.tsx` and `admin/triage/page.tsx`: already correct (they invert at display time). Do not touch.
- Copy/worktree dirs: `05_Product/.wt-codex-audit-pr25/`, `05_Product/caseload-select-app-fix/`, `caseload-intake-batch/`, `99_Archive/`, `_Archive/`, `ToDelete/`.
- `05_Product/Website/caseload-select-demo.html` and `update_briefs.py`: ALREADY on the Simplicity convention. They are your reference implementation. Do not "fix" them backward.

**Writing rules for every sentence you write or rewrite** (non-negotiable brand doctrine): read root `CLAUDE.md` §Writing before Phase B and follow it exactly. Highlights: no em dashes, no italics, the full banned AI-pattern vocabulary list in that section, no "not just X but Y" reframes, no outcome promises or superlatives (LSO Rule 4.2-1), evidence-led, each paragraph one idea. Copy framing rule from the CRM Bible: **low simplicity = consultative work, not bad work; the Value axis carries the fee story.** Never write "simpler matters are better matters." Note: a PreToolUse hook (`check-banned-vocab.mjs`) enforces the banned vocabulary on every write to this folder tree, including mentions inside backticks, so do not restate the banned words anywhere; just avoid them.

**Git awareness:** the app repo sits on branch `fix/restore-marketing-homepage` with substantial uncommitted WIP that is NOT yours (Firm Assist, content cadence panel, consent-log, tool-intake). Do not commit, stash, revert, or clean anything in the app repo unless Phase F's operator gate is resolved. Files outside the app repo (02_Sales, 01_Brand, 10_KnowledgeBase, Version3_CaseLoadSelect, 00_System, sandbox) are not under that repo's git; edit them directly.

**Test commands:**

- App: `cd D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app && npm test` (full) or `npx vitest run <file>` (targeted). Typecheck: `npx tsc --noEmit` (pre-existing errors exist in `caseload-intake-batch/` and one consent-gate test; ignore those, introduce none).
- Known pre-existing failures to ignore (not yours): classifier/compliance-pipeline/llm-rewrite suites (missing OPENROUTER/OPENAI keys), legacy-surface-auth (`src/app/page.tsx` missing on this WIP branch), portal-operator-view assertion, provision-clients timeout.

## 2. Operator gates (STOP and ask Adriano; do not improvise)

| Gate | Blocks | Question for Adriano |
|---|---|---|
| G1: branch + deploy strategy | Phase F | The shipped core change is uncommitted on the dirty `fix/restore-marketing-homepage` branch. Commit the DR-103 files on this branch, or a clean branch off main? Production shows Complexity until this deploys. |
| G2: live GHL voice agent | Phase E step 3 | Editing agent `6a0e223266dcf5cad976f3ae` in the GHL UI is a production client-facing change. Adriano applies it or explicitly tells you to drive the browser. |
| G3: DRG GHL custom fields | Nothing (independent check) | Operator opens DRG sub-account `KwpSaMUehIN25dMG4WZB`: Settings > Custom Fields and Automation > Workflows; inventory anything named complexity/simplicity/axis. MCP tokens cannot reach this location. |
| G4: marketing boundary hook | Phase C step 1 | If `.claude/hooks/check-website-boundary.mjs` blocks your edit to `CpiSection.tsx` or the screen-demo subtree, stop and show Adriano the hook output. Never bypass a hook. |

Recommended order: **B → C → D → E → A → F.** Phases B-E need no gate (except C step 1 and E step 3 as noted). A and F land last.

## Phase A: scoring-port explanation prose + score_version 2 (app repo)

The persisted, lawyer-visible explanation sentence still says "High complexity drags the weighted score down." (`src/lib/scoring-port.ts:166`). Changing prose on a persisted field requires a version bump because two independent validators hard-check the version.

1. Read `src/lib/scoring-port.ts`, `src/lib/scoring-port-read.ts`, `src/lib/scoring-shadow.ts` in full. Then `grep -rn "score_version" src/` and enumerate every reference before editing.
2. In `scoring-port.ts`: reword the explanation to Simplicity vocabulary (suggested: "Low simplicity drags the weighted score down." with the surrounding sentence kept parallel to the other three axes). Bump the emitted `score_version` from 1 to 2.
3. In `scoring-shadow.ts` (the `must be null or 1` validation near lines 168-169) and in `scoring-port-read.ts` (the shadow comparator): accept BOTH 1 and 2. Historical rows keep 1 forever (DR-059). The comparator must not log drift when a stored row is version 1 and the live computation is version 2: skip prose comparison across versions, compare numeric fields only.
4. Update `src/lib/__tests__/scoring-port.test.ts:127` (the explanation assertion) and any scoring-shadow/scoring-port-read tests that pin version 1.
5. Verify: `npx vitest run` the scoring-port, scoring-port-persistence, and scoring-shadow test files (confirm exact filenames in step 1), then the full suite. Acceptance: green, and no new `console.warn` drift path for version-1 rows (prove it with a test case: stored v1 row + current v2 computation produces zero warnings).

## Phase B: screen-demo sub-axis relabel (app repo, marketing route group)

The lead-magnet demo scorer is legacy-CPI-shaped: "Matter complexity" is a 0-25 POSITIVE factor inside Value. Do NOT invert its math and do NOT call it Simplicity. Relabel to **"Depth of work"** so it stops colliding with the axis vocabulary.

1. `src/app/(marketing)/screen-demo/_components/ReportView.tsx:243`: LABEL_MAP `complexity: "Matter complexity"` becomes `"Depth of work"`. Internal key `complexity` stays.
2. `src/app/(marketing)/screen-demo/_lib/report-pdf.tsx:424`: same relabel in FACTOR_LABELS (this is the emailed, LSO-stamped PDF; the DEMONSTRATION band must remain untouched).
3. `src/app/(marketing)/screen-demo/_lib/scoring.ts:170`: narrative strings "matter complexity" become "depth of work" (strongest/weakest factor sentences must still read as grammatical English; rewrite the sentence, not just the token).
4. `src/app/(marketing)/screen-demo/_data/questions.ts` lines 194, 196, 200-201, 212: reword Q4 copy so it asks about stakes and depth of work without teaching "complexity" as a scored concept. Keep the meaning (deeper work signals higher value); apply the writing rules.
5. Verify: targeted tests for the screen-demo if any exist (grep `src/**/__tests__` for screen-demo imports first), typecheck, and render one report via the demo flow if a dev server is practical; otherwise confirm by reading the built strings. Acceptance: no user-visible string in the demo says "complexity"; math unchanged; internal keys unchanged.

If the boundary hook (G4) blocks any of these files, stop and surface it.

## Phase C: marketing, sales, brand, KB copy sweep (mostly outside the app repo)

Generate the worklist by grep at execution time, folder by folder. Do not trust any pre-built list, including this one; the greps during planning found more files than any single inventory. For each folder run a case-insensitive content grep for `complexity|simplicity`, classify every hit with the Section 1 rule, and edit only AXIS usages.

1. **App repo, live homepage:** `src/app/(marketing)/components/CpiSection.tsx:79`: "value, complexity, urgency, and readiness" becomes "value, simplicity, urgency, and readiness". (Gate G4 applies.)
2. **Pending-cutover site repo** `05_Product/caseloadselect-website/`: check its git status first; sweep the whole `src/`. Known hits: `src/app/system/page.tsx:251`, `src/data/system.ts:101`. Same one-word swap.
3. **Static site twins:** `Version3_CaseLoadSelect/website-v1/` (known: `index.html:2346-2347` axis row label, `:2568` calibration copy, `:2828-3049` JS fixture axis data; `solutions-two-lawyer.html:456`) and `Version3_CaseLoadSelect/CaseLoadSelect_Website_Offline_Preview/`. For the interactive demo fixtures in index.html: the rendered card must match the live product (label Simplicity, displayed score 10 − complexity, higher = better), and the fixture bullets must justify the shown score. Use `05_Product/Website/caseload-select-demo.html` as the reference for exactly how converted fixtures should read.
4. **Sample report source** `Version3_CaseLoadSelect/sample-report-source/`: `brief_html.html` (axis card becomes Simplicity with the inverted score: stored complexity 4 displays as Simplicity 6/10 Moderate) but `brief_json.json` KEEPS `complexity: 4` untouched, because it mirrors the persisted DB shape, which never changed. Update `README.md` to state that split explicitly so a future regeneration does not "fix" the json.
5. **Sales** `02_Sales/`: known axis hits in `StrategyCall_Page_V1.html` (:1829, :2076, :2084 axis lists; :1666, :1701 "high-complexity" prize framing), `Pitch/StrategyCall_Deck_V6.html:3096`, `OnePagers/CaseLoad_Select_Case_Selection_Architecture_v2.html:1143-1146`. The prize framing stays commercially intact: "Band A · high-complexity case" style lines keep the consultative-work meaning; where they reference the scored axis, reframe through Value (example direction: "Band A · complex, high-value matter"). Sweep the whole folder; the planning grep found ~23 matching files, most prose-class.
6. **Brand book** `01_Brand/BrandBook/`: `BrandBook_ACTS_V1.html:3312` vocabulary entry + the same entry in `CaseLoad_Select_BrandBook_ACTS_V1.md`. The companion PDF must be regenerated (WeasyPrint, per the brand book's own production notes); if the regeneration path is not obvious from `01_Brand/BrandBook/` contents, edit html+md and flag the PDF as pending in your report rather than guessing.
7. **Knowledge base:** `10_KnowledgeBase/KB-26_Brief_UX_Patterns.md:170` (axis card hierarchy rule) and `KB-27_Intake_Benchmarks_Screen_Product_Map.html:391` and the second hit near :416. Sweep the folder; other KBs are mostly legacy-CPI or prose class.
8. **App design doc:** `docs/design/triage-card-redesign-prototype.html` (app repo): update its axis labeling so the design reference matches the shipped surface.
9. Every edited client- or prospect-facing sentence gets an LSO Rule 4.2-1 read (no outcome promises, no superlatives, no "specialist/expert").

Acceptance for Phase C: a final re-grep per folder shows zero remaining AXIS-class "complexity" hits outside the NEVER-TOUCH list, legacy-CPI docs, and archives; every rewritten sentence passes the writing rules.

## Phase D: doc hygiene (small, low risk)

1. Root `D:/00_Work/01_CaseLoad_Select/CLAUDE.md`: (a) the CaseLoad Screen section says "priority bands (A through E)"; live Screen 2.0 is A-D (A-E is legacy CPI), fix it; (b) the "Engine sync discipline" paragraph claims pre-existing drift in `selector.ts` and `llm/extractor.ts`; that drift was cleared 2026-06-09 (DR-068) and sync was verified green 2026-07-15, fix it; (c) if the four axes are named anywhere in this file, apply the DR-103 vocabulary with the internal-vs-display note.
2. App `CLAUDE.md`: the GHL webhook contract reference says v2; the contract doc `docs/ghl-webhook-contract.md` is v3. Fix the reference.
3. Sandbox `CaseLoadScreen_2.0_2026-05-03/CLAUDE.md`: test count says 136; actual is 388 across 27 files (verified 2026-07-15). Fix it.
4. Memory layer: `C:/Users/adria/.claude/projects/D--00-Work-01-CaseLoad-Select/memory/feedback_marketing_no_cpi_numeric_score.md` hard-codes "four /10 axes (value/complexity/urgency/readiness)". Update to the DR-103 vocabulary, and update its one-line entry in `MEMORY.md`. Do this only AFTER Phases B-C are done, so memory never leads reality.

## Phase E: voice (disk files free; live agent gated)

1. `00_System/04_Templates/voice/PROMPT_RUNTIME.txt:64`: discovery item 4's internal label "COMPLEXITY:" becomes the DR-103 vocabulary per `VOICE_AGENT_SPEC.md:331` ("Simplicity inverse" mapping; spec v2.5 names the axes Value, Simplicity, Urgency, Readiness). The QUESTION CONTENT (other parties involved, documents or contracts in place) does not change; only the label. Voice prompts are in scope for all writing rules (CRM Bible DR-040).
2. `VOICE_AGENT_SPEC.md`: add a changelog entry referencing DR-103. This also closes the FOLLOWUPS row-188 debt (the open item owing a DR for four-axis voice discovery naming).
3. **Gate G2:** the live DRG agent prompt in GHL (agent `6a0e223266dcf5cad976f3ae`) gets the same edit. First diff the live prompt against the disk snapshot `06_Clients/DRGLaw/04_Capture/DRG_Voice_Agent_Prompt_LIVE_snapshot_2026-06-10_v2.4.txt` (it may have drifted since June). After the live edit is applied, refresh the snapshot file with a new dated filename and leave the old snapshot in place.

## Phase F: commit, push, deploy, smoke (behind Gate G1)

Once Adriano answers G1:

1. Commit scope: `src/lib/screen-brief-html.ts`, `src/lib/__tests__/screen-brief-html.test.ts`, `CLAUDE.md`, `docs/simplicity-axis-unification-plan-v1.md`, this handoff doc, plus whatever Phases A/B/C/D touched inside the app repo. Nothing from the unrelated WIP set. Run `git status` and `git diff --stat` and confirm every staged file is yours before committing (standing rule: check untracked dependents before git add).
2. Conventional commit, e.g. `feat: display Simplicity axis in lawyer brief per DR-103` with body listing the phases. Push per G1's branch decision. Production deploys via git integration (commit + push; never CLI-only, per standing memory).
3. Confirm the Vercel deployment reaches READY.
4. Smoke test on production: run one EN and one PT intake through the live widget; confirm the new lead's brief card reads "Simplicity N/10" with the badge and border agreeing (high simplicity = positive navy border); confirm the queue card "Smp" value matches the brief card number; open one HISTORICAL lead and confirm its old brief still renders (Complexity labels on old rows are accepted per DR-103, not a bug); confirm the band assigned is plausible and no console/log warning storm from the scoring-port comparator.
5. Close out: update the FOLLOWUPS rows for this work (mark the plan row's execution progress; close row 188 after Phase E), and append one new row for anything you discovered and deferred.

## Reporting format

At the end, report per phase: files changed (paths), verification run and result, anything skipped with the reason, and any NEW axis-bearing surface you discovered that this handoff missed. If any instruction here contradicts what you find on disk, stop that phase, say what you found, and continue with the other phases; do not silently improvise around a contradiction (Scope investigation protocol, root CLAUDE.md).

## 3. Execution log (2026-07-16, Sonnet)

**Order actually run:** B attempted first and immediately blocked by G4; C items 2-9 run (skipping item 1); D run; E run; A run; F not attempted (G1 unresolved).

**Phase B: BLOCKED.** First edit attempt (`ReportView.tsx` LABEL_MAP) tripped the `check-website-boundary.mjs` hook exactly as Section 2 anticipated. Per instruction, stopped immediately rather than creating the sentinel file (an operator action). Zero files in Phase B were touched.

**Phase C: DONE except item 1 (same G4 block).**
- Item 2 (`caseloadselect-website`): 3 edits (`system.ts:101`, `system/page.tsx:251`, `DecisionBrief.tsx:31` mockup card, inverting its score 2/10 to 8/10). `homepage-faq.ts:27`'s generic firm-definable-criteria list correctly left alone (PROSE class, not a citation of the four canonical axes). Typecheck clean.
- Item 3 (`Version3_CaseLoadSelect/website-v1`): `index.html`'s live interactive demo (label, both fixture scenarios with their axis values correctly inverted, the `dominant` narrative string reworded for the commercial-lease fixture, three array literals) plus `solutions-two-lawyer.html`. Verified live in the Browser pane, not just by reading the diff: clicked through to the commercial-lease fixture and confirmed the card renders "SIMPLICITY 4/10" with the reworded narrative. Found and fixed a second FAQ hit (line 2568) that the plan's file list had missed, by reading the live page text after the first fix. The `CaseLoadSelect_Website_Offline_Preview` twin is a dated, auto-generated build snapshot whose own README says it will not update automatically; its source (already fixed) needs a regeneration Adriano cannot run from this session (the website project's own `CLAUDE.md` says local `next build` fails on this drive, Vercel-only). Flagged, not hand-patched.
- Item 4 (sample-report source): `brief_html.html`'s axis card relabeled and score inverted (4 to 6); `brief_json.json` deliberately left untouched (mirrors the DB shape, never changed); `README.md` updated to state that split explicitly, plus its "Result" line.
- Item 5 (Sales): 6 edits across `Case_Selection_Architecture_v2.html` ("Value + Complexity" block, reframed via Value doctrine to "Case simplicity relative to practice area"), `StrategyCall_Deck_V6.html:3096`, `StrategyCall_Page_V1.html` (4 hits: one directional-flip reframe to "Band A, complex, high-value case", three axis-list swaps), `Competitive_Comparison_v2.html:618`. Everything else in the folder (roughly 14 more matching files) correctly classified as legacy-CPI or prose and left alone; `StrategyCall_Page_V1.html:1666`'s "High-complexity matter" line has no Band/axis citation and was correctly left as prose.
- Item 6 (Brand book): 4 edits in the HTML, 2 in the MD mirror (the MD has no counterpart for two of the HTML hits, a pre-existing HTML/MD content gap, not something this pass introduced). PDF regeneration path not discoverable from the folder; flagged pending rather than guessed.
- Item 7 (KB): KB-26:170, KB-27 (both hits).
- Item 8 (design doc): checked, zero AXIS-class hits found (both hits are the never-touch fee-estimate prose pattern); no edit needed.
- Item 9 (LSO read): applied inline; all rewrites were neutral factual swaps or the Value-reframe pattern the plan specified, no new promotional or superlative language introduced.

**Phase D: DONE, one item revised on inspection.** Root `CLAUDE.md`: bands A-E to A-D fixed; the engine-sync-drift claim corrected to state it was cleared 2026-06-09 and reverified green 2026-07-15. App `CLAUDE.md`'s GHL webhook reference: checked and found already correct (says v3; the "v2" the plan flagged is an accurate historical changelog entry, not live doctrine), so no edit was made, since none was needed. Sandbox `CLAUDE.md` test count: 136/11 files corrected to 388/27 files. Memory file `feedback_marketing_no_cpi_numeric_score.md` and its `MEMORY.md` index line updated to the new vocabulary, with an explicit note that `CpiSection.tsx`/screen-demo are still pending the G4 sentinel so the memory doesn't overclaim.

**Phase E: DONE, turned out to need no runtime change.** Re-derived the FOLLOWUPS row-188 context before editing: the internal DISCOVERY label `COMPLEXITY:` in `PROMPT_RUNTIME.txt:64` is the internal category name (mirrors the engine's internal `complexity` variable), and its own governing spec (`VOICE_AGENT_SPEC.md` v2.5) already documents it as "COMPLEXITY (Simplicity inverse)". Changing the label to `SIMPLICITY:` while the question content asks about complexity-increasing signals would have been wrong, not a fix. Left `PROMPT_RUNTIME.txt` untouched. Added a changelog entry to `VOICE_AGENT_SPEC.md` recording DR-103 as the reference for this naming split, then caught, on a second read of the row-188 text, that the row asks for something broader (a DR-040 amendment justifying four-axis discovery as non-gatekeeping) that DR-103 does not address, and corrected the changelog entry before it overclaimed; row 188 stays open for that separate doctrine question. No live-agent edit was needed, so Gate G2 never came into play.

**Phase A: DONE and verified.** Read all three named files plus every `score_version` reference first. Found `scorePortToColumns`'s version is a default parameter (`= 1`) never overridden at any of its 3 call sites, so every live-computed port is version 1 today. Reworded the explanation prose in `scoring-port.ts`. Bumped the default to a new exported `CURRENT_SCORE_VERSION = 2` in `scoring-port-persistence.ts`, alongside an exported `HISTORICAL_SCORE_VERSIONS = {1}` so the versioning intent has one source of truth. Updated both shadow comparators (`scoring-shadow.ts`'s `diffRow` plus its anomaly check, `scoring-port-read.ts`'s `shadowCompareScoringPort`) to stop flagging `score_explanation`/`score_version` disagreement when the persisted version is a known historical one, proven with a new test (`scoring-port-read.test.ts`) asserting zero drift warnings for a stored v1 row against a fresh v2 recompute, built from the fixture's real computed confidence/completeness rather than guessed literals, so the test cannot pass by accident. Updated the 3 hardcoded `toBe(1)`/wording assertions the plan flagged. Full targeted run: 43/43. Full app suite: 4864/4866 (2 failures plus 4 crashed suites, all pre-existing and unrelated: missing `OPENROUTER_API_KEY`/OpenAI credentials, a file missing from this WIP branch, one pre-existing assertion; same categories as the pre-Phase-A baseline). Typecheck: zero new errors. Engine directory (`src/lib/screen-engine/`, sandbox) confirmed untouched via `git diff --stat`, so no DR-033 sync obligation was triggered.

**Phase F: NOT attempted.** Gate G1 is unresolved. Nothing in this session was committed; `git status` on the app repo still shows the same unrelated dirty WIP plus now these Phase A/D-in-app edits, all uncommitted.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-16 | Sonnet handoff v1 | Phases A, C (partial), D, E executed and verified this session; Phase B plus C item 1 blocked on G4; Phase F blocked on G1 | H | docs/simplicity-axis-sonnet-handoff-v1.md Section 3; docs/simplicity-axis-unification-plan-v1.md | Adriano creates the G4 sentinel (or accepts B/C-1 stay deferred) and answers G1 (branch/deploy) so Phase F can commit, push, and deploy | Adriano | Open |
| 2026-07-16 | Sonnet handoff v1 | Offline-preview website snapshot (Version3_CaseLoadSelect/CaseLoadSelect_Website_Offline_Preview/system/index.html) is stale relative to its now-fixed source; it is a dated auto-generated build this session could not regenerate (Vercel-only build per that project's own CLAUDE.md) | L | CaseLoadSelect_Website_Offline_Preview/ | Regenerate from the caseloadselect-website project next time it is built or deployed | Adriano | Open |
| 2026-07-16 | Sonnet handoff v1 | Brand book PDF (BrandBook_ACTS_V1.pdf) not regenerated; HTML and MD sources fixed but no regeneration script found in the folder | L | 01_Brand/BrandBook/BrandBook_ACTS_V1.pdf | Regenerate via whatever WeasyPrint or production step was originally used | Adriano | Open |
| 2026-07-16 | Sonnet handoff v1 | FOLLOWUPS row 188 only half-closed: DR-103 settles the axis-naming question for voice, but the row also asks for a DR-040 amendment justifying four-axis voice discovery as non-gatekeeping, which is unaddressed | M | 00_System/FOLLOWUPS.md row 188; DR-040 | Scope a separate DR-040 amendment session; do not close row 188 until that lands | Adriano | Open |
