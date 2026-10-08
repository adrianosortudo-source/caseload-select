# PR #384 finish contract

**Code freeze:** Thursday, October 8, 2026, 5:00 p.m. Toronto time  
**Target completion:** Friday, October 9, 2026, 5:00 p.m. Toronto time

## Scope and acceptance

Continue the existing guided interview and its faithful six-topic AI profile. Keep existing save, reopen, edit, HTML export and print behavior. Add no features, questions, fields, providers, architecture or broad refactors.

Only a valid, current, complete mixed selector in why_firm_wants_work may trigger recovery. Preserve input and claim limits, unique current IDs, slot correctness, complete ID resolution and full source coverage. Unknown, stale, duplicate, wrong-slot, over-limit and incomplete selectors still fail. Discard every generated sentence in an eligible section and rebuild from current structured answers. Keep unresolved rationale labelled unknown and the selected growth direction as a separate firm preference. Preserve separate evidence bases, the seven-claim limit, every supplied financial/payment/capacity/staffing fact, the other five sections, and the independently validated definition and decision pathway.

## Verification and release gates

Before each push, run focused Desired Client tests and focused TypeScript. On the final pushed head, require all CI checks and the direct browser regression for HTTP response to screen to save/reopen to existing export/print. Before release, require a successful real AI journey that demonstrates useful synthesis from the interview answers; HTTP success or an all-structured substitute is insufficient.

The three-call live-test allowance is exhausted. The latest ledger records 15 generation attempts and 2 clarification operations, including the 40fdef live failure. This offline repair used zero provider calls. Do not make further provider requests or reset counters; any later bounded live acceptance must be coordinated under fresh user approval. Do not merge, change production configuration or change credentials.

## File-to-gate map

- src/lib/desired-client/output.ts: mixed-section selector gates, evidence-faithful coverage checks, full discard/rebuild, and response guarding; covered by mixed-payment-recovery.test.ts and output.test.ts.

- src/lib/desired-client/evidence-contract.ts: source-specific evidence-basis and destination-card mapping for firm type and delivery fit; covered by mixed-payment-recovery.test.ts selector matrix and invalid-selection cases.

- src/lib/desired-client/structured-blueprint.ts: selected growth direction is a firm preference, firm type remains experience-attributed, and unanswered rationale remains separate; covered by output.test.ts and mixed-payment-recovery.test.ts.

- src/lib/desired-client/storage.ts: valid recovered response marker and unknown claim survive save/reopen validation; covered by state-storage.test.ts and blueprint-report.spec.ts.

- src/lib/desired-client/__tests__/blueprint-helpers.ts: realistic labeled answer fixture and mixed selector carrying payment, client context, fit signal and unresolved development-needs sources; consumed by the recovery and output tests.

- src/lib/desired-client/__tests__/mixed-payment-recovery.test.ts: complete negative-economics fixture, selector rejection, source coverage and discarded wording.

- src/lib/desired-client/__tests__/output.test.ts: grounded recovery wording, source fidelity, unknown rationale, direction preference and seven-claim boundary.

- src/app/api/tools/desired-client-matter/analyze/__tests__/route.test.ts: recovered server response contains canonical wording only.

- tests/desired-client-v2/blueprint-report.spec.ts: HTTP response to screen, save/reopen, export and print browser path.

- docs/desired-client-v2/review/2026-10-07-mixed-payment-recovery.md: bounded offline diagnosis and failure-cause evidence limits.

- docs/desired-client-v2/review/2026-10-07-finish-contract.md: scope, deadlines, release gates and this file map.

- docs/desired-client-v2/review/2026-10-07-mixed-payment-recovery.md: failure evidence, bounded diagnosis and current offline/browser/typecheck results.

## Checkpoints

Next checkpoint: Thursday, October 8, 2026, 4:30 p.m. Toronto time, to assess exact-head CI and the remaining real-AI release gate before the 5:00 p.m. code freeze. Target completion is Friday, October 9, at 5:00 p.m. If fresh live-test approval or provider availability is missing, keep release blocked and report the Friday threat.
