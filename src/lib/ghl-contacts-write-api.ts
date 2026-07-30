/**
 * GHL contacts-write client (marketing lead-magnet capture path, e.g.
 * checklist downloads). Same per-firm auth shape as ghl-export-api.ts /
 * ghl-voice-ai-api.ts: a Private Integration Token
 * (intake_firms.ghl_contacts_write_token) plus intake_firms.ghl_location_id.
 * Deliberately a SEPARATE token from voice_api_token (least privilege):
 * that one is read-only (voice-ai-dashboard, conversations), this one can
 * create/update contacts and tags.
 *
 * Never throws; every call returns a structured ok/fail result, matching
 * the existing GHL client convention.
 *
 * IMPORTANT -- tags are never sent through upsertGhlContact(). GHL's
 * /contacts/upsert `tags` field OVERWRITES a contact's entire tag list
 * rather than adding to it. For a repeat visitor (a second checklist
 * download, or any tag GHL's own workflows or the operator added in the
 * meantime), that would silently wipe every existing tag. Tagging goes
 * through the separate, additive addGhlTags() call instead, which hits
 * POST /contacts/{id}/tags and only ever adds.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export type GhlWriteFailReason =
  | 'no_token'
  | 'no_location_id'
  | 'invalid_input'
  | 'http_error'
  | 'network_error'
  | 'bad_response_shape';

export type GhlWriteFailure = {
  ok: false;
  reason: GhlWriteFailReason;
  status?: number;
  detail?: string;
};

export type GhlUpsertContactResult =
  | { ok: true; contactId: string; isNew: boolean }
  | GhlWriteFailure;

export type GhlAddTagsResult = { ok: true } | GhlWriteFailure;

/** GHL writes custom fields by key, not by resolved field id (confirmed
 * against the GHL v2 contacts API: `customFields: [{ key, field_value }]`).
 * No customFields.readonly lookup step is needed at write time. */
export type GhlCustomFieldValue = { key: string; field_value: string };

async function ghlRequest(
  method: 'POST' | 'PUT',
  path: string,
  token: string,
  body: unknown,
): Promise<{ ok: true; body: unknown } | GhlWriteFailure> {
  let res: Response;
  try {
    res = await fetch(`${GHL_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, reason: 'network_error', detail: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => undefined);
    return { ok: false, reason: 'http_error', status: res.status, detail: detail?.slice(0, 500) };
  }
  try {
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, reason: 'bad_response_shape', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Creates or updates a contact by email (per the location's own
 * duplicate-contact setting). Does NOT touch tags -- see the module
 * header. Custom fields are written by key, so this works even before an
 * operator has looked up a field's internal id in the GHL UI.
 */
export async function upsertGhlContact(
  locationId: string | null | undefined,
  token: string | null | undefined,
  contact: {
    email: string;
    firstName?: string | null;
    source?: string;
    customFields?: GhlCustomFieldValue[];
  },
): Promise<GhlUpsertContactResult> {
  if (!token || !token.trim()) return { ok: false, reason: 'no_token' };
  if (!locationId || !locationId.trim()) return { ok: false, reason: 'no_location_id' };
  if (!contact.email || !contact.email.includes('@')) {
    return { ok: false, reason: 'invalid_input', detail: 'missing or invalid email' };
  }

  const body: Record<string, unknown> = {
    locationId: locationId.trim(),
    email: contact.email,
  };
  if (contact.firstName) body.firstName = contact.firstName;
  if (contact.source) body.source = contact.source;
  if (contact.customFields?.length) body.customFields = contact.customFields;

  const result = await ghlRequest('POST', '/contacts/upsert', token.trim(), body);
  if (!result.ok) return result;

  const root = result.body as Record<string, unknown> | null;
  const contactObj =
    root && typeof root === 'object' ? (root.contact as Record<string, unknown> | undefined) : undefined;
  const id = contactObj && typeof contactObj.id === 'string' ? contactObj.id : null;
  if (!id) {
    return { ok: false, reason: 'bad_response_shape', detail: describeShape(result.body) };
  }

  return { ok: true, contactId: id, isNew: root?.new === true };
}

/**
 * Sets custom field values on an existing contact via PUT /contacts/{id},
 * deliberately ISOLATED from upsertGhlContact.
 *
 * CONFIRMED live against DRG's real GHL account (2026-07-27): a custom
 * field key that is not already defined in the location's Settings >
 * Custom Fields does NOT error. The call returns 200 `succeeded: true`
 * and silently drops the unrecognised key -- the re-fetched contact comes
 * back with `customFields: []`. This is not a guess; it was observed
 * directly. So this function's ok:true does not mean the values actually
 * landed, only that GHL accepted the request; treat it as best-effort
 * enrichment, never as proof of persistence. Keeping this isolated from
 * upsertGhlContact means the contact and its tags are unaffected either
 * way. To make a given key actually persist, the field must be created in
 * the firm's GHL location first (Settings > Custom Fields); until then,
 * the authoritative record of that data is wherever the caller itself
 * durably wrote it (e.g. marketing_lead_consent_log), not GHL.
 */
export async function setGhlContactCustomFields(
  contactId: string | null | undefined,
  token: string | null | undefined,
  customFields: GhlCustomFieldValue[],
): Promise<GhlAddTagsResult> {
  if (!token || !token.trim()) return { ok: false, reason: 'no_token' };
  if (!contactId || !contactId.trim()) {
    return { ok: false, reason: 'invalid_input', detail: 'missing contactId' };
  }
  if (!customFields.length) return { ok: true };

  const result = await ghlRequest('PUT', `/contacts/${encodeURIComponent(contactId.trim())}`, token.trim(), {
    customFields,
  });
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Adds tags to an existing contact. Additive only -- never removes or
 * replaces the contact's current tags. Always use this for tagging,
 * never the `tags` field on upsertGhlContact.
 */
export async function addGhlTags(
  contactId: string | null | undefined,
  token: string | null | undefined,
  tags: string[],
): Promise<GhlAddTagsResult> {
  if (!token || !token.trim()) return { ok: false, reason: 'no_token' };
  if (!contactId || !contactId.trim()) {
    return { ok: false, reason: 'invalid_input', detail: 'missing contactId' };
  }
  if (!tags.length) return { ok: true };

  const result = await ghlRequest('POST', `/contacts/${encodeURIComponent(contactId.trim())}/tags`, token.trim(), {
    tags,
  });
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Sets Do Not Disturb on the contact's Email channel via PUT /contacts/{id}.
 * CONFIRMED live against DRG's real GHL account (2026-07-27): unlike custom
 * fields, `dndSettings.Email` persists correctly and is read back verbatim.
 * This blocks ALL future email to the contact through GHL (workflow sends,
 * campaigns, and 2-way conversation), which is the correct scope for a CASL
 * unsubscribe request -- narrower per-workflow suppression (e.g. removing a
 * tag) would not stop other journeys from re-emailing the same contact.
 */
export async function setGhlContactEmailDnd(
  contactId: string | null | undefined,
  token: string | null | undefined,
  message: string,
): Promise<GhlAddTagsResult> {
  if (!token || !token.trim()) return { ok: false, reason: 'no_token' };
  if (!contactId || !contactId.trim()) {
    return { ok: false, reason: 'invalid_input', detail: 'missing contactId' };
  }

  const result = await ghlRequest('PUT', `/contacts/${encodeURIComponent(contactId.trim())}`, token.trim(), {
    dndSettings: { Email: { status: 'active', message } },
  });
  if (!result.ok) return result;
  return { ok: true };
}

function describeShape(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body;
  if (Array.isArray(body)) return `array[${body.length}]`;
  const root = body as Record<string, unknown>;
  return `{${Object.keys(root).slice(0, 10).join(', ')}}`;
}
