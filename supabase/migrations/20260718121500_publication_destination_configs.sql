-- PROPOSED, NOT APPLIED. Authored during the Publication Operator
-- architecture-review corrective pass (2026-07-18), in response to review
-- finding 3: "Destination concepts are conflated. The system needs
-- separate records for: Publishing account (website repository, LinkedIn
-- account/page, GBP location), Content destination (the external post/page
-- being created), CTA target (usually the firm's website article or
-- landing page)." CTA target resolution was already made independent of a
-- placement's own destination in this same corrective pass (see
-- resolveUrlAgainstBase(resolvedWebsiteBaseUrl, ...) in
-- publication-execution-manifest.ts). This migration addresses the
-- remaining half: a "publishing account" is currently never explicit
-- configuration, only inference from historical evidence (the most recent
-- validated webpage artifact, or a verified receipt) for firm_website, and
-- unconditionally "not configured" for every other destination because no
-- configuration surface exists at all.
--
-- This migration is NOT applied to production and this session did not run
-- it against any database, for the same reasons and under the same hard
-- safety boundary as the sibling corrective-pass migration
-- 20260718120000_publication_receipt_standing_authorization_release_path.sql
-- (no production database migrations or writes; the real-Postgres
-- integration gate remains unavailable in this session's environment). It
-- is committed as a reviewed artifact only.
--
-- Design: append-only, mirroring standing_publishing_authorizations'
-- proven shape in this same codebase (supabase/migrations/
-- 20260717230956_standing_publishing_authorization.sql) rather than a
-- plain mutable row -- a publishing-account identifier controls WHERE real
-- content would eventually be published, so silently overwriting it with
-- no audit trail is the wrong default for a corrective pass whose entire
-- premise is "stop inferring destinations, make them explicit and
-- accountable." "Current" configuration for a (firm, destination) pair is
-- always the latest row by config_seq, exactly like standing_publishing_
-- authorizations' event_seq. configured_by_role is fixed to 'operator':
-- destination configuration (which website repo, which LinkedIn page,
-- which GBP location) is operator technical setup per this app's own
-- "Operator Model" doctrine (CLAUDE.md: "Firm onboarding means Adriano's
-- setup checklist"), distinct from the LAWYER-only standing publishing
-- authorization decision it sits next to in the release pipeline.
create table public.publication_destination_configs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  destination text not null check (destination in (
    'firm_website', 'linkedin_article', 'linkedin_post', 'linkedin_company_page',
    'google_business_profile', 'email_delivery'
  )),
  -- Per-(firm_id, destination) ordering, byte-for-byte the same pattern as
  -- standing_publishing_authorizations.event_seq: a database identity
  -- column, not application-assigned, so two concurrent INSERTs can never
  -- race to the same sequence value.
  config_seq bigint generated always as identity,
  -- active=false records an explicit "unconfigure" event without deleting
  -- history -- e.g. a firm changes web host and the old identifier must
  -- stop being treated as the current publishing account, but the fact
  -- that it once was configured stays in the audit trail.
  active boolean not null default true,
  -- The publishing-account identifier itself: a website origin URL for
  -- firm_website, a LinkedIn organization/page URN for the two linkedin_*
  -- destinations, a GBP location resource name for google_business_
  -- profile, a verified sender address for email_delivery. Required even
  -- when active=false (the row still records what was being unconfigured).
  identifier text not null,
  label text,
  configured_by_role text not null default 'operator' check (configured_by_role = 'operator'),
  configured_by_id uuid,
  configured_by_name text,
  note text,
  created_at timestamptz not null default now(),
  unique (firm_id, destination, config_seq)
);

comment on table public.publication_destination_configs is
  'Append-only. Explicit, operator-set publishing-account configuration per (firm, destination) -- the account/page/location content would actually publish to, distinct from the CTA target a post promotes and distinct from the individual post/page being created. Current configuration for a (firm, destination) pair is the latest row (max config_seq) with active=true; see publication-execution-manifest-loader.ts resolveFirmDestinationConfig().';

create index publication_destination_configs_firm_destination_idx
  on public.publication_destination_configs (firm_id, destination, config_seq desc);

alter table public.publication_destination_configs enable row level security;
alter table public.publication_destination_configs force row level security;
revoke all on public.publication_destination_configs from anon, authenticated, public;

-- Append-only enforcement, reusing the existing shared trigger function
-- (already defined for content_attribution_evidence and other append-only
-- tables in this codebase; not redefined here).
create trigger publication_destination_configs_append_only
  before update or delete on public.publication_destination_configs
  for each row execute function public.block_append_only_mutation();
