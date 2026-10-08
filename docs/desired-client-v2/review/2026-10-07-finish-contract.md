# PR #384 finish contract

**Code freeze:** Thursday, October 8, 2026, 5:00 p.m. Toronto time  
**Target completion:** Friday, October 9, 2026, 5:00 p.m. Toronto time

## Scope and acceptance

Continue the existing guided interview and its faithful six-topic AI profile. Keep existing save, reopen, edit, HTML export and print behavior. Add no features, questions, fields, providers, architecture or broad refactors.

Only a valid, current, complete mixed selector in why_firm_wants_work may trigger recovery. Preserve input and claim limits, unique current IDs, slot correctness, complete ID resolution and full source coverage. Unknown, stale, duplicate, wrong-slot, over-limit and incomplete selectors still fail. Discard every generated sentence in an eligible section and rebuild from current structured answers. Keep unresolved rationale labelled unknown and the selected growth direction as a separate firm preference. Preserve separate evidence bases, the seven-claim limit, every supplied financial/payment/capacity/staffing fact, the other five sections, and the independently validated definition and decision pathway.

## Verification and release gates

Before each push, run focused Desired Client tests and focused TypeScript. On the final pushed head, require all CI checks and the direct browser regression for HTTP response to screen to save/reopen to existing export/print. Before release, require a successful real AI journey that demonstrates useful synthesis from the interview answers; HTTP success or an all-structured substitute is insufficient.

The historical ledger records 16 generation attempts and 2 clarification operations; earlier allowances are exhausted. Make no provider calls during offline verification. A separate acceptance plan is pending, capped at 3 total calls, and may run only after this candidate passes offline, CI and browser gates. Do not reset counters, merge, or change production configuration or credentials.

## File-to-gate map

- src/lib/desired-client/output.ts: mixed-section selector gates, evidence-faithful coverage checks, full discard/rebuild, and response guarding; covered by mixed-payment-recovery.test.ts and output.test.ts.

- src/lib/desired-client/evidence-contract.ts: source-specific evidence-basis and destination-card mapping for firm type and delivery fit; covered by mixed-payment-recovery.test.ts selector matrix and invalid-selection cases.

- src/lib/desired-client/structured-blueprint.ts: the selected growth direction is a firm preference, while experience/capability retain their own attribution; covered by mixed-payment-recovery.test.ts and output.test.ts.

- src/lib/desired-client/storage.ts: valid recovered response marker and unknown claim survive save/reopen validation; covered by state-storage.test.ts and blueprint-report.spec.ts.

- src/lib/desired-client/__tests__/blueprint-helpers.ts: realistic labeled answer fixture and mixed selector carrying payment, client context, fit signal and unresolved development-needs sources; consumed by the recovery and output tests.

- src/lib/desired-client/__tests__/mixed-payment-recovery.test.ts: complete negative-economics fixture, selector rejection, source coverage and discarded wording.

- src/lib/desired-client/__tests__/output.test.ts: grounded recovery wording, source fidelity, unknown rationale, direction preference and seven-claim boundary.

- src/lib/desired-client/analyze.ts: Preview uses the same already-bounded repair loop; covered by provider-contract.test.ts and the route regression below.

- src/app/api/tools/desired-client-matter/analyze/route.ts: Preview and production share the existing three-total-call limit; covered by route.test.ts readiness, scoped-repair and ceiling tests.

- src/app/api/tools/desired-client-matter/analyze/__tests__/route.test.ts: seven-claim overflow is repaired in the mocked HTTP path and passes client response validation; adjacent storage and browser regressions cover save/reopen/export/print.

- tests/desired-client-v2/blueprint-report.spec.ts: HTTP response to screen, save/reopen, export and print browser path.

- docs/desired-client-v2/review/2026-10-07-mixed-payment-recovery.md: bounded offline diagnosis, evidence limits and current live-test ledger.

## Checkpoints

Next checkpoint: Thursday, October 8, 2026, 9:00 a.m. Toronto time, to review completion of focused offline checks, the browser path and exact-head CI status. Code freeze is 5:00 p.m. that day. Target completion remains Friday, October 9, at 5:00 p.m. The separate capped acceptance plan remains pending until those gates pass; missing that window threatens Friday completion.
