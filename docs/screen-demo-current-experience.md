# Current SCREEN demonstration

Status: the November 11 public SCREEN and Tools update is published. The focused Gene public-mockup integration below is a review candidate until its exact PRs are approved.

## Entry points

- **Canonical experience: prospect website presentation.** Adriano confirmed on November 8 that the version he tested is the widget placed on a prospect website, not the separate generic split workspace. `ProspectDemoClient` and `ProspectDemoPresentation` are the shared implementation.
- `/admin/prospect-demos`: protected builder for saving, importing and positioning a prospect website screenshot. Existing browser-local profiles, screenshots and placements remain authoritative.
- `/demo/prospect/[profileId]`: protected canonical presentation. Opens the profile’s Website view, with Lawyer view and Split view available without discarding answers. CaseLoad presentation defaults to live AI with an explicit guided option.
- `/tools/screen`: public practice-area and channel demonstration, packaged from a pushed commit in `adrianosortudo-source/caseload-screen-sandbox` and pinned in `config/screen-public-build.manifest.json`. It does not use the protected builder or operator profile library. `?embed=1` removes the duplicate masthead; the inner demo publishes its natural content height in both embedded and standalone app routes. The app wrapper validates the exact child frame and origin, resizes for growth and shrinkage, and relays height to an approved website parent. The demo creates no lead and contacts no firm.
- `/screen-demo`: temporary redirect to the canonical route; incoming query values, including `embed`, are retained. Existing quiz and report subpaths remain available for previous bookmarks.
- `/widget-v2/demo/[firmId]`: retained secondary workspace with the existing firm's colour and font theme. Only the CaseLoad-owned shell and report use CaseLoad branding. The demonstration geometry is square. No production intake route is changed.
- `/widget-public/demo`: separate deterministic demonstration, retained for existing consumers. It is not the canonical live-AI tool.

## Pinned authorities and boundaries

- Engine baseline: production `7ace743c004c7e1026c335173eb39da6495f2e5f`, with the approved focused will-preparation routing correction mirrored from pushed SCREEN source `d90815a5b046d185f3b317a652f532173a33780b`. Engine sync and the manifest verify the shared implementation. Scoring, questions and DR-069 confirmation policy remain unchanged.
- Web experience policy: read `WEB_EXPERIENCE_POLICY_VERSION` and the bounded-discovery constants from the engine. Target 5 to 7 adaptive follow-ups, maximum 8 including routing, earlier completion when sufficient facts are known. Business routing stays in the engine.
- Report: `renderBriefHtmlServer` with `presentation: demo`, projection `production-demo-v1`. Same axis, prose and provenance functions as the portal; no queue, lead ID, operational action rail or real deadline. All resolved facts and quote checks remain available. The portal retains its operational layout.
- Brand: canonical ACTS Brand Book V2.0.2, effective August 18, 2026, `01_Brand/BrandBook/V2_Canonical/BrandBook_ACTS_V2.html`. Shared demo CSS opts in only on the demo. Square flat geometry, approved palette, Manrope 800 headings, DM Sans 400 interface/body, Oxanium 600 compact labels and numerals. No decorative terminal square on this utility page.
- Runtime: `demo-live-ai` permits only `/api/extract`. Guided mode makes no extraction request. Neither creates a lead, checkpoint, consent record, audio recording, host completion signal or notification. The public sandbox accepts fictional contact values in local session memory to demonstrate the real contact step; it sends no contact values to intake or notification endpoints and persists no lead. The fictional-data and simulated-completion notices remain outside the client widget. No new telemetry collection is enabled.
- Provider success, no-provider-needed, explicit guided mode and fallback are distinct states. Keys remain server-side. The existing Gemini key is authorized for this branch preview only; do not broaden its environment scope.

## Confirmation and corrections

Captured canonical facts are presented with their provenance. AI proposals remain unconfirmed until readback. A correction is held outside engine state until confirmation, then goes through `applyAnswer`, retaining its derived-slot behavior but restoring the real discovery question history so corrections do not consume hidden follow-ups. Incorrect proposals may be left unanswered. Unknown keys, contact fields, routing proposals and invented enum values cannot be acknowledged by the correction adapter.

Ownership alone, negated authority and joint approval do not establish sole hiring authority. The original description remains available as evidence; changed facts carry explicit correction provenance. Review can be reopened without losing answers. Changing the sample or mode explicitly restarts the demo. Layout changes keep both panes mounted. Stale extraction responses cannot replace a restarted or backed-out session.

This readback adapter remains demonstration-only. Introducing it into production public intake and refreshing the independent sandbox are separate releases.

## Acceptance and visual exceptions

Verify live provider success on the actual branch preview, then complete the fictional inquiry, correct a captured fact, inspect the report and confirm the absence of intake, checkpoint, notification and telemetry requests. Exercise guided and fallback states, missing facts, the routing ceiling, pane switching and reset.

Run unit and component tests for report parity, provenance/escaping, corrections, no-write behavior, entry redirect and scoped frame headers, plus the existing brief/engine tests and repository CI. Verify 1440, 1024, 768, 640, 390, 375 and 320 CSS pixels, keyboard focus, contrast, font roles, reduced motion and expanded details. Test the real tools host and iframe through a local review harness pointing to the preview; do not change the live website for testing.

Structural exceptions: `ProspectDemoPresentation.module.css` `.presentationBody` and toolbar are structural page shells. The screenshot placement is a calibrated functional overlay; when its width would fall below 320px the intake uses the full available width below the website header. No arbitrary copy measure is applied. `ScreenDemo.module.css` `.toolbarInner` and `.body` are page shells capped at 1280px, not copy measures. Report facts and controls remain full width inside each content inset. Shared client widget option grids are functional choice tracks; configured firm colours and fonts remain intentional client-theme exceptions on `/widget-v2/demo/[firmId]`. No general copy-width exception applies to the CaseLoad-owned demo.

Production publication remains PR-merge-only after explicit approval. No direct production deployment, migration, provider activation or live client submission belongs to this update.

## Report uncertainty correction discovered in the live journey

The engine's `$25,000-$100,000` amount bucket cannot identify the correct court. The shared report formatter replaces one exact legacy sentence asserting that this entire range is above the Small Claims threshold with a request for the lawyer to confirm the exact claim amount, relief and appropriate court. Both portal and demo projections use this display correction; raw engine data, bands, fees, scoring and persisted records are unchanged. Source checked November 7, 2026: [Ontario Regulation 626/00, section 1](https://www.ontario.ca/laws/regulation/000626), current from October 1, 2025. This change does not add an automated jurisdiction calculation.

The demo retains the complete original inquiry and lists corrected facts separately. A lawyer can check source context alongside the structured report gaps. In particular, the existing unpaid-invoice pack has no `written_terms` slot even though its gap vocabulary can mention an agreement; this engine/schema limitation is not silently repaired by inventing a demo-only canonical slot.

Demo-only explanatory display copy uses shorter sentences and full-width list rows for phone readability. Canonical facts, scores, evidence and the portal wording are retained. Axis explanation sentences are separate paragraphs. Rendered checks exclude genuinely closed disclosure content; expanded sections are checked separately in browser review.

## Single-scroll preview acceptance

Verify both website entry points with the actual packaged app, at 1440, 1024, 768, 640, 375 and 320 CSS pixels. Only the outer website document should scroll. Channel choices wrap into visible rows and textareas grow with their contents; no internal horizontal or vertical scroll areas are permitted. Check wheel behavior over both columns, initial inquiry visibility, follow-ups, long reports, editing, going back, channel changes and reset. All content must remain reachable without hidden-overflow clipping. Preserve the approved routing correction and the current release as the rollback point. Preview links and draft PRs are not publication.

## Client-widget parity preview acceptance

The client opening uses the public widget defaults: “Tell us how a lawyer can help you today.” and “Continue matter review”. Demonstration-only examples, practice-area controls, channel choices and privacy/completion notices stay outside the client card. A single example selector above both panels fills the active channel opening without starting extraction or resetting an existing conversation. It retains the original automatic/selected-practice-area catalogs, disables during active intake, and re-enables on an explicit reset. The voice pane also uses the shared outer selector rather than an inner sample list.

The inquiry, follow-ups, conversational recap, edits and fictional contact step retain the client perspective. Completion does not claim a submission or firm contact; the surrounding page identifies the simulated outcome. The existing report renderer and its preliminary/completed timing are preserved. Verify free-text cases across the five available practice areas, all six channel layouts, editable example selection with no extraction, recap/contact/completion, and absence of writes beyond the authorized extraction endpoint. Review both real website entry points before any publication approval.

## Will-preparation routing correction

The earlier preview routed a fictional first-will inquiry mentioning the family home to `residential_purchase_sale`. The original failed inquiry, provider response and source revision are preserved in the local SCREEN_Widget_Parity_2026-11-11 evidence folder.

Adriano approved a focused deterministic routing correction, mirrored from pushed SCREEN source `d90815a5b046d185f3b317a652f532173a33780b`. It recognizes an explicit will-preparation request in the original narrative while preserving ordinary modal uses of “will,” negated requests and the selected practice area’s existing non-forcing behavior. The source regression suite covers the original example, existing plural wills and non-estates counterexamples. This is preview only; final integrated verification and review are required before any publication approval.

## Gene public mockup: current-widget integration

`/tools/screen/gene-colman` uses `GeneCurrentScreenMockup` with the same canonical `/screen-demo-app/index.html` package used by `/tools/screen`. The fixed public Gene profile, screenshot, placement and family-only configuration are retained. It never reads the private browser profile library. The protected builder and operator presentation remain unchanged.

One iframe owns all screening state, conversational recap, contact validation and the exact current report. Website, Lawyer brief and Side by side only change presentation; they do not mount another engine or restart extraction. The owned same-origin iframe receives the scoped `current-screen-frame.css` presentation and the existing family sample as a placeholder. Widget reset invokes its existing reset control. Height messages require both the exact iframe window and the same origin, with finite bounded heights. No authentication or frame policy changes.

A free-text agreement reply exposed an existing evidence error: the word parenting could replace the supporting quote for an already-confirmed help request. Pushed source `8ba851b1685eb8be37e012d11f5d1be79586f997` preserves answered/explicit request evidence when the value is unchanged. Four regressions and all 535 source tests pass. Scoring, routing, questions and confirmation policy are unchanged. The app mirror and 19-file manifest remain exact.

Only fictional test cases and contacts are allowed. Live AI uses the existing server extraction route. The demo saves no lead and contacts no firm. The public share URL is the tools route above; the operator `/demo/prospect/...` URL requires sign-in and local profile data and must not be shared with Gene.

Gene acceptance includes an anonymous public-route browser check across 1440, 1024, 768, 640, 375 and 320 CSS pixels. It verifies one mounted canonical widget, retained drafts across all three views, the existing screenshot asset, no horizontal overflow or internal scrolling, and saves desktop/phone screenshots. Live-provider family testing uses fictional free-text parenting and separation/support cases through recap, added details, current report and fictional contact completion. The family recap preserves original request evidence and avoids re-quoting the opener after details are appended; structured facts remain intact. The canonical source suite passes all 536 tests.