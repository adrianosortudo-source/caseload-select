# Website Design Grading: calibration proposal v1

Status: **proposed, awaiting Adriano's decision.** Nothing here is implemented.
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
  coverage gap is real.
- **Spacing scores 0 on drglaw.ca.** A site built to a deliberate token
  scale should not score zero on scale adherence. Either the check is
  miscalibrated or DRG's scale genuinely does not match the expected ratio
  set. Worth confirming before the dimension is trusted.

## What is not proposed

No change to what the tool measures, to the dimension weights, to the
evidence-bounded disclosures, or to the two vision passes. This is about
how measurements become an output, nothing upstream of that.
