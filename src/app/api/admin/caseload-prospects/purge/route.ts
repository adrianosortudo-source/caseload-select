/**
 * POST /api/admin/caseload-prospects/purge
 *
 * PIPEDA erasure endpoint for CaseLoad Select's OWN prospects, the rows the
 * public "Start a conversation" flow writes to caseload_prospects. Sibling to
 * /api/admin/leads/[id]/purge, which covers a client firm's leads.
 *
 * Anonymises rather than deletes (DR-114): the identifying columns are
 * replaced, the closed-option answers survive for funnel counts, and the
 * linked append-only consent evidence is left intact.
 *
 * Auth: Bearer CRON_SECRET / PG_CRON_TOKEN, or an operator session cookie.
 * Same two paths /api/admin/webhook-outbox accepts.
 *
 * Body, exactly one selector:
 *   { "prospect_id": "<uuid>" }        one row
 *   { "email": "someone@firm.ca" }     every row for that subject
 *   { "before": "<ISO timestamp>" }    every row submitted before the cutoff
 * Optional:
 *   { "reason": "subject_request" | "retention_sweep" | "internal_test_record" }
 *   defaulting to subject_request, which is what an operator-driven call is.
 *
 * Unlike the leads purge, this route reports how many rows it touched. There
 * is no enumeration defence to preserve here: the caller is already the
 * operator, and a count of zero is the operator's signal that they typed the
 * wrong address rather than that the erasure silently succeeded.
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  anonymizeCaseloadProspects,
  countProspectSelectors,
  isProspectAnonymizationReason,
  type ProspectErasureSelector,
} from "@/lib/caseload-prospect-erasure";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cronAuthed = isCronAuthorized(req);
  const operatorSession = cronAuthed ? null : await getOperatorSession();
  if (!cronAuthed && !operatorSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const input = (body ?? {}) as {
    prospect_id?: unknown;
    email?: unknown;
    before?: unknown;
    reason?: unknown;
  };

  const selectorCount = countProspectSelectors({
    prospectId: input.prospect_id,
    email: input.email,
    before: input.before,
  });

  if (selectorCount !== 1) {
    return NextResponse.json(
      {
        error:
          "supply exactly one of prospect_id, email, before",
      },
      { status: 400 },
    );
  }

  if (input.reason !== undefined && !isProspectAnonymizationReason(input.reason)) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }
  const reason = isProspectAnonymizationReason(input.reason)
    ? input.reason
    : ("subject_request" as const);

  let selector: ProspectErasureSelector;
  if (typeof input.prospect_id === "string" && input.prospect_id.length > 0) {
    selector = { prospectId: input.prospect_id };
  } else if (typeof input.email === "string" && input.email.length > 0) {
    selector = { email: input.email };
  } else {
    selector = { before: input.before as string };
  }

  const result = await anonymizeCaseloadProspects(selector, reason);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    anonymized_count: result.anonymized_count,
    prospect_ids: result.prospect_ids,
    reason,
    purged_at: new Date().toISOString(),
    note: "PII anonymized per PIPEDA s. 4.5.3 (DR-114). Rows are not deleted; the linked append-only consent evidence, including ip_address and user_agent, is retained intact as proof consent was given.",
  });
}
