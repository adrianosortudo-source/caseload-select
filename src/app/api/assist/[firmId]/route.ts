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

  // Per-IP bucket. A per-firm daily ceiling is a documented followup
  // (BUILD_PLAN_firm_assist_v1.md section 6); the per-IP bucket alone
  // stops a single scripted client from running up the Gemini bill.
  const ip = ipFromRequest(req);
  const decision = await checkRateLimit('assist', `${firmId}:${ip}`);
  if (!decision.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate limited, try again shortly' },
      { status: 429, headers: { ...headers, ...rateLimitHeaders(decision) } },
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

  const exitResponse = buildExitResponse(genResult.response, pagesById);
  const latencyMs = Date.now() - startedAt;

  // Best-effort logging. Never blocks or fails the response to the visitor.
  try {
    const ua = req.headers.get('user-agent') ?? '';
    const salt = process.env.ASSIST_HASH_SALT ?? '';
    const visitorHash = createHash('sha256').update(`${ip}:${ua}:${salt}`).digest('hex');
    await supabase.from('assist_queries').insert({
      firm_id: firmId,
      question,
      intent: genResult.response.intent,
      answer_html: exitResponse.exit === 'answered' ? exitResponse.answer_html : null,
      source_page_ids: exitResponse.exit === 'answered' ? exitResponse.sources.map((s) => s.url) : [],
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
