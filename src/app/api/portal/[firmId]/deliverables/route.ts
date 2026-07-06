/**
 * GET  /api/portal/[firmId]/deliverables       list deliverables
 * POST /api/portal/[firmId]/deliverables       create a deliverable
 *
 * Operator or firm-lawyer session. Client sessions rejected. Creating a
 * deliverable does not post a version; the operator posts the first version
 * separately (the create + first-version flow is two calls from the UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { listDeliverables, createDeliverable } from "@/lib/deliverables";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { cleanTitle, cleanDescription, isValidContentKind } from "@/lib/deliverables-pure";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("archived") === "1";
  const deliverables = await listDeliverables(firmId, { includeArchived });
  return NextResponse.json({ ok: true, deliverables });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: { title?: unknown; description?: unknown; content_kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = cleanTitle(body.title);
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!isValidContentKind(body.content_kind)) {
    return NextResponse.json({ error: "content_kind must be text, image, or pdf" }, { status: 400 });
  }

  const result = await createDeliverable({
    firmId,
    title,
    description: cleanDescription(body.description),
    contentKind: body.content_kind,
    actor: resolved.actor,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, deliverable: result.deliverable });
}
