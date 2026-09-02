-- Atomic chunk claims and token-guarded finalization for Secure Import Room.
-- HighLevel calls happen between these short transactions. An expired claim
-- is never reassigned because the remote create outcome may be unknown.

alter table public.secure_client_import_rows
  add column if not exists claim_token uuid,
  add column if not exists claim_started_at timestamptz;

comment on column public.secure_client_import_rows.claim_token is
  'Opaque server-side ownership proof required to finalize a processing row.';
comment on column public.secure_client_import_rows.claim_started_at is
  'Start time of the external-write claim. Expired claims require reconciliation and are never reassigned automatically.';

create unique index if not exists secure_client_import_rows_claim_token_unique_idx
  on public.secure_client_import_rows (claim_token)
  where claim_token is not null;

create or replace function public.refresh_secure_client_import_batch(
  p_batch_id uuid,
  p_firm_id uuid,
  p_lawyer_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.secure_client_import_batches%rowtype;
  v_processed_count integer;
  v_processing_count integer;
  v_created_count integer;
  v_existing_count integer;
  v_held_count integer;
  v_invalid_count integer;
  v_failed_count integer;
  v_reconcile_count integer;
  v_next_status text;
  v_next_completed_at timestamptz;
begin
  select * into v_batch
  from public.secure_client_import_batches
  where id = p_batch_id and firm_id = p_firm_id and lawyer_id = p_lawyer_id
  for update;
  if not found then return jsonb_build_object('outcome', 'batch_not_found'); end if;

  select
    count(*) filter (where status <> 'processing')::integer,
    count(*) filter (where status = 'processing')::integer,
    count(*) filter (where status = 'created')::integer,
    count(*) filter (where status = 'existing_unchanged')::integer,
    count(*) filter (where status = 'held_for_review')::integer,
    count(*) filter (where status = 'invalid')::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status = 'reconcile_required')::integer
  into v_processed_count, v_processing_count, v_created_count, v_existing_count, v_held_count,
       v_invalid_count, v_failed_count, v_reconcile_count
  from public.secure_client_import_rows
  where batch_id = p_batch_id and firm_id = p_firm_id;

  if v_processed_count > v_batch.declared_row_count then
    raise exception 'secure import processed row count exceeds declared row count';
  end if;

  if v_batch.status = 'cancelled' then
    v_next_status := 'cancelled';
    v_next_completed_at := v_batch.completed_at;
  elsif v_processed_count = v_batch.declared_row_count then
    v_next_status := case
      when v_held_count + v_invalid_count + v_failed_count + v_reconcile_count > 0
        then 'completed_with_exceptions'
      else 'completed'
    end;
    v_next_completed_at := coalesce(v_batch.completed_at, clock_timestamp());
  else
    v_next_status := case
      when v_batch.status in ('completed', 'completed_with_exceptions') then v_batch.status
      when v_processing_count > 0 or v_processed_count > 0 then 'processing'
      else 'processing'
    end;
    v_next_completed_at := v_batch.completed_at;
  end if;

  update public.secure_client_import_batches
  set processed_row_count = v_processed_count,
      created_count = v_created_count,
      existing_count = v_existing_count,
      held_count = v_held_count,
      invalid_count = v_invalid_count,
      failed_count = v_failed_count,
      reconcile_count = v_reconcile_count,
      status = v_next_status,
      completed_at = v_next_completed_at,
      updated_at = clock_timestamp()
  where id = p_batch_id;

  return jsonb_build_object(
    'outcome', 'ok',
    'status', v_next_status,
    'counts', jsonb_build_object(
      'processed', v_processed_count,
      'created', v_created_count,
      'existing', v_existing_count,
      'held', v_held_count,
      'invalid', v_invalid_count,
      'failed', v_failed_count,
      'reconcile', v_reconcile_count
    )
  );
end;
$$;

create or replace function public.claim_secure_client_import_rows(
  p_batch_id uuid,
  p_firm_id uuid,
  p_lawyer_id uuid,
  p_rows jsonb
)
returns table (
  row_number integer,
  outcome text,
  status text,
  error_code text,
  claim_token uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.secure_client_import_batches%rowtype;
  v_requested record;
  v_row public.secure_client_import_rows%rowtype;
  v_token uuid;
  v_expired boolean := false;
  v_final_statuses constant text[] := array[
    'created', 'existing_unchanged', 'held_for_review', 'invalid', 'failed', 'reconcile_required'
  ];
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return query select null::integer, 'rows_must_contain_1_to_25_items'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if jsonb_array_length(p_rows) not between 1 and 25 then
    return query select null::integer, 'rows_must_contain_1_to_25_items'::text, null::text, null::text, null::uuid;
    return;
  end if;

  select * into v_batch
  from public.secure_client_import_batches
  where id = p_batch_id and firm_id = p_firm_id and lawyer_id = p_lawyer_id
  for update;
  if not found then
    return query select null::integer, 'batch_not_found'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if v_batch.status = 'cancelled' then
    return query select null::integer, 'batch_cancelled'::text, null::text, null::text, null::uuid;
    return;
  end if;

  -- Validate JSON shape before typed record expansion, then validate the
  -- entire chunk before any row is mutated.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as raw(item)
    where jsonb_typeof(raw.item) is distinct from 'object'
       or jsonb_typeof(raw.item -> 'row_number') is distinct from 'number'
       or coalesce((raw.item ->> 'row_number') !~ '^[0-9]+$', true)
       or jsonb_typeof(raw.item -> 'row_fingerprint') is distinct from 'string'
  ) then
    return query select null::integer, 'invalid_row_claim'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    where item.row_number is null
       or item.row_number <= 1
       or item.row_number > v_batch.declared_row_count + 1
       or item.row_fingerprint is null
       or item.row_fingerprint !~ '^[0-9a-f]{64}$'
  ) then
    return query select null::integer, 'invalid_row_claim'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    group by item.row_number
    having count(*) > 1
  ) then
    return query select null::integer, 'duplicate_row_number_in_request'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    group by item.row_fingerprint
    having count(*) > 1
  ) then
    return query select null::integer, 'duplicate_row_fingerprint_in_request'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    join public.secure_client_import_rows existing
      on existing.batch_id = p_batch_id and existing.row_fingerprint = item.row_fingerprint
    where existing.row_number <> item.row_number
  ) then
    return query select null::integer, 'duplicate_row_identity'::text, null::text, null::text, null::uuid;
    return;
  end if;
  -- Fingerprints are compared before final, in-progress, or expiry handling.
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    join public.secure_client_import_rows existing
      on existing.batch_id = p_batch_id and existing.row_number = item.row_number
    where existing.row_fingerprint <> item.row_fingerprint
  ) then
    return query select null::integer, 'row_fingerprint_mismatch'::text, null::text, null::text, null::uuid;
    return;
  end if;
  if v_batch.status in ('completed', 'completed_with_exceptions') and exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    left join public.secure_client_import_rows existing
      on existing.batch_id = p_batch_id and existing.row_number = item.row_number
    where existing.id is null or existing.status <> all(v_final_statuses)
  ) then
    return query select null::integer, 'completed_batch_cannot_accept_new_rows'::text, null::text, null::text, null::uuid;
    return;
  end if;

  for v_requested in
    select item.row_number, item.row_fingerprint
    from jsonb_to_recordset(p_rows) as item(row_number integer, row_fingerprint text)
    order by item.row_number
  loop
    select * into v_row
    from public.secure_client_import_rows existing
    where existing.batch_id = p_batch_id and existing.row_number = v_requested.row_number
    for update;

    if found and v_row.status = any(v_final_statuses) then
      row_number := v_requested.row_number;
      outcome := 'replay';
      status := v_row.status;
      error_code := v_row.error_code;
      claim_token := null;
      return next;
    elsif found then
      if v_row.claim_started_at is null
         or v_row.claim_started_at <= clock_timestamp() - interval '15 minutes' then
        update public.secure_client_import_rows
        set status = 'reconcile_required',
            error_code = 'processing_outcome_unknown',
            claim_token = null,
            claim_started_at = null,
            processed_at = clock_timestamp()
        where id = v_row.id;
        v_expired := true;
        row_number := v_requested.row_number;
        outcome := 'reconcile_required';
        status := 'reconcile_required';
        error_code := 'processing_outcome_unknown';
        claim_token := null;
        return next;
      else
        row_number := v_requested.row_number;
        outcome := 'in_progress';
        status := 'processing';
        error_code := null;
        claim_token := null;
        return next;
      end if;
    else
      v_token := gen_random_uuid();
      insert into public.secure_client_import_rows (
        batch_id, firm_id, row_number, row_fingerprint, status,
        claim_token, claim_started_at, processed_at
      ) values (
        p_batch_id, p_firm_id, v_requested.row_number, v_requested.row_fingerprint,
        'processing', v_token, clock_timestamp(), clock_timestamp()
      );
      row_number := v_requested.row_number;
      outcome := 'claimed';
      status := 'processing';
      error_code := null;
      claim_token := v_token;
      return next;
    end if;
  end loop;

  update public.secure_client_import_batches as batch_row
  set status = case when batch_row.status = 'pending' then 'processing' else batch_row.status end,
      updated_at = clock_timestamp()
  where id = p_batch_id;
  if v_expired then
    perform public.refresh_secure_client_import_batch(p_batch_id, p_firm_id, p_lawyer_id);
  end if;
end;
$$;

create or replace function public.finalize_secure_client_import_row(
  p_batch_id uuid,
  p_firm_id uuid,
  p_lawyer_id uuid,
  p_row_number integer,
  p_row_fingerprint text,
  p_claim_token uuid,
  p_status text,
  p_ghl_contact_id text default null,
  p_match_count integer default 0,
  p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.secure_client_import_batches%rowtype;
  v_row public.secure_client_import_rows%rowtype;
begin
  if p_claim_token is null
     or p_match_count is null
     or p_status not in ('created', 'existing_unchanged', 'held_for_review', 'invalid', 'failed', 'reconcile_required')
     or p_match_count < 0 then
    return jsonb_build_object('outcome', 'invalid_finalization');
  end if;
  select * into v_batch
  from public.secure_client_import_batches
  where id = p_batch_id and firm_id = p_firm_id and lawyer_id = p_lawyer_id
  for update;
  if not found then return jsonb_build_object('outcome', 'batch_not_found'); end if;

  select * into v_row
  from public.secure_client_import_rows
  where batch_id = p_batch_id and row_number = p_row_number
  for update;
  if not found then return jsonb_build_object('outcome', 'row_not_found'); end if;
  if v_row.row_fingerprint <> p_row_fingerprint then
    return jsonb_build_object('outcome', 'row_fingerprint_mismatch');
  end if;
  if v_row.status <> 'processing' or v_row.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'claim_not_owned');
  end if;

  update public.secure_client_import_rows
  set status = p_status,
      ghl_contact_id = p_ghl_contact_id,
      match_count = p_match_count,
      error_code = p_error_code,
      claim_token = null,
      claim_started_at = null,
      processed_at = clock_timestamp()
  where id = v_row.id;

  return public.refresh_secure_client_import_batch(p_batch_id, p_firm_id, p_lawyer_id)
    || jsonb_build_object('outcome', 'finalized');
end;
$$;

revoke all on function public.refresh_secure_client_import_batch(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_secure_client_import_rows(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_secure_client_import_row(uuid, uuid, uuid, integer, text, uuid, text, text, integer, text)
  from public, anon, authenticated;

grant execute on function public.refresh_secure_client_import_batch(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_secure_client_import_rows(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.finalize_secure_client_import_row(uuid, uuid, uuid, integer, text, uuid, text, text, integer, text)
  to service_role;

notify pgrst, 'reload schema';
