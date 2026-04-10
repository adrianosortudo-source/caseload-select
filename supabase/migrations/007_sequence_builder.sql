-- Migration 007 — Sequence Builder (multi-channel JSONB schema)
-- Run once in Supabase → SQL Editor

-- ── 1. sequence_templates ─────────────────────────────────────────────────
create table if not exists sequence_templates (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  trigger_event  text        not null
    check (trigger_event in ('new_lead','no_engagement','client_won','no_show','stalled_retainer')),
  description    text,
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── 2. sequence_steps (channels JSONB — no separate subject/body columns) ─
create table if not exists sequence_steps (
  id           uuid        primary key default gen_random_uuid(),
  sequence_id  uuid        not null references sequence_templates(id) on delete cascade,
  step_number  integer     not null,
  delay_hours  integer     not null default 0,
  channels     jsonb       not null default '{
    "email":     {"subject": "", "body": "", "active": true},
    "sms":       {"body": "", "active": false},
    "whatsapp":  {"template_name": "", "body": "", "active": false},
    "internal":  {"note": "", "active": false}
  }',
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_sequence_steps_sequence_id on sequence_steps(sequence_id);

-- ── 3. Link sent emails back to template steps ────────────────────────────
alter table email_sequences
  add column if not exists sequence_step_id uuid references sequence_steps(id) on delete set null;

-- ── 4. RLS ────────────────────────────────────────────────────────────────
alter table sequence_templates enable row level security;
alter table sequence_steps      enable row level security;

do $$ begin
  create policy "anon all" on sequence_templates for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on sequence_steps for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ── 5. Helper: build a channels JSONB value ───────────────────────────────
-- Avoids repeating the full default structure in every seed row.
create or replace function make_channels(
  p_subject text,
  p_body    text
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'email',    jsonb_build_object('subject', p_subject, 'body', p_body, 'active', true),
    'sms',      jsonb_build_object('body', '', 'active', false),
    'whatsapp', jsonb_build_object('template_name', '', 'body', '', 'active', false),
    'internal', jsonb_build_object('note', '', 'active', false)
  );
$$;

-- ── 6. Seed — Sequence 1: Welcome Sequence ────────────────────────────────
with seq as (
  insert into sequence_templates (name, trigger_event, description)
  values (
    'Welcome Sequence',
    'new_lead',
    'Sends 3 touch-points after a new lead is created.'
  )
  returning id
)
insert into sequence_steps (sequence_id, step_number, delay_hours, channels)
select seq.id, s.n, s.d, make_channels(s.subj, s.body)
from seq, (values
  (1, 0,
   'We received your inquiry',
   'Hi {name}, thank you for reaching out about your {case_type} matter. We will be in touch shortly to discuss how we can help.'),
  (2, 24,
   'Following up on your {case_type} inquiry',
   'Hi {name}, I wanted to follow up on your inquiry from yesterday. Are you available for a quick call to discuss your situation?'),
  (3, 72,
   'Still here to help with your {case_type} matter',
   'Hi {name}, I wanted to reach out one more time. If you have any questions or would like to schedule a consultation, reply to this email or call us directly.')
) as s(n, d, subj, body);

-- ── 7. Seed — Sequence 2: Persistence Engine ─────────────────────────────
with seq as (
  insert into sequence_templates (name, trigger_event, description)
  values (
    'Persistence Engine',
    'no_engagement',
    '8-step follow-up over 11 days for leads with no engagement after initial sequence.'
  )
  returning id
)
insert into sequence_steps (sequence_id, step_number, delay_hours, channels)
select seq.id, s.n, s.d, make_channels(s.subj, s.body)
from seq, (values
  (1, 2,
   'Following up on your inquiry',
   'Hi {name}, I wanted to follow up on your {case_type} inquiry. We have helped many clients in similar situations. Would you like to schedule a quick call to discuss your options?'),
  (2, 33,
   'The cost of waiting on your {case_type} matter',
   E'Hi {name}, in {case_type} cases, delays can affect outcomes. I wanted to make sure you have the information you need to move forward when you\'re ready. Is there anything specific you\'d like to know?'),
  (3, 53,
   'Checking in',
   'Hi {name}, just checking in to see if you still need assistance with your {case_type} matter. Happy to answer any questions.'),
  (4, 72,
   'Still here if you need us',
   E'Hi {name}, I know decisions like this take time. We\'re still here when you\'re ready to discuss your {case_type} situation.'),
  (5, 120,
   'Do you still need help with your case?',
   'Hi {name}, I wanted to reach out one more time about your {case_type} inquiry. Are you still looking for legal assistance?'),
  (6, 123,
   'Quick question',
   E'Hi {name}, one quick question — is there anything that\'s been holding you back from moving forward? We may be able to help.'),
  (7, 168,
   'Should I close your file?',
   E'Hi {name}, I haven\'t heard back from you regarding your {case_type} matter. I want to respect your time — should I close your file, or would you still like to connect?'),
  (8, 240,
   'Closing your file',
   E'Hi {name}, since I haven\'t heard back, I\'ll be closing your file for now. If you ever need legal assistance in the future, don\'t hesitate to reach out. Wishing you all the best.')
) as s(n, d, subj, body);

-- ── 8. Seed — Sequence 3: Review Request ─────────────────────────────────
with seq as (
  insert into sequence_templates (name, trigger_event, description)
  values (
    'Review Request',
    'client_won',
    'Sends a review request when a lead is marked as client won.'
  )
  returning id
)
insert into sequence_steps (sequence_id, step_number, delay_hours, channels)
select seq.id, s.n, s.d, make_channels(s.subj, s.body)
from seq, (values
  (1, 0,
   'Thank you for choosing us',
   'Hi {name}, it was a pleasure working with you on your {case_type} matter. If you are satisfied with our service, we would greatly appreciate a Google review — it helps other clients find us when they need help most.')
) as s(n, d, subj, body);
