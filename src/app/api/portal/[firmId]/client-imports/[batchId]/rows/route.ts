import { NextRequest, NextResponse } from "next/server";
import type { ClientImportRow } from "@/lib/client-import-csv";
import { normalizeClientImportEmail, normalizeClientImportPhone } from "@/lib/client-import-csv";
import { clientImportDigest, guardClientImportWrite, importFeatureGate } from "@/lib/client-import-server";
import { importContactCreateOnly } from "@/lib/ghl-client-import-api";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const MAX_ROWS_PER_REQUEST = 25;
type RowOutcome = { rowNumber: number; status: string; errorCode?: string };

type ClaimResult = {
  row_number?: number | null;
  outcome?: string;
  status?: string;
  error_code?: string | null;
  claim_token?: string | null;
};

type BatchResult = {
  outcome?: string;
  status?: string;
  counts?: {
    processed: number;
    created: number;
    existing: number;
    held: number;
    invalid: number;
    failed: number;
    reconcile: number;
  };
};

function normalizeServerRow(value: unknown): ClientImportRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rowNumber = Number(row.rowNumber);
  const firstName = typeof row.firstName === "string" ? row.firstName.trim().slice(0, 100) : "";
  const lastName = typeof row.lastName === "string" ? row.lastName.trim().slice(0, 100) : "";
  const rawEmail = typeof row.email === "string" ? row.email : "";
  const rawPhone = typeof row.phone === "string" ? row.phone : "";
  const email = normalizeClientImportEmail(rawEmail);
  const phone = normalizeClientImportPhone(rawPhone);
  const relationshipType = row.relationshipType;
  const marketingPermission = row.marketingPermission;
  const closedYear = row.matterClosedYear === null ? null : Number(row.matterClosedYear);
  if (!Number.isInteger(rowNumber) || rowNumber <= 1 || (!firstName && !lastName) || (!email && !phone)) return null;
  if (!["current_client", "former_client", "prospective_client", "referral_source", "unknown"].includes(String(relationshipType))) return null;
  if (!["express", "implied", "unknown", "no_contact"].includes(String(marketingPermission))) return null;
  if (closedYear !== null && (!Number.isInteger(closedYear) || closedYear < 1900 || closedYear > new Date().getFullYear())) return null;
  return {
    rowNumber,
    firstName,
    lastName,
    email,
    phone,
    relationshipType: relationshipType as ClientImportRow["relationshipType"],
    practiceArea: typeof row.practiceArea === "string" ? row.practiceArea.trim().slice(0, 120) || null : null,
    matterClosedYear: closedYear,
    marketingPermission: marketingPermission as ClientImportRow["marketingPermission"],
  };
}

function invalidRowFingerprint(batchId: string, rowNumber: number, value: unknown): string {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const bounded = (field: string) => {
    const candidate = row[field];
    if (candidate === null || typeof candidate === "number" || typeof candidate === "boolean") return candidate;
    return typeof candidate === "string" ? candidate.trim().slice(0, 500) : null;
  };
  return clientImportDigest("invalid-row", JSON.stringify({
    batchId,
    rowNumber,
    firstName: bounded("firstName"),
    lastName: bounded("lastName"),
    email: bounded("email"),
    phone: bounded("phone"),
    relationshipType: bounded("relationshipType"),
    practiceArea: bounded("practiceArea"),
    matterClosedYear: bounded("matterClosedYear"),
    marketingPermission: bounded("marketingPermission"),
  }));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; batchId: string }> },
) {
  const { firmId, batchId } = await params;
  const guard = await guardClientImportWrite(req, firmId);
  if (!guard.ok) {
    if (guard.response) return guard.response;
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const gate = importFeatureGate(guard.config);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 503 });
  const limit = await checkRateLimit("clientImportRows", `${firmId}:${guard.actor.id}:${ipFromRequest(req)}`);
  if (!limit.ok || (process.env.NODE_ENV === "production" && !limit.active)) {
    return NextResponse.json({ error: "import_rate_limited" }, { status: 429, headers: rateLimitHeaders(limit) });
  }

  const { data: batch } = await supabase
    .from("secure_client_import_batches")
    .select("id, declared_row_count, processed_row_count, status, completed_at")
    .eq("id", batchId)
    .eq("firm_id", firmId)
    .eq("lawyer_id", guard.actor.id)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  if (batch.status === "cancelled") return NextResponse.json({ error: "batch_cancelled" }, { status: 409 });

  let body: { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json({ error: "rows_must_contain_1_to_25_items" }, { status: 400 });
  }

  const declaredRowCount = Number(batch.declared_row_count);
  const processedRowCount = Number(batch.processed_row_count);
  const lastDeclaredRowNumber = declaredRowCount + 1;
  const providedRowNumbers = body.rows.map((input) => Number((input as { rowNumber?: unknown } | null)?.rowNumber));
  if (!Number.isInteger(declaredRowCount) || declaredRowCount < 1) {
    return NextResponse.json({ error: "invalid_declared_row_count" }, { status: 409 });
  }
  if (!Number.isInteger(processedRowCount) || processedRowCount < 0 || processedRowCount > declaredRowCount) {
    return NextResponse.json({ error: "invalid_batch_progress" }, { status: 409 });
  }
  if (providedRowNumbers.some((rowNumber) => Number.isInteger(rowNumber) && rowNumber > lastDeclaredRowNumber)) {
    return NextResponse.json({ error: "row_number_exceeds_declared_count" }, { status: 409 });
  }
  const validProvidedNumbers = providedRowNumbers.filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 1);
  if (new Set(validProvidedNumbers).size !== validProvidedNumbers.length) {
    return NextResponse.json({ error: "duplicate_row_number_in_request" }, { status: 409 });
  }

  const preparedRows = body.rows.map((input) => {
    const normalized = normalizeServerRow(input);
    const rowNumber = Number((input as { rowNumber?: unknown } | null)?.rowNumber);
    return {
      normalized,
      rowNumber,
      fingerprint: normalized
        ? clientImportDigest("row", JSON.stringify({ batchId, ...normalized }))
        : invalidRowFingerprint(batchId, rowNumber, input),
    };
  });
  if (preparedRows.some((row) => !Number.isInteger(row.rowNumber) || row.rowNumber <= 1)) {
    return NextResponse.json({ error: "invalid_row_number" }, { status: 400 });
  }

  const { data: rawClaims, error: claimError } = await supabase.rpc("claim_secure_client_import_rows", {
    p_batch_id: batchId,
    p_firm_id: firmId,
    p_lawyer_id: guard.actor.id,
    p_rows: preparedRows.map((row) => ({ row_number: row.rowNumber, row_fingerprint: row.fingerprint })),
  });
  if (claimError || !Array.isArray(rawClaims)) {
    return NextResponse.json({ error: "row_claim_failed" }, { status: 500 });
  }
  const claims = rawClaims as ClaimResult[];
  const fatalClaim = claims.find((claim) => [
    "row_fingerprint_mismatch",
    "invalid_row_claim",
    "duplicate_row_number_in_request",
    "duplicate_row_fingerprint_in_request",
    "duplicate_row_identity",
    "completed_batch_cannot_accept_new_rows",
    "batch_cancelled",
    "batch_not_found",
  ].includes(String(claim.outcome)));
  if (fatalClaim) {
    const status = fatalClaim.outcome === "batch_not_found" ? 404 : 409;
    return NextResponse.json({ error: fatalClaim.outcome }, { status });
  }

  const outcomes: RowOutcome[] = [];
  for (const prepared of preparedRows) {
    const claim = claims.find((item) => item.row_number === prepared.rowNumber);
    if (!claim) return NextResponse.json({ error: "row_claim_failed" }, { status: 500 });
    if (claim.outcome === "replay" || claim.outcome === "reconcile_required") {
      outcomes.push({
        rowNumber: prepared.rowNumber,
        status: String(claim.status),
        errorCode: claim.error_code ?? undefined,
      });
      continue;
    }
    if (claim.outcome === "in_progress") {
      outcomes.push({ rowNumber: prepared.rowNumber, status: "processing" });
      continue;
    }
    if (claim.outcome !== "claimed" || !claim.claim_token) {
      return NextResponse.json({ error: "row_claim_failed" }, { status: 500 });
    }

    let status: string;
    let errorCode: string | null;
    let contactId: string | null;
    let matchCount: number;
    if (!prepared.normalized) {
      status = "invalid";
      errorCode = "server_validation_failed";
      contactId = null;
      matchCount = 0;
    } else {
      const normalized = prepared.normalized;
      // HighLevel stays outside the short claim/finalize transactions. If
      // this result becomes unknown, the claim expires into reconciliation;
      // it is never automatically claimed for a second create attempt.
      const result = await importContactCreateOnly({
        locationId: guard.config.locationId,
        token: guard.config.token,
        batchId,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        email: normalized.email,
        phone: normalized.phone,
        relationshipType: normalized.relationshipType,
        marketingPermission: normalized.marketingPermission,
        practiceArea: normalized.practiceArea,
        matterClosedYear: normalized.matterClosedYear,
      });
      status = result.ok ? result.status : result.reconcileRequired ? "reconcile_required" : "failed";
      errorCode = result.ok ? null : result.code;
      contactId = result.ok && (result.status === "created" || result.status === "existing_unchanged") ? result.contactId : null;
      matchCount = result.ok && result.status !== "created" ? result.matchCount : 0;
    }
    const { data: rawFinish, error: finishError } = await supabase.rpc("finalize_secure_client_import_row", {
      p_batch_id: batchId,
      p_firm_id: firmId,
      p_lawyer_id: guard.actor.id,
      p_row_number: prepared.rowNumber,
      p_row_fingerprint: prepared.fingerprint,
      p_claim_token: claim.claim_token,
      p_status: status,
      p_ghl_contact_id: contactId,
      p_match_count: matchCount,
      p_error_code: errorCode,
    });
    const finish = (rawFinish ?? {}) as BatchResult;
    if (finishError || finish.outcome !== "finalized") {
      outcomes.push({ rowNumber: prepared.rowNumber, status: "reconcile_required", errorCode: "audit_finalize_failed" });
    } else outcomes.push({ rowNumber: prepared.rowNumber, status, errorCode: errorCode ?? undefined });
  }

  const { data: rawBatchResult, error: refreshError } = await supabase.rpc("refresh_secure_client_import_batch", {
    p_batch_id: batchId,
    p_firm_id: firmId,
    p_lawyer_id: guard.actor.id,
  });
  const batchResult = (rawBatchResult ?? {}) as BatchResult;
  if (refreshError || batchResult.outcome !== "ok" || !batchResult.counts || !batchResult.status) {
    return NextResponse.json({ error: "batch_audit_refresh_failed" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    batchId,
    status: batchResult.status,
    counts: batchResult.counts,
    outcomes,
  });
}
