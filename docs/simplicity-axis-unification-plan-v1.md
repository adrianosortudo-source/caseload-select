# Simplicity Axis Unification Plan v1

| | |
|---|---|
| Date | 2026-07-15 |
| Status | Phases 1-2 and 4 (partial) SHIPPED. See Section 11 for exactly what and what remains. |
| Owner | Adriano |
| Scope | CaseLoad Screen four-axis display vocabulary (Complexity vs Simplicity) |
| Source | 12-agent blast-radius investigation (engine, LLM layer, persistence, transport, UI, tests, docs, live Supabase, GHL fields) plus completeness critique, 2026-07-15 |
| Decision record | DR-103, `00_System/01_Doctrine/DECISION_RECORDS.md` |

## 1. What the investigation found

The request was: rename Complexity to Simplicity and invert its polarity so all four axes read higher-is-better.

**Finding 1: this decision was already made once, and already reverted once.**

- Methodology decision **D012 (2026-05-05)**: Complexity renamed to Simplicity in the lawyer-facing brief, display-only inversion (shown score = 10 − complexity), internal scoring unchanged. D016 reframed the reason strings to be label-neutral. Recorded in `05_Product/CaseLoad_Screen_2.0_Methodology_v1.html:1158` and `CaseLoadScreen_2.0_2026-05-03/docs/methodology.md:463`.
- **2026-06-05 revert**: the app brief renderer went back to raw Complexity "per operator direction... That label confused lawyers (who think in terms of complexity, not simplicity)". The rationale lives in the block comment at `src/lib/screen-brief-html.ts:544-561`, and `src/lib/__tests__/screen-brief-html.test.ts:107-130` pins the revert (asserts the brief does NOT contain `>Simplicity<`).
- No DR records either the rename or the revert. FOLLOWUPS row 188 (open since 2026-06-10) already owes a DR for the voice channel naming the axes Value / Simplicity / Urgency / Readiness.

**Finding 2: production is split-brain today.** The revert only landed on the brief renderer. Everything else kept D012.

| Says SIMPLICITY today | Says COMPLEXITY today |
|---|---|
| Triage queue cards: `TriageQueueCard.tsx:97` computes 10 − complexity_score, label "Smp" at :328 | Lawyer brief axis cards: `screen-brief-html.ts:827` (the surface in the screenshot that triggered this request) |
| Admin queue: `admin/triage/page.tsx:347, 509` (same inversion) | App `CLAUDE.md:140` ("value, complexity, urgency, readiness") |
| Persisted band summary string: `band.ts:683` writes "Simplicity ${10 − complexity}/10" into every brief_json (app + sandbox, byte-synced) | Brand book vocabulary: `BrandBook_ACTS_V1.html:3312` (+ .md + .pdf) |
| CRM Bible v5.1, which LOCKS the model: "display label is Simplicity (10/10 = clean simple matter); engine variable is Complexity (negative coefficient); the CRM should always speak the lawyer-facing language" | Sales: `StrategyCall_Page_V1.html` (3 axis mentions), `StrategyCall_Deck_V6.html:3096`, Case Selection Architecture one-pager |
| GHL custom fields (verified location): `contact.simplicity_score` "Higher means simpler", band_subtrack option "High value low simplicity"; no complexity-named field exists | Marketing: `CpiSection.tsx:79` (live homepage), `caseloadselect-website` (2+ files), `Version3_CaseLoadSelect/website-v1` (index + solutions pages), offline preview |
| Voice spec: `VOICE_AGENT_SPEC.md:331` defines "COMPLEXITY (Simplicity inverse)"; FOLLOWUPS 187-188 name the four axes with Simplicity | Voice runtime prompt: `00_System/04_Templates/voice/PROMPT_RUNTIME.txt:64` discovery item 4 says "COMPLEXITY:" (and the live DRG agent + snapshot) |
| Sandbox brief renderer: `CaseLoadScreen_2.0_2026-05-03/src/brief-render.ts:511,529` still renders "Simplicity" with invertScore:true (never got the revert) | KB-26 (`:170`), KB-27 (`:391`), sample-report-source (html + json + README), triage-card design prototype |
| Schema and route doc comments: `supabase/schema.sql:287-288`, `api/intake-v2/route.ts:32` ("engine-internal (drag); displayed as Simplicity per D012") | Screen-demo lead magnet: "Matter complexity {v}/25" on ReportView, emailed PDF, and quiz copy (legacy CPI shape, see Section 5) |

So this is not "rename an axis." It is: **resolve the 2026-06-05 revert, pick one vocabulary, and unify every surface on it.** Doing nothing leaves the split; the screenshot surface (brief) and the queue card beside it currently disagree about the same lead.

**Finding 3: the axis is fully deterministic and the LLM never sees it.** Gemini's extraction schema returns slot strings plus `__matter_type` / `__detected_language` only (verified independently by two agents). The rename has zero prompt-engineering cost and zero extraction-regression risk. The 57 "complexity" occurrences in `screen-prompt.ts` belong to the frozen legacy CPI v2.1 engine (0-25 scale, opposite polarity) and stay out of scope.

## 2. The one architecture decision

Every conditional finding in the inventory resolves off a single choice.

### Option A: display-only unification (RECOMMENDED)

Keep the engine, wire contract, and database exactly as they are. `complexity` stays the internal variable (0-10, drag). Every lawyer-facing and prospect-facing surface renders **Simplicity = 10 − complexity** with flipped valence. This is D012, which is already how the queue cards, the CRM Bible, the GHL field set, and the sandbox brief behave.

- Zero SQL. Zero wire-contract change. Zero engine edits, so zero DR-033 sandbox-sync work and zero band-math risk.
- Test surface: 2-4 files (mainly rewriting `screen-brief-html.test.ts` to pin the new labels).
- Historical rows: queue cards already render all rows correctly; only frozen `brief_html` snapshots keep old labels (Section 6).

### Option B: engine-deep rename (REJECTED, documented for the record)

Rename `FourAxisScores.complexity` to `simplicity`, invert the stored values, rename `screened_leads.complexity_score`, bump the wire contract. Cost: DDL migration + CHECK-constraint recreate; a value backfill that directly conflicts with DR-059 (no retroactive recompute); a dual-key acceptance window on `/api/intake-v2` because the sandbox SPA deploys separately with no git (`intake-v2-security.ts:206` 400-rejects any body missing `axes.complexity`, so ordering mistakes drop live intake); double-inversion traps in the two queue files that already invert at display time; ~12 test files plus regeneration of the axis-input manifest, whose derive script parses `band.ts` by function-name string literals and throws on any scorer rename; and the band formula itself is NOT mirror-symmetric (complexity is subtractive drag excluded from liftMax at `band.ts:677-679`, so a naive "simplicity as lift" recast silently shifts every lead's band unless the internal math keeps drag = (10 − simplicity) × 0.4).

Option B buys internal naming purity and nothing else the lawyer or operator can see. Given the stated constraint (the Screen is sophisticated; do not break it), Option A is the plan. The in-code comments already contemplate exactly this convention.

### The alternative end state, for completeness

Unifying on **Complexity everywhere** (re-reverting the queue cards, CRM Bible, GHL fields, voice spec back to raw complexity) is coherent too and touches fewer prose surfaces. It keeps the polarity inconsistency that triggered this request (three axes up-good, one down-good) and contradicts the GHL field set already provisioned. Not recommended, but if the 2026-06-05 confusion argument still holds, this is the honest fallback, and it should then get its own DR so the system stops oscillating.

## 3. Why bands cannot move under Option A

- `bandFromAxes` (`band.ts:670-728`) consumes raw complexity as drag. Option A touches no engine file. The band summary string at `band.ts:683` already emits the Simplicity form.
- Badge thresholds mirror exactly on integers: `bandOf()` (`screen-brief-html.ts:581-585`) maps score >= 7 High, >= 4 Moderate, else Low; under s = 10 − x, complexity 0-3 (Low) becomes simplicity 7-10 (High), 4-6 stays Moderate, 7-10 becomes 0-3. The same function is reused unchanged on the inverted display score.
- Proof harness: the full app suite (4,754 tests / ~240 files, `npm test`) and sandbox suite (382 tests / 27 files) run unchanged except for the display-pinning files listed below. Both suites green with only those edits IS the band-invariance proof; no new golden master needs building.

## 4. Change list (Option A)

### 4.1 App code

| File | Change |
|---|---|
| `src/lib/screen-brief-html.ts` | The core edit. Label at :827 becomes Simplicity; axisCard score at :790 renders 10 − score for this axis; `axisKind()` :753-769 valence flips (High simplicity = positive/navy, Low = drag/red); `axisProse()` complexity branch :706-727 (18 matter-family strings) rewritten in simplicity language; update the :544-561 history comment to record the re-inversion decision. |
| `src/lib/scoring-port.ts` | Lawyer-facing explanation prose at :166 ("High complexity drags the weighted score down.") rewritten (e.g. "Low simplicity drags the weighted score down."). Decide `score_version` bump to 2; if bumped, `scoring-port-read.ts` shadow comparator must accept it in the same commit or every brief open logs drift warnings for all firms (read_scoring_port is default ON fleet-wide since migration 20260702153335, not a DRG pilot). |
| `src/components/portal/TriageQueueCard.tsx` + `src/app/admin/triage/page.tsx` | No math change (already inverted). Optional: expand label "Smp" if desired; verify the two files stay in lockstep. |
| `src/app/(marketing)/components/CpiSection.tsx:79` | "value, complexity, urgency, and readiness" becomes "value, simplicity, urgency, and readiness". Note: the (marketing) route group is edit-blocked by `.claude/hooks/check-website-boundary.mjs`; the exception process applies. |

### 4.2 Tests (app)

- `screen-brief-html.test.ts:95-130, 204-217`: rewritten to pin Simplicity labels, inverted display score, flipped valence classes. This test currently pins the 2026-06-05 revert; flipping it is intentional, not breakage.
- `scoring-port.test.ts:127`: explanation-copy assertion follows the new prose.
- `band-scoring-coverage-contract.test.ts:312`: comment references the summary string; verify only.
- Everything else (engine, wire, manifest, sandbox suites) runs unchanged.

### 4.3 Sandbox (`CaseLoadScreen_2.0_2026-05-03`)

- `src/brief-render.ts:511-531` already renders Simplicity with invertScore:true. Verify its kind classes match the app's flipped valence; no engine edits, so no sync-manifest churn. If any cosmetic edit lands: vitest green, `npx vite build`, `npx vercel --prod --yes` (no git, no revert path, deploy last).
- `docs/methodology.md`: append a D-entry recording the re-unification (supersedes the 2026-06-05 revert; D012 becomes the standing convention). Mirror in `05_Product/CaseLoad_Screen_2.0_Methodology_v1.html`.

### 4.4 Voice

- `00_System/04_Templates/voice/PROMPT_RUNTIME.txt:64`: discovery item 4 label "COMPLEXITY:" reworded (the question content, other parties and existing documents, stays; only the internal label changes).
- Live DRG agent (GHL agent ID `6a0e223266dcf5cad976f3ae`): apply the same edit in GHL, then refresh the disk snapshot `06_Clients/DRGLaw/04_Capture/DRG_Voice_Agent_Prompt_LIVE_snapshot_2026-06-10_v2.4.txt`. First diff the live prompt against the snapshot; it may have drifted since 2026-06-10.
- `VOICE_AGENT_SPEC.md`: changelog entry. This closes the FOLLOWUPS row-188 DR debt inside the same DR.

### 4.5 Doctrine and docs

- **Register the DR first.** The registry (`00_System/01_Doctrine/DECISION_RECORDS.md`) ends at DR-099 today; take the next free number. The guard hook `check-dr-registry.mjs` blocks any doc referencing an unregistered number, so: append the DR, then edit docs. The DR must explicitly name and supersede the 2026-06-05 revert and its rationale, or the system oscillates a third time.
- App `CLAUDE.md:140` axis list; also fix the stale "webhook contract v2" reference (the contract doc is v3) and note bands are A-D live (A-E is legacy CPI).
- KB-26 `:170` (axis-card hierarchy rule), KB-27 `:391`.
- Root `D:\...\CLAUDE.md`: "bands (A through E)" line is stale regardless of this change.
- Memory layer (after ship): `feedback_marketing_no_cpi_numeric_score.md` hard-codes "value/complexity/urgency/readiness"; single-file edit plus its MEMORY.md index line. Verified to be the only memory file teaching the old name.

### 4.6 Sales and marketing copy sweep

Generate the final list by grep at execution time (`-i "complexity|simplicity"` per folder), not from this table; the investigation found agents' memory-built lists undercounted (23 matching files in 02_Sales alone). Known axis-bearing surfaces:

| Surface | Note |
|---|---|
| `02_Sales/StrategyCall_Page_V1.html` (:1666, :1701, :1829, :2076, :2084) + `02_Sales/Pitch/StrategyCall_Deck_V6.html:3096` | Carries the directional-flip hazard: "Band A · high-complexity case" frames complexity as the prize. See Section 5 copy doctrine. |
| `02_Sales/OnePagers/CaseLoad_Select_Case_Selection_Architecture_v2.html:1143-1146` | CPI block naming the axis. |
| `01_Brand/BrandBook/BrandBook_ACTS_V1.html:3312` + `.md` + regenerate `.pdf` | Three renditions move together. |
| `05_Product/caseloadselect-website/src/app/system/page.tsx:251` + `src/data/system.ts:101` | Pending-cutover site. Sweep the whole repo. |
| `Version3_CaseLoadSelect/website-v1/` (index.html :2346-2347, :2568, :2828-3049 JS keys; solutions-two-lawyer.html:456) + `CaseLoadSelect_Website_Offline_Preview/` | Static twins of the pending site. |
| `Version3_CaseLoadSelect/sample-report-source/` | BOTH artifacts: `brief_html.html` AND `brief_json.json` (four_axis key + axis_reasoning) + README; regenerate the pair together. |
| `docs/design/triage-card-redesign-prototype.html` (app repo) | Design reference for the exact surface being unified. |
| Screen-demo lead magnet (`_data/questions.ts`, `_lib/scoring.ts:170`, `_components/ReportView.tsx:243`, `_lib/report-pdf.tsx:424`) | NOT a rename target for the axis label: see Section 5. |
| Reference implementations already converted (do not touch backward) | `05_Product/Website/caseload-select-demo.html` + `update_briefs.py` are already on the Simplicity convention with correct polarity; they are the copy reference. |

## 5. The screen-demo trap and the copy doctrine

**Screen-demo is opposite-polarity by design.** Its mini scorer is legacy-CPI-shaped: "Matter complexity" is a 0-25 sub-axis INSIDE Value where MORE complexity ADDS points (complex matters proxy higher fees). Relabeling it "Simplicity" would print "Simplicity 25/25" on the most complex fixture: actively wrong on an emailed, LSO-stamped PDF. Decision needed (Section 9): relabel the sub-axis to something non-conflicting ("Depth of work" is the suggested candidate) as part of this pass, or schedule the demo's rebuild onto the real four-axis display as separate work. The demo already skirts the standing no-numeric-CPI rule; this is the natural trigger to decide.

**Directional copy rule.** Sales and diagnostic copy repeatedly frames HIGH complexity as the prize ("estates where the complexity and the value sit"; the Desired-Client worksheet lets firms prefer complex multi-issue work). That positioning is correct: complex matters are often the consultative, revenue-bearing work. The reconciliation, already locked in the CRM Bible, is: **low simplicity = consultative work, not bad work; Value carries the fee story.** Every rewritten sentence follows that framing, never "simpler is better." All reworked marketing sentences get LSO 4.2-1 re-review.

## 6. Historical data

Live production numbers (queried 2026-07-15, prod `ssxryjxifwiivghglqer`):

- 58 total `screened_leads` rows; `complexity_score` non-null on all 58.
- 44 archived (the known DRG test set). **14 live rows**, including a real DRG lead created 2026-07-14 currently in status `triaging`. The "all test data" memory snapshot is stale; this ships onto a table with in-flight production rows.
- 6 live rows carry `four_axis.complexity` inside brief_json (3 DRG + 3 Hartwell [DEMO]); 4 live rows have the `axis_reasoning` column; 7 live rows are tool-calculator briefs with no four_axis block at all (readers must not assume the key exists).

Under Option A nothing in the data changes. Two display consequences and the recommended handling:

1. **Queue cards**: already invert at read time for every row, historical included. Correct on day one.
2. **Frozen briefs**: `brief_html` is rendered once at intake and stored (DR-059); old briefs keep "COMPLEXITY N/10" cards. Recommended: **accept the mixed vintage.** Only 6 live rows are affected, 3 of them demo-firm. If zero tolerance is wanted, the sanctioned path is an explicit one-shot re-render of `brief_html` for the 6 rows via the reclassify renderer path, scoped as re-render-only (no engine recompute, so no band movement). Note the reclassify route re-renders with the current renderer on any future operator reclassify anyway, so historical briefs convert one-by-one over time regardless.

No brief_json schema-version marker exists. Option A does not need one (keys and polarity never change). If Option B is ever revisited, adding a version marker becomes mandatory first.

## 7. Exclusion list (a mechanical find-and-replace would corrupt these)

- `estate_complexity` SLOT id (`slotRegistry.ts:3280`, selector, control, discovery-floor): a lead-facing question id persisted in `slot_answers`. Never rename.
- The entire legacy CPI v2.1 constellation: `screen-prompt.ts` (57 refs, calibrated complexity_delta values with LIFT polarity), `default-question-modules.ts` (~750 refs, 521 KB seeding bank), `scoring.ts`, `cpi.ts`, `cpi-calculator.ts`, `score-components.ts`, `score-rationale.ts`, `case-value.ts`, `few-shot-examples.ts`, the `leads` table columns (0-25 scale), `/api/screen`, `/api/v1/leads` (external Bearer-token JSON that returns `complexity_score`), `intake_sessions.scoring`, `cpi_snapshot` keys. Still deployed and reachable; retired for new surfaces; decommission is a separate coordinated project.
- `report.ts` fee-estimate prose ("depending on complexity", "Estate complexity" detail label): generic legal language, not the axis.
- Legacy tests pinning legacy engines (`scoring.test.ts`, `score-components.test.ts`, `llm-rewrite.test.ts` fixtures).
- Worktree and copy dirs: `05_Product/.wt-codex-audit-pr25/`, `.wt-lawyer-hide-deploy/`, `caseload-select-app-fix/`, archives. Canonical app + sandbox only.
- GHL client-deployment template `04_Playbooks/04_Screen/ClientDeployments/example_law/CRM_Deployment/03_Scoring_Config.md`: legacy-CPI-shaped (0-25). Do not mechanically rename; needs its own in/out decision (Section 9).

## 8. Execution phases

**Phase 0, preconditions (before any edit):**
1. Adriano answers the Section 9 decision sheet; the DR is appended to the registry (guard hook requires registration before reference).
2. Git hygiene: the app checkout sits on `fix/restore-marketing-homepage` with a dirty tree that includes `src/app/api/tool-intake/route.ts` and the content-cadence-panel WIP the memory layer says not to blind-ship. Pick the base branch explicitly (branch from `main`), reconcile or stash the dirty files, and run the untracked-dependents check before any `git add`.
3. Confirm both suites green pre-change (records the golden-master baseline): app `npm test`, sandbox `npm test`.
4. Marketing boundary hook: confirm the (marketing) exception process for `CpiSection.tsx` and the screen-demo subtree.

**Phase 1, app display code + tests** (Section 4.1 + 4.2). Typecheck, lint, full suite green.
**Phase 2, sandbox verify + methodology D-entry** (Section 4.3). Deploy sandbox last, only after app is green.
**Phase 3, voice** (Section 4.4): template, live GHL agent, snapshot, spec changelog.
**Phase 4, doctrine + docs** (Section 4.5).
**Phase 5, copy sweep** (Section 4.6): grep-generated list, classify axis-vs-prose-vs-legacy per hit, rewrite under the Section 5 copy rule, LSO re-review, brand book PDF regen, sample-report pair regen.
**Phase 6, verify end-to-end:** deploy app (commit + push, git integration; never CLI-only); EN + PT smoke intake through the prod widget (conversation, brief, queue card, and brief page all say Simplicity with correct polarity); open one historical lead and confirm the accepted mixed-vintage rendering; trigger one screen-demo report and check the relabeled PDF; confirm no shadow-comparator warning storm in logs.
**Phase 7, close:** FOLLOWUPS rows updated (this plan's rows plus row 188 closed), memory files updated (stale test-data memory already corrected 2026-07-15; axis-vocabulary memory after ship), DR status confirmed.

**Rollback:** app is a clean git revert (display-only, no data written in the new shape). Sandbox: nothing shipped, or redeploy the previous build. Voice: restore the snapshot prompt. No database rollback exists or is needed.

**Effort:** Phases 1-3 are roughly a half-day of build plus test rewrite. Phases 4-5 are a separate copy-editing day (the doc/sales sweep is wider than the code change). Option B for comparison would be multi-day with a coordinated two-repo deploy window and a doctrine exception.

## 9. Decision sheet (blocking)

1. **Confirm the re-inversion with the history in view.** The 2026-06-05 revert said lawyers think in complexity, not simplicity. The counter-arguments now: the queue cards beside the brief already show Simplicity (the split is itself confusing), all four axes reading up-good is the stronger scan pattern, the CRM Bible and GHL fields already committed to Simplicity, and the operator (you) independently re-derived the same conclusion from the screenshot. If the confusion argument still wins, the alternative is unifying on Complexity everywhere (Section 2), which also deserves a DR.
2. **Label word:** Simplicity (matches CRM Bible, GHL fields, D012) or another term (Manageability was floated in chat). Recommendation: Simplicity; every already-shipped surface uses it.
3. **Historical briefs:** accept mixed vintage (recommended, 6 live rows) or one-shot re-render of those 6.
4. **Queue label:** keep "Smp" or spell out.
5. **Screen-demo sub-axis relabel:** "Depth of work" now, or schedule the four-axis demo rebuild as separate work.
6. **score_version bump** to 2 with comparator update (recommended) or leave explanations versioned as-is.
7. **GHL deployment template** (`03_Scoring_Config.md`): freeze with the legacy product or rebuild on the four-axis field set before firm #2 onboards.
8. **Operator manual check, DRG GHL sub-account `KwpSaMUehIN25dMG4WZB`:** both MCP tokens are scoped elsewhere; the verified location (TH71...) already uses simplicity_score with no complexity field. Confirm DRG's custom fields and any workflow branching on axis names in the GHL UI. This is the one surface the investigation could not verify programmatically.

## 10. Adjacent debts surfaced (not this change, now on record)

- **voice-realtime (DR-048) exists on no git branch at all**: `git log --all` shows zero commits for `src/lib/voice-realtime/` despite the roadmap saying it was built. When it lands it will write `complexity_score`; the DR should state the persistence contract it must conform to.
- **Old Supabase project `qpzopweonveumvuqkqgw`** is still a live older copy and app `.env.local` still points local dev at it; local dev intakes diverge from prod semantics. Retire-vs-harden decision pending (already in memory).
- **Orphaned GHL axis fields**: the verified location carries simplicity_score / readiness_score / cpi_score fields that no current transport populates (the v3 webhook envelope carries no axis values). Populate, or retire the fields.
- **Stale doc refs**: app CLAUDE.md says webhook contract v2 (it is v3); root CLAUDE.md says bands A-E (live Screen 2.0 is A-D); root CLAUDE.md engine-sync note still claims selector.ts/llm-extractor drift (sync verified green today, drift cleared 2026-06-09 per DR-068); sandbox CLAUDE.md test count stale (says 136, actual 382).
- **Legacy v2.1 decommission** (/widget, /api/screen, leads table, default-question-modules): one coordinated future project, not piecemeal.

## 11. Execution log (2026-07-15)

Shipped, using the recommended default at every open decision-sheet item (Adriano can revisit any of these; nothing below is irreversible):

- **DR-103 registered** superseding the 2026-06-05 revert, using the label "Simplicity."
- **`screen-brief-html.ts`**: the lawyer-brief axis card now displays Simplicity (`10 - complexity`), inverted badge, inverted score. Prose and card-colour (positive/pending/drag) are computed from the RAW complexity score, unchanged, since they describe a fact that does not change under the relabel.
- **`screen-brief-html.test.ts`**: the tests that previously pinned the 2026-06-05 revert now pin the new display; 28/28 pass.
- **Sandbox `brief-render.ts`**: verified, needed zero changes. It already implemented this exact display and was never reverted.
- **Methodology docs**: D018 appended to both `CaseLoad_Screen_2.0_Methodology_v1.html` and the sandbox `docs/methodology.md`, recording the re-adoption and pointing at DR-103.
- **App `CLAUDE.md`**: the four-axis line corrected to Value/Simplicity/Urgency/Readiness, with the internal-vs-display distinction spelled out so it cannot drift again silently.
- **Verification**: app suite 4,847/4,850 pass (the 3 failures and pre-crash suites are pre-existing, environment- or WIP-branch-caused, none touch scoring/axes); sandbox suite 388/388 pass; `tsc --noEmit` zero errors on anything touched.

Explicitly deferred, in priority order:

1. **`scoring-port.ts` explanation prose** ("High complexity drags the weighted score down.") and the §9 item 6 score_version bump. New finding beyond the original investigation: `src/lib/scoring-shadow.ts:168-169` hardcodes `score_version must be null or 1` as a validation rule, not just the comparator in `scoring-port-read.ts`. Bumping the version touches at least two independent files with live, fleet-wide (all-firms) drift-detection logic. This needs its own careful pass, not a same-night addition.
2. **Marketing/sales copy sweep** (Section 4.6): `CpiSection.tsx`, the pending-cutover `caseloadselect-website`, `Version3_CaseLoadSelect/website-v1`, the sample-report source pair, the sales deck and one-pagers. Left untouched per the plan's own phasing (Phase 5, a separate pass) and because the legacy `(marketing)` route group is documented as frozen/historical.
3. **Voice**: `PROMPT_RUNTIME.txt` discovery-item wording, the live GHL agent prompt, and its disk snapshot. Not touched; editing a live client-facing voice agent is a distinct, higher-stakes action than a code display change.
4. **Screen-demo sub-axis relabel** ("Depth of work" or equivalent) and the GHL client-deployment scoring template decision (Section 9 items 5 and 7). Untouched.
5. **Git hygiene**: the app repo is on `fix/restore-marketing-homepage`, ahead 3 of its remote, with substantial unrelated dirty state (Firm Assist WIP, content-cadence panel, `tool-intake-derive.ts` edits from another task). None of it was touched by this build and none of the files edited above were part of that dirty set, but nothing in this session was committed. Adriano decides how to sequence a commit alongside that other WIP.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-15 | Simplicity axis plan v1 | Decision sheet §9 blocks execution; DR must be registered before any doc references it | H | 00_System/01_Doctrine/DECISION_RECORDS.md; 05_Product/caseload-select-app/docs/simplicity-axis-unification-plan-v1.md | Adriano answers §9; register next free DR superseding the 2026-06-05 revert; then execute Phases 1-7 | Adriano | Open |
| 2026-07-15 | Simplicity axis plan v1 | DRG GHL sub-account custom fields + workflows unverifiable via MCP (token scoped to another location) | M | GHL KwpSaMUehIN25dMG4WZB | Operator checks Settings > Custom Fields and Automation > Workflows for axis-named fields/branches | Adriano | Open |
| 2026-07-15 | Simplicity axis plan v1 | voice-realtime (DR-048) code exists on no git branch; future landing will write complexity_score unsupervised | M | 05_Product/caseload-select-app/src/lib/voice-realtime/ | Locate or rebuild under version control; gate landing on the axis display contract | Claude | Open |
| 2026-07-15 | Simplicity axis plan v1 | screened_leads "all test data" memory stale: 14 live rows incl. real DRG lead 2026-07-14 in triaging | M | 06_Clients/DRGLaw; screened_leads | Memory corrected 2026-07-15; treat DRG as receiving production intake in any migration window | Claude | Done |
| 2026-07-15 | Simplicity axis plan v1 | Stale doc refs found during sweep (webhook v2 vs v3, bands A-E vs A-D, engine-sync drift note, sandbox test count) | L | CLAUDE.md (root + app); CaseLoadScreen_2.0_2026-05-03/CLAUDE.md | Fix in Phase 4 of this plan or as standalone hygiene pass | Claude | Open |
