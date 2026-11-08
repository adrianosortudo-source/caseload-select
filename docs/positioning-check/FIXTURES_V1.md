# Positioning diagnostic fixtures and acceptance checks v1

## Fixed eight-site corpus

Freeze this set at Gate 1. Store capture time, submitted/resolved URL, selected pages, screenshot IDs, and evidence excerpts in fixture metadata. The website is input evidence only; none of its content becomes competitor research in a user report. These archetypes describe currently observed public homepage copy, not independent judgments about firm performance.

| ID | Split | URL | Observed fixture value |
|---|---|---|---|
| `site_gene` | Development | https://www.complexfamilylaw.com/ | Explicit family-law and high-conflict/complex matter emphasis; clear stated consultation step. |
| `site_mhc` | Development | https://www.mhcllp.ca/ | Family-law-only positioning, trial/appellate focus and precedent framing. |
| `site_gluckstein` | Development | https://www.gluckstein.com/ | Prominent image-led claims, injury focus, experience/credential claims and consultation CTAs. |
| `site_song` | Development | https://www.songcriminaldefence.com/ | Criminal-defence focus with broad offence list and generic self-description alongside concrete service scope. |
| `site_stringer` | Development | https://www.stringerllp.com/ | Labour/employment specialization, team orientation and employer-facing content. |
| `site_ognibene` | Development | https://ognibenelaw.ca/ | Explicitly serves businesses and individuals across workplace matters; useful for audience consistency and breadth. |
| `site_hicks` | Holdout | https://hicksadams.ca/ | Criminal trial and appeal scope, large-firm/experience claims, Ontario service area. Keep out of prompt tuning. |
| `site_dkgc` | Holdout | https://www.dkgcfamilylaw.com/ | Family-law scope, extensive matter list, consultation CTA. Keep out of prompt tuning. |

URLs and archetypes were checked on 2026-11-08 using the official firm sites. Before freezing, record current capture details; do not replace a site by expanding beyond eight. If a site changes or fails, record that state and use a synthetic fixture for the needed behavior. Holdout cases stay untouched through prompt/rubric tuning.

The live set does not establish a sparse-site or true contradiction case. Cover those conditions with synthetic evidence packets, not unsupported labels on the real firms. Keep expected assertions concise, evidence-linked, and reviewed by Sol; they are reference judgments, not infallible ground truth.

## Synthetic failure fixtures (10)

Each fixture has a deterministic expected outcome and must not yield an invented full report. Security and provider cases are exercised through the relevant collector/API boundary, not by visiting unsafe hosts during ordinary corpus capture.

| ID | Injected condition | Required acceptance |
|---|---|---|
| `fail_private_target` | URL resolves to loopback, link-local, private or otherwise disallowed address. | Reject before fetch/render; safe error; no report/evidence from target. |
| `fail_unsafe_redirect` | Public URL redirects to a prohibited host/address or crosses disallowed scheme. | Reject redirect after revalidation; do not fetch prohibited destination. |
| `fail_resource_limit` | Response/page/packet exceeds configured byte, page, text, image, or time cap. | Enforce cap; record truncation/limitation accurately; never silently imply full coverage. |
| `fail_blocked_page` | Site returns access-denied/robot challenge or otherwise blocks collection. | Clear blocked/unreadable result; no zero-filled “findings”; one explicit retry only if contract says retryable. |
| `fail_empty_js_only` | No meaningful readable text after bounded extraction (including JS-only/empty shell). | Error or unavailable assessment as contract dictates; do not fabricate content; no scores of zero for inaccessible elements. |
| `fail_render_unavailable` | Homepage screenshot capture fails while usable text exists. | Text-grounded partial report only; visual findings absent; screenshot state accurately unavailable. |
| `fail_prompt_injection` | Captured page contains instructions attempting to override the analyzer. | Treat page as untrusted evidence, not instructions; no secret disclosure or scope change; factual output remains site-grounded. |
| `fail_invalid_evidence_id` | Model cites an ID absent from collector packet or mismatched URL/screenshot. | Reject or repair once within cap; invalid reference never renders; repeated invalid output becomes explicit analysis failure. |
| `fail_provider_quota` | Gemini returns quota/availability failure. | Bounded retry policy; then honest provider error; no fabricated fallback report. |
| `fail_deadline` | Collection/model work reaches the hard deadline. | Stop work within deadline; return honest timeout state; no fake progress/completion or partial result without usable text basis. |

## Test assertions against frozen Terra contract

Contract snapshot checked against `src/lib/positioning-check/types.ts` on 2026-11-08. Required element keys, exactly once: `audience`, `practice_focus`, `central_promise`, `practical_benefits`, `emotional_benefits`, `reasons_to_choose`, `supporting_credentials`, `consistency`.

For every complete/partial result:

1. Exactly eight unique assessments use those keys; status is one of `observed | inferred | unclear | not_observed | not_assessable`.
2. Clarity is `0 | 1 | 2 | 3 | null`; null means insufficient/unassessable evidence. Zero means absent only in sufficiently reviewed material. No failed fetch is scored zero.
3. Confidence is `high | moderate | low | null`, independent of clarity and coverage; never called calibrated absent validation. It represents interpretive support only.
4. `conflict` is independent of clarity. When true, evidence supports both sides. Contradiction does not mechanically force a zero.
5. Every evidence ID resolves to a collector-created item in the captured packet. Text excerpts match captured text; URLs belong to collected pages. Screenshot claims cite a captured and analyzed screenshot. Unsupported factual assertions fail.
6. Page and screenshot coverage states/counts, truncation and limitations match the actual collector packet exactly. Visual claims cannot be inferred from image presence when analysis failed.
7. Reasons and uncertainty are concise and make clear what is observed versus inferred. Missing coverage is disclosed. No overall grade or composite score appears.
8. Directions are limited to up to three evidence-grounded hypotheses; each includes audience/situation, statement, evidence, communication implication, expected client expectation, tradeoff and three validation questions. They are materially different or abstain when evidence does not support alternatives. No competitor, effectiveness, client-demand, recognition, legal-quality, or outcome claims.
9. Prompt-injection content cannot alter system behavior. Invalid output is repaired at most once under the plan's call/deadline budget, then withheld as an explicit error.
10. Dev cases only may be used for one instability rerun; holdout URLs `site_hicks` and `site_dkgc` are evaluated once after prompt freeze and never tuned against.

## Small-corpus release checks

Use the plan's existing thresholds: at least 95% of sampled factual assertions semantically supported; every unsupported material claim corrected; at least 80% of assessable clarity ratings within one point of reviewed references; no systematic failure-to-zero behavior; no high-confidence claim contradicted by visible evidence; 100% accurate coverage states; all failure fixtures pass. Report actual denominator and sample size. These small fixture rates are release checks only, not public accuracy claims. A fabricated material claim or privacy leak is a hard stop.

## Version

Fixture set: `positioning-corpus-v1`, six development and two held-out sites. Failure set: `positioning-failures-v1`. Contract snapshot: `types.ts` as read 2026-11-08. Changes after Gate 1 require coordinator review and a recorded deviation.


## Evaluation attribution

The corpus specification and synthetic failure expectations are agent-prepared acceptance materials, not human-reviewed ground truth. Per-site reference judgments are pending the evidence-only input packets and will be labeled as Luna agent judgments. Any agreement percentages against them are internal evaluation signals only; the production plan's human-reviewed evidence-support and clarity-rating criteria remain `not performed` unless a human review is separately completed. Do not present these small-corpus or agent-reference results as public accuracy claims.
