-- Publication confirmation is intentionally separate from approval. An
-- approved deliverable is eligible to publish; published_at records that a
-- specific item is actually live. This preserves the standing-authorization
-- distinction in the client portal.
alter table public.content_deliverables
  add column if not exists published_at date;

comment on column public.content_deliverables.published_at is
  'Date this deliverable was confirmed live on its publication destination.';

update public.content_deliverables
set published_at = date '2026-07-22'
where id in (
  'd57c1204-1a9e-4577-b205-994f3a363a36',
  'f544114b-82e8-487a-9e34-a64ef6d8abfb',
  '6a168ab2-4ef5-42be-873a-10adc70e3f95',
  'f269d5df-16b5-4e21-9084-714596a374c1'
);
