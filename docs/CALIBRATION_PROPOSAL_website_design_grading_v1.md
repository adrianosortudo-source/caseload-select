# Website Design Grading: calibration proposal v1

Status: **approved by Adriano 2026-08-06.** Execution tracked in
`BUILD_PLAN_design_check_calibration_v1.md`; this document remains the
evidence record and now also carries the investigation results the
execution plan's gated phases produced.
Companion to `BUILD_PLAN_website_design_grading_v1.md`.

## Why this exists

The tool grades every real law firm site **F**. That is not a finding about
the market, it is a calibration failure, and it conflicts with the standing
product rule: *frame upside, never deficit*.

This proposal is separate from the three defects already fixed (lost vision
pass on long pages, testimonials scored as firm voice, legal terms of art read
as claims, unscorable dimensions scored zero). Those were bugs. What follows
is a product decision about how the tool should score, which is Adriano's
call, not a code cleanup.

## The measured baseline

Six domains, the same set seo-check uses as its regression fixtures, measured
after all four defect fixes.

| Domain | Score | Grade | Ceiling applied | Active flags |
|---|---|---|---|---|
| drglaw.ca | 58 | F | none | none |
| sakurabalaw.ca | 55 | F | 55 | generic_full_service, no_author_entity |
| gosailaw.com | 55 | F | 55 | no_author_entity |
| tmalaw.ca | 55 | F | 55 | no_author_entity |
| marathonlaw.ca | 40 | F | 40 | self_designation, no_author_entity, unattributed_testimonials, lso_specialist_expert |
| themblawfirm.ca | 40 | F | 40 | contrast_failure, self_designation, no_author_entity |

## What the data actually shows

**1. The ceiling is the score.** In five of six cases the final score equals
the red-flag ceiling exactly. The weighted average of nine dimensions,
which is the bulk of the tool, never reaches the output. Capping was meant
to stop a beautiful hero from averaging away a dark pattern. It has instead
become the entire scoring mechanism.

**2. `no_author_entity` fires on five of six sites.** A flag that fires on
83 percent of the sample is describing a market-wide norm, not a defect in
any one site. As a *finding* it is fair: law firm sites rarely ship Person
schema, and fixing it is genuinely useful. As a *capping* flag it means
"has author markup" outweighs typography, contrast, performance, mobile,
hierarchy and first impression combined.

**3. Even with zero flags, a doctrine-built site scores 58.** drglaw.ca is
the calibration anchor: we built it, it carries the LSO disclaimer, real
Person schema, and no compliance exposure. It draws no flags at all and
still lands one point below a D. So the underlying weighted average is
tuned low independently of the capping problem.

## Recommendation

### A. Split red flags into disqualifying and advisory

Only flags representing active harm or real compliance exposure should cap.
The rest become high-ranked findings that do not touch the score.

**Disqualifying (keeps capping):** dark patterns, WCAG AA contrast failure,
LSO prohibited words, unearned specialist/expert claims. These are the
genuine "do not average this away" cases, and two of them are regulatory.

**Advisory (stops capping, ranks first in findings):** no_author_entity,
generic_full_service, unattributed_testimonials. Real opportunities, not
disqualifiers.

Effect on the sample: DRG unchanged at 58; sakurabalaw, gosailaw and tmalaw
score on their measured quality instead of a flat 55; marathonlaw and
themblawfirm stay capped, correctly, on LSO and contrast grounds.

### B. Retire the letter grade

This is the larger recommendation and the one worth arguing about.

A letter grade is deficit framing by construction. "You scored F" is
exactly the thing the product rule forbids, and it is the first thing a
prospect sees. It is also not actionable: an F tells a lawyer nothing about
what to do on Monday.

Replace it with what the tool is actually good at:

- the ranked opportunity list it already produces, upside-first
- a comparative band against the firms measured so far, which is honest
  because it is relative and evidence-bounded ("stronger than most of the
  Toronto firm sites we have measured on typography and performance, with
  the largest opening in authority signals")
- the disqualifying flags surfaced plainly, because a contrast failure or
  an LSO exposure is worth naming directly

That keeps every measurement, drops the one element that is both
demoralizing and uninformative, and matches how seo-check's own scores are
already framed internally (never as a client-facing ranking promise).

### C. If the letter grade stays, move the curve

If Adriano wants to keep a grade, the thresholds need to reflect the real
distribution rather than an academic 90/80/70/60. On current evidence the
market sits in the 40 to 60 band, so the curve should be anchored to
observed percentiles, recalculated as the sample grows, and the sample size
disclosed on the report.

## Two open suspects, not yet investigated

Found in the same sweep, flagged rather than fixed, because each needs its
own look:

- **Contrast is unmeasurable on two of six sites.** drglaw.ca and
  gosailaw.com return "not checkable" for every text pair, so the one hard
  accessibility standard in the tool silently covers nothing there. Likely
  cause is transparent/inherited backgrounds the checker will not resolve
  to an effective colour. The honest disclosure is working, but the
  coverage gap is real. **Status: investigated, see Phase 2 below.**
- ~~**Spacing scores 0 on drglaw.ca.**~~ **Status: investigated and fixed,
  see Phase 1 below.**

## Investigation results

### Phase 1: spacing scores 0 on drglaw.ca (fixed)

**Root cause.** Two independent defects in the spacing-scale-adherence
sample, found by dumping the raw `spacingValuesPx` distribution live
against all six regression domains rather than assuming either "the check
is wrong" or "the site is wrong."

First, the sample was polluted by auto-centering margins. drglaw.ca's
`.container { max-width: 1240px; margin: 0 auto; }` pattern (the single
most common CSS layout idiom in existence) computes `marginLeft` and
`marginRight` to identical values driven purely by viewport arithmetic:
`(1440 - 1240) / 2 = 100`. That 100 is not a spacing decision anyone made;
it is a side effect of centering a fixed-width box in whatever viewport
the tool happens to render at. It dominated the raw sample (26 of 178
values, tied for the single most frequent value) and, being 4px off the
nearest named scale step, was scored as evidence of ad-hoc spacing.
Confirmed by dumping the actual element, class, and computed style behind
every repeated off-scale value: every instance traced to a
`max-width`-constrained container with `marginLeft === marginRight`.

Second, once the polluted margins were excluded, drglaw.ca's remaining
off-scale values (56, 80, 88, 112, 40, 72, 200, all appearing repeatedly)
were checked against the framework's named canonical progression
(4/8/12/16/24/32/48/64/96px) and found not to match, at 52% adherence
(the "warn" band, not "fail" but still short of "pass"). Every one of
those values is an exact multiple of 8, none of them a coincidence: this
is the plain 8-point grid, the other extremely common spacing convention
alongside the named progressive scale the check already recognized. The
named scale is one legitimate design-token system; a linear 8px grid is
another, equally legitimate one the check simply did not know about.

**Exact code path.** `src/lib/design-check/renderer.ts`, the
`spacingValuesPx` capture inside `DOM_SNAPSHOT_SCRIPT` (in-page script,
runs in the rendered browser): now skips `marginLeft`/`marginRight` on an
element whose `maxWidth !== 'none'` and whose two margins are equal
(the auto-centering signature). `src/lib/design-check/dimensions/spacing.ts`:
`isOnScale` now accepts a value on EITHER the named `SCALE_STEPS` list
(unchanged, ±2px) OR an exact multiple of 8 (new, tight ±1px tolerance,
deliberately not the same generous slack as the named list, so this does
not become a net wide enough to also catch ad-hoc spacing).

**Fix.** Both changes above, plus the report copy updated to state both
accepted systems rather than only the named one.

**Tests added.** `src/lib/design-check/dimensions/__tests__/spacing.test.ts`,
5 tests. Two are pinned against the exact, real, unmodified value lists
captured live from drglaw.ca (150 values post centering-margin exclusion:
52% named-only, 93% combined, now "pass") and marathonlaw.ca (73 values,
no centering containers to exclude: 36% named-only, 42% combined, still
"fail"), each verified against the fixed logic by script before being
hardcoded, not hand-computed (an earlier hand-computed draft of these
fixtures contained real classification errors, caught by that
verification step rather than shipped). The remaining three tests cover
the too-small-sample no-op path, a pure-8pt-grid-only distribution
(proves the new branch fires on its own), and a near-miss case 2px off
grid alignment (proves the tolerance is genuinely tight, not accidentally
wide enough to credit arbitrary numbers).

**Impact on existing behavior.** Live-verified end to end through the
real API route (not just the standalone investigation probes): drglaw.ca
spacing moved from 0 to 100 (fail to pass), overall score from 58 to 73.
marathonlaw.ca spacing stayed at 0 (fail, 42%), overall score unchanged
at 40 (still separately capped by its LSO and authority flags). No other
dimension, and no other domain in the regression set, changed status
under the fix; the named-scale-only path is untouched for every value
that was already correctly classified before this change.

### Phase 2: contrast not-checkable on drglaw.ca and gosailaw.com (fixed)

**Root cause.** Confirmed the plan's hypothesis exactly: every sampled
text element (h1, body paragraphs, CTAs, one per heading level) on
drglaw.ca and gosailaw.com had a transparent own `background-color`, so
`checkTextContrast` reported every one of them not checkable. Dumping
the actual ancestor chain behind each sample showed the effective
background was always painted by something further up.

**Fix, attempt 1 (rejected, kept for the record).** A DOM ancestor walk,
finding the first ancestor with a non-transparent own background-color
and refusing to trust it if an intervening ancestor carried a
background-image. This correctly fixed gosailaw.com (whose hero photo is
a real `background-image` on the `<header>` ancestor itself) but, live
on drglaw.ca, produced a **false contrast failure**: a confident `1:1`
"fail" on legible white hero text. Root cause of THIS defect: drglaw.ca's
hero uses the standard photo-with-darkening-scrim technique via
absolutely-positioned SIBLING elements (`<img class="v3-hero-bg">` and a
`<div class="v3-hero-scrim">` carrying the gradient), not an ancestor's
own CSS properties. A DOM-ancestor-only walk cannot see a sibling; it
resolved straight past the entire hero to the plain page background four
sections down, and that background happened to be close in luminance to
the hero text colour, producing a false near-identical-colours failure.
A confidently wrong accusation on a check the tool's own copy calls "an
accessibility floor, not a stylistic preference" is a materially worse
defect than the "not checkable" it was meant to fix, so this version was
not shipped.

**Fix, attempt 2 (shipped).** Replaced the DOM-tree walk with
`document.elementsFromPoint()` at the sampled element's own on-screen
centre: this asks the browser for the real front-to-back paint order at
that pixel, which inherently includes absolutely-positioned siblings,
z-index stacking, and everything else a hand-rolled ancestor walk would
have to reimplement. The walk still refuses to trust anything once it
passes an `<img>`/`<video>`/`<canvas>`/`<svg>`/`<picture>` element or
anything with a `background-image`, before it reaches an opaque
`background-color`; drglaw.ca's hero scrim and photo are both correctly
encountered first in paint order and correctly leave that specific
sample unresolved. Also fixed a second defect caught before it shipped:
the resolver was being called unconditionally, including for elements
that already declare their OWN real opaque background (a filled button),
which would have resolved to whatever sits BEHIND the element once the
element itself was excluded from the stack walk, discarding a colour
that was already correct. Gated: the resolver only runs when the
element's own background is genuinely transparent.

**Exact code path.** `src/lib/design-check/renderer.ts`,
`resolveEffectiveBackgroundColor` (new, in-page) and `sampleText`
(gates the call on the element's own background actually being
transparent). `wcag-contrast.ts` and `color-contrast.ts` are unchanged;
the fix only changes what colour string reaches their existing,
untouched checkable/not-checkable logic.

**Tests added.** `src/lib/design-check/dimensions/__tests__/color-contrast.test.ts`
(new, 4 tests; `scoreColorContrast` had zero prior coverage). The paint-stack
resolver itself runs only in a real browser and is not unit-testable in
jsdom; these tests instead pin how the dimension scorer combines resolved
and still-unresolved samples, using fixtures that reproduce the three
real outcomes the live check produced (a clean resolved pass, a resolved
sample that still fails WCAG, and a genuinely unresolvable sample staying
not-checkable), plus the mixed-coverage note. `wcag-contrast.test.ts`'s
existing 15 math tests pass unchanged, confirming the fix did not touch
the contrast formula itself, only what background colour reaches it.

**Impact on existing behavior.** Live-verified end to end, both
directions, through the real API route: drglaw.ca Color and Contrast
moved from fully uncheckable to 100 (every resolvable sample passes
clean, zero contrast findings, no `contrast_failure` flag), overall
score 73 to 78. gosailaw.com's dimension honestly stays fully
uncheckable: its one substantive text sample (the h1) sits directly over
its hero photo, so correctly staying unresolved is the accurate outcome,
not a remaining gap in the fix. themblawfirm.ca's real `contrast_failure`
flag survives unchanged (still fires on "Book an appointment" at 1.77:1),
while its dimension score rose from 50 to 83 as other, genuinely
resolvable samples on the same page gained real coverage. Server logs
confirmed no `[design-check]` vision-degradation lines across all scans.

## What is not proposed

No change to what the tool measures, to the dimension weights, to the
evidence-bounded disclosures, or to the two vision passes. This is about
how measurements become an output, nothing upstream of that.
