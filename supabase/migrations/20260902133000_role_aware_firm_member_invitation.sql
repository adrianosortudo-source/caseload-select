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
  request_url text;
begin
  if NEW.invitation_sent_at is not null then
    return NEW;
  end if;

  request_url := case
    when NEW.role = 'operator' then 'https://admin.caseloadselect.ca/api/operator/request-link'
    else 'https://app.caseloadselect.ca/api/portal/request-link'
  end;

  select net.http_post(
    url := request_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'User-Agent', 'pg_net/CaseLoadSelect-invitation'
    ),
    body := jsonb_build_object('email', NEW.email),
    timeout_milliseconds := 30000
  ) into request_id;

  if request_id is null then
    raise exception 'pg_net did not queue the invitation request';
  end if;

  -- This timestamp records successful enqueueing by pg_net, not downstream
  -- email delivery. The role-specific URL must therefore be routable before
  -- this migration is released.
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

-- Recreate the trigger idempotently so fresh-database CI and existing
-- environments both converge on the role-aware function.
drop trigger if exists trg_firm_lawyers_invite on public.firm_lawyers;
create trigger trg_firm_lawyers_invite
after insert on public.firm_lawyers
for each row
execute function public.fn_firm_lawyers_send_invitation();

comment on function public.fn_firm_lawyers_send_invitation() is
  'Queues role-aware magic-link invitations after firm_lawyers insert: operators use the admin origin; firm-side members use the app origin.';
