-- screened_conflict_checks + screened_conflict_parties: conflict-check
-- system for Screen 2.0 screened_leads (distinct from the legacy
-- conflict_register / conflict_checks pair, which serves the legacy leads
-- table). Both tables exist in production (ssxryjxifwiivghglqer) and
-- production's own migration ledger carries a single entry named
-- "20260626_screened_conflict_checks" (applied as ledger version
-- 20260628234330), but no corresponding .sql file has ever existed
-- anywhere in this repository's git history (verified: git log --all
-- across every branch returns zero hits for either table name). Applied
-- straight to production via Supabase's migration-apply tooling without
-- the file ever being committed to source control. Grouped into one file
-- to mirror the single ledger entry.
--
-- Source: live production introspection (information_schema + pg_catalog),
-- captured during the baseline workstream (2026-07-17), reproduced
-- verbatim. Not present in the pre-cutover old project
-- (qpzopweonveumvuqkqgw); these tables postdate the 2026-05-18 project
-- migration.
--
-- Full evidence trail: docs/BASELINE_MIGRATION_DECISION_RECORD.md

create table if not exists public.screened_conflict_checks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  screened_lead_id uuid not null references public.screened_leads(id) on delete cascade,
  matter_id uuid references public.client_matters(id) on delete set null,
  check_status text not null default 'pending' check (check_status = any (array['pending','potential','cleared','waived','blocked'])),
  check_type text not null default 'intake' check (check_type = any (array['intake','matter_stage','manual'])),
  disposition text check (disposition = any (array['cleared','waived','blocked'])),
  dispositioned_by text,
  dispositioned_at timestamptz,
  notes text,
  waiver_consent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_screened_conflict_checks_firm_status on public.screened_conflict_checks using btree (firm_id, check_status, created_at desc);
create index if not exists idx_screened_conflict_checks_matter_id on public.screened_conflict_checks using btree (matter_id, created_at desc) where (matter_id is not null);
create index if not exists idx_screened_conflict_checks_screened_lead_id on public.screened_conflict_checks using btree (screened_lead_id, created_at desc);

alter table public.screened_conflict_checks enable row level security;
alter table public.screened_conflict_checks force row level security;

create table if not exists public.screened_conflict_parties (
  id uuid primary key default gen_random_uuid(),
  conflict_check_id uuid not null references public.screened_conflict_checks(id) on delete cascade,
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  party_name text not null,
  party_name_raw text not null,
  party_role text not null check (party_role = any (array['client','opposing_party','related_party','third_party'])),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_screened_conflict_parties_check_id on public.screened_conflict_parties using btree (conflict_check_id);
create index if not exists idx_screened_conflict_parties_firm_active on public.screened_conflict_parties using btree (firm_id, is_active, party_name text_pattern_ops);
create index if not exists idx_screened_conflict_parties_name on public.screened_conflict_parties using btree (party_name text_pattern_ops);

alter table public.screened_conflict_parties enable row level security;
alter table public.screened_conflict_parties force row level security;
