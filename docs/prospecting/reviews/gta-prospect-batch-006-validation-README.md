# GTA prospect batch 006 validation

This is a read-only QA disposition of the 25 candidate records in
`gta-prospect-batch-006`, pinned to commit
`7697ae99777507e312e09e8d5d4c86eabc489884`.

## Result

- 16 records are `accepted_for_staging`.
- 8 need a count or source refresh before staging.
- 1 record is rejected because its recorded first-party roster URL currently
  returns HTTP 404.
- No exact firm-name or canonical-domain duplicate was found against the PR
  #231 baseline or batches 001–005.

`accepted_for_staging` means only that a dated first-party public-web review
supports the current GTA office and the captured current lawyer-role count. It
is not import approval, contact authorization, CRM activity, legal-status
confirmation, a legal-entity conclusion, or outreach authorization.

The review caught four stale staged counts: Workly Law (five current lawyer
roles, not three), Sabsay Lawyers (four, not three), Wray James LLP (six, not
five), and a material roster-boundary uncertainty for several `at_least`
records. Those rows are deliberately held rather than silently corrected here.
Every legacy-corpus comparison remains `unknown_no_stable_crosswalk`; no row
may be silently merged into the 5,902-row legacy artifact.

## Boundaries

No LSO automation, bot bypass, paid-data source, form/chat/scheduling action,
contact/outreach, CRM activity/import, deployment, or merge was performed for
this review.
