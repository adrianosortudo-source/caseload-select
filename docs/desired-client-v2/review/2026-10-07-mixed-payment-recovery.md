# PR #384: mixed-evidence section recovery

Baseline: d430fd991ba09e80044d9561b22975419feb33e0. All local reproduction data is synthetic. No live provider calls, database actions, configuration changes, merge or production deployment were performed.

## Evidence boundary

The October 7 15:00:48.837 UTC request 7e5a7a27-048b-411d-98f3-03d6d209b33d on 86d64ba returned 502 INVALID_AI_OUTPUT for why_firm_wants_work / evidence_group_selection_invalid after one call and zero repairs. Its capped claim index and filtered, deduplicated IDs do not establish raw selector validity, total claim count or the failed recovery gate.

The later October 7 request fa8422fd-3172-4907-93e5-6baab7a26cb1 on d430fd99 failed as mixed_text_not_authentic at the first claim. The card had seven claims and three valid, resolved source IDs for that selection. The generated sentence was not logged, so this record does not claim to reproduce it. Neither live failure's recovery cause is established.

One of the approved three live calls was used. The remaining two are paused pending fresh approval. This repair and its tests used zero live provider calls.

## Offline diagnosis and repair

The complete synthetic negative-economics fixture includes a C$8,000 fee and C$8,500 direct cost on a recorded per-matter basis; fee and hour ranges; predictable payment with client-feedback context; capacity; additional matters; associate staffing prerequisite; target; and review period.

The recovery selector checks shape, seven-claim and eight-group limits, unique current group IDs, slot, complete resolution, group and source-path limits, valid mixed-selection status, and coverage of every source represented by the selected IDs. The previous recovery path also authenticated prose for claims it would discard. That extra gate was unnecessary and could reject otherwise eligible mixed selections. Recovery now discards every generated claim text in the section and reconstructs the full section from current structured answers. The rebuilt card then goes through normal final validation. Invalid selections and invalid content in the other five sections still fail closed.

The canonical builder now expresses the selected practice direction as a firm preference linked to practice.direction. The wording describes the chosen direction; it does not treat that preference as proof of experience or capability. The existing experience/capability statement remains separately attributed. The complete selected source set is still required, and financial, payment, fee/hour, capacity, staffing and target facts retain their existing source bases.

The independently validated definition and decision pathway, other five cards, recovery label, response metadata, saved marker validation and existing export behavior remain unchanged. No new feature or architecture is introduced.

## Verification

The focused offline recovery, builder and API-route suites passed: 70 tests total. The recovery cases prove injected unsupported figures, audit claims and misleading payment wording from every generated firm-value claim are absent from the replacement; they retain invalid, duplicate, stale, wrong-slot, over-limit and incomplete-coverage rejection. They also cover the growth-direction, enjoyment and capability combination, all fixture facts, and normal rejection of invalid text in each untouched card.

A focused TypeScript check passed across every changed implementation and test file plus imported dependencies. The full-project TypeScript check was stopped after several minutes without diagnostics while the compiler continued scanning the D: worktree.

The browser regression was updated to send injected wording through the actual offline HTTP route and assert the screen, saved/reopened draft and HTML export contain the rebuilt section. The local Next dev server opened port 3301 but did not answer page requests within the configured four-minute startup window; a retry with a longer local window also remained unresponsive and was stopped. The browser path therefore remains unverified locally. No new-head CI has run yet.

PR #384 remains open and unmerged. Production/configuration is unchanged.