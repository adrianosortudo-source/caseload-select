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
    if (!fields || Object.keys(fields).length !== 2 || !Object.hasOwn(fields, "payloadSha256") || !Object.hasOwn(fields, "reason")
      || typeof fields.payloadSha256 !== "string" || !SHA256.test(fields.payloadSha256)
      || typeof fields.reason !== "string" || !fields.reason.trim() || new TextEncoder().encode(fields.reason).byteLength > 2000) {
      return prospectEnrichmentJson({ error: "Reject requests require payloadSha256 and a reason of 1 to 2,000 bytes." }, 422);
    }
    const { data, error } = await supabaseAdmin.rpc("reject_prospect_enrichment_package_v1", {
      p_package_id: packageId,
      p_payload_sha256: fields.payloadSha256,
      p_reason: fields.reason,
      p_operator_id: auth.operator.id,
    });
    if (error) {
      const failure = prospectEnrichmentRpcFailure(error, "The research package could not be rejected.");
      return prospectEnrichmentJson({ error: failure.message, code: failure.code }, failure.status);
    }
    const receipt = prospectEnrichmentRpcObject(data);
    if (!receipt || !["rejected", "already_rejected"].includes(String(receipt.outcome))) return prospectEnrichmentJson({ error: "The database did not return a valid rejection receipt." }, 503);
    return prospectEnrichmentJson(receipt);
  } catch {
    return prospectEnrichmentJson(unexpectedEnrichmentError("reject_package"), 503);
  }
}
