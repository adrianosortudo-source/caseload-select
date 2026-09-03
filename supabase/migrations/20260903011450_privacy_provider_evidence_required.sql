-- A provider-managed marker identifies where a copy may exist. It is not
-- evidence that the copy was deleted or that an approved retention procedure
-- has completed. Reopen any completion recorded under the earlier permissive
-- contract, then replace the service-only completion implementation so only
-- completed/not_applicable evidence can close a request.

update public.privacy_deletion_requests as request
   set external_cleanup_status = 'pending',
       external_cleanup_manifest = pg_catalog.jsonb_build_object(
         'version', 1,
         'storage_objects', '[]'::jsonb,
         'external_systems', pg_catalog.jsonb_build_object(
           'ghl', pg_catalog.jsonb_build_object(
             'status', case
               when request.cleanup_summary->>'ghl_status' in ('completed', 'not_applicable')
                 then request.cleanup_summary->>'ghl_status'
               else 'manual_required'
             end
           ),
           'meta', pg_catalog.jsonb_build_object(
             'status', case
               when request.cleanup_summary->>'meta_status' in ('completed', 'not_applicable')
                 then request.cleanup_summary->>'meta_status'
               else 'provider_managed'
             end
           ),
           'resend', pg_catalog.jsonb_build_object(
             'status', case
               when request.cleanup_summary->>'resend_status' in ('completed', 'not_applicable')
                 then request.cleanup_summary->>'resend_status'
               else 'provider_managed'
             end
           )
         )
       ),
       external_cleanup_completed_at = null,
       cleanup_summary = null,
       updated_at = pg_catalog.clock_timestamp()
 where request.external_cleanup_status = 'complete'
   and not (
     pg_catalog.coalesce(
       pg_catalog.jsonb_typeof(request.cleanup_summary->'ghl_status'),
       ''
     ) = 'string'
     and pg_catalog.coalesce(request.cleanup_summary->>'ghl_status', '')
       in ('completed', 'not_applicable')
     and pg_catalog.coalesce(
       pg_catalog.jsonb_typeof(request.cleanup_summary->'meta_status'),
       ''
     ) = 'string'
     and pg_catalog.coalesce(request.cleanup_summary->>'meta_status', '')
       in ('completed', 'not_applicable')
     and pg_catalog.coalesce(
       pg_catalog.jsonb_typeof(request.cleanup_summary->'resend_status'),
       ''
     ) = 'string'
     and pg_catalog.coalesce(request.cleanup_summary->>'resend_status', '')
       in ('completed', 'not_applicable')
   );

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
     or pg_catalog.coalesce(
       pg_catalog.jsonb_typeof(p_cleanup_summary->'ghl_status'),
       ''
     ) <> 'string'
     or pg_catalog.coalesce(p_cleanup_summary->>'ghl_status', '')
       not in ('completed', 'not_applicable')
     or pg_catalog.coalesce(
       pg_catalog.jsonb_typeof(p_cleanup_summary->'meta_status'),
       ''
     ) <> 'string'
     or pg_catalog.coalesce(p_cleanup_summary->>'meta_status', '')
       not in ('completed', 'not_applicable')
     or pg_catalog.coalesce(
       pg_catalog.jsonb_typeof(p_cleanup_summary->'resend_status'),
       ''
     ) <> 'string'
     or pg_catalog.coalesce(p_cleanup_summary->>'resend_status', '')
       not in ('completed', 'not_applicable') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'external_cleanup_status', 'pending',
      'error', 'cleanup_summary requires completed or not_applicable evidence for every provider; provider_managed is not completion evidence'
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
       coalesce(
         v_request.external_cleanup_manifest #>> '{external_systems,ghl,status}',
         ''
       ) not in ('manual_required', 'completed', 'not_applicable')
     )
     or (
       coalesce(
         v_request.external_cleanup_manifest #>> '{external_systems,meta,status}',
         ''
       ) not in ('provider_managed', 'completed', 'not_applicable')
     )
     or (
       coalesce(
         v_request.external_cleanup_manifest #>> '{external_systems,resend,status}',
         ''
       ) not in ('provider_managed', 'completed', 'not_applicable')
     )
     or (
       v_request.external_cleanup_manifest #>> '{external_systems,ghl,status}'
         in ('completed', 'not_applicable')
       and p_cleanup_summary->>'ghl_status'
         <> (v_request.external_cleanup_manifest #>> '{external_systems,ghl,status}')
     )
     or (
       v_request.external_cleanup_manifest #>> '{external_systems,meta,status}'
         in ('completed', 'not_applicable')
       and p_cleanup_summary->>'meta_status'
         <> (v_request.external_cleanup_manifest #>> '{external_systems,meta,status}')
     )
     or (
       v_request.external_cleanup_manifest #>> '{external_systems,resend,status}'
         in ('completed', 'not_applicable')
       and p_cleanup_summary->>'resend_status'
         <> (v_request.external_cleanup_manifest #>> '{external_systems,resend,status}')
     ) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'external_cleanup_status', 'pending',
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

revoke all privileges on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb)
  to service_role;

comment on function private.complete_screened_lead_external_cleanup_impl(uuid, uuid, jsonb) is
  'Service-only idempotent acknowledgement that every provider cleanup is completed or not applicable. A provider_managed location marker is not completion evidence. Clears the transitional selector manifest only after the closed evidence summary passes validation.';
