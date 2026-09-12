import { NextResponse } from "next/server";

import {
  buildGtaProspectEvidenceImportPlan,
  defaultGtaProspectEvidenceSourceName,
  type GtaProspectEvidenceImportPlan,
} from "@/lib/gta-prospect-evidence-import";
import { applyGtaProspectOperatorEvidenceImport } from "@/lib/gta-prospect-operator-evidence-import";
import { listGtaProspectResearchForOperator } from "@/lib/gta-prospect-research-reader";
import { sha256 } from "@/lib/gta-prospect-research-import";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const unauthorizedStatus = { status: 401 };

type EvidenceImportRequest = Readonly<{
  sourceName: string;
  payload: Record<string, unknown>;
  sourceSha256?: string;
}>;

type EvidenceReview = Readonly<{
  plan: GtaProspectEvidenceImportPlan;
  sourceSha256: string;
  packageId: string | null;
  summary: GtaProspectEvidenceImportPlan["summary"] & Readonly<{ reviewRequired: number }>;
}>;

function parseRequest(payload: unknown): { request: EvidenceImportRequest } | { error: string; status: number } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Expected a JSON object with a supplemental evidence package.", status: 400 };
  }
  const raw = payload as { sourceName?: unknown; sourceSha256?: unknown; payload?: unknown };
  if (!raw.payload || typeof raw.payload !== "object" || Array.isArray(raw.payload)) {
    return { error: "payload must be one JSON supplemental evidence package.", status: 400 };
  }
  const sourceName = raw.sourceName === undefined ? "gta-operator-evidence" : defaultGtaProspectEvidenceSourceName(raw.sourceName);
  if (!sourceName) {
    return { error: "sourceName must use 1-200 lowercase letters, numbers, hyphens, or underscores.", status: 400 };
  }
  if (raw.sourceSha256 !== undefined && (typeof raw.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sourceSha256))) {
    return { error: "sourceSha256 must be a lowercase SHA-256 hex value.", status: 400 };
  }
  return { request: { sourceName, payload: raw.payload as Record<string, unknown>, sourceSha256: raw.sourceSha256 as string | undefined } };
}

async function reviewEvidence(request: EvidenceImportRequest): Promise<EvidenceReview> {
  const existing = await listGtaProspectResearchForOperator();
  const plan = await buildGtaProspectEvidenceImportPlan(request.payload, {
    appliedSourceRecordKeys: new Set(existing.map((record) => record.id)),
  });
  return {
    plan,
    sourceSha256: plan.payloadSha256 ?? await sha256(request.payload),
    packageId: plan.accepted?.packageId ?? null,
    summary: { ...plan.summary, reviewRequired: plan.rejected.length },
  };
}

async function requestPayload(request: Request): Promise<{ request: EvidenceImportRequest } | { error: string; status: number }> {
  try {
    return parseRequest(await request.json());
  } catch {
    return { error: "Expected a JSON body with a supplemental evidence package.", status: 400 };
  }
}

/** Operator-only zero-write review for evidence that supplements existing prospects. */
export async function POST(request: Request) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: "Unauthorized" }, { ...unauthorizedStatus, headers: noStore });
  const parsed = await requestPayload(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: noStore });
  try {
    const result = await reviewEvidence(parsed.request);
    return NextResponse.json({
      mode: "dry_run",
      sourceName: parsed.request.sourceName,
      sourceSha256: result.sourceSha256,
      packageId: result.packageId,
      summary: result.summary,
      rejected: result.plan.rejected,
    }, { headers: noStore });
  } catch (error) {
    console.error("[gta-prospect-evidence] operator evidence review failed", error);
    return NextResponse.json({ error: "Supplemental prospect evidence could not be reviewed against the current ledger." }, { status: 503, headers: noStore });
  }
}

/**
 * Explicit operator-gated apply. The server repeats review and verifies the
 * package fingerprint, so a browser cannot turn a stale dry run into a write.
 * This endpoint records evidence only; it never sends outreach or acts on an
 * intake channel.
 */
export async function PUT(request: Request) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: "Unauthorized" }, { ...unauthorizedStatus, headers: noStore });
  const parsed = await requestPayload(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: noStore });
  try {
    const result = await reviewEvidence(parsed.request);
    if (parsed.request.sourceSha256 !== result.sourceSha256) {
      return NextResponse.json({ error: "The reviewed package changed. Run review again before applying it.", sourceSha256: result.sourceSha256 }, { status: 409, headers: noStore });
    }
    if (!result.plan.accepted || result.plan.rejected.length > 0 || result.summary.reviewRequired > 0) {
      return NextResponse.json({
        error: "Resolve every invalid or review-needed evidence item before applying this package.",
        sourceSha256: result.sourceSha256,
        summary: result.summary,
        rejected: result.plan.rejected,
      }, { status: 422, headers: noStore });
    }
    const applied = await applyGtaProspectOperatorEvidenceImport({ plan: result.plan });
    return NextResponse.json({
      mode: applied.state,
      sourceName: parsed.request.sourceName,
      sourceSha256: applied.payloadSha256,
      packageId: applied.packageId,
      summary: result.summary,
      receipt: applied.receipt,
    }, { headers: noStore });
  } catch (error) {
    console.error("[gta-prospect-evidence] operator evidence apply failed", error);
    return NextResponse.json({ error: "Supplemental prospect evidence could not be applied. No CRM, outreach, contact, or intake action was attempted." }, { status: 503, headers: noStore });
  }
}
