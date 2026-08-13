-- 20260727221123_marketing_lead_consent_log.sql
--
-- RECONSTRUCTED 2026-07-31 — this file did not previously exist. See the
-- header of 20260727220613_intake_firms_ghl_contacts_write_token.sql for the
-- full explanation; in short: this version is in the production ledger and its
-- schema is live, but no file for it existed in any commit on any branch, and
-- that drift blocked `supabase db push` entirely. Do NOT resolve it with
-- `migration repair --status reverted` — the schema is genuinely live.
--
-- Reconstructed by reading the live production catalogue on 2026-07-31:
-- information_schema.columns, pg_constraint, pg_indexes, pg_class
-- (relrowsecurity/relforcerowsecurity), pg_policies, pg_trigger,
-- pg_get_functiondef, role_table_grants, obj_description. Not from memory.
--
-- Two details that are deliberate and must not be "tidied":
--
--   1. RLS is ENABLED and FORCED with ZERO policies. That is not an oversight
--      — it is a fail-closed lockdown. With RLS forced and no policy, only
--      BYPASSRLS roles (service_role) can read or write, including the table
--      owner. Adding any policy widens access to consent evidence.
--   2. anon and authenticated are REVOKED. Supabase's default privileges grant
--      new public tables to anon/authenticated automatically, so the revoke is
--      required to reproduce production rather than merely omitting a grant.
--
-- block_append_only_mutation() is NOT defined here: it already exists from
-- 20260715191156_20260715130000_approval_records_append_only.sql, which runs
-- earlier. guard_marketing_lead_consent_log_mutation() IS defined here,
-- because it exists nowhere else in this repository.

CREATE TABLE IF NOT EXISTS public.marketing_lead_consent_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL,
  email text NOT NULL,
  ghl_contact_id text,
  source text NOT NULL,
  asset text,
  locale text,
  consent_text_version text NOT NULL,
  basis_evidence jsonb,
  ip_address text,
  user_agent text,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_lead_consent_log_pkey PRIMARY KEY (id),
  CONSTRAINT marketing_lead_consent_log_firm_id_fkey
    FOREIGN KEY (firm_id) REFERENCES public.intake_firms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS marketing_lead_consent_log_firm_email_idx
  ON public.marketing_lead_consent_log USING btree (firm_id, email);

CREATE INDEX IF NOT EXISTS marketing_lead_consent_log_ghl_contact_idx
  ON public.marketing_lead_consent_log USING btree (ghl_contact_id)
  WHERE (ghl_contact_id IS NOT NULL);

-- Fail-closed: forced RLS with no policies. service_role only. See note above.
ALTER TABLE public.marketing_lead_consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_lead_consent_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_lead_consent_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_lead_consent_log TO service_role;

-- Append-only, with exactly one permitted mutation: the one-time backfill of
-- ghl_contact_id after the GHL upsert succeeds. Everything else is immutable.
CREATE OR REPLACE FUNCTION public.guard_marketing_lead_consent_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'marketing_lead_consent_log is append-only: rows may never be deleted';
  end if;

  if old.ghl_contact_id is not null then
    raise exception 'marketing_lead_consent_log.ghl_contact_id may only be set once';
  end if;
  if new.ghl_contact_id is null then
    raise exception 'marketing_lead_consent_log update must set ghl_contact_id (the only permitted mutation)';
  end if;
  if new.firm_id is distinct from old.firm_id
     or new.email is distinct from old.email
     or new.source is distinct from old.source
     or new.asset is distinct from old.asset
     or new.locale is distinct from old.locale
     or new.consent_text_version is distinct from old.consent_text_version
     or new.basis_evidence is distinct from old.basis_evidence
     or new.ip_address is distinct from old.ip_address
     or new.user_agent is distinct from old.user_agent
     or new.captured_at is distinct from old.captured_at
     or new.created_at is distinct from old.created_at then
    raise exception 'marketing_lead_consent_log rows are immutable except for the one-time ghl_contact_id backfill';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_guard_marketing_lead_consent_log_mutation
  ON public.marketing_lead_consent_log;
CREATE TRIGGER trg_guard_marketing_lead_consent_log_mutation
  BEFORE DELETE OR UPDATE ON public.marketing_lead_consent_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketing_lead_consent_log_mutation();

COMMENT ON TABLE public.marketing_lead_consent_log IS
  'Append-only (structurally guarded, see trigger) consent evidence for marketing lead-magnet captures (checklist downloads etc.) that intentionally do not get a screened_leads row. Sibling to consent_log, not a reuse of it (consent_log.subject_id is FK-locked to screened_leads). Written before the GHL contact upsert is attempted (write-ahead consent); ghl_contact_id is filled in after a successful upsert and null does not imply consent was not captured.';
