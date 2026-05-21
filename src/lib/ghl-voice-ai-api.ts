import 'server-only';

/**
 * GHL Voice AI Public API client.
 *
 * Why this exists: GHL's workflow custom values (e.g.
 * `{{transcript_generated.call_transcript}}`) DO NOT expose the
 * verbatim transcript of a Voice AI call. GHL's own AI assistant
 * confirmed this on 2026-05-21 PM. The only way to get the verbatim
 * transcript is the Voice AI Public API:
 *
 *   GET https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs/{callId}
 *
 * Authenticated via a per-firm Private Integration Token (PIT) stored
 * in `intake_firms.voice_api_token` (migration
 * `20260521_intake_firms_voice_api_token.sql`).
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
      source: 'voice-ai-dashboard';
      raw: unknown;
    }
  | {
      ok: false;
      reason:
        | 'no_token'
        | 'no_call_id'
        | 'http_error'
        | 'no_transcript_field'
        | 'empty_transcript'
        | 'network_error';
      status?: number;
      detail?: string;
    };

/**
 * Fetch the verbatim transcript of a Voice AI call by callId.
 *
 * Returns the transcript text on success, or a structured failure
 * reason so the caller can decide whether to fall back to a paraphrase
 * (e.g. `{{contact.call_summary}}`) or persist to unconfirmed_inquiries.
 *
 * Best-effort: this function NEVER throws. Network errors, HTTP errors,
 * empty response, missing fields all return {ok: false, ...}.
 */
export async function fetchVoiceAITranscript(
  callId: string | null | undefined,
  token: string | null | undefined,
): Promise<VoiceAITranscriptResult> {
  if (!callId || !callId.trim()) {
    return { ok: false, reason: 'no_call_id' };
  }
  if (!token || !token.trim()) {
    return { ok: false, reason: 'no_token' };
  }

  const url = `${GHL_API_BASE}/voice-ai/dashboard/call-logs/${encodeURIComponent(callId.trim())}`;

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

  const transcript = extractTranscriptFromCallLog(body);
  if (transcript === null) {
    return { ok: false, reason: 'no_transcript_field', detail: describeShape(body) };
  }
  if (transcript === '') {
    return { ok: false, reason: 'empty_transcript' };
  }

  return {
    ok: true,
    transcript,
    source: 'voice-ai-dashboard',
    raw: body,
  };
}

/**
 * Walks the call log response looking for the transcript field.
 *
 * GHL's response shape isn't fully documented in the public marketplace
 * docs; the field name might be `transcript`, `messages`, `segments`,
 * or under a nested `callLog.transcript`. This walker tries common
 * shapes in priority order. If GHL changes their schema, this is the
 * one place to update.
 *
 * Returns:
 *   - string: the verbatim transcript text (concatenated from segments
 *     if needed)
 *   - "": transcript field exists but is empty
 *   - null: no recognizable transcript field anywhere in the response
 */
function extractTranscriptFromCallLog(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;

  // Top-level direct string field
  const direct = pickString(root, ['transcript', 'callTranscript', 'fullTranscript']);
  if (direct !== undefined) return direct;

  // Nested under common containers
  const containers: Array<Record<string, unknown>> = [];
  for (const key of ['callLog', 'data', 'call', 'result']) {
    const v = root[key];
    if (v && typeof v === 'object') containers.push(v as Record<string, unknown>);
  }

  for (const c of containers) {
    const v = pickString(c, ['transcript', 'callTranscript', 'fullTranscript']);
    if (v !== undefined) return v;
  }

  // Array-of-segments shape: messages[] / transcript_segments[] / etc.
  const arrays: Array<unknown[]> = [];
  for (const obj of [root, ...containers]) {
    for (const key of ['messages', 'transcriptSegments', 'transcript_segments', 'turns', 'segments']) {
      const v = obj[key];
      if (Array.isArray(v)) arrays.push(v);
    }
  }

  for (const arr of arrays) {
    if (arr.length === 0) continue;
    const joined = joinSegments(arr);
    if (joined !== null) return joined;
  }

  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v.trim();
  }
  return undefined;
}

/**
 * Try to flatten an array of conversation segments into a single string.
 * Returns null if the shape isn't recognized.
 */
function joinSegments(arr: unknown[]): string | null {
  const lines: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      lines.push(item);
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const speaker = pickString(obj, ['speaker', 'role', 'speakerLabel']) ?? '';
      const text = pickString(obj, ['text', 'content', 'message', 'transcript']) ?? '';
      if (text) {
        lines.push(speaker ? `${speaker}: ${text}` : text);
      }
    }
  }
  if (lines.length === 0) return null;
  return lines.join('\n');
}

/**
 * Describe an unknown body shape for telemetry, without leaking values.
 * Returns a short string like "{callLog: object, status: 'completed'}".
 */
function describeShape(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body;
  const root = body as Record<string, unknown>;
  const keys = Object.keys(root).slice(0, 10);
  const summary = keys.map((k) => {
    const v = root[k];
    const t = Array.isArray(v) ? `array[${v.length}]` : typeof v;
    return `${k}:${t}`;
  });
  return `{${summary.join(', ')}}`;
}
