/**
 * GHL read-only export client (WP-8, CaseLoad_CRM_Migration_Plan_v1.md Phase 0:
 * "Export contact + conversation history"). Same auth shape as
 * ghl-voice-ai-api.ts: a per-firm Private Integration Token
 * (intake_firms.voice_api_token) plus intake_firms.ghl_location_id. The
 * token's documented scopes already include conversations.readonly and
 * conversations/message.readonly (per that module's header); contacts.readonly
 * is a separate scope the operator may need to add before contacts export
 * actually returns data (this client reports that failure structurally
 * rather than guessing).
 *
 * Read-only. Never writes to GHL. Never throws: every call returns a
 * structured ok/fail result, matching the existing GHL client convention.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export type GhlFetchFailReason = 'no_token' | 'no_location_id' | 'http_error' | 'network_error' | 'bad_response_shape';

export type GhlContactsResult =
  | { ok: true; contacts: Array<{ id: string; raw: unknown }> }
  | { ok: false; reason: GhlFetchFailReason; status?: number; detail?: string };

export type GhlConversationsResult =
  | { ok: true; conversations: Array<{ id: string; contactId: string | null; raw: unknown }> }
  | { ok: false; reason: GhlFetchFailReason; status?: number; detail?: string };

async function ghlGet(
  path: string,
  token: string,
): Promise<{ ok: true; body: unknown } | { ok: false; reason: GhlFetchFailReason; status?: number; detail?: string }> {
  let res: Response;
  try {
    res = await fetch(`${GHL_API_BASE}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Version: GHL_API_VERSION, Accept: 'application/json' },
      cache: 'no-store',
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

/** Fetches up to `limit` contacts for a GHL location. */
export async function fetchGhlContacts(
  locationId: string | null | undefined,
  token: string | null | undefined,
  limit = 100,
): Promise<GhlContactsResult> {
  if (!token || !token.trim()) return { ok: false, reason: 'no_token' };
  if (!locationId || !locationId.trim()) return { ok: false, reason: 'no_location_id' };

  const result = await ghlGet(
    `/contacts/?locationId=${encodeURIComponent(locationId.trim())}&limit=${limit}`,
    token.trim(),
  );
  if (!result.ok) return result;

  const arr = extractArray(result.body, ['contacts']);
  if (!arr) return { ok: false, reason: 'bad_response_shape', detail: describeShape(result.body) };

  const contacts = arr
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ id: String(c.id ?? c._id ?? ''), raw: c }))
    .filter((c) => c.id);

  return { ok: true, contacts };
}

/** Fetches up to `limit` conversations for a GHL location, optionally scoped to one contact. */
export async function fetchGhlConversations(
  locationId: string | null | undefined,
  token: string | null | undefined,
  opts: { contactId?: string; limit?: number } = {},
): Promise<GhlConversationsResult> {
  if (!token || !token.trim()) return { ok: false, reason: 'no_token' };
  if (!locationId || !locationId.trim()) return { ok: false, reason: 'no_location_id' };

  const limit = opts.limit ?? 100;
  const contactParam = opts.contactId ? `&contactId=${encodeURIComponent(opts.contactId)}` : '';
  const result = await ghlGet(
    `/conversations/search?locationId=${encodeURIComponent(locationId.trim())}${contactParam}&limit=${limit}`,
    token.trim(),
  );
  if (!result.ok) return result;

  const arr = extractArray(result.body, ['conversations']);
  if (!arr) return { ok: false, reason: 'bad_response_shape', detail: describeShape(result.body) };

  const conversations = arr
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      id: String(c.id ?? c._id ?? ''),
      contactId: typeof c.contactId === 'string' ? c.contactId : null,
      raw: c,
    }))
    .filter((c) => c.id);

  return { ok: true, conversations };
}

function extractArray(body: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  for (const key of keys) {
    const v = root[key];
    if (Array.isArray(v)) return v;
  }
  return null;
}

function describeShape(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body;
  if (Array.isArray(body)) return `array[${body.length}]`;
  const root = body as Record<string, unknown>;
  return `{${Object.keys(root).slice(0, 10).join(', ')}}`;
}
