/**
 * PATCH /api/admin/firms/[firmId]/ownership/[rowId]
 *   body: any subset of { status, account_holder, account_email,
 *     billing_owner, firm_has_admin, evidence_url, evidence_note, action,
 *     action_done, notes }
 *   -> updates one row, scoped to firmId (a rowId from a different firm
 *      never matches). Setting status stamps last_reviewed_at server-side.
 *
 * Auth: getOperatorSession(). No password/credential field exists on this
 * route's accepted body by design (DR-111); a body containing one is
 * rejected rather than silently dropped, since silent-drop would let a
 * caller believe a credential was recorded when it was not.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { updateOwnershipRow, type OwnershipRowPatch } from "@/lib/asset-ownership";
import { OWNERSHIP_STATUSES, type OwnershipStatus } from "@/lib/asset-ownership-pure";

const ALLOWED_KEYS = new Set<keyof OwnershipRowPatch>([
  "status",
  "account_holder",
  "account_email",
  "billing_owner",
  "firm_has_admin",
  "evidence_url",
  "evidence_note",
  "action",
  "action_done",
  "notes",
]);

const FORBIDDEN_KEY_PATTERN = /pass|secret|token|credential|api[_-]?key/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; rowId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { firmId, rowId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const suspicious = Object.keys(body).find((k) => FORBIDDEN_KEY_PATTERN.test(k));
  if (suspicious) {
    return NextResponse.json(
      { ok: false, error: `field '${suspicious}' is not accepted; this register never stores credentials` },
      { status: 400 },
    );
  }

  const patch: OwnershipRowPatch = {};
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key as keyof OwnershipRowPatch)) continue;
    (patch as Record<string, unknown>)[key] = body[key];
  }

  if (patch.status !== undefined && !OWNERSHIP_STATUSES.includes(patch.status as OwnershipStatus)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }

  const row = await updateOwnershipRow(firmId, rowId, patch);
  if (!row) {
    return NextResponse.json({ ok: false, error: "row not found for this firm" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, row });
}
