# Content Studio: Finish Build Plan (autonomous execution spec, Ses.17)

**Status:** Approved for autonomous execution. **Written:** 2026-07-05, operator-directed, immediately after the Ses.16 next-20% run closed.
**Executor:** Claude (Sonnet 5), full autonomy, zero operator input during the run.
**Baseline:** Content Studio sits at ~83% of its product goal (Ses.16 roadmap row in this repo's CLAUDE.md records the full state). This plan finishes the buildable remainder: every format drafts, the human review loop round-trips instead of dead-ending, bilingual authoring exists, the validator battery matches the spec, and the tool reads honestly.

**What "finished" means here, stated up front so the number is honest.** This plan targets 100% of what can exist without a schema migration and without external accounts. Three things stay out permanently or until their own gates clear, and none of them count against completion:
1. Rank tracking / GSC / indexing APIs (external accounts, operator decision).
2. Phase 4 schema items from the SEO/AEO spec (a real `last_updated_at` column, link-graph tables, GIN indexes). Blocked on Task #12 closing, its own lane.
3. Live publishing of real content to drglaw.ca. Human-gated by design: Damaris approves, the operator places and records.

---

## 0. Executor contract

Full autonomy inside the constraints below. Do not ask the operator anything; every decision is pre-made in this document. If a situation is genuinely not covered, write the blocker into the final report, skip that item, continue. Do not improvise around a stop-line.

**Stop-lines (never cross, no exceptions):**

1. Never contact, notify, or email the client lawyer (Damaris) or any firm contact. Every deliverable write in this plan uses `addVersion({ silent: true })`. Announcing pieces for review stays an operator action (`notifyPendingReviews` exists for that; do not call it).
2. Never publish, deploy, or transmit content to any public surface. No drglaw.ca deploys. The DRG website repo (`06_Clients/DRGLaw/03_Authority/Website/drg-law-website`) is read-only for this run (its `LsoDisclaimer`, `firm.ts`, and journal sources are reference material).
3. No schema changes of any kind: no files under `supabase/migrations/`, no `supabase db push`, no `apply_migration`, no DDL through any channel. Do not apply the staged `20260630_content_publish_delegation.sql`. Everything here is application code plus row data in existing tables and JSONB columns.
4. Do not touch `src/lib/screen-engine/` (DR-033 byte-sync discipline).
5. Do not commit or modify anything under `supabase/` at all.
6. The five real pieces at `legal_gate` (WP-4 of Ses.16) belong to Damaris's review queue. Do not regenerate, edit, archive, or advance them. Their deliverables must stay exactly as they are. Every E2E test in this plan runs on NEW pieces you create with a `FIXTURE:` title prefix, or on the already-labeled SMOKE TEST piece.

## 1. Read first (in this order)

1. This repo's `CLAUDE.md`: Database Access Invariant, Developer Gotchas, and the Ses.15 + Ses.16 roadmap rows (they record every defect found and every convention locked in the last two sessions).
2. `docs/CONTENT_STUDIO_NEXT20_BUILD_PLAN.md` (the prior plan; this plan inherits its verification technique and delivery discipline).
3. `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` Sections 2, 5, 6, 7, 8 (the remaining validators and the Article schema for counsel_note live there).
4. `src/lib/content-studio-gates.ts`, `src/lib/content-studio.ts` (note `resolvePublishGateStatus`), `src/lib/content-studio-structured.ts` (note the export renderers and `renderMarkdownToSafeHtml`), `src/lib/content-studio-prompt.ts`, `src/lib/content-validators.ts`.
5. `src/lib/deliverables.ts`: `addVersion` (the `silent` flag and the version-drift guard: posting a new version returns the deliverable to `in_review` and clears the approval pointer), `statusAfterNewVersion` in `deliverables-pure.ts`.
6. `src/app/api/admin/content-studio/pieces/[id]/` (route.ts, draft, validate, export, publish-record) and `src/app/admin/content-studio/` (page, [id]/page, coverage/page, components.tsx).
7. `06_Clients/DRGLaw/03_Authority/Strategy/drg_strategy_v2.upload.json`: the `format_specs` entries for `checklist`, `landing_page`, `paid_traffic_landing`, `review_request`, `review_response` (fully authored there, absent from the live row).

## 2. Live constants (verified 2026-07-05, end of Ses.16)

| Constant | Value |
|---|---|
| Supabase prod project | `ssxryjxifwiivghglqer` |
| DRG firm_id | `eec1d25e-a047-4827-8e4a-6eb96becca2b` |
| Active strategy id (v1, in-place enriched) | `19646d3b-286e-4310-bd5d-1d01ba2116a0` |
| format_specs ON the live row | counsel_note, decision_tool, counsel_letter, clause_in_the_margin, canonical_service_page |
| format_specs MISSING from the live row (present in upload.json) | checklist, landing_page, paid_traffic_landing, review_request, review_response |
| SMOKE TEST piece (status published, fake URL, force-approved deliverable) | piece `16eba76a-5690-41a2-9e5e-09b7310f6460`, deliverable `80215f43-34b7-487b-a0f7-80830207c32d` |
| The 5 untouchable review-queue pieces | `fbd14fa9-…e14e8d`, `8480cbc7-…8db2ff5`, `9e05571b-…3c70f5e`, `21fdd6ea-…f58a10c2`, `541a598e-…624ca2115` |
| Draft model | `CONTENT_STUDIO_MODEL` env override, default `claude-sonnet-5`, strict structured outputs (`additionalProperties: false` on every object node, no `minItems` above 1) |
| Known defect to fix in WP-2 | `draft/route.ts` line ~238 rejects generation unless `workflow_gate === "draft"`, stranding the changes-requested loop |

## 3. Work packages, in execution order

### WP-0: Fixture hygiene (~0%)

The SMOKE TEST piece carries `status='published'` with a fake URL and a force-approved deliverable, which now pollutes the coverage report's published count. Archive both (piece `status='archived'` via the PATCH route; deliverable via `archiveDeliverable`). Archive, never delete: they are the audit trail of the Ses.15/16 verification. The coverage page already excludes archived pieces.

**Acceptance:** coverage report shows published count 0 and no SMOKE TEST row.

### WP-1: Strategy format_specs completion (+1%)

Merge the five missing `format_specs` entries from `drg_strategy_v2.upload.json` into the live row, in place (same id, same version, `format_specs = format_specs || jsonb…`, exactly the WP-1 pattern from Ses.16). The upload file is already the mirror; no file edit needed. Scope note: `checklist`'s spec references a website-side PDF renderer (`renderer`, `input_contract_path`, `output_path_template`); merge the spec verbatim, build nothing website-side (stop-line 2). The spec's value here is prompt structure (`page_structure`) and validator config, both of which the existing code already reads when present.

**Acceptance:** all ten format keys present on the live row; every pre-existing key untouched (verify with the same has-key query pattern Ses.16 used).

### WP-2: The revision loop (+4%)

Today the human review cycle dead-ends: when Damaris requests changes, the operator cannot regenerate (draft route requires `workflow_gate === 'draft'`, and gates are forward-only) and cannot edit, and nothing ever updates the linked deliverable after its first version. Fix all three.

1. **Regeneration at legal_gate.** Loosen the draft route's gate check to `workflow_gate IN ('draft','legal_gate')`. Nothing else about the route changes; a regeneration at legal_gate creates a new piece version exactly like one at draft.
2. **Operator editing.** `PUT /api/admin/content-studio/pieces/[id]/version` (operator-gated): accepts edited content and saves it as a NEW version (`createPieceVersion`, `created_by: 'operator'`), never mutating an existing version row. For Markdown formats the body is one edited `body_markdown` string. For `canonical_service_page` the body is the edited `ServicePageBlock[]` (per-block: heading, body_markdown, h1 lines, FAQ items) plus edited seo title/meta_description; carry the prior version's `seo_metadata` forward with only title/meta_description replaced, and recompute nothing else (the schema blocks were assembled from strategy facts and stay valid). Run the validate pass automatically after save and return its summary in the response.
3. **Edit UI.** On the admin piece page: an Edit mode on the Current Draft panel. Markdown formats get one textarea. Structured pieces get one textarea per block body plus inputs for headings, H1 lines, FAQ question/answer pairs, seo title, meta description. Plain controls in the existing Tailwind idiom; no rich-text editor, no new dependencies.
4. **Send to review.** `POST /api/admin/content-studio/pieces/[id]/send-to-review` (operator-gated): requires a linked deliverable and a zero-fail validation run on the current version, renders the current version with the same renderer the gate advance uses, posts it via `addVersion({ silent: true })`. The drift guard in `deliverables.ts` then does the correct thing automatically: the deliverable returns to `in_review` and the stale approval pointer clears, so a re-approval is required and the sign-off always covers what Damaris actually sees. Do NOT auto-post on every save or regeneration; posting is this explicit action, so half-finished edits never reach the review surface.
5. **Tests.** Pure logic (version-body validation, block-shape checks) unit-tested; the send-to-review precondition (zero-fail run) reuses `checkLegalGateEntryCondition`'s pattern or the function itself.

**Acceptance (E2E on a NEW `FIXTURE:` piece, prod):** generate at draft, validate, advance to legal_gate (deliverable v1 created), edit one section via the new endpoint, send to review, confirm the deliverable has v2, status `in_review`, `review_notified_at` null, zero notification_outbox rows; then force-approve the FIXTURE deliverable via SQL (fixture only, say so in the report), advance to production, export. Archive the fixture piece and deliverable when done.

### WP-3: Validator and schema completion for Markdown formats (+3%)

Closes the disclosed gaps from Ses.15 plus the remaining spec Sections 5, 6, 8 items that need no migration.

1. **Article JSON-LD for counsel_note** (spec Section 7): at generation time in the Markdown branch of `draft/route.ts`, assemble an Article block (headline from the first `#` heading or title_working, author Person from `canonical_nap.lawyer_public_facing_name`, publisher LegalService from `canonical_nap.legal_entity`, datePublished/dateModified = generation date, inLanguage) and store it in `seo_metadata.schema.article` on the version, alongside the flat fields Phase 1 promised (`primary_query`, `secondary_queries` from the brief). Deterministic assembly from strategy facts, same design principle as the canonical_service_page blocks: the model never authors entity facts. Both export renderers already emit whatever `seo_metadata.schema` contains once `renderMarkdownExport` is taught to read it; extend it to accept and emit the schema blocks instead of hardcoding an empty array.
2. **Last-updated marker for Markdown formats**: the export wrapper already renders a last-updated line for structured pieces via `generated_at`; write `generated_at` into the Markdown branch's `seo_metadata` too, and extend `validateLastUpdatedDateVisible`'s text sibling to accept it (or reuse the structured check against seo_metadata). Keep it one source of truth: `seo_metadata.generated_at`.
3. **Domain allowlist on internal_link_targets** (spec Section 8): new pure validator `validateInternalLinkDomains(sourceBrief, firmWebsiteHost)`: every `internal_link_targets[].url` must resolve to the host of `strategy_json.canonical_nap.website`. Severity fail (the field is literally internal links). Wire into the validate route for all formats, host passed from the loaded strategy. Additionally, the draft routes filter non-firm-host targets out of the prompt and note the exclusion in the API response, so a bad link never reaches the model.
4. **Remaining spec Section 5/6 validators**, all pure, all wired into `runDeterministicValidators` behind the same source-brief gating the Step 5 retrofit used (no-op when the relevant field is absent):
   - `validateHeadingQueryAlignment` (warn-only, whole-heading-set coverage against `client_question_variants` + `secondary_queries`, per the spec's own warning about structural headings being legitimate).
   - `validateEntityPresent` (legal entity or lawyer public name appears at least once; needs the NAP names passed via config: extend `ValidatorConfig` with an optional `entity_names: string[]` populated by `buildValidatorConfig` from the strategy row).
   - `validateSecondaryQueryCoverage` (ratio-based, warn under threshold, mirror `validateApprovedVocabulary`'s pattern).
   - `validateServiceAreaPresence` (only when `source_brief.service_area` set; warn).
5. **Cannibalization check** (spec Section 6, now unblocked because generated pieces carry `primary_query` in `seo_metadata`): NOT a pure validator. In the validate route, after the pure pass, query same-firm, non-archived pieces' current-version `seo_metadata.primary_query` plus `source_brief.primary_query`, compute significant-word overlap against this piece's primary query (reuse the `significantWords` helper), and append a warn-severity result named `no_cannibalization` when overlap with another piece exceeds 0.6. Warn only; the operator judges.
6. **Tests** for every new validator including at least one false-positive guard each (the Ses.16 lesson: the italics and guarantee validators shipped untested and were wrong for weeks). Fixture cases must include: a heading set with legitimate structural headings (no warn), the firm's own domain in links (pass) vs an external domain (fail), and two pieces with unrelated queries (no cannibalization warn).

**Acceptance:** all suites green; a fresh counsel_note FIXTURE generation carries the Article block in seo_metadata and its export bundle emits it as a JSON-LD script tag.

### WP-4: Portuguese authoring (+3%)

`bilingual_enabled` is true, the gate named "EN/PT authoring" exists, the piece page renders a PT slot, `content_piece_versions.language` supports 'pt', and nothing can generate PT. Build the path. Doctrine (strategy `voice_traits.bilingual_at_depth`, non-negotiable): PT is authored from the same source brief with meaning parity, never translated from finished English.

1. **Generation.** The draft route accepts `{ language: 'pt' }` (default 'en', only for pieces with `language_mode: 'bilingual'`; 400 otherwise). The PT system prompt adds a language layer: author in Portuguese for a Portuguese-reading Ontario audience, from the brief, meaning parity with the strategy's intent, never a translation exercise; include the LSO constraint already on the strategy row ("Jurisdiction disclosure on PT content"): the piece must state, in Portuguese, that it concerns Ontario law. Prefer `voice_rules.reference.samples` with `language: 'pt'` when present (the sample filter already exists; flip the language it selects). Structured formats use the same strict tool schema (the schema constrains shape, not language). Versions store with `language: 'pt'`; `createPieceVersion` and the PT preview panel already handle the rest.
2. **PT validation.** Run a reduced battery via a new `runPtValidators(text, config)`: em dashes, italics, orphan words, word count, rule of three (all language-neutral), plus one new warn-severity check `pt_jurisdiction_disclosure` (the text mentions Ontario/Ontário; warn when absent). Do NOT run the English-pattern checks (banned vocabulary, LSO phrase regexes, opening-discipline phrases) against Portuguese text; a false pass there would be noise pretending to be assurance. Record the run in `content_ai_runs` with `run_type: 'validate_deterministic'` and a `language: 'pt'` marker in the result so the history is distinguishable.
3. **Review coverage.** `send-to-review` (WP-2) includes the PT version beneath the EN version in the deliverable body when a current PT version exists, separated by a labeled divider ("Portuguese version" heading). One sign-off then covers both, and the drift guard forces re-approval whenever PT lands after an approval.
4. **Gate condition.** Extend `checkLegalGateEntryCondition`'s sibling for the authoring gate: advancing a `bilingual` piece INTO `authoring` requires a current PT version (English-only pieces are exempt). Pure function + tests + wiring in the PATCH route by destination gate, exactly the WP-2 Ses.16 pattern.
5. **Export.** The export route accepts `{ language: 'pt' }` and produces a PT bundle (the wrapper's lang attribute becomes pt, the LSO banner uses the Portuguese copy: read `lsoDisclaimerBodyPt` and the PT headline from the DRG website repo's `src/lib/i18n.ts`, read-only, and inline them as constants with a provenance comment, same as the EN banner was done in Ses.16).

**Acceptance (on the WP-2 FIXTURE piece before archiving it, or a new one):** PT generates, PT validators run and record, deliverable version carries both languages, a bilingual piece cannot enter authoring without PT, PT export bundle carries the Portuguese banner.

### WP-5: The three gated compliance formats (+5%)

`paid_traffic_landing`, `review_request`, `review_response` are the last formats that cannot draft (`STRUCTURED_OUTPUT_REQUIRED_FORMATS` returns 422). Build one structured branch per format, following the canonical_service_page pattern end to end: strict tool schema, prompt builders, output validation, deterministic assembly into `body_structured` + `seo_metadata`, preview rendering, export. Their shapes come from the format_specs merged in WP-1 plus the spec's Section 2 notes:

- **paid_traffic_landing**: sections from the spec's `structure` array; enforce its `hero_image_forbidden` / `trust_block_forbidden` / `form_field_floor` notes as prompt constraints and as assembly-time checks; primary CTA constrained to the spec's `primary_cta`. Its `structural_validators` array names the checks the validate branch must run.
- **review_request**: channel-discriminated output (the spec's `channels`), one message per channel, each independently subject to the already-built `validateReviewRequest` and the CASL checks (`casl_identification_required`, `casl_unsubscribe_required_for_email_and_sms` per channel). Store as blocks keyed by channel.
- **review_response**: subformat-discriminated (the spec's `subformats`, TEARS structure per its `compliance_anchor`); the already-built `validateNegativeReviewResponse` runs against it. The model picks or is told the subformat via a required `source_brief.review_context` field; reject drafting without it (422 with a clear message), because responding to a review requires the review's content and nothing should be invented (Article IV).
- Each format: extend the piece detail page's `VersionBody` to render its blocks readably (a compact renderer per format, same escape-then-substitute safety discipline; reuse `renderParagraphs`).
- Remove the three formats from `STRUCTURED_OUTPUT_REQUIRED_FORMATS` one at a time, each only in the commit that ships its working branch.
- Strict-mode constraints apply everywhere: `additionalProperties: false` on every object node, no `minItems` above 1 (floors move to post-hoc validation), watch for other strict-mode rejections and adapt (the API tells you exactly what it dislikes; Ses.16's probe-iterate loop is the method).

**Acceptance (per format, prod, FIXTURE pieces, archived afterward):** create, brief, draft, validate green (or honest warns), advance to legal_gate, deliverable renders readably; review_request's per-channel CASL checks pass with DRG's real contact facts in the brief. Do not force-approve or export these fixtures; drafting through legal_gate is the acceptance line.

### WP-6: Coverage truth + final sweep (+1%)

1. Coverage page: add a PT column for bilingual pieces (PT exists / missing), and a cannibalization flag column fed by the WP-3 check's latest stored result.
2. Full-suite run: every content-studio test file plus `npx tsc --noEmit` clean, then one prod pass over the coverage report confirming the six real pieces (5 in review + whatever Damaris has acted on by then) read correctly and all fixtures are archived.
3. A completeness check against this plan: every WP's acceptance line re-verified live, anything skipped documented with its reason.

## 4. Explicitly out of scope (do not build, even if tempting)

- Anything under `supabase/` (Task #12 owns that lane); the delegation migration stays staged.
- The checklist PDF renderer and any website-repo change (read-only reference).
- Rank tracking, GSC, indexing APIs, sitemap pinging.
- Rich-text editing, realtime, drag-drop; the plain-controls edit surface is the scope.
- Strategy v2 version bump (`upload_drg_strategy_v2.mjs`): a product decision, not yours.
- Touching the 5 review-queue pieces or announcing anything to the firm.
- Refactors outside the files this plan names.

## 5. Verification technique (proven Ses.16; reuse verbatim)

- Local: `npx vitest run` on every touched suite; `npx tsc --noEmit` clean. `.env.local` points at the OLD Supabase project; never use local dev as a prod-data surface.
- Prod smoke: mint an operator `portal_session` cookie. `npx vercel env pull` yields `PORTAL_SECRET` (sensitive vars pull as empty strings; `PORTAL_SECRET`/`CRON_SECRET` pull fine). Cookie = `base64url(JSON.stringify({firm_id, role: "operator", exp}))` + `.` + HMAC-SHA256-base64url of the payload with `PORTAL_SECRET`, sent to `https://app.caseloadselect.ca`. Delete the pulled env file and cookie when done.
- Data reads and row UPDATEs: Supabase MCP `execute_sql` on `ssxryjxifwiivghglqer`. UPDATE on existing rows allowed; DDL never.
- Deploys: commit + push to main only; `git fetch` before every push; stage explicit file paths only, never `git add -A`; check `git status` for foreign staged files before every commit. A parallel session is actively committing to this repo, including to `(marketing)` routes that broke the prod build twice on 2026-07-05 (it fixed itself); if the newest deployment shows Error, check whether the failing files are yours before acting, and only fix what you broke. Confirm your own deployments reach READY.
- When generated content fails validators in a repeating pattern across unrelated pieces and retries, stop and root-cause the validator/prompt before burning regeneration attempts. Ses.16 found three real validator bugs exactly this way; the standing engine-investigation triage protocol applies to content tooling too.

## 6. Writing rules

No em dashes anywhere, no italics, no banned vocabulary (master list in the operator CLAUDE.md; the strategy row's list is enforced by validators on generated content). LSO Rule 4.2-1 on every string that could reach a client surface: no outcome promises, no timing promises, no specialist/expert language. Portuguese content carries the Ontario jurisdiction disclosure. Every factual claim in any brief traces to a source document (Article IV).

## 7. Delivery and report

1. Append a `Ses.17 Content Studio finish` row to this repo's CLAUDE.md Build Roadmap: what shipped per WP, commit hashes, defects found in existing code (fixed or flagged), anything skipped with reasons.
2. Append one row to `D:\00_Work\01_CaseLoad_Select\00_System\FOLLOWUPS.md` (same schema as existing rows): what now waits on humans.
3. Final report to the operator: what shipped (one line per WP), the completion statement against the definition in this plan's preamble, defects found while building, the exact human-action list (Damaris reviews, operator announce/export/publish decisions, strategy v2 decision), anything skipped and why.
4. Leave every fixture archived and labeled; leave the 5 review-queue pieces untouched.
