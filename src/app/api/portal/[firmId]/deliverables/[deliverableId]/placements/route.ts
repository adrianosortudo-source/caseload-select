/**
 * GET/POST /api/portal/[firmId]/deliverables/[deliverableId]/placements
 *
 * Destination placements (Workstream 4): where this deliverable belongs
 * (firm website, LinkedIn post/article, GBP, etc.), independent of its
 * editorial format. Operator-only, matching the rest of Publication
 * Readiness's operator-control-surface posture (lawyers see approval
 * status and their review actions, never internal placement/readiness
 * plumbing).
 *
 * Body (POST): { destination, period_id?, locale?, intended_path?,
 *   required_artifact_type?, scheduled_publish_date? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getOperatorSession } from "@/lib/portal-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { createPlacement, listPlacementsForDeliverable } from "@/lib/content-placements";
import type { PlacementDestination, PublicationArtifactType } from "@/lib/types";

const VALID_DESTINATIONS: PlacementDestination[] = [
  "firm_website",
  "linkedin_article",
  "linkedin_post",
  "linkedin_company_page",
  "google_business_profile",
  "email_delivery",
];

const VALID_ARTIFACT_TYPES: PublicationArtifactType[] = [
  "hero_image",
  "social_image",
  "pdf",
  "webpage",
  "email",
  "thank_you_page",
  "form",
  "external_post",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, deliverableId } = await params;
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const placements = await listPlacementsForDeliverable(deliverableId);
  return NextResponse.json({ ok: true, placements });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, deliverableId } = await params;
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: {
    destination?: unknown;
    period_id?: unknown;
    locale?: unknown;
    intended_path?: unknown;
    required_artifact_type?: unknown;
    scheduled_publish_date?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const destination = typeof body.destination === "string" ? body.destination : null;
  if (!destination || !VALID_DESTINATIONS.includes(destination as PlacementDestination)) {
    return NextResponse.json(
      { error: `destination must be one of: ${VALID_DESTINATIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const requiredArtifactType =
    typeof body.required_artifact_type === "string" ? body.required_artifact_type : null;
  if (
    requiredArtifactType !== null &&
    !VALID_ARTIFACT_TYPES.includes(requiredArtifactType as PublicationArtifactType)
  ) {
    return NextResponse.json(
      { error: `required_artifact_type must be one of: ${VALID_ARTIFACT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const session = await getOperatorSession();
  const result = await createPlacement({
    firmId,
    deliverableId,
    periodId: typeof body.period_id === "string" ? body.period_id : null,
    destination: destination as PlacementDestination,
    locale: typeof body.locale === "string" ? body.locale : null,
    intendedPath: typeof body.intended_path === "string" ? body.intended_path : null,
    requiredArtifactType: requiredArtifactType as PublicationArtifactType | null,
    scheduledPublishDate:
      typeof body.scheduled_publish_date === "string" ? body.scheduled_publish_date : null,
    createdByRole: "operator",
    createdById: session?.lawyer_id ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, placement: result.placement });
}
