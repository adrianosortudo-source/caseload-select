-- CaseLoad Select Secure Import Room.
--
-- The lawyer's CSV is parsed in the browser and is never uploaded or stored.
-- These tables retain only authorization, batch, reconciliation, and outcome
-- metadata. They deliberately contain no names, email addresses, phone
-- numbers, filenames, or raw row payloads.

alter table public.intake_firms
  add column if not exists secure_client_import_enabled boolean not null default false,
  add column if not exists secure_client_import_live_writes_enabled boolean not null default false,
  add column if not exists secure_client_import_max_rows integer not null default 2500;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'intake_firms_secure_client_import_max_rows_check'
      and conrelid = 'public.intake_firms'::regclass
  ) then
    alter table public.intake_firms
      add constraint intake_firms_secure_client_import_max_rows_check
      check (secure_client_import_max_rows between 1 and 5000);
  end if;
end $$;

comment on column public.intake_firms.secure_client_import_enabled is
  'Operator-controlled activation gate for lawyer-operated CRM imports. False by default. Enabling does not authorize messaging.';
comment on column public.intake_firms.secure_client_import_live_writes_enabled is
  'Second firm-level kill switch for live HighLevel contact creation. Requires the global CLIENT_IMPORT_LIVE_WRITES_ENABLED gate too.';

create table if not exists public.secure_client_import_challenges (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  lawyer_id uuid not null references public.firm_lawyers(id) on delete cascade,
  code_hash text not null,
  recipient_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  verified_at timestamptz,
  attested_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint secure_client_import_challenges_verification_order check (
    attested_at is null or verified_at is not null
  ),
  constraint secure_client_import_challenges_consumption_order check (
    consumed_at is null or (verified_at is not null and attested_at is not null)
  )
);

create index if not exists secure_client_import_challenges_lookup_idx
  on public.secure_client_import_challenges (firm_id, lawyer_id, created_at desc);
create index if not exists secure_client_import_challenges_expiry_idx
  on public.secure_client_import_challenges (expires_at)
  where consumed_at is null and revoked_at is null;

create table if not exists public.secure_client_import_batches (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  lawyer_id uuid not null references public.firm_lawyers(id) on delete restrict,
  challenge_id uuid not null unique references public.secure_client_import_challenges(id) on delete restrict,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_byte_count integer not null check (file_byte_count between 1 and 5242880),
  template_version text not null default 'relationship-import-v1',
  authorization_policy_version text not null default 'secure-import-v1',
  authorization_text text not null,
  source_ip inet,
  user_agent text,
  hold_required boolean not null default true check (hold_required = true),
  messaging_permission_inferred boolean not null default false check (messaging_permission_inferred = false),
  automatic_workflow_enrolment boolean not null default false check (automatic_workflow_enrolment = false),
  declared_row_count integer not null check (declared_row_count between 1 and 5000),
  processed_row_count integer not null default 0 check (processed_row_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  existing_count integer not null default 0 check (existing_count >= 0),
  held_count integer not null default 0 check (held_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  reconcile_count integer not null default 0 check (reconcile_count >= 0),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'completed_with_exceptions', 'cancelled')
  ),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists secure_client_import_batches_firm_idx
  on public.secure_client_import_batches (firm_id, created_at desc);

create table if not exists public.secure_client_import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.secure_client_import_batches(id) on delete cascade,
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  row_number integer not null check (row_number > 1),
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status in ('processing', 'created', 'existing_unchanged', 'held_for_review', 'invalid', 'failed', 'reconcile_required')
  ),
  ghl_contact_id text,
  match_count integer not null default 0 check (match_count >= 0),
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  error_code text,
  processed_at timestamptz not null default now(),
  constraint secure_client_import_rows_batch_row_unique unique (batch_id, row_number),
  constraint secure_client_import_rows_batch_fingerprint_unique unique (batch_id, row_fingerprint)
);

create index if not exists secure_client_import_rows_batch_status_idx
  on public.secure_client_import_rows (batch_id, status);
create index if not exists secure_client_import_rows_firm_idx
  on public.secure_client_import_rows (firm_id, processed_at desc);

alter table public.secure_client_import_challenges enable row level security;
alter table public.secure_client_import_challenges force row level security;
alter table public.secure_client_import_batches enable row level security;
alter table public.secure_client_import_batches force row level security;
alter table public.secure_client_import_rows enable row level security;
alter table public.secure_client_import_rows force row level security;

revoke all on public.secure_client_import_challenges from public, anon, authenticated;
revoke all on public.secure_client_import_batches from public, anon, authenticated;
revoke all on public.secure_client_import_rows from public, anon, authenticated;
grant select, insert, update on public.secure_client_import_challenges to service_role;
grant select, insert, update on public.secure_client_import_batches to service_role;
grant select, insert, update on public.secure_client_import_rows to service_role;
grant usage, select on sequence public.secure_client_import_rows_id_seq to service_role;

comment on table public.secure_client_import_challenges is
  'Hashed, one-use, ten-minute lawyer step-up challenges for Secure Import Room authorization. Server-only.';
comment on table public.secure_client_import_batches is
  'Firm-scoped Secure Import Room audit batches. Contains metadata only, never raw client files or row PII.';
comment on table public.secure_client_import_rows is
  'Per-row reconciliation outcomes identified only by row number and one-way fingerprint. Contains no imported PII.';

create or replace function public.verify_secure_client_import_challenge(
  p_challenge_id uuid,
  p_firm_id uuid,
  p_lawyer_id uuid,
  p_code_hash text,
  p_attested boolean
)
returns table (outcome text, verified_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge public.secure_client_import_challenges%rowtype;
  verified_time timestamptz;
  next_attempts smallint;
begin
  select * into challenge
  from public.secure_client_import_challenges
  where id = p_challenge_id
    and firm_id = p_firm_id
    and lawyer_id = p_lawyer_id
  for update;

  if not found then return query select 'challenge_not_found'::text, null::timestamptz; return; end if;
  if challenge.revoked_at is not null or challenge.consumed_at is not null then
    return query select 'challenge_unavailable'::text, null::timestamptz; return;
  end if;
  if challenge.verified_at is not null then
    return query select 'challenge_already_verified'::text, challenge.verified_at; return;
  end if;
  if challenge.expires_at <= now() then
    return query select 'challenge_expired'::text, null::timestamptz; return;
  end if;
  if challenge.attempts >= 5 then
    return query select 'challenge_locked'::text, null::timestamptz; return;
  end if;
  if challenge.code_hash <> p_code_hash then
    next_attempts := challenge.attempts + 1;
    update public.secure_client_import_challenges
      set attempts = next_attempts,
          revoked_at = case when next_attempts >= 5 then now() else revoked_at end
      where id = p_challenge_id;
    return query select case when next_attempts >= 5 then 'challenge_locked' else 'invalid_code' end::text, null::timestamptz;
    return;
  end if;
  if p_attested is not true then
    return query select 'authorization_attestation_required'::text, null::timestamptz; return;
  end if;

  verified_time := now();
  update public.secure_client_import_challenges
    set verified_at = verified_time, attested_at = verified_time
    where id = p_challenge_id;
  return query select 'ok'::text, verified_time;
end;
$$;

revoke all on function public.verify_secure_client_import_challenge(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.verify_secure_client_import_challenge(uuid, uuid, uuid, text, boolean)
  to service_role;

create or replace function public.create_secure_client_import_batch(
  p_batch_id uuid,
  p_challenge_id uuid,
  p_firm_id uuid,
  p_lawyer_id uuid,
  p_file_sha256 text,
  p_file_byte_count integer,
  p_template_version text,
  p_declared_row_count integer,
  p_policy_version text,
  p_authorization_text text,
  p_source_ip inet,
  p_user_agent text
)
returns table (outcome text, batch_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge public.secure_client_import_challenges%rowtype;
begin
  select * into challenge
  from public.secure_client_import_challenges
  where id = p_challenge_id
    and firm_id = p_firm_id
    and lawyer_id = p_lawyer_id
  for update;

  if not found then return query select 'challenge_not_found'::text, null::uuid; return; end if;
  if challenge.verified_at is null or challenge.attested_at is null then
    return query select 'challenge_not_authorized'::text, null::uuid; return;
  end if;
  if challenge.consumed_at is not null or challenge.revoked_at is not null then
    return query select 'challenge_unavailable'::text, null::uuid; return;
  end if;
  if challenge.expires_at <= now() then
    return query select 'challenge_expired'::text, null::uuid; return;
  end if;

  insert into public.secure_client_import_batches (
    id, firm_id, lawyer_id, challenge_id, file_sha256, file_byte_count,
    template_version, declared_row_count, authorization_policy_version,
    authorization_text, source_ip, user_agent, status
  ) values (
    p_batch_id, p_firm_id, p_lawyer_id, p_challenge_id, p_file_sha256,
    p_file_byte_count, p_template_version, p_declared_row_count,
    p_policy_version, p_authorization_text, p_source_ip, left(p_user_agent, 500), 'pending'
  );

  update public.secure_client_import_challenges
    set consumed_at = now()
    where id = p_challenge_id;
  return query select 'ok'::text, p_batch_id;
end;
$$;

revoke all on function public.create_secure_client_import_batch(uuid, uuid, uuid, uuid, text, integer, text, integer, text, text, inet, text)
  from public, anon, authenticated;
grant execute on function public.create_secure_client_import_batch(uuid, uuid, uuid, uuid, text, integer, text, integer, text, text, inet, text)
  to service_role;

notify pgrst, 'reload schema';
