import { NextRequest, NextResponse } from "next/server";
import type { ClientImportRow } from "@/lib/client-import-csv";
import { normalizeClientImportEmail, normalizeClientImportPhone } from "@/lib/client-import-csv";
import { clientImportDigest, guardClientImportWrite, importFeatureGate } from "@/lib/client-import-server";
import { importContactCreateOnly } from "@/lib/ghl-client-import-api";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const MAX_ROWS_PER_REQUEST = 25;
const FINAL_STATUSES = new Set([
  "created",
  "existing_unchanged",
  "held_for_review",
  "invalid",
  "failed",
  "reconcile_required",
]);

type RowOutcome = { rowNumber: number; status: string; errorCode?: string };

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

  if (batch.status === "completed" || batch.status === "completed_with_exceptions") {
    for (const input of body.rows) {
      const normalized = normalizeServerRow(input);
      const providedNumber = Number((input as { rowNumber?: unknown } | null)?.rowNumber);
      if (!Number.isInteger(providedNumber) || providedNumber <= 1) {
        return NextResponse.json({ error: "completed_batch_replay_must_match" }, { status: 409 });
      }
      const fingerprint = normalized
        ? clientImportDigest("row", JSON.stringify({ batchId, ...normalized }))
        : clientImportDigest("invalid-row", `${batchId}:${providedNumber}`);
      const { data: existing } = await supabase
        .from("secure_client_import_rows")
        .select("status, row_fingerprint")
        .eq("batch_id", batchId)
        .eq("row_number", providedNumber)
        .maybeSingle();
      if (!existing || !FINAL_STATUSES.has(existing.status as string)) {
        return NextResponse.json({ error: "completed_batch_cannot_accept_new_rows" }, { status: 409 });
      }
      if (existing.row_fingerprint !== fingerprint) {
        return NextResponse.json({ error: "row_fingerprint_mismatch" }, { status: 409 });
      }
    }
  }

  const outcomes: RowOutcome[] = [];
  for (const input of body.rows) {
    const normalized = normalizeServerRow(input);
    const providedNumber = Number((input as { rowNumber?: unknown } | null)?.rowNumber);
    if (!normalized) {
      if (Number.isInteger(providedNumber) && providedNumber > 1) {
        const fingerprint = clientImportDigest("invalid-row", `${batchId}:${providedNumber}`);
        await supabase.from("secure_client_import_rows").upsert(
          {
            batch_id: batchId,
            firm_id: firmId,
            row_number: providedNumber,
            row_fingerprint: fingerprint,
            status: "invalid",
            error_code: "server_validation_failed",
            processed_at: new Date().toISOString(),
          },
          { onConflict: "batch_id,row_number", ignoreDuplicates: true },
        );
      }
      outcomes.push({ rowNumber: Number.isInteger(providedNumber) ? providedNumber : 0, status: "invalid", errorCode: "server_validation_failed" });
      continue;
    }

    const fingerprint = clientImportDigest("row", JSON.stringify({ batchId, ...normalized }));
    const { data: existing } = await supabase
      .from("secure_client_import_rows")
      .select("status, error_code, attempt_count, processed_at, row_fingerprint")
      .eq("batch_id", batchId)
      .eq("row_number", normalized.rowNumber)
      .maybeSingle();
    if (existing && FINAL_STATUSES.has(existing.status as string)) {
      if (existing.row_fingerprint !== fingerprint) {
        return NextResponse.json({ error: "row_fingerprint_mismatch" }, { status: 409 });
      }
      outcomes.push({ rowNumber: normalized.rowNumber, status: existing.status as string, errorCode: (existing.error_code as string | null) ?? undefined });
      continue;
    }
    if (!existing) {
      const { error: claimError } = await supabase.from("secure_client_import_rows").insert({
        batch_id: batchId,
        firm_id: firmId,
        row_number: normalized.rowNumber,
        row_fingerprint: fingerprint,
        status: "processing",
      });
      if (claimError) {
        outcomes.push({ rowNumber: normalized.rowNumber, status: "invalid", errorCode: "duplicate_row_identity" });
        continue;
      }
    } else {
      const leaseStarted = new Date(existing.processed_at as string).getTime();
      if (Number.isFinite(leaseStarted) && leaseStarted > Date.now() - 2 * 60 * 1000) {
        outcomes.push({ rowNumber: normalized.rowNumber, status: "processing" });
        continue;
      }
      const { data: reclaimed } = await supabase
        .from("secure_client_import_rows")
        .update({ attempt_count: Math.min(Number(existing.attempt_count ?? 1) + 1, 10), processed_at: new Date().toISOString() })
        .eq("batch_id", batchId)
        .eq("row_number", normalized.rowNumber)
        .eq("status", "processing")
        .eq("processed_at", existing.processed_at)
        .select("id")
        .maybeSingle();
      if (!reclaimed) {
        outcomes.push({ rowNumber: normalized.rowNumber, status: "processing" });
        continue;
      }
    }

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
    const status = result.ok ? result.status : result.reconcileRequired ? "reconcile_required" : "failed";
    const errorCode = result.ok ? null : result.code;
    const contactId = result.ok && (result.status === "created" || result.status === "existing_unchanged") ? result.contactId : null;
    const matchCount = result.ok && result.status !== "created" ? result.matchCount : 0;
    const { error: finishError } = await supabase
      .from("secure_client_import_rows")
      .update({
        status,
        ghl_contact_id: contactId,
        match_count: matchCount,
        error_code: errorCode,
        processed_at: new Date().toISOString(),
      })
      .eq("batch_id", batchId)
      .eq("row_number", normalized.rowNumber)
      .eq("status", "processing");
    if (finishError) {
      outcomes.push({ rowNumber: normalized.rowNumber, status: "reconcile_required", errorCode: "audit_finalize_failed" });
    } else outcomes.push({ rowNumber: normalized.rowNumber, status, errorCode: errorCode ?? undefined });
  }

  const { data: auditedRows } = await supabase
    .from("secure_client_import_rows")
    .select("status")
    .eq("batch_id", batchId)
    .eq("firm_id", firmId);
  const counts = {
    processed: 0,
    created: 0,
    existing: 0,
    held: 0,
    invalid: 0,
    failed: 0,
    reconcile: 0,
  };
  for (const row of auditedRows ?? []) {
    const status = row.status as string;
    if (status !== "processing") counts.processed += 1;
    if (status === "created") counts.created += 1;
    else if (status === "existing_unchanged") counts.existing += 1;
    else if (status === "held_for_review") counts.held += 1;
    else if (status === "invalid") counts.invalid += 1;
    else if (status === "failed") counts.failed += 1;
    else if (status === "reconcile_required") counts.reconcile += 1;
  }
  const complete = counts.processed === declaredRowCount;
  const hasExceptions = counts.held + counts.invalid + counts.failed + counts.reconcile > 0;
  const batchStatus = complete ? (hasExceptions ? "completed_with_exceptions" : "completed") : "processing";
  await supabase
    .from("secure_client_import_batches")
    .update({
      processed_row_count: counts.processed,
      created_count: counts.created,
      existing_count: counts.existing,
      held_count: counts.held,
      invalid_count: counts.invalid,
      failed_count: counts.failed,
      reconcile_count: counts.reconcile,
      status: batchStatus,
      completed_at: complete ? ((batch.completed_at as string | null) ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId)
    .eq("firm_id", firmId);
  return NextResponse.json({ ok: true, batchId, status: batchStatus, counts, outcomes });
}
