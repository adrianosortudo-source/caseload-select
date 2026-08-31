import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import {
  guardClientImportWrite,
  importFeatureGate,
  verifyClientImportChallenge,
} from "@/lib/client-import-server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const guard = await guardClientImportWrite(req, firmId);
  if (!guard.ok) {
    if (guard.response) return guard.response;
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const gate = importFeatureGate(guard.config);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 503 });
  const limit = await checkRateLimit("clientImportVerify", `${firmId}:${guard.actor.id}:${ipFromRequest(req)}`);
  if (!limit.ok || (process.env.NODE_ENV === "production" && !limit.active)) {
    return NextResponse.json({ error: "verification_rate_limited" }, { status: 429, headers: rateLimitHeaders(limit) });
  }
  let body: { challengeId?: unknown; code?: unknown; attested?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.challengeId !== "string" || typeof body.code !== "string") {
    return NextResponse.json({ error: "challenge_and_code_required" }, { status: 400 });
  }
  const result = await verifyClientImportChallenge({
    id: body.challengeId,
    code: body.code.trim(),
    actor: guard.actor,
    attested: body.attested === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, verifiedAt: result.verifiedAt });
}
