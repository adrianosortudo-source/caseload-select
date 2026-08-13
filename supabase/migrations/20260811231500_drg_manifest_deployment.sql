-- DR-122: manifest-driven, idempotent DRG Deliverables + Publishing Kit placement.
-- Placement only. This RPC cannot publish, notify, approve, or deploy code.

create table if not exists public.drg_content_deployments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  deployment_key text not null,
  operator_week_number integer not null check (operator_week_number >= 1),
  calendar_key text not null check (calendar_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  run_id text not null,
  content_version text not null,
  bundle_sha256 text not null check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  bundle_canonical_sha256 text not null check (bundle_canonical_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_sha256 text not null check (authorization_sha256 ~ '^[0-9a-f]{64}$'),
  period_id uuid not null references public.content_periods(id) on delete restrict,
  package_id uuid not null references public.publishing_packages(id) on delete restrict,
  writes_performed integer not null check (writes_performed >= 0),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  constraint drg_content_deployments_firm_key unique (firm_id, deployment_key)
);

create index if not exists idx_drg_content_deployments_firm_week
  on public.drg_content_deployments (firm_id, operator_week_number desc);

alter table public.drg_content_deployments enable row level security;
alter table public.drg_content_deployments force row level security;
revoke all on public.drg_content_deployments from anon, authenticated, public;
grant all on public.drg_content_deployments to service_role;

drop trigger if exists trg_block_drg_content_deployments_mutation on public.drg_content_deployments;
create trigger trg_block_drg_content_deployments_mutation
before update or delete on public.drg_content_deployments
for each row execute function public.block_append_only_mutation();

create or replace function public.apply_drg_content_deployment(
  p_bundle jsonb,
  p_bundle_sha256 text,
  p_bundle_canonical_sha256 text,
  p_authorization jsonb,
  p_authorization_sha256 text,
  p_storage_urls jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_firm_id uuid := (p_bundle->>'firmId')::uuid;
  v_deployment_key text := p_bundle->>'deploymentKey';
  v_period_id uuid := (p_bundle#>>'{period,id}')::uuid;
  v_package_id uuid := (p_bundle->>'publishingPackageId')::uuid;
  v_existing public.drg_content_deployments%rowtype;
  v_piece jsonb;
  v_asset jsonb;
  v_placement jsonb;
  v_role text;
  v_storage_path text;
  v_writes integer := 0;
  v_event_receipt jsonb;
  v_result jsonb;
begin
  if p_bundle->>'schemaVersion' <> 'drg-deployment-bundle-v1' then raise exception 'unsupported deployment bundle schema'; end if;
  if coalesce((p_bundle->>'publicationAuthorized')::boolean, true) then raise exception 'deployment bundle must not authorize publication'; end if;
  if jsonb_array_length(p_bundle->'pieces') <> 16 then raise exception 'deployment bundle must contain exactly 16 pieces'; end if;
  if (select count(distinct value->>'slotId') from jsonb_array_elements(p_bundle->'pieces')) <> 16
     or exists (
       select 1 from (values
         ('counsel-note-en'),('counsel-note-pt'),('clause-en'),('clause-pt'),('minute-en'),
         ('gbp-counsel-note-en'),('gbp-clause-en'),('gbp-checklist-en'),
         ('lead-magnet-en'),('lead-magnet-pt'),('checklist-en'),('checklist-pt'),
         ('linkedin-counsel-note-en'),('linkedin-clause-en'),
         ('linkedin-post-counsel-note-en'),('linkedin-post-clause-en')
       ) expected(slot_id)
       where not exists (select 1 from jsonb_array_elements(p_bundle->'pieces') p where p->>'slotId' = expected.slot_id)
     ) then raise exception 'deployment bundle piece registry is not the canonical sixteen'; end if;
  if p_bundle#>>'{authority,releaseId}' <> 'DRG-LAW-CSB-4.22' then raise exception 'deployment bundle authority mismatch'; end if;
  if jsonb_typeof(p_bundle#>'{period,strategyBrief}') <> 'object'
     or not (p_bundle#>'{period,strategyBrief}' ?& array['readerAndSituation','workSupported','whyThisWeek','practicalAngle','authorityAndEvidence','websiteAndConversionRole'])
     or (select count(*) from jsonb_object_keys(p_bundle#>'{period,strategyBrief}')) <> 6
     then raise exception 'deployment bundle requires the exact six-field strategy brief'; end if;
  if p_bundle_sha256 !~ '^[0-9a-f]{64}$' or p_bundle_canonical_sha256 !~ '^[0-9a-f]{64}$' or p_authorization_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid deployment hash'; end if;
  if p_authorization->>'operation' <> 'deliverables_publishing_kit_placement' then raise exception 'authorization operation mismatch'; end if;
  if jsonb_typeof(p_authorization->'allowedTargetIds') <> 'array' or jsonb_typeof(p_authorization->'allowedDestinationRecords') <> 'array' then raise exception 'authorization allowlists must be arrays'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_authorization->'allowedTargetIds')) <> jsonb_array_length(p_authorization->'allowedTargetIds')
     or (select count(distinct value) from jsonb_array_elements_text(p_authorization->'allowedDestinationRecords')) <> jsonb_array_length(p_authorization->'allowedDestinationRecords')
     then raise exception 'authorization allowlists must contain unique values'; end if;
  if jsonb_array_length(p_authorization->'allowedTargetIds') <> (
       5 + jsonb_array_length(p_bundle->'pieces') * 2 + jsonb_array_length(p_bundle->'assets')
       + (select count(*) from jsonb_array_elements(p_bundle->'assets') a cross join lateral jsonb_array_elements(a->'placements') pl where pl->>'packageAssetId' is not null)
     )
     or jsonb_array_length(p_authorization->'allowedDestinationRecords') <> (
       4 + jsonb_array_length(p_bundle->'pieces') * 2 + jsonb_array_length(p_bundle->'assets')
       + (select count(*) from jsonb_array_elements(p_bundle->'assets') a cross join lateral jsonb_array_elements(a->'placements') pl where pl->>'packageAssetId' is not null)
     )
     then raise exception 'authorization allowlists must exactly match the deterministic deployment scope'; end if;
  if p_authorization->>'planSha256' <> p_bundle_canonical_sha256 then raise exception 'authorization plan hash mismatch'; end if;
  if (p_authorization->>'expiresAt')::timestamptz <= now() then raise exception 'authorization expired'; end if;
  if (p_authorization->>'maxWriteCount')::integer < (p_bundle#>>'{writeAllowlist,maxWrites}')::integer then raise exception 'authorization write cap is below bundle plan'; end if;
  if not (p_authorization->'allowedTargetIds' ? v_period_id::text) or not (p_authorization->'allowedTargetIds' ? v_package_id::text) then raise exception 'authorization misses period or package target'; end if;
  if not (p_authorization->'allowedTargetIds' ? (p_bundle->>'deploymentReceiptId'))
     or not (p_authorization->'allowedTargetIds' ? (p_bundle->>'packageEventId'))
     or not (p_authorization->'allowedTargetIds' ? (p_bundle->>'operationId'))
     then raise exception 'authorization misses deployment receipt, package event, or operation target'; end if;
  if not (p_authorization->'allowedDestinationRecords' ? ('content_periods:' || v_period_id::text)) or not (p_authorization->'allowedDestinationRecords' ? ('publishing_packages:' || v_package_id::text)) then raise exception 'authorization misses period or package destination record'; end if;
  if not (p_authorization->'allowedDestinationRecords' ? ('publishing_package_events:' || (p_bundle->>'packageEventId')))
     or not (p_authorization->'allowedDestinationRecords' ? ('drg_content_deployments:' || (p_bundle->>'deploymentReceiptId')))
     then raise exception 'authorization misses event or deployment destination record'; end if;
  if p_bundle#>>'{writeAllowlist,storageBucket}' <> 'firm-files' then raise exception 'unsupported storage bucket'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_firm_id::text || ':' || v_deployment_key, 0));
  select * into v_existing from public.drg_content_deployments
    where firm_id = v_firm_id and deployment_key = v_deployment_key;
  if found then
    if v_existing.bundle_sha256 <> p_bundle_sha256 or v_existing.bundle_canonical_sha256 <> p_bundle_canonical_sha256 or v_existing.authorization_sha256 <> p_authorization_sha256 then
      raise exception 'deployment key already exists with different bundle bytes or authorization content hash';
    end if;
    return jsonb_build_object('status','verified_noop','writesPerformed',0,'deploymentId',v_existing.id,'periodId',v_existing.period_id,'packageId',v_existing.package_id,'receipt',v_existing.receipt);
  end if;

  if exists(select 1 from public.content_periods where firm_id = v_firm_id and week_number = (p_bundle->>'operatorWeekNumber')::integer and id <> v_period_id) then
    raise exception 'operator week number already belongs to another immutable period';
  end if;

  insert into public.content_periods(id, firm_id, starts_on, ends_on, theme, details, rationale, sort_index, week_number, strategy_brief, created_by_role)
  values (v_period_id, v_firm_id, (p_bundle#>>'{period,startsOn}')::date, (p_bundle#>>'{period,endsOn}')::date,
    p_bundle#>>'{period,theme}', p_bundle#>>'{period,details}', p_bundle#>>'{period,rationale}',
    (p_bundle#>>'{period,sortIndex}')::integer, (p_bundle->>'operatorWeekNumber')::integer, p_bundle#>'{period,strategyBrief}', 'operator');
  v_writes := v_writes + 1;

  for v_piece in select value from jsonb_array_elements(p_bundle->'pieces') loop
    if not (p_authorization->'allowedTargetIds' ? (v_piece->>'deliverableId')) then raise exception 'authorization misses deliverable target: %', v_piece->>'deliverableId'; end if;
    if not (p_authorization->'allowedTargetIds' ? (v_piece->>'versionId')) then raise exception 'authorization misses version target: %', v_piece->>'versionId'; end if;
    if not (p_authorization->'allowedDestinationRecords' ? ('content_deliverables:' || (v_piece->>'deliverableId'))) then raise exception 'authorization misses deliverable destination record'; end if;
    if not (p_authorization->'allowedDestinationRecords' ? ('deliverable_versions:' || (v_piece->>'versionId'))) then raise exception 'authorization misses version destination record'; end if;
    if exists(select 1 from public.content_deliverables where id = (v_piece->>'deliverableId')::uuid) then
      raise exception 'deliverable id collision: %', v_piece->>'deliverableId';
    end if;
    v_storage_path := null;
    if v_piece->>'contentKind' = 'pdf' then
      select a->>'storagePath' into v_storage_path
      from jsonb_array_elements(p_bundle->'assets') a,
           jsonb_array_elements(a->'placements') pl
      where pl->>'slotId' = v_piece->>'slotId' and pl->>'role' = 'pdf_document'
      limit 1;
    end if;
    insert into public.content_deliverables(
      id, firm_id, title, description, content_kind, status, period_id, format, kicker,
      locale, deliverable_role, publication_destination, publication_path, cta_target_path,
      hero_image_url, created_by_role
    ) values (
      (v_piece->>'deliverableId')::uuid, v_firm_id, v_piece->>'title', v_piece->>'description', v_piece->>'contentKind', 'in_review',
      v_period_id, v_piece->>'formatFamily', 'Wk ' || (p_bundle->>'operatorWeekNumber'), v_piece->>'locale',
      v_piece->>'deliverableRole', v_piece->>'destination', nullif(v_piece->>'publicationPath',''), nullif(v_piece->>'ctaTargetPath',''),
      nullif(p_storage_urls->>(v_piece->>'slotId'),''), 'operator'
    );
    insert into public.deliverable_versions(
      id, deliverable_id, firm_id, version_number, body_html, storage_path, asset_mime, asset_size_bytes, asset_name, note, created_by_role
    ) values (
      (v_piece->>'versionId')::uuid, (v_piece->>'deliverableId')::uuid, v_firm_id, 1,
      case when v_piece->>'contentKind' = 'text' then v_piece->>'bodyHtml' else null end,
      v_storage_path,
      case when v_piece->>'contentKind' = 'pdf' then 'application/pdf' else null end,
      case when v_piece->>'contentKind' = 'pdf' then (select (a->>'byteSize')::integer from jsonb_array_elements(p_bundle->'assets') a where a->>'storagePath' = v_storage_path limit 1) else null end,
      case when v_piece->>'contentKind' = 'pdf' then regexp_replace(v_storage_path, '^.*/', '') else null end,
      'DR-122 manifest deployment ' || v_deployment_key, 'operator'
    );
    update public.content_deliverables set current_version_id = (v_piece->>'versionId')::uuid where id = (v_piece->>'deliverableId')::uuid;
    v_writes := v_writes + 3;
  end loop;

  insert into public.publishing_packages(id, firm_id, period_id, schema_version, expected_piece_count, manifest_revision, status, manifest)
  values (v_package_id, v_firm_id, v_period_id, 1, 16, 1, 'draft', p_bundle);
  v_writes := v_writes + 1;

  for v_asset in select value from jsonb_array_elements(p_bundle->'assets') loop
    if not (p_authorization->'allowedTargetIds' ? (v_asset->>'assetId')) then raise exception 'authorization misses source asset target: %', v_asset->>'assetId'; end if;
    if not exists (
      select 1 from jsonb_array_elements(p_bundle->'approvalEvidence') approval,
        jsonb_array_elements_text(approval->'scope') as approved_id(value)
      where approval->>'decision' = 'approved' and approved_id.value = v_asset->>'assetId'
    ) then raise exception 'asset lacks exact approval scope: %', v_asset->>'assetId'; end if;
    if not (p_authorization->'allowedDestinationRecords' ? ('storage:' || (p_bundle#>>'{writeAllowlist,storageBucket}') || ':' || (v_asset->>'storagePath'))) then
      raise exception 'authorization misses exact storage destination: %', v_asset->>'storagePath';
    end if;
    if (v_asset->>'storagePath') not like ((p_bundle#>>'{writeAllowlist,storagePrefix}') || '%') then raise exception 'asset storage path is outside the write allowlist'; end if;
    for v_placement in select value from jsonb_array_elements(v_asset->'placements') loop
      if v_placement->>'packageAssetId' is not null then
        if not (p_authorization->'allowedTargetIds' ? (v_placement->>'packageAssetId')) then raise exception 'authorization misses Publishing Kit asset row: %', v_placement->>'packageAssetId'; end if;
        if not (p_authorization->'allowedDestinationRecords' ? ('publishing_package_assets:' || (v_placement->>'packageAssetId'))) then raise exception 'authorization misses Publishing Kit asset destination record'; end if;
        v_role := v_placement->>'databaseRole';
        insert into public.publishing_package_assets(
          id, package_id, firm_id, period_id, content_slot_id, deliverable_id, source_version_id,
          candidate_group_id, locale, destination, asset_role, filename, mime_type, byte_size,
          width, height, sha256, storage_key, alt_text, text_policy, overlay_language, status, is_selected
        ) values (
          (v_placement->>'packageAssetId')::uuid, v_package_id, v_firm_id, v_period_id, v_placement->>'slotId',
          (select (p->>'deliverableId')::uuid from jsonb_array_elements(p_bundle->'pieces') p where p->>'slotId' = v_placement->>'slotId'),
          (select (p->>'versionId')::uuid from jsonb_array_elements(p_bundle->'pieces') p where p->>'slotId' = v_placement->>'slotId'),
          (v_asset->>'assetId')::uuid, v_placement->>'locale', v_placement->>'destination', v_role,
          regexp_replace(v_asset->>'storagePath', '^.*/', ''), v_asset->>'mimeType', (v_asset->>'byteSize')::bigint,
          (v_asset->>'width')::integer, (v_asset->>'height')::integer, v_asset->>'sha256', v_asset->>'storagePath',
          'Approved DRG Law weekly asset', v_asset->>'textPolicy', nullif(v_asset->>'overlayLanguage',''), 'hash_verified', true
        );
        v_writes := v_writes + 1;
      end if;
    end loop;
  end loop;

  v_event_receipt := jsonb_build_object(
    'operation_id', (p_bundle->>'operationId')::uuid, 'deployment_key', v_deployment_key, 'bundle_sha256', p_bundle_sha256,
    'authorization_sha256', p_authorization_sha256, 'firm_id', v_firm_id, 'period_id', v_period_id,
    'package_id', v_package_id, 'writes_performed', v_writes + 2, 'publication_authorized', false,
    'outcome', 'success'
  );
  insert into public.publishing_package_events(id, package_id, firm_id, period_id, event_type, actor_type, operation_id, receipt)
  values ((p_bundle->>'packageEventId')::uuid, v_package_id, v_firm_id, v_period_id, 'manifest_created', 'operator', (v_event_receipt->>'operation_id')::uuid, v_event_receipt);
  v_writes := v_writes + 1;

  insert into public.drg_content_deployments(
    id, firm_id, deployment_key, operator_week_number, calendar_key, run_id, content_version,
    bundle_sha256, bundle_canonical_sha256, authorization_sha256, period_id, package_id, writes_performed, receipt
  ) values (
    (p_bundle->>'deploymentReceiptId')::uuid, v_firm_id, v_deployment_key, (p_bundle->>'operatorWeekNumber')::integer, p_bundle->>'calendarKey',
    p_bundle->>'runId', p_bundle->>'contentVersion', p_bundle_sha256, p_bundle_canonical_sha256, p_authorization_sha256,
    v_period_id, v_package_id, v_writes + 1, v_event_receipt
  ) returning jsonb_build_object('status','applied','writesPerformed',writes_performed,'deploymentId',id,'periodId',period_id,'packageId',package_id,'receipt',receipt) into v_result;
  return v_result;
end;
$$;

revoke all on function public.apply_drg_content_deployment(jsonb,text,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_drg_content_deployment(jsonb,text,text,jsonb,text,jsonb) to service_role;

notify pgrst, 'reload schema';
