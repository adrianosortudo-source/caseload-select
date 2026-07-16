/**
 * GET /api/assist/[firmId]/config
 *
 * Cheap pre-flight the frontend module calls before rendering itself.
 * Returns 200 { enabled: true } only when the firm has at least one
 * included corpus page AND a Gemini key is configured; every other case
 * (firm not found, no included pages, key missing, origin not allowed)
 * returns a non-200 so the module renders nothing (capability-gated UX,
 * same rule as the embedded widget's voice-capability check: no apology
 * sentence, just absence).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { resolveAllowedOrigin } from '@/lib/assist/answer-route-pure';
import { loadFirmAssistConfig } from '@/lib/assist/firm-config';

export const dynamic = 'force-dynamic';

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export async function OPTIONS(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const firm = await loadFirmAssistConfig(firmId);
  const allowed = firm.found ? resolveAllowedOrigin(req.headers.get('origin'), firm.embedOrigins, firm.customDomain) : null;
  if (!allowed) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowed) });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const firm = await loadFirmAssistConfig(firmId);
  if (!firm.found) {
    return NextResponse.json({ ok: false, enabled: false }, { status: 404 });
  }

  const allowedOrigin = resolveAllowedOrigin(req.headers.get('origin'), firm.embedOrigins, firm.customDomain);
  if (!allowedOrigin) {
    return NextResponse.json({ ok: false, enabled: false }, { status: 403 });
  }
  const headers = corsHeaders(allowedOrigin);

  const hasApiKey = Boolean(process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
  if (!hasApiKey) {
    return NextResponse.json({ ok: true, enabled: false }, { status: 200, headers });
  }

  const { count } = await supabase
    .from('assist_corpus_pages')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId)
    .eq('include', true);

  if (!count || count === 0) {
    return NextResponse.json({ ok: true, enabled: false }, { status: 200, headers });
  }

  return NextResponse.json({ ok: true, enabled: true }, { status: 200, headers });
}
