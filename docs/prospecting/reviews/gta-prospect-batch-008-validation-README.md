# GTA prospect batch 008 validation

This is a read-only QA disposition of the 25 candidate records in
`gta-prospect-batch-008`, pinned to commit `f97f6a79`.

## Result

- 15 records are `accepted_for_staging`.
- 8 require a roster-count, role-boundary, or source refresh before staging.
- 2 are rejected: Davidson Cahill Morrison LLP and Massey LLP each now expose
  more than ten lawyer-or-counsel profiles on their first-party sites.
- The accepted-for-staging result is **not** at least 16.
- No exact firm-name or canonical-domain duplicate was found against the PR
  #231 baseline or batches 001–007.

`accepted_for_staging` means only that a dated first-party public-web review
supports the current GTA office and captured lawyer-role count. It is not
import approval, contact authorization, CRM activity, legal-status
confirmation, a legal-entity conclusion, or outreach authorization.

The review held stale or non-bounded roster claims rather than silently
correcting them. In particular, Morgan Joshi now presents four lawyer profiles
rather than three; Clark Farb Fiksel now presents five rather than seven; and
Williams Family Lawyers presents five rather than four. Every legacy-corpus
comparison remains `unknown_no_stable_crosswalk`; no row may be silently
merged into the 5,902-row legacy artifact.

## Boundaries

No LSO automation, bot bypass, paid-data source, form/chat/scheduling action,
contact/outreach, CRM activity/import, deployment, or merge was performed for
this review.
