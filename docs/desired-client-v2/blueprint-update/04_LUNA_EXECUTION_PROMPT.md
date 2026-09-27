# Copy this instruction to Luna

Implement the Desired Client Blueprint update from this complete package:

`D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Blueprint_Update_Plan_2026-09-26/`

Read README.md, 01_DISCOVERY_SPEC.md, 02_BLUEPRINT_CONTRACT.md and 03_ENGINEERING_AND_ACCEPTANCE.md in that order. Astra has made the product, UX, content, schema, infrastructure and release decisions. Execute them without redesigning the tool or expanding scope. Routine code organization within the specified files/contracts is allowed; changing questions, options, semantics, template, limits, model, dependencies or activation behavior is not. If the package has a genuine conflict or a fixed layout cannot pass its content test, report the exact conflict, affected fixture and evidence to Astra. Finish independent work while that is resolved. Do not invent a replacement product decision.

Use the existing app worktree:

`D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app-worktrees/desired-client-v2`

Expected branch: `codex/desired-client-v2-app`. Audited base: `ce209f3456ffe3b531401c764af63612510b497a`. Expected existing draft PR: https://github.com/adrianosortudo-source/caseload-select/pull/317. Verify these against current state and preserve subsequent work. Do not reset to the audited SHA or create a clone. If the PR has merged or the worktree has incompatible active work, return the checkout decision to Astra.

Build the specified six-stage discovery plus Review. Add one required trigger, one optional decision-needs group and one required group of up to three early fit signals. Preserve all optional expanded sections, custom answers and unknown choices. Use the exact catalog/copy in the package. Required groups total 13.

Replace the current AI result with the versioned connected Blueprint contract and use a single presentation model for screen, PDF, text and supporting Markdown. Reuse the approved Option 2 hierarchy. The model interprets the firm's answers; it must not invent client facts, fee benchmarks, capacity or profitability. The application builds source-linked proposed Screen checks from explicit input. Nothing activates scoring, changes Screen settings or accepts/rejects a lead.

Implement safe v2.1-to-v2.2 local draft migration before strict validation. Preserve every old answer and the exact expiry timestamps, invalidate legacy reports and review status, and guide the user through the two new required questions. Do not send an AI request on restore.

Reuse the current Gemini route, provider, request protections, attempt budget and clarification bank. Reuse installed @react-pdf/renderer dynamically in the browser for the one-page Letter PDF. No new server export endpoint, new library/model, Supabase migration, email service, CRM write or production secret provisioning. Verify real one-page output with maximum-content fixtures, not only a screenshot or a single Page component.

Follow milestones and acceptance checks in 03_ENGINEERING_AND_ACCEPTANCE.md, including direct/embed browser journeys, migration, stale AI/PDF cancellation, grounding, unknowns/custom answers, all six responsive widths, keyboard use and browser-only export privacy. Inspect at least one established, one new/exploring and one sparse/unknown report semantically. Tests that intercept AI do not verify live synthesis; report missing live-provider configuration honestly.

Copy the package into docs/desired-client-v2/blueprint-update/ in the implementation branch. Keep intentional review evidence in the existing docs review structure. Push every commit to origin before finishing, update and attach the draft PR, and leave the working tree accounted for. Do not merge or deploy production. Specific-PR merge approval must come from Adriano.

Your final handoff must contain:

1. What changed, with links to key files and exact branch/commit/PR.
2. Acceptance checks run, results and any explicitly unverified live-provider check.
3. An inspectable one-page synthetic PDF and the corresponding input/report evidence.
4. Proof that legacy answers survive migration without extending expiry.
5. Confirmation that no live Screen settings, lead scores, migrations or production deployment were changed.
6. Any unresolved problem stated precisely, including location and proposed next diagnostic step. Do not describe the task as complete while required implementation or verification is missing.

Astra will review the finished result against this package before asking Adriano to test it.
