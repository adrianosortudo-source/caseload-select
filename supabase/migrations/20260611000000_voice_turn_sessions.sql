-- voice_turn_sessions: per-call session store for the Voice v2 realtime
-- loop (DR-048). This table exists in production (ssxryjxifwiivghglqer) and
-- production's own migration ledger carries an entry named
-- "20260611_voice_turn_sessions" (applied as ledger version 20260628235155),
-- but no corresponding .sql file has ever existed anywhere in this
-- repository's git history (verified: git log --all across every branch
-- returns zero hits for "voice_turn_sessions"). It was applied straight to
-- production via Supabase's migration-apply tooling without the file ever
-- being committed to source control.
--
-- Source: live production introspection (information_schema + pg_catalog),
-- captured during the baseline workstream (2026-07-17), reproduced verbatim.
-- Not present in the pre-cutover old project (qpzopweonveumvuqkqgw); this
-- table postdates the 2026-05-18 project migration.
--
-- Full evidence trail: docs/BASELINE_MIGRATION_DECISION_RECORD.md

create table if not exists public.voice_turn_sessions (
  id uuid primary key default gen_random_uuid(),
  call_id text not null,
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  engine_state jsonb not null,
  turn_count integer not null default 0,
  last_seq integer not null default 0,
  finalized boolean not null default false,
  screened_lead_id uuid references public.screened_leads(id),
  expires_at timestamptz not null default (now() + interval '02:00:00'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists voice_turn_sessions_active_call_id on public.voice_turn_sessions using btree (call_id) where (not finalized);
create index if not exists voice_turn_sessions_firm_expires on public.voice_turn_sessions using btree (firm_id, expires_at) where (not finalized);

alter table public.voice_turn_sessions enable row level security;
alter table public.voice_turn_sessions force row level security;
