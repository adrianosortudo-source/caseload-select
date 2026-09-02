-- Route automatic firm-member invitations through the role-specific login
-- surface. Operator links must be minted and consumed by the operator flow;
-- firm-side lawyer/admin/staff links continue through the lawyer portal flow.

create or replace function public.fn_firm_lawyers_send_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
  base_url text := 'https://app.caseloadselect.ca';
  request_path text;
begin
  if NEW.invitation_sent_at is not null then
    return NEW;
  end if;

  request_path := case
    when NEW.role = 'operator' then '/api/operator/request-link'
    else '/api/portal/request-link'
  end;

  select net.http_post(
    url := base_url || request_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'User-Agent', 'pg_net/CaseLoadSelect-invitation'
    ),
    body := jsonb_build_object('email', NEW.email),
    timeout_milliseconds := 30000
  ) into request_id;

  update public.firm_lawyers
     set invitation_sent_at = now()
   where id = NEW.id;

  return NEW;
exception when others then
  raise notice 'fn_firm_lawyers_send_invitation: error firing invitation: %', SQLERRM;
  return NEW;
end;
$$;

revoke all on function public.fn_firm_lawyers_send_invitation() from public, anon, authenticated;

comment on function public.fn_firm_lawyers_send_invitation() is
  'Sends role-aware magic-link invitations after firm_lawyers insert: operators use /api/operator/request-link; firm-side members use /api/portal/request-link.';
