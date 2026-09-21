-- Qualification profile details. Follow-up to PR #310.
-- Stores firm-fit, service, decision-maker and opportunity evidence independently
-- from diagnostic generation. Public and direct contact routes remain distinct.

create table if not exists public.prospect_firm_fit_observations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.gta_prospect_firms(id) on delete restrict,
  target_practice_areas jsonb not null default '[]'::jsonb,
  office_geography jsonb not null default '[]'::jsonb,
  lawyer_count integer,
  size_band text check (size_band in ('solo','2-5','6-15','16-50','51-plus','unknown')),
  independence_status text not null check (independence_status in ('independent','network-affiliated','branch-office','unknown')),
  fit_status text not null check (fit_status in ('pass','fail','unknown')),
  source_url text not null,
  observed_at timestamptz not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_service_observations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.gta_prospect_firms(id) on delete restrict,
  service_name text not null,
  matter_fit text not null check (matter_fit in ('strong-match','partial-match','no-match','unknown')),
  source_url text not null,
  observed_at timestamptz not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_decision_maker_contacts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.gta_prospect_firms(id) on delete restrict,
  person_name text,
  role_label text,
  role_verification text not null check (role_verification in ('first-party','reputable-directory','unverified','not-observed')),
  contact_type text not null check (contact_type in ('verified-direct-email','public-named-email','general-inbox','phone','contact-form','not-observed')),
  contact_value text,
  contact_quality text not null check (contact_quality in ('verified-direct','published-direct-unverified','general-route','not-observed')),
  source_url text not null,
  observed_at timestamptz not null,
  deliverability_state text not null check (deliverability_state in ('verified','not-tested','failed','not-applicable')),
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_opportunity_observations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.gta_prospect_firms(id) on delete restrict,
  opportunity_type text not null check (opportunity_type in ('advertising-verification-gap','landing-page-message-gap','service-routing-gap','intake-context-gap','local-discovery-gap','other')),
  finding text not null,
  recommendation_hypothesis text not null,
  source_url text not null,
  observed_at timestamptz not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('high','medium','low')),
  created_at timestamptz not null default now()
);

create index if not exists prospect_firm_fit_observations_firm_idx on public.prospect_firm_fit_observations (firm_id, observed_at desc);
create index if not exists prospect_service_observations_firm_idx on public.prospect_service_observations (firm_id, observed_at desc);
create index if not exists prospect_decision_maker_contacts_firm_idx on public.prospect_decision_maker_contacts (firm_id, observed_at desc);
create index if not exists prospect_opportunity_observations_firm_idx on public.prospect_opportunity_observations (firm_id, observed_at desc);

alter table public.prospect_firm_fit_observations enable row level security;
alter table public.prospect_service_observations enable row level security;
alter table public.prospect_decision_maker_contacts enable row level security;
alter table public.prospect_opportunity_observations enable row level security;

revoke all on public.prospect_firm_fit_observations, public.prospect_service_observations,
  public.prospect_decision_maker_contacts, public.prospect_opportunity_observations
  from anon, authenticated, public;
