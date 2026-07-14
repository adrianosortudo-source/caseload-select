-- Publication Readiness, Workstream 1: explicit publication metadata.
--
-- content_deliverables today has no reliable way to say what LANGUAGE a
-- deliverable is in, what KIND of publication it is (article vs. social
-- post vs. lead-magnet PDF vs. landing page), where it is meant to go
-- live, or what its own publish path is. Everything downstream (Publication
-- Readiness, the release manifest) needs this to be queryable, not inferred
-- from a title string at read time.
--
-- Design notes:
--   - locale is a free BCP-47-shaped string (format-checked, not an
--     enumerated list) so a future firm can use a locale this firm never
--     has without a migration. en-CA / pt-BR are the two in use today.
--   - deliverable_role and publication_destination ARE constrained text
--     (CHECK, not a Postgres enum, matching this repo's existing
--     convention on content_kind/status/format). Both lists are expected
--     to widen over time via a small additive migration, the same way
--     webhook_outbox's action CHECK was widened in
--     20260609_webhook_outbox_action_check_expand.sql. That is a deliberate,
--     reviewable event, not a design flaw.
--   - publication_destination is a DESTINATION TYPE (firm_website /
--     linkedin / google_business_profile), not a literal domain. A firm's
--     actual domain, and the deliverable's own path within it, live in
--     publication_path. This is the one deliberate refinement on the
--     original "destinations: drglaw.ca" framing: encoding one firm's
--     domain into a shared taxonomy value would force a new CHECK value
--     (a migration) for every future firm's own domain, which is exactly
--     what this workstream exists to avoid.
--   - requires_legal_approval / requires_image / requires_file /
--     requires_localized_route are NULLABLE per-row OVERRIDES, not the
--     primary source of truth. The requirement-profile system (Workstream
--     3, application code) derives the real requirement set from
--     deliverable_role + locale + destination. A row only sets one of
--     these columns when it is a genuine, reviewed exception to its role's
--     default profile. NULL means "use the profile default for this
--     role." This keeps one source of truth (the code profile) while still
--     giving the four columns the spec asked for as explicit, queryable,
--     per-row facts.
--   - There is deliberately no stored "metadata_incomplete" column. Whether
--     a deliverable's publication metadata is complete enough to evaluate
--     is a DERIVED readiness reason (Workstream 4), computed at read time
--     from whether locale/deliverable_role/publication_destination are
--     populated. Storing it as a column would create a value that can
--     silently drift from the columns it summarizes.

alter table public.content_deliverables
  add column if not exists locale text,
  add column if not exists deliverable_role text,
  add column if not exists publication_destination text,
  add column if not exists publication_path text,
  add column if not exists requires_legal_approval boolean,
  add column if not exists requires_image boolean,
  add column if not exists requires_file boolean,
  add column if not exists requires_localized_route boolean;

alter table public.content_deliverables
  drop constraint if exists content_deliverables_locale_format_check,
  add constraint content_deliverables_locale_format_check
    check (locale is null or locale ~ '^[a-z]{2,3}-[A-Z]{2}$');

alter table public.content_deliverables
  drop constraint if exists content_deliverables_role_check,
  add constraint content_deliverables_role_check
    check (
      deliverable_role is null or deliverable_role in (
        'article', 'social_post', 'gbp_post', 'lead_magnet_pdf', 'landing_page'
      )
    );

alter table public.content_deliverables
  drop constraint if exists content_deliverables_destination_check,
  add constraint content_deliverables_destination_check
    check (
      publication_destination is null or publication_destination in (
        'firm_website', 'linkedin', 'google_business_profile'
      )
    );

comment on column public.content_deliverables.locale is
  'BCP-47-shaped locale of this deliverable''s content (e.g. en-CA, pt-BR). Format-checked, not an enumerated list, so new locales never require a migration.';
comment on column public.content_deliverables.deliverable_role is
  'What kind of publication this is: article | social_post | gbp_post | lead_magnet_pdf | landing_page. Drives the requirement profile in application code (Workstream 3).';
comment on column public.content_deliverables.publication_destination is
  'Destination TYPE, not a literal domain: firm_website | linkedin | google_business_profile. A firm''s own domain and this deliverable''s path live in publication_path.';
comment on column public.content_deliverables.publication_path is
  'Intended publish path or identifier at the destination, e.g. /journal/founder-vesting-ontario or /resources/founder-vesting-checklist.pdf. Null until known.';
comment on column public.content_deliverables.requires_legal_approval is
  'Per-row override only. NULL means "use the deliverable_role''s profile default." A reviewed exception, never the primary source of truth.';
comment on column public.content_deliverables.requires_image is
  'Per-row override only. NULL means "use the deliverable_role''s profile default."';
comment on column public.content_deliverables.requires_file is
  'Per-row override only. NULL means "use the deliverable_role''s profile default."';
comment on column public.content_deliverables.requires_localized_route is
  'Per-row override only. NULL means "use the deliverable_role''s profile default," which is true whenever locale is not the firm''s default locale.';

create index if not exists content_deliverables_role_idx
  on public.content_deliverables (firm_id, deliverable_role)
  where deliverable_role is not null;
create index if not exists content_deliverables_locale_idx
  on public.content_deliverables (firm_id, locale)
  where locale is not null;
create index if not exists content_deliverables_destination_idx
  on public.content_deliverables (firm_id, publication_destination)
  where publication_destination is not null;
create index if not exists content_deliverables_period_role_idx
  on public.content_deliverables (period_id, deliverable_role)
  where period_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill: the 13 active deliverables in DRG Law's "Founder vesting"
-- period (2026-07-13 to 2026-07-17, firm eec1d25e-a047-4827-8e4a-6eb96becca2b).
-- Mapped by explicit deliverable id, confirmed against production before
-- writing this file (see the reconciliation done in-session). The one
-- archived GBP bundle in this theme (d6858ffb-b1bf-...-c08fa373f240's
-- sibling "[GBP POST] Founder vesting GBP cards") is NOT touched here; it
-- stays archived and out of every downstream readiness/manifest query by
-- virtue of its status, not by any special-case here.
-- ---------------------------------------------------------------------------

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/founder-vesting-forfeiture-clause'
where id = '0ba293e2-b1bf-4a15-849e-b7c3f298bff3';

update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '337dafb4-1795-40c7-b780-be04b46c7a42';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/founder-vesting-ontario'
where id = 'c98ef96c-bd75-4264-a78c-c286758f51ed';

update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '9546d2b8-c53a-4fd4-b6f9-5e57ca448d10';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = '/journal/founder-vesting-forfeiture-clause'
where id = 'a5b686e7-f631-4172-95ba-591d2de323fe';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = '/journal/founder-vesting-ontario'
where id = '387ef3df-11fe-482f-8ebd-d1025fbe7a88';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = '/resources/founder-vesting-checklist'
where id = '1c6df784-4a50-4035-8c9c-c08fa373f240';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/founder-vesting-checklist.pdf'
where id = '71939150-373f-45fb-a587-a7e3e176ec38';

update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = null
where id = 'ca60efdd-1960-4bf9-ba32-7edd5a7c3720';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/resources/founder-vesting-checklist'
where id = '044ab73b-b421-4162-9724-1e5a8203aed9';

update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = null
where id = '2b65e85a-58f8-4492-b1e1-5f8c1a7b91d9';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = '/journal/founder-vesting-ontario'
where id = '267180e2-8e95-474d-b76f-818e70caca74';

update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = '/journal/founder-vesting-forfeiture-clause'
where id = '1130161f-01bf-49ca-880d-c0af1aa0fe95';
