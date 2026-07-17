# Operator Runbook: Content Performance / Content-to-Matter Attribution

Doctrine: `docs/CONTENT_PERFORMANCE_ATTRIBUTION_MODEL.md`. Read that first
for the evidence-state/provenance model; this file is the day-to-day
"how do I actually do this" companion.

## Where to work

- `/admin/content-studio/attribution?firm_id=<id>` -- deliverable-level
  overview (placements, receipt status, attribution breakdown, unknown
  count).
- `/admin/content-studio/attribution/leads?firm_id=<id>` -- every
  attributed enquiry for a firm, optionally filtered to one deliverable.
- `/admin/content-studio/attribution/leads/<leadId>` -- one lead's full
  evidence timeline, and the entry point for recording a self-report or
  offline referral.
- `/admin/content-studio/attribution/report?firm_id=<id>` -- date-range
  report ("what we learned," data-sufficiency gated).

## Syncing observed evidence

On a lead's evidence-timeline page, "Sync observed evidence from intake"
normalizes that lead's already-captured `utm_source` / `utm_medium` /
`utm_campaign` / `utm_term` / `utm_content` / `referrer` fields into an
evidence row. It is:

- **Per-lead, operator-triggered.** There is deliberately no "sync
  everything" button. Bulk-processing historical leads is a distinct
  decision (see "Historical volume" below), not something this button
  does silently.
- **Idempotent.** Calling it twice on the same lead does not create a
  duplicate observed-evidence row; the second call reports "no new
  observed evidence to record."
- **Deterministic only.** It links a specific placement only when
  `utm_content` or `utm_term` exactly equals a real placement id. If no
  publishing workflow has ever tagged a link that way, the sync still
  records the channel-level evidence (state `known_first_touch`) but
  leaves the deliverable/placement link empty. That is correct behavior,
  not a bug -- do not try to "fix" it by manually guessing which piece a
  lead came from.

## Recording a self-report or offline referral

On the same lead page, the evidence form takes:

- **Self-reported by the prospect**: pick the closest structured
  category (referral / search / social / AI tool / event / existing
  client / other) and paste or paraphrase what they actually said.
  Prefer the prospect's own words over your summary when you have them.
- **Operator-observed offline referral**: describe what you observed or
  were told (e.g. "existing client Jane Doe mentioned referring this
  prospect at pickup"). This is your professional observation, not the
  prospect's own statement -- keep the note honest about which it is.

Both are optional. Neither creates marketing consent, subscribes anyone
to anything, or is required to process a lead normally.

## Correcting a mistake

**Never edit or delete an evidence row.** The database rejects both
outright (`content_attribution_evidence` is append-only, same as
`approval_records` and `publication_receipts`). If you got a category
wrong or misheard something, record a new entry describing the
correction in the note. There is a `supersedes_evidence_id` mechanism in
the data model for a future "corrects" UI affordance; the current UI
does not yet expose it directly, so a plain new row with an explanatory
note is the correct path today.

## Reading the evidence timeline

Each row shows: the attribution state, the evidence method, the note (if
any), who recorded it and when, and when it was observed. Rows are
oldest-first. A row that has been superseded by a later correction is
shown dimmed with a "superseded by a later correction" label -- it is
still there for audit purposes, just not the "current" answer for that
lead.

## Historical volume

The sync button processes one lead at a time by design. If you want to
backfill observed evidence across many historical leads at once, that is
a distinct, larger decision (potentially thousands of rows, a real bulk
write) that should be scoped and approved explicitly, not done leadâ€‘byâ€‘lead
through the UI out of habit, and not automated silently. This is
consistent with this repo's existing "band-shift impact" doctrine
(historical rows are never retroactively recomputed automatically;
backfills are explicit one-shot operations).

## Talking to a firm about this data

Use the exact sentences the client-safe portal view generates (e.g. "3
enquiries have an observed connection to this content"). Do not
editorialize them into stronger claims ("this content is working," "this
drove 3 signed clients") when talking to a firm -- the underlying data
does not support causal language, only evidence-graded correlation. If a
firm asks whether a specific enquiry came from a specific piece and the
evidence says `unknown`, say so. "We don't have evidence for that one" is
a complete, honest answer.
