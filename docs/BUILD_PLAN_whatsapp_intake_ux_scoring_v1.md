# BUILD PLAN: WhatsApp Intake UX + Advisory Scoring v1

Status: EXECUTED 2026-08-13 (see EXECUTION NOTES below for corrections made during implementation).
Authored: 2026-08-13 (Opus analysis session). Executor: Sonnet, same day.
Source: live WhatsApp intake test at DRG Law Test (firm_id `eec1d25e-a047-4827-8e4a-6eb96becca2b`), 2026-08-07. Operator: Adriano.
Registered as DR-121 in `00_System/01_Doctrine/DECISION_RECORDS.md`.

## EXECUTION NOTES (read first — corrects the plan below)

Three things changed between this plan and what actually shipped, discovered while implementing with the real code open rather than from memory:

1. **WP-1's target order was redesigned, and is more precise than drafted below.** Hand-tracing the actual `selectNextSlot`/`getMatterGap`/`scoreFourAxes` interaction (not just the ordering *intent*) surfaced two facts the original analysis missed: (a) `computeCoreCompleteness`'s denominator is subtrack-blind — it counts every `tier:'core'` slot with `business_setup_advisory` in `applies_to`, including `advisory_concern`, which `solo_setup` can never answer (excluded by its own `applies_to_subtrack`). The completeness ceiling for solo_setup is 10/11 = 91%, never 100%, regardless of ask order. (b) `scoreValueSpecific`'s advisory branch defaults the value axis to 3 when `revenue_expectation` is unanswered, but the honestly-answered "$30,000-$100,000 (full-time, sole operator)" tier — the realistic answer in the field case — scores only 2 under DR-056. Front-loading `revenue_expectation` therefore raises completeness but can numerically *lower* the raw confidence ratio for that exact fixture. Both are pre-existing, out-of-scope findings, logged as followups, not fixed here. The shipped order (see `selector.ts` `MATTER_SPECIFIC_SLOT_ORDER.business_setup_advisory`) is: routing/subtrack (`advisory_path`, `co_owner_count`) → urgency inputs (`signed_anything`, `business_stage`) → readiness triple (DR-083 precedent, kept early) → remaining core-tier value/complexity drivers (`revenue_expectation`, `regulated_industry`, `employees_planned`, `cross_border_work`, `ip_planned`) → completeness-only core/proof slots that feed no scoring axis (`advisory_concern`, `documents_exist`) → pure-color qualification slots last. Verified precisely: at question 9 on a solo_setup fixture, completeness moves from 45% (old order) to 64% (new order); readiness and urgency are fed by question 7 in both orders (no regression); the value-axis quirk in (b) above means the raw confidence ratio does not mechanically improve for a mid-tier-revenue fixture even though completeness does. Full arithmetic and the regression tests are in `src/lib/screen-engine/__tests__/advisory-async-ask-order.test.ts`.
2. **WP-6's real target was NOT `report.ts`'s `buildOpenQuestions`.** That function only ever surfaces one "next question" plus a decision-gap message — it cannot produce a multi-item missing-fields list at all. The actual UI element matching the operator's report ("What email address...", "What is your postal code?") is the NAP block in `src/lib/screen-brief-html.ts` (`napBlock`), which renders a fixed 4-cell Name/Phone/Postal-code/Email grid and marks any absent cell "Not captured / Confirm on follow-up". Fixed there instead: when the Phone cell carries `system_metadata` provenance (channel-verified — WhatsApp wa_id, voice caller-ID), the Email and Postal-code cells' sub-label changes to "Not asked in chat" rather than "Confirm on follow-up", which the original wording shared with a field the lead was actually asked and did not answer. `screen-brief-html.ts` lives outside `screen-engine/`, so this fix needed no sandbox mirror. Tests: `src/lib/__tests__/screen-brief-html-nap-honesty.test.ts` (new file — the pre-existing `screen-brief-html.test.ts` carried unrelated in-flight changes on the working branch and was left untouched).
3. **`deriveAdvisorySpecificTask` deliberately does NOT map "All of the above"** to any single `advisory_specific_task` value (WP-4). Every other key maps one concern to one specific task; a lead who said "all of the above" did not pick one, so inventing a single downstream task would misrepresent them. The slot is left unfilled and gets asked on its own turn when the (now-later, post-WP-1) chain reaches it. Documented in a code comment in `slotEvidence.ts` at the point a future reader would expect the fourth map entry.

All other work packages (WP-0, WP-2, WP-3a, WP-3c, WP-5, WP-7) shipped as designed below, with implementation-level detail (exact regex patterns, exact copy, exact file/line targets) filled in from the real source rather than guessed. Full verification: `tsc --noEmit` clean, full app suite green, full sandbox suite green (388/388), `check-engine-sync.sh` green after copying the 9 touched engine files app→sandbox.

4. **WP-3b (the expectation line) was superseded at ship time, not shipped.** When `origin/main` was merged into the branch before the PR, main turned out to already carry C2 (the first-ask intro of 2026-08-07, `src/lib/channel-intake-intro.ts`): the same feature, requested by the operator directly, landed on main first with PT coverage (C4) and its own processor-level test. Two independent fixes for the same field complaint collided at merge. Resolution: C2 wins at both send sites; DR-121's `withIntakeExpectation` helper, its `intake_expectation` i18n keys, and its WP-3b test cases were removed during conflict resolution. The plan text for WP-3b below is retained as history; do not re-implement it.

## 1. The failing test, and what was verified in code

Test script: opener "i want to speak to a lawyers", then "open a business", then name "adriano", then walked through discovery. 11 questions total. Result: `business_setup_advisory`, Band B, LOW confidence, 34% complete, 9 fields listed missing on the brief (revenue, cross-border, hiring, IP, regulated industry, timing, business stage, email, postal code).

Root causes, verified against source (do not re-derive; spot-check anchors before editing):

| # | Finding | Anchor |
|---|---------|--------|
| R1 | The slots the four-axis scorer feeds on (`revenue_expectation`, `business_stage`, `signed_anything`, `hiring_timeline` and the readiness triple, `regulated_industry`) sit at or past position 9 in the solo/partner ask order, so an async session that ends near 11 questions never reaches them. Value and urgency axes read near zero, confidence (derived from the axis ratio in `bandFromAxes`) reads LOW, and completeness (core-tier fraction) reads ~34%. One cause, three symptoms. | `src/lib/screen-engine/selector.ts` getMatterGap advisory blocks (~lines 271-334); `band.ts` scoreValueSpecific advisory branch (~293), scoreUrgency advisory branch (~494), bandFromAxes (~670) |
| R2 | `business_setup_advisory` has NO entry in `MATTER_SPECIFIC_SLOT_ORDER`, so ask order falls to the scorer + gap chain. The map's own comment says advisory "keeps the scorer-default order until we audit each". This plan is that audit. | `selector.ts` ~line 571 |
| R3 | `advisory_path` evidence patterns include 'open a company' and 'start a business' but NOT 'open a business', which is what the operator typed. The pattern miss is why the routing question rendered at all (with the mismatched "Selling or closing down" option). Regex evidence writes `'explicit'` provenance, which counts as user-answered and skips the question. | `slotRegistry.ts` advisory_path def (~line 367-402); `slotEvidence.ts` extractSlotEvidence |
| R4 | `formatDiscoveryQuestion` renders `question\n\n1. X\n2. Y` with no reply guidance and no free-text invitation. The only numbering instructions in the live Meta path today are the `didnt_catch` re-ask clarifier and the out-of-range message. | `channel-intake-processor.ts` ~130-143 and ~915; `numeric-option-mapping.ts` ~193 |
| R5 | `DIGIT_REPLY_RE` accepts one digit only. "1 and 2 and 3" falls through to LLM extraction, which cannot map digits without question context, so the engine re-asks. The single-digit-only gap is acknowledged in the file comment as a future fix. | `numeric-option-mapping.ts` ~53-61 |
| R6 | `advisory_concern` ("What are you most concerned about?") has no "All of the above" option. | `slotRegistry.ts` ~449-453 |
| R7 | `SlotOption` has no description field, so options like "Professional services" carry no examples. | `types.ts` ~489-492 |
| R8 | The brief lists `client_email` and `client_postal_code` as missing on WhatsApp even though the wa_id already satisfies reachability (contact doctrine: name + one of email/phone). Two of the nine scary "missing" rows are structurally expected on this channel. | `report.ts` buildOpenQuestions (~1327) and open-questions/missing rendering |
| R9 | WhatsApp discovery is capped by `DISCOVERY_FOLLOW_UP_CAP = 12` in the processor (not by `QUESTION_BUDGET_BY_CHANNEL`, which has no whatsapp entry). Any matter chain longer than the cap can never complete on WhatsApp. This is the general condition behind R1. | `channel-intake-processor.ts` ~109-114 |

## 2. Non-negotiable constraints

1. **DR-033 engine sync.** Every file under `src/lib/screen-engine/` (including `i18n/*.json` and `types.ts`) is byte-mirrored to the sandbox at `../../CaseLoadScreen_2.0_2026-05-03/src/engine/`. Any edit lands in BOTH trees in the same commit. After each engine-touching WP: run `bash scripts/check-engine-sync.sh`, run the app suite, run the sandbox suite. The sandbox has no git; note in the final report that the operator redeploys it with `vercel --prod`.
2. **DR registry first.** WP-1 changes ask-order doctrine and needs a new Decision Record. Open `D:\00_Work\01_CaseLoad_Select\00_System\01_Doctrine\DECISION_RECORDS.md`, find the highest DR number, take the next free one, append the entry (append-only), THEN reference the number in code comments. The guard hook `.claude/hooks/check-dr-registry.mjs` blocks any Write/Edit that references an unregistered DR number.
3. **Do not touch calibration or thresholds.** `DR-055`/`DR-056` weights in `band.ts`, `INSIGHT_THRESHOLD_COMPLETENESS`, `BAND_A_COMPLETENESS`, the `bandFromAxes` ratio cutpoints, and `computeCoreCompleteness`'s formula all stay as they are. The reorder fixes the inputs; the formulas are not the defect.
4. **DR-059.** No recompute or backfill of historical `screened_leads` rows. New intakes only.
5. **Writing rules apply to code comments and lead-facing strings.** No em dashes anywhere (a hook blocks the write). No banned vocabulary. Use commas, colons, parens.
6. **Close the loop.** Commit per WP with conventional-commit messages referencing this plan, push, confirm the Vercel deployment reaches READY. Do not end with "operator must push".
7. Test data: the operator re-tests live after ship. After his re-test, clean rows for phone `16475492106` at firm `eec1d25e-a047-4827-8e4a-6eb96becca2b` from `channel_intake_sessions` and `screened_leads` via the Supabase MCP (same cleanup as 2026-08-07).

## 3. Execution order

| WP | What | Files (app side) | Mirrored? |
|----|------|------------------|-----------|
| 0 | Pin current behavior with a failing-flow regression test | new engine test file | yes (test lives beside engine tests in both trees) |
| 1 | Advisory explicit ask order (the scoring fix) | `selector.ts` | yes |
| 2 | Evidence patterns for clear openers | `slotRegistry.ts`, verify pass wiring | yes + verify |
| 3 | Message shape: per-question reply hint, expectation line, multi-digit acceptance | `channel-intake-processor.ts`, `numeric-option-mapping.ts`, `en.json`, `pt.json` | json only |
| 4 | "All of the above" on advisory_concern + downstream readers | `slotRegistry.ts`, `slotEvidence.ts`, `report.ts` | yes |
| 5 | Option descriptions (examples) | `types.ts`, `slotRegistry.ts`, `i18n/display.ts`, processor render, widget chips | partly |
| 6 | Brief honesty: channel-satisfied contact rows | `report.ts` | yes |
| 7 | Full verification + live re-test support | none | n/a |

WP-1 is the payload. If anything forces a scope cut, ship WP-0 through WP-3 and log the rest as followups.

## 4. Work packages

### WP-0: Regression test that pins the failing flow

Create `src/lib/screen-engine/__tests__/advisory-async-ask-order.test.ts` (and its sandbox mirror). Using the engine directly (initialiseState / runEvidencePass / applyAnswer / getNextStep / selectNextSlot), simulate the WhatsApp sequence:

1. State initialised from "open a business" (skip the contact_request opener mechanics; start from the classified state, `matter_type = 'business_setup_advisory'`, channel `whatsapp`).
2. Loop: `selectNextSlot`, answer each slot with a plausible mid-value option via `applyAnswer`, record the slot id sequence.
3. Assert the CURRENT order (this documents today's behavior): the readiness triple and `revenue_expectation` appear after `agreement_proof` and the qualification-tier slots, and the first 8 asks do not include `revenue_expectation`.
4. Compute `scoreFourAxes` and `computeCoreCompleteness` after 9 discovery answers and assert the current low numbers.

In WP-1 you will flip these assertions to the new intended order. Purpose: the diff between the two commits IS the proof of the fix, and any future drift breaks the test.

Also in WP-0: trace why the 2026-08-07 session finalized at 11 questions when the cap is 12 (opener + name turns are not discovery sends; the discovery counter and the operator's count may differ by the clarify/rejected turns). Read the Phase C block (`channel-intake-processor.ts` ~802-975) and write one paragraph in the WP-0 commit message stating the finalize trigger. Do not change behavior in WP-0.

### WP-1: Explicit ask order for business_setup_advisory

**Mechanism:** add ONE entry to `MATTER_SPECIFIC_SLOT_ORDER` in `selector.ts` (the same mechanism the 9 DRG matter types already use; `pickByExplicitOrder` runs before the scorer and skips slots whose `applies_to_subtrack` excludes the current subtrack). Do NOT rewrite the `getMatterGap` advisory chains: they keep gating insight and completeness exactly as today.

**Ordering intent** (verify every slot id and its `applies_to_subtrack` against `slotRegistry.ts` before finalizing; where the old getMatterGap chain excluded a slot for a subtrack but the registry does not restrict it, add the registry restriction so per-subtrack behavior stays comparable):

```
advisory_path            (routing; usually pre-filled by WP-2 evidence)
co_owner_count           (subtrack derivation; solo/partner/unknown)
business_activity_type   (easy momentum question; solo/partner)
business_stage           (urgency driver; solo/partner)
signed_anything          (crisis gate input, DR-055)
documents_exist          (buy_in only)
advisory_timing          (urgency driver; buy_in only)
revenue_expectation      (value driver)
hiring_timeline          (readiness)
other_counsel            (readiness)
decision_authority       (readiness)
ownership_split_discussed (partner only; selector already blocks it for solo)
advisory_concern         (partner/buy_in/unknown)
regulated_industry       (complexity)
setup_needs              (solo)
employees_planned
cross_border_work
ip_planned
business_location
```

Principle encoded: routing, then subtrack, then one easy concrete question, then the urgency/value/readiness drivers inside the first ~8 asks, then color. This extends DR-083 (readiness-early) to the full scoring set for the two long advisory chains.

**Known accepted behavior changes** (update tests deliberately, do not work around):
- buy_in leads may now see `signed_anything` (it applies to all subtracks in the registry and is a correct question for them).
- Sandbox `selector.test.ts` has expectations for `buy_in_or_joining` order; update them to the new intended order with a comment referencing the new DR.
- Update the stale `MATTER_SPECIFIC_SLOT_ORDER` header comment (it still says advisory keeps scorer-default order).

**DR entry (register first, per constraint 2):** title along the lines of "Advisory ask order front-loads scoring drivers for async channels". Body: the R1 finding, the DR-083 precedent, the explicit-order mechanism, and the rule that any matter chain longer than a channel's discovery budget must order scoring-critical slots inside the budget window.

**Tests:** flip WP-0 assertions; after 9 discovery answers on the new order, assert `revenue_expectation`, `business_stage`, `signed_anything`, and the readiness triple are all answered, `scoreFourAxes` produces non-zero value/urgency/readiness, and `computeCoreCompleteness` lands materially higher (assert a floor, for example >= 55, not an exact number). Extend `matter-aware-question-order.test.ts` with the advisory entry. Run BOTH suites.

### WP-2: Evidence patterns for clear openers

**Edit** `slotRegistry.ts` advisory_path `evidence_patterns['Starting a new business']`: add `'open a business'`, `'opening a business'`, `'open my own business'`, `'start my own business'`, `'open up a business'`, `'launch a business'`, `'launching a business'`, `'register a business'`, `'registering a business'`, `'open a small business'`. Matching is lowercase substring (`slotEvidence.ts` matchPattern), so keep phrases short and unambiguous.

**Verify the wiring (conditional sub-task):** `extractSlotEvidence` returns early when `matter_type` is `unknown`. In the failing transcript, "open a business" arrived on the turn that RE-classified the state (after a contact_request opener). Confirm whether the processor runs `runEvidencePass` against that turn's text AFTER classification updates the matter type. If it does not, add a processor-side call (in `channel-intake-processor.ts`, NOT in the engine) that re-runs `runEvidencePass(turnText, state)` once a turn's text has changed `matter_type` from `unknown` to a concrete type. Keep it out of `screen-engine/` so the mirror is untouched; if you find it genuinely must live in the engine, mirror it.

**Test:** unit test proving `initialiseState`-plus-evidence on the literal string "open a business" fills `advisory_path = 'Starting a new business'` with `'explicit'` provenance, and that `selectNextSlot` therefore does NOT return advisory_path.

### WP-3: Message shape (processor + i18n)

Three changes, all lead-facing copy given verbatim below (do not improvise copy):

**3a. Per-question reply hint.** In `formatDiscoveryQuestion` (`channel-intake-processor.ts` ~130-143), after the numbered labels, append a hint line for single_select slots only. i18n key `prompts.numbered_reply_hint` in `en.json` and `pt.json` (both mirrored), English fallback inline:

- EN: `Reply with a number, or answer in your own words.`
- PT: `Responda com um número, ou escreva com suas próprias palavras.`

Check first-turn Meta sends for any pre-existing upfront numbering instruction and remove it if found (verification during authoring found none in the live Meta path; the `didnt_catch` clarifier and the out-of-range message stay as they are).

**3b. Expectation line on the first outbound of a fresh session.** In the processor, when `isResume` is false, prepend one line to the first outbound message (whatever it is: contact-capture ask, clarify, or discovery question):

- EN: `This takes about five minutes. A lawyer reviews what you share and reaches out directly if your matter fits the firm's practice.`
- PT: `Leva uns cinco minutos. Um advogado analisa o que você compartilhar e entra em contato diretamente se o seu caso se encaixar na atuação do escritório.`

The second sentence is the locked hero sub language; do not reword it. No reply-time promises (LSO surface rule). i18n keys `prompts.intake_expectation` in both bundles.

**3c. Multi-digit acceptance.** In `numeric-option-mapping.ts` add:

```
const MULTI_DIGIT_REPLY_RE = /^[\s`'"‘’“”]*(?:option\s+|#|number\s+|choice\s+)?(\d+(?:\s*(?:,|and|&|e|y|\+)\s*\d+)+)\.?\s*$/i;
```

New exported helper `applyMultiNumericAnswerMapping(text, state): { state, ackPrefix?: string }`:
- Parse all digits; all must be in `[1, options.length]` for the current single_select slot (same getNextStep resolution as the single-digit path), else return unchanged (the out-of-range path already handles bad digits).
- If the slot has an option whose value starts with `All of the above` AND the reply picked 2 or more distinct options: apply that option via `applyAnswer`.
- Otherwise: apply the FIRST digit's option via `applyAnswer` and return an ackPrefix.
  - EN ackPrefix: `Got it, I recorded your first pick. You can add the rest in your own words anytime.`
  - PT: `Certo, registrei sua primeira escolha. Pode acrescentar o resto com suas próprias palavras quando quiser.`
- Processor: call it in the adapter sequence right before `applyNumericAnswerMapping` (same `!nameCaptureConsumed && !pendingConsumed` guard) and prepend `ackPrefix` to the next outbound `questionText` when set.

The lead's raw multi-pick text is already preserved on the record (transcript + LLM pass), so no data is lost by storing one canonical value.

**Tests:** new `__tests__/multi-digit-reply.test.ts` (app side, not mirrored): "1 and 2", "1, 2, 3", "1 e 2", out-of-range mix rejected, single digit unaffected, all-of-the-above selection when available. Processor test for the expectation line firing only on fresh sessions and the hint line rendering on numbered questions.

### WP-4: "All of the above" on advisory_concern

`slotRegistry.ts`: add option `{ value: 'All of the above', label: 'All of the above' }` to `advisory_concern`, positioned before `Not sure`. Then thread the value through every reader (grep the exact slot id):

- `slotEvidence.ts` deriveAdvisorySpecificTask map: add `'All of the above': 'Protecting against future problems'`.
- `report.ts` buildLikelyServices advisory branch: the `concern === 'Avoiding problems with a partner later' || concern === 'Deciding who owns what'` condition gains `|| concern === 'All of the above'`.
- `report.ts` buildFeeEstimate advisory branch: same condition extension on the ownership-terms driver.
- Lead summary + brief rendering: where the concern value prints, `All of the above` reads fine verbatim; no change needed unless a test says otherwise.

Do NOT sweep all 29 matter types in this pass. The class-level sweep (every single_select audited for All-of-the-above / Something-else fit) is a followup row; blast radius on band/report readers is the reason to stage it.

**Tests:** extend `business-setup-advisory-band.test.ts` with an All-of-the-above path; assert services and fee drivers fire.

### WP-5: Option descriptions with examples

- `types.ts` (mirrored): `SlotOption` gains `description?: string`.
- `slotRegistry.ts`: populate `business_activity_type` only in this pass:
  - Professional services: `consulting, legal, accounting, cleaning, tutoring`
  - Retail or storefront: `store, restaurant, cafe, salon`
  - Product or manufacturing: `physical goods, food production, apparel`
  - Software or online: `app, SaaS, online store, content`
  - Trades or construction: `plumbing, electrical, contracting, renovations`
  - Holding company or investment: `holding assets, passive investment`
  - (Verify the actual option list first; map descriptions to whatever the six real values are, keep each under 8 words.)
- `i18n/display.ts` (mirrored): add `getOptionDescription(option, slotId, language, i18n)` following the `getOptionDisplayLabel` fallback pattern; add a `slot_option_descriptions` section to `pt.json` for this one slot (author real PT, not literal translation; match existing pt.json tone).
- `channel-intake-processor.ts` formatDiscoveryQuestion: label line becomes `${idx + 1}. ${label}${desc ? ` (${desc})` : ''}`.
- `numeric-option-mapping.ts` buildOutOfRangeDigitReply: same treatment.
- Web widget chips: locate the component that renders `slot.options` for the public widget (`ScreenEnginePublicWidget`); render the description as a smaller secondary line under the chip label. Keep styling minimal and consistent with the widget's existing type scale.

**Tests:** `slot-option-descriptions.test.ts` in the engine test folder (mirrored): every description under 60 chars, no banned vocabulary, render helpers include it, absent description renders unchanged.

### WP-6: Brief honesty for channel-satisfied contact

In `report.ts`, find where missing contact fields feed `open_questions` / the missing-fields presentation. Rule to implement: when the channel is `whatsapp` (or any channel where `client_phone` carries `system_metadata` provenance) and the contact gate is satisfied, `client_email` and `client_postal_code` must not appear as bare missing rows. Render instead one line: `Email and postal code not collected in chat; phone verified via WhatsApp.` Keep them missing as data (no fake fills), change only the presentation. Read the full `buildOpenQuestions` body before editing; there are channel-specific branches already (SMS budget note, DR-069 routing-confirm lead row) and the new line must not displace them.

**Tests:** extend `report-contact-complete.test.ts` or add a sibling: whatsapp state with wa_id phone, no email, assert no bare "email" missing row and the combined line present; web state unchanged.

### WP-7: Verification and ship

1. `npx tsc --noEmit` clean.
2. Full app suite green.
3. Full sandbox suite green.
4. `bash scripts/check-engine-sync.sh` green.
5. Grep the diff for em dashes and banned vocabulary (hooks should have blocked them, verify anyway).
6. Commit sequence pushed; Vercel deployment READY confirmed.
7. Post-ship: message the operator to rerun the exact 2026-08-07 script on WhatsApp. Expected outcomes to verify against the transcript:
   - Opener response carries the expectation line.
   - "open a business" skips the advisory_path menu entirely (evidence pattern), or at minimum the menu is not the first branching question.
   - Every numbered question ends with the reply hint line.
   - "1 and 2 and 3" is accepted (All-of-the-above or first-pick ack), never rejected with a re-ask.
   - `business_activity_type` options show examples in parens.
   - Within the first 8 discovery questions: business stage, signed-anything, revenue, hiring timeline all asked.
   - Final brief: value/urgency/readiness axes non-zero, completeness well above 34%, email/postal not listed as bare missing rows.
8. After the operator confirms, clean the test rows (constraint 7).

## 5. Explicitly out of scope

- Any change to `computeCoreCompleteness`'s formula, band thresholds, or DR-055/DR-056 calibration. Re-evaluate AFTER the reorder ships and a real re-test shows where the numbers land (followup row).
- True multi_select input_type on SlotDefinition. Every `slotValue(state, x) === 'exact string'` comparison in band.ts/report.ts breaks on joined values. Revisit only if field data shows repeat multi-pick demand after WP-3c ships.
- Option filtering / hiding per lead intent (`hidden_when` predicates). WP-2's evidence-pattern skip covers the observed failure at data level.
- The all-matter-types "All of the above" / "Something else" sweep (followup).
- `sms_reply_instruction` / `gbp_reply_instruction` keys in en.json: consumed outside the Meta path; leave untouched.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|------|--------|------|----------|---------|----------------------|-------|--------|
| 2026-08-13 | This plan | Completeness/confidence display may still read low for advisory after reorder; formula change was deliberately deferred | M | src/lib/screen-engine/selector.ts, report.ts | Re-test after WP-1 ships; if the honest number is still misleading, spec a walked-chain completeness display (separate from the gate formula) | Claude | Open |
| 2026-08-13 | This plan | All-of-the-above / Something-else sweep across all 29 matter types (WP-4 covered advisory only) | M | src/lib/screen-engine/slotRegistry.ts, report.ts, band.ts | Audit every single_select; thread each new value through its readers; one PR per practice area | Claude | Open |
| 2026-08-13 | This plan | Option descriptions beyond business_activity_type (WP-5 covered one slot) | L | slotRegistry.ts, pt.json | Extend to the other concrete-noun slots (tenancy_type, commercial_property_type, wages_type) | Claude | Open |
| 2026-08-13 | This plan | True multi_select input_type | L | screen-engine types + all readers | Only if field data shows repeat multi-pick demand post WP-3c | Claude | Open |
| 2026-08-13 | This plan | Chain-length vs channel-budget rule generalization: audit OTHER long chains (residential_purchase_sale, real_estate_litigation) against DISCOVERY_FOLLOW_UP_CAP=12 | M | selector.ts | Same explicit-order treatment where scoring drivers sit past the budget window | Claude | Open |

Mirror these rows into `00_System/FOLLOWUPS.md` when the work ships (Doctrine Rule 11).
