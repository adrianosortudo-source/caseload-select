-- Content Studio: Content Performance / Content-to-Matter Attribution,
-- Phase 1 data model.
--
-- Evidence, not guessing. Every attribution fact is an append-only
-- observation (WHO recorded it, WHEN it was observed, WHAT evidence
-- backs it), never a mutable "current attribution" field on a lead. A
-- correction is a NEW row that supersedes an earlier one
-- (supersedes_evidence_id), the same pattern publication_receipts uses
-- for reconciliation (reconciles_receipt_id) -- corrections are new
-- rows, never edits.
--
-- This table reuses the existing canonical records rather than
-- duplicating them: screened_leads is the lead/intake subject,
-- content_deliverables/deliverable_versions/content_placements/
-- publication_receipts are the existing Content Studio publishing-
-- evidence chain, and client_matters (via source_screened_lead_id) is
-- the existing qualified-matter/outcome source of truth -- joined in
-- the content_attribution_current view below, never duplicated onto
-- this table.
--
-- Firm scoping follows the established service-role-only posture:
-- RLS enabled + forced, anon/authenticated/PUBLIC revoked, zero
-- policies. A BEFORE INSERT scope-validation trigger cross-checks
-- every optional FK (deliverable, version, placement, receipt)
-- belongs to the same firm_id and the same deliverable chain, mirroring
-- validate_content_placement_scope() / validate_publication_receipt_scope().

create table public.content_attribution_evidence (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  screened_lead_id uuid not null references public.screened_leads(id) on delete cascade,
  deliverable_id uuid references public.content_deliverables(id) on delete set null,
  deliverable_version_id uuid references public.deliverable_versions(id) on delete set null,
  placement_id uuid references public.content_placements(id) on delete set null,
  receipt_id uuid references public.publication_receipts(id) on delete set null,
  attribution_state text not null check (attribution_state in (
    'known_first_touch', 'known_assisted', 'self_reported', 'offline_referral', 'unknown'
  )),
  evidence_method text not null check (evidence_method in (
    'verified_utm', 'observed_referrer', 'verified_landing_path', 'self_report',
    'operator_offline_referral', 'imported_crm_outcome', 'insufficient_evidence'
  )),
  self_report_category text check (self_report_category in (
    'referral', 'search', 'social', 'ai_tool', 'event', 'existing_client', 'other'
  )),
  evidence_payload jsonb,
  evidence_note text,
  observed_at timestamptz not null,
  recorded_by_role text not null check (recorded_by_role in ('system', 'operator', 'lawyer')),
  recorded_by_id uuid references public.firm_lawyers(id) on delete set null,
  recorded_by_name text,
  supersedes_evidence_id uuid references public.content_attribution_evidence(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint content_attribution_evidence_self_report_category_chk
    check (self_report_category is null or evidence_method = 'self_report'),
  constraint content_attribution_evidence_unknown_pairing_chk
    check ((attribution_state = 'unknown') = (evidence_method = 'insufficient_evidence')),
  constraint content_attribution_evidence_version_requires_deliverable_chk
    check (deliverable_version_id is null or deliverable_id is not null)
);

comment on table public.content_attribution_evidence is
  'Append-only evidence ledger: this lead has this attribution state, backed by this provenance method, observed at this time. Never mutated -- a correction inserts a new row with supersedes_evidence_id pointing at the row it replaces. Never overwrite a stronger observed-evidence row with a weaker self-report; both are preserved as distinct evidence.';

create index content_attribution_evidence_firm_lead_idx
  on public.content_attribution_evidence (firm_id, screened_lead_id);
create index content_attribution_evidence_firm_deliverable_idx
  on public.content_attribution_evidence (firm_id, deliverable_id) where deliverable_id is not null;
create index content_attribution_evidence_firm_placement_idx
  on public.content_attribution_evidence (firm_id, placement_id) where placement_id is not null;
create index content_attribution_evidence_supersedes_idx
  on public.content_attribution_evidence (supersedes_evidence_id) where supersedes_evidence_id is not null;

create or replace function public.validate_content_attribution_evidence_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_lead_firm uuid;
  v_deliverable_firm uuid;
  v_version_deliverable uuid;
  v_placement_firm uuid;
  v_placement_deliverable uuid;
  v_receipt_firm uuid;
  v_receipt_placement uuid;
begin
  select firm_id into v_lead_firm
    from public.screened_leads
   where id = new.screened_lead_id;

  if not found or v_lead_firm is distinct from new.firm_id then
    raise exception 'content attribution evidence must reference a screened lead from the same firm';
  end if;

  if new.deliverable_id is not null then
    select firm_id into v_deliverable_firm
      from public.content_deliverables
     where id = new.deliverable_id;

    if not found or v_deliverable_firm is distinct from new.firm_id then
      raise exception 'content attribution evidence must reference a deliverable from the same firm';
    end if;
  end if;

  if new.deliverable_version_id is not null then
    select deliverable_id into v_version_deliverable
      from public.deliverable_versions
     where id = new.deliverable_version_id;

    if not found then
      raise exception 'content attribution evidence must reference an existing deliverable version';
    end if;

    if v_version_deliverable is distinct from new.deliverable_id then
      raise exception 'content attribution evidence deliverable_version_id must belong to deliverable_id';
    end if;
  end if;

  if new.placement_id is not null then
    select firm_id, deliverable_id into v_placement_firm, v_placement_deliverable
      from public.content_placements
     where id = new.placement_id;

    if not found or v_placement_firm is distinct from new.firm_id then
      raise exception 'content attribution evidence must reference a placement from the same firm';
    end if;

    if new.deliverable_id is not null and v_placement_deliverable is distinct from new.deliverable_id then
      raise exception 'content attribution evidence placement_id must belong to deliverable_id';
    end if;
  end if;

  if new.receipt_id is not null then
    select firm_id, placement_id into v_receipt_firm, v_receipt_placement
      from public.publication_receipts
     where id = new.receipt_id;

    if not found or v_receipt_firm is distinct from new.firm_id then
      raise exception 'content attribution evidence must reference a receipt from the same firm';
    end if;

    if new.placement_id is not null and v_receipt_placement is distinct from new.placement_id then
      raise exception 'content attribution evidence receipt_id must belong to placement_id';
    end if;
  end if;

  if new.supersedes_evidence_id is not null then
    if not exists (
      select 1 from public.content_attribution_evidence
       where id = new.supersedes_evidence_id
         and firm_id = new.firm_id
         and screened_lead_id = new.screened_lead_id
    ) then
      raise exception 'content attribution evidence supersedes_evidence_id must reference a prior row for the same firm and lead';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_content_attribution_evidence_scope on public.content_attribution_evidence;
create trigger trg_validate_content_attribution_evidence_scope
before insert on public.content_attribution_evidence
for each row execute function public.validate_content_attribution_evidence_scope();

drop trigger if exists trg_block_content_attribution_evidence_mutation on public.content_attribution_evidence;
create trigger trg_block_content_attribution_evidence_mutation
before update or delete on public.content_attribution_evidence
for each row execute function public.block_append_only_mutation();

alter table public.content_attribution_evidence enable row level security;
alter table public.content_attribution_evidence force row level security;
revoke all on public.content_attribution_evidence from anon, authenticated, public;

-- Derived "current attribution" view, per (firm, lead): the highest-
-- priority, most-recent, non-superseded evidence row, left-joined to
-- the existing qualified-matter outcome via client_matters.
-- Deliberately NOT a stored/materialized table -- there is no mutable
-- "current attribution" state to drift out of sync with the ledger;
-- this view is always exactly the ledger's own answer.
create or replace view public.content_attribution_current
with (security_invoker = true) as
select distinct on (e.firm_id, e.screened_lead_id)
  e.firm_id,
  e.screened_lead_id,
  e.id as evidence_id,
  e.deliverable_id,
  e.deliverable_version_id,
  e.placement_id,
  e.receipt_id,
  e.attribution_state,
  e.evidence_method,
  e.self_report_category,
  e.evidence_note,
  e.observed_at,
  e.created_at,
  cm.id as matter_id,
  cm.matter_stage
from public.content_attribution_evidence e
left join public.client_matters cm
  on cm.source_screened_lead_id = e.screened_lead_id
 and cm.firm_id = e.firm_id
where not exists (
  select 1 from public.content_attribution_evidence s
   where s.supersedes_evidence_id = e.id
)
order by
  e.firm_id, e.screened_lead_id,
  case e.attribution_state
    when 'known_first_touch' then 1
    when 'known_assisted' then 2
    when 'self_reported' then 3
    when 'offline_referral' then 4
    else 5
  end,
  e.observed_at desc,
  e.created_at desc;

comment on view public.content_attribution_current is
  'Derived, read-only: the best current evidence per lead, ranked known_first_touch > known_assisted > self_reported > offline_referral > unknown, most recent within a tier, excluding superseded rows. No stored state -- recomputed from content_attribution_evidence on every query.';

revoke all on public.content_attribution_current from anon, authenticated, public;

notify pgrst, 'reload schema';
