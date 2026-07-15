-- Content Studio publishing evidence system, Workstream 5: publication
-- receipts. Append-only proof that a specific approved version was
-- actually published to a specific destination, and (when checked) that
-- the live result was verified.
--
-- Doctrine this table enforces directly:
--   "Published requires a receipt." A deliverable's own status/publish_date
--   is never itself proof; this table is the durable evidence record.
--   "A URL alone is not sufficient if it cannot be tied to the approved
--   version or artifact." approved_version_id is NOT NULL and scope-
--   validated against the same firm/deliverable as the placement.
--   "A later content version must not inherit an earlier version's
--   receipt as proof." Trivially true: a receipt binds to one exact
--   version_id at INSERT time and is never repointed (append-only).
--   "Corrections create new evidence or reconciliation records; they do
--   not silently alter history." reconciles_receipt_id links a later row
--   back to the one it corrects, forming a chain rather than an edit.
--
-- Same trigger pattern as publication_artifacts / content_placements:
-- validate-scope on insert, unconditional append-only block on
-- update/delete (reusing block_append_only_mutation from
-- 20260715130000_approval_records_append_only.sql, applied in this same
-- migration set).

create table if not exists public.publication_receipts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  period_id uuid references public.content_periods(id) on delete restrict,
  deliverable_id uuid not null references public.content_deliverables(id) on delete restrict,
  placement_id uuid not null references public.content_placements(id) on delete restrict,
  destination text not null,
  locale text,
  approved_version_id uuid not null references public.deliverable_versions(id) on delete restrict,
  artifact_id uuid references public.publication_artifacts(id) on delete restrict,
  artifact_sha256 text,
  public_url text,
  external_post_id text,
  published_at timestamptz not null,
  actor_role text not null check (actor_role in ('operator', 'lawyer', 'system')),
  actor_id uuid,
  actor_name text,
  verification_state text not null default 'unverified' check (
    verification_state in ('unverified', 'verified', 'failed', 'reconciling')
  ),
  verified_at timestamptz,
  verification_method text check (
    verification_method is null or verification_method in (
      'url_fetch', 'manual_screenshot', 'external_api', 'operator_attestation'
    )
  ),
  evidence_storage_bucket text,
  evidence_storage_path text,
  failure_reason text,
  reconciles_receipt_id uuid references public.publication_receipts(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint publication_receipts_sha256_format_check
    check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint publication_receipts_evidence_pair_check
    check ((evidence_storage_bucket is null) = (evidence_storage_path is null)),
  constraint publication_receipts_verification_pair_check
    check ((verified_at is null) = (verification_method is null)),
  constraint publication_receipts_locale_format_check
    check (locale is null or locale ~ '^[a-z]{2,3}-[A-Z]{2}$')
);

comment on table public.publication_receipts is
  'Append-only evidence that a specific approved deliverable version was published to a specific destination and (when checked) verified live. A deliverable is never "published" on status/date alone; a receipt is the durable proof. Never mutated after insert; a correction inserts a new row via reconciles_receipt_id.';

create index if not exists publication_receipts_deliverable_idx
  on public.publication_receipts (deliverable_id, destination);
create index if not exists publication_receipts_firm_created_idx
  on public.publication_receipts (firm_id, created_at desc);
create index if not exists publication_receipts_placement_idx
  on public.publication_receipts (placement_id);
create index if not exists publication_receipts_version_idx
  on public.publication_receipts (approved_version_id);

create or replace function public.validate_publication_receipt_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_deliverable_firm uuid;
  v_placement_firm uuid;
  v_placement_deliverable uuid;
  v_placement_destination text;
  v_version_deliverable uuid;
  v_version_firm uuid;
  v_artifact_firm uuid;
  v_artifact_deliverable uuid;
begin
  select firm_id into v_deliverable_firm
    from public.content_deliverables
   where id = new.deliverable_id;
  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

  select firm_id, deliverable_id, destination
    into v_placement_firm, v_placement_deliverable, v_placement_destination
    from public.content_placements
   where id = new.placement_id;
  if not found
     or v_placement_firm is distinct from new.firm_id
     or v_placement_deliverable is distinct from new.deliverable_id
     or v_placement_destination is distinct from new.destination then
    raise exception 'publication receipt must reference a placement from the same firm, deliverable, and destination';
  end if;

  select deliverable_id, firm_id into v_version_deliverable, v_version_firm
    from public.deliverable_versions
   where id = new.approved_version_id;
  if not found
     or v_version_deliverable is distinct from new.deliverable_id
     or v_version_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference an approved_version_id from the same firm and deliverable';
  end if;

  if new.artifact_id is not null then
    select firm_id, deliverable_id into v_artifact_firm, v_artifact_deliverable
      from public.publication_artifacts
     where id = new.artifact_id;
    if not found
       or v_artifact_firm is distinct from new.firm_id
       or v_artifact_deliverable is distinct from new.deliverable_id then
      raise exception 'publication receipt must reference an artifact_id from the same firm and deliverable';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_publication_receipt_scope on public.publication_receipts;
create trigger trg_validate_publication_receipt_scope
before insert on public.publication_receipts
for each row execute function public.validate_publication_receipt_scope();

drop trigger if exists trg_block_publication_receipt_mutation on public.publication_receipts;
create trigger trg_block_publication_receipt_mutation
before update or delete on public.publication_receipts
for each row execute function public.block_append_only_mutation();

alter table public.publication_receipts enable row level security;
alter table public.publication_receipts force row level security;
revoke all on public.publication_receipts from anon, authenticated, public;

notify pgrst, 'reload schema';
