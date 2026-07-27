-- Weekly Package Control Room: schema foundation.
--
-- Centralizes one firm/period's weekly content package -- required visual
-- assets, candidates, selected/rejected/superseded state, destination
-- renditions, hashes, portal bindings, QA evidence, and release-readiness --
-- as one view of a validated manifest, not a manually maintained parallel
-- list. Builds on the Publishing Package Gateway
-- (docs/publication-operator/publishing-package-gateway.md), whose narrow
-- hero-image endpoint remains the only write path onto
-- content_deliverables.hero_image_url; these tables never bypass it.
--
-- Four tables:
--   publishing_packages         one manifest per firm+period+revision
--   publishing_package_assets   every candidate/canonical/rendition/PDF/QA asset
--   publishing_package_events   append-only operation log + gateway receipts
--   publishing_package_checks   normalized preflight/QA results
--
-- Access model matches this schema's established convention (see
-- standing_publishing_authorizations, publication_receipts,
-- content_placements): RLS enabled + forced, ALL direct anon/authenticated/
-- PUBLIC access revoked, zero CREATE POLICY statements. Every table here is
-- born exposed to nothing; the app's own operator/lawyer/gateway-credential
-- permission split is enforced at the Next.js route layer (requireOperator,
-- requirePortalViewer, the gateway's own auth boundary) against a
-- service-role client, exactly like every other portal-facing table in this
-- codebase. This migration does not attempt a second, Postgres-role-based
-- authorization system alongside that one.
--
-- 'approved' is deliberately never a valid publishing_package_assets.status
-- value -- that word is reserved for the existing content_deliverables /
-- approval_records approval system. Visual selection here is a distinct,
-- weaker claim than legal approval; the UI must say so explicitly wherever
-- a candidate is selected.

-- ─── publishing_packages ────────────────────────────────────────────────────

create table public.publishing_packages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  period_id uuid not null references public.content_periods(id) on delete restrict,

  schema_version integer not null default 1,

  -- Carried on the manifest, not hardcoded per firm anywhere in application
  -- code: DRG's weekly package is 16, but this column is what any firm's
  -- package validates its piece count against.
  expected_piece_count integer not null,

  manifest_revision integer not null default 1,

  status text not null default 'draft' check (status in (
    'draft', 'assembling', 'in_review', 'release_blocked',
    'release_ready', 'published', 'superseded'
  )),

  -- The full validated package-manifest JSON (schema in
  -- publishing-package-manifest.ts's Control Room extension). Package
  -- status is never inferred from manifest contents or from
  -- content_deliverables approval state -- it is set explicitly by the
  -- operator workflow that owns each transition.
  manifest jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,

  constraint publishing_packages_firm_period_revision_key
    unique (firm_id, period_id, manifest_revision)
);

create index idx_publishing_packages_firm_period
  on public.publishing_packages (firm_id, period_id, manifest_revision desc);

-- ─── publishing_package_assets ──────────────────────────────────────────────

create table public.publishing_package_assets (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.publishing_packages(id) on delete cascade,

  -- Denormalized firm_id/period_id (also reachable via package_id) so every
  -- asset row is independently firm/period-scoped for query and audit
  -- purposes without a join, matching this schema's existing denormalization
  -- pattern on publication_placement_claims and publication_receipts.
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  period_id uuid not null references public.content_periods(id) on delete restrict,

  -- Stable string, not a foreign key: a content slot can exist in the
  -- manifest (and therefore need an asset requirement) before its
  -- deliverable_id is resolved.
  content_slot_id text not null,

  deliverable_id uuid references public.content_deliverables(id) on delete set null,
  source_version_id uuid references public.deliverable_versions(id) on delete set null,
  candidate_group_id uuid,

  locale text not null check (locale in ('en-CA', 'pt-BR')),
  destination text not null,

  asset_role text not null check (asset_role in (
    'website_article_hero', 'native_linkedin_article_cover', 'linkedin_post_card',
    'gbp_card', 'lead_magnet_document_hero', 'lead_magnet_landing_page_hero',
    'canonical_textless_master', 'pdf_document', 'rendered_qa_evidence'
  )),

  filename text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,

  -- Same 64-lowercase-hex-char shape the gateway itself enforces
  -- byte-for-byte (publishing-package-gateway.ts HERO_PACKAGE_UUID_RE /
  -- expected_sha256 handling) -- no case-normalization anywhere in this
  -- pipeline, hash mismatches are meant to be caught, not silently forgiven.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  storage_key text,
  alt_text text not null,

  text_policy text not null check (text_policy in (
    'textless', 'text_bearing', 'platform_rendered_text'
  )),
  overlay_language text,

  status text not null default 'required' check (status in (
    'required', 'missing', 'candidate', 'visually_selected', 'hash_verified',
    'uploaded', 'bound', 'rendered_verified', 'release_ready', 'blocked',
    'rejected', 'superseded', 'not_planned'
  )),

  is_selected boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint publishing_package_assets_dedup_key
    unique (package_id, sha256, destination, asset_role)
);

create index idx_publishing_package_assets_package_slot
  on public.publishing_package_assets (package_id, content_slot_id);
create index idx_publishing_package_assets_candidate_group
  on public.publishing_package_assets (candidate_group_id) where candidate_group_id is not null;
create index idx_publishing_package_assets_selected
  on public.publishing_package_assets (package_id, content_slot_id) where is_selected;

-- ─── publishing_package_events ──────────────────────────────────────────────
--
-- Append-only audit history and gateway receipts. Every material operation
-- (candidate registration, selection, hash verification, upload, bind,
-- rendered verification, block, reject, supersede, preflight run,
-- release-ready mark, publication receipt) produces exactly one row here.
-- A UI toast is never sufficient evidence on its own -- this table is.

create table public.publishing_package_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.publishing_packages(id) on delete cascade,
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  period_id uuid not null references public.content_periods(id) on delete restrict,
  content_slot_id text,
  asset_id uuid references public.publishing_package_assets(id) on delete set null,
  deliverable_id uuid references public.content_deliverables(id) on delete set null,

  event_type text not null check (event_type in (
    'manifest_created', 'manifest_revised', 'asset_required', 'candidate_registered',
    'candidate_selected', 'hash_verified', 'asset_uploaded', 'asset_bound',
    'rendered_verified', 'asset_blocked', 'asset_rejected', 'asset_superseded',
    'package_preflight_run', 'package_release_ready', 'publication_receipt_recorded'
  )),

  -- Not constrained to an enumerated list: the source prompt specifies this
  -- column without naming its allowed values (unlike event_type/asset_role/
  -- status above, which it enumerates explicitly). Constraining it here
  -- would be inventing a value set the spec never gave.
  actor_type text not null,
  actor_id uuid,

  operation_id uuid,

  -- Full required-fields receipt (operation id, package/period/firm/slot/
  -- deliverable/source-version/asset ids, filename, role, destination,
  -- locale, expected+computed hash, previous+resulting binding, actor,
  -- timestamp, outcome, failure reason) lives here as the durable record.
  receipt jsonb not null,

  created_at timestamptz not null default now()
);

create index idx_publishing_package_events_package
  on public.publishing_package_events (package_id, created_at desc);
create index idx_publishing_package_events_asset
  on public.publishing_package_events (asset_id) where asset_id is not null;

drop trigger if exists trg_block_publishing_package_events_mutation
  on public.publishing_package_events;
create trigger trg_block_publishing_package_events_mutation
before update or delete on public.publishing_package_events
for each row execute function public.block_append_only_mutation();

-- ─── publishing_package_checks ──────────────────────────────────────────────

create table public.publishing_package_checks (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.publishing_packages(id) on delete cascade,
  content_slot_id text not null,
  asset_id uuid references public.publishing_package_assets(id) on delete set null,

  -- Never-null discriminator for the dedup key below: 'piece' for a
  -- piece-level check with no single asset in scope, or the asset's own id
  -- (as text) for a check scoped to one specific asset. asset_id itself
  -- cannot serve this role -- Postgres treats NULL as distinct from NULL in
  -- a UNIQUE constraint, so a nullable column in the conflict target would
  -- make every preflight run's piece-level checks look like new, distinct
  -- rows instead of updates to the same row, and duplicates would
  -- accumulate on every run instead of upserting in place.
  asset_scope text not null default 'piece',

  check_key text not null,
  status text not null check (status in ('pass', 'fail', 'blocked', 'not_applicable')),
  severity text not null check (severity in (
    'critical', 'high', 'medium', 'low', 'informational'
  )),
  message text not null,
  evidence jsonb not null,

  checked_at timestamptz not null default now(),
  -- Not constrained to an enumerated list, same reasoning as
  -- publishing_package_events.actor_type above.
  checked_by_type text not null,
  checked_by_id uuid,

  constraint publishing_package_checks_dedup_key
    unique (package_id, content_slot_id, asset_scope, check_key)
);

create index idx_publishing_package_checks_package
  on public.publishing_package_checks (package_id, content_slot_id);

-- ─── RLS: enable + force + revoke all, zero policies ────────────────────────

alter table public.publishing_packages enable row level security;
alter table public.publishing_packages force row level security;
revoke all on public.publishing_packages from anon, authenticated, public;
grant all on public.publishing_packages to service_role;

alter table public.publishing_package_assets enable row level security;
alter table public.publishing_package_assets force row level security;
revoke all on public.publishing_package_assets from anon, authenticated, public;
grant all on public.publishing_package_assets to service_role;

alter table public.publishing_package_events enable row level security;
alter table public.publishing_package_events force row level security;
revoke all on public.publishing_package_events from anon, authenticated, public;
grant all on public.publishing_package_events to service_role;

alter table public.publishing_package_checks enable row level security;
alter table public.publishing_package_checks force row level security;
revoke all on public.publishing_package_checks from anon, authenticated, public;
grant all on public.publishing_package_checks to service_role;

notify pgrst, 'reload schema';
