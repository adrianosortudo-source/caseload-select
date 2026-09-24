import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readBoundedJson, requireProspectEnrichmentOperator, prospectEnrichmentJson, unexpectedEnrichmentError } from "@/lib/prospect-enrichment-auth";
import { prospectEnrichmentRpcFailure, prospectEnrichmentRpcObject } from "@/lib/prospect-enrichment-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ packageId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProspectEnrichmentOperator(request, true);
  if (!auth.ok) return auth.response;
  try {
    const { packageId } = await context.params;
    if (!UUID.test(packageId)) return prospectEnrichmentJson({ error: "The research package was not found." }, 404);
    const body = await readBoundedJson(request, 16_384);
    if (!body.ok) return prospectEnrichmentJson({ error: body.error }, body.status);
    const value = body.value;
    const fields = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (!fields || Object.keys(fields).length !== 3 || !Object.hasOwn(fields, "reviewSha256")
      || !Object.hasOwn(fields, "expectedRevisionSha256") || !Object.hasOwn(fields, "acknowledged")
      || typeof fields.reviewSha256 !== "string" || !SHA256.test(fields.reviewSha256)
      || typeof fields.expectedRevisionSha256 !== "string" || !SHA256.test(fields.expectedRevisionSha256)
      || fields.acknowledged !== true) {
      return prospectEnrichmentJson({ error: "Apply requires the exact review and revision hashes plus explicit acknowledgement." }, 422);
    }
    const { data, error } = await supabaseAdmin.rpc("apply_prospect_enrichment_package_v1", {
      p_package_id: packageId,
      p_review_sha256: fields.reviewSha256,
      p_expected_revision_sha256: fields.expectedRevisionSha256,
      p_operator_id: auth.operator.id,
    });
    if (error) {
      const failure = prospectEnrichmentRpcFailure(error, "The reviewed package could not be applied.");
      return prospectEnrichmentJson({ error: failure.message, code: failure.code }, failure.status);
    }
    const receipt = prospectEnrichmentRpcObject(data);
    if (!receipt || !["applied", "already_applied"].includes(String(receipt.outcome))
      || receipt.payloadSha256 === undefined || receipt.appliedAt === undefined) {
      return prospectEnrichmentJson({ error: "The database did not return a valid application receipt." }, 503);
    }
    return prospectEnrichmentJson(receipt, receipt.outcome === "applied" ? 200 : 200);
  } catch {
    return prospectEnrichmentJson(unexpectedEnrichmentError("apply_reviewed_package"), 503);
  }
}
