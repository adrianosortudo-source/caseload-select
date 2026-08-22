-- Privacy-safe Screen funnel telemetry foundation.
--
-- This table intentionally contains no inquiry content, contact data,
-- attribution, client identifiers, browser identifiers, or engine state. It is
-- written only by a server route using the service-role client. Do not grant
-- browser roles access when adding reporting in a later workstream.

create table public.screen_funnel_events (
  event_id uuid primary key,
  flow_id uuid not null,
  sequence smallint not null check (sequence between 0 and 64),
  surface text not null check (surface in ('marketing_demo', 'firm_widget')),
  firm_id uuid references public.intake_firms(id) on delete set null,
  event_name text not null check (
    event_name in (
      'flow_started',
      'question_presented',
      'question_answered',
      'review_reached',
      'report_opened',
      'contact_reached',
      'lead_submitted',
      'flow_restarted'
    )
  ),
  stage text not null check (stage in ('opening', 'discovery', 'review', 'contact', 'report', 'done')),
  step_index smallint not null check (step_index between 0 and 8),
  question_count smallint not null check (question_count between 0 and 8),
  answer_mode text check (answer_mode in ('listed_option', 'free_text', 'skip')),
  is_revisit boolean not null default false,
  locale text not null check (locale in ('en', 'pt', 'other')),
  viewport_bucket text not null check (viewport_bucket in ('mobile_small', 'mobile', 'desktop')),
  elapsed_ms integer not null check (elapsed_ms between 0 and 7200000),
  received_at timestamptz not null default now(),

  constraint screen_funnel_20260822132830_flow_sequence_key unique (flow_id, sequence),
  constraint screen_funnel_20260822132830_surface_firm_check check (
    (surface = 'marketing_demo' and firm_id is null)
    or (surface = 'firm_widget' and firm_id is not null)
  ),
  constraint screen_funnel_20260822132830_terminal_surface_check check (
    (event_name <> 'report_opened' or surface = 'marketing_demo')
    and (event_name not in ('contact_reached', 'lead_submitted') or surface = 'firm_widget')
  ),
  constraint screen_funnel_20260822132830_answer_mode_check check (
    (event_name = 'question_answered') = (answer_mode is not null)
  ),
  constraint screen_funnel_20260822132830_revisit_check check (
    not is_revisit or event_name = 'question_presented'
  )
);

create index screen_funnel_events_surface_received_at_idx
  on public.screen_funnel_events (surface, received_at desc);

create index screen_funnel_events_firm_received_at_idx
  on public.screen_funnel_events (firm_id, received_at desc)
  where firm_id is not null;

alter table public.screen_funnel_events enable row level security;
alter table public.screen_funnel_events force row level security;

revoke all on table public.screen_funnel_events from anon, authenticated, public;
grant select, insert on table public.screen_funnel_events to service_role;
