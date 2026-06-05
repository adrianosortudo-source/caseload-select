-- Adds a top-level audit link from a voice_callback_requests row to the
-- screened_leads row it was operator-promoted into. Workflow state, not
-- incidental metadata: a row is either un-promoted (NULL) or it points to
-- exactly one screened_lead.
--
-- Powers the `/api/admin/voice-callback/[id]/promote` route's idempotency
-- check (already-promoted → 409 with the existing screened_lead id) and
-- gives ops a single-column query for "which misrouted callbacks have been
-- recovered into the lawyer queue?".
--
-- Safety: ADD COLUMN nullable, no default backfill, idempotent. The reverse
-- link (screened_leads.slot_answers.voice_meta.recovered_from_callback)
-- already lives in JSONB on the receiving side; this column closes the
-- two-way audit linkage that the CLS reset called for.

alter table public.voice_callback_requests
  add column if not exists promoted_to_screened_lead uuid null
  references public.screened_leads(id)
  on delete set null;

comment on column public.voice_callback_requests.promoted_to_screened_lead is
  'Set to the screened_leads.id when an operator promotes this callback row '
  'via /api/admin/voice-callback/[id]/promote. Null when un-promoted. The '
  'reverse link lives at screened_leads.slot_answers.voice_meta.recovered_from_callback.';

-- Partial index so the "list un-promoted callbacks per firm" query stays
-- cheap as the table grows. Most ops scans want un-promoted rows only.
create index if not exists voice_callback_requests_unpromoted_idx
  on public.voice_callback_requests (firm_id, created_at desc)
  where promoted_to_screened_lead is null;
