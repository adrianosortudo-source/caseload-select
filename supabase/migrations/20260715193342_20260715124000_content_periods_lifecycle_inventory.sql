-- Publication Readiness remediation: explicit, reviewed lifecycle
-- classification for every existing DRG Law content period. DR-097.
--
-- This is the inventory the review required: every period is queried for
-- its deliverable count and approval state (not inferred from
-- starts_on/ends_on) before being classified. The full inventory, run
-- 2026-07-15:
--
--   Period                              Active  Approved  In review  Notes
--   Already published, retroactive review   5       5         0       all Counsel Note, all live (200)
--   Decision tools                          3       3         0       all Decision Tool, all live (200)
--   The relocation clause                  13      12         1       12 already live/approved, 1 genuine pending PT approval
--   The renewal clause                     13       0        13       NOTHING approved or published yet
--   Equal shares, unequal control           13       0        13       NOTHING approved or published yet
--   Founder vesting                        13       0        13       current publishing week (2026-07-13 to 07-17)
--   Power of attorney in Ontario           13       0        13       future week (2026-07-20 to 07-24)
--   Shareholder agreement clauses          13       0        13       future week (2026-07-27 to 07-31)
--
-- Classification is NOT a function of starts_on/ends_on. Two periods whose
-- calendar week has already passed ("The renewal clause", "Equal shares,
-- unequal control") are NOT classified legacy: nothing in either period
-- was ever approved or published, so there is no "already-published
-- legacy content" to reconcile against -- they are stalled, incomplete
-- backlog, the same posture as a not-yet-worked future week. A
-- date-driven rule would have wrongly called these two legacy. Conversely
-- the CURRENT week (Founder Vesting) is explicitly NOT legacy either,
-- fixing the bug the review caught in the first draft of this migration.
--
--   legacy_unreconciled: "Already published, retroactive review",
--     "Decision tools", "The relocation clause" -- all three have
--     approved, already-live content that predates the readiness ledger.
--     (Metadata for the first two is backfilled in
--     20260715121000_already_published_retroactive_review_publication_metadata.sql
--     and 20260715121500_decision_tools_publication_metadata.sql, both
--     fully live/verified; Relocation Clause's backfill is
--     20260715120500_relocation_clause_publication_metadata.sql.)
--
--   setup_required: "The renewal clause", "Equal shares, unequal control"
--     (stalled/unapproved backlogs, not legacy), "Founder vesting"
--     (current work, already metadata-complete), "Power of attorney in
--     Ontario" and "Shareholder agreement clauses" (future work). All
--     five stay at the column default (this migration touches them only
--     to make the classification explicit and reviewable, not to change
--     their value) and are NOT activated by this migration -- activation
--     is a separate, per-period, preflight-gated operator action.
--
-- readiness_lifecycle defaults to 'setup_required' for every row (see
-- 20260715120000_content_periods_readiness_activation.sql), so this
-- migration only needs to explicitly UPDATE the three legacy rows; the
-- five setup_required rows are listed below for the review record even
-- though the statement is a no-op against the default.

update public.content_periods set readiness_lifecycle = 'legacy_unreconciled'
where id = '2d84aca7-0680-4c96-9cbd-79b95c34c81f'; -- Already published, retroactive review

update public.content_periods set readiness_lifecycle = 'legacy_unreconciled'
where id = '5a755803-499c-4405-8bd7-9366de6050ed'; -- Decision tools

update public.content_periods set readiness_lifecycle = 'legacy_unreconciled'
where id = '950bad0b-fef6-4c5a-b949-fef5d9cbee90'; -- The relocation clause

-- Explicit no-ops, listed for the review record (already the column
-- default; stated here so the classification decision is visible and
-- auditable, not silently implied by "whatever the default happens to be").
update public.content_periods set readiness_lifecycle = 'setup_required'
where id = '7ca11880-42a9-4bab-940a-baf2966b9f7e'; -- The renewal clause (stalled, not legacy)

update public.content_periods set readiness_lifecycle = 'setup_required'
where id = 'c6b76007-8c4d-414b-871f-74c3b5d76676'; -- Equal shares, unequal control (stalled, not legacy)

update public.content_periods set readiness_lifecycle = 'setup_required'
where id = '187a18a7-aca5-4d7e-962e-07789b7c7923'; -- Founder vesting (current, metadata-complete, not yet activated)

update public.content_periods set readiness_lifecycle = 'setup_required'
where id = 'f54ad626-a5f1-4cf2-bbf6-d2065828ba7b'; -- Power of attorney in Ontario (future)

update public.content_periods set readiness_lifecycle = 'setup_required'
where id = '5b18cd87-72d4-429c-a1ff-041843af93d5'; -- Shareholder agreement clauses (future)
