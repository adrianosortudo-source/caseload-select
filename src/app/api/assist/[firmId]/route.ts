/**
 * POST /api/assist/[firmId]
 *
 * Public, cross-origin answer endpoint for Firm Assist (DR-100, DR-102).
 * Called directly from a firm's own website (a different origin than
 * app.caseloadselect.ca), so this route handles CORS itself rather than
 * relying on the iframe-embed pattern the rest of the app uses.
 *
 * Pipeline: CORS check -> validate -> rate limit -> embed question ->
 * retrieve top-k chunks -> single Gemini call -> map intent to a fixed-copy
 * exit shape -> log to assist_queries (best-effort) -> respond.
 *
 * DR-100: never answers outside the retrieved chunks. DR-102: never writes
 * to any intake table; the only conversion path is the Screen handoff copy
 * returned to the frontend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from '@/lib/rate-limit';
import { embedQuery } from '@/lib/assist/gemini-embed';
import { retrieveChunks } from '@/lib/assist/retrieve';
import { generateAnswer } from '@/lib/assist/generate-answer';
import { validateQuestion, resolveAllowedOrigin, buildExitResponse, type SourcePage } from '@/lib/assist/answer-route-pure';
import { loadFirmAssistConfig } from '@/lib/assist/firm-config';

export const dynamic = 'force-dynamic';

// Fail-closed per-firm daily ceiling (Ses.18 audit F1). Per-IP rate limiting
// alone does not stop abuse: it fails open when Upstash is unconfigured
// (the current posture), and a distributed script can rotate IPs anyway.
// This ceiling is enforced against assist_queries directly, so it holds
// regardless of the Upstash env vars.
const DEFAULT_DAILY_CEILING = 500;

function dailyCeiling(): number {
  const raw = process.env.ASSIST_DAILY_CEILING;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_CEILING;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export async function OPTIONS(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const originHeader = req.headers.get('origin');
  const firm = await loadFirmAssistConfig(firmId);
  const allowed = firm.found ? resolveAllowedOrigin(originHeader, firm.embedOrigins, firm.customDomain) : null;
  if (!allowed) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowed) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const originHeader = req.headers.get('origin');

  const firm = await loadFirmAssistConfig(firmId);
  if (!firm.found) {
    return NextResponse.json({ ok: false, error: 'firm not found' }, { status: 404 });
  }

  const allowedOrigin = resolveAllowedOrigin(originHeader, firm.embedOrigins, firm.customDomain);
  if (!allowedOrigin) {
    return NextResponse.json({ ok: false, error: 'origin not allowed' }, { status: 403 });
  }
  const headers = corsHeaders(allowedOrigin);

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400, headers });
  }

  const validation = validateQuestion(body.question);
  if (!validation.ok || !validation.question) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400, headers });
  }
  const question = validation.question;

  // Per-IP bucket. Fails open when Upstash is unconfigured (see the
  // fail-closed ceiling below, which does not depend on Upstash).
  const ip = ipFromRequest(req);
  const decision = await checkRateLimit('assist', `${firmId}:${ip}`);
  if (!decision.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate limited, try again shortly' },
      { status: 429, headers: { ...headers, ...rateLimitHeaders(decision) } },
    );
  }

  // Fail-closed per-firm daily ceiling (Ses.18 audit F1). Checked before
  // embedQuery so a capped request costs nothing. A count-query error is
  // logged and the request is allowed through: guard-rail infrastructure
  // failures never hard-block a public surface, but a successful count is
  // a hard cap.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: dailyCount, error: countErr } = await supabase
    .from('assist_queries')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId)
    .gte('created_at', since);
  if (countErr) {
    console.warn('[assist route] daily ceiling count query failed, allowing request:', countErr.message);
  } else if ((dailyCount ?? 0) >= dailyCeiling()) {
    return NextResponse.json(
      { ok: false, error: 'daily limit reached, try again tomorrow' },
      { status: 429, headers },
    );
  }

  const startedAt = Date.now();

  const embedResult = await embedQuery(question);
  if (embedResult.mode === 'disabled') {
    return NextResponse.json({ ok: false, error: 'assist is not configured for this deployment' }, { status: 503, headers });
  }
  if (embedResult.mode === 'error' || embedResult.vectors.length === 0) {
    return NextResponse.json({ ok: false, error: 'could not process the question, try again' }, { status: 502, headers });
  }

  const chunks = await retrieveChunks(firmId, embedResult.vectors[0]);

  const genResult = await generateAnswer(question, firm.firmName, chunks);
  if (genResult.mode === 'disabled') {
    return NextResponse.json({ ok: false, error: 'assist is not configured for this deployment' }, { status: 503, headers });
  }
  if (genResult.mode === 'error' || !genResult.response) {
    return NextResponse.json({ ok: false, error: 'could not generate an answer, try again' }, { status: 502, headers });
  }

  const pageIds = Array.from(new Set(chunks.map((c) => c.page_id)));
  const { data: pageRows } = await supabase
    .from('assist_corpus_pages')
    .select('id, title, url')
    .in('id', pageIds.length > 0 ? pageIds : ['00000000-0000-0000-0000-000000000000']);
  const pagesById = new Map<string, SourcePage>(
    (pageRows ?? []).map((p) => [p.id as string, { id: p.id as string, title: p.title as string | null, url: p.url as string }]),
  );

  const exitResponse = buildExitResponse(genResult.response, pagesById, firm.customDomain);
  const latencyMs = Date.now() - startedAt;

  // Best-effort logging. Never blocks or fails the response to the visitor.
  // source_page_ids stores real assist_corpus_pages.id values (Ses.18 audit
  // F4; previously logged URLs into an id-named column). Filtered against
  // pagesById so a hallucinated id from the model can never land here.
  try {
    const ua = req.headers.get('user-agent') ?? '';
    const salt = process.env.ASSIST_HASH_SALT ?? '';
    const visitorHash = createHash('sha256').update(`${ip}:${ua}:${salt}`).digest('hex');
    const loggedPageIds = genResult.response.source_page_ids.filter((id) => pagesById.has(id));
    await supabase.from('assist_queries').insert({
      firm_id: firmId,
      question,
      intent: genResult.response.intent,
      answer_html: exitResponse.exit === 'answered' ? exitResponse.answer_html : null,
      source_page_ids: exitResponse.exit === 'answered' ? loggedPageIds : [],
      exit_type: exitResponse.exit,
      latency_ms: latencyMs,
      model: 'gemini-2.5-flash',
      visitor_hash: visitorHash,
    });
  } catch (err) {
    console.warn('[assist route] failed to log query:', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({ ok: true, ...exitResponse }, { headers });
}
