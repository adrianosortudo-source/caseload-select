/**
 * POST /api/admin/prospecting-diagnostic/enrich
 *
 * Phase 1 prospect enrichment. Operator-only. The CLIENT runs the quick SEO
 * scan (reusing /api/tools/seo-check, which already owns the SSRF-protected
 * crawl) and POSTs a compact research packet here. This route is a thin LLM
 * interpretation layer: it builds a strict prompt over the packet, calls the
 * shared OpenRouter client, and defensively parses the structured result. It
 * touches nothing in the SEO engine and does no crawling of its own.
 *
 * Returns market + practice-area focus + alternate-domain hints with confidence
 * and evidence. Competitors are deliberately out of scope until the data source
 * is chosen (Phase 2).
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { openrouter, MODELS } from "@/lib/openrouter";
import {
  buildEnrichPrompt,
  parseEnrichment,
  type ProspectResearchPacket,
} from "@/app/admin/prospecting-diagnostic/_lib/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENRICH_MODEL = process.env.PROSPECT_ENRICH_MODEL ?? MODELS.MEMO;

export async function POST(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Operator session required." }, { status: 401 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { ok: false, reason: "llm_unavailable", error: "Enrichment is unavailable: OPENROUTER_API_KEY is not configured." },
      { status: 503 }
    );
  }

  let body: { packet?: ProspectResearchPacket };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const packet = body?.packet;
  if (!packet || typeof packet.primaryDomain !== "string" || !packet.primaryDomain) {
    return NextResponse.json({ ok: false, error: "Missing or invalid research packet." }, { status: 400 });
  }

  const { system, user } = buildEnrichPrompt(packet);

  let content: string;
  try {
    const completion = await openrouter.chat.completions.create({
      model: ENRICH_MODEL,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    content = completion.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ ok: false, error: `Enrichment model call failed: ${msg}` }, { status: 502 });
  }

  const enrichment = parseEnrichment(content);
  return NextResponse.json({ ok: true, enrichment });
}
