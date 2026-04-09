-- WF-04 State Change Router

alter table leads
  add column if not exists lead_state text
    check (lead_state in ('unaware','problem_aware','solution_aware','decision_ready','price_sensitive','delayed'))
    default 'problem_aware';

create table if not exists state_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  old_state text,
  new_state text not null,
  changed_at timestamptz not null default now()
);

alter table state_history enable row level security;
do $$ begin
  create policy "anon all" on state_history for all using (true) with check (true);
exception when duplicate_object then null; end $$;

create index if not exists state_history_lead_idx on state_history(lead_id, changed_at desc);
