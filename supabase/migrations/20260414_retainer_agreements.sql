-- Retainer agreements — auto-generated on Band A/B OTP verification
-- DocuGenerate fills the PDF template; DocuSeal handles e-signature delivery.
-- Status lifecycle: generated → sent → viewed → signed | voided

create table if not exists retainer_agreements (
  id                         uuid primary key default gen_random_uuid(),
  session_id                 uuid,           -- intake_sessions.id
  firm_id                    uuid,           -- intake_firms.id

  -- Contact snapshot at generation time
  contact_name               text,
  contact_email              text,
  contact_phone              text,

  -- DocuGenerate output
  docugenerate_document_id   text,
  docugenerate_document_url  text,

  -- DocuSeal output
  docuseal_submission_id     text unique,
  docuseal_signing_url       text,

  -- Status
  status text not null default 'pending'
    check (status in ('pending', 'generated', 'sent', 'viewed', 'signed', 'voided')),

  -- Timestamps
  generated_at  timestamptz,
  sent_at       timestamptz,
  viewed_at     timestamptz,
  signed_at     timestamptz,
  voided_at     timestamptz,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index if not exists retainer_agreements_session_id_idx    on retainer_agreements(session_id);
create index if not exists retainer_agreements_firm_id_idx       on retainer_agreements(firm_id);
create index if not exists retainer_agreements_submission_id_idx on retainer_agreements(docuseal_submission_id);
create index if not exists retainer_agreements_status_idx        on retainer_agreements(status);
