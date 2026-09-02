-- Privacy deletion / irreversible de-identification for screened leads.
--
-- The Meta conversation ledger remains an immutable audit envelope. Its
-- message content and direct Meta identifiers have one permitted state
-- transition: present -> irreversibly redacted. All ordinary UPDATE/DELETE
-- operations remain blocked. The service-only RPC also scrubs the subject's
-- linked intake/session/outbox copies in the same database transaction.
--
-- External providers and Supabase Storage are deliberately represented by a
-- durable cleanup manifest. The first RPC suppresses sends and removes the
-- operational database copies; the completion RPC clears the transitional
-- manifest only after the application has completed or dispositioned those
-- external actions.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

-- -------------------------------------------------------------------------
-- Parent anonymization / suppression state
-- -------------------------------------------------------------------------

alter table public.screened_leads
  add column if not exists privacy_redacted_at timestamptz,
  add column if not exists privacy_redaction_reason text,
  add column if not exists privacy_deletion_request_id uuid;

alter table public.screened_leads
  drop constraint if exists screened_leads_privacy_redaction_state_check;

alter table public.screened_leads
  add constraint screened_leads_privacy_redaction_state_check
  check (
    (privacy_redacted_at is null
      and privacy_redaction_reason is null
      and privacy_deletion_request_id is null)
    or
    (privacy_redacted_at is not null
      and privacy_redaction_reason in (
        'subject_request',
        'retention_sweep',
        'internal_test_record',
        'legacy_anonymization_backfill'
      )
      and privacy_deletion_request_id is not null)
  );

comment on column public.screened_leads.privacy_redacted_at is
  'Terminal privacy state. Non-NULL means direct identifiers and free-text intake content were irreversibly redacted and all future sends/ledger appends for this lead must fail closed.';
comment on column public.screened_leads.privacy_redaction_reason is
  'Fixed reason taxonomy for the terminal privacy-redaction transition.';
comment on column public.screened_leads.privacy_deletion_request_id is
  'The first privacy_deletion_requests.id that caused the terminal redaction. Repeated requests return this original request id.';

-- -------------------------------------------------------------------------
-- Durable request/tombstone and transitional external-cleanup manifest
-- -------------------------------------------------------------------------

create table if not exists public.privacy_deletion_requests (
  id                         uuid primary key,
  firm_id                    uuid not null references public.intake_firms(id) on delete restrict,
  screened_lead_id           uuid not null,
  subject_key_hash           text not null,
  reason                     text not null check (reason in (
    'subject_request',
    'retention_sweep',
    'internal_test_record',
    'legacy_anonymization_backfill'
  )),
  requested_at               timestamptz not null default now(),
  database_redacted_at       timestamptz,
  external_cleanup_status    text not null default 'pending'
    check (external_cleanup_status in ('pending', 'complete')),
  external_cleanup_manifest  jsonb not null default '{}'::jsonb,
  external_cleanup_completed_at timestamptz,
  cleanup_summary            jsonb,
  audit_purged_at            timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint privacy_deletion_requests_lead_firm_fk
    foreign key (screened_lead_id, firm_id)
    references public.screened_leads(id, firm_id)
    on delete restrict,
  constraint privacy_deletion_requests_lead_unique
    unique (screened_lead_id, firm_id),
  constraint privacy_deletion_requests_subject_hash_unique
    unique (firm_id, subject_key_hash),
  constraint privacy_deletion_requests_cleanup_state_check
    check (
      (external_cleanup_status = 'pending'
        and external_cleanup_completed_at is null
        and cleanup_summary is null)
      or
      (external_cleanup_status = 'complete'
        and external_cleanup_completed_at is not null
        and cleanup_summary is not null
        and external_cleanup_manifest = '{}'::jsonb)
    )
);

create index if not exists privacy_deletion_requests_pending_idx
  on public.privacy_deletion_requests (firm_id, requested_at)
  where external_cleanup_status = 'pending';

alter table public.privacy_deletion_requests enable row level security;
alter table public.privacy_deletion_requests force row level security;
revoke all privileges on table public.privacy_deletion_requests
  from public, anon, authenticated, service_role;

comment on table public.privacy_deletion_requests is
  'Service-only privacy deletion tombstones. external_cleanup_manifest is transitional and may contain provider selectors until complete_screened_lead_external_cleanup clears it; completed rows retain only non-identifying status/count evidence.';

-- A permanent private authorization row is safer than a caller-settable GUC
-- for the exceptional post-retention DELETE. It exists only inside the purge
-- RPC transaction, is inaccessible to API roles, and is removed before the
-- RPC returns (or rolled back with the transaction on failure).
create table if not exists private.privacy_expiry_authorizations (
  backend_pid integer not null,
  transaction_id text not null,
  deletion_request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (backend_pid, transaction_id, deletion_request_id)
);

revoke all privileges on table private.privacy_expiry_authorizations
  from public, anon, authenticated, service_role;

-- Salted channel-subject tombstones block a deleted Meta sender from opening
-- a fresh intake while avoiding durable storage of the PSID/IGSID/wa_id.
create table if not exists private.privacy_channel_suppressions (
  deletion_request_id uuid not null
    references public.privacy_deletion_requests(id) on delete restrict,
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  channel text not null check (channel in ('facebook', 'instagram', 'whatsapp')),
  subject_key_hash text not null,
  suppressed_at timestamptz not null,
  primary key (firm_id, channel, subject_key_hash)
);

create index if not exists privacy_channel_suppressions_request_idx
  on private.privacy_channel_suppressions (deletion_request_id);

revoke all privileges on table private.privacy_channel_suppressions
  from public, anon, authenticated, service_role;

create or replace function private.channel_subject_is_privacy_suppressed(
  p_firm_id uuid,
  p_channel text,
  p_sender_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.privacy_channel_suppressions as suppression
     where suppression.firm_id = p_firm_id
       and suppression.channel = p_channel
       and suppression.subject_key_hash = pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(
           p_firm_id::text || ':' || p_channel || ':' || p_sender_id || ':' ||
           suppression.deletion_request_id::text,
           'UTF8'
         )),
         'hex'
       )
  );
$$;

revoke all privileges on function private.channel_subject_is_privacy_suppressed(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.channel_subject_is_privacy_suppressed(uuid, text, text)
  to service_role;

create or replace function public.is_channel_subject_privacy_suppressed(
  p_firm_id uuid,
  p_channel text,
  p_sender_id text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_firm_id is null
     or p_channel is null
     or p_channel not in ('facebook', 'instagram', 'whatsapp')
     or p_sender_id is null
     or pg_catalog.btrim(p_sender_id) = '' then
    return false;
  end if;

  return private.channel_subject_is_privacy_suppressed(
    p_firm_id,
    p_channel,
    p_sender_id
  );
end;
$$;

revoke all privileges on function public.is_channel_subject_privacy_suppressed(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.is_channel_subject_privacy_suppressed(uuid, text, text)
  to service_role;

-- -------------------------------------------------------------------------
-- One-way content redaction state on the immutable conversation envelope
-- -------------------------------------------------------------------------

alter table public.channel_conversation_events
  add column if not exists privacy_redacted_at timestamptz,
  add column if not exists privacy_redaction_reason text,
  add column if not exists privacy_deletion_request_id uuid;

alter table public.channel_conversation_events
  drop constraint if exists channel_conversation_events_privacy_redaction_check;

alter table public.channel_conversation_events
  add constraint channel_conversation_events_privacy_redaction_check
  check (
    (privacy_redacted_at is null
      and privacy_redaction_reason is null
      and privacy_deletion_request_id is null)
    or
    (privacy_redacted_at is not null
      and privacy_redaction_reason in (
        'subject_request',
        'retention_sweep',
        'internal_test_record',
        'legacy_anonymization_backfill'
      )
      and privacy_deletion_request_id is not null
      and body = '[redacted]'
      and meta_message_id is null
      and actor_id is null
      and authoritative_inbound = false
      and (
        (status = 'failed' and failure_reason = '[redacted]')
        or (status <> 'failed' and failure_reason is null)
      ))
  );

create index if not exists channel_conversation_events_privacy_request_idx
  on public.channel_conversation_events (privacy_deletion_request_id, occurred_at)
  where privacy_redacted_at is not null;

comment on column public.channel_conversation_events.privacy_redacted_at is
  'Non-NULL only after the service-only privacy RPC irreversibly removes content/direct identifiers. The event envelope remains immutable.';

-- The transaction-local marker is set only by redact_screened_lead_subject().
-- API roles still lack UPDATE entirely; this trigger additionally rejects
-- owner/direct SQL unless it is the exact one-way transition.
create or replace function private.guard_channel_conversation_privacy_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.privacy_redacted_at is not null
       and old.occurred_at <= pg_catalog.clock_timestamp() - interval '3 years'
       and exists (
         select 1
           from private.privacy_expiry_authorizations as authorization
          where authorization.backend_pid = pg_catalog.pg_backend_pid()
            and authorization.transaction_id = pg_catalog.pg_current_xact_id()::text
            and authorization.deletion_request_id = old.privacy_deletion_request_id
       ) then
      return old;
    end if;

    raise exception 'channel_conversation_events is append-only';
  end if;

  if old.privacy_redacted_at is null
     and new.privacy_redacted_at is not null
     and pg_catalog.current_setting('caseload.privacy_redaction_request_id', true)
           = new.privacy_deletion_request_id::text
     and exists (
       select 1
         from public.privacy_deletion_requests as request
        where request.id = new.privacy_deletion_request_id
          and request.firm_id = new.firm_id
          and request.screened_lead_id = new.screened_lead_id
          and request.reason = new.privacy_redaction_reason
          and request.database_redacted_at is null
     )
     and new.body = '[redacted]'
     and new.meta_message_id is null
     and new.actor_id is null
     and new.authoritative_inbound = false
     and ((new.status = 'failed' and new.failure_reason = '[redacted]')
          or (new.status <> 'failed' and new.failure_reason is null))
     and (
       pg_catalog.to_jsonb(new) - array[
         'body', 'meta_message_id', 'actor_id', 'authoritative_inbound',
         'failure_reason', 'privacy_redacted_at',
         'privacy_redaction_reason', 'privacy_deletion_request_id'
       ]::text[]
       =
       pg_catalog.to_jsonb(old) - array[
         'body', 'meta_message_id', 'actor_id', 'authoritative_inbound',
         'failure_reason', 'privacy_redacted_at',
         'privacy_redaction_reason', 'privacy_deletion_request_id'
       ]::text[]
     ) then
    return new;
  end if;

  raise exception 'channel_conversation_events is append-only';
end;
$$;

revoke all privileges on function private.guard_channel_conversation_privacy_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists channel_conversation_events_reject_update
  on public.channel_conversation_events;
drop trigger if exists channel_conversation_events_reject_delete
  on public.channel_conversation_events;
drop trigger if exists channel_conversation_events_privacy_mutation_guard
  on public.channel_conversation_events;

create trigger channel_conversation_events_privacy_mutation_guard
  before update or delete on public.channel_conversation_events
  for each row execute function private.guard_channel_conversation_privacy_mutation();

-- A late terminal event may race with deletion after Meta accepted/rejected an
-- already-pending send. Preserve the terminal envelope, but coerce every
-- content/identifier column before the existing terminal-pair validator runs.
-- New inbound or pending rows for a redacted parent fail closed.
create or replace function private.guard_channel_conversation_insert_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
  v_reason text;
  v_request_id uuid;
begin
  if new.actor_type = 'lead'
     and new.actor_id is not null
     and private.channel_subject_is_privacy_suppressed(
       new.firm_id,
       new.channel,
       new.actor_id
     ) then
    raise exception 'channel conversation event rejected: channel subject is privacy-suppressed'
      using errcode = '23514';
  end if;

  select lead.privacy_redacted_at,
         lead.privacy_redaction_reason,
         lead.privacy_deletion_request_id
    into v_redacted_at, v_reason, v_request_id
    from public.screened_leads as lead
   where lead.id = new.screened_lead_id
     and lead.firm_id = new.firm_id
   for key share;

  if v_redacted_at is null then
    return new;
  end if;

  if new.direction = 'outbound' and new.status in ('sent', 'failed') then
    new.body := '[redacted]';
    new.meta_message_id := null;
    new.actor_id := null;
    new.authoritative_inbound := false;
    new.failure_reason := case when new.status = 'failed' then '[redacted]' else null end;
    new.privacy_redacted_at := v_redacted_at;
    new.privacy_redaction_reason := v_reason;
    new.privacy_deletion_request_id := v_request_id;
    return new;
  end if;

  raise exception 'channel conversation event rejected: screened lead is privacy-redacted'
    using errcode = '23514';
end;
$$;

revoke all privileges on function private.guard_channel_conversation_insert_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists channel_conversation_events_10_privacy_insert_guard
  on public.channel_conversation_events;
drop trigger if exists channel_conversation_events_validate_terminal
  on public.channel_conversation_events;
drop trigger if exists channel_conversation_events_20_validate_terminal
  on public.channel_conversation_events;

create trigger channel_conversation_events_10_privacy_insert_guard
  before insert on public.channel_conversation_events
  for each row execute function private.guard_channel_conversation_insert_after_redaction();

create trigger channel_conversation_events_20_validate_terminal
  before insert on public.channel_conversation_events
  for each row execute function public.validate_channel_conversation_terminal();

create or replace function private.guard_channel_intake_session_after_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  if new.sender_id not like 'privacy-redacted:%'
     and private.channel_subject_is_privacy_suppressed(
       new.firm_id,
       new.channel,
       new.sender_id
     ) then
    raise exception 'channel intake session rejected: channel subject is privacy-suppressed'
      using errcode = '23514';
  end if;

  if new.screened_lead_id is not null then
    select lead.privacy_redacted_at
      into v_redacted_at
      from public.screened_leads as lead
     where lead.id = new.screened_lead_id
       and lead.firm_id = new.firm_id
     for update;

    if v_redacted_at is not null then
      raise exception 'channel intake session rejected: screened lead is privacy-redacted'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_channel_intake_session_after_suppression()
  from public, anon, authenticated, service_role;

drop trigger if exists channel_intake_sessions_privacy_suppression_guard
  on public.channel_intake_sessions;
create trigger channel_intake_sessions_privacy_suppression_guard
  before insert or update
  on public.channel_intake_sessions
  for each row execute function private.guard_channel_intake_session_after_suppression();

-- Bind transient Meta dedup claims to the channel subject so the database can
-- both reject a post-erasure race and remove a claim that was inserted just
-- before the redaction transaction acquired the subject lock.
alter table public.processed_channel_messages
  add column if not exists sender_id text;

create or replace function private.guard_processed_channel_message_after_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sender_id is null or pg_catalog.btrim(new.sender_id) = '' then
    raise exception using
      errcode = '23502',
      message = 'processed channel message sender_id is required';
  end if;

  if tg_op = 'UPDATE' and (
    new.firm_id is distinct from old.firm_id
    or new.channel is distinct from old.channel
    or new.message_mid is distinct from old.message_mid
    or new.sender_id is distinct from old.sender_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'processed channel message subject binding is immutable';
  end if;

  -- Serialize a transient dedup claim with subject redaction. If the claim
  -- wins, redaction waits and then removes it; if redaction wins, this
  -- statement waits for the tombstone and then rejects the claim.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.firm_id::text || ':' || new.channel || ':' || new.sender_id,
      0
    )
  );

  if private.channel_subject_is_privacy_suppressed(
    new.firm_id, new.channel, new.sender_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'privacy-suppressed channel subject cannot be claimed';
  end if;
  return new;
end;
$$;

revoke all privileges on function private.guard_processed_channel_message_after_suppression()
  from public, anon, authenticated, service_role;

drop trigger if exists processed_channel_messages_privacy_guard
  on public.processed_channel_messages;
create trigger processed_channel_messages_privacy_guard
  before insert or update on public.processed_channel_messages
  for each row execute function private.guard_processed_channel_message_after_suppression();

-- Directly subject-linked operational stores are scrubbed before the parent
-- enters its terminal state. Any later worker insert/update must then fail
-- closed so delayed checkpoints, cadences, imports, conflict workflows, or
-- promotion logging cannot recreate free-text/contact data.
create or replace function private.guard_screened_lead_link_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  if new.screened_lead_id is null then
    return new;
  end if;

  select lead.privacy_redacted_at
    into v_redacted_at
    from public.screened_leads as lead
   where lead.id = new.screened_lead_id
     and lead.firm_id = new.firm_id
     for update;

  if not found then
    raise exception '% must reference a screened lead from the same firm', tg_table_name
      using errcode = '23514';
  end if;

  if v_redacted_at is not null then
    raise exception '% rejected: screened lead is privacy-redacted', tg_table_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_screened_lead_link_after_redaction()
  from public, anon, authenticated, service_role;

create or replace function private.guard_web_intake_session_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  if new.screened_lead_id is not null then
    select lead.privacy_redacted_at
      into v_redacted_at
      from public.screened_leads as lead
     where lead.id = new.screened_lead_id
       and lead.firm_id = new.firm_id
     for update;
    if not found then
      raise exception 'web intake session must reference a screened lead from the same firm'
        using errcode = '23514';
    end if;
    if v_redacted_at is not null then
      raise exception 'web intake session rejected: screened lead is privacy-redacted'
        using errcode = '23514';
    end if;
  elsif new.lead_id is not null and new.lead_id not like 'privacy-redacted:%' then
    perform 1
      from public.screened_leads as lead
     where lead.firm_id = new.firm_id
       and lead.lead_id = new.lead_id
     for update;

    if exists (
      select 1
        from public.privacy_deletion_requests as request
       where request.firm_id = new.firm_id
         and request.subject_key_hash = pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(
             new.firm_id::text || ':' || new.lead_id || ':' || request.id::text,
             'UTF8'
           )),
           'hex'
         )
    ) then
      raise exception 'web intake session rejected: screened lead is privacy-redacted'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all privileges on function private.guard_web_intake_session_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists web_intake_sessions_privacy_guard on public.web_intake_sessions;
create trigger web_intake_sessions_privacy_guard
  before insert or update on public.web_intake_sessions
  for each row execute function private.guard_web_intake_session_after_redaction();

drop trigger if exists voice_turn_sessions_privacy_guard on public.voice_turn_sessions;
create trigger voice_turn_sessions_privacy_guard
  before insert or update on public.voice_turn_sessions
  for each row execute function private.guard_screened_lead_link_after_redaction();

create or replace function private.guard_voice_callback_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  if new.promoted_to_screened_lead is null then
    return new;
  end if;

  select lead.privacy_redacted_at
    into v_redacted_at
    from public.screened_leads as lead
   where lead.id = new.promoted_to_screened_lead
     and lead.firm_id = new.firm_id
   for update;

  if not found then
    raise exception 'voice callback must reference a screened lead from the same firm'
      using errcode = '23514';
  end if;
  if v_redacted_at is not null then
    raise exception 'voice callback rejected: screened lead is privacy-redacted'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all privileges on function private.guard_voice_callback_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists voice_callback_requests_privacy_guard on public.voice_callback_requests;
create trigger voice_callback_requests_privacy_guard
  before insert or update on public.voice_callback_requests
  for each row execute function private.guard_voice_callback_after_redaction();

drop trigger if exists cadence_runs_privacy_guard on public.cadence_runs;
create trigger cadence_runs_privacy_guard
  before insert or update on public.cadence_runs
  for each row execute function private.guard_screened_lead_link_after_redaction();

drop trigger if exists outbound_messages_privacy_guard on public.outbound_messages;
create trigger outbound_messages_privacy_guard
  before insert or update on public.outbound_messages
  for each row execute function private.guard_screened_lead_link_after_redaction();

drop trigger if exists ghl_send_imports_privacy_guard on public.ghl_send_imports;
create trigger ghl_send_imports_privacy_guard
  before insert or update on public.ghl_send_imports
  for each row execute function private.guard_screened_lead_link_after_redaction();

drop trigger if exists screened_conflict_checks_privacy_guard on public.screened_conflict_checks;
create trigger screened_conflict_checks_privacy_guard
  before insert or update on public.screened_conflict_checks
  for each row execute function private.guard_screened_lead_link_after_redaction();

drop trigger if exists matter_promotion_events_privacy_guard on public.matter_promotion_events;
create trigger matter_promotion_events_privacy_guard
  before insert or update on public.matter_promotion_events
  for each row execute function private.guard_screened_lead_link_after_redaction();

create or replace function private.guard_conflict_party_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  select lead.privacy_redacted_at
    into v_redacted_at
    from public.screened_conflict_checks as conflict_check
    join public.screened_leads as lead
      on lead.id = conflict_check.screened_lead_id
     and lead.firm_id = conflict_check.firm_id
   where conflict_check.id = new.conflict_check_id
     and conflict_check.firm_id = new.firm_id
   for key share of lead;

  if not found then
    raise exception 'screened conflict party must reference a conflict check and lead from the same firm'
      using errcode = '23514';
  end if;

  if v_redacted_at is not null then
    raise exception 'screened conflict party rejected: screened lead is privacy-redacted'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_conflict_party_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists screened_conflict_parties_privacy_guard on public.screened_conflict_parties;
create trigger screened_conflict_parties_privacy_guard
  before insert or update on public.screened_conflict_parties
  for each row execute function private.guard_conflict_party_after_redaction();

alter table public.unconfirmed_inquiries
  add column if not exists privacy_redacted_at timestamptz,
  add column if not exists privacy_deletion_request_id uuid;

alter table public.unconfirmed_inquiries
  drop constraint if exists unconfirmed_inquiries_privacy_redaction_check;
alter table public.unconfirmed_inquiries
  add constraint unconfirmed_inquiries_privacy_redaction_check
  check (
    (privacy_redacted_at is null and privacy_deletion_request_id is null)
    or
    (privacy_redacted_at is not null
      and privacy_deletion_request_id is not null
      and sender_id is null
      and sender_meta is null
      and raw_transcript is null)
  );

create or replace function private.guard_unconfirmed_inquiry_after_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.privacy_redacted_at is not null then
    raise exception 'unconfirmed inquiry is privacy-redacted and immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and old.privacy_redacted_at is null
     and new.privacy_redacted_at is not null
     and pg_catalog.current_setting('caseload.privacy_redaction_request_id', true)
           = new.privacy_deletion_request_id::text
     and new.sender_id is null
     and new.sender_meta is null
     and new.raw_transcript is null then
    return new;
  end if;

  if new.privacy_redacted_at is not null then
    raise exception 'unconfirmed inquiry privacy transition requires service deletion RPC'
      using errcode = '23514';
  end if;

  -- If this sender already has a linked screened lead, serialize against the
  -- parent row lock taken by redact_screened_lead_subject(). An insert that
  -- wins the lock is scrubbed later in that transaction; an insert that
  -- waits observes the committed suppression and is rejected below.
  if new.firm_id is not null and new.sender_id is not null then
    perform 1
      from public.channel_intake_sessions as session
      join public.screened_leads as lead
        on lead.id = session.screened_lead_id
       and lead.firm_id = session.firm_id
     where session.firm_id = new.firm_id
       and session.channel = new.channel
       and session.sender_id = new.sender_id
     for key share of lead;
  end if;

  if new.firm_id is not null
     and new.channel in ('facebook', 'instagram', 'whatsapp')
     and new.sender_id is not null
     and private.channel_subject_is_privacy_suppressed(
       new.firm_id,
       new.channel,
       new.sender_id
     ) then
    raise exception 'unconfirmed inquiry rejected: channel subject is privacy-suppressed'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_unconfirmed_inquiry_after_suppression()
  from public, anon, authenticated, service_role;

drop trigger if exists unconfirmed_inquiries_privacy_suppression_guard
  on public.unconfirmed_inquiries;
create trigger unconfirmed_inquiries_privacy_suppression_guard
  before insert or update
  on public.unconfirmed_inquiries
  for each row execute function private.guard_unconfirmed_inquiry_after_suppression();

-- Consent and attribution evidence keep their non-personal legal/operational
-- facts, but their free-form payloads can contain the screened subject's
-- identifiers. Give each ledger the same exact one-way redaction transition.
alter table public.consent_log
  add column if not exists privacy_redacted_at timestamptz,
  add column if not exists privacy_redaction_reason text,
  add column if not exists privacy_deletion_request_id uuid;

alter table public.consent_log
  drop constraint if exists consent_log_privacy_redaction_check;

alter table public.consent_log
  add constraint consent_log_privacy_redaction_check
  check (
    (privacy_redacted_at is null
      and privacy_redaction_reason is null
      and privacy_deletion_request_id is null)
    or
    (privacy_redacted_at is not null
      and privacy_redaction_reason in (
        'subject_request',
        'retention_sweep',
        'internal_test_record',
        'legacy_anonymization_backfill'
      )
      and privacy_deletion_request_id is not null
      and basis_evidence = '{"redacted":true}'::jsonb
      and ip_address is null
      and user_agent is null
      and note is null)
  );

create or replace function private.guard_consent_log_privacy_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.privacy_redacted_at is not null
       and old.captured_at <= pg_catalog.clock_timestamp() - interval '3 years'
       and exists (
         select 1
           from private.privacy_expiry_authorizations as authorization
          where authorization.backend_pid = pg_catalog.pg_backend_pid()
            and authorization.transaction_id = pg_catalog.pg_current_xact_id()::text
            and authorization.deletion_request_id = old.privacy_deletion_request_id
       ) then
      return old;
    end if;

    raise exception 'consent_log is append-only';
  end if;

  if tg_op = 'UPDATE'
     and old.privacy_redacted_at is null
     and new.privacy_redacted_at is not null
     and pg_catalog.current_setting('caseload.privacy_redaction_request_id', true)
           = new.privacy_deletion_request_id::text
     and exists (
       select 1
         from public.privacy_deletion_requests as request
        where request.id = new.privacy_deletion_request_id
          and request.firm_id = new.firm_id
          and request.screened_lead_id = new.subject_id
          and request.reason = new.privacy_redaction_reason
          and request.database_redacted_at is null
     )
     and new.basis_evidence = '{"redacted":true}'::jsonb
     and new.ip_address is null
     and new.user_agent is null
     and new.note is null
     and (
       pg_catalog.to_jsonb(new) - array[
         'basis_evidence', 'ip_address', 'user_agent', 'note',
         'privacy_redacted_at', 'privacy_redaction_reason',
         'privacy_deletion_request_id'
       ]::text[]
       =
       pg_catalog.to_jsonb(old) - array[
         'basis_evidence', 'ip_address', 'user_agent', 'note',
         'privacy_redacted_at', 'privacy_redaction_reason',
         'privacy_deletion_request_id'
       ]::text[]
     ) then
    return new;
  end if;

  raise exception 'consent_log is append-only';
end;
$$;

revoke all privileges on function private.guard_consent_log_privacy_mutation()
  from public, anon, authenticated, service_role;

create or replace function private.guard_consent_log_insert_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  select lead.privacy_redacted_at
    into v_redacted_at
    from public.screened_leads as lead
   where lead.id = new.subject_id
     and lead.firm_id = new.firm_id
   for key share;

  if v_redacted_at is not null then
    raise exception 'consent log insert rejected: screened lead is privacy-redacted'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_consent_log_insert_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists consent_log_privacy_mutation_guard on public.consent_log;
drop trigger if exists consent_log_10_privacy_insert_guard on public.consent_log;
create trigger consent_log_10_privacy_insert_guard
  before insert on public.consent_log
  for each row execute function private.guard_consent_log_insert_after_redaction();
create trigger consent_log_privacy_mutation_guard
  before update or delete on public.consent_log
  for each row execute function private.guard_consent_log_privacy_mutation();

alter table public.content_attribution_evidence
  add column if not exists privacy_redacted_at timestamptz,
  add column if not exists privacy_redaction_reason text,
  add column if not exists privacy_deletion_request_id uuid;

alter table public.content_attribution_evidence
  drop constraint if exists content_attribution_evidence_privacy_redaction_check;

alter table public.content_attribution_evidence
  add constraint content_attribution_evidence_privacy_redaction_check
  check (
    (privacy_redacted_at is null
      and privacy_redaction_reason is null
      and privacy_deletion_request_id is null)
    or
    (privacy_redacted_at is not null
      and privacy_redaction_reason in (
        'subject_request',
        'retention_sweep',
        'internal_test_record',
        'legacy_anonymization_backfill'
      )
      and privacy_deletion_request_id is not null
      and evidence_payload = '{"redacted":true}'::jsonb
      and evidence_note is null)
  );

create or replace function private.guard_content_attribution_privacy_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.privacy_redacted_at is not null
       and old.observed_at <= pg_catalog.clock_timestamp() - interval '3 years'
       and exists (
         select 1
           from private.privacy_expiry_authorizations as authorization
          where authorization.backend_pid = pg_catalog.pg_backend_pid()
            and authorization.transaction_id = pg_catalog.pg_current_xact_id()::text
            and authorization.deletion_request_id = old.privacy_deletion_request_id
       ) then
      return old;
    end if;

    raise exception 'content_attribution_evidence is append-only';
  end if;

  if tg_op = 'UPDATE'
     and old.privacy_redacted_at is null
     and new.privacy_redacted_at is not null
     and pg_catalog.current_setting('caseload.privacy_redaction_request_id', true)
           = new.privacy_deletion_request_id::text
     and exists (
       select 1
         from public.privacy_deletion_requests as request
        where request.id = new.privacy_deletion_request_id
          and request.firm_id = new.firm_id
          and request.screened_lead_id = new.screened_lead_id
          and request.reason = new.privacy_redaction_reason
          and request.database_redacted_at is null
     )
     and new.evidence_payload = '{"redacted":true}'::jsonb
     and new.evidence_note is null
     and (
       pg_catalog.to_jsonb(new) - array[
         'evidence_payload', 'evidence_note', 'privacy_redacted_at',
         'privacy_redaction_reason', 'privacy_deletion_request_id'
       ]::text[]
       =
       pg_catalog.to_jsonb(old) - array[
         'evidence_payload', 'evidence_note', 'privacy_redacted_at',
         'privacy_redaction_reason', 'privacy_deletion_request_id'
       ]::text[]
     ) then
    return new;
  end if;

  raise exception 'content_attribution_evidence is append-only';
end;
$$;

revoke all privileges on function private.guard_content_attribution_privacy_mutation()
  from public, anon, authenticated, service_role;

create or replace function private.guard_content_attribution_insert_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted_at timestamptz;
begin
  select lead.privacy_redacted_at
    into v_redacted_at
    from public.screened_leads as lead
   where lead.id = new.screened_lead_id
     and lead.firm_id = new.firm_id
   for key share;

  if v_redacted_at is not null then
    raise exception 'content attribution insert rejected: screened lead is privacy-redacted'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_content_attribution_insert_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_block_content_attribution_evidence_mutation
  on public.content_attribution_evidence;
drop trigger if exists content_attribution_evidence_10_privacy_insert_guard
  on public.content_attribution_evidence;
drop trigger if exists content_attribution_evidence_privacy_mutation_guard
  on public.content_attribution_evidence;
create trigger content_attribution_evidence_10_privacy_insert_guard
  before insert on public.content_attribution_evidence
  for each row execute function private.guard_content_attribution_insert_after_redaction();
create trigger content_attribution_evidence_privacy_mutation_guard
  before update or delete on public.content_attribution_evidence
  for each row execute function private.guard_content_attribution_privacy_mutation();

-- Parent rows are terminal after privacy redaction. This prevents a delayed
-- status/notification update from reintroducing content through JSON fields.
create or replace function private.guard_screened_lead_after_privacy_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'screened lead deletion requires the privacy redaction workflow'
      using errcode = '23514';
  end if;

  if old.privacy_redacted_at is not null then
    raise exception 'screened lead is privacy-redacted and immutable'
      using errcode = '23514';
  end if;

  if new.privacy_redacted_at is not null
     and pg_catalog.current_setting('caseload.privacy_redaction_request_id', true)
           is distinct from new.privacy_deletion_request_id::text then
    raise exception 'screened lead privacy transition requires service deletion RPC'
      using errcode = '23514';
  end if;

  if new.privacy_redacted_at is not null
     and not exists (
       select 1
         from public.privacy_deletion_requests as request
        where request.id = new.privacy_deletion_request_id
          and request.firm_id = new.firm_id
          and request.screened_lead_id = new.id
          and request.reason = new.privacy_redaction_reason
          and request.database_redacted_at is null
     ) then
    raise exception 'screened lead privacy transition has no matching deletion request'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.guard_screened_lead_after_privacy_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists screened_leads_privacy_redaction_guard on public.screened_leads;
create trigger screened_leads_privacy_redaction_guard
  before update or delete on public.screened_leads
  for each row execute function private.guard_screened_lead_after_privacy_redaction();

-- GHL outbox rows do not have a foreign key to screened_leads. Compare the
-- candidate lead id to a per-request salted tombstone hash so a delayed insert
-- cannot recreate a payload after the parent identifier itself was replaced.
create or replace function private.guard_webhook_outbox_after_privacy_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.lead_id like 'privacy-redacted:%' then
    raise exception 'webhook outbox row is privacy-redacted and immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and new.lead_id like 'privacy-redacted:%'
     and exists (
       select 1
         from public.privacy_deletion_requests as request
        where request.id::text = pg_catalog.current_setting(
          'caseload.privacy_redaction_request_id', true
        )
          and request.firm_id = old.firm_id
          and request.subject_key_hash = pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(
              old.firm_id::text || ':' || old.lead_id || ':' || request.id::text,
              'UTF8'
            )),
            'hex'
          )
     )
     and new.idempotency_key = 'privacy-redacted:' || new.id::text
     and new.payload = '{"privacy_redacted":true}'::jsonb
     and new.webhook_url = '[redacted]'
     and new.status <> 'pending'
     and (new.last_error is null or new.last_error = '[redacted]') then
    return new;
  end if;

  -- Serialise against redact_screened_lead_subject(). If this insert starts
  -- first, the redaction RPC subsequently scrubs it. If redaction starts
  -- first, this row-lock statement waits; the following statement gets a
  -- fresh READ COMMITTED snapshot and sees the committed tombstone.
  perform 1
    from public.screened_leads as lead
   where lead.firm_id = new.firm_id
     and lead.lead_id = new.lead_id
   for key share;

  if exists (
    select 1
      from public.privacy_deletion_requests as request
     where request.firm_id = new.firm_id
       and request.subject_key_hash = pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(
           new.firm_id::text || ':' || new.lead_id || ':' || request.id::text,
           'UTF8'
         )),
         'hex'
       )
  ) then
    raise exception 'webhook outbox insert rejected: screened lead is privacy-redacted'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all privileges on function private.guard_webhook_outbox_after_privacy_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists webhook_outbox_privacy_insert_guard on public.webhook_outbox;
create trigger webhook_outbox_privacy_insert_guard
  before insert or update on public.webhook_outbox
  for each row execute function private.guard_webhook_outbox_after_privacy_redaction();

-- Legacy web sessions are linked to their screened row by the deterministic
-- public lead id L-S1-<session UUID>, not by a foreign key. Once that subject
-- has a tombstone, only an idempotent all-sentinel update remains legal.
create or replace function private.guard_legacy_intake_session_after_redaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_lead_id text := 'L-S1-' || new.id::text;
begin
  if exists (
    select 1
      from public.privacy_deletion_requests as request
     where request.firm_id = new.firm_id
       and request.subject_key_hash = pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(
           new.firm_id::text || ':' || v_public_lead_id || ':' || request.id::text,
           'UTF8'
         )),
         'hex'
       )
  ) then
    if new.conversation = '[]'::jsonb
       and new.contact = '{}'::jsonb
       and new.extracted_entities = '{}'::jsonb
       and new.situation_summary is null
       and new.round3_answers is null
       and new.memo_text is null
       and new.otp_code is null
       and new.otp_expires_at is null
       and new.otp_verified = false then
      return new;
    end if;
    raise exception 'legacy intake session rejected: screened lead is privacy-redacted'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all privileges on function private.guard_legacy_intake_session_after_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists intake_sessions_privacy_guard on public.intake_sessions;
create trigger intake_sessions_privacy_guard
  before update on public.intake_sessions
  for each row execute function private.guard_legacy_intake_session_after_redaction();

-- -------------------------------------------------------------------------
-- Atomic database redaction RPC
-- -------------------------------------------------------------------------

create or replace function private.redact_screened_lead_subject_impl(
  p_firm_id uuid,
  p_lead_id text,
  p_reason text,
  p_deletion_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.screened_leads%rowtype;
  v_request public.privacy_deletion_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_manifest jsonb;
  v_meta_subjects jsonb;
  v_legacy_session_id uuid;
  v_redacted_count integer := 0;
  v_subject record;
begin
  if p_firm_id is null or p_lead_id is null or pg_catalog.btrim(p_lead_id) = ''
     or p_deletion_request_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'firm_id, lead_id and deletion_request_id are required'
    );
  end if;

  if p_reason is null or p_reason not in (
    'subject_request',
    'retention_sweep',
    'internal_test_record',
    'legacy_anonymization_backfill'
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid reason');
  end if;

  -- Concurrent initial requests for the same public lead id must converge on
  -- one tombstone. Taking this fixed, transaction-scoped lock before any
  -- request/lead lookup gives the waiter a fresh READ COMMITTED statement
  -- snapshot after the first transaction commits its redaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_firm_id::text || ':' || p_lead_id, 0)
  );

  -- A request UUID is globally idempotent and cannot be replayed against a
  -- different tenant or subject.
  select request.*
    into v_request
    from public.privacy_deletion_requests as request
   where request.id = p_deletion_request_id;

  if found and (
    v_request.firm_id <> p_firm_id
    or (
      v_request.subject_key_hash <> pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          p_firm_id::text || ':' || p_lead_id || ':' || p_deletion_request_id::text,
          'UTF8'
        )),
        'hex'
      )
      and not exists (
        select 1
          from public.screened_leads as existing_lead
         where existing_lead.id = v_request.screened_lead_id
           and existing_lead.firm_id = p_firm_id
           and existing_lead.lead_id = p_lead_id
      )
    )
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'deletion_request_id was already used for another subject'
    );
  end if;

  -- The second predicate finds an already-redacted lead when the caller
  -- retries with the original lead id but a newly generated request UUID.
  select lead.*
    into v_lead
    from public.screened_leads as lead
   where lead.firm_id = p_firm_id
     and (
       lead.lead_id = p_lead_id
       or exists (
         select 1
           from public.privacy_deletion_requests as prior
          where prior.firm_id = p_firm_id
            and prior.screened_lead_id = lead.id
            and prior.subject_key_hash = pg_catalog.encode(
              pg_catalog.sha256(pg_catalog.convert_to(
                p_firm_id::text || ':' || p_lead_id || ':' || prior.id::text,
                'UTF8'
              )),
              'hex'
            )
       )
     )
   for update;

  if not found then
    -- Enumeration-safe no-op: callers cannot use this function to establish
    -- whether a lead exists in another firm.
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'redacted_count', 0,
      'deletion_request_id', p_deletion_request_id,
      'external_cleanup_status', 'not_applicable',
      'external_cleanup_manifest', '{}'::jsonb
    );
  end if;

  if v_lead.privacy_redacted_at is not null then
    select request.*
      into strict v_request
      from public.privacy_deletion_requests as request
     where request.id = v_lead.privacy_deletion_request_id
       and request.firm_id = p_firm_id
       and request.screened_lead_id = v_lead.id;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'redacted_count', 0,
      'screened_lead_id', v_lead.id,
      'lead_id', p_lead_id,
      'deletion_request_id', v_request.id,
      'privacy_redacted_at', v_lead.privacy_redacted_at,
      'external_cleanup_status', v_request.external_cleanup_status,
      'external_cleanup_manifest', v_request.external_cleanup_manifest
    );
  end if;

  if v_lead.lead_id ~* '^L-S1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_legacy_session_id := pg_catalog.substring(v_lead.lead_id from 6)::uuid;
    perform 1
      from public.intake_sessions as legacy_session
     where legacy_session.id = v_legacy_session_id
       and legacy_session.firm_id = p_firm_id
     for update;
    if not found then
      v_legacy_session_id := null;
    end if;
  end if;

  select pg_catalog.coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'channel', subjects.channel,
               'sender_id', subjects.sender_id
             )
             order by subjects.channel, subjects.sender_id
           ),
           '[]'::jsonb
         )
    into v_meta_subjects
    from (
      select session.channel, session.sender_id
        from public.channel_intake_sessions as session
       where session.firm_id = p_firm_id
         and session.screened_lead_id = v_lead.id
      union
      select event.channel, event.actor_id as sender_id
        from public.channel_conversation_events as event
       where event.firm_id = p_firm_id
         and event.screened_lead_id = v_lead.id
         and event.actor_type = 'lead'
         and event.actor_id is not null
    ) as subjects;

  -- Use the same per-subject lock as processed_channel_messages. Lock in a
  -- deterministic order to avoid deadlocks when a lead has more than one
  -- channel identity.
  for v_subject in
    select subjects.channel, subjects.sender_id
      from (
        select session.channel, session.sender_id
          from public.channel_intake_sessions as session
         where session.firm_id = p_firm_id
           and session.screened_lead_id = v_lead.id
        union
        select event.channel, event.actor_id as sender_id
          from public.channel_conversation_events as event
         where event.firm_id = p_firm_id
           and event.screened_lead_id = v_lead.id
           and event.actor_type = 'lead'
           and event.actor_id is not null
      ) as subjects
     where subjects.sender_id is not null
     order by subjects.channel, subjects.sender_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_firm_id::text || ':' || v_subject.channel || ':' || v_subject.sender_id,
        0
      )
    );
  end loop;

  v_manifest := pg_catalog.jsonb_build_object(
    'version', 1,
    'storage_objects', case
      when v_legacy_session_id is null then '[]'::jsonb
      else pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'bucket', 'intake-attachments',
        'prefix', p_firm_id::text || '/' || v_legacy_session_id::text
      ))
    end,
    'external_systems', pg_catalog.jsonb_build_object(
      'ghl', pg_catalog.jsonb_build_object(
        'status', 'manual_required',
        'selectors', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'lead_id', v_lead.lead_id,
          'email', v_lead.contact_email,
          'phone', v_lead.contact_phone
        ))
      ),
      'meta', pg_catalog.jsonb_build_object(
        'status', 'provider_managed',
        'sender_ids', v_meta_subjects,
        'action', 'No provider-side message deletion is performed by this database RPC.'
      ),
      'resend', pg_catalog.jsonb_build_object(
        'status', 'provider_managed',
        'action', 'Verify provider retention/DPA; no provider message id is linked in this schema.'
      )
    )
  );

  insert into public.privacy_deletion_requests (
    id,
    firm_id,
    screened_lead_id,
    subject_key_hash,
    reason,
    requested_at,
    external_cleanup_manifest
  ) values (
    p_deletion_request_id,
    p_firm_id,
    v_lead.id,
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        p_firm_id::text || ':' || v_lead.lead_id || ':' || p_deletion_request_id::text,
        'UTF8'
      )),
      'hex'
    ),
    p_reason,
    v_now,
    v_manifest
  )
  returning * into v_request;

  insert into private.privacy_channel_suppressions (
    deletion_request_id,
    firm_id,
    channel,
    subject_key_hash,
    suppressed_at
  )
  select p_deletion_request_id,
         p_firm_id,
         subjects.channel,
         pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(
             p_firm_id::text || ':' || subjects.channel || ':' || subjects.sender_id || ':' ||
             p_deletion_request_id::text,
             'UTF8'
           )),
           'hex'
         ),
         v_now
    from (
      select session.channel, session.sender_id
        from public.channel_intake_sessions as session
       where session.firm_id = p_firm_id
         and session.screened_lead_id = v_lead.id
      union
      select event.channel, event.actor_id as sender_id
        from public.channel_conversation_events as event
       where event.firm_id = p_firm_id
         and event.screened_lead_id = v_lead.id
         and event.actor_type = 'lead'
         and event.actor_id is not null
    ) as subjects
   where subjects.sender_id is not null
  on conflict do nothing;

  perform pg_catalog.set_config(
    'caseload.privacy_redaction_request_id',
    p_deletion_request_id::text,
    true
  );

  -- Delete transient Meta dedup claims whose message ids are now being
  -- removed from the durable event envelope.
  delete from public.processed_channel_messages as processed
   where processed.firm_id = p_firm_id
     and (
       exists (
         select 1
           from public.channel_conversation_events as event
          where event.firm_id = p_firm_id
            and event.screened_lead_id = v_lead.id
            and event.channel = processed.channel
            and event.meta_message_id = processed.message_mid
       )
       or exists (
         select 1
           from pg_catalog.jsonb_array_elements(v_meta_subjects) as subject(value)
          where processed.channel = subject.value ->> 'channel'
            and processed.sender_id = subject.value ->> 'sender_id'
       )
     );

  -- Unconfirmed rows have no lead FK. A matching firm/channel/sender from the
  -- linked session is the narrowest safe subject join available.
  update public.unconfirmed_inquiries as inquiry
     set sender_id = null,
         sender_meta = null,
         raw_transcript = null,
         privacy_redacted_at = v_now,
         privacy_deletion_request_id = p_deletion_request_id
   where inquiry.firm_id = p_firm_id
     and exists (
       select 1
         from public.channel_intake_sessions as session
        where session.firm_id = p_firm_id
          and session.screened_lead_id = v_lead.id
          and session.channel = inquiry.channel
          and session.sender_id = inquiry.sender_id
     );

  update public.channel_conversation_events as event
     set body = '[redacted]',
         meta_message_id = null,
         actor_id = null,
         authoritative_inbound = false,
         failure_reason = case when event.status = 'failed' then '[redacted]' else null end,
         privacy_redacted_at = v_now,
         privacy_redaction_reason = p_reason,
         privacy_deletion_request_id = p_deletion_request_id
   where event.firm_id = p_firm_id
     and event.screened_lead_id = v_lead.id
     and event.privacy_redacted_at is null;

  update public.channel_intake_sessions as session
     set sender_id = 'privacy-redacted:' || session.id::text,
         engine_state = '{"anonymized":true}'::jsonb,
         finalized = true,
         expires_at = v_now
   where session.firm_id = p_firm_id
      and session.screened_lead_id = v_lead.id;

  update public.intake_sessions as legacy_session
     set conversation = '[]'::jsonb,
         contact = '{}'::jsonb,
         extracted_entities = '{}'::jsonb,
         situation_summary = null,
         round3_answers = null,
         memo_text = null,
         otp_code = null,
         otp_expires_at = null,
         otp_verified = false,
         updated_at = v_now
   where legacy_session.id = v_legacy_session_id
     and legacy_session.firm_id = p_firm_id;

  update public.web_intake_sessions as session
     set lead_id = 'privacy-redacted:' || session.id::text,
         engine_state = '{"anonymized":true}'::jsonb,
         utm_source = null,
         utm_medium = null,
         utm_campaign = null,
         utm_term = null,
         utm_content = null,
         referrer = null,
         gclid = null,
         finalized = true,
         expires_at = v_now,
         updated_at = v_now
   where session.firm_id = p_firm_id
     and session.screened_lead_id = v_lead.id;

  update public.voice_turn_sessions as session
     set call_id = 'privacy-redacted:' || session.id::text,
         engine_state = '{"anonymized":true}'::jsonb,
         finalized = true,
         expires_at = v_now,
         updated_at = v_now
   where session.firm_id = p_firm_id
     and session.screened_lead_id = v_lead.id;

  update public.voice_callback_requests as callback
     set call_id = null,
         caller_name = '[anonymized]',
         caller_phone = null,
         organization = null,
         message = '[redacted]',
         raw_transcript = '[redacted]',
         voice_meta = '{"anonymized":true}'::jsonb
   where callback.firm_id = p_firm_id
     and callback.promoted_to_screened_lead = v_lead.id;

  update public.webhook_outbox as outbox
     set lead_id = 'privacy-redacted:' || outbox.id::text,
         idempotency_key = 'privacy-redacted:' || outbox.id::text,
         payload = '{"privacy_redacted":true}'::jsonb,
         webhook_url = '[redacted]',
         status = case when outbox.status = 'pending' then 'failed' else outbox.status end,
         attempts = case when outbox.status = 'pending' then outbox.max_attempts else outbox.attempts end,
         last_error = case when outbox.status = 'failed' or outbox.status = 'pending' then '[redacted]' else null end,
         next_attempt_at = v_now,
         failed_at = case when outbox.status = 'pending' then v_now else outbox.failed_at end,
         updated_at = v_now
   where outbox.firm_id = p_firm_id
     and outbox.lead_id = v_lead.lead_id;

  update public.screened_conflict_parties as party
     set party_name = '[redacted]',
         party_name_raw = '[redacted]',
         notes = null,
         is_active = false
   where party.firm_id = p_firm_id
     and exists (
       select 1
         from public.screened_conflict_checks as conflict_check
        where conflict_check.id = party.conflict_check_id
          and conflict_check.firm_id = p_firm_id
          and conflict_check.screened_lead_id = v_lead.id
     );

  update public.screened_conflict_checks as conflict_check
     set notes = null,
         updated_at = v_now
   where conflict_check.firm_id = p_firm_id
     and conflict_check.screened_lead_id = v_lead.id;

  update public.consent_log as consent
     set basis_evidence = '{"redacted":true}'::jsonb,
         ip_address = null,
         user_agent = null,
         note = null,
         privacy_redacted_at = v_now,
         privacy_redaction_reason = p_reason,
         privacy_deletion_request_id = p_deletion_request_id
   where consent.firm_id = p_firm_id
     and consent.subject_id = v_lead.id
     and consent.privacy_redacted_at is null;

  update public.content_attribution_evidence as evidence
     set evidence_payload = '{"redacted":true}'::jsonb,
         evidence_note = null,
         privacy_redacted_at = v_now,
         privacy_redaction_reason = p_reason,
         privacy_deletion_request_id = p_deletion_request_id
   where evidence.firm_id = p_firm_id
     and evidence.screened_lead_id = v_lead.id
     and evidence.privacy_redacted_at is null;

  update public.cadence_runs as run
     set status = case when run.status = 'active' then 'exited' else run.status end,
         exit_reason = 'privacy_redacted',
         updated_at = v_now
   where run.firm_id = p_firm_id
     and run.screened_lead_id = v_lead.id;

  update public.outbound_messages as message
     set recipient_email = null,
         subject = null,
         body = null,
         consent_verdict = 'blocked',
         consent_block_reason = 'privacy_redacted',
         status = case
           when message.status in ('scheduled', 'shadow_logged') then 'suppressed'
           else message.status
         end
   where message.firm_id = p_firm_id
     and message.screened_lead_id = v_lead.id;

  update public.ghl_send_imports as imported
     set recipient_email = null,
         subject = null,
         source_row = '{"privacy_redacted":true}'::jsonb
   where imported.firm_id = p_firm_id
     and imported.screened_lead_id = v_lead.id;

  update public.matter_promotion_events as promotion
     set error_text = null
   where promotion.firm_id = p_firm_id
     and promotion.screened_lead_id = v_lead.id;

  -- Mandatory JSON/text fields receive inert sentinels; generated
  -- contact_postal_code follows slot_answers automatically.
  update public.screened_leads as lead
     set lead_id = 'privacy-redacted:' || lead.id::text,
         contact_name = '[anonymized]',
         contact_email = null,
         contact_phone = null,
         brief_html = '<p>[anonymized]</p>',
         brief_json = '{"anonymized":true}'::jsonb,
         slot_answers = '{"anonymized":true}'::jsonb,
         raw_transcript = null,
         status_note = null,
         notification_error = null,
         utm_source = null,
         utm_medium = null,
         utm_campaign = null,
         utm_term = null,
         utm_content = null,
         referrer = null,
         gclid = null,
         score_explanation = null,
         score_missing_fields = null,
         field_provenance = null,
         axis_reasoning = null,
         consent_ip = null,
         consent_user_agent = null,
         email_consent_status = 'revoked',
         sms_consent_status = 'revoked',
         archived = true,
         archived_at = v_now,
         archived_by_role = 'system',
         privacy_redacted_at = v_now,
         privacy_redaction_reason = p_reason,
         privacy_deletion_request_id = p_deletion_request_id,
         updated_at = v_now
   where lead.id = v_lead.id
     and lead.firm_id = p_firm_id
     and lead.privacy_redacted_at is null;

  get diagnostics v_redacted_count = row_count;

  update public.privacy_deletion_requests as request
     set database_redacted_at = v_now,
         updated_at = v_now
   where request.id = p_deletion_request_id;

  -- Do not leave the one-way-transition capability active for subsequent
  -- statements if the caller wrapped the RPC in a larger transaction.
  perform pg_catalog.set_config(
    'caseload.privacy_redaction_request_id',
    '',
    true
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'redacted_count', v_redacted_count,
    'screened_lead_id', v_lead.id,
    'lead_id', p_lead_id,
    'deletion_request_id', p_deletion_request_id,
    'privacy_redacted_at', v_now,
    'external_cleanup_status', 'pending',
    'external_cleanup_manifest', v_manifest
  );
end;
$$;

revoke all privileges on function private.redact_screened_lead_subject_impl(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.redact_screened_lead_subject_impl(uuid, text, text, uuid)
  to service_role;

comment on function private.redact_screened_lead_subject_impl(uuid, text, text, uuid) is
  'Service-only, tenant-scoped, idempotent screened-lead privacy redaction. Keeps non-identifying audit envelopes, suppresses pending sends, scrubs core linked Postgres copies atomically, and returns a durable external-cleanup manifest. A retry with a new request UUID returns the original request for the already-redacted lead.';

create or replace function public.redact_screened_lead_subject(
  p_firm_id uuid,
  p_lead_id text,
  p_reason text,
  p_deletion_request_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.redact_screened_lead_subject_impl(
    p_firm_id, p_lead_id, p_reason, p_deletion_request_id
  );
$$;

revoke all privileges on function public.redact_screened_lead_subject(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.redact_screened_lead_subject(uuid, text, text, uuid)
  to service_role;

-- Completion accepts a deliberately closed, non-PII summary shape. Provider
-- selectors and storage paths are then removed from the database.
create or replace function private.complete_screened_lead_external_cleanup_impl(
  p_firm_id uuid,
  p_deletion_request_id uuid,
  p_cleanup_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.privacy_deletion_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_allowed_keys text[] := array[
    'storage_deleted_count', 'ghl_status', 'meta_status', 'resend_status'
  ];
begin
  if p_firm_id is null or p_deletion_request_id is null
     or p_cleanup_summary is null
     or pg_catalog.jsonb_typeof(p_cleanup_summary) <> 'object'
     or exists (
       select 1
         from pg_catalog.jsonb_object_keys(p_cleanup_summary) as supplied(key)
        where not (supplied.key = any(v_allowed_keys))
     )
     or not (p_cleanup_summary ? 'storage_deleted_count')
     or not (p_cleanup_summary ? 'ghl_status')
     or not (p_cleanup_summary ? 'meta_status')
     or not (p_cleanup_summary ? 'resend_status')
     or pg_catalog.jsonb_typeof(p_cleanup_summary->'storage_deleted_count') <> 'number'
     or (p_cleanup_summary->>'storage_deleted_count') !~ '^[0-9]+$'
     or p_cleanup_summary->>'ghl_status' not in ('completed', 'not_applicable', 'provider_managed')
     or p_cleanup_summary->>'meta_status' not in ('completed', 'not_applicable', 'provider_managed')
     or p_cleanup_summary->>'resend_status' not in ('completed', 'not_applicable', 'provider_managed') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'cleanup_summary must contain only the required non-PII count/status fields'
    );
  end if;

  select request.*
    into v_request
    from public.privacy_deletion_requests as request
   where request.id = p_deletion_request_id
     and request.firm_id = p_firm_id
   for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'deletion request not found');
  end if;

  if v_request.external_cleanup_status = 'complete' then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'deletion_request_id', v_request.id,
      'external_cleanup_status', 'complete',
      'external_cleanup_completed_at', v_request.external_cleanup_completed_at,
      'cleanup_summary', v_request.cleanup_summary
    );
  end if;

  if (
       v_request.external_cleanup_manifest #>> '{external_systems,ghl,status}' = 'manual_required'
       and p_cleanup_summary->>'ghl_status' not in ('completed', 'not_applicable')
     )
     or (
       v_request.external_cleanup_manifest #>> '{external_systems,meta,status}' = 'provider_managed'
       and p_cleanup_summary->>'meta_status' <> 'provider_managed'
     )
     or (
       v_request.external_cleanup_manifest #>> '{external_systems,resend,status}' = 'provider_managed'
       and p_cleanup_summary->>'resend_status' <> 'provider_managed'
     ) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'cleanup_summary status does not satisfy the durable cleanup manifest'
    );
  end if;

  update public.privacy_deletion_requests as request
     set external_cleanup_status = 'complete',
         external_cleanup_manifest = '{}'::jsonb,
         external_cleanup_completed_at = v_now,
         cleanup_summary = p_cleanup_summary,
         updated_at = v_now
   where request.id = p_deletion_request_id
     and request.firm_id = p_firm_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'deletion_request_id', p_deletion_request_id,
    'external_cleanup_status', 'complete',
    'external_cleanup_completed_at', v_now,
    'cleanup_summary', p_cleanup_summary
  );
end;
$$;

revoke all privileges on function private.complete_screened_lead_external_cleanup_impl(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_screened_lead_external_cleanup_impl(uuid, uuid, jsonb)
  to service_role;

comment on function private.complete_screened_lead_external_cleanup_impl(uuid, uuid, jsonb) is
  'Service-only idempotent acknowledgement that external cleanup was completed or dispositioned. Clears the transitional PII/provider-selector manifest and retains only a closed non-PII count/status summary.';

create or replace function public.complete_screened_lead_external_cleanup(
  p_firm_id uuid,
  p_deletion_request_id uuid,
  p_cleanup_summary jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.complete_screened_lead_external_cleanup_impl(
    p_firm_id, p_deletion_request_id, p_cleanup_summary
  );
$$;

revoke all privileges on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb)
  to service_role;

-- A database redaction may commit immediately before a Storage/provider call
-- fails or the worker exits. Since callers have no direct tombstone-table
-- access, expose a bounded service-only recovery list for those durable
-- pending manifests.
create or replace function private.list_pending_screened_lead_privacy_cleanups_impl(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requests jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'p_limit must be between 1 and 1000'
    );
  end if;

  select pg_catalog.coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'deletion_request_id', pending.id,
               'firm_id', pending.firm_id,
               'screened_lead_id', pending.screened_lead_id,
               'current_lead_id', pending.current_lead_id
             ) order by pending.requested_at, pending.id
           ),
           '[]'::jsonb
         )
    into v_requests
    from (
      select request.id,
             request.firm_id,
             request.screened_lead_id,
             request.requested_at,
             lead.lead_id as current_lead_id
        from public.privacy_deletion_requests as request
        join public.screened_leads as lead
          on lead.id = request.screened_lead_id
         and lead.firm_id = request.firm_id
       where request.external_cleanup_status = 'pending'
         and request.database_redacted_at is not null
       order by request.requested_at, request.id
       limit p_limit
    ) as pending;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'pending_count', pg_catalog.jsonb_array_length(v_requests),
    'requests', v_requests
  );
end;
$$;

revoke all privileges on function private.list_pending_screened_lead_privacy_cleanups_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.list_pending_screened_lead_privacy_cleanups_impl(integer)
  to service_role;

comment on function private.list_pending_screened_lead_privacy_cleanups_impl(integer) is
  'Service-only bounded recovery list containing only coordinator identifiers for database-redacted screened leads whose external cleanup is still pending. The coordinator re-calls redact_screened_lead_subject to retrieve the unchanged manifest.';

create or replace function public.list_pending_screened_lead_privacy_cleanups(
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.list_pending_screened_lead_privacy_cleanups_impl(p_limit);
$$;

revoke all privileges on function public.list_pending_screened_lead_privacy_cleanups(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pending_screened_lead_privacy_cleanups(integer)
  to service_role;

-- -------------------------------------------------------------------------
-- Fixed-purpose retention expiry
-- -------------------------------------------------------------------------

create or replace function private.purge_expired_privacy_audit_envelopes_impl(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_ids uuid[];
  v_request_count integer := 0;
  v_channel_event_count integer := 0;
  v_consent_event_count integer := 0;
  v_attribution_event_count integer := 0;
  v_remaining_eligible_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'p_limit must be between 1 and 1000'
    );
  end if;

  -- p_limit bounds subjects/requests, never individual event rows. Event age
  -- is the clock because the public retention promise runs from the inquiry,
  -- not from a later deletion request. Newer events for the same request stay
  -- until their own three-year boundary.
  select pg_catalog.array_agg(eligible.id order by eligible.database_redacted_at, eligible.id)
    into v_request_ids
    from (
      select request.id, request.database_redacted_at
        from public.privacy_deletion_requests as request
       where request.database_redacted_at is not null
          and (
            exists (
              select 1
                from public.channel_conversation_events as event
               where event.privacy_deletion_request_id = request.id
                 and event.privacy_redacted_at is not null
                 and event.occurred_at <= pg_catalog.clock_timestamp() - interval '3 years'
            )
            or exists (
              select 1
                from public.consent_log as consent
               where consent.privacy_deletion_request_id = request.id
                 and consent.privacy_redacted_at is not null
                 and consent.captured_at <= pg_catalog.clock_timestamp() - interval '3 years'
            )
            or exists (
              select 1
                from public.content_attribution_evidence as evidence
               where evidence.privacy_deletion_request_id = request.id
                 and evidence.privacy_redacted_at is not null
                 and evidence.observed_at <= pg_catalog.clock_timestamp() - interval '3 years'
            )
          )
       order by request.database_redacted_at, request.id
       for update skip locked
       limit p_limit
    ) as eligible;

  v_request_count := pg_catalog.coalesce(pg_catalog.array_length(v_request_ids, 1), 0);

  if v_request_count = 0 then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'retention_period', '3 years',
      'eligible_request_count', 0,
      'purged_event_count', 0,
      'purged_channel_event_count', 0,
      'purged_consent_event_count', 0,
      'purged_attribution_event_count', 0,
      'remaining_eligible_count', 0,
      'has_more', false
    );
  end if;

  insert into private.privacy_expiry_authorizations (
    backend_pid,
    transaction_id,
    deletion_request_id
  )
  select pg_catalog.pg_backend_pid(),
         pg_catalog.pg_current_xact_id()::text,
         request_id
    from pg_catalog.unnest(v_request_ids) as selected(request_id);

  delete from public.channel_conversation_events as event
   where event.privacy_deletion_request_id = any(v_request_ids)
     and event.privacy_redacted_at is not null
     and event.occurred_at <= pg_catalog.clock_timestamp() - interval '3 years';

  get diagnostics v_channel_event_count = row_count;

  delete from public.consent_log as consent
   where consent.privacy_deletion_request_id = any(v_request_ids)
     and consent.privacy_redacted_at is not null
     and consent.captured_at <= pg_catalog.clock_timestamp() - interval '3 years';

  get diagnostics v_consent_event_count = row_count;

  delete from public.content_attribution_evidence as evidence
   where evidence.privacy_deletion_request_id = any(v_request_ids)
     and evidence.privacy_redacted_at is not null
     and evidence.observed_at <= pg_catalog.clock_timestamp() - interval '3 years';

  get diagnostics v_attribution_event_count = row_count;

  update public.privacy_deletion_requests as request
     set audit_purged_at = pg_catalog.clock_timestamp(),
         updated_at = pg_catalog.clock_timestamp()
   where request.id = any(v_request_ids)
      and not exists (
        select 1
          from public.channel_conversation_events as remaining
         where remaining.privacy_deletion_request_id = request.id
      )
      and not exists (
        select 1
          from public.consent_log as remaining
         where remaining.privacy_deletion_request_id = request.id
      )
      and not exists (
        select 1
          from public.content_attribution_evidence as remaining
         where remaining.privacy_deletion_request_id = request.id
      );

  select pg_catalog.count(*)::integer
    into v_remaining_eligible_count
    from public.privacy_deletion_requests as request
   where request.database_redacted_at is not null
     and (
       exists (
         select 1 from public.channel_conversation_events as event
          where event.privacy_deletion_request_id = request.id
            and event.privacy_redacted_at is not null
            and event.occurred_at <= pg_catalog.clock_timestamp() - interval '3 years'
       )
       or exists (
         select 1 from public.consent_log as consent
          where consent.privacy_deletion_request_id = request.id
            and consent.privacy_redacted_at is not null
            and consent.captured_at <= pg_catalog.clock_timestamp() - interval '3 years'
       )
       or exists (
         select 1 from public.content_attribution_evidence as evidence
          where evidence.privacy_deletion_request_id = request.id
            and evidence.privacy_redacted_at is not null
            and evidence.observed_at <= pg_catalog.clock_timestamp() - interval '3 years'
       )
     );

  delete from private.privacy_expiry_authorizations as authorization
   where authorization.backend_pid = pg_catalog.pg_backend_pid()
     and authorization.transaction_id = pg_catalog.pg_current_xact_id()::text;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'retention_period', '3 years',
    'eligible_request_count', v_request_count,
    'purged_event_count',
      v_channel_event_count + v_consent_event_count + v_attribution_event_count,
    'purged_channel_event_count', v_channel_event_count,
    'purged_consent_event_count', v_consent_event_count,
    'purged_attribution_event_count', v_attribution_event_count,
    'remaining_eligible_count', v_remaining_eligible_count,
    'has_more', v_remaining_eligible_count > 0
  );
end;
$$;

revoke all privileges on function private.purge_expired_privacy_audit_envelopes_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.purge_expired_privacy_audit_envelopes_impl(integer)
  to service_role;

comment on function private.purge_expired_privacy_audit_envelopes_impl(integer) is
  'Service-only bounded retention purge. Deletes already-redacted channel, consent and attribution audit events once their original event timestamp reaches the calendar three-year maximum; normal direct DELETE remains prohibited and the minimal deletion-request tombstone remains.';

create or replace function public.purge_expired_privacy_audit_envelopes(
  p_limit integer default 100
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.purge_expired_privacy_audit_envelopes_impl(p_limit);
$$;

revoke all privileges on function public.purge_expired_privacy_audit_envelopes(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_privacy_audit_envelopes(integer)
  to service_role;

-- -------------------------------------------------------------------------
-- Backfill: only rows already carrying the prior explicit anonymization
-- sentinels. No live/non-sentinel lead is selected by this migration.
-- -------------------------------------------------------------------------

do $$
declare
  legacy_lead record;
begin
  for legacy_lead in
    select lead.firm_id, lead.lead_id
      from public.screened_leads as lead
     where lead.firm_id is not null
       and lead.privacy_redacted_at is null
       and lead.contact_name = '[anonymized]'
       and lead.brief_json @> '{"anonymized":true}'::jsonb
       and lead.slot_answers @> '{"anonymized":true}'::jsonb
  loop
    perform public.redact_screened_lead_subject(
      legacy_lead.firm_id,
      legacy_lead.lead_id,
      'legacy_anonymization_backfill',
      pg_catalog.gen_random_uuid()
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
