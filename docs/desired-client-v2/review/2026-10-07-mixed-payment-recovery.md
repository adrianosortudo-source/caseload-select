# PR #384: offline mixed-payment recovery diagnosis

Baseline: 86d64ba61cf0acab3dce15753c5dd83934765188. All reproduction inputs are synthetic. No live provider calls, database actions, configuration changes, merge or production deployment were performed.

## Evidence boundary

The October 7 15:00:48.837 UTC request 7e5a7a27-048b-411d-98f3-03d6e209b33d returned 502 INVALID_AI_OUTPUT, why_firm_wants_work / evidence_group_selection_invalid, with one provider call and no repair. Its filtered/deduplicated IDs and claim index capped at seven cannot establish the raw selection, total claims or failed recovery gate. The actual live cause remains unknown. The paused allowance has two calls remaining; this work does not authorize their use.

## Reproduction and failing gate

Ran all 15 cases from Desired_Client_86_Recovery_Reproduction.zip against its unchanged exact-86 sources. A valid mixed payment/context claim recovers, including at claim seven. The complete fixture retains C$8,000 fee and C$8,500 direct cost, recorded per-matter basis, fee/hour ranges, predictable payment, client-feedback payment context, current capacity, additional matters, required associate hire, target and review period.

An earlier authentic payment-context paraphrase passes ordinary payment normalization when no mixed claim follows. With the valid mixed claim appended at seven, section recovery instead calls strict validStatement on the earlier paraphrase and stops at payment_context_claim_mismatch. Outer validation then reports the later mixed claim's evidence_group_selection_invalid. The structured card has six claims and covers every selected source. Missing metadata, stale/unknown/duplicate/wrong-slot IDs, excessive claims, unsupported wording and missing source coverage are different fail-closed cases sharing the old outward signature.

## Focused repair

Before section recovery accepts an earlier payment paraphrase, require current in-slot unique raw groups, valid selector metadata, authentic original payment meaning/context/numbers/negation/economics, and matching evidence groups. Run the existing payment normalizer on that claim and validate its normalized card. Only then allow a later authentic mixed selection to trigger the existing deterministic section rebuild. Preserve full original source coverage, seven claims and eight sources per claim. Keep payment observation, client-reported context, capacity observation and staffing preference separate. The five other sections, definition and pathway retain their baseline result. Recovery disclosure wording and saved-marker validation remain unchanged. The six-width browser gate identified an existing short nonfinal line caused by pretty wrapping in the recovery notice at 320px; only that paragraph now uses natural wrapping, and the notice uses .5rem inline padding at widths up to 360px. A bounded rendered trial confirmed this was the smallest tested padding adjustment that fixes the orphan without short nonfinal lines. Width, orphan and nonfinal-line checks cover the notice at 1440, 1024, 768, 640, 375 and 320px.

## Diagnostics

Preview rejection logs now include a fixed recovery reason, bounded raw card count, the first blocked position, that claim's bounded selector counts/selection subtype, and replacement/source-coverage counts when reached. Claim positions are exact through 32, with an explicit capped flag beyond that. Raw/unique/resolved counts are bounded at 32 with a cap flag. Unrecognized IDs, answer prose and claim prose are never logged. Diagnostic details stay out of the HTTP error response and are omitted from Production logs.

## Verification

Focused contracts cover ordinary normalization, successful whole-section recovery, JSON response revalidation, original-source coverage, source attribution, missing metadata, stale/unknown/duplicate/wrong-slot selectors, claim limits, unsupported numbers, negation, false audit claims, and diagnostic privacy/count bounds.

The existing browser recovery test uses a test-only loopback HTTP server bundling the actual POST route and analysis service with an offline provider SDK and store. It forwards the browser's request through that route, consumes its actual JSON response, and verifies recovery disclosure, save/reload/reopen, complete-fact HTML export and print PDF. The stubs expose no live provider, Redis or database capability. This proves the offline application path; live provider success remains unverified.

Local validation before push: 306 focused tests passed; final recovery suite passed all 19 cases, and recovery/server route retests passed all 46 tests after the diagnostic-holder lint correction. Full TypeScript and scoped ESLint passed. The complete browser suite passed all 12 tests, including the actual offline HTTP route, persistence, HTML export, print PDF and six-width recovery notice checks. Earlier local attempts exposed a malformed generated Next type file, resource pressure, an incomplete test stub, and the notice wrapping defect; those are recorded as local test/setup findings, not causes of the live provider rejection.
