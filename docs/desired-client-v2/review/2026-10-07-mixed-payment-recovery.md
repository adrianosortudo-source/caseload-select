# PR #384: mixed-evidence section recovery

Baseline: d430fd991ba09e80044d9561b22975419feb33e0. All local reproduction data is synthetic. No live provider calls, database actions, configuration changes, merge or production deployment were performed.

## Evidence boundary

The October 7 15:00:48.837 UTC request 7e5a7a27-048b-411d-98f3-03d6d209b33d on 86d64ba returned 502 INVALID_AI_OUTPUT for why_firm_wants_work / evidence_group_selection_invalid after one call and zero repairs. Its capped claim index and filtered, deduplicated IDs do not establish raw selector validity, total claim count or the failed recovery gate.

The later October 7 request fa8422fd-3172-4907-93e5-6baab7a26cb1 on d430fd99 failed as mixed_text_not_authentic at the first claim. The card had seven claims and three valid, resolved source IDs for that selection. The generated sentence was not logged, so this record does not claim to reproduce it. Neither live failure's recovery cause is established.

The three-call live-test allowance is exhausted. The latest ledger records 15 generation attempts and 2 clarification operations, including the 40fdef live failure. This offline repair and its tests used zero live provider calls. Do not make further provider requests or reset counters; any later bounded live acceptance must be coordinated under fresh user approval.

## Offline diagnosis and repair

The complete synthetic negative-economics fixture includes a C$8,000 fee and C$8,500 direct cost on a recorded per-matter basis; fee and hour ranges; predictable payment with client-feedback context; capacity; additional matters; associate staffing prerequisite; target; and review period.

The recovery selector checks shape, seven-claim and eight-group limits, unique current group IDs, slot, complete resolution, group and source-path limits, valid mixed-selection status, and coverage of every source represented by the selected IDs. The previous recovery path also authenticated prose for claims it would discard. That extra gate was unnecessary and could reject otherwise eligible mixed selections. Recovery now discards every generated claim text in the section and reconstructs the full section from current structured answers. The rebuilt card then goes through normal final validation. Invalid selections and invalid content in the other five sections still fail closed. Every selected source is checked against actual source-faithful statements across the full report; a citation with unrelated wording or reversed polarity does not count as coverage. Unanswered rationale is rebuilt as an explicit unknown and remains separate from the selected growth preference.

The canonical builder now expresses the selected practice direction as a firm preference linked to practice.direction. The wording describes the chosen direction; it does not treat that preference as proof of experience or capability. The existing experience/capability statement remains separately attributed. The complete selected source set is still required, and financial, payment, fee/hour, capacity, staffing and target facts retain their existing source bases.

The independently validated definition and decision pathway and other five cards remain unchanged. The app-owned recovery label and unknown statement survive response validation, screen rendering, save/reopen, HTML export, and print. No new feature or architecture is introduced.

## Verification

The focused offline recovery, builder and storage suites passed: 101 tests. The focused offline API route test passed. The complete synthetic negative-economics fixture includes C$8,000 fee, C$8,500 direct cost on a recorded per-matter basis, fee/hour ranges, predictable payment with client-feedback context, capacity, additional matters, associate staffing prerequisite and target conditions. Tests prove invented figures, audit claims, misleading payment wording and the discarded generated sentence are absent from the canonical replacement; every selected current source is retained. The 32-path selector matrix covers currently selectable known, blank and unknown answer values. Invalid, duplicate, stale, wrong-slot, over-limit and incomplete-coverage selectors still fail. The direction + enjoyment + capability combination, separate unresolved rationale, and normal rejection of invalid content in other sections are covered.

The full-project `tsc --noEmit` check passed after regenerating malformed ignored `.next/dev/types` files left by the browser development server. `git diff --check` passed.

The actual offline HTTP-response-to-screen-to-save/reopen-to-HTML-export-and-print browser regression passed locally. It uses the offline test handler and makes no live provider calls. Final-head CI has not yet run; the repair must be pushed to PR #384’s actual head branch before checking all required jobs.

The reported Library reproduction artifact was not available to these offline tests. Do not claim the exact POST payload or unlogged generated sentence was reproduced; the local fixture is a complete synthetic reproduction of the supplied negative-economics facts. No live provider call, database action, configuration change, merge or production deployment occurred. PR #384 remains open and unmerged.
