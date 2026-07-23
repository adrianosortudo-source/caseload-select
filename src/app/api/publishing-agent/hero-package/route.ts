/**
 * POST /api/publishing-agent/hero-package
 *
 * The Publishing Package Gateway's only operation: upload one approved hero
 * image and bind it to one exact deliverable. See publishing-package-gateway.ts
 * for the full scope statement and the seven publishing-agent operating
 * principles this endpoint enforces -- this route is the thin I/O wrapper;
 * every actual validation decision lives in that pure module.
 *
 * Auth: a single dedicated bearer credential (PUBLISHING_PACKAGE_GATEWAY_TOKEN,
 * see publishing-package-gateway-auth.ts), never a portal operator/lawyer
 * session, never CRON_SECRET/PG_CRON_TOKEN. This credential authorizes
 * nothing except this one route -- see the authorization-boundary tests in
 * __tests__/route.test.ts.
 *
 * Body: multipart/form-data with fields firm_id, deliverable_id,
 * expected_locale, expected_content_kind, expected_sha256, and a "file"
 * part carrying the actual image bytes. No JSON body, no url field --
 * this endpoint never fetches a remote URL and never accepts a
 * caller-supplied storage path.
 *
 * Writes exactly one column on exactly one row on success:
 * content_deliverables.hero_image_url for the validated deliverable. No
 * other table, column, or row is ever touched by this route.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isPublishingPackageGatewayAuthorized } from "@/lib/publishing-package-gateway-auth";
import {
  HERO_PACKAGE_BUCKET,
  SUPPORTED_HERO_PACKAGE_CONTENT_KINDS,
  SUPPORTED_HERO_PACKAGE_LOCALES,
  heroPackageStoragePath,
  safeHeroPackageFileName,
  validateHeroPackageBytes,
  validateHeroPackageDeliverableIdentity,
  type HeroPackageFinalOutcome,
  type HeroPackageReceipt,
} from "@/lib/publishing-package-gateway";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// 10 years, matching the existing operator-facing hero endpoint's own
// signed-URL TTL rationale: hero_image_url is stored on the deliverable row
// and rendered on every preview load, so a short TTL would expire under the
// operator/publishing agent.
const SIGNED_URL_TTL = 10 * 365 * 24 * 60 * 60;

function blankReceipt(operationId: string, timestamp: string): Omit<HeroPackageReceipt, "finalValidationOutcome"> {
  return {
    operationId,
    timestamp,
    firmId: "",
    deliverableId: "",
    fileName: "",
    mimeType: null,
    byteSize: 0,
    computedSha256: "",
    expectedSha256: "",
    storageKey: null,
    resultingHeroBinding: null,
  };
}

function fail(
  status: number,
  outcome: HeroPackageFinalOutcome,
  receipt: Omit<HeroPackageReceipt, "finalValidationOutcome">,
  error: string,
) {
  return NextResponse.json(
    { ok: false, error, receipt: { ...receipt, finalValidationOutcome: outcome } },
    { status },
  );
}

export async function POST(req: NextRequest) {
  // Auth is checked before anything else in this request is even parsed,
  // and an unauthenticated caller gets a bare error -- never a receipt
  // (which would leak operation-id/shape information to a caller who
  // never proved they may use this endpoint at all).
  if (!isPublishingPackageGatewayAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const operationId = randomUUID();
  const timestamp = new Date().toISOString();
  return handlePost(req, operationId, timestamp);
}

async function handlePost(req: NextRequest, operationId: string, timestamp: string) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail(400, "rejected_malformed_request", blankReceipt(operationId, timestamp), "invalid multipart body");
  }

  const firmId = formData.get("firm_id");
  const deliverableId = formData.get("deliverable_id");
  const expectedLocale = formData.get("expected_locale");
  const expectedContentKind = formData.get("expected_content_kind");
  const expectedSha256 = formData.get("expected_sha256");
  const file = formData.get("file");

  if (typeof firmId !== "string" || !firmId) {
    return fail(400, "rejected_malformed_request", blankReceipt(operationId, timestamp), "firm_id is required");
  }
  if (typeof deliverableId !== "string" || !deliverableId) {
    return fail(400, "rejected_malformed_request", blankReceipt(operationId, timestamp), "deliverable_id is required");
  }
  if (typeof expectedLocale !== "string" || !(SUPPORTED_HERO_PACKAGE_LOCALES as readonly string[]).includes(expectedLocale)) {
    return fail(400, "rejected_locale_mismatch", blankReceipt(operationId, timestamp), "expected_locale is required and must be a supported locale");
  }
  if (
    typeof expectedContentKind !== "string" ||
    !(SUPPORTED_HERO_PACKAGE_CONTENT_KINDS as readonly string[]).includes(expectedContentKind)
  ) {
    return fail(400, "rejected_content_kind_mismatch", blankReceipt(operationId, timestamp), "expected_content_kind is required and must be a supported content kind");
  }
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return fail(400, "rejected_hash_mismatch", blankReceipt(operationId, timestamp), "expected_sha256 is required and must be 64 lowercase hex characters");
  }
  if (!(file instanceof File)) {
    return fail(400, "rejected_malformed_request", blankReceipt(operationId, timestamp), 'field "file" is required and must be an actual file part -- no url field is accepted');
  }

  const baseReceipt = {
    operationId,
    timestamp,
    firmId,
    deliverableId,
    fileName: safeHeroPackageFileName(file.name),
    expectedSha256,
    storageKey: null,
    resultingHeroBinding: null,
  };

  const bytes = Buffer.from(await file.arrayBuffer());
  const bytesResult = validateHeroPackageBytes(bytes, expectedSha256);
  const receiptAfterBytes = {
    ...baseReceipt,
    mimeType: bytesResult.sniffedMime,
    byteSize: bytesResult.byteSize,
    computedSha256: bytesResult.computedSha256,
  };
  if (!bytesResult.ok) {
    const outcome: HeroPackageFinalOutcome =
      bytesResult.rejectionReason === "too_large"
        ? "rejected_too_large"
        : bytesResult.rejectionReason === "hash_mismatch"
          ? "rejected_hash_mismatch"
          : "rejected_unsupported_mime";
    return fail(
      bytesResult.rejectionReason === "too_large" ? 413 : bytesResult.rejectionReason === "unsupported_mime" ? 415 : 422,
      outcome,
      receiptAfterBytes,
      `hero package rejected: ${bytesResult.rejectionReason}`,
    );
  }

  const { data: deliverableRow, error: fetchErr } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, status, locale, content_kind")
    .eq("id", deliverableId)
    .maybeSingle();
  if (fetchErr) {
    return fail(500, "rejected_deliverable_not_found", receiptAfterBytes, `deliverable lookup failed: ${fetchErr.message}`);
  }

  const identity = validateHeroPackageDeliverableIdentity(deliverableRow, {
    firmId,
    deliverableId,
    expectedLocale,
    expectedContentKind,
  });
  if (!identity.ok) {
    const outcome: HeroPackageFinalOutcome =
      identity.rejectionReason === "cross_firm"
        ? "rejected_cross_firm"
        : identity.rejectionReason === "archived"
          ? "rejected_archived"
          : identity.rejectionReason === "locale_mismatch"
            ? "rejected_locale_mismatch"
            : identity.rejectionReason === "content_kind_mismatch"
              ? "rejected_content_kind_mismatch"
              : "rejected_deliverable_not_found";
    return fail(404, outcome, receiptAfterBytes, `deliverable identity rejected: ${identity.rejectionReason}`);
  }

  const storagePath = heroPackageStoragePath({ firmId, deliverableId, operationId, fileName: file.name });
  const { error: uploadErr } = await supabase.storage
    .from(HERO_PACKAGE_BUCKET)
    .upload(storagePath, bytes, { contentType: bytesResult.sniffedMime!, upsert: false });
  if (uploadErr) {
    return fail(500, "rejected_storage_write_failed", receiptAfterBytes, `storage upload failed: ${uploadErr.message}`);
  }
  const receiptAfterStorage = { ...receiptAfterBytes, storageKey: storagePath };

  const { data: signed, error: signErr } = await supabase.storage
    .from(HERO_PACKAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  if (signErr || !signed?.signedUrl) {
    await supabase.storage.from(HERO_PACKAGE_BUCKET).remove([storagePath]).catch(() => {});
    return fail(500, "rejected_binding_write_failed", receiptAfterStorage, "could not sign storage url");
  }

  // The ONLY write this route ever makes to content_deliverables: exactly
  // hero_image_url + updated_at, scoped by id AND firm_id (defense in
  // depth -- identity was already confirmed above, this repeats the
  // firm_id predicate at the write itself rather than trusting the prior
  // check alone). No other column is ever touched by this endpoint.
  const { error: updateErr } = await supabase
    .from("content_deliverables")
    .update({ hero_image_url: signed.signedUrl, updated_at: new Date().toISOString() })
    .eq("id", deliverableId)
    .eq("firm_id", firmId);
  if (updateErr) {
    await supabase.storage.from(HERO_PACKAGE_BUCKET).remove([storagePath]).catch(() => {});
    return fail(500, "rejected_binding_write_failed", receiptAfterStorage, `hero binding update failed: ${updateErr.message}`);
  }

  const finalReceipt: HeroPackageReceipt = {
    ...receiptAfterStorage,
    resultingHeroBinding: signed.signedUrl,
    finalValidationOutcome: "confirmed",
  };
  return NextResponse.json({ ok: true, receipt: finalReceipt });
}
