# Design-check calibration: execution plan v1

Status: **approved by Adriano 2026-08-06, ready to execute.** Supersedes the
"proposed, awaiting decision" status of
`CALIBRATION_PROPOSAL_website_design_grading_v1.md`; that document remains
the evidence record this plan is built on. The approved shape is:

1. Split red flags into disqualifying (caps the grade) and advisory
   (ranks first among findings, does not cap).
2. Keep the letter grade, add an attainable-grade mechanic, and invert the
   report to lead with the attainable grade.
3. Recalibrate the grade curve to the observed distribution, but only
   after the two open measurement suspects are resolved, because the
   anchor site's score currently contains a suspected broken check.

Execute the phases in order. Each phase ends with the full gate battery
(section below), a commit, and a push. Do not batch phases into one commit.

## Ground rules for the executing session

Read these before touching anything. Every one of them was learned the
hard way in this repo.

- **Worktree:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\.claude\worktrees\design-grading`,
  branch `feat/website-design-grading`, PR #117 open. Git needs
  `git -c safe.directory=<worktree path>` on this machine. Push after each
  phase; if GitHub Actions is still in outage, push anyway and leave
  merging alone.
- **A hook blocks banned copy in any Write or Edit, including code
  comments.** No em dashes anywhere, and no banned vocabulary (delve,
  tapestry, landscape used figuratively, pivotal, testament, vibrant,
  intricate, meticulous, garner, interplay, figurative underscore,
  bolstered, fostering, showcasing, highlighting, emphasizing, enhance,
  crucial, enduring, boasts, align with, valuable). If an edit is
  rejected, rephrase; never work around the hook.
- **Type checking:** `tsconfig.json` has `incremental: true` and a stale
  `tsconfig.tsbuildinfo` returns a false clean. The only trusted check is:
  delete `tsconfig.tsbuildinfo`, then `npx tsc --noEmit --incremental false`.
- **Exit codes:** never pipe a test run into `head`/`tail`/`grep` directly;
  redirect to a file, echo `$?`, then read the file. A piped command's
  exit code is the last pipe stage's, and a "passing" run has been
  wrongly reported that way in this repo before.
- **Dev server:** `preview_start` with launch config name `design-grading`
  (port 3010, `next dev --webpack`; Turbopack is broken on the D: drive).
  Wait for Ready before the first request; first compile of the route
  takes ~20-30s.
- **Each live scan costs two real Anthropic vision calls** and 20-80s. A
  six-domain sweep is 12 calls. Run sweeps deliberately, not in loops.
- **After every sweep, read the server logs for `[design-check]` lines.**
  Both vision passes degrade silently to deterministic-only on error and a
  degraded report looks superficially normal. This tool has already lost
  its vision pass twice without the response showing it; the log lines are
  the only tell. A scan where `First Impression and Clarity` is missing
  from `dimensionBar` had no vision.
- **Do not touch:** `src/lib/screen-engine/` (byte-sync mirror discipline),
  `supabase/` (production migration freeze), `src/app/api/tools/seo-check/`
  (separate live tool), `src/app/(marketing)/` (boundary hook).
- **Evidence-bounded posture is non-negotiable.** Anything the tool cannot
  measure is disclosed (`notApplicableDimensions`, `notMeasuredDimensions`,
  `judgmentCoverage`, `notCheckableInV1`), never assumed clear and never
  assumed failed. Every change must preserve these disclosures.
- **Investigation before acceptance.** If a failure or odd score recurs
  across unrelated domains, treat it as a tool defect until proven
  otherwise. Four real defects were found exactly this way (lost vision on
  long pages, testimonials read as firm voice, legal terms of art read as
  claims, unscorable dimensions scored zero). Report investigations in the
  repo's five-section format: root cause, exact code path, fix, tests
  added, impact on existing behavior.
- **Response-shape freedom:** the tool is not publicly launched (PR #117
  unmerged, the website proxy PR waits on it), so the API response shape
  may change without back-compat. But `WebsiteDesignCheckReport.tsx` and
  its local types must be updated in the same commit as any shape change.
- **User-facing copy rules:** no em dashes, no banned vocabulary, upside
  framing, and LSO Rule 4.2-1 discipline: the attainable grade is a score
  on this tool's own published rubric, never a promise about rankings,
  clients, or business outcomes.

## Key files

| File | Role |
|---|---|
| `src/lib/design-check/aggregate.ts` | Weighted average, curve, findings, report assembly |
| `src/lib/design-check/red-flags.ts` | Overall-grade flag registry + panel |
| `src/lib/design-check/dimensions/authority.ts` | Authority flags (source of 8 of the 13 flag kinds) |
| `src/lib/design-check/dimensions/spacing.ts` | Phase 1 subject |
| `src/lib/design-check/dimensions/color-contrast.ts` + `wcag-contrast.ts` | Phase 2 subject |
| `src/lib/design-check/renderer.ts` | In-page DOM capture (spacing sample, color pairs) |
| `src/app/api/tools/website-design-check/route.ts` | Response shape |
| `src/components/website-design-check/WebsiteDesignCheckReport.tsx` | Report UI |
| `src/lib/design-check/__tests__/` | 57 existing tests, all must stay green |

Regression domain set (fixed, do not substitute):
drglaw.ca, sakurabalaw.ca, gosailaw.com, marathonlaw.ca, themblawfirm.ca,
tmalaw.ca. drglaw.ca is the calibration anchor: built to doctrine, zero
flags after the false-positive fixes, currently 58.

Baseline to compare against (post-defect-fix, 2026-08-06): drglaw 58 (no
ceiling), sakurabalaw 55 (ceiling 55), gosailaw 55 (ceiling 55), tmalaw 55
(ceiling 55), marathonlaw 40 (ceiling 40), themblawfirm 40 (ceiling 40).

## Phase 1: investigate spacing = 0 on drglaw.ca

drglaw.ca scores 0 on "Spacing, Grid, and Alignment (partial: scale
adherence only)". That site was built on a deliberate token scale, so
either the check is miscalibrated or the site genuinely departs from its
own tokens. marathonlaw.ca also scores 0. Do not assume; measure.

1. Write a scratchpad probe (not in the repo) that calls the local API or
   `renderUrl` directly and dumps `domSnapshot.spacingValuesPx` for
   drglaw.ca and marathonlaw.ca. Look at the actual distributions: how
   many values, how many distinct, where they cluster.
2. The current check (`spacing.ts`) passes only values within ±2px of the
   fixed steps 4/8/12/16/24/32/48/64/96. Hypothesis to test: a site using
   fluid `clamp()`/rem-derived spacing resolves to computed px values that
   are internally consistent but systematically off the canonical steps,
   so a disciplined modern site fails while the check was tuned for fixed
   px scales. Confirm or refute from the dumped values.
3. If confirmed, the honest fix measures what the framework actually
   cares about, deliberate system versus ad-hoc one-offs, rather than
   membership in one canonical list. Recommended shape: pass if EITHER
   the canonical-scale test passes OR the sample shows high value reuse
   (for example, the top 8 distinct values, with ±2px clustering, cover
   at least 70% of the sample). A long tail of one-off values still
   fails. Tune the exact thresholds against the probe data from ALL SIX
   domains, not just the anchor: a genuinely undisciplined site must
   still fail. If the probe shows a different root cause (sample
   pollution, wrong elements collected), fix that instead.
4. Unit tests must use real distributions captured by the probe (trimmed
   fixtures are fine), covering: the anchor site's distribution passes, a
   long-tail ad-hoc distribution fails, the small-sample not-scored path
   still works.
5. Append the five-section investigation note to
   `CALIBRATION_PROPOSAL_website_design_grading_v1.md` under a new
   "Investigation results" heading.

Acceptance: drglaw.ca spacing score is explained and no longer 0 unless
the evidence genuinely shows ad-hoc spacing (in which case document that
and leave it); the full unit suite passes; the change is justified by
dumped data quoted in the investigation note.

## Phase 2: investigate contrast not-checkable on drglaw.ca and gosailaw.com

On both sites every sampled text pair reports not-checkable, so the one
hard accessibility standard in the tool covers nothing there. The honest
disclosure is working; the coverage gap is the defect.

1. Probe first: dump the sampled color pairs (foreground, background,
   reason) for both domains. Expected cause: text elements whose computed
   `background-color` is fully transparent because the paint comes from an
   ancestor, and the capture does not walk up to find the effective
   background.
2. Fix in the renderer's in-page DOM script: resolve the effective
   background by walking the ancestor chain to the first non-transparent
   `background-color`, compositing partial alpha where the existing math
   already supports it. If an ancestor carries a `background-image` or
   gradient before a solid color is found, keep reporting not-checkable
   with that reason: never fabricate a measurable pair from an image you
   cannot read. The disclosure path must survive for the genuinely
   unmeasurable cases.
3. Regression guard in BOTH directions, verified live:
   drglaw.ca and gosailaw.com gain measured contrast pairs; and
   themblawfirm.ca's existing `contrast_failure` red flag STILL fires. A
   contrast fix that makes a real failure disappear is a worse defect
   than the coverage gap.
4. The `wcag-contrast.test.ts` math suite must pass untouched; add
   renderer-level or dimension-level tests for the ancestor-walk logic.
5. Append the five-section investigation note as in Phase 1.

## Phase 3: split flags into disqualifying and advisory

Classification is fixed by this plan; do not re-litigate it:

| Flag | Class | Ground |
|---|---|---|
| `pre_checked_consent` | disqualifying | dark pattern |
| `manufactured_urgency` | disqualifying | dark pattern |
| `exit_intent_popup` | disqualifying | dark pattern |
| `bandwagon_claim_without_proof` | disqualifying | dark pattern |
| `contrast_failure` | disqualifying | WCAG accessibility floor |
| `lso_prohibited_word` | disqualifying | regulatory |
| `lso_specialist_expert_unearned` | disqualifying | regulatory |
| `lso_aggressive_framing` | disqualifying | regulatory |
| `possible_outcome_guarantee` | disqualifying | regulatory |
| `self_designation_without_proof` | disqualifying | unverifiable superlatives sit inside LSO 4.2-1 scope |
| `no_author_entity` | advisory | market-wide gap (5 of 6 sites), real opportunity, not harm |
| `generic_full_service` | advisory | positioning opportunity |
| `unattributed_testimonials` | advisory | credibility opportunity |

Implementation:

1. Add `classification: "disqualifying" | "advisory"` to the flag types.
   Carry it on `AuthorityRedFlag` at the definition site in `authority.ts`
   (single source of truth per flag) and set it inline for the dark
   pattern and contrast flags in `red-flags.ts`.
2. `buildRedFlagPanel`: compute `ceiling` from disqualifying flags only.
   Keep one `activeFlags` list with per-flag classification in the
   response; the UI splits on it.
3. **Leave `authority.ts`'s own dimension-level capping untouched.**
   Advisory flags still cap the Authority dimension's internal score;
   that is proportionate at dimension scope (weight 15) and preserves the
   signal without letting it dominate the whole grade.
4. Every active flag also becomes a pinned entry at the top of
   `rankedFindings`: extend `RankedFinding.severity` with a `"flag"` tier
   that sorts before `"high"`, disqualifying before advisory within it.
   Write upside-framed opportunity copy per flag (the gain from clearing
   it), with the measured detail as evidence. Copy rules from Ground
   rules apply.
5. Tests (extend `aggregate.test.ts`): advisory-only flags produce
   `ceiling: null` and an uncapped score; a disqualifying flag still caps;
   mixed flags cap at the lowest disqualifying ceiling, ignoring lower
   advisory ceilings; flag findings sort before ordinary findings.
6. Verify live against the sample: sakurabalaw, gosailaw, tmalaw must
   come uncapped (scores rise above 55 to their measured average);
   marathonlaw and themblawfirm must stay capped at 40.

## Phase 4: attainable grade + report inversion

The report leads with what the site can reach, then where it is, then the
path. The attainable number is the tool's own arithmetic, never an
invented promise.

1. **The path** = `rankedFindings.slice(0, Math.max(5, flagFindingCount))`,
   which by Phase 3's sorting always contains every active flag plus the
   top ordinary findings.
2. **Attainable score**, pure function in `aggregate.ts`:
   - Start from the same per-dimension data `buildTrack1Report` already
     has.
   - For each path finding whose underlying item belongs to a
     `scoreItems`-based deterministic dimension: credit the recoverable
     points (fail to pass +10, warn to pass +5) against that dimension's
     unchanged maxScore.
   - Authority and the two judgment dimensions are NOT credited. Their
     arithmetic is not item-additive, and understating attainable is the
     safe direction: the number shown is a floor, never an overpromise.
     Say so in a code comment.
   - Ceiling: since the path always contains all active flags, the
     attainable score is uncapped (the flags are assumed cleared by
     completing the path). If a future change lets a flag fall outside
     the path, the lowest ceiling of any excluded disqualifying flag must
     still apply; assert this in a test even though it is currently
     unreachable.
   - Invariant, tested: `attainable.score >= score` always.
3. Response gains `attainable: { score, letterGrade }` and `path` (the
   findings already carry everything needed; an index list or a boolean
   on the finding both work).
4. **Report UI inversion** (`WebsiteDesignCheckReport.tsx`): order becomes
   (a) attainable grade as the lead ("Within reach: B"), (b) current
   grade and score, (c) the path, framed as the gap between the two,
   (d) dimension bar, disclosures, and the disqualifying-flag panel.
   When the site is capped, add the unlock line pattern: name the
   uncapped measured average so the reader sees what clearing the flags
   releases (for example: the underlying measured craft is 71; the
   flagged items are the ceiling). When attainable equals current (rare,
   clean site), render steady-state copy, not a zero-gap promise.
5. Tests: attainable arithmetic on a fixture (known items, known flips);
   the invariant; the equal-case; the conservative rule (an
   authority-dimension finding in the path changes nothing about the
   number).

## Phase 5: recalibrate the curve, final sweep, report back

**Gate: do not start until Phases 1 and 2 are committed with their
investigation notes.** The anchor site's score feeds the curve; anchoring
on a number that contains a suspected broken check bakes the defect in.

1. Re-run the six-domain sweep with everything above in place. Record the
   full table (score, uncapped, attainable, ceiling, flags, per-dimension
   bar) in the calibration doc under "Corrected baseline v2".
2. Derive new `GRADE_BANDS` from the measured data under three fixed
   constraints:
   - drglaw.ca (zero flags, doctrine-built) lands B or better;
   - uncapped mid-market sites land C or D, not F;
   - F is reserved for sites capped by a disqualifying flag or in the
     genuine bottom tail.
   Starting point to adjust from: A at 85, B at 70, C at 55, D at 45.
   Document the chosen thresholds AND their basis in the calibration doc,
   including the sample size (n=6) and that the curve will be revisited
   as the measured sample grows. The curve is rubric-relative; it is
   never presented anywhere as a market ranking.
3. Update the curve-pinning test in `aggregate.test.ts` intentionally: it
   currently pins 90/80/70/60. Rewrite it to pin the new thresholds with
   a comment citing the calibration doc. Do not delete it.
4. Full gate battery, then a final six-domain sweep as the acceptance
   evidence.
5. Report back to Adriano with: the before/after table, the chosen
   thresholds and why, the Phase 1 and 2 root causes, any deviation from
   this plan, and the number of vision calls spent.

Expected end state, directionally: drglaw.ca grades B or better with an
attainable at or above it; sakurabalaw/gosailaw/tmalaw land C-to-B range
uncapped with a visible attainable uplift; marathonlaw and themblawfirm
stay F while their reports lead with what clearing the flags unlocks. If
the sweep lands materially elsewhere, stop and investigate before
adjusting anything to force the expectation.

## Gate battery (every phase)

```bash
cd <worktree> && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit --incremental false; echo "TSC: $?"
```

```bash
cd <worktree> && npm test > /tmp/t.log 2>&1; echo "VITEST: $?"; tail -5 /tmp/t.log
```

```bash
cd <worktree> && npm run lint > /tmp/l.log 2>&1; echo "ESLINT: $?"; tail -3 /tmp/l.log
```

Pass = tsc exit 0, vitest exit 0 (baseline 6850 passing; the count only
goes up), eslint exit 0 with 0 errors (292 pre-existing warnings are
tolerated; do not add errors). Then commit with a conventional message
that records what was verified, and push.

## Out of scope

No changes to dimension weights, to what is measured, to the vision
prompts, to the SSRF guard, to rate limiting, or to the email gate. No
new dependencies. No Supabase writes of any kind. The seo-check tool is
untouched.
