-- 20260727233602_marketing_lead_unsubscribes.sql
--
-- RECONSTRUCTED 2026-07-31 — this file did not previously exist. See the
-- header of 20260727220613_intake_firms_ghl_contacts_write_token.sql for the
-- full explanation; in short: this version is in the production ledger and its
-- schema is live, but no file for it existed in any commit on any branch, and
-- that drift blocked `supabase db push` entirely. Do NOT resolve it with
-- `migration repair --status reverted` — the schema is genuinely live.
--
-- Reconstructed by reading the live production catalogue on 2026-07-31, not
-- from memory. Same deliberate details as marketing_lead_consent_log:
-- RLS is ENABLED and FORCED with ZERO policies (fail-closed, service_role
-- only), and anon/authenticated are REVOKED because Supabase's default
-- privileges would otherwise grant them.
--
-- block_append_only_mutation() is not defined here — it already exists from
-- 20260715191156_20260715130000_approval_records_append_only.sql, which runs
-- earlier. This table uses it unmodified: strictly insert-only, no permitted
-- update path at all (unlike the consent log, which allows the one-time
-- ghl_contact_id backfill).

CREATE TABLE IF NOT EXISTS public.marketing_lead_unsubscribes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL,
  email text NOT NULL,
  ghl_contact_id text,
  source text NOT NULL DEFAULT 'welcome_email_footer'::text,
  ip_address text,
  user_agent text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_lead_unsubscribes_pkey PRIMARY KEY (id),
  CONSTRAINT marketing_lead_unsubscribes_firm_id_fkey
    FOREIGN KEY (firm_id) REFERENCES public.intake_firms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS marketing_lead_unsubscribes_firm_email_idx
  ON public.marketing_lead_unsubscribes USING btree (firm_id, email);

-- Fail-closed: forced RLS with no policies. service_role only. See note above.
ALTER TABLE public.marketing_lead_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_lead_unsubscribes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_lead_unsubscribes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_lead_unsubscribes TO service_role;

DROP TRIGGER IF EXISTS trg_block_marketing_lead_unsubscribes_mutation
  ON public.marketing_lead_unsubscribes;
CREATE TRIGGER trg_block_marketing_lead_unsubscribes_mutation
  BEFORE DELETE OR UPDATE ON public.marketing_lead_unsubscribes
  FOR EACH ROW EXECUTE FUNCTION public.block_append_only_mutation();

COMMENT ON TABLE public.marketing_lead_unsubscribes IS
  'Append-only CASL opt-out record for the marketing lead-magnet email path. Written when a recipient uses the unsubscribe link in a GHL workflow email; the actual suppression is enforced in GHL via dndSettings.Email, this table is the durable evidence that the request was received and acted on.';
