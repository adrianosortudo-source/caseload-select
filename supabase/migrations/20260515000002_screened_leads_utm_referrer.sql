-- Migration: 20260515_screened_leads_utm_referrer
--
-- Lead enrichment Phase 3 / Module 1. Captures passive web-attribution
-- signals already present in the HTTP request when a lead submits via the
-- web widget, but previously not persisted. The lawyer sees an "Inbound
-- context" line on the brief: day-of-week, local time, traffic source
-- (where they came from), and the search term they used if any. Zero new
-- questions are asked of the lead.
--
-- Six columns (Google's de-facto attribution standard: utm_source /
-- utm_medium / utm_campaign / utm_term / utm_content, plus a document
-- referrer). All nullable. Legacy rows and non-web channels (Voice,
-- Messenger, Instagram DM, WhatsApp) leave them NULL since UTM only
-- exists in a URL and those channels have no URL.

ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term     text,
  ADD COLUMN IF NOT EXISTS utm_content  text,
  ADD COLUMN IF NOT EXISTS referrer     text;

COMMENT ON COLUMN screened_leads.utm_source IS
  'UTM source — where the inbound came from (e.g. google, facebook, linkedin, newsletter). '
  'Captured at intake from the widget URL. NULL for non-web channels and legacy rows.';

COMMENT ON COLUMN screened_leads.utm_medium IS
  'UTM medium — channel type (e.g. cpc, social, email, referral). NULL when not set.';

COMMENT ON COLUMN screened_leads.utm_campaign IS
  'UTM campaign — the named campaign on the source. NULL when not set.';

COMMENT ON COLUMN screened_leads.utm_term IS
  'UTM term — the search keyword for paid-search inbound (e.g. "toronto immigration lawyer"). '
  'NULL when not set.';

COMMENT ON COLUMN screened_leads.utm_content IS
  'UTM content — ad variant or link identifier (e.g. "hero-cta-A"). NULL when not set.';

COMMENT ON COLUMN screened_leads.referrer IS
  'Document referrer or HTTP Referer at intake — the page that hosted the widget. '
  'NULL when no referrer was sent (direct visit) or for non-web channels.';

-- Reload PostgREST schema cache so the new columns are immediately visible.
NOTIFY pgrst, 'reload schema';
