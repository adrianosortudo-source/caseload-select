-- Content periods: explicit week numbering.
--
-- Weekly content was identified by its date range ("29 June to 3 July 2026").
-- The publishing calendar has drifted far enough from those dates that they
-- no longer describe reality, so the operator-facing identity becomes
-- "Week 1", "Week 2", "Week 3" instead.
--
-- Why a stored column and not an ordinal derived from starts_on order:
--
--   1. The numbering is already asserted in published client-facing copy.
--      Deliverable titles carry "Semana 1" (the relocation-clause week) and
--      "Semana 2" (the renewal-clause week) in their PT variants. A derived
--      ordinal would silently renumber those weeks the moment any earlier
--      period is added or removed, contradicting content that is already
--      live on drglaw.ca.
--   2. Not every content_period is a publishing week. A firm can hold
--      standing-asset periods (e.g. "Decision tools", explicitly not tied to
--      a single publish week) and retroactive backfill-review periods. Those
--      must be able to carry no week number at all, which a positional
--      ordinal cannot express.
--
-- NULL is therefore meaningful and expected: it means "this period is not a
-- numbered publishing week", not "not yet backfilled".
--
-- starts_on / ends_on are deliberately kept. They remain NOT NULL, still
-- carry the real schedule, still appear in the publication manifest and the
-- content-export bundle, and remain the ordering fallback for unnumbered
-- periods. This migration changes the label, not the calendar.

alter table public.content_periods
  add column if not exists week_number integer;

comment on column public.content_periods.week_number is
  'Operator-facing week label ("Week 3"). NULL means this period is not a '
  'numbered publishing week (standing assets, retroactive review passes). '
  'Never derived from starts_on ordering -- see the migration header.';

-- One firm cannot have two Week 3s. Postgres treats NULLs as distinct in a
-- unique constraint, so any number of unnumbered periods per firm remain
-- valid, which is exactly the behaviour wanted here.
create unique index if not exists content_periods_firm_week_number_key
  on public.content_periods (firm_id, week_number)
  where week_number is not null;

alter table public.content_periods
  drop constraint if exists content_periods_week_number_positive_check;
alter table public.content_periods
  add constraint content_periods_week_number_positive_check
  check (week_number is null or week_number >= 1);

-- Ordering support: the plan lists numbered weeks first (highest number, i.e.
-- most recent, at the top), then unnumbered periods by date. Mirrors the
-- order clause in getContentPlan.
create index if not exists idx_content_periods_firm_week
  on public.content_periods (firm_id, week_number desc nulls last, starts_on desc);

notify pgrst, 'reload schema';
