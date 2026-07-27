-- firm_onboarding_intake: client-list intake, two-path model (Firm Profile, Form 2, Section B).
-- Default path (share_with_us): the firm shares raw files; the operator cleans, imports to GHL,
-- verifies the import, then deletes the working copy and logs the deletion.
-- Exception path (self_upload): the firm declines to share and uploads to the CRM itself.
-- The legacy single-file customer_base_* columns stay for old rows; new submissions use these.

alter table public.firm_onboarding_intake
  add column if not exists client_list_path text
    check (client_list_path in ('share_with_us', 'self_upload')),
  add column if not exists client_list_files jsonb not null default '[]'::jsonb,
  add column if not exists client_list_attested_at timestamptz,
  add column if not exists client_list_self_upload_confirmed boolean not null default false,
  add column if not exists client_list_import_verified_at timestamptz,
  add column if not exists client_list_import_verified_note text,
  add column if not exists client_list_working_copy_deleted_at timestamptz;

comment on column public.firm_onboarding_intake.client_list_files is
  'Array of {storage_path, original_name, size_bytes, mime_type} in the firm-onboarding-docs bucket. Metadata survives working-copy deletion as the audit trail.';
comment on column public.firm_onboarding_intake.client_list_attested_at is
  'Set at submit time when the rep ticks the CASL consent-basis attestation. Required on both paths.';
comment on column public.firm_onboarding_intake.client_list_working_copy_deleted_at is
  'Set by the operator after the storage objects are removed following a verified import. The auditable PIPEDA delete-after-import record.';
