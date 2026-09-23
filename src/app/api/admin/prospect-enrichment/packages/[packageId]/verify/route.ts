import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readBoundedJson, requireProspectEnrichmentOperator, prospectEnrichmentJson, unexpectedEnrichmentError } from "@/lib/prospect-enrichment-auth";
import { prospectEnrichmentRpcFailure, prospectEnrichmentRpcObject } from "@/lib/prospect-enrichment-operator";
import { ProspectEnrichmentReadError } from "@/lib/prospect-enrichment-reader";
import { ReadApiError, isRecord, READ_UUID } from "../../../_read-common";
import { buildProspectEnrichmentVerification, VerificationMismatch } from "../../../_verify-readback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ packageId: string }> };

/** This records visibility only. Canonical evidence writes remain exclusively in the reviewed apply RPC. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProspectEnrichmentOperator(request, true);
  if (!auth.ok) return auth.response;
  if (auth.operator.session.role !== "operator") return prospectEnrichmentJson({ error: "An operator session is required." }, 403);
  try {
    const { packageId } = await context.params;
    if (!READ_UUID.test(packageId)) return prospectEnrichmentJson({ error: "The research package was not found." }, 404);
    if (request.nextUrl.searchParams.size) return prospectEnrichmentJson({ verified: false, error: "Verification does not accept query parameters." }, 422);
    const body = await readBoundedJson(request, 4096);
    if (!body.ok) return prospectEnrichmentJson({ verified: false, error: body.error }, body.status);
    const value = body.value;
    if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "visibilityScope")
      || !Object.hasOwn(value, "payloadSha256") || !["package", "canonical"].includes(String(value.visibilityScope))
      || typeof value.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadSha256)) {
      return prospectEnrichmentJson({ verified: false, error: "Verification requires the exact payloadSha256 and a package or canonical visibilityScope." }, 422);
    }
    const { report, ...details } = await buildProspectEnrichmentVerification({ packageId: packageId.toLowerCase(), payloadSha256: value.payloadSha256,
      visibilityScope: value.visibilityScope as "package" | "canonical", client: supabaseAdmin });
    // The RPC locks package/firm and rechecks current state, payload, receipt and revision before appending the event.
    const { data, error } = await supabaseAdmin.rpc("record_prospect_enrichment_verification_v1", {
      p_package_id: packageId.toLowerCase(), p_payload_sha256: value.payloadSha256,
      p_visibility_scope: value.visibilityScope, p_details: details,
    });
    if (error) {
      const conflict = ["readback_changed", "revision_changed", "receipt_mismatch", "invalid_state", "verification_changed"]
        .includes(error.message?.split(":", 1)[0] ?? "");
      const failure = conflict ? { status: 409, code: "readback_changed", message: "The package or firm changed during verification. Reload and verify again." }
        : prospectEnrichmentRpcFailure(error, "The verification receipt could not be saved.");
      return prospectEnrichmentJson({ verified: false, error: failure.message, code: failure.code }, failure.status);
    }
    const receipt = prospectEnrichmentRpcObject(data);
    if (!receipt || receipt.verified !== true || receipt.visibilityScope !== details.visibilityScope
      || receipt.payloadSha256 !== details.payloadSha256 || receipt.readbackSha256 !== details.readbackSha256) {
      return prospectEnrichmentJson({ verified: false, error: "The database did not return a matching verification receipt." }, 503);
    }
    // The public receipt contains only verified hashes, IDs/counts and scope, never destination row data.
    return prospectEnrichmentJson({ verified: true, packageId: packageId.toLowerCase(), ...details, report });
  } catch (cause) {
    if (cause instanceof VerificationMismatch) return prospectEnrichmentJson({ verified: false, code: cause.code, error: cause.message }, cause.status);
    if (cause instanceof ReadApiError || cause instanceof ProspectEnrichmentReadError) return prospectEnrichmentJson({ verified: false, error: cause.message }, cause.status);
    return prospectEnrichmentJson({ verified: false, ...unexpectedEnrichmentError("verify_package_visibility") }, 503);
  }
}
