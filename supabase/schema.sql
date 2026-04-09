-- CaseLoad Select — Phase 1 schema
-- Paste into Supabase → SQL Editor → Run once.

create extension if not exists "pgcrypto";

create table if not exists law_firm_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  case_type text check (case_type in ('immigration','corporate','family','criminal','other')),
  estimated_value numeric default 0,
  language text check (language in ('EN','PT','FR')) default 'EN',
  description text,
  stage text not null default 'new_lead'
    check (stage in ('new_lead','qualified','proposal_sent','client_won','client_lost')),
  score int default 0,
  law_firm_id uuid references law_firm_clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_sequences (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  step_number int not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','sent','failed','cancelled')),
  scheduled_at timestamptz,
  sent_at timestamptz
);

create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  law_firm_id uuid references law_firm_clients(id) on delete set null,
  status text not null default 'sent'
    check (status in ('sent','opened','completed','failed')),
  sent_at timestamptz not null default now()
);

-- Phase 1 is single-operator, so we enable permissive RLS with the anon key.
alter table law_firm_clients enable row level security;
alter table leads            enable row level security;
alter table email_sequences  enable row level security;
alter table review_requests  enable row level security;

do $$ begin
  create policy "anon all" on law_firm_clients for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on leads for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on email_sequences for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on review_requests for all using (true) with check (true);
exception when duplicate_object then null; end $$;
