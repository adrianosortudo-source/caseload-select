-- LOCAL DRAFT ONLY. Do not apply directly.
-- Target: public.prospect_firms in caseload-select-app.
-- Requires a pushed PR, CI fresh-Postgres validation, and explicit merge approval.
-- Deliberately has no FK or trigger dependency on agency_prospects or diagnostics.

create table if not exists public.prospect_lso_licensees (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  regulator_licensee_id text not null,
  display_name text,
  status text,
  source_snapshot_id text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_system, regulator_licensee_id)
);

create table if not exists public.prospect_firm_affiliations (
  id uuid primary key default gen_random_uuid(),
  licensee_id uuid not null references public.prospect_lso_licensees(id) on delete restrict,
  firm_id uuid references public.prospect_firms(id) on delete restrict,
  office_label text,
  role_label text,
  mapping_status text not null check (mapping_status in ('confirmed','candidate','conflict','unresolved','superseded')),
  evidence_ids jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (licensee_id, firm_id, office_label, observed_at)
);

create table if not exists public.prospect_source_record_map (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_record_id text not null,
  firm_id uuid references public.prospect_firms(id) on delete restrict,
  mapping_status text not null check (mapping_status in ('confirmed','candidate','conflict','distinct','superseded')),
  identity_decision_id text,
  evidence_ids jsonb not null default '[]'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_system, source_record_id)
);

create table if not exists public.prospect_source_captures (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references public.prospect_firms(id) on delete restrict,
  requested_url text,
  final_url text,
  publisher text,
  retrieval_method text not null,
  http_status integer,
  observed_at timestamptz not null,
  sha256 text,
  retained_artifact text,
  policy_state text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_research_attempts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references public.prospect_firms(id) on delete restrict,
  provider text not null,
  query_or_url text not null,
  outcome text not null check (outcome in ('success-positive','success-negative','robots-disallowed','policy-blocked','http-4xx','http-5xx','rate-limited','captcha-or-challenge','timeout','dns-error','tls-error','redirect-policy-failure','render-or-parse-failure','identity-conflict','unsupported-source','not-run')),
  coverage text not null check (coverage in ('complete','partial','failed','not-run')),
  failure_reason text,
  observed_at timestamptz not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_advertising_observations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references public.prospect_firms(id) on delete restrict,
  canonical_domain text,
  evidence_type text not null check (evidence_type in ('advertising-pixel','direct-ad','sponsored-placement','historical-ad')),
  vendor text,
  signal_type text,
  signal_id text,
  advertiser_identity text,
  advertised_service text,
  destination_url text,
  observed_at timestamptz not null,
  effective_date date,
  last_shown_date date,
  recency_basis text,
  source_url text not null,
  capture_id uuid references public.prospect_source_captures(id) on delete restrict,
  identity_state text not null,
  reviewed boolean not null default false,
  attributable boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_qualification_decisions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references public.prospect_firms(id) on delete restrict,
  run_id text not null,
  rule_version text not null,
  advertising_status text check (advertising_status in ('recent-ad-verified','historical-ad-only','pixels-detected','not-observed')),
  advertising_status_state text not null check (advertising_status_state in ('current','stale','unknown')),
  fit_decision text not null check (fit_decision in ('pass','fail','unknown')),
  commercial_relevance text not null check (commercial_relevance in ('strong-match','partial-match','no-match','unknown')),
  decision_maker_access text not null check (decision_maker_access in ('pass','fail','unknown')),
  opportunity_decision text not null check (opportunity_decision in ('pass','fail','unknown')),
  selection_disposition text not null check (selection_disposition in ('selected','eligible-not-selected','verification-required','policy-hold','technical-hold','disqualified')),
  evidence_ids jsonb not null default '[]'::jsonb,
  rationale text not null,
  decided_at timestamptz not null default now()
);

create table if not exists public.prospect_export_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  rule_version text not null,
  manifest_sha256 text not null,
  output_sha256 jsonb not null,
  selected_count integer not null,
  assessed_count integer not null,
  import_authorized boolean not null default false,
  contact_authorized boolean not null default false,
  send_authorized boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_diagnostic_ready_profiles (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.prospect_firms(id) on delete restrict,
  qualification_decision_id uuid not null references public.prospect_qualification_decisions(id) on delete restrict,
  readiness_state text not null check (readiness_state in ('ready','stale','held','rejected','reserved','exported')),
  validated_at timestamptz not null,
  expires_at timestamptz,
  evidence_freshness_days integer not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  unique (firm_id, qualification_decision_id)
);

create table if not exists public.prospect_diagnostic_reservations (
  id uuid primary key default gen_random_uuid(),
  ready_profile_id uuid not null references public.prospect_diagnostic_ready_profiles(id) on delete restrict,
  reservation_key text not null unique,
  consumer_batch_id text not null,
  state text not null check (state in ('reserved','accepted','released','rejected','expired')),
  reserved_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_reason text,
  unique (ready_profile_id, consumer_batch_id)
);

create index if not exists prospect_advertising_observations_firm_idx on public.prospect_advertising_observations (firm_id, observed_at desc);
create index if not exists prospect_research_attempts_firm_idx on public.prospect_research_attempts (firm_id, observed_at desc);
create index if not exists prospect_qualification_decisions_run_idx on public.prospect_qualification_decisions (run_id, selection_disposition);

alter table public.prospect_source_record_map enable row level security;
alter table public.prospect_source_captures enable row level security;
alter table public.prospect_research_attempts enable row level security;
alter table public.prospect_advertising_observations enable row level security;
alter table public.prospect_qualification_decisions enable row level security;
alter table public.prospect_export_runs enable row level security;
alter table public.prospect_lso_licensees enable row level security;
alter table public.prospect_firm_affiliations enable row level security;
alter table public.prospect_diagnostic_ready_profiles enable row level security;
alter table public.prospect_diagnostic_reservations enable row level security;

revoke all on public.prospect_source_record_map, public.prospect_source_captures,
  public.prospect_research_attempts, public.prospect_advertising_observations,
  public.prospect_qualification_decisions, public.prospect_export_runs,
  public.prospect_lso_licensees, public.prospect_firm_affiliations,
  public.prospect_diagnostic_ready_profiles, public.prospect_diagnostic_reservations
  from anon, authenticated, public;
