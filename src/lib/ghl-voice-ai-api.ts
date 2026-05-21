import 'server-only';

/**
 * GHL Voice AI Public API client.
 *
 * Why this exists: GHL's workflow custom values (e.g.
 * `{{transcript_generated.call_transcript}}`) DO NOT reliably expose the
 * verbatim transcript of a Voice AI call — variable resolution either
 * returns the literal placeholder, an empty string, or a paraphrase. The
 * canonical path for the verbatim transcript is the Voice AI Public API:
 *
 *   GET https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs
 *     ?locationId={ghl_location_id}
 *     &contactId={ghl_contact_id}
 *
 * Confirmed via empirical test 2026-05-21 PM: the LIST endpoint above
 * returns `callLogs[]` with the full verbatim `transcript` field inline.
 * The single-resource endpoint
 * `GET /voice-ai/dashboard/call-logs/{callLogId}` requires the dashboard
 * call-log id (not GHL contact id, not workflow-emitted call_id) and is
 * rejected with `422 "Call ID is invalid"` when fed the wrong id format.
 * Listing by contactId sidesteps that — the webhook delivers
 * `{{contact.id}}` reliably, the list returns the call with transcript
 * attached, no second round-trip required.
 *
 * Authenticated via a per-firm Private Integration Token (PIT) stored
 * in `intake_firms.voice_api_token`. Location ID stored in
 * `intake_firms.ghl_location_id` (migration
 * `20260521_intake_firms_ghl_location_id.sql`).
 *
 * Required PIT scopes:
 *   - voice-ai-dashboard.readonly
 *   - conversations.readonly
 *   - conversations/message.readonly
 *
 * Token rotation: directly UPDATE the column. No portal API to expose
 * the value. Tokens are SECRETs; never log values, never echo in
 * responses.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// GHL marketplace API uses a versioned date header.
const GHL_API_VERSION = '2021-04-15';

export type VoiceAITranscriptResult =
  | {
      ok: true;
      transcript: string;
      source: 'voice-ai-dashboard-list';
      callLogId?: string;
      callCreatedAt?: string;
      callDurationSec?: number;
      raw: unknown;
    }
  | {
      ok: false;
      reason:
        | 'no_token'
        | 'no_location_id'
        | 'no_contact_id'
        | 'http_error'
        | 'no_call_logs'
        | 'no_transcript_field'
        | 'empty_transcript'
        | 'network_error';
      status?: number;
      detail?: string;
    };

/**
 * Fetch the verbatim transcript of the most recent Voice AI call for a
 * given GHL contact.
 *
 * Lists call logs filtered by locationId + contactId, picks the most
 * recent entry (by `createdAt` desc; the API typically returns this
 * order but we sort defensively), and returns its `transcript` field.
 *
 * Returns the transcript text on success, or a structured failure
 * reason so the caller can decide whether to fall back to a paraphrase
 * (e.g. `{{contact.call_summary}}`) or persist to unconfirmed_inquiries.
 *
 * Best-effort: this function NEVER throws. Network errors, HTTP errors,
 * empty response, missing fields all return {ok: false, ...}.
 */
export async function fetchVoiceAITranscript(
  contactId: string | null | undefined,
  locationId: string | null | undefined,
  token: string | null | undefined,
): Promise<VoiceAITranscriptResult> {
  if (!contactId || !contactId.trim()) {
    return { ok: false, reason: 'no_contact_id' };
  }
  if (!locationId || !locationId.trim()) {
    return { ok: false, reason: 'no_location_id' };
  }
  if (!token || !token.trim()) {
    return { ok: false, reason: 'no_token' };
  }

  const url =
    `${GHL_API_BASE}/voice-ai/dashboard/call-logs` +
    `?locationId=${encodeURIComponent(locationId.trim())}` +
    `&contactId=${encodeURIComponent(contactId.trim())}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Version: GHL_API_VERSION,
        Accept: 'application/json',
      },
      // Don't cache. Each call is unique.
      cache: 'no-store',
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'network_error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!res.ok) {
    let detail: string | undefined;
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    return {
      ok: false,
      reason: 'http_error',
      status: res.status,
      // Truncate to keep telemetry compact; full body is rarely useful
      // and may contain auth-context noise.
      detail: detail ? detail.slice(0, 500) : undefined,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: 'http_error',
      detail: `non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const callLogs = extractCallLogs(body);
  if (callLogs === null || callLogs.length === 0) {
    return { ok: false, reason: 'no_call_logs', detail: describeShape(body) };
  }

  // Pick the most recent call. The API typically returns desc-by-createdAt
  // but we sort defensively because that contract isn't documented.
  const sorted = [...callLogs].sort((a, b) => {
    const ta = parseTimestamp(a.createdAt) ?? 0;
    const tb = parseTimestamp(b.createdAt) ?? 0;
    return tb - ta;
  });

  const latest = sorted[0];
  const transcript = (latest.transcript ?? '').trim();

  if (!transcript) {
    // No transcript on the latest call — could be a brand-new call that
    // GHL hasn't finished transcribing yet, or a hangup with no speech.
    // Still report no_transcript_field so the caller falls back.
    return {
      ok: false,
      reason: 'empty_transcript',
      detail: `callLogId=${latest.id ?? 'unknown'} duration=${latest.duration ?? 'unknown'}`,
    };
  }

  return {
    ok: true,
    transcript,
    source: 'voice-ai-dashboard-list',
    callLogId: latest.id,
    callCreatedAt: latest.createdAt,
    callDurationSec: latest.duration,
    raw: latest,
  };
}

interface NormalizedCallLog {
  id?: string;
  createdAt?: string;
  duration?: number;
  transcript?: string;
}

/**
 * Extract the callLogs array from the API response. The API returns:
 *
 *   { "callLogs": [ { contactId, fromNumber, createdAt, duration,
 *                     agentId, summary, transcript }, ... ] }
 *
 * Tolerates a few variant shapes (top-level array, `data.callLogs`,
 * etc.) so future schema tweaks don't silently break the path.
 */
function extractCallLogs(body: unknown): NormalizedCallLog[] | null {
  if (!body) return null;
  if (Array.isArray(body)) {
    return body.map(normalizeCallLog).filter(Boolean) as NormalizedCallLog[];
  }
  if (typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  for (const key of ['callLogs', 'call_logs', 'data', 'result', 'items']) {
    const v = root[key];
    if (Array.isArray(v)) {
      return v.map(normalizeCallLog).filter(Boolean) as NormalizedCallLog[];
    }
    // Sometimes containers wrap the array one level deeper.
    if (v && typeof v === 'object') {
      const nested = v as Record<string, unknown>;
      for (const innerKey of ['callLogs', 'call_logs', 'items']) {
        const iv = nested[innerKey];
        if (Array.isArray(iv)) {
          return iv.map(normalizeCallLog).filter(Boolean) as NormalizedCallLog[];
        }
      }
    }
  }
  return null;
}

function normalizeCallLog(item: unknown): NormalizedCallLog | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const out: NormalizedCallLog = {};
  for (const k of ['id', 'callLogId', '_id']) {
    const v = obj[k];
    if (typeof v === 'string' && v) {
      out.id = v;
      break;
    }
  }
  for (const k of ['createdAt', 'created_at', 'dateAdded', 'date_added']) {
    const v = obj[k];
    if (typeof v === 'string' && v) {
      out.createdAt = v;
      break;
    }
  }
  for (const k of ['duration', 'callDuration', 'durationSec', 'duration_sec']) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.duration = v;
      break;
    }
  }
  for (const k of ['transcript', 'callTranscript', 'fullTranscript']) {
    const v = obj[k];
    if (typeof v === 'string') {
      out.transcript = v;
      break;
    }
  }
  // If we have nothing useful, skip the row entirely.
  if (!out.transcript && !out.id && !out.createdAt) return null;
  return out;
}

function parseTimestamp(s: string | undefined): number | null {
  if (!s) return null;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Describe an unknown body shape for telemetry, without leaking values.
 * Returns a short string like "{callLogs: array[3], status: 'completed'}".
 */
function describeShape(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body;
  if (Array.isArray(body)) return `array[${body.length}]`;
  const root = body as Record<string, unknown>;
  const keys = Object.keys(root).slice(0, 10);
  const summary = keys.map((k) => {
    const v = root[k];
    const t = Array.isArray(v) ? `array[${v.length}]` : typeof v;
    return `${k}:${t}`;
  });
  return `{${summary.join(', ')}}`;
}
