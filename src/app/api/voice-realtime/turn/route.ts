/**
 * POST /api/voice-realtime/turn?firmId=<uuid>
 *
 * Vapi custom LLM endpoint (OpenAI-compatible) for the Voice v2 realtime
 * loop (DR-048). Vapi POSTs the growing conversation messages array here
 * after each caller utterance; we return the bot's next spoken utterance
 * in OpenAI chat-completion shape.
 *
 * Configure in Vapi dashboard: Provider = Custom LLM, URL =
 * https://<host>/api/voice-realtime/turn?firmId=<uuid>.
 * The firmId query param routes to the correct intake_firms row so the
 * engine uses the right configuration.
 *
 * Authentication: Authorization: Bearer <VAPI_SERVER_SECRET>.
 * Requests without a valid bearer token are rejected with 401.
 *
 * Body shape (Vapi OpenAI-compatible):
 *   {
 *     model?: string,
 *     messages: Array<{ role: 'system'|'user'|'assistant', content: string }>,
 *     call?: {
 *       id: string,
 *       customer?: { number?: string },
 *       phoneNumber?: { number?: string },
 *     },
 *     stream?: boolean,
 *   }
 *
 * Response shape (OpenAI non-stream):
 *   {
 *     id: string,
 *     object: 'chat.completion',
 *     choices: [{ message: { role: 'assistant', content: string }, finish_reason: 'stop' }],
 *   }
 *
 * The endpoint always returns a non-streaming response. Streaming is not
 * used: the engine's LLM extraction call makes streaming the HTTP layer
 * irrelevant, and non-stream responses are simpler to debug.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import { handleVoiceTurn } from '@/lib/voice-realtime/turn-handler';
import type { VapiMessage } from '@/lib/voice-realtime/turn-handler';

// Bearer auth against VAPI_SERVER_SECRET. Fails CLOSED in production when the
// secret is unset (an unconfigured deploy must not accept public callers);
// allows local dev where the secret is typically absent.
function bearerOk(req: NextRequest): boolean {
  const secret = process.env.VAPI_SERVER_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface VapiBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  call?: {
    id?: string;
    customer?: { number?: string };
    phoneNumber?: { number?: string };
  };
  stream?: boolean;
}

function buildCompletion(content: string, finishReason: 'stop' | 'length' = 'stop') {
  return {
    id: `chatcmpl-voice-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'voice-realtime-v2',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: finishReason,
      },
    ],
  };
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  if (!bearerOk(req)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // ── firmId ────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const firmId = url.searchParams.get('firmId') ?? '';
  if (!firmId || !UUID_RE.test(firmId)) {
    return NextResponse.json(
      { error: 'firmId query param required (uuid)' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id, location')
    .eq('id', firmId)
    .maybeSingle();
  if (firmErr || !firm) {
    return NextResponse.json(
      { error: 'firm not found' },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const firmTimezone = resolveFirmTimezone({ location: firm.location as string | null });

  // ── Parse body ────────────────────────────────────────────────────────
  let body: VapiBody;
  try {
    body = (await req.json()) as VapiBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid JSON body' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const messages = (body.messages ?? []).filter(
    (m): m is VapiMessage =>
      typeof m.content === 'string' &&
      (m.role === 'user' || m.role === 'assistant' || m.role === 'system'),
  );

  // Codex re-audit F-04: previously, a missing body.call.id fell back to
  // `synthetic-{firmId}-{Date.now()}`, which made every malformed/replayed
  // call collide on a different fabricated key and defeated provider-id
  // idempotency. Reject in production; keep the synthetic key only in
  // development so local probes can still exercise the path.
  const rawCallId = (body.call?.id ?? '').trim();
  if (!rawCallId && process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'call.id is required for production realtime turns' },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const callId = rawCallId || `synthetic-${firmId}-${Date.now()}`;

  const callerPhone =
    body.call?.customer?.number ??
    body.call?.phoneNumber?.number ??
    null;

  // ── Engine turn ───────────────────────────────────────────────────────
  let result;
  try {
    result = await handleVoiceTurn({
      firmId,
      callId,
      messages,
      callerPhone: callerPhone ?? null,
      firmTimezone,
    });
  } catch (err) {
    console.error('[voice-realtime/turn] handleVoiceTurn failed:', err);
    return NextResponse.json(
      buildCompletion(
        "I'm sorry, I'm having a technical issue. Please hold while I connect you to the firm.",
      ),
      { status: 200, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    buildCompletion(result.utterance, result.done ? 'stop' : 'stop'),
    { status: 200, headers: CORS_HEADERS },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
