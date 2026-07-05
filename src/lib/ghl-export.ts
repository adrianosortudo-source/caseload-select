/**
 * I/O for the GHL read-only history export (WP-8). Reads a firm's
 * voice_api_token + ghl_location_id, pulls contacts and conversations via
 * ghl-export-api.ts, and upserts the raw payloads into ghl_export_contacts /
 * ghl_export_conversations. Read-only against GHL; never writes back to it.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { fetchGhlContacts, fetchGhlConversations } from '@/lib/ghl-export-api';

export interface GhlExportSummary {
  ok: boolean;
  contactsImported: number;
  conversationsImported: number;
  error?: string;
}

/**
 * Exports a firm's GHL contacts + conversations into the raw-jsonb tables.
 * Best-effort per resource: a contacts failure does not block the
 * conversations attempt. Returns ok:false only when BOTH fail, so a partial
 * export (e.g. contacts.readonly scope missing on the token) still reports
 * what it could reach.
 */
export async function exportGhlHistoryForFirm(firmId: string): Promise<GhlExportSummary> {
  const { data: firm } = await supabase
    .from('intake_firms')
    .select('voice_api_token, ghl_location_id')
    .eq('id', firmId)
    .maybeSingle();

  if (!firm) {
    return { ok: false, contactsImported: 0, conversationsImported: 0, error: 'firm not found' };
  }

  const token = (firm as { voice_api_token: string | null }).voice_api_token;
  const locationId = (firm as { ghl_location_id: string | null }).ghl_location_id;

  const contactsResult = await fetchGhlContacts(locationId, token);
  const conversationsResult = await fetchGhlConversations(locationId, token);

  let contactsImported = 0;
  if (contactsResult.ok && contactsResult.contacts.length > 0) {
    const rows = contactsResult.contacts.map((c) => ({
      firm_id: firmId,
      ghl_contact_id: c.id,
      raw: c.raw,
      pulled_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('ghl_export_contacts')
      .upsert(rows, { onConflict: 'firm_id,ghl_contact_id' });
    if (!error) contactsImported = rows.length;
  }

  let conversationsImported = 0;
  if (conversationsResult.ok && conversationsResult.conversations.length > 0) {
    const rows = conversationsResult.conversations.map((c) => ({
      firm_id: firmId,
      ghl_conversation_id: c.id,
      ghl_contact_id: c.contactId,
      raw: c.raw,
      pulled_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('ghl_export_conversations')
      .upsert(rows, { onConflict: 'firm_id,ghl_conversation_id' });
    if (!error) conversationsImported = rows.length;
  }

  if (!contactsResult.ok && !conversationsResult.ok) {
    return {
      ok: false,
      contactsImported: 0,
      conversationsImported: 0,
      error: `contacts: ${contactsResult.reason}; conversations: ${conversationsResult.reason}`,
    };
  }

  return { ok: true, contactsImported, conversationsImported };
}
