-- Widen deliverable_role and publication_destination to cover email
-- deliverables, for The DRG Law Minute (Content Studio v5.2 model).
--
-- 20260714141535_publication_metadata.sql's own design notes anticipated
-- exactly this: "Both lists are expected to widen over time via a small
-- additive migration, the same way webhook_outbox's action CHECK was
-- widened in 20260609_webhook_outbox_action_check_expand.sql. That is a
-- deliberate, reviewable event, not a design flaw."
--
-- content_placements.destination already includes 'email_delivery' (added
-- 20260715191218_20260715130100_content_placements.sql) for the newer
-- multi-destination model. The single-row legacy columns on
-- content_deliverables (deliverable_role, publication_destination) still
-- drive the existing Publication Readiness evaluator and have no email
-- value yet. This migration adds one to each, additive only, no existing
-- value removed or renamed.
--
-- NOT APPLIED. Prepared per the 2026-07-18 migration-lineage freeze
-- (docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md): no production
-- migration commands run until a human/data-engineer-approved remediation
-- design exists. This file is ready for that review; do not `supabase db
-- push` it before then.

alter table public.content_deliverables
  drop constraint if exists content_deliverables_role_check,
  add constraint content_deliverables_role_check
    check (
      deliverable_role is null or deliverable_role in (
        'article', 'social_post', 'gbp_post', 'lead_magnet_pdf', 'landing_page',
        'email_newsletter'
      )
    );

alter table public.content_deliverables
  drop constraint if exists content_deliverables_destination_check,
  add constraint content_deliverables_destination_check
    check (
      publication_destination is null or publication_destination in (
        'firm_website', 'linkedin', 'google_business_profile', 'email'
      )
    );

comment on column public.content_deliverables.deliverable_role is
  'What kind of publication this is: article | social_post | gbp_post | lead_magnet_pdf | landing_page | email_newsletter. Drives the requirement profile in application code (Workstream 3).';
comment on column public.content_deliverables.publication_destination is
  'Destination TYPE, not a literal domain: firm_website | linkedin | google_business_profile | email. A firm''s own domain and this deliverable''s path live in publication_path.';
