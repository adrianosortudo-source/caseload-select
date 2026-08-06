-- CRM Migration Plan Phase 0 ("export contact + conversation history"), WP-8.
--
-- Read-only pull of a firm's GHL contacts + conversations into two raw-jsonb
-- tables. Reuses the existing intake_firms.voice_api_token (a GHL Private
-- Integration Token already scoped conversations.readonly per
-- ghl-voice-ai-api.ts) and intake_firms.ghl_location_id. No new token
-- column, no new GHL app/scope request.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ghl_export_contacts (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id       uuid        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  ghl_contact_id text       NOT NULL,
  raw           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  pulled_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ghl_export_contacts_firm_contact
  ON public.ghl_export_contacts (firm_id, ghl_contact_id);

CREATE TABLE IF NOT EXISTS public.ghl_export_conversations (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id             uuid        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  ghl_conversation_id text        NOT NULL,
  ghl_contact_id      text,
  raw                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  pulled_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ghl_export_conversations_firm_conv
  ON public.ghl_export_conversations (firm_id, ghl_conversation_id);

ALTER TABLE public.ghl_export_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_export_contacts      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.ghl_export_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_export_conversations FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.ghl_export_contacts      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.ghl_export_conversations FROM anon, authenticated, PUBLIC;

GRANT ALL ON public.ghl_export_contacts      TO service_role;
GRANT ALL ON public.ghl_export_conversations TO service_role;

COMMIT;
