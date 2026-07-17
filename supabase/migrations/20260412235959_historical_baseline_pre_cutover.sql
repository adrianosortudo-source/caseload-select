-- Historical baseline: tables that existed before this repository's migration
-- tracking began. Production (ssxryjxifwiivghglqer) was migrated from an
-- older Supabase project (qpzopweonveumvuqkqgw) on 2026-05-18 via
-- schema+data dump/restore, not by replaying this repo's migration files.
-- The 11 tables below have zero CREATE TABLE anywhere in this repository's
-- git history (verified across every branch); they existed in the old
-- project before any migration file was ever written against them, and were
-- carried over in that dump/restore. The very first migration file in this
-- repo, 20260413_add_confirmed_answers.sql, already ALTERs intake_sessions,
-- proving it existed before this repo's migration history starts.
--
-- Every column/constraint/index/trigger below was read directly from the
-- old project (qpzopweonveumvuqkqgw) via information_schema / pg_catalog
-- introspection during the baseline workstream (2026-07-17). Where the old
-- project and current production have identical schemas for a table (no
-- local ALTER TABLE migration ever touches it), the definition below is
-- final. Where local ALTER TABLE migrations exist (intake_firms: 24 files,
-- leads: 5 files, intake_sessions: 4 files), this baseline intentionally
-- contains only the OLD PROJECT's base columns/constraints/indexes; the
-- existing local migration files bring the schema forward to current
-- production state. Nothing here is invented or guessed.
--
-- Full evidence trail: docs/BASELINE_MIGRATION_DECISION_RECORD.md

-- touch_updated_at() is itself old-project-native infrastructure: it exists
-- on the old project with no corresponding CREATE FUNCTION migration file
-- before 20260506_firm_files.sql (which later re-declares it via CREATE OR
-- REPLACE). intake_firms and intake_sessions triggers below need it to
-- exist at creation time, so it is declared here, matching the old
-- project's verbatim definition.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$ begin new.updated_at = now(); return new; end; $function$;

-- ─────────────────────────────────────────────────────────────────────────
-- law_firm_clients (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.law_firm_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  contact_email text
);

alter table public.law_firm_clients enable row level security;
alter table public.law_firm_clients force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- intake_firms (old project BASE schema; 24 local ALTER TABLE migrations
-- bring this forward to current production state)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.intake_firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  practice_areas jsonb not null default '[]'::jsonb,
  question_sets jsonb not null default '{}'::jsonb,
  geographic_config jsonb not null default '{}'::jsonb,
  branding jsonb default '{}'::jsonb,
  ghl_webhook_url text,
  ghl_api_key text,
  resend_sender text,
  custom_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  clio_config jsonb,
  custom_domain text unique,
  location text,
  monthly_ad_spend numeric,
  hero_metrics jsonb default '["signed_cases", "cpsc", "avgResponseSecs"]'::jsonb,
  metric_definitions jsonb,
  engagement_start_date date,
  voice_webhook_secret text,
  facebook_page_id text,
  instagram_business_account_id text,
  whatsapp_phone_number_id text,
  facebook_page_access_token text,
  whatsapp_cloud_api_access_token text
);

create index if not exists idx_intake_firms_custom_domain on public.intake_firms using btree (custom_domain);

create trigger intake_firms_touch
  before update on public.intake_firms
  for each row execute function public.touch_updated_at();

alter table public.intake_firms enable row level security;
alter table public.intake_firms force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- sequence_templates (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.sequence_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger_event text not null check (trigger_event = any (array[
    'new_lead','no_engagement','client_won','no_show','stalled_retainer',
    'incomplete_intake','spoke_no_book','consulted_no_sign','retainer_awaiting',
    'consultation_scheduled','review_request','matter_active','re_engagement',
    'relationship_milestone','long_term_nurture','client_lost'
  ])),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sequence_templates enable row level security;
alter table public.sequence_templates force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- diagnostics (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_name text not null,
  recipient_email text not null,
  full_report_markdown text not null,
  interview_transcript text not null,
  email_status text not null default 'pending' check (email_status = any (array['pending','sent','failed'])),
  email_sent_at timestamptz,
  email_error text,
  source text not null default 'chatgpt-custom-gpt'
);

create index if not exists diagnostics_company_name_idx on public.diagnostics using btree (company_name);
create index if not exists diagnostics_created_at_idx on public.diagnostics using btree (created_at desc);
create index if not exists diagnostics_email_status_idx on public.diagnostics using btree (email_status);

-- Old project: RLS enabled, NOT forced (unlike every other table in this file).
alter table public.diagnostics enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- discovery_reports (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.discovery_reports (
  id uuid primary key default gen_random_uuid(),
  firm_name text not null,
  report_content text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.discovery_reports enable row level security;
alter table public.discovery_reports force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- sequence_steps (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequence_templates(id) on delete cascade,
  step_number integer not null,
  delay_hours integer not null default 0,
  channels jsonb not null default '{"sms": {"body": "", "active": false}, "email": {"body": "", "active": true, "subject": ""}, "internal": {"note": "", "active": false}, "whatsapp": {"body": "", "active": false, "template_name": ""}}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sequence_steps_sequence_id on public.sequence_steps using btree (sequence_id);

alter table public.sequence_steps enable row level security;
alter table public.sequence_steps force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- intake_sessions (old project BASE schema; 4 local ALTER TABLE migrations
-- bring this forward to current production state, incl. otp_attempts)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references public.intake_firms(id) on delete cascade,
  channel text not null check (channel = any (array['widget','whatsapp','chat','email','phone'])),
  status text not null default 'in_progress' check (status = any (array['in_progress','complete','abandoned'])),
  conversation jsonb not null default '[]'::jsonb,
  scoring jsonb not null default '{}'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  extracted_entities jsonb not null default '{}'::jsonb,
  practice_area text,
  band text check (band is null or band = any (array['A','B','C','D','E','X'])),
  otp_code text,
  otp_expires_at timestamptz,
  otp_verified boolean not null default false,
  crm_synced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  situation_summary text,
  round3_answers jsonb,
  round3_started_at timestamptz,
  round3_completed_at timestamptz,
  memo_text text,
  memo_generated_at timestamptz,
  practice_sub_type text
);

create index if not exists idx_intake_sessions_memo on public.intake_sessions using btree (firm_id, memo_generated_at) where (memo_generated_at is not null);
create index if not exists idx_intake_sessions_round3_stalled on public.intake_sessions using btree (round3_started_at) where (round3_started_at is not null and round3_completed_at is null);
create index if not exists idx_intake_sessions_sub_type on public.intake_sessions using btree (firm_id, practice_sub_type) where (practice_sub_type is not null);
create index if not exists idx_sessions_firm_status on public.intake_sessions using btree (firm_id, status);

create trigger intake_sessions_touch
  before update on public.intake_sessions
  for each row execute function public.touch_updated_at();

alter table public.intake_sessions enable row level security;
alter table public.intake_sessions force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- leads (old project == current production at the column level; 5 local
-- ALTER TABLE migrations exist but do not add columns beyond what's below)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  case_type text,
  estimated_value numeric default 0,
  language text default 'EN' check (language = any (array['EN','PT','FR'])),
  description text,
  stage text not null default 'new_lead',
  score integer default 0,
  law_firm_id uuid references public.law_firm_clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fit_score integer default 0,
  value_score integer default 0,
  cpi_score integer default 0,
  band text check (band is null or band = any (array['A','B','C','D','E','X'])),
  referral_source text,
  urgency text,
  timeline text,
  city text,
  lead_state text default 'problem_aware',
  geo_score integer,
  contactability_score integer,
  legitimacy_score integer,
  complexity_score integer,
  urgency_score integer,
  strategic_score integer,
  fee_score integer,
  priority_index integer,
  priority_band text check (priority_band is null or priority_band = any (array['A','B','C','D','E','X'])),
  source text,
  location text,
  referral boolean default false,
  multi_practice boolean default false,
  persistence_step integer default 0,
  persistence_started_at timestamptz,
  persistence_last_action_at timestamptz,
  persistence_status text default 'inactive' check (persistence_status = any (array['inactive','active','paused','completed','exited'])),
  persistence_exit_reason text check (persistence_exit_reason is null or persistence_exit_reason = any (array['engaged','won','lost','day11'])),
  no_show_step integer default 0,
  no_show_started_at timestamptz,
  no_show_last_action_at timestamptz,
  no_show_status text default 'inactive' check (no_show_status = any (array['inactive','active','completed','exited'])),
  stalled_step integer default 0,
  stalled_started_at timestamptz,
  stalled_last_action_at timestamptz,
  stalled_status text default 'inactive' check (stalled_status = any (array['inactive','active','completed','exited'])),
  first_contact_at timestamptz,
  stage_changed_at timestamptz default now(),
  intake_session_id uuid references public.intake_sessions(id) on delete set null,
  cpi_confidence text check (cpi_confidence is null or cpi_confidence = any (array['high','medium','low'])),
  cpi_explanation text,
  cpi_missing_fields jsonb,
  scoring_model text check (scoring_model is null or scoring_model = any (array['v2.1_form','gpt_cpi_v1'])),
  score_components jsonb
);

create index if not exists idx_leads_cpi_confidence_recent on public.leads using btree (cpi_confidence, created_at desc) where (cpi_confidence = 'low');
create index if not exists idx_leads_intake_session_id on public.leads using btree (intake_session_id);
create index if not exists idx_leads_scoring_model on public.leads using btree (scoring_model, created_at desc) where (scoring_model is not null);

alter table public.leads enable row level security;
alter table public.leads force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- email_sequences (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  step_number integer not null,
  status text not null default 'scheduled' check (status = any (array['scheduled','sent','failed','cancelled'])),
  scheduled_at timestamptz,
  sent_at timestamptz,
  sequence_step_id uuid references public.sequence_steps(id) on delete set null
);

alter table public.email_sequences enable row level security;
alter table public.email_sequences force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- review_requests (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  law_firm_id uuid references public.law_firm_clients(id) on delete set null,
  status text not null default 'sent' check (status = any (array['pending','sent','opened','completed','failed'])),
  sent_at timestamptz not null default now()
);

alter table public.review_requests enable row level security;
alter table public.review_requests force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- state_history (old project == current production, no local ALTERs)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.state_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_state text,
  new_state text not null,
  changed_at timestamptz not null default now()
);

create index if not exists state_history_lead_idx on public.state_history using btree (lead_id, changed_at desc);

alter table public.state_history enable row level security;
alter table public.state_history force row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- get_dashboard_stats() (old project == current production, byte-identical
-- pg_get_functiondef() on both, no local CREATE/REPLACE migration anywhere
-- in this repo's history)
--
-- Discovered missing during the fresh-database bootstrap test (Workstream 3):
-- 20260605175457_security_lockdown_anon_authenticated.sql revokes EXECUTE on
-- this function at statement 39, which fails hard on a fresh database because
-- nothing ever creates it. Same evidence class as the tables above: it
-- predates this repo's migration history (ledger starts 2026-05-18) and
-- exists verbatim on both qpzopweonveumvuqkqgw and ssxryjxifwiivghglqer.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.get_dashboard_stats()
returns json
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select json_build_object(
    'total_leads',
      (select count(*) from leads),
    'qualified_leads',
      (select count(*) from leads where stage = 'qualified'),
    'client_won',
      (select count(*) from leads where stage = 'client_won'),
    'client_lost',
      (select count(*) from leads where stage = 'client_lost'),
    'overdue_leads',
      (select count(*)
       from leads
       where stage not in ('client_won', 'client_lost')
         and updated_at < now() - interval '72 hours'),
    'active_firms',
      (select count(*) from law_firm_clients where status = 'active'),
    'avg_cpi',
      (select coalesce(round(avg(coalesce(priority_index, cpi_score))), 0) from leads),
    'avg_value',
      (select coalesce(round(avg(estimated_value)), 0) from leads),
    'revenue_forecast',
      (select coalesce(
        sum(estimated_value * (coalesce(priority_index, score, 50)::float / 100.0)), 0)
       from leads
       where stage in ('qualified', 'proposal_sent')),
    'review_open_rate',
      (select case
        when count(*) = 0 then 0
        else round(
          100.0
          * count(*) filter (where status in ('opened', 'completed'))
          / count(*)
        )
       end
       from review_requests),
    'by_stage',
      (select coalesce(
        json_agg(json_build_object('stage', stage, 'count', cnt) order by cnt desc),
        '[]'::json)
       from (select stage, count(*) as cnt from leads group by stage) t),
    'by_band',
      (select coalesce(
        json_agg(json_build_object('band', band, 'count', cnt) order by band),
        '[]'::json)
       from (
         select coalesce(priority_band, band) as band, count(*) as cnt
         from leads
         where coalesce(priority_band, band) is not null
         group by coalesce(priority_band, band)
       ) t),
    'by_case_type',
      (select coalesce(
        json_agg(json_build_object('case_type', case_type, 'count', cnt) order by cnt desc),
        '[]'::json)
       from (select case_type, count(*) as cnt from leads where case_type is not null group by case_type) t),
    'firms',
      (select coalesce(
        json_agg(json_build_object(
          'id',             f.id,
          'name',           f.name,
          'location',       f.location,
          'status',         f.status,
          'lead_count',     (select count(*) from leads l where l.law_firm_id = f.id),
          'won_count',      (select count(*) from leads l where l.law_firm_id = f.id and l.stage = 'client_won'),
          'pipeline_value', (select coalesce(sum(l.estimated_value), 0) from leads l
                             where l.law_firm_id = f.id and l.stage in ('qualified', 'proposal_sent'))
        )),
        '[]'::json)
       from law_firm_clients f)
  );
$function$;
