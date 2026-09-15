-- Preview-only QA session registry. This migration is deliberately not applied
-- by this change. The application fails closed until an isolated preview
-- database has this registry and the corresponding nonproduction env allowlist.

create table if not exists public.preview_qa_sessions (
  id uuid primary key,
  audience text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- A deployment receives one grant per automated browser session.  The nonce
-- is stored only as a hash, then consumed in the same transaction that issues
-- its corresponding QA session.
create table if not exists public.preview_qa_bootstrap_grants (
  id uuid primary key,
  nonce_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists preview_qa_sessions_active_idx
  on public.preview_qa_sessions (id, audience, expires_at)
  where revoked_at is null;

alter table public.preview_qa_sessions enable row level security;
alter table public.preview_qa_bootstrap_grants enable row level security;
revoke all on table public.preview_qa_sessions from anon, authenticated;
revoke all on table public.preview_qa_bootstrap_grants from anon, authenticated;

create or replace function public.consume_preview_qa_bootstrap_and_issue_session(
  p_id uuid,
  p_audience text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_previous_id uuid default null,
  p_previous_token_hash text default null,
  p_bootstrap_grant_id uuid default null,
  p_bootstrap_nonce_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  active_grant public.preview_qa_bootstrap_grants%rowtype;
begin
  if p_bootstrap_grant_id is null or p_bootstrap_nonce_hash is null then
    return false;
  end if;

  select * into active_grant
    from public.preview_qa_bootstrap_grants
    where id = p_bootstrap_grant_id
    for update;
  if not found
    or active_grant.consumed_at is not null
    or active_grant.expires_at <= now()
    or active_grant.nonce_hash <> p_bootstrap_nonce_hash then
    return false;
  end if;

  update public.preview_qa_bootstrap_grants
    set consumed_at = now()
    where id = p_bootstrap_grant_id and consumed_at is null;
  if not found then return false; end if;

  if p_previous_id is not null and p_previous_token_hash is not null then
    update public.preview_qa_sessions
      set revoked_at = now()
      where id = p_previous_id
        and audience = p_audience
        and token_hash = p_previous_token_hash
        and revoked_at is null;
  end if;

  insert into public.preview_qa_sessions (id, audience, token_hash, expires_at)
  values (p_id, p_audience, p_token_hash, p_expires_at);
  return true;
end;
$$;

create or replace function public.verify_preview_qa_session(
  p_id uuid,
  p_audience text,
  p_token_hash text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.preview_qa_sessions
     where id = p_id
       and audience = p_audience
       and token_hash = p_token_hash
       and expires_at > now()
       and revoked_at is null
  );
$$;

revoke all on function public.consume_preview_qa_bootstrap_and_issue_session(uuid, text, text, timestamptz, uuid, text, uuid, text) from public;
revoke all on function public.verify_preview_qa_session(uuid, text, text) from public;
grant execute on function public.consume_preview_qa_bootstrap_and_issue_session(uuid, text, text, timestamptz, uuid, text, uuid, text) to service_role;
grant execute on function public.verify_preview_qa_session(uuid, text, text) to service_role;
