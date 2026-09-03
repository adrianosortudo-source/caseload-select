/**
 * POST /api/admin/leads/[id]/purge
 *
 * Verified privacy-erasure endpoint. The screened-lead path performs its
 * database redaction atomically, then leaves any external cleanup visibly
 * pending until an operator records its completion.
 *
 * Auth: Bearer CRON_SECRET (operator only  -  never expose to clients)
 *
 * The database retains only the permitted non-identifying audit envelope.
 */

import { NextRequest, NextResponse } from "next/server";
import { purgeLeadPii } from "@/lib/data-retention";
import { isCronAuthorized } from "@/lib/cron-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set([
  "subject_request",
  "retention_sweep",
  "internal_test_record",
  "legacy_anonymization_backfill",
]);
const CLEANUP_STATUSES = new Set([
  "completed",
  "not_applicable",
  "provider_managed",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: {
    firm_id?: unknown;
    reason?: unknown;
    deletion_request_id?: unknown;
    external_cleanup?: unknown;
  } = {};
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
  }
  if (body.firm_id !== undefined && (typeof body.firm_id !== "string" || !UUID_RE.test(body.firm_id))) {
    return NextResponse.json({ error: "firm_id must be a UUID" }, { status: 400 });
  }
  if (body.firm_id === undefined) {
    return NextResponse.json(
      { error: "firm_id is required for tenant-scoped deletion" },
      { status: 400 },
    );
  }
  if (
    body.deletion_request_id !== undefined &&
    (typeof body.deletion_request_id !== "string" || !UUID_RE.test(body.deletion_request_id))
  ) {
    return NextResponse.json(
      { error: "deletion_request_id must be a UUID" },
      { status: 400 },
    );
  }
  if (body.reason !== undefined && !REASONS.has(String(body.reason))) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }
  let externalCleanup:
    | {
        ghlStatus?: "completed" | "not_applicable";
        metaStatus?: "completed" | "not_applicable" | "provider_managed";
        resendStatus?: "completed" | "not_applicable" | "provider_managed";
      }
    | undefined;
  if (body.external_cleanup !== undefined) {
    if (
      !body.external_cleanup ||
      typeof body.external_cleanup !== "object" ||
      Array.isArray(body.external_cleanup)
    ) {
      return NextResponse.json(
        { error: "external_cleanup must be an object" },
        { status: 400 },
      );
    }
    const cleanup = body.external_cleanup as Record<string, unknown>;
    const allowedKeys = new Set(["ghl_status", "meta_status", "resend_status"]);
    if (Object.keys(cleanup).some((key) => !allowedKeys.has(key))) {
      return NextResponse.json(
        { error: "external_cleanup contains an unsupported field" },
        { status: 400 },
      );
    }
    for (const key of allowedKeys) {
      if (cleanup[key] !== undefined && !CLEANUP_STATUSES.has(String(cleanup[key]))) {
        return NextResponse.json(
          { error: `${key} has an invalid status` },
          { status: 400 },
        );
      }
    }
    if (cleanup.ghl_status === "provider_managed") {
      return NextResponse.json(
        { error: "ghl_status must record completed or not_applicable manual cleanup" },
        { status: 400 },
      );
    }
    externalCleanup = {
      ghlStatus: cleanup.ghl_status as
        | "completed"
        | "not_applicable"
        | undefined,
      metaStatus: cleanup.meta_status as
        | "completed"
        | "not_applicable"
        | "provider_managed"
        | undefined,
      resendStatus: cleanup.resend_status as
        | "completed"
        | "not_applicable"
        | "provider_managed"
        | undefined,
    };
  }

  const result = await purgeLeadPii(id, {
    firmId: body.firm_id as string | undefined,
    reason: body.reason as
      | "subject_request"
      | "retention_sweep"
      | "internal_test_record"
      | "legacy_anonymization_backfill"
      | undefined,
    deletionRequestId: body.deletion_request_id as string | undefined,
    externalCleanup,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        deletion_request_id: result.deletion_request_id,
        database_redacted: result.screened_lead_redacted,
        external_cleanup_status: result.external_cleanup_status,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    lead_id: id,
    deletion_request_id: result.deletion_request_id,
    external_cleanup_status: result.external_cleanup_status,
    purged_at: new Date().toISOString(),
    note: "Operational database redaction and required application-coordinated cleanup completed. Provider-managed copies may remain subject to their own retention and deletion procedures.",
  });
}
