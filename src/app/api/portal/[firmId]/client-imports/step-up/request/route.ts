import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import {
  createClientImportChallenge,
  guardClientImportWrite,
  importFeatureGate,
  maskedEmail,
  revokeClientImportChallenge,
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

  const limit = await checkRateLimit("clientImportAuthorize", `${firmId}:${guard.actor.id}:${ipFromRequest(req)}`);
  if (!limit.ok || (process.env.NODE_ENV === "production" && !limit.active)) {
    return NextResponse.json({ error: "authorization_rate_limited" }, { status: 429, headers: rateLimitHeaders(limit) });
  }

  const challenge = await createClientImportChallenge(guard.actor);
  if (!challenge.ok) return NextResponse.json({ error: challenge.error }, { status: 500 });
  try {
    const delivery = await sendEmail(
      guard.actor.email,
      "Your CaseLoad Select import authorization code",
      `<p>You requested authorization to import your firm's relationship database.</p>` +
        `<p style="font-size:32px;font-weight:700;letter-spacing:8px">${challenge.code}</p>` +
        `<p>This code expires in 10 minutes. If you did not request it, do not share it and contact CaseLoad Select.</p>`,
      { idempotencyKey: `secure-import-step-up-${challenge.id}` },
    );
    if (delivery.skipped) {
      await revokeClientImportChallenge(challenge.id);
      return NextResponse.json({ error: "authorization_email_unavailable" }, { status: 503 });
    }
  } catch {
    await revokeClientImportChallenge(challenge.id);
    return NextResponse.json({ error: "authorization_email_failed" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    sentTo: maskedEmail(guard.actor.email),
  });
}
