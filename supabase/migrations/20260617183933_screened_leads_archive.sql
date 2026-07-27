-- screened_leads: operator archive + delete management.
--
-- Soft-archive drops a lead out of the Active and History triage views into a
-- separate Archived view (reversible, audit-preserving). Hard delete remains a
-- separate, deliberate, per-row action gated in the app (taken leads, which a
-- client_matter links back to, are protected from deletion).
alter table public.screened_leads
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_role text;

-- Partial index: the Archived view filters on archived = true; the common case
-- (archived = false) stays unindexed and cheap.
create index if not exists idx_screened_leads_archived
  on public.screened_leads(archived) where archived = true;
