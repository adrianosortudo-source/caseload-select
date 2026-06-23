/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/approve
 *
 * The lawyer's formal sign-off (LSO Rule 4.2-1 compliance record). Writes an
 * append-only approval_records row freezing the attestation copy, version,
 * signer identity, IP, and user agent, then updates the deliverable status.
 *
 * LAWYER ONLY. An operator viewing the firm portal cannot sign; the licensee
 * must attest. The sign-off applies to a SPECIFIC version: the request must
 * target the current version, so a sign-off can never land on a stale draft.
 *
 * Body: { version_id, decision: "approved" | "changes_requested", agreed, note? }
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail, recordApproval } from "@/lib/deliverables";
import {
  canSignOff,
  cleanNote,
  APPROVAL_ATTESTATION,
  CHANGES_ATTESTATION,
} from "@/lib/deliverables-pure";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!canSignOff(resolved.actor.role)) {
    return NextResponse.json(
      { error: "sign-off is completed by the firm's lawyer, not the operator" },
      { status: 403 },
    );
  }
  if (!resolved.actor.email) {
    return NextResponse.json(
      { error: "a lawyer email is required on file before signing; contact the operator" },
      { status: 400 },
    );
  }

  let body: { version_id?: unknown; decision?: unknown; agreed?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const decision = body.decision === "changes_requested" ? "changes_requested" : "approved";
  if (body.agreed !== true) {
    return NextResponse.json({ error: "you must confirm the statement to sign" }, { status: 400 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const versionId = typeof body.version_id === "string" ? body.version_id : null;
  const current = detail.deliverable.current_version_id;
  if (!versionId || versionId !== current) {
    return NextResponse.json(
      { error: "a newer version exists; refresh and sign the current version" },
      { status: 409 },
    );
  }
  const version = detail.versions.find((v) => v.id === versionId);
  if (!version) {
    return NextResponse.json({ error: "version not found" }, { status: 404 });
  }

  const attestation = decision === "approved" ? APPROVAL_ATTESTATION : CHANGES_ATTESTATION;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await recordApproval({
    deliverableId,
    versionId,
    versionNumber: version.version_number,
    firmId,
    deliverableTitle: detail.deliverable.title,
    decision,
    attestation,
    signer: {
      id: resolved.actor.id ?? null,
      name: resolved.actor.name ?? "Authorised lawyer",
      email: resolved.actor.email,
    },
    ipAddress,
    userAgent,
    note: cleanNote(body.note),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, record: result.record });
}
