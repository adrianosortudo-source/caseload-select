import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PROSPECT_ENRICHMENT_MAX_BODY_BYTES } from "@/lib/prospect-enrichment-contract";
import { readBoundedJson, requireProspectEnrichmentOperator, prospectEnrichmentJson, unexpectedEnrichmentError } from "@/lib/prospect-enrichment-auth";
import { ProspectEnrichmentReviewInputError, parseProspectEnrichmentReview, prospectEnrichmentReviewSha256, prospectEnrichmentRpcFailure, prospectEnrichmentRpcObject } from "@/lib/prospect-enrichment-operator";
import { deriveProspectEnrichmentNewCoreInput } from "@/lib/prospect-enrichment-core-evidence";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import { readPackageDetail } from "../../../_package-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ packageId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

async function rejectPackage(packageId: string, value: unknown, operatorId: string) {
  if (!exactObject(value, ["action", "payloadSha256", "reason"]) || value.action !== "reject"
    || typeof value.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadSha256)
    || typeof value.reason !== "string" || !value.reason.trim() || new TextEncoder().encode(value.reason).byteLength > 2000) {
    return prospectEnrichmentJson({ error: "Reject requests require action, payloadSha256 and a reason of 1 to 2,000 bytes." }, 422);
  }
  const { data, error } = await supabaseAdmin.rpc("reject_prospect_enrichment_package_v1", {
    p_package_id: packageId,
    p_payload_sha256: value.payloadSha256,
    p_reason: value.reason,
    p_operator_id: operatorId,
  });
  if (error) {
    const failure = prospectEnrichmentRpcFailure(error, "The research package could not be rejected.");
    return prospectEnrichmentJson({ error: failure.message, code: failure.code }, failure.status);
  }
  const receipt = prospectEnrichmentRpcObject(data);
  if (!receipt || !["rejected", "already_rejected"].includes(String(receipt.outcome))) {
    return prospectEnrichmentJson({ error: "The database did not return a valid rejection receipt." }, 503);
  }
  return prospectEnrichmentJson(receipt);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProspectEnrichmentOperator(request, true);
  if (!auth.ok) return auth.response;
  try {
    const { packageId } = await context.params;
    if (!UUID.test(packageId)) return prospectEnrichmentJson({ error: "The research package was not found." }, 404);
    const body = await readBoundedJson(request, PROSPECT_ENRICHMENT_MAX_BODY_BYTES);
    if (!body.ok) return prospectEnrichmentJson({ error: body.error }, body.status);
    const bodyValue = body.value;
    if (bodyValue && typeof bodyValue === "object" && !Array.isArray(bodyValue) && Object.hasOwn(bodyValue, "action")) {
      return await rejectPackage(packageId, bodyValue, auth.operator.id);
    }

    const detail = await readPackageDetail({ packageId: packageId.toLowerCase() });
    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)
      || detail.payloadSha256 !== (body.value as Record<string, unknown>).payloadSha256) {
      return prospectEnrichmentJson({ error: "The research package changed. Reload it before reviewing." }, 409);
    }
    const allowedProfileChoices = new Map(detail.items.map((item) => [item.itemId, item.allowedProfileChoice ?? null] as const));
    const review = parseProspectEnrichmentReview(body.value, { allowedProfileChoices });
    const identityOption = detail.identityOptions?.find((candidate) => candidate.value === review.identity.choice && candidate.eligible);
    if (!identityOption) throw new ProspectEnrichmentReviewInputError("The selected firm identity is not eligible from the current package evidence.");
    const itemsById = new Map(detail.items.map((item) => [item.itemId, item]));
    for (const choice of review.items) {
      const item = itemsById.get(choice.itemId);
      const allowed = review.identity.choice === "new"
        ? item?.allowedDispositionsForNewIdentity ?? ["retain_only"]
        : item?.allowedDispositions ?? ["retain_only"];
      if (!item || !allowed.includes(choice.disposition)) {
        throw new ProspectEnrichmentReviewInputError("An item disposition is not allowed for this firm identity and current evidence.");
      }
    }
    if (review.identity.choice === "new") {
      const options = detail.newCoreOptions;
      if (!options?.eligible || !review.identity.coreInput) throw new ProspectEnrichmentReviewInputError("New-firm identity is not eligible from the current package evidence.");
      let expected: ReturnType<typeof deriveProspectEnrichmentNewCoreInput>;
      try {
        expected = deriveProspectEnrichmentNewCoreInput(options, review.identity.coreInput.coreEvidence, review.identity.coreInput.reconciliationNote);
      } catch (cause) {
        throw new ProspectEnrichmentReviewInputError(cause instanceof Error ? cause.message : "New-firm source evidence could not be verified.");
      }
      if (prospectEnrichmentProtocolHash(expected) !== prospectEnrichmentProtocolHash(review.identity.coreInput)) {
        throw new ProspectEnrichmentReviewInputError("New-firm core values do not exactly match the selected evidence and current package identity.");
      }
    }
    const reviewSha256 = prospectEnrichmentReviewSha256(review);
    const reviewExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const { data, error } = await supabaseAdmin.rpc("review_prospect_enrichment_package_v1", {
      p_package_id: packageId,
      p_payload_sha256: review.payloadSha256,
      p_review: review,
      p_review_sha256: reviewSha256,
      p_operator_id: auth.operator.id,
      p_review_expires_at: reviewExpiresAt,
    });
    if (error) {
      const failure = prospectEnrichmentRpcFailure(error, "The exact review could not be prepared.");
      return prospectEnrichmentJson({ error: failure.message, code: failure.code }, failure.status);
    }
    const receipt = prospectEnrichmentRpcObject(data);
    if (!receipt || receipt.reviewSha256 !== reviewSha256 || typeof receipt.expectedRevisionSha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(receipt.expectedRevisionSha256) || typeof receipt.reviewExpiresAt !== "string"
      || Date.parse(receipt.reviewExpiresAt) <= Date.now()) {
      return prospectEnrichmentJson({ error: "The database did not return a valid review receipt." }, 503);
    }
    return prospectEnrichmentJson({
      reviewSha256,
      expectedRevisionSha256: receipt.expectedRevisionSha256,
      reviewExpiresAt: receipt.reviewExpiresAt,
      review: receipt.review ?? review,
    });
  } catch (error) {
    if (error instanceof ProspectEnrichmentReviewInputError) return prospectEnrichmentJson({ error: error.message }, error.status);
    const safe = unexpectedEnrichmentError("prepare_review");
    return prospectEnrichmentJson(safe, 503);
  }
}
