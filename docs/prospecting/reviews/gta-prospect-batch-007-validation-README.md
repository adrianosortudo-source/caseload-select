# GTA prospect batch 007 validation

This is a read-only QA disposition of the 25 candidate records in
`gta-prospect-batch-007`, pinned to commit
`7ba324822841f7daebca4b0f00b8985975386e36`.

## Result

- 12 records are `accepted_for_staging`.
- 10 require a roster-count or source refresh before staging.
- 3 are rejected: Levitt Di Lella Duggan & Chaplick LLP and Levitt LLP now
  exceed the 3–10-lawyer target, while the cited Cumming & Partners source
  returns HTTP 404.
- No exact firm-name or canonical-domain duplicate was found against the PR
  #231 baseline or batches 001–006.

`accepted_for_staging` means only that a dated first-party public-web review
supports the current GTA office and captured lawyer-role count. It is not
import approval, contact authorization, CRM activity, legal-status
confirmation, a legal-entity conclusion, or outreach authorization.

The review held stale or non-bounded roster claims rather than silently
correcting them. In particular, Arkin Furrow now presents nine lawyer-or-
counsel profiles rather than four; Drake Law presents ten rather than seven;
and Normandin Chris presents twelve rather than seven. Every legacy-corpus
comparison remains `unknown_no_stable_crosswalk`; no row may be silently
merged into the 5,902-row legacy artifact.

## Boundaries

No LSO automation, bot bypass, paid-data source, form/chat/scheduling action,
contact/outreach, CRM activity/import, deployment, or merge was performed for
this review.
