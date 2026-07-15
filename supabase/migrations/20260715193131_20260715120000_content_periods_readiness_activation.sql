-- Publication Readiness remediation: explicit period lifecycle + database-
-- level activation invariant. DR-097 (revised after review -- see the
-- superseded design note at the bottom of this file).
--
-- The Founder Vesting backfill (20260714141535_publication_metadata.sql)
-- populated deliverable_role/locale/publication_destination/publication_path
-- for exactly one period. The readiness evaluator (publication-readiness.ts)
-- runs unconditionally over every non-archived deliverable regardless of
-- period, so every OTHER period's deliverables (13 active weeks predating
-- this feature) immediately failed role_and_locale_known and rendered as
-- red "Blocked" -- indistinguishable from a genuine, current publication
-- blocker. That is the bug this migration exists to prevent from recurring.
--
-- readiness_lifecycle is an explicit, three-state classification -- NOT a
-- boolean or a nullable timestamp wearing three hats:
--
--   legacy_unreconciled -> this period is a batch of PRE-EXISTING content
--     that predates the readiness ledger and has been explicitly reviewed
--     and classified as legacy (see the inventory migration,
--     20260715124000_content_periods_lifecycle_inventory.sql). Its
--     deliverables render as "Historical -- not reconciled", never red
--     "Blocked", regardless of missing metadata. This is an explicit,
--     reviewed classification, never inferred from a date comparison: a
--     period whose end date is in the past is not automatically legacy (a
--     stalled, wholly-unapproved backlog is not "already published legacy
--     content" merely because its calendar week has passed), and a period
--     whose end date is in the future is not automatically safe to label
--     anything else (a period could in principle be marked legacy if it
--     were, say, imported wholesale from an old system).
--
--   setup_required -> the default for every period going forward and for
--     every existing period not explicitly classified as legacy: current
--     work, future work, and stalled/unapproved backlogs alike. This is
--     what the Founder Vesting period (the CURRENT publishing week,
--     already fully metadata-complete) is today, and what it stays until
--     an operator explicitly activates it -- it is emphatically not
--     historical. Deliverables render "Setup required" while their period
--     is in this state; that is a calm, non-alarming label, not red
--     "Blocked", but it is also not "everything is fine" -- it means the
--     period has not yet passed activation.
--
--   enforced -> the operator ran the activation preflight and every ACTIVE
--     deliverable in the period had role, locale, destination, and
--     placement set, and the database confirmed it atomically (see the
--     trigger below). From this point on, "Blocked" means a genuine,
--     current publication requirement failed, not an absent legacy field.
--
-- readiness_enforced_at remains a plain audit timestamp: WHEN activation
-- happened, nothing more. It carries no branching logic of its own; a
-- CHECK constraint below keeps it in lockstep with the lifecycle column
-- (set if and only if lifecycle = 'enforced') so the two columns can never
-- drift apart or be read inconsistently by future code.

alter table public.content_periods
  add column if not exists readiness_lifecycle text
    not null default 'setup_required',
  add column if not exists readiness_enforced_at timestamptz;

alter table public.content_periods
  drop constraint if exists content_periods_readiness_lifecycle_check,
  add constraint content_periods_readiness_lifecycle_check
    check (readiness_lifecycle in ('legacy_unreconciled', 'setup_required', 'enforced'));

alter table public.content_periods
  drop constraint if exists content_periods_readiness_enforced_at_pair_check,
  add constraint content_periods_readiness_enforced_at_pair_check
    check ((readiness_lifecycle = 'enforced') = (readiness_enforced_at is not null));

comment on column public.content_periods.readiness_lifecycle is
  'Explicit, reviewed classification: legacy_unreconciled (pre-existing content, predates the readiness ledger, renders "Historical -- not reconciled") | setup_required (current/future/stalled work not yet activated, renders "Setup required", the default for every new period) | enforced (activation preflight passed; "Blocked" is now genuine). Never inferred from dates. See DR-097 and the period-inventory migration.';
comment on column public.content_periods.readiness_enforced_at is
  'Pure audit timestamp: when readiness_lifecycle transitioned to enforced. Carries no logic of its own; content_periods_readiness_enforced_at_pair_check keeps it in lockstep with readiness_lifecycle. Set only by activatePeriodReadiness (lib/deliverables.ts), enforced atomically by trg_validate_readiness_activation below.';

-- ---------------------------------------------------------------------------
-- Database-level activation invariant.
--
-- The application uses the Supabase service role for every write, so an
-- application-only preflight (SELECT to check, then UPDATE to activate) is
-- NOT sufficient: it is two round trips with a window between them, and
-- service-role access means no RLS policy is watching either statement.
-- These two triggers make both halves of the invariant atomic and make it
-- hold regardless of what writes the row (this app, a future admin script,
-- direct SQL against production).
-- ---------------------------------------------------------------------------

-- 1) Refuse to (re)set readiness_lifecycle = 'enforced' unless every ACTIVE
--    (non-archived) deliverable in the period already has role, locale,
--    destination set, AND -- for roles that have their own placement at
--    all -- that placement set. "Placement" is role-aware, matching
--    cta_target_path's split from publication_path
--    (20260715120200_content_deliverables_cta_target_path.sql): article /
--    landing_page / lead_magnet_pdf deliverables carry their OWN placement
--    in publication_path; gbp_post / social_post deliverables do not have
--    a known placement yet (their eventual GBP post id / LinkedIn
--    permalink is never recorded here), so publication_path is correctly
--    NULL for them and is not required. Runs inside the same statement as
--    the UPDATE that attempts activation, so there is no gap between
--    "checked" and "activated" for a concurrent write to land in.
create or replace function public.validate_readiness_activation()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_incomplete_count integer;
begin
  if new.readiness_lifecycle = 'enforced' then
    select count(*) into v_incomplete_count
    from public.content_deliverables d
    where d.period_id = new.id
      and d.status <> 'archived'
      and (
        d.deliverable_role is null
        or d.locale is null
        or d.publication_destination is null
        or (
          d.deliverable_role in ('article', 'landing_page', 'lead_magnet_pdf')
          and d.publication_path is null
        )
      );
    if v_incomplete_count > 0 then
      raise exception 'cannot activate readiness for period %: % active deliverable(s) missing role, locale, destination, or placement', new.id, v_incomplete_count;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validate_readiness_activation on public.content_periods;
create trigger trg_validate_readiness_activation
before insert or update on public.content_periods
for each row execute function public.validate_readiness_activation();

-- 2) Once a period is enforced, refuse any insert/update on
--    content_deliverables that would leave an ACTIVE deliverable in that
--    period metadata-incomplete -- whether by clearing a field on an
--    existing row, inserting a fresh incomplete row directly into an
--    enforced period, or moving an incomplete row into one via period_id.
--    Archived deliverables are exempt, matching the readiness evaluator's
--    own exclusion (evaluateDeliverableReadiness returns excluded=true for
--    archived rows before any requirement is even evaluated).
create or replace function public.validate_deliverable_metadata_for_enforced_period()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_lifecycle text;
begin
  if new.period_id is null or new.status = 'archived' then
    return new;
  end if;

  select readiness_lifecycle into v_lifecycle
  from public.content_periods
  where id = new.period_id;

  if v_lifecycle = 'enforced' and (
    new.deliverable_role is null
    or new.locale is null
    or new.publication_destination is null
    or (
      new.deliverable_role in ('article', 'landing_page', 'lead_magnet_pdf')
      and new.publication_path is null
    )
  ) then
    raise exception 'deliverable % is active in an enforced period (%) and must keep role, locale, destination, and placement set', new.id, new.period_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_deliverable_metadata_for_enforced_period on public.content_deliverables;
create trigger trg_validate_deliverable_metadata_for_enforced_period
before insert or update on public.content_deliverables
for each row execute function public.validate_deliverable_metadata_for_enforced_period();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Superseded design note (kept for the review record, not acted on further):
-- the first draft of this migration added ONLY a nullable
-- readiness_enforced_at timestamp and derived every display state from
-- "is it null". That collapsed every unactivated period -- current,
-- future, AND historical -- into "Historical, not reconciled", which is
-- wrong for the current or a future period (e.g. Founder Vesting, the
-- week actually being worked on right now). It also enforced the
-- activation invariant only in application code (a SELECT-then-UPDATE
-- pair), which the service-role write path does not protect against a
-- race or a bypass. This revision replaces that draft in place; nothing
-- from it was ever applied to production.
-- ---------------------------------------------------------------------------
