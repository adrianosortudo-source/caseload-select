-- Atomic DRG sixteen-piece package staging.
--
-- This migration adds only the durable identity needed to bind an existing
-- Deliverables version to one immutable DRG package, an append-only operation
-- receipt, and two service-role-only functions. It does not approve, publish,
-- notify, or expose a partially staged package. PostgreSQL transaction
-- visibility keeps all sixteen rows hidden until commit; the application must
-- still run the read-only second reconciliation before showing the package.

create extension if not exists pgcrypto with schema extensions;

alter table public.content_deliverables
  add column if not exists drg_piece_id text;

alter table public.content_deliverables
  drop constraint if exists content_deliverables_drg_piece_id_check,
  add constraint content_deliverables_drg_piece_id_check check (
    drg_piece_id is null or drg_piece_id in (
      'CN-EN', 'CN-PT', 'CIM-EN', 'CIM-PT',
      'CHECKLIST-LANDING-EN', 'CHECKLIST-PDF-EN',
      'CHECKLIST-LANDING-PT', 'CHECKLIST-PDF-PT',
      'MINUTE-EN', 'LINKEDIN-CN-EN', 'LINKEDIN-CIM-EN',
      'LINKEDIN-POST-CN-EN', 'LINKEDIN-POST-CIM-EN',
      'GBP-CN-EN', 'GBP-CIM-EN', 'GBP-CHECKLIST-EN'
    )
  );

create unique index if not exists content_deliverables_drg_piece_scope_uidx
  on public.content_deliverables (firm_id, period_id, drg_piece_id)
  where drg_piece_id is not null;

comment on column public.content_deliverables.drg_piece_id is
  'Canonical identity of one registered DRG weekly-package piece. NULL for all non-DRG and legacy deliverables.';

alter table public.deliverable_versions
  add column if not exists drg_package_id text,
  add column if not exists drg_package_version integer,
  add column if not exists drg_package_sha256 text,
  add column if not exists drg_piece_sha256 text,
  add column if not exists drg_source_sha256 text;

alter table public.deliverable_versions
  drop constraint if exists deliverable_versions_drg_binding_check,
  add constraint deliverable_versions_drg_binding_check check (
    (drg_package_id is null and drg_package_version is null and
     drg_package_sha256 is null and drg_piece_sha256 is null and drg_source_sha256 is null)
    or
    (length(btrim(drg_package_id)) > 0 and drg_package_version > 0 and
     drg_package_sha256 ~ '^[0-9a-f]{64}$' and
     drg_piece_sha256 ~ '^[0-9a-f]{64}$' and
     drg_source_sha256 ~ '^[0-9a-f]{64}$')
  );

create unique index if not exists deliverable_versions_drg_natural_idempotency_uidx
  on public.deliverable_versions (deliverable_id, drg_package_sha256, drg_piece_sha256)
  where drg_package_sha256 is not null;

comment on column public.deliverable_versions.drg_package_sha256 is
  'SHA-256 of the exact canonical sealed DRG package that supplied this version.';
comment on column public.deliverable_versions.drg_piece_sha256 is
  'SHA-256 of the exact canonical DRG package piece payload and title.';
comment on column public.deliverable_versions.drg_source_sha256 is
  'Immutable source-content SHA-256 carried by the sealed DRG package.';

create table if not exists public.drg_package_staging_operations (
  id uuid primary key,
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  authorization_id text not null unique check (length(btrim(authorization_id)) > 0),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  period_id uuid not null references public.content_periods(id) on delete restrict,
  package_id text not null check (length(btrim(package_id)) > 0),
  package_version integer not null check (package_version > 0),
  package_sha256 text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  package_canonical text not null check (length(package_canonical) > 0),
  authorization_payload jsonb not null check (jsonb_typeof(authorization_payload) = 'object'),
  pdf_evidence jsonb not null check (jsonb_typeof(pdf_evidence) = 'array'),
  actor_role text not null check (actor_role = 'operator'),
  actor_id uuid not null,
  actor_name text not null check (length(btrim(actor_name)) > 0),
  authorized_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > authorized_at),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  committed_at timestamptz not null default transaction_timestamp(),
  unique (firm_id, period_id, package_id, package_version, package_sha256)
);

create index if not exists drg_package_staging_operations_scope_idx
  on public.drg_package_staging_operations (firm_id, period_id, committed_at desc);

create trigger drg_package_staging_operations_append_only
before update or delete on public.drg_package_staging_operations
for each row execute function public.block_append_only_mutation();

alter table public.drg_package_staging_operations enable row level security;
alter table public.drg_package_staging_operations force row level security;
revoke all on table public.drg_package_staging_operations from public, anon, authenticated;
grant select, insert on table public.drg_package_staging_operations to service_role;

create or replace function public.read_drg_package_staging_snapshot(
  p_firm_id uuid,
  p_period_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'firmId', p_firm_id,
    'periodId', p_period_id,
    'deliverables', coalesce(jsonb_agg(
      jsonb_build_object(
        'pieceId', d.drg_piece_id,
        'deliverableId', d.id,
        'firmId', d.firm_id,
        'periodId', d.period_id,
        'locale', d.locale,
        'contentKind', d.content_kind,
        'deliverableRole', d.deliverable_role,
        'destination', d.publication_destination,
        'currentVersionId', d.current_version_id,
        'approvedVersionId', d.approved_version_id,
        'currentVersion', case when v.id is null then null else jsonb_build_object(
          'id', v.id,
          'versionNumber', v.version_number,
          'packageId', v.drg_package_id,
          'packageVersion', v.drg_package_version,
          'packageSha256', v.drg_package_sha256,
          'pieceSha256', v.drg_piece_sha256,
          'sourceSha256', v.drg_source_sha256
        ) end,
        'approval', case when a.id is null then null else jsonb_build_object(
          'decision', a.decision,
          'versionId', a.version_id,
          'packageSha256', v.drg_package_sha256
        ) end
      ) order by array_position(array[
        'CN-EN', 'CN-PT', 'CIM-EN', 'CIM-PT',
        'CHECKLIST-LANDING-EN', 'CHECKLIST-PDF-EN',
        'CHECKLIST-LANDING-PT', 'CHECKLIST-PDF-PT',
        'MINUTE-EN', 'LINKEDIN-CN-EN', 'LINKEDIN-CIM-EN',
        'LINKEDIN-POST-CN-EN', 'LINKEDIN-POST-CIM-EN',
        'GBP-CN-EN', 'GBP-CIM-EN', 'GBP-CHECKLIST-EN'
      ]::text[], d.drg_piece_id)
    ), '[]'::jsonb)
  )
  from public.content_deliverables d
  left join public.deliverable_versions v on v.id = d.current_version_id
  left join lateral (
    select ar.id, ar.decision, ar.version_id
    from public.approval_records ar
    where ar.firm_id = d.firm_id
      and ar.deliverable_id = d.id
      and ar.version_id = d.current_version_id
    order by ar.created_at desc, ar.id desc
    limit 1
  ) a on true
  where d.firm_id = p_firm_id
    and d.period_id = p_period_id
    and d.drg_piece_id is not null;
$function$;

revoke all on function public.read_drg_package_staging_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_drg_package_staging_snapshot(uuid, uuid)
  to service_role;

create or replace function public.read_drg_pdf_storage_identities(
  p_storage_keys text[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'storageKey', o.name,
    'storageObjectId', o.id,
    'objectUpdatedAt', to_jsonb(o)->>'updated_at'
  ) order by array_position(p_storage_keys, o.name)), '[]'::jsonb)
  from storage.objects o
  where o.bucket_id = 'firm-files'
    and o.name = any(p_storage_keys);
$function$;

revoke all on function public.read_drg_pdf_storage_identities(text[])
  from public, anon, authenticated;
grant execute on function public.read_drg_pdf_storage_identities(text[])
  to service_role;

create or replace function public.stage_drg_weekly_package_atomic(
  p_package jsonb,
  p_package_canonical text,
  p_plan jsonb,
  p_authorization jsonb,
  p_pdf_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_piece_ids constant text[] := array[
    'CN-EN', 'CN-PT', 'CIM-EN', 'CIM-PT',
    'CHECKLIST-LANDING-EN', 'CHECKLIST-PDF-EN',
    'CHECKLIST-LANDING-PT', 'CHECKLIST-PDF-PT',
    'MINUTE-EN', 'LINKEDIN-CN-EN', 'LINKEDIN-CIM-EN',
    'LINKEDIN-POST-CN-EN', 'LINKEDIN-POST-CIM-EN',
    'GBP-CN-EN', 'GBP-CIM-EN', 'GBP-CHECKLIST-EN'
  ];
  v_locales constant text[] := array[
    'en-CA','pt-BR','en-CA','pt-BR','en-CA','en-CA','pt-BR','pt-BR',
    'en-CA','en-CA','en-CA','en-CA','en-CA','en-CA','en-CA','en-CA'
  ];
  v_kinds constant text[] := array[
    'text','text','text','text','text','pdf','text','pdf',
    'text','text','text','text','text','text','text','text'
  ];
  v_roles constant text[] := array[
    'article','article','article','article','landing_page','lead_magnet_pdf',
    'landing_page','lead_magnet_pdf','email_newsletter','article','article',
    'social_post','social_post','gbp_post','gbp_post','gbp_post'
  ];
  v_destinations constant text[] := array[
    'firm_website','firm_website','firm_website','firm_website',
    'firm_website','firm_website','firm_website','firm_website','email',
    'linkedin_article','linkedin_article','linkedin','linkedin',
    'google_business_profile','google_business_profile','google_business_profile'
  ];
  v_formats constant text[] := array[
    'Counsel Note','Counsel Note','Clause in the Margin','Clause in the Margin',
    'Checklist','Checklist','Checklist','Checklist','The DRG Law Minute',
    'LinkedIn Article','LinkedIn Article','LinkedIn Post','LinkedIn Post',
    'Google Business Profile','Google Business Profile','Google Business Profile'
  ];
  v_firm_id uuid;
  v_period_id uuid;
  v_actor_id uuid;
  v_package_id text;
  v_package_version integer;
  v_package_sha text;
  v_idempotency_key text;
  v_authorization_id text;
  v_authorized_at timestamptz;
  v_expires_at timestamptz;
  v_operation_id uuid := gen_random_uuid();
  v_committed_at timestamptz := transaction_timestamp();
  v_existing_operation public.drg_package_staging_operations%rowtype;
  v_piece jsonb;
  v_plan_action jsonb;
  v_pdf_evidence jsonb;
  v_deliverable record;
  v_deliverable_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_exact boolean;
  v_expected_action text;
  v_receipt_pieces jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_added integer := 0;
  v_new_version integer := 0;
  v_skipped integer := 0;
  v_index integer;
begin
  if jsonb_typeof(p_package) <> 'object'
     or jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(p_authorization) <> 'object'
     or jsonb_typeof(p_pdf_evidence) <> 'array' then
    raise exception 'package, plan, authorization, and PDF evidence have invalid JSON shapes';
  end if;
  if p_package->>'schemaVersion' <> 'drg-weekly-package/v1'
     or p_plan->>'kind' <> 'atomic_plan'
     or p_authorization->>'schemaVersion' <> 'drg-package-staging-authorization/v1' then
    raise exception 'unsupported DRG package, plan, or authorization schema';
  end if;

  begin
    v_firm_id := (p_package->>'firmId')::uuid;
    v_period_id := (p_package->>'periodId')::uuid;
    v_actor_id := (p_authorization->>'actorId')::uuid;
    v_package_version := (p_package->>'packageVersion')::integer;
    v_authorized_at := (p_authorization->>'authorizedAt')::timestamptz;
    v_expires_at := (p_authorization->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'package or authorization contains malformed identifiers or timestamps';
  end;
  v_package_id := p_package->>'packageId';
  v_package_sha := p_package->>'packageSha256';
  v_idempotency_key := p_plan->>'packageIdempotencyKey';
  v_authorization_id := p_authorization->>'authorizationId';

  if v_package_version < 1 or length(btrim(coalesce(v_package_id, ''))) = 0
     or v_package_sha !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(v_idempotency_key, ''))) = 0
     or length(btrim(coalesce(v_authorization_id, ''))) = 0 then
    raise exception 'package identity, hash, or idempotency key is malformed';
  end if;
  if p_package_canonical is null
     or p_package_canonical::jsonb <> (p_package - 'packageSha256')
     or encode(extensions.digest(convert_to(p_package_canonical, 'UTF8'), 'sha256'), 'hex') <> v_package_sha then
    raise exception 'canonical package SHA-256 verification failed';
  end if;
  if p_plan->>'packageSha256' is distinct from v_package_sha
     or jsonb_array_length(coalesce(p_plan->'actions', '[]'::jsonb)) <> 16
     or jsonb_array_length(coalesce(p_package->'pieces', '[]'::jsonb)) <> 16
     or jsonb_array_length(p_pdf_evidence) <> 2 then
    raise exception 'plan or package does not contain the exact sixteen-piece topology';
  end if;
  if not (p_package->'doctrine' @> jsonb_build_array(
      jsonb_build_object('id','DRGLaw_ContentStrategy','version','4.18','sha256','7435afd74244ceef85be3d29f8b69ab11e5d72b5f9b3453502f84e6cf372c69e')))
     or not (p_package->'doctrine' @> jsonb_build_array(
      jsonb_build_object('id','DRGLaw_BrandBook','version','13','sha256','9bc8594764cd242c498dab1b1d3ec194289cae4411c930750bf5819c11cec818')))
     or not (p_package->'doctrine' @> jsonb_build_array(
      jsonb_build_object('id','DRG_Terminology','version','2','sha256','0f39469b752c043f3d7bc0ca3351a544c2d12d0a139ee1eaf47fcb982d374d16')))
     or not (p_package->'doctrine' @> jsonb_build_array(
      jsonb_build_object('id','DECISION_RECORDS','version','DR-118','sha256','289fadf02782af6b3af35079b29d2d056233687deae416011a6dae6738884d37'))) then
    raise exception 'package is missing an exact required DRG authority pin';
  end if;

  for v_index in 1..16 loop
    v_piece := p_package->'pieces'->(v_index - 1);
    v_plan_action := p_plan->'actions'->(v_index - 1);
    if v_piece->>'id' is distinct from v_piece_ids[v_index]
       or v_piece->>'locale' is distinct from v_locales[v_index]
       or v_piece->'payload'->>'kind' is distinct from v_kinds[v_index]
       or v_piece->>'pieceSha256' !~ '^[0-9a-f]{64}$'
       or v_piece->>'sourceSha256' !~ '^[0-9a-f]{64}$'
       or length(btrim(coalesce(v_piece->>'title', ''))) = 0
       or v_plan_action->>'pieceId' is distinct from v_piece_ids[v_index]
       or v_plan_action->>'packageSha256' is distinct from v_package_sha
       or v_plan_action->>'pieceSha256' is distinct from v_piece->>'pieceSha256' then
      raise exception 'package or plan topology/hash drift at piece %', v_piece_ids[v_index];
    end if;
    if v_kinds[v_index] = 'text' and length(btrim(coalesce(v_piece->'payload'->>'bodyHtml', ''))) = 0 then
      raise exception 'text payload is empty for piece %', v_piece_ids[v_index];
    end if;
    if v_kinds[v_index] = 'pdf' and (
      v_piece->'payload'->>'mimeType' is distinct from 'application/pdf'
      or length(btrim(coalesce(v_piece->'payload'->>'storageKey', ''))) = 0
      or length(btrim(coalesce(v_piece->'payload'->>'filename', ''))) = 0
      or (v_piece->'payload'->>'byteSize')::integer < 1
      or v_piece->'payload'->>'assetSha256' !~ '^[0-9a-f]{64}$'
    ) then
      raise exception 'PDF payload is incomplete for piece %', v_piece_ids[v_index];
    end if;
    if v_kinds[v_index] = 'pdf' then
      select evidence into v_pdf_evidence
      from jsonb_array_elements(p_pdf_evidence) evidence
      where evidence->>'pieceId' = v_piece_ids[v_index];
      if not found
         or v_pdf_evidence->>'storageKey' is distinct from v_piece->'payload'->>'storageKey'
         or v_pdf_evidence->>'assetSha256' is distinct from v_piece->'payload'->>'assetSha256'
         or (v_pdf_evidence->>'byteSize')::bigint is distinct from (v_piece->'payload'->>'byteSize')::bigint
         or v_pdf_evidence->>'mimeType' is distinct from 'application/pdf'
         or v_pdf_evidence->>'storageObjectId' is null
         or v_pdf_evidence->>'objectUpdatedAt' is null then
        raise exception 'computed PDF byte evidence mismatch for %', v_piece_ids[v_index];
      end if;
    end if;
  end loop;

  if p_authorization->>'firmId' is distinct from v_firm_id::text
     or p_authorization->>'periodId' is distinct from v_period_id::text
     or p_authorization->>'packageId' is distinct from v_package_id
     or (p_authorization->>'packageVersion')::integer is distinct from v_package_version
     or p_authorization->>'packageSha256' is distinct from v_package_sha
     or p_authorization->>'actorRole' is distinct from 'operator'
     or length(btrim(coalesce(p_authorization->>'actorName', ''))) = 0 then
    raise exception 'authorization is not bound to the exact package scope, SHA, and operator';
  end if;

  perform 1
  from public.content_periods cp
  where cp.id = v_period_id and cp.firm_id = v_firm_id
  for update;
  if not found then raise exception 'content period does not belong to package firm'; end if;

  select * into v_existing_operation
  from public.drg_package_staging_operations o
  where o.idempotency_key = v_idempotency_key
  for share;
  if found then
    if v_existing_operation.authorization_payload <> p_authorization
       or v_existing_operation.firm_id <> v_firm_id
       or v_existing_operation.period_id <> v_period_id
       or v_existing_operation.package_id <> v_package_id
       or v_existing_operation.package_version <> v_package_version
       or v_existing_operation.package_sha256 <> v_package_sha
       or v_existing_operation.package_canonical <> p_package_canonical
       or v_existing_operation.pdf_evidence <> p_pdf_evidence then
      raise exception 'idempotency replay drifted from the committed authorization or package';
    end if;
    return jsonb_set(
      jsonb_set(v_existing_operation.receipt, '{replay}', 'true'::jsonb, true),
      '{writesPerformed}', '0'::jsonb, true
    );
  end if;

  if exists (select 1 from public.drg_package_staging_operations o where o.authorization_id = v_authorization_id) then
    raise exception 'authorization id was already consumed by another staging operation';
  end if;
  if v_authorized_at > clock_timestamp() + interval '5 minutes'
     or v_expires_at <= clock_timestamp()
     or v_expires_at <= v_authorized_at then
    raise exception 'authorization is future-dated, expired, or malformed';
  end if;

  for v_index in 1..16 loop
    v_piece := p_package->'pieces'->(v_index - 1);
    v_plan_action := p_plan->'actions'->(v_index - 1);
    v_deliverable_id := null;
    v_version_id := null;
    v_version_number := null;
    v_exact := false;
    v_expected_action := null;

    select d.id, d.title, d.locale, d.content_kind, d.deliverable_role,
           d.publication_destination, d.current_version_id,
           v.id as version_id, v.version_number, v.drg_package_id,
           v.drg_package_version, v.drg_package_sha256,
           v.drg_piece_sha256, v.drg_source_sha256
      into v_deliverable
      from public.content_deliverables d
      left join public.deliverable_versions v on v.id = d.current_version_id
      where d.firm_id = v_firm_id
        and d.period_id = v_period_id
        and d.drg_piece_id = v_piece_ids[v_index]
      for update of d;

    if not found then
      v_expected_action := 'add';
      if v_plan_action->>'action' is distinct from v_expected_action then
        raise exception 'stale plan for %: expected add', v_piece_ids[v_index];
      end if;
      insert into public.content_deliverables (
        firm_id, period_id, drg_piece_id, title, description, format,
        content_kind, status, locale, deliverable_role,
        publication_destination, created_by_role, created_by_id
      ) values (
        v_firm_id, v_period_id, v_piece_ids[v_index], v_piece->>'title',
        'Staged from immutable DRG package ' || v_package_id,
        v_formats[v_index], v_kinds[v_index], 'draft', v_locales[v_index],
        v_roles[v_index], v_destinations[v_index], 'operator', v_actor_id
      ) returning id into v_deliverable_id;
      v_version_number := 1;
      v_added := v_added + 1;
    else
      v_deliverable_id := v_deliverable.id;
      if v_deliverable.locale is distinct from v_locales[v_index]
         or v_deliverable.content_kind is distinct from v_kinds[v_index]
         or v_deliverable.deliverable_role is distinct from v_roles[v_index]
         or v_deliverable.publication_destination is distinct from v_destinations[v_index]
         or v_plan_action->>'deliverableId' is distinct from v_deliverable_id::text then
        raise exception 'deliverable scope/topology drift for %', v_piece_ids[v_index];
      end if;
      v_exact := v_deliverable.current_version_id is not null
        and v_deliverable.current_version_id = v_deliverable.version_id
        and v_deliverable.drg_package_id = v_package_id
        and v_deliverable.drg_package_version = v_package_version
        and v_deliverable.drg_package_sha256 = v_package_sha
        and v_deliverable.drg_piece_sha256 = v_piece->>'pieceSha256'
        and v_deliverable.drg_source_sha256 = v_piece->>'sourceSha256';
      if v_exact then
        v_expected_action := 'correct_skip';
        if v_deliverable.title is distinct from v_piece->>'title'
           or v_plan_action->>'action' is distinct from 'correct_skip'
           or v_plan_action->>'versionId' is distinct from v_deliverable.version_id::text
           or (v_plan_action->>'versionNumber')::integer is distinct from v_deliverable.version_number then
          raise exception 'exact-version identity or plan drift for %', v_piece_ids[v_index];
        end if;
        v_version_id := v_deliverable.version_id;
        v_version_number := v_deliverable.version_number;
        v_skipped := v_skipped + 1;
      else
        v_expected_action := 'new_version';
        if v_plan_action->>'action' is distinct from 'new_version'
           or (v_plan_action->>'priorVersionId') is distinct from
              (case when v_deliverable.version_id is null then null else v_deliverable.version_id::text end)
           or (v_plan_action->>'expectedVersionNumber')::integer is distinct from coalesce(v_deliverable.version_number, 0) + 1 then
          raise exception 'stale new-version plan for %', v_piece_ids[v_index];
        end if;
        v_version_number := coalesce(v_deliverable.version_number, 0) + 1;
        v_new_version := v_new_version + 1;
        update public.content_deliverables
          set title = v_piece->>'title', format = v_formats[v_index], updated_at = transaction_timestamp()
          where id = v_deliverable_id;
      end if;
    end if;

    if v_version_id is null then
      select evidence into v_pdf_evidence
      from jsonb_array_elements(p_pdf_evidence) evidence
      where evidence->>'pieceId' = v_piece_ids[v_index];
      -- The adapter computed the byte hash immediately before this call.
      -- Recheck the exact storage row identity/update token under the same
      -- transaction so an overwrite between byte verification and staging
      -- cannot silently substitute a different object.
      if v_kinds[v_index] = 'pdf' and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'firm-files'
          and o.name = v_piece->'payload'->>'storageKey'
          and o.id = (v_pdf_evidence->>'storageObjectId')::uuid
          and to_jsonb(o)->>'updated_at' = v_pdf_evidence->>'objectUpdatedAt'
      ) then
        raise exception 'PDF storage object identity changed after byte verification for %', v_piece_ids[v_index];
      end if;
      insert into public.deliverable_versions (
        deliverable_id, firm_id, version_number, body_html, storage_path,
        asset_mime, asset_size_bytes, asset_name, asset_sha256, note,
        created_by_role, created_by_id, drg_package_id, drg_package_version,
        drg_package_sha256, drg_piece_sha256, drg_source_sha256
      ) values (
        v_deliverable_id, v_firm_id, v_version_number,
        case when v_kinds[v_index] = 'text' then v_piece->'payload'->>'bodyHtml' else null end,
        case when v_kinds[v_index] = 'pdf' then v_piece->'payload'->>'storageKey' else null end,
        case when v_kinds[v_index] = 'pdf' then 'application/pdf' else null end,
        case when v_kinds[v_index] = 'pdf' then (v_piece->'payload'->>'byteSize')::integer else null end,
        case when v_kinds[v_index] = 'pdf' then v_piece->'payload'->>'filename' else null end,
        case when v_kinds[v_index] = 'pdf' then v_piece->'payload'->>'assetSha256' else null end,
        'Atomic DRG package staging ' || v_package_id || ' v' || v_package_version::text,
        'operator', v_actor_id, v_package_id, v_package_version,
        v_package_sha, v_piece->>'pieceSha256', v_piece->>'sourceSha256'
      ) returning id into v_version_id;

      update public.content_deliverables
        set current_version_id = v_version_id,
            status = 'in_review',
            approved_version_id = null,
            approved_at = null,
            updated_at = transaction_timestamp()
        where id = v_deliverable_id;
    end if;

    v_receipt_pieces := v_receipt_pieces || jsonb_build_array(jsonb_build_object(
      'pieceId', v_piece_ids[v_index],
      'action', v_expected_action,
      'deliverableId', v_deliverable_id,
      'versionId', v_version_id,
      'versionNumber', v_version_number,
      'pieceSha256', v_piece->>'pieceSha256'
    ));
  end loop;

  v_receipt := jsonb_build_object(
    'schemaVersion', 'drg-package-staging-receipt/v1',
    'operationId', v_operation_id,
    'idempotencyKey', v_idempotency_key,
    'authorizationId', v_authorization_id,
    'firmId', v_firm_id,
    'periodId', v_period_id,
    'packageId', v_package_id,
    'packageVersion', v_package_version,
    'packageSha256', v_package_sha,
    'committedAt', v_committed_at,
    'addedCount', v_added,
    'newVersionCount', v_new_version,
    'skippedCount', v_skipped,
    'pieces', v_receipt_pieces,
    'writesPerformed', v_added + v_new_version,
    'replay', false
  );

  insert into public.drg_package_staging_operations (
    id, idempotency_key, authorization_id, firm_id, period_id,
    package_id, package_version, package_sha256, package_canonical,
    authorization_payload, pdf_evidence, actor_role, actor_id, actor_name, authorized_at,
    expires_at, receipt, committed_at
  ) values (
    v_operation_id, v_idempotency_key, v_authorization_id, v_firm_id,
    v_period_id, v_package_id, v_package_version, v_package_sha,
    p_package_canonical, p_authorization, p_pdf_evidence, 'operator', v_actor_id,
    p_authorization->>'actorName', v_authorized_at, v_expires_at,
    v_receipt, v_committed_at
  );

  return v_receipt;
end;
$function$;

revoke all on function public.stage_drg_weekly_package_atomic(jsonb, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_drg_weekly_package_atomic(jsonb, text, jsonb, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
