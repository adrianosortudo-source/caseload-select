# PR #384 finish contract

**Code freeze:** Thursday, October 8, 2026, 5:00 p.m. Toronto time  
**Target completion:** Friday, October 9, 2026, 5:00 p.m. Toronto time

## Scope and acceptance

Continue the existing guided interview and its faithful six-topic AI profile. Keep existing save, reopen, edit, HTML export and print behavior. Add no features, questions, fields, providers, architecture or broad refactors.

Only a valid, current, complete mixed selector in why_firm_wants_work may trigger recovery. Preserve input and claim limits, unique current IDs, slot correctness, complete ID resolution and full source coverage. Unknown, stale, duplicate, wrong-slot, over-limit and incomplete selectors still fail. Discard every generated sentence in an eligible section and rebuild from current structured answers. Keep unresolved rationale labelled unknown and the selected growth direction as a separate firm preference. Preserve separate evidence bases, the seven-claim limit, every supplied financial/payment/capacity/staffing fact, the other five sections, and the independently validated definition and decision pathway.

## Verification and release gates

Before each push, run focused Desired Client tests and focused TypeScript. On the final pushed head, require all CI checks and the direct browser regression for HTTP response to screen to save/reopen to existing export/print. Before release, require a successful real AI journey that demonstrates useful synthesis from the interview answers; HTTP success or an all-structured substitute is insufficient.

One live-test call remains unspent, but testing is stopped after the previous failure. Obtain fresh approval before using it. Do not merge, change production configuration or change credentials.

## File-to-gate map

- src/lib/desired-client/output.ts: mixed-section recovery and selector validation; covered by mixed-payment-recovery.test.ts.

- src/lib/desired-client/structured-blueprint.ts: direction preference remains separate from unresolved rationale; covered by output.test.ts.

- src/lib/desired-client/__tests__/mixed-payment-recovery.test.ts: complete negative-economics fixture, selector rejection, source coverage and discarded wording.

- src/lib/desired-client/__tests__/output.test.ts: grounded recovery wording, source fidelity, unknown rationale, direction preference and seven-claim boundary.

- src/app/api/tools/desired-client-matter/analyze/__tests__/route.test.ts: recovered server response contains canonical wording only.

- tests/desired-client-v2/blueprint-report.spec.ts: HTTP response to screen, save/reopen, export and print browser path.

- docs/desired-client-v2/review/2026-10-07-mixed-payment-recovery.md: bounded offline diagnosis and failure-cause evidence limits.

- docs/desired-client-v2/review/2026-10-07-finish-contract.md: scope, deadlines, release gates and this file map.

## Checkpoints

Next checkpoint: Thursday, October 8, 2026, 4:30 p.m. Toronto time, to assess verification before the 5:00 p.m. code freeze. Target completion is Friday, October 9, at 5:00 p.m. If fresh live-test approval or provider availability is missing, keep release blocked and report the Friday threat.
