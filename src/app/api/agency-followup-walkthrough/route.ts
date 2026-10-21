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
  try {
    return NextResponse.json(await runFakeAgencyFollowupDispatcher({
      workerId: String(body.workerId ?? ""),
      now: typeof body.now === "string" ? body.now : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      outcomePlan,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fake dispatch failed." }, { status: 409 });
  }
}
