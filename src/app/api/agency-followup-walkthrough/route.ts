import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { runFakeAgencyFollowupDispatcher } from "@/lib/agency-followup-service";
import type { AgencyProviderOutcome } from "@/lib/agency-followup-domain";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (process.env.NODE_ENV === "production" || !/^(127\.0\.0\.1|localhost):55435$/.test(host)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!process.env.AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN ||
      body.token !== process.env.AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const outcomePlan = body.outcomePlan as AgencyProviderOutcome[] | undefined;
  if (outcomePlan && (!Array.isArray(outcomePlan) || outcomePlan.some((item) =>
      !item || !["accepted", "unknown", "definitive_retryable_failure", "definitive_permanent_failure"].includes(item.kind)))) {
    return NextResponse.json({ error: "Unsupported fake provider outcome." }, { status: 400 });
  }
  const providerDelayMs = body.providerDelayMs;
  if (providerDelayMs !== undefined &&
      (typeof providerDelayMs !== "number" || !Number.isSafeInteger(providerDelayMs) || providerDelayMs < 0 || providerDelayMs > 30000)) {
    return NextResponse.json({ error: "Unsupported synthetic provider delay." }, { status: 400 });
  }
  try {
    return NextResponse.json(await runFakeAgencyFollowupDispatcher({
      workerId: String(body.workerId ?? ""),
      now: typeof body.now === "string" ? body.now : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      outcomePlan,
      providerDelayMs: typeof providerDelayMs === "number" ? providerDelayMs : undefined,
    }));
  } catch (error) {
    return NextResponse.json({ error: "Fake dispatch failed." }, { status: 409 });
  }
}
