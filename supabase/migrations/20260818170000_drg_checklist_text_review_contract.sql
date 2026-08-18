-- DRG Checklist review contract: the Deliverables record is full text and the
-- locale-matched PDF is an attachment on that same version.  The prior DR-122
-- function made decision tools PDF-only, which hid the substantive tool when
-- an embedded PDF could not render.
do $migration$
declare
  v_signature regprocedure := 'public.apply_drg_content_deployment(jsonb,text,text,jsonb,text,jsonb)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  v_old := 'if p_bundle->>''schemaVersion'' <> ''drg-deployment-bundle-v1'' then raise exception ''unsupported deployment bundle schema''; end if;';
  v_new := v_old || E'\n  if exists (select 1 from jsonb_array_elements(p_bundle->''pieces'') p where p->>''formatFamily'' = ''decision_tool'' and (p->>''contentKind'' <> ''text'' or length(p->>''bodyHtml'') < 5000)) then raise exception ''decision tools must be complete text Deliverables with separately attached PDFs''; end if;';
  if position(v_old in v_definition) = 0 then raise exception 'DRG deployment function schema guard changed; checklist migration requires review'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'if v_piece->>''contentKind'' = ''pdf'' then';
  v_new := 'if v_piece->>''formatFamily'' = ''decision_tool'' then';
  if position(v_old in v_definition) = 0 then raise exception 'DRG deployment function PDF selection changed; checklist migration requires review'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'case when v_piece->>''contentKind'' = ''pdf'' then ''application/pdf'' else null end';
  v_new := 'case when v_piece->>''formatFamily'' = ''decision_tool'' then ''application/pdf'' else null end';
  if position(v_old in v_definition) = 0 then raise exception 'DRG deployment function PDF mime binding changed; checklist migration requires review'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'case when v_piece->>''contentKind'' = ''pdf'' then (select (a->>''byteSize'')::integer from jsonb_array_elements(p_bundle->''assets'') a where a->>''storagePath'' = v_storage_path limit 1) else null end';
  v_new := 'case when v_piece->>''formatFamily'' = ''decision_tool'' then (select (a->>''byteSize'')::integer from jsonb_array_elements(p_bundle->''assets'') a where a->>''storagePath'' = v_storage_path limit 1) else null end';
  if position(v_old in v_definition) = 0 then raise exception 'DRG deployment function PDF size binding changed; checklist migration requires review'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'case when v_piece->>''contentKind'' = ''pdf'' then regexp_replace(v_storage_path, ''^.*/'', '''') else null end';
  v_new := 'case when v_piece->>''formatFamily'' = ''decision_tool'' then regexp_replace(v_storage_path, ''^.*/'', '''') else null end';
  if position(v_old in v_definition) = 0 then raise exception 'DRG deployment function PDF name binding changed; checklist migration requires review'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$migration$;

notify pgrst, 'reload schema';

create table if not exists public.drg_checklist_review_revisions (
  id uuid primary key,
  firm_id uuid not null references public.intake_firms(id),
  revision_key text not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (firm_id, revision_key)
);

alter table public.drg_checklist_review_revisions enable row level security;
revoke all on public.drg_checklist_review_revisions from public, anon, authenticated;
drop trigger if exists trg_block_drg_checklist_review_revisions_mutation on public.drg_checklist_review_revisions;
create trigger trg_block_drg_checklist_review_revisions_mutation
before update or delete on public.drg_checklist_review_revisions
for each row execute function public.block_append_only_mutation();

create or replace function public.apply_drg_checklist_review_revision(
  p_manifest jsonb,
  p_manifest_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_firm_id uuid := (p_manifest->>'firmId')::uuid;
  v_revision_key text := p_manifest->>'revisionKey';
  v_receipt_id uuid := (p_manifest->>'receiptId')::uuid;
  v_existing public.drg_checklist_review_revisions%rowtype;
  v_item jsonb;
  v_deliverable public.content_deliverables%rowtype;
  v_version_number integer;
  v_result jsonb;
begin
  if p_manifest->>'schemaVersion' <> 'drg-checklist-review-revision-v1' then raise exception 'unsupported checklist revision schema'; end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid checklist revision hash'; end if;
  if coalesce((p_manifest->>'publicationAuthorized')::boolean, true) or coalesce((p_manifest->>'notificationAuthorized')::boolean, true) then
    raise exception 'checklist review revision cannot authorize publication or notification';
  end if;
  if jsonb_array_length(p_manifest->'items') <> 2
     or (select count(distinct value->>'locale') from jsonb_array_elements(p_manifest->'items')) <> 2
     or exists (select 1 from jsonb_array_elements(p_manifest->'items') item where item->>'locale' not in ('en-CA','pt-BR'))
     then raise exception 'checklist review revision requires exactly EN and PT items'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_firm_id::text || ':' || v_revision_key, 0));
  select * into v_existing from public.drg_checklist_review_revisions where firm_id=v_firm_id and revision_key=v_revision_key;
  if found then
    if v_existing.manifest_sha256 <> p_manifest_sha256 then raise exception 'revision key already exists with different manifest bytes'; end if;
    return v_existing.result || jsonb_build_object('status','verified_noop','writesPerformed',0);
  end if;

  for v_item in select value from jsonb_array_elements(p_manifest->'items') loop
    if length(v_item->>'bodyHtml') < 5000 or v_item->>'bodySha256' !~ '^[0-9a-f]{64}$' then raise exception 'checklist revision body is incomplete or unbound'; end if;
    if v_item->>'assetMime' <> 'application/pdf' or (v_item->>'assetSizeBytes')::integer < 1000 then raise exception 'checklist revision requires a real PDF attachment'; end if;
    select * into v_deliverable from public.content_deliverables where id=(v_item->>'deliverableId')::uuid and firm_id=v_firm_id for update;
    if not found or v_deliverable.deliverable_role <> 'lead_magnet_pdf' or v_deliverable.locale <> v_item->>'locale' then raise exception 'checklist deliverable identity mismatch'; end if;
    if v_deliverable.current_version_id <> (v_item->>'expectedCurrentVersionId')::uuid then raise exception 'checklist current version changed; rebuild the revision manifest'; end if;
    if exists(select 1 from public.deliverable_versions where id=(v_item->>'newVersionId')::uuid) then raise exception 'checklist new version id collision'; end if;
    select coalesce(max(version_number),0)+1 into v_version_number from public.deliverable_versions where deliverable_id=v_deliverable.id;
    insert into public.deliverable_versions(id,deliverable_id,firm_id,version_number,body_html,storage_path,asset_mime,asset_size_bytes,asset_name,note,created_by_role)
    values ((v_item->>'newVersionId')::uuid,v_deliverable.id,v_firm_id,v_version_number,v_item->>'bodyHtml',v_item->>'storagePath',v_item->>'assetMime',(v_item->>'assetSizeBytes')::integer,v_item->>'assetName',v_item->>'note','operator');
    update public.content_deliverables set content_kind='text',current_version_id=(v_item->>'newVersionId')::uuid,status='in_review',approved_version_id=null,approved_at=null,updated_at=now() where id=v_deliverable.id;
  end loop;

  v_result := jsonb_build_object('status','applied','writesPerformed',5,'firmId',v_firm_id,'revisionKey',v_revision_key,'publicationAuthorized',false,'notificationAuthorized',false);
  insert into public.drg_checklist_review_revisions(id,firm_id,revision_key,manifest_sha256,manifest,result)
  values (v_receipt_id,v_firm_id,v_revision_key,p_manifest_sha256,p_manifest,v_result);
  return v_result;
end;
$$;

revoke all on function public.apply_drg_checklist_review_revision(jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_drg_checklist_review_revision(jsonb,text) to service_role;

notify pgrst, 'reload schema';
